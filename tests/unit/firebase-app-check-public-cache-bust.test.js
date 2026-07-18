import { readFileSync, readdirSync } from 'node:fs';
import { extname, join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = new URL('../../', import.meta.url).pathname;
const skippedDirectories = new Set(['.git', 'node_modules', 'tests']);
const sourceExtensions = new Set(['.html', '.js', '.mjs']);

function findStalePublicModuleImports(directory = repoRoot) {
    const staleImports = [];

    for (const entry of readdirSync(directory, { withFileTypes: true })) {
        if (entry.isDirectory()) {
            if (!skippedDirectories.has(entry.name)) {
                staleImports.push(...findStalePublicModuleImports(join(directory, entry.name)));
            }
            continue;
        }
        if (!sourceExtensions.has(extname(entry.name))) continue;

        const filePath = join(directory, entry.name);
        const source = readFileSync(filePath, 'utf8');
        if (/auth\.js\?v=50|db\.js\?v=(?:91|92|95|96|97|99|100|101)/.test(source)) {
            staleImports.push(relative(repoRoot, filePath));
        }
    }

    return staleImports;
}

describe('Firebase App Check public module cache busting', () => {
    it('does not expose pre-App-Check auth or db module URLs', () => {
        expect(findStalePublicModuleImports()).toEqual([]);
    });
});
