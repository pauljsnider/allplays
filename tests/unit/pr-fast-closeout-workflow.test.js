import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
const preview = read('.github/workflows/preview-smoke.yml');
const mobile = read('.github/workflows/mobile-build.yml');
const agents = read('AGENTS.md');

function actionReferences(workflow) {
    return [...workflow.matchAll(/^\s*uses:\s+([^\s#]+)/gm)].map((match) => match[1]);
}

describe('fast PR closeout workflow contracts', () => {
    it('pins every action used by the touched required-check workflows', () => {
        for (const workflow of [preview, mobile]) {
            for (const action of actionReferences(workflow)) {
                expect(action, `${action} should use an immutable action revision`)
                    .toMatch(/@[0-9a-f]{40}$/);
            }
            expect(workflow).toContain('persist-credentials: false');
        }
    });

    it('keeps destructive native dependency resets behind a failed first attempt', () => {
        const androidBuild = mobile.slice(
            mobile.indexOf('- name: Build Android debug APK'),
            mobile.indexOf('- name: Upload Android debug APK')
        );
        expect(androidBuild.indexOf('if ./gradlew :app:assembleDebug --stacktrace'))
            .toBeLessThan(androidBuild.lastIndexOf('reset_gradle_dependency_cache'));

        const iosResolve = mobile.slice(
            mobile.indexOf('- name: Resolve iOS package dependencies'),
            mobile.indexOf('- name: Build iOS simulator app')
        );
        expect(iosResolve.indexOf('until "$@"'))
            .toBeLessThan(iosResolve.lastIndexOf('reset_swiftpm_package_state'));
    });

    it('publishes timing summaries for the slow required-check jobs', () => {
        expect(preview).toContain('### preview-smoke timing');
        expect(preview).toContain('Playwright browser cache hit:');
        expect(mobile).toContain('Android build duration:');
        expect(mobile).toContain('iOS build duration:');
    });

    it('defines ready-for-review as an exact-head producer handoff', () => {
        expect(agents).toContain('Treat “ready for review” as the controller handoff event.');
        expect(agents).toContain('Landing latency starts at the');
        expect(agents).toContain('latest ready exact head');
    });
});
