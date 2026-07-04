import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

// Regression for the #3232 gap (Codex P1, unaddressed at merge): family.html
// imports the newly added `resolveFamilyShareTokenChildren` export from db.js but
// kept the old `?v=74` cache key. Clients/CDNs holding a cached db.js?v=79 from
// before the export was added would fail the named import and render a blank
// family-share page. The import's cache-bust version must be >= 75 (the version
// at/after which the export exists).

function read(rel) {
    return readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8');
}

describe('family-share db.js cache-busting', () => {
    const html = read('family.html');

    it('family.html imports resolveFamilyShareTokenChildren from db.js', () => {
        expect(html).toMatch(/import\s*\{[^}]*\bresolveFamilyShareTokenChildren\b[^}]*\}\s*from\s*'\.\/js\/db\.js\?v=\d+'/);
    });

    it('the db.js import is not pinned to a pre-export cache version', () => {
        const match = html.match(/resolveFamilyShareTokenChildren[^}]*\}\s*from\s*'\.\/js\/db\.js\?v=(\d+)'/);
        expect(match, 'db.js import with the export should exist').toBeTruthy();
        const version = Number(match[1]);
        expect(version).toBeGreaterThanOrEqual(75);
    });

    it('the export actually exists in js/db.js', () => {
        expect(read('js/db.js')).toMatch(/export\s+(async\s+)?function\s+resolveFamilyShareTokenChildren\b|export\s*\{[^}]*\bresolveFamilyShareTokenChildren\b/);
    });
});
