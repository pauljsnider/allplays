import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';

const workflowPath = '.github/workflows/mobile-release.yml';
const workflowSource = readFileSync(resolve(process.cwd(), workflowPath), 'utf8');
const workflow = parseYaml(workflowSource);

describe('mobile release workflow', () => {
    it('allows one-platform recovery without changing approval or upload defaults', () => {
        expect(workflow.on.workflow_dispatch.inputs.platform).toMatchObject({
            type: 'choice', default: 'both', options: ['both', 'android', 'ios']
        });
        expect(workflow.jobs['android-release'].if).toBe("inputs.platform == 'both' || inputs.platform == 'android'");
        expect(workflow.jobs['ios-release'].if).toBe("inputs.platform == 'both' || inputs.platform == 'ios'");
        for (const platform of ['android', 'ios']) {
            expect(workflow.jobs[`${platform}-release`].environment).toBe('mobile-release');
            expect(workflow.on.workflow_dispatch.inputs[`upload_${platform}`].default).toBe(false);
        }
        expect(workflow.on.workflow_dispatch.inputs.sync_android_listing.default).toBe(false);
        expect(workflow.jobs['play-listing'].needs).toBe('android-release');
    });

    it('installs supported Android packages without the retired tools package', () => {
        const setup = workflow.jobs['android-release'].steps.find(
            (step) => step.uses?.startsWith('android-actions/setup-android@')
        );
        expect(setup.with?.packages).toBe('platform-tools');
    });

    it('builds App Store archives with an iOS 26 SDK toolchain', () => {
        const iosRelease = workflow.jobs['ios-release'];
        const toolchainStep = iosRelease.steps.find(
            (step) => step.name === 'Validate App Store Xcode toolchain'
        );

        expect(iosRelease['runs-on']).toBe('macos-15');
        expect(iosRelease.env.DEVELOPER_DIR).toBe(
            '/Applications/Xcode_26.3.app/Contents/Developer'
        );
        expect(toolchainStep.run).toContain('xcodebuild -version');
        expect(toolchainStep.run).toContain('xcrun --sdk iphoneos --show-sdk-version');
        expect(toolchainStep.run).toContain('[[ "$SDK_VERSION" == 26.* ]]');
    });

    it('keeps TestFlight upload manual and the workflow token read-only', () => {
        expect(workflow.on).toHaveProperty('workflow_dispatch');
        expect(workflow.permissions).toEqual({ contents: 'read' });
        expect(workflow.jobs['ios-release'].steps).toContainEqual(
            expect.objectContaining({
                name: 'Upload to TestFlight',
                if: 'inputs.upload_ios'
            })
        );
        expect(workflowSource).not.toContain('pull_request_target:');
        expect(workflowSource).not.toContain('permissions: write-all');
    });

    it('verifies the signed Android release in an emulator before uploading it', () => {
        const androidSteps = workflow.jobs['android-release'].steps;
        const buildStep = androidSteps.find((step) => step.name === 'Build signed Android release artifacts');
        const artifactStep = androidSteps.find((step) => step.name === 'Upload signed Android artifacts');
        const startStep = androidSteps.find((step) => step.name === 'Start Android release emulator');
        const verifyIndex = androidSteps.findIndex((step) => step.name === 'Verify signed release APK in emulator');
        const uploadIndex = androidSteps.findIndex((step) => step.name === 'Upload to Play internal testing');

        expect(buildStep.run).toContain(':app:bundleRelease :app:assembleRelease');
        expect(buildStep.env.ALLPLAYS_ANDROID_VERSION_CODE).toContain('inputs.android_version_code');
        expect(artifactStep.with.path).toContain('app-release.aab');
        expect(artifactStep.with.path).toContain('app-release.apk');
        expect(startStep.run).toContain('"$ANDROID_SDK_ROOT/emulator/emulator"');
        expect(startStep.run).toContain('export ANDROID_AVD_HOME="$RUNNER_TEMP/android-avd"');
        expect(startStep.run).toContain('--device "pixel_2"');
        expect(startStep.run).toContain('test -f "$ANDROID_AVD_HOME/allplays-release.ini"');
        expect(startStep.run).not.toContain('adb wait-for-device');
        expect(startStep.run).toContain('kill -0 "$emulator_pid"');
        expect(startStep.run).toContain('boot_deadline=$((SECONDS + 180))');
        expect(androidSteps[verifyIndex].run).toContain(':app:connectedReleaseAndroidTest');
        expect(verifyIndex).toBeGreaterThan(-1);
        expect(uploadIndex).toBeGreaterThan(verifyIndex);
        expect(androidSteps[uploadIndex].if).toBe('inputs.upload_android');
    });
});
