import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';

const workflow = readFileSync(new URL('../../.github/workflows/mobile-build.yml', import.meta.url), 'utf8');
const integrationWorkflow = readFileSync(
    new URL('../../.github/workflows/pr-integration.yml', import.meta.url),
    'utf8'
);

describe('mobile-build CI workflow', () => {
    it('is reusable without opening a duplicate pull-request run', () => {
        const triggerSection = workflow.slice(workflow.indexOf('\non:'), workflow.indexOf('\nconcurrency:'));
        expect(triggerSection).not.toContain('paths:');
        expect(triggerSection).toContain('workflow_call:');
        expect(triggerSection).toContain('workflow_dispatch:');
        expect(triggerSection).not.toContain('pull_request:');
        expect(triggerSection).not.toContain('push:');
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

    it('is called by the consolidated code-head workflow without label-churn runs', () => {
        const triggerSection = integrationWorkflow.slice(
            integrationWorkflow.indexOf('\non:'),
            integrationWorkflow.indexOf('\npermissions:')
        );
        const changesSection = workflow.slice(workflow.indexOf('  changes:'), workflow.indexOf('  android-debug:'));
        const gateSection = workflow.slice(workflow.indexOf('  mobile-build:'));

        expect(triggerSection).toContain('      - synchronize');
        expect(triggerSection).not.toContain('      - unlabeled');
        expect(triggerSection).not.toContain('      - labeled');
        expect(integrationWorkflow).toContain('uses: ./.github/workflows/mobile-build.yml');
        expect(integrationWorkflow).toContain('name: mobile-build');
        expect(workflow).toContain('group: mobile-build-${{ github.workflow }}-${{ github.ref }}');
        expect(changesSection).not.toContain('external-claim');
        expect(changesSection).not.toContain('LABEL_NAME');
        expect(gateSection).toContain('name: mobile-build');
        expect(gateSection).not.toContain('label-noop');
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
        expect(gateSection).toContain('if: ${{ always() && !cancelled() }}');
    });

    it('does not turn an intentional concurrency cancellation into a required-check failure', () => {
        const gateSection = workflow.slice(workflow.indexOf('  mobile-build:'));

        expect(gateSection).toContain('always()');
        expect(gateSection).toContain('!cancelled()');
    });

    it('fails the required gate job when a mobile-relevant PR actually breaks native builds', () => {
        const gateSection = workflow.slice(workflow.indexOf('  mobile-build:'));
        const gateRun = gateSection.slice(gateSection.indexOf('        run: |'));
        expect(gateSection).toContain('ANDROID_RESULT: ${{ needs.android-debug.result }}');
        expect(gateSection).toContain('IOS_RESULT: ${{ needs.ios-simulator.result }}');
        expect(gateSection).toContain('"$ANDROID_RESULT" != "success"');
        expect(gateSection).toContain('"$IOS_RESULT" != "success"');
        expect(gateRun).not.toContain('${{ needs.');
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
        expect(gateSection).toContain('CHANGES_RESULT: ${{ needs.changes.result }}');
        expect(gateSection).toContain('SHOULD_BUILD_MOBILE: ${{ needs.changes.outputs.mobile }}');

        const changesResultCheckIndex = gateSection.indexOf('"$CHANGES_RESULT" != "success"');
        const mobileOutputCheckIndex = gateSection.indexOf('"$SHOULD_BUILD_MOBILE" != "true"');

        expect(changesResultCheckIndex).toBeGreaterThan(-1);
        expect(mobileOutputCheckIndex).toBeGreaterThan(-1);
        expect(changesResultCheckIndex).toBeLessThan(mobileOutputCheckIndex);
    });

    it('pins third-party actions to immutable commit SHAs', () => {
        const actionReferences = [...workflow.matchAll(/uses:\s+([^@\s]+)@([^\s#]+)/g)];
        const thirdPartyReferences = actionReferences.filter(
            ([, action]) => !action.startsWith('actions/') && !action.startsWith('github/')
        );

        expect(thirdPartyReferences.length).toBeGreaterThan(0);
        for (const [, action, ref] of thirdPartyReferences) {
            expect(ref, action).toMatch(/^[0-9a-f]{40}$/);
        }
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
