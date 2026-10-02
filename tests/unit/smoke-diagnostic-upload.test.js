import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
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
            expect(upload.with.path).toBe('test-results/**/app-route-diagnostic.json');
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

});
