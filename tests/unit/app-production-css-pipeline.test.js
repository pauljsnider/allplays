import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = process.cwd();
const appRoot = path.join(repoRoot, 'apps/app');

function buildAppCss() {
    const outDir = mkdtempSync(path.join(tmpdir(), 'allplays-app-css-'));

    try {
        execFileSync(
            path.join(appRoot, 'node_modules/.bin/vite'),
            ['build', '--outDir', outDir, '--emptyOutDir'],
            {
                cwd: appRoot,
                encoding: 'utf8',
                stdio: 'pipe'
            }
        );

        const assetsDir = path.join(outDir, 'assets');
        const cssAsset = readdirSync(assetsDir).find((file) => file.endsWith('.css'));

        expect(cssAsset).toBeTruthy();

        return readFileSync(path.join(assetsDir, cssAsset), 'utf8');
    } finally {
        rmSync(outDir, { recursive: true, force: true });
    }
}

describe('app production CSS pipeline', () => {
    it('compiles Tailwind utilities and mobile shell CSS through Vite PostCSS', () => {
        const css = buildAppCss();

        expect(css).toContain('.bg-primary-600');
        expect(css).not.toContain('@tailwind');
        expect(css).toContain('.safe-top');
        expect(css).toContain('env(safe-area-inset-top)');
        expect(css).toContain('.safe-bottom');
        expect(css).toContain('env(safe-area-inset-bottom)');
        expect(css).toContain('.app-search-overlay');
        expect(css).toContain('--app-search-keyboard-inset');
    }, 30000);
});
