import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';
import { evaluateProductionValidationReuse } from '../../scripts/verify-production-validation-reuse.mjs';

const workflowSource = readFileSync('.github/workflows/deploy-prod.yml', 'utf8');
const fastWorkflowSource = readFileSync('.github/workflows/pr-fast.yml', 'utf8');
const integrationWorkflowSource = readFileSync('.github/workflows/pr-integration.yml', 'utf8');
const workflow = parseYaml(workflowSource);
const mergeSha = 'a'.repeat(40);
const headSha = 'b'.repeat(40);
const treeSha = 'c'.repeat(40);

function workflowRun(name) {
    return {
        id: name === 'pr-fast' ? 101 : 102,
        status: 'completed',
        conclusion: 'success',
        event: 'pull_request',
        head_sha: headSha,
        head_branch: 'codex/production-validation-reuse',
        head_repository: { full_name: 'pauljsnider/allplays' },
        path: `.github/workflows/${name}.yml`,
        display_title: `${name} #4605 -> master @ ${headSha}`,
        updated_at: '2026-08-12T08:10:00Z'
    };
}

function evidence() {
    return {
        repository: 'pauljsnider/allplays',
        mergeSha,
        pulls: [{
            number: 4605,
            state: 'closed',
            merged_at: '2026-08-12T08:11:00Z',
            merge_commit_sha: mergeSha,
            base: { ref: 'master', repo: { full_name: 'pauljsnider/allplays' } },
            head: {
                sha: headSha,
                ref: 'codex/production-validation-reuse',
                repo: { full_name: 'pauljsnider/allplays' }
            }
        }],
        mergeCommit: { sha: mergeSha, tree: { sha: treeSha } },
        headCommit: { sha: headSha, tree: { sha: treeSha } },
        prFastRuns: { workflow_runs: [workflowRun('pr-fast')] },
        prIntegrationRuns: { workflow_runs: [workflowRun('pr-integration')] },
        runJobs: {
            101: {
                jobs: ['unit-tests', 'cache-bust-guard', 'app-quality'].map((name) => ({
                    name,
                    status: 'completed',
                    conclusion: 'success'
                }))
            },
            102: {
                jobs: ['mobile-build', 'preview-smoke'].map((name) => ({
                    name,
                    status: 'completed',
                    conclusion: 'success'
                }))
            }
        },
        statuses: [{
            context: 'paulbot-review-gate',
            state: 'success',
            creator: { id: 309595148, login: 'allplays-paulbot[bot]', type: 'Bot' },
            target_url: 'https://github.com/pauljsnider/allplays/pull/4605',
            description: 'Current-head review, review remediation, and CI passed',
            updated_at: '2026-08-12T08:10:30Z'
        }]
    };
}

describe('production exact-head validation reuse', () => {
    it('accepts an identical merged tree with exact PR-bound jobs and trusted PaulBot approval', () => {
        expect(evaluateProductionValidationReuse(evidence())).toMatchObject({
            reusable: true,
            prNumber: 4605,
            headSha
        });
    });

    it('rejects same-SHA workflow evidence produced for another PR and base', () => {
        const input = evidence();
        input.prFastRuns.workflow_runs[0].display_title = `pr-fast #999 -> support @ ${headSha}`;
        input.prIntegrationRuns.workflow_runs[0].display_title = `pr-integration #999 -> support @ ${headSha}`;
        expect(evaluateProductionValidationReuse(input).reusable).toBe(false);
    });

    it('rejects a forged success context from an untrusted creator', () => {
        const input = evidence();
        input.statuses[0].creator = { id: 1, login: 'untrusted-writer', type: 'User' };
        expect(evaluateProductionValidationReuse(input)).toEqual({
            reusable: false,
            reason: 'trusted PR-bound PaulBot approval is missing'
        });
    });

    it('rejects a successful workflow whose required jobs were skipped', () => {
        const input = evidence();
        input.runJobs[101].jobs.find((job) => job.name === 'unit-tests').conclusion = 'skipped';
        expect(evaluateProductionValidationReuse(input)).toEqual({
            reusable: false,
            reason: 'exact PR-bound workflows and required jobs are incomplete'
        });
    });

    it('rejects status evidence for another PR, stale approval, and a different tree', () => {
        const wrongPr = evidence();
        wrongPr.statuses[0].target_url = 'https://github.com/pauljsnider/allplays/pull/999';
        expect(evaluateProductionValidationReuse(wrongPr).reusable).toBe(false);

        const stale = evidence();
        stale.statuses[0].updated_at = '2026-08-12T08:09:59Z';
        expect(evaluateProductionValidationReuse(stale).reusable).toBe(false);

        const differentTree = evidence();
        differentTree.mergeCommit.tree.sha = 'd'.repeat(40);
        expect(evaluateProductionValidationReuse(differentTree).reusable).toBe(false);
    });

    it('publishes PR/base identity in both workflow runs and gates duplicate production tests', () => {
        const identity = '#${{ github.event.pull_request.number }} -> ${{ github.event.pull_request.base.ref }} @ ${{ github.event.pull_request.head.sha }}';
        expect(fastWorkflowSource).toContain(`run-name: "pr-fast ${identity}"`);
        expect(integrationWorkflowSource).toContain(`run-name: "pr-integration ${identity}"`);
        expect(workflowSource).toContain('commits/${head_sha}/statuses');
        expect(workflow.jobs['unit-tests'].needs).toBe('validation-source');
        expect(workflow.jobs['unit-tests'].if).toContain("reuse_pr_validation != 'true'");
        expect(workflow.jobs['regression-guards'].needs).toBe('validation-source');
        expect(workflow.jobs['regression-guards'].if).toContain("reuse_pr_validation != 'true'");
        expect(workflow.jobs['production-validation-gate'].if).toBe('always()');
    });
});
