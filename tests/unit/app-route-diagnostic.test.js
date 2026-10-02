import { EventEmitter } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { routeTimings, withAppFailureDiagnostic } from '../smoke/helpers/app-route-diagnostic.js';

const read = (file) => readFileSync(file, 'utf8');

describe('authenticated smoke failure diagnostics', () => {
    it('redacts arbitrary values and routes even when the page is closed, preserving the original failure', async () => {
        const folder = await mkdtemp(path.join(os.tmpdir(), 'app-route-test-'));
        const page = new EventEmitter();
        const missing = { isVisible: async () => { throw Error('closed'); }, first() { return this; } };
        page.locator = page.getByText = page.getByRole = () => missing;
        page.url = () => 'https://secret@example.com/app/#/teams/private-person/fees?token=short';
        const failure = Error('do not serialize me');
        try {
            const result = await withAppFailureDiagnostic({ page }, { retry: 1, outputPath: (name) => path.join(folder, name) }, async () => {
                routeTimings.set(page, { startedAt: Date.now(), url: page.url() });
                for (const url of ['https://user:short@host/js/firebase-auth.js?apiKey=short', 'https://user:short@host/js/vendor/firebase-auth.js?token=short#secret', 'https://host/js/vendor/private-person.js', 'https://host/js/vendor/firebase-auth.js/private-person', 'https://host/private-person/secret.js', 'https://host/app/assets/FeesTool-12345678.js?token=short']) {
                    page.emit('requestfailed', { resourceType: () => 'script', url: () => url, failure: () => ({ errorText: 'ERR_CONNECTION_CLOSED token=short person@example.com' }) });
                }
                page.emit('pageerror', Error('Name: Private Person, bearer short, person@example.com'));
                throw failure;
            }).catch((error) => error);
            expect(result).toBe(failure);
            const text = await readFile(path.join(folder, 'app-route-diagnostic.json'), 'utf8');
            expect(text).not.toMatch(/short|secret|private-person|Private Person|example|do not serialize/);
            const resultData = JSON.parse(text);
            expect(resultData).toMatchObject({ retry: 1, route: '/teams/:id/fees', state: { feesLoading: null }, navigation: { route: '/teams/:id/fees' } });
            expect(resultData.events.map((event) => event.asset)).toEqual(['/js/firebase-auth.js', '/js/vendor/firebase-auth.js', '[other-asset]', '[other-asset]', '[other-asset]', '/app/assets/FeesTool-[hash].js', undefined]);
            expect(page.eventNames()).toEqual([]);
        } finally { await rm(folder, { recursive: true, force: true }); }
    });

    it('keeps runtime, seeded-content, role and strict flaky gates wired', () => {
        const source = read('tests/smoke/app-authenticated-core.spec.js');
        expect(source).toContain('await withAppFailureDiagnostic(session, test.info(), async () => {');
        expect(source).toContain('expect(issues.map((issue) => redactSmokeDiagnostic(issue, secretValues))).toEqual([])');
        expect(source).toContain("panelHeading: 'Team fees', seededFees: true");
        for (const assertion of ['Staff and parent smoke accounts must be distinct', 'Admin access required|Only team owners|access denied', "name: 'Sign out'"]) expect(source).toContain(assertion);
        const workflow = parse(read('.github/workflows/post-deploy-smoke.yml'));
        const steps = Object.values(workflow.jobs).flatMap((job) => job.steps || []);
        const core = steps.find((step) => step.id === 'canonical_core');
        expect(core.run).toContain('--retries=1');
        expect(core.run).toContain('--fail-on-flaky-tests');
        expect(steps.find((step) => step.name === 'Aggregate production smoke signals').if).toBe('always()');
    });
});
