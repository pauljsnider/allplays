import { readFileSync, globSync } from 'node:fs';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { EventEmitter } from 'node:events';
import os from 'node:os';
import path from 'node:path';
import { createAppFailureRecorder } from '../smoke/helpers/app-route-diagnostic.js';
import { describe, expect, it, vi } from 'vitest';
import { parse } from 'yaml';
const read = (file) => readFileSync(file, 'utf8');
describe('sanitized smoke artifact uploads', () => {
    it('keeps credentialed traces off and uploads only the safe diagnostic after failure', () => {
        const config = read('playwright.smoke.config.js');
        for (const artifact of ['trace', 'video', 'screenshot']) expect(config).toContain(`${artifact}: 'off'`);
        for (const name of ['post-deploy-smoke', 'scheduled-prod-smoke']) {
            const workflow = parse(read(`.github/workflows/${name}.yml`));
            const steps = Object.values(workflow.jobs).flatMap((job) => job.steps || []);
            const upload = steps.find((step) => step.name === 'Upload sanitized authenticated route diagnostics');
            expect(upload.if).toBe('always()');
            expect(upload['continue-on-error']).toBe(true);
            expect(upload.with.path.trim().split(/\r?\n/)).toEqual([
                'test-results/**/app-route-diagnostic.json',
                'test-results/**/app-route-diagnostic-session-0.json',
                'test-results/**/app-route-diagnostic-session-1.json'
            ]);
            expect(upload.with['retention-days']).toBe(7);
            expect(upload.uses).toBe('actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02');
            const baseline = steps.find((step) => step.name === 'Upload sanitized baseline boot diagnostics');
            expect(baseline.if).toBe('always()');
            expect(baseline['continue-on-error']).toBe(true);
            expect(baseline.uses).toBe(upload.uses);
            expect(baseline.with.path).toBe('test-results/**/boot-path-diagnostic.json');
            expect(baseline.with['retention-days']).toBe(7);
            if (name === 'post-deploy-smoke') {
                expect(steps.indexOf(baseline)).toBeGreaterThan(steps.findIndex((step) => step.id === 'canonical_prod'));
                expect(steps.indexOf(baseline)).toBeLessThan(steps.findIndex((step) => step.id === 'canonical_core'));
                expect(steps.indexOf(upload)).toBeGreaterThan(steps.findIndex((step) => step.id === 'canonical_core'));
                expect(steps.find((step) => step.name === 'Aggregate production smoke signals').if).toBe('always()');
            }
        }
    });

    it.each(['post-deploy-smoke', 'scheduled-prod-smoke'])('%s selects actual setup/peer artifacts and excludes private or unrelated files', async (name) => {
        const folder = await mkdtemp(path.join(os.tmpdir(), 'smoke-artifact-selection-'));
        const log = vi.spyOn(console, 'log').mockImplementation(() => {});
        const recorders = [];
        try {
            const expected = ['test-results/legacy/app-route-diagnostic.json'];
            await mkdir(path.join(folder, 'test-results/legacy'), { recursive: true });
            await writeFile(path.join(folder, expected[0]), '{}');
            for (const phase of ['setup-failure', 'staff-failure-idle-peer']) {
                for (const sessionIndex of [0, 1]) {
                    const page = new EventEmitter();
                    const locator = { isVisible: async () => false, first() { return this; } };
                    page.locator = page.getByText = page.getByRole = () => locator;
                    page.url = () => 'https://private-user:private-password@allplays.ai/app/?token=private-token#/auth';
                    const recorder = createAppFailureRecorder(page, { includeApiFailures: true, sessionIndex });
                    recorders.push(recorder);
                    const url = 'https://firestore.googleapis.com/private-document?token=private-token';
                    page.emit('response', { status: () => 403, url: () => url,
                        request: () => ({ resourceType: () => 'fetch', url: () => url }) });
                    await recorder.attach({ retry: 0, outputPath: (file) => path.join(folder, 'test-results', phase, file) });
                    expected.push(`test-results/${phase}/app-route-diagnostic-session-${sessionIndex}.json`);
                }
            }
            const excluded = [
                'test-results/setup-failure/app-route-diagnostic-session-2.json',
                'test-results/setup-failure/app-route-diagnostic-session-42.json',
                'test-results/setup-failure/app-route-diagnostic-session-private-user.json',
                'test-results/setup-failure/app-route-diagnostic-session-0.json.private',
                'test-results/setup-failure/app-route-diagnostic-private.json',
                'test-results/setup-failure/trace.zip', 'test-results/setup-failure/video.webm',
                'test-results/setup-failure/screenshot.png', 'test-results/setup-failure/storage-state.json',
                'test-results/setup-failure/request-headers.json', 'test-results/setup-failure/boot-path-diagnostic.json',
                'unrelated/app-route-diagnostic-session-0.json'
            ];
            for (const file of excluded) {
                await mkdir(path.dirname(path.join(folder, file)), { recursive: true });
                await writeFile(path.join(folder, file), 'PRIVATE_CREDENTIAL');
            }
            const workflow = parse(read(`.github/workflows/${name}.yml`));
            const upload = Object.values(workflow.jobs).flatMap((job) => job.steps || [])
                .find((step) => step.name === 'Upload sanitized authenticated route diagnostics');
            // Execute the patterns read from the workflow against real producer
            // files. No independent copy of the allowed filenames drives selection.
            const selected = [...new Set(globSync(upload.with.path.trim().split(/\r?\n/), { cwd: folder }))].sort();
            expect(selected).toEqual(expected.sort());
            for (const file of selected) {
                const contents = await readFile(path.join(folder, file), 'utf8');
                expect(contents).not.toMatch(/private|https:|googleapis|cookie|authorization|bearer|token=/i);
                if (file.includes('-session-')) {
                    expect(JSON.parse(contents).events).toMatchObject([{ status: 403, service: 'firestore', responseTimeRoute: '/auth' }]);
                }
            }
        } finally {
            for (const recorder of recorders) recorder.dispose();
            log.mockRestore();
            await rm(folder, { recursive: true, force: true });
        }
    });
});
