import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { escapeHtml } from '../../js/utils.js';

function readEditSchedulePage() {
    return readFileSync(new URL('../../edit-schedule.html', import.meta.url), 'utf8');
}

describe('edit schedule opponent search escaping', () => {
    it('escapes team-controlled values before rendering opponent search results with innerHTML', () => {
        const source = readEditSchedulePage();
        const renderStart = source.indexOf('function renderOpponentResults(matches, term) {');
        const renderEnd = source.indexOf('        checkAuth((user) => {', renderStart);

        expect(renderStart).toBeGreaterThanOrEqual(0);
        expect(renderEnd).toBeGreaterThan(renderStart);

        const renderBlock = source.slice(renderStart, renderEnd);
        expect(renderBlock).toContain('const teamName = team.name || \'Unnamed Team\';');
        expect(renderBlock).toContain('const teamSport = team.sport || \'Sport not set\';');
        expect(renderBlock).toContain('${escapeHtml(teamName)}');
        expect(renderBlock).toContain('${escapeHtml(teamSport)}');
        expect(renderBlock).toContain('${escapeHtml(teamInitial)}');
        expect(renderBlock).toContain('data-team-id="${escapeHtml(team.id)}"');
        expect(renderBlock).not.toContain('${team.name || \'Unnamed Team\'}');
        expect(renderBlock).not.toContain('${team.sport || \'Sport not set\'}');
    });

    it('converts opponent search payloads to inert text', () => {
        expect(escapeHtml(`<img src=x onerror=alert('xss')> Falcons`))
            .toBe('&lt;img src=x onerror=alert(&#039;xss&#039;)&gt; Falcons');
        expect(escapeHtml('Soccer <script>alert("xss")</script>'))
            .toBe('Soccer &lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;');
    });
});
