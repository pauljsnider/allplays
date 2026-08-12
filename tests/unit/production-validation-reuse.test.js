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
        expect(workflowSource).toContain('.head.repo.full_name == $repo');
        expect(workflowSource).toContain('if [[ "$(jq \'length\' <<< "$matching_prs")" != "1" ]]');
        expect(workflowSource).toContain('"repos/${GITHUB_REPOSITORY}/git/commits/${GITHUB_SHA}"');
        expect(workflowSource).toContain('"repos/${GITHUB_REPOSITORY}/git/commits/${head_sha}"');
        expect(workflowSource).toContain('[[ ! "$merge_tree" =~ ^[0-9a-f]{40}$ || "$merge_tree" != "$head_tree" ]]');
    });

    it('requires both exact-head PR workflows and the PaulBot gate before reuse', () => {
        expect(workflowSource).toContain('workflow_passed pr-fast.yml');
        expect(workflowSource).toContain('workflow_passed pr-integration.yml');
        expect(workflowSource).toContain('.head_sha == $head_sha');
        expect(workflowSource).toContain('.event == "pull_request"');
        expect(workflowSource).toContain('.conclusion == "success"');
        expect(workflowSource).toContain('.context == "paulbot-review-gate"');
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
