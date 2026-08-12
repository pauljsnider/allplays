import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';

const workflowSource = readFileSync('.github/workflows/deploy-prod.yml', 'utf8');
const workflow = parseYaml(workflowSource);

describe('production exact-head validation reuse', () => {
    it('fails closed unless a same-repository merged PR has an identical validated tree', () => {
        expect(workflowSource).toContain('echo "reuse_pr_validation=false" >> "$GITHUB_OUTPUT"');
        expect(workflowSource).toContain('.merge_commit_sha == $sha');
        expect(workflowSource).toContain('.base.ref == "master"');
        expect(workflowSource).toContain('.base.repo.full_name == $repo');
        expect(workflowSource).toContain('.head.repo.full_name == $repo');
        expect(workflowSource).toContain('if [[ "$(jq \'length\' <<< "$matching_prs")" != "1" ]]');
        expect(workflowSource).toContain('"repos/${GITHUB_REPOSITORY}/git/commits/${GITHUB_SHA}"');
        expect(workflowSource).toContain('"repos/${GITHUB_REPOSITORY}/git/commits/${head_sha}"');
        expect(workflowSource).toContain('[[ ! "$merge_tree" =~ ^[0-9a-f]{40}$ || "$merge_tree" != "$head_tree" ]]');
    });

    it('rejects same-SHA workflow evidence from another PR, base, or repository', () => {
        expect(workflowSource).toContain('.head_repository.full_name == $repo');
        expect(workflowSource).toContain('.number == $pr_number');
        expect(workflowSource).toContain('.head.repo.id == $repo_id');
        expect(workflowSource).toContain('.base.ref == "master"');
        expect(workflowSource).toContain('.base.repo.id == $repo_id');
        expect(workflowSource).toContain('] | length) == 1');
    });

    it('requires successful stable jobs instead of workflow-level success alone', () => {
        expect(workflowSource).toContain('actions/runs/${workflow_run_id}/jobs?filter=latest&per_page=100');
        expect(workflowSource).toContain('workflow_passed pr-fast.yml cache-bust-guard unit-tests app-quality');
        expect(workflowSource).toContain('workflow_passed pr-integration.yml mobile-build preview-smoke');
        expect(workflowSource).toContain('.name == $required_job');
        expect(workflowSource).toContain('.status == "completed"');
        expect(workflowSource).toContain('.conclusion == "success"');
    });

    it('binds the PaulBot gate to this PR and its trusted status issuer', () => {
        expect(workflowSource).toContain('.head_sha == $head_sha');
        expect(workflowSource).toContain('.event == "pull_request"');
        expect(workflowSource).toContain('.context == "paulbot-review-gate"');
        expect(workflowSource).toContain('paulbot_target="https://github.com/${GITHUB_REPOSITORY}/pull/${pr_number}"');
        expect(workflowSource).toContain('paulbot_issuer_avatar="https://avatars.githubusercontent.com/u/211066188?"');
        expect(workflowSource).toContain('.target_url == $target');
        expect(workflowSource).toContain('startswith($issuer_avatar)');
        expect(workflowSource).toContain('echo "reuse_pr_validation=true" >> "$GITHUB_OUTPUT"');
    });

    it('runs fresh tests on fallback and aggregates reused or fresh validation fail closed', () => {
        expect(workflow.jobs['unit-tests'].needs).toBe('validation-source');
        expect(workflow.jobs['unit-tests'].if).toContain("reuse_pr_validation != 'true'");
        expect(workflow.jobs['regression-guards'].needs).toBe('validation-source');
        expect(workflow.jobs['regression-guards'].if).toContain("reuse_pr_validation != 'true'");
        expect(workflow.jobs['production-validation-gate'].needs).toEqual([
            'validation-source',
            'unit-tests',
            'regression-guards'
        ]);
        expect(workflow.jobs['production-validation-gate'].if).toBe('always()');
        expect(workflowSource).toContain('if [[ "$UNIT_TEST_RESULT" != "success" || "$REGRESSION_GUARD_RESULT" != "success" ]]');
        expect(workflow.jobs['prepare-deploy'].needs).toEqual([
            'production-validation-gate',
            'validate-production-smoke-config'
        ]);
    });
});
