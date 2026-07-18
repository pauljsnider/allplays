import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';

const workflow = readFileSync(new URL('../../.github/workflows/mobile-build.yml', import.meta.url), 'utf8');

describe('mobile-build CI workflow', () => {
    it('always triggers on every pull request and master push (no path filter that could skip the required check)', () => {
        // A `paths:` filter directly under `pull_request:`/`push:` would mean the
        // workflow — and therefore the `mobile-build` required status check —
        // never runs for PRs that don't touch those paths, permanently blocking
        // merge (GitHub required checks that never post a status block forever).
        const triggerSection = workflow.slice(workflow.indexOf('\non:'), workflow.indexOf('\nconcurrency:'));
        expect(triggerSection).not.toContain('paths:');
        expect(triggerSection).toContain('pull_request:');
        expect(triggerSection).toContain('push:');
        expect(triggerSection).toContain('workflow_dispatch:');
    });

    it('gates the expensive android/ios build jobs on a path-detection job instead of removing path awareness entirely', () => {
        expect(workflow).toContain('changes:');
        expect(workflow).toContain("outputs.mobile");
        expect(workflow).toContain('android-debug/');
        // The mobile-relevant path list moved from the trigger filter into the
        // changes-detection job body.
        expect(workflow).toContain('apps/app/');
        expect(workflow).toContain('android/');
        expect(workflow).toContain('ios/');
        expect(workflow).toContain('capacitor\\.config\\.json');
    });

    it('skips the native builds themselves for non-mobile changes but always runs the required mobile-build gate job', () => {
        const androidStart = workflow.indexOf('  android-debug:');
        const androidSection = workflow.slice(androidStart, workflow.indexOf('  ios-simulator:'));
        expect(androidSection).toContain('needs: changes');
        expect(androidSection).toContain("if: needs.changes.outputs.mobile == 'true'");

        const iosStart = workflow.indexOf('  ios-simulator:');
        const iosSection = workflow.slice(iosStart, workflow.indexOf('  mobile-build:'));
        expect(iosSection).toContain('needs: changes');
        expect(iosSection).toContain("if: needs.changes.outputs.mobile == 'true'");

        const gateSection = workflow.slice(workflow.indexOf('  mobile-build:'));
        expect(gateSection).toContain('needs: [changes, android-debug, ios-simulator]');
        expect(gateSection).toContain('if: always()');
    });

    it('fails the required gate job when a mobile-relevant PR actually breaks native builds', () => {
        const gateSection = workflow.slice(workflow.indexOf('  mobile-build:'));
        expect(gateSection).toContain("needs.android-debug.result }}\" != \"success\"");
        expect(gateSection).toContain("needs.ios-simulator.result }}\" != \"success\"");
        expect(gateSection).toContain('exit 1');
    });

    it('fails closed instead of silently skipping when the changes-detection job itself does not succeed', () => {
        // Codex caught this: the gate job uses `if: always()`, so it also runs
        // when `changes` fails (e.g. a checkout/diff error). In that case
        // needs.changes.outputs.mobile is empty — not "true" — so without this
        // check the gate would take the "no mobile changes" skip path and report
        // success even though neither native build ran, exactly the gap this job
        // exists to close.
        const gateSection = workflow.slice(workflow.indexOf('  mobile-build:'));
        const changesResultCheckIndex = gateSection.indexOf('needs.changes.result }}\" != \"success\"');
        const mobileOutputCheckIndex = gateSection.indexOf('needs.changes.outputs.mobile }}\" != \"true\"');

        expect(changesResultCheckIndex).toBeGreaterThan(-1);
        expect(mobileOutputCheckIndex).toBeGreaterThan(-1);
        expect(changesResultCheckIndex).toBeLessThan(mobileOutputCheckIndex);
    });

    it('keeps every CI and release workflow on production App Check assets', () => {
        const workflowDirectory = new URL('../../.github/workflows/', import.meta.url);
        for (const filename of readdirSync(workflowDirectory)) {
            const source = readFileSync(new URL(filename, workflowDirectory), 'utf8');
            expect(source, filename).not.toContain('native-debug');
            expect(source, filename).not.toContain('ALLPLAYS_APP_CHECK_NATIVE_DEBUG');
        }

        expect(workflow).toContain('run: npm run app:build');
        expect(workflow).not.toContain('run: npm run mobile:build:ios');
        expect(workflow).not.toContain('run: npm run mobile:build:android');
    });
});
