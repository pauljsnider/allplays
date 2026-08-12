import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const deployWorkflow = readFileSync('.github/workflows/deploy-prod.yml', 'utf8');
const postDeployWorkflow = readFileSync('.github/workflows/post-deploy-smoke.yml', 'utf8');

describe('production role-smoke gate', () => {
    it('blocks preparation before production credentials when role fixtures are missing', () => {
        expect(deployWorkflow).toContain('validate-production-smoke-config:');
        expect(deployWorkflow).toContain('environment:\n      name: production-smoke');
        expect(deployWorkflow).toContain('SMOKE_ADMIN_EMAIL: ${{ secrets.SMOKE_ADMIN_EMAIL }}');
        expect(deployWorkflow).toContain('SMOKE_STAFF_EMAIL: ${{ secrets.SMOKE_STAFF_EMAIL }}');
        expect(deployWorkflow).toContain('SMOKE_PARENT_EMAIL: ${{ secrets.SMOKE_PARENT_EMAIL }}');
        expect(deployWorkflow).toContain('Missing protected configuration names: $missing_csv');
        expect(deployWorkflow).toContain('needs: production-validation-gate');
        expect(deployWorkflow).toContain('needs: [production-validation-gate, validate-production-smoke-config]');
        expect(deployWorkflow.indexOf('validate-production-smoke-config:')).toBeLessThan(
            deployWorkflow.indexOf('  prepare-deploy:')
        );
    });

    it('does not allow post-deploy role workflows to be reported as skipped success', () => {
        expect(postDeployWorkflow).toContain('Fixture-backed production smoke not configured');
        expect(postDeployWorkflow).toContain('CORE_CONFIGURED');
        expect(postDeployWorkflow).toContain(
            'if [[ "$CORE_CONFIGURED" != "true" || "$CORE_OUTCOME" != "success" ]]; then'
        );
        expect(postDeployWorkflow).not.toContain('not-configured ($CORE_MISSING)');
    });

    it('retries the canonical production baseline once for transient deploy propagation failures', () => {
        const baselineStart = postDeployWorkflow.indexOf('Run production smoke baseline');
        const coreStart = postDeployWorkflow.indexOf('Run fixture-backed core production smoke');
        const baselineBlock = postDeployWorkflow.slice(baselineStart, coreStart);

        expect(baselineStart).toBeGreaterThan(-1);
        expect(coreStart).toBeGreaterThan(baselineStart);
        expect(baselineBlock).toContain('--retries=1');
    });
});
