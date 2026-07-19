import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

const repoRoot = path.resolve(import.meta.dirname, '..');
const appModules = path.join(repoRoot, 'apps', 'app', 'node_modules');
const postcssModule = path.join(appModules, 'postcss', 'lib', 'postcss.mjs');
const tailwindModule = path.join(appModules, '@tailwindcss', 'postcss', 'dist', 'index.mjs');
const outputPath = path.join(repoRoot, 'tests', 'fixtures', 'legacy-login-tailwind.css');

async function loadBuildDependencies() {
    try {
        const [{ default: postcss }, { default: tailwindcss }] = await Promise.all([
            import(pathToFileURL(postcssModule)),
            import(pathToFileURL(tailwindModule))
        ]);
        return { postcss, tailwindcss };
    } catch (error) {
        throw new Error('Install apps/app dependencies before building legacy visual CSS.', { cause: error });
    }
}

async function buildLegacyLoginCss() {
    const { postcss, tailwindcss } = await loadBuildDependencies();
    const input = `
        @import "tailwindcss" source(none);
        @source "../../login.html";
        @theme {
            --color-primary-50: #eef2ff;
            --color-primary-100: #e0e7ff;
            --color-primary-500: #6366f1;
            --color-primary-600: #4f46e5;
            --color-primary-700: #4338ca;
            --color-primary-800: #3730a3;
            --color-primary-900: #312e81;
        }
    `;
    const sourcePath = path.join(repoRoot, 'apps', 'app', 'legacy-visual-input.css');
    const result = await postcss([tailwindcss()]).process(input, { from: sourcePath });
    return `${result.css.trim()}\n`;
}

const expectedCss = await buildLegacyLoginCss();
if (process.argv.includes('--check')) {
    const actualCss = await fs.readFile(outputPath, 'utf8').catch(() => '');
    if (actualCss !== expectedCss) {
        console.error('Legacy login visual CSS is stale. Run npm run test:smoke:visual:update.');
        process.exitCode = 1;
    }
} else {
    await fs.writeFile(outputPath, expectedCss);
}
