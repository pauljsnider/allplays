import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(import.meta.dirname, '../..');
const readRepoFile = (file) => readFileSync(path.join(repoRoot, file), 'utf8');

describe('visual regression CI wiring', () => {
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

        expect(config).toContain("snapshotPathTemplate: '{testDir}/{testFilePath}-snapshots/{arg}{ext}'");
        expect(config).toContain('maxDiffPixelRatio: 0.001');
        expect(config).toContain("timezoneId: 'UTC'");
        expect(config).toContain('deviceScaleFactor: 1');
        expect(helper).toContain("visualFixtureTime = '2026-07-18T12:00:00.000Z'");
        expect(helper).toContain('page.clock.setFixedTime');
        expect(helper).toContain("await route.abort('blockedbyclient')");
    });

    it('keeps the committed legacy Tailwind fixture synchronized with login.html', () => {
        execFileSync(process.execPath, ['scripts/build-legacy-visual-css.mjs', '--check'], {
            cwd: repoRoot,
            stdio: 'pipe'
        });
    });
});
