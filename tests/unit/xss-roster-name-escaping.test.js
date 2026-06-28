import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

// Security regression guard: user-controlled roster names (player.name / p.name)
// and photo URLs are stored data and must be HTML-escaped before being placed
// into innerHTML template literals, otherwise a name like
// `" onerror="alert(1)` yields stored XSS. See escapeHtml in js/utils.js.

function read(relativePath) {
    return readFileSync(new URL(`../../${relativePath}`, import.meta.url), 'utf8');
}

describe('roster name XSS escaping', () => {
    it('escapes the edited player photo preview src/alt in edit-roster.html', () => {
        const source = read('edit-roster.html');
        expect(source).toContain('src="${escapeHtml(editingPhotoUrl)}" alt="${escapeHtml(player.name || \'\')}"');
        // The raw, unescaped sink must be gone.
        expect(source).not.toContain('src="${editingPhotoUrl}" alt="${player.name}"');
    });

    it('imports escapeHtml and escapes every player-name interpolation in game-plan.html', () => {
        const source = read('game-plan.html');
        expect(source).toMatch(/import\s*\{[^}]*\bescapeHtml\b[^}]*\}\s*from\s*'\.\/js\/utils\.js/);

        // No bare ${p.name} / ${player.name} should remain inside markup templates.
        expect(source).not.toMatch(/>\$\{p\.name\}</);
        expect(source).not.toMatch(/>\$\{player\.name\}</);

        // The escaped forms are present.
        expect(source).toContain('${escapeHtml(p.name)}');
        expect(source).toContain('${escapeHtml(player.name)}');
    });
});
