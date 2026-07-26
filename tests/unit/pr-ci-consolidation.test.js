import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

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

    it('binds trusted preview deployment to the consolidated source run', () => {
        const trusted = workflow('deploy-preview-trusted.yml');
        const verifier = fs.readFileSync(
            path.join(repoRoot, 'scripts', 'verify-preview-deploy-trigger.mjs'),
            'utf8'
        );

        expect(trusted).toContain('      - pr-integration');
        expect(verifier).toContain("PREVIEW_WORKFLOW_NAME = 'pr-integration'");
        expect(verifier).toContain("PREVIEW_WORKFLOW_PATH = '.github/workflows/pr-integration.yml'");
    });
});
