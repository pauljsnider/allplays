import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

function readWorkflow(path) {
    return readFileSync(path, 'utf8');
}

describe('production smoke workflow configuration', () => {
    it('uses the deployed app boot smoke without enabling Vite-mocked app specs', () => {
        [
            '.github/workflows/scheduled-prod-smoke.yml',
            '.github/workflows/post-deploy-smoke.yml'
        ].forEach((workflowPath) => {
            const workflow = readWorkflow(workflowPath);

            expect(workflow).toContain('SMOKE_BASE_URL: https://allplays.ai');
            expect(workflow).toContain('SMOKE_APP_BOOT_URL: https://allplays.ai/app/');
            expect(workflow).not.toContain('SMOKE_APP_BASE_URL:');
        });
    });

    it('keeps Vite-mocked React app smoke specs gated behind SMOKE_APP_BASE_URL', () => {
        [
            'tests/smoke/app-home-player.spec.js',
            'tests/smoke/app-messages.spec.js',
            'tests/smoke/app-private-ai.spec.js',
            'tests/smoke/app-search.spec.js',
            'tests/smoke/app-teams.spec.js'
        ].forEach((specPath) => {
            const spec = readWorkflow(specPath);

            expect(spec).toContain("const appBaseUrl = process.env.SMOKE_APP_BASE_URL || '';");
            expect(spec).toContain("test.skip(!appBaseUrl, 'SMOKE_APP_BASE_URL is required for React app smoke tests');");
        });
    });
});
