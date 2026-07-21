import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import smokeConfig from '../../playwright.smoke.config.js';

const repoRoot = path.resolve(import.meta.dirname, '../..');
const readRepoFile = (file) => readFileSync(path.join(repoRoot, file), 'utf8');

describe('visual regression CI wiring', () => {
    it('retries only the tracked auth visual in CI', () => {
        const quarantine = smokeConfig.projects.find(
            ({ name }) => name === 'auth-profile-visual-quarantine'
        );
        const remainingSmoke = smokeConfig.projects.find(({ name }) => name === 'smoke');

        expect(smokeConfig.retries).toBe(0);
        expect(quarantine).toMatchObject({
            testMatch: ['**/app-auth-profile.spec.js'],
            retries: process.env.CI ? 1 : 0
        });
        expect(quarantine.grep.source).toBe(
            '@visual app auth screen exposes sign in, sign up, Google, activation code, invite, and reset flows'
        );
        expect(quarantine.grep).toEqual(remainingSmoke.grepInvert);
        expect(remainingSmoke.retries).toBe(0);
        expect(readRepoFile('playwright.smoke.config.js')).toContain('tracked by #4100');
    });

    it('runs visual checks explicitly after non-visual preview smoke and retains failure diffs', () => {
        const workflow = readRepoFile('.github/workflows/preview-smoke.yml');

        expect(workflow).toContain('playwright test --config=playwright.smoke.config.js --grep-invert @visual');
        expect(workflow).toContain('npm run test:smoke:visual -- --reporter=line');
        expect(workflow).toContain('name: preview-visual-regression-diffs');
        expect(workflow).toContain('path: test-results/');
    });

    it('pins deterministic rendering and platform-neutral snapshot paths', () => {
        const config = readRepoFile('playwright.smoke.config.js');
        const helper = readRepoFile('tests/smoke/helpers/visual-regression.js');
        const authVisual = readRepoFile('tests/smoke/app-auth-profile.spec.js');
        const discoverVisual = readRepoFile('tests/smoke/app-discover.spec.js');
        const messagesVisual = readRepoFile('tests/smoke/app-messages.spec.js');
        const scheduleVisual = readRepoFile('tests/smoke/app-schedule.spec.js');

        expect(config).toContain("snapshotPathTemplate: '{testDir}/{testFilePath}-snapshots/{arg}{ext}'");
        expect(config).toContain('maxDiffPixels: 0');
        expect(config).not.toContain('maxDiffPixelRatio');
        expect(config).toContain("timezoneId: 'UTC'");
        expect(config).toContain('deviceScaleFactor: 1');
        expect(helper).toContain("visualFixtureTime = '2026-07-18T12:00:00.000Z'");
        expect(helper).toContain('page.clock.setFixedTime');
        expect(helper).toContain("await route.abort('blockedbyclient')");
        expect(helper).toContain("require.resolve('@fontsource-variable/inter/files/inter-latin-wght-normal.woff2')");
        expect(helper).toContain('#root, #root button, #root input, #root select, #root textarea');
        expect(helper).toContain('document.fonts.load(`${weight} 16px AllPlaysVisualInter`)');
        for (const [source, snapshot] of [
            [authVisual, 'auth-join-code-signup.png'],
            [discoverVisual, 'discover-opportunities.png'],
            [messagesVisual, 'messages-inbox-mobile.png'],
            [scheduleVisual, 'family-schedule.png']
        ]) {
            expect(source).toContain(
                `'${snapshot}', {\n        maxDiffPixels: undefined,\n        maxDiffPixelRatio: 0.01\n    }`
            );
        }
    });

    it('checks the legacy Tailwind fixture only in the dependency-bearing visual command', () => {
        const packageJson = JSON.parse(readRepoFile('package.json'));
        const generator = readRepoFile('scripts/build-legacy-visual-css.mjs');
        const fixture = readRepoFile('tests/fixtures/legacy-login-tailwind.css');

        expect(packageJson.scripts['test:smoke:visual']).toContain('npm run test:smoke:visual:assets');
        expect(packageJson.scripts['test:smoke:visual:assets']).toBe(
            'node scripts/build-legacy-visual-css.mjs --check'
        );
        expect(generator).toContain("'tests', 'fixtures', 'legacy-login-tailwind.css'");
        expect(generator).toContain("process.argv.includes('--check')");
        expect(fixture).toMatch(/^\/\*! tailwindcss v\d/);
        expect(fixture).toContain('.bg-indigo-600');
    });

    it('uploads the generated legacy fixture with Linux baseline PNGs', () => {
        const workflow = readRepoFile('.github/workflows/update-visual-baselines.yml');

        expect(workflow).toContain('tests/smoke/**/*.spec.js-snapshots/*.png');
        expect(workflow).toContain('tests/fixtures/legacy-login-tailwind.css');
    });
});
