import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const html = readFileSync(new URL('../../player.html', import.meta.url), 'utf8');

function extractFunctionBody(source, name) {
    const start = source.indexOf(`function ${name}(`);
    expect(start).toBeGreaterThan(-1);
    const open = source.indexOf('{', start);
    let depth = 0;
    for (let i = open; i < source.length; i += 1) {
        if (source[i] === '{') depth += 1;
        if (source[i] === '}') {
            depth -= 1;
            if (depth === 0) return source.slice(open + 1, i);
        }
    }
    throw new Error(`unterminated function ${name}`);
}

describe('player page auth-scoped reset', () => {
    it('restores initial placeholders instead of blanking tab content', () => {
        const body = extractFunctionBody(html, 'clearPlayerAuthScopedState');
        expect(body).toContain('playerAuthScopedInitialMarkup.get(id)');
        expect(body).not.toMatch(/container\.innerHTML\s*=\s*''/);
    });

    it('captures placeholders before the first auth callback clears state', () => {
        const capture = html.indexOf('const playerAuthScopedInitialMarkup');
        const firstAuthCallback = html.indexOf('checkAuth((user)');
        expect(capture).toBeGreaterThan(-1);
        expect(firstAuthCallback).toBeGreaterThan(capture);
    });

    it('keeps visible loading placeholders for the season and clips tabs', () => {
        expect(html).toMatch(/<div id="season-stats">\s*<div[^>]*>Loading season stats\.\.\.<\/div>/);
        expect(html).toMatch(/<div id="content-clips"[^>]*>\s*<div[^>]*>[\s\S]*?No video clips yet/);
        for (const id of ['season-stats', 'content-clips', 'game-stats', 'player-events']) {
            expect(html).toContain(`'${id}'`);
        }
    });
});
