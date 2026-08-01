import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';

const workflowPath = '.github/workflows/mobile-release.yml';
const workflowSource = readFileSync(resolve(process.cwd(), workflowPath), 'utf8');
const workflow = parseYaml(workflowSource);

describe('mobile release workflow', () => {
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
});
