import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const EDIT_ROSTER_SMOKE_SPECS = [
    'edit-roster-bulk-ai-reset.spec.js',
    'edit-roster-xss-escaping.spec.js',
    'team-fallback-regressions.spec.js'
];

function readRepoFile(relativePath) {
    return readFileSync(new URL(`../../${relativePath}`, import.meta.url), 'utf8');
}

function getEditRosterDbImports() {
    const source = readRepoFile('edit-roster.html');
    const match = source.match(/import\s*\{([^}]+)\}\s*from\s*['"]\.\/js\/db\.js\?v=\d+['"]/s);

    expect(match, 'edit-roster.html must have a cache-busted named db.js import').not.toBeNull();

    return [...match[1].matchAll(/\b([A-Za-z_$][\w$]*)\b/g)].map((entry) => entry[1]);
}

function getStubExports(source) {
    return new Set(
        [...source.matchAll(/export\s+(?:async\s+)?(?:function|class|const|let|var)\s+([A-Za-z_$][\w$]*)/g)]
            .map((entry) => entry[1])
    );
}

describe('edit-roster browser module stubs', () => {
    it.each(EDIT_ROSTER_SMOKE_SPECS)('%s exports every db.js name imported by the page', (specName) => {
        const source = readRepoFile(`tests/smoke/${specName}`);
        const stubExports = getStubExports(source);
        const missingExports = getEditRosterDbImports().filter((name) => !stubExports.has(name));

        expect(missingExports, `${specName} has an incomplete db.js browser stub`).toEqual([]);
    });
});
