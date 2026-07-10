import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = process.cwd();
const appRoot = path.join(repoRoot, 'apps/app');
const appPackageJson = JSON.parse(readFileSync(path.join(appRoot, 'package.json'), 'utf8'));

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
    it('uses the Tailwind 4 PostCSS plugin package', async () => {
        const postcssConfig = await import(path.join(appRoot, 'postcss.config.js'));

        expect(appPackageJson.devDependencies).toMatchObject({
            '@tailwindcss/postcss': '^4.3.2',
            tailwindcss: '^4.3.2'
        });
        expect(postcssConfig.default.plugins).toHaveProperty('@tailwindcss/postcss');
        expect(postcssConfig.default.plugins).not.toHaveProperty('tailwindcss');
    });

    it('compiles Tailwind utilities and mobile shell CSS through Vite PostCSS', () => {
        const css = buildAppCss();

        expect(css).toContain('.bg-primary-600');
        expect(css).toContain('.bg-primary-50');
        expect(css).toContain('.text-gray-950');
        expect(css).toContain('.rounded-xl');
        expect(css).not.toContain('@tailwind');
        expect(css).toContain('-webkit-backdrop-filter:none');
        expect(css).toContain('backdrop-filter:none');
        expect(css).toContain('.safe-top');
        expect(css).toContain('env(safe-area-inset-top)');
        expect(css).toContain('.safe-bottom');
        expect(css).toContain('env(safe-area-inset-bottom)');
        expect(css).toContain('.app-search-overlay');
        expect(css).toContain('--app-search-keyboard-inset');
        expect(css).toContain('.fixed');
        expect(css).toContain('.inset-0');
        expect(css).toContain('.inset-x-0');
        expect(css).toContain('.top-0');
        expect(css).toContain('.bottom-0');
    }, 120000);
});
