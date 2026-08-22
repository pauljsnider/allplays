import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

// Regression for the #3232 cache gap: the family page must keep a versioned
// db.js import while using only the server-projected family-share reader. A
// stale named import can otherwise fail before the page can show its retry UI.

function read(rel) {
    return readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8');
}

describe('family-share db.js cache-busting', () => {
    const html = read('family.html');

    it('family.html imports only getFamilyShareView from a versioned db.js URL', () => {
        expect(html).toMatch(/import\s*\{\s*getFamilyShareView\s*\}\s*from\s*'\.\/js\/db\.js\?v=\d+'/);
        expect(html).not.toContain('resolveFamilyShareTokenChildren');
        expect(html).not.toContain('getFamilyShareToken');
    });

    it('retains a positive numeric cache-bust version', () => {
        const match = html.match(/getFamilyShareView\s*\}\s*from\s*'\.\/js\/db\.js\?v=(\d+)'/);
        expect(match, 'versioned db.js projection import should exist').toBeTruthy();
        expect(Number(match[1])).toBeGreaterThan(0);
    });

    it('the projection export actually exists in js/db.js', () => {
        expect(read('js/db.js')).toMatch(/export\s+(async\s+)?function\s+getFamilyShareView\b|export\s*\{[^}]*\bgetFamilyShareView\b/);
    });
});
