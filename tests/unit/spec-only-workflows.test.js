import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';

const fastSource = readFileSync('.github/workflows/pr-fast.yml', 'utf8');
const integrationSource = readFileSync('.github/workflows/pr-integration.yml', 'utf8');
const deploySource = readFileSync('.github/workflows/deploy-prod.yml', 'utf8');
const postDeploySource = readFileSync('.github/workflows/post-deploy-smoke.yml', 'utf8');

const fast = parseYaml(fastSource);
const integration = parseYaml(integrationSource);
const deploy = parseYaml(deploySource);
const postDeploy = parseYaml(postDeploySource);

describe('spec-only workflow routing', () => {
    it('keeps stable fast-check contexts while avoiding dependency-heavy suites', () => {
        expect(fast.jobs['change-impact'].outputs.lane).toContain('steps.classify.outputs.lane');
        for (const name of ['unit-tests', 'cache-bust-guard', 'app-quality']) {
            expect(fast.jobs[name].needs).toBe('change-impact');
            expect(fast.jobs[name].if).toContain('always()');
        }
        expect(fastSource).toContain('node scripts/validate-spec-docs.mjs');
        expect(fastSource).toContain("needs.change-impact.outputs.lane != 'spec-only'");
        expect(fastSource).toContain('Confirm app checks are intentionally not applicable');
    });

    it('keeps stable integration contexts and accepts only intentional spec skips', () => {
        for (const name of ['regression-integration', 'mobile-integration', 'preview-integration']) {
            expect(integration.jobs[name].needs).toBe('change-impact');
            expect(integration.jobs[name].if).toContain("lane != 'spec-only'");
        }
        expect(integration.jobs['mobile-build'].needs).toEqual(['change-impact', 'mobile-integration']);
        expect(integration.jobs['preview-smoke'].needs).toEqual([
            'change-impact',
            'regression-integration',
            'preview-integration'
        ]);
        expect(integrationSource).toContain('Spec-only integration jobs were not intentionally skipped');
    });

    it('records a typed no-op release only after reusable exact-head validation', () => {
        const noop = deploy.jobs['release-noop-marker'];
        expect(noop.needs).toEqual(['validation-source', 'production-validation-gate']);
        expect(noop.if).toContain("reuse_pr_validation == 'true'");
        expect(noop.if).toContain("change_impact == 'spec-only'");
        expect(deploySource).toContain('environment:"production-artifact"');
        expect(deploySource).toContain('release_kind:"no-op"');
        expect(deploySource).toContain('artifact_sha:$artifact_sha');
        expect(deploy.jobs['prepare-deploy'].if).toContain("change_impact != 'spec-only'");
    });

    it('runs browser smoke only for a deployed artifact and verifies no-op provenance separately', () => {
        expect(postDeploy.jobs['release-proof']).toBeDefined();
        expect(postDeploy.jobs['post-deploy-noop'].if).toContain("release_kind == 'no-op'");
        expect(postDeploy.jobs['post-deploy-smoke'].if).toContain("release_kind == 'deploy'");
        expect(postDeploySource).toContain('scripts/verify-production-release-provenance.mjs');
        expect(postDeploySource).toContain('production-artifact');
    });
});
