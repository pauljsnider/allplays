import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';

const repoRoot = path.resolve(import.meta.dirname, '../..');

function workflow(name) {
    return fs.readFileSync(path.join(repoRoot, '.github', 'workflows', name), 'utf8');
}

describe('pull request CI consolidation', () => {
    it('has exactly two code-head workflow entrypoints with stable required contexts', () => {
        const fast = workflow('pr-fast.yml');
        const integration = workflow('pr-integration.yml');

        expect(fast).toContain('name: pr-fast');
        expect(fast).toContain('pull_request:');
        expect(fast).toContain('  cache-bust-guard:');
        expect(fast).toContain('  unit-tests:');
        expect(fast).toContain('  app-quality:');
        expect(integration).toContain('name: pr-integration');
        expect(integration).toContain('pull_request:');
        expect(integration).toContain('name: mobile-build');
        expect(integration).toContain('name: preview-smoke');
    });

    it('does not spend runners on draft heads and starts validation at handoff', () => {
        const fast = parseYaml(workflow('pr-fast.yml'));
        const integration = parseYaml(workflow('pr-integration.yml'));

        expect(fast.on.pull_request.types).toContain('ready_for_review');
        expect(integration.on.pull_request.types).toContain('ready_for_review');
        for (const jobName of ['cache-bust-guard', 'unit-tests', 'app-quality']) {
            expect(fast.jobs[jobName].if).toBe('${{ github.event.pull_request.draft == false }}');
        }
        for (const jobName of ['regression-integration', 'mobile-integration', 'preview-integration']) {
            expect(integration.jobs[jobName].if).toBe('${{ github.event.pull_request.draft == false }}');
        }
    });

    it('keeps legacy workflows callable or manual without duplicate PR triggers', () => {
        for (const name of [
            'ci.yml',
            'regression-guards.yml',
            'mobile-build.yml',
            'preview-smoke.yml',
            'deploy-preview.yml',
            'app-github-pages.yml'
        ]) {
            expect(workflow(name), name).not.toContain('\n  pull_request:');
        }
        for (const name of [
            'regression-guards.yml',
            'mobile-build.yml',
            'preview-smoke.yml',
            'deploy-preview.yml'
        ]) {
            expect(workflow(name), name).toContain('workflow_call:');
        }
    });

    it('does not expose repository secrets to PR-controlled reusable workflows', () => {
        const integration = workflow('pr-integration.yml');

        expect(integration).not.toContain('secrets: inherit');
    });

    it('keeps credentialed preview work off the required PR path', () => {
        const integration = workflow('pr-integration.yml');
        const preview = workflow('pr-preview.yml');
        const agentGuidance = fs.readFileSync(path.join(repoRoot, 'AGENTS.md'), 'utf8');

        expect(integration).not.toContain('uses: ./.github/workflows/deploy-preview.yml');
        expect(preview).toContain('workflow_dispatch:');
        expect(preview).toContain('run-name: PR preview #${{ inputs.pr_number }} @ ${{ inputs.head_sha }}');
        expect(preview).toContain('uses: ./.github/workflows/deploy-preview.yml');
        expect(agentGuidance).toContain('Normal PR pushes\n  and labels must not deploy Firebase preview channels.');
    });

    it('reuses version-bound Playwright browsers in the regression workflow', () => {
        const regression = workflow('regression-guards.yml');
        const parsed = parseYaml(regression);

        expect(parsed.jobs['roster-chat-media-replay-smoke'].steps).toBeTruthy();
        expect(regression).toContain('name: Resolve Playwright version');
        expect(regression).toContain(
            'uses: actions/cache@0057852bfaa89a56745cba8c7296529d2fc39830 # v4'
        );
        expect(regression).toContain('path: ~/.cache/ms-playwright');
        expect(regression).toContain(
            'key: ${{ runner.os }}-playwright-${{ steps.pw-version.outputs.version }}'
        );
        expect(regression).toContain(
            'if [ "${{ steps.pw-cache.outputs.cache-hit }}" = "true" ]; then'
        );
        expect(regression).toContain('npx playwright install-deps chromium');
        expect(regression).toContain('npx playwright install --with-deps chromium');
        expect(regression).not.toContain('restore-keys:');
    });

    it.each([
        ['mobile-build', { MOBILE_RESULT: 'cancelled' }],
        ['preview-smoke', {
            PREVIEW_RESULT: 'success',
            REGRESSION_RESULT: 'cancelled'
        }],
        ['preview-smoke', {
            PREVIEW_RESULT: 'cancelled',
            REGRESSION_RESULT: 'success'
        }]
    ])('runs %s after cancellation and rejects cancelled upstream results', (jobName, env) => {
        const integration = parseYaml(workflow('pr-integration.yml'));
        const job = integration.jobs[jobName];
        const result = spawnSync('bash', ['-c', job.steps[0].run], {
            env: {
                ...process.env,
                GITHUB_REPOSITORY: 'allplays/allplays',
                ...env
            }
        });

        expect(job.if).toBe('${{ always() && github.event.pull_request.draft == false }}');
        expect(result.status).toBe(1);
    });

    it('binds trusted preview deployment to the consolidated source run', () => {
        const trusted = workflow('deploy-preview-trusted.yml');
        const verifier = fs.readFileSync(
            path.join(repoRoot, 'scripts', 'verify-preview-deploy-trigger.mjs'),
            'utf8'
        );

        expect(trusted).toContain('      - pr-preview');
        expect(verifier).toContain("PREVIEW_WORKFLOW_NAME = 'pr-preview'");
        expect(verifier).toContain("PREVIEW_WORKFLOW_PATH = '.github/workflows/pr-preview.yml'");
    });
});
