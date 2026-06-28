import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// Security guard: prevent stored-XSS regressions in the legacy vanilla-JS site.
//
// The legacy pages build markup with template literals and assign it via
// innerHTML. Any user-controlled field interpolated directly into markup
// context — element text `>${x.name}<` or an attribute value `="${x.name}"` —
// must be wrapped in escapeHtml() (js/utils.js). This test fails if a new
// unescaped interpolation of a known user-data field is introduced.
//
// Scope: production root *.html (test-*.html excluded) and js/**/*.js.

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

// Fields that carry user-entered, stored content (Firestore-backed). Matching
// is intentionally conservative — these are the realistic XSS carriers.
const USER_DATA_FIELDS = [
    'name',
    'email',
    'displayName',
    'senderName',
    'authorName',
    'playerName',
    'teamName',
    'opponent',
    'notes',
    'note',
    'comment',
    'description',
    'photoUrl',
    'title'
];

const fieldAlternation = USER_DATA_FIELDS.join('|');
// An interpolation in markup context: preceded by `>` (element text) or `="`
// (attribute value), referencing a user-data field as the final property.
const MARKUP_INTERP = new RegExp(
    `(>|=")\\$\\{([^{}]*\\.(?:${fieldAlternation}))[a-zA-Z0-9_?]*\\}`,
    'g'
);

function listLegacyFiles() {
    const htmlFiles = readdirSync(repoRoot)
        .filter((name) => name.endsWith('.html') && !name.startsWith('test'))
        .map((name) => path.join(repoRoot, name));

    const jsDir = path.join(repoRoot, 'js');
    const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) return walk(full);
        if (entry.name.endsWith('.js') && !entry.name.includes('.test.')) return [full];
        return [];
    });

    return [...htmlFiles, ...walk(jsDir)];
}

function findUnescapedSinks(source) {
    const offenders = [];
    for (const match of source.matchAll(MARKUP_INTERP)) {
        const expression = match[2];
        // Safe if the value is escaped (or is a runtime Error message, which is
        // not user-stored content and surfaces only in dev error toasts).
        if (expression.includes('escapeHtml(')) continue;
        if (/\b(error|err|e)\.(message|name)$/.test(expression)) continue;
        const line = source.slice(0, match.index).split('\n').length;
        offenders.push(`${expression} (line ${line})`);
    }
    return offenders;
}

describe('legacy XSS guard: no unescaped user-data interpolation in markup', () => {
    const files = listLegacyFiles();

    it('scans a meaningful number of legacy files', () => {
        // Sanity check so a broken glob does not silently pass.
        expect(files.length).toBeGreaterThan(20);
    });

    for (const file of files) {
        const relative = path.relative(repoRoot, file);
        it(`has no unescaped user-data sinks in ${relative}`, () => {
            const offenders = findUnescapedSinks(readFileSync(file, 'utf8'));
            expect(offenders, `Unescaped user-data interpolation(s) in ${relative}: ${offenders.join(', ')}. Wrap with escapeHtml().`).toEqual([]);
        });
    }
});
