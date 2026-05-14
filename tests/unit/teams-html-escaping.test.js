import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

function readTeamsPage() {
    return readFileSync(new URL('../../teams.html', import.meta.url), 'utf8');
}

function extractFunction(source, name) {
    const start = source.indexOf(`function ${name}`);
    expect(start, `${name} should exist`).toBeGreaterThanOrEqual(0);

    const bodyStart = source.indexOf('{', start);
    let depth = 0;
    for (let index = bodyStart; index < source.length; index += 1) {
        if (source[index] === '{') depth += 1;
        if (source[index] === '}') depth -= 1;
        if (depth === 0) {
            return source.slice(start, index + 1);
        }
    }

    throw new Error(`Could not extract ${name}`);
}

function loadTeamsPageHelpers() {
    const source = readTeamsPage();
    const helperSource = [
        extractFunction(source, 'escapeHtml'),
        extractFunction(source, 'getSafeImageUrl')
    ].join('\n');

    const factory = new Function('window', `
        ${helperSource}
        return { escapeHtml, getSafeImageUrl };
    `);

    return factory({ location: { origin: 'https://allplays.ai' } });
}

describe('teams page HTML escaping', () => {
    it('escapes team-supplied text before it is inserted with innerHTML', () => {
        const { escapeHtml } = loadTeamsPageHelpers();

        expect(escapeHtml(`<img src=x onerror=alert('xss')>`)).toBe('&lt;img src=x onerror=alert(&#39;xss&#39;)&gt;');
        expect(escapeHtml('A&B "Team"')).toBe('A&amp;B &quot;Team&quot;');
    });

    it('rejects scriptable image URL protocols', () => {
        const { getSafeImageUrl } = loadTeamsPageHelpers();

        expect(getSafeImageUrl('javascript:alert(1)')).toBe('');
        expect(getSafeImageUrl('data:image/svg+xml,<svg onload=alert(1)>')).toBe('');
        expect(getSafeImageUrl('https://cdn.example.com/team.png')).toBe('https://cdn.example.com/team.png');
    });

    it('does not interpolate raw team fields into the Browse Teams card', () => {
        const source = readTeamsPage();

        expect(source).not.toContain('src="${team.photoUrl}"');
        expect(source).not.toContain('alt="${team.name}"');
        expect(source).not.toContain('>${team.name}</h3>');
        expect(source).not.toContain('${team.description ||');
        expect(source).toContain('const escapedTeamName = escapeHtml(teamName);');
        expect(source).toContain('const safePhotoUrl = getSafeImageUrl(team.photoUrl);');
    });
});
