import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(import.meta.dirname, '../..');
const readRepoFile = (file) => readFileSync(path.join(repoRoot, file), 'utf8');

describe('candidate-host authenticated smoke coverage', () => {
    it('targets the candidate origin with protected CI credentials', () => {
        const workflow = readRepoFile('.github/workflows/post-deploy-smoke.yml');
        const spec = readRepoFile('tests/smoke/candidate-host-auth.spec.js');

        expect(workflow).toContain('npx playwright test tests/smoke/candidate-host-auth.spec.js');
        expect(workflow).toContain('CANDIDATE_HOST_URL: https://game-flow-c6311.web.app');
        expect(workflow).toContain('SMOKE_STAFF_EMAIL: ${{ secrets.SMOKE_STAFF_EMAIL }}');
        expect(workflow).toContain('SMOKE_STAFF_PASSWORD: ${{ secrets.SMOKE_STAFF_PASSWORD }}');
        expect(workflow).toContain('SMOKE_AUTH_EMAIL: ${{ secrets.SMOKE_AUTH_EMAIL }}');
        expect(workflow).toContain('SMOKE_AUTH_PASSWORD: ${{ secrets.SMOKE_AUTH_PASSWORD }}');
        expect(spec).toContain("process.env.CANDIDATE_HOST_URL");
        expect(spec).toContain('Candidate authentication failed at ${new URL(candidateHostUrl).origin}');
        expect(spec).toContain('Candidate post-login assertion failed at ${candidateHostUrl}');
        expect(spec).toContain("expect(authEmail, 'SMOKE_STAFF_EMAIL or SMOKE_AUTH_EMAIL is required for candidate-host auth smoke').toBeTruthy()");
        expect(spec).toContain("expect(authPassword, 'SMOKE_STAFF_PASSWORD or SMOKE_AUTH_PASSWORD is required for candidate-host auth smoke').toBeTruthy()");
        expect(spec).toContain("getByLabel('Password', { exact: true })");
        expect(spec).not.toContain('test.skip(!hasCredentials');
        expect(spec).toContain('landingUrl.origin');
        expect(spec).toContain('toBe(new URL(candidateHostUrl).origin)');
        expect(spec).toContain('landingUrl.pathname');
        expect(spec).toContain('Candidate post-login assertion failed at ${candidateHostUrl}: unexpected route');
        expect(spec).toContain("toBe('/app/')");
        expect(spec).toContain("expect(landingUrl.hash).not.toMatch(/^#\\/auth");
        expect(spec).toContain("testInfo.outputPath('candidate-auth-diagnostic.json')");
        expect(spec).toContain('redactDiagnosticText');
        expect(spec).toContain('test.setTimeout(90_000)');
        expect(spec).toContain("toBeVisible({ timeout: 30_000 })");
        expect(spec).not.toContain('page.screenshot');

        const diagnosticUpload = workflow.indexOf('Upload redacted candidate authentication diagnostic');
        const baseline = workflow.indexOf('Run production smoke baseline');
        expect(diagnosticUpload).toBeGreaterThan(-1);
        expect(diagnosticUpload).toBeLessThan(baseline);
    });

    it('does not enable App Check enforcement for candidate authentication', () => {
        const workflow = readRepoFile('.github/workflows/post-deploy-smoke.yml');

        expect(workflow).not.toContain('ALLPLAYS_APP_CHECK_ENFORCEMENT_READY');
        expect(workflow).not.toContain('APP_CHECK_ENFORCEMENT_READY');
    });

    it('runs all production probes independently and aggregates their outcomes', () => {
        const workflow = readRepoFile('.github/workflows/post-deploy-smoke.yml');

        expect(workflow).toContain('id: firebase_public');
        expect(workflow).toContain('id: firebase_auth');
        expect(workflow).toContain('id: core_config');
        expect(workflow).toContain('id: canonical_prod');
        expect(workflow).toContain('id: canonical_core');
        expect(workflow.match(/continue-on-error: true/g)).toHaveLength(4);
        expect(workflow).toContain('if: always()');
        expect(workflow).toContain('steps.firebase_public.outcome');
        expect(workflow).toContain('steps.firebase_auth.outcome');
        expect(workflow).toContain('steps.canonical_prod.outcome');
        expect(workflow).toContain("if: steps.core_config.outputs.enabled == 'true'");
        expect(workflow).toContain('Fixture-backed production smoke not configured');
        expect(workflow).toContain('steps.canonical_core.outcome');
        expect(workflow).toContain('The configured fixture-backed production smoke failed.');
        expect(workflow).toContain('test-results/**/candidate-auth-diagnostic.json');
        expect(workflow).toContain('One or more independent post-deploy signals failed.');
        expect(workflow).toContain('timeout-minutes: 30');
    });

    it('uses exact password labels everywhere the app auth form is automated', () => {
        for (const file of [
            'tests/smoke/candidate-host-auth.spec.js',
            'tests/smoke/helpers/app-auth.js',
            'tests/smoke/app-parent-live.spec.js'
        ]) {
            const source = readRepoFile(file);
            expect(source).not.toMatch(/getByLabel\(['"]Password['"]\)(?!\s*,)/);
            expect(source).toContain("getByLabel('Password', { exact: true })");
        }
    });

    it('keeps the public baseline credential-free while dedicated probes own authentication', () => {
        const workflow = readRepoFile('.github/workflows/post-deploy-smoke.yml');
        const baseline = readRepoFile('tests/smoke/static-hosting-bootstrap.spec.js');
        const legacyAuthenticatedCore = readRepoFile('tests/smoke/legacy-authenticated-core.spec.js');
        const registry = readRepoFile('tests/smoke/page-registry.js');

        expect(baseline).not.toContain('loginWithPassword');
        expect(baseline).not.toContain('getAuthenticatedSmokePages');
        expect(baseline).not.toContain("getByLabel('Email')");
        expect(registry).not.toContain('getAuthenticatedSmokePages');
        expect(registry).not.toContain('authEmail');
        expect(registry).not.toContain('authPassword');
        expect(workflow).toContain('npx playwright test tests/smoke/candidate-host-auth.spec.js');
        expect(workflow).toContain('tests/smoke/app-admin-core.spec.js');
        expect(workflow).toContain('tests/smoke/app-authenticated-core.spec.js');
        expect(workflow).toContain('tests/smoke/legacy-authenticated-core.spec.js');
        expect(workflow).toMatch(
            /tests\/smoke\/legacy-authenticated-core\.spec\.js[\s\S]*?env:\s+SMOKE_BASE_URL: https:\/\/allplays\.ai/
        );
        expect(legacyAuthenticatedCore).toContain('getLegacyAuthenticatedSmokePages');
        for (const route of ['edit-schedule.html', 'team-chat.html', 'certificates.html']) {
            expect(registry).toContain(route);
        }
    });
});
