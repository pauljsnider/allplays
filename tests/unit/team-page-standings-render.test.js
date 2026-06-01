import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

function readTeamPage() {
    return readFileSync(new URL('../../team.html', import.meta.url), 'utf8');
}

function extractFunctionBody(source, signature, nextSignature) {
    const pattern = new RegExp(`${signature} \\{([\\s\\S]*?)\\n        \\}\\n\\n        ${nextSignature}`);
    const match = source.match(pattern);
    expect(match, `${signature} should exist`).toBeTruthy();
    return match[1];
}

function buildLeagueStandingsRenderers() {
    const source = readTeamPage();
    const tableBody = extractFunctionBody(
        source,
        'function renderStandingsTable\\(rows, highlightedRow, columns, emptyMessage\\)',
        'function renderLeagueOverviewBody'
    );
    const overviewBody = extractFunctionBody(
        source,
        'function renderLeagueOverviewBody\\(leagueSnapshot, team\\)',
        'function buildNativeStandingsSnapshot'
    );

    const factory = new Function('escapeHtml', `
        function renderStandingsTable(rows, highlightedRow, columns, emptyMessage) {
${tableBody}
        }

        function renderLeagueOverviewBody(leagueSnapshot, team) {
${overviewBody}
        }

        return { renderStandingsTable, renderLeagueOverviewBody };
    `);

    return factory((value) => String(value ?? ''));
}

describe('team page league standings rendering', () => {
    it('renders the full external standings table and highlights the matched team row', () => {
        const { renderLeagueOverviewBody } = buildLeagueStandingsRenderers();
        const rows = [
            { team: 'Wilcox', w: 5, l: 0, t: 0, pct: '1.000', pf: 99, pa: 50, pd: 49 },
            { team: 'Blue Valley A', w: 4, l: 1, t: 0, pct: '0.800', pf: 65, pa: 43, pd: 22 }
        ];

        const html = renderLeagueOverviewBody({
            ok: true,
            rows,
            match: rows[1]
        }, {
            leagueUrl: 'https://example.com/standings'
        });

        expect(html).toContain('>Team<');
        expect(html).toContain('>PCT<');
        expect(html).toContain('Wilcox');
        expect(html).toContain('Blue Valley A');
        expect((html.match(/<tbody[\s\S]*?<tr class=/g) || []).length).toBe(1);
        expect((html.match(/<tr class="/g) || []).length).toBeGreaterThanOrEqual(2);
        expect(html).toContain('bg-primary-50/70');
        expect(html).toContain('text-primary-800">Blue Valley A');
        expect(html).toContain('Open league page');
    });

    it('preserves the fallback message and external link when standings fail to load', () => {
        const { renderLeagueOverviewBody } = buildLeagueStandingsRenderers();

        const html = renderLeagueOverviewBody({
            ok: false,
            rows: [],
            match: null
        }, {
            leagueUrl: 'https://example.com/standings'
        });

        expect(html).toContain('Could not load standings');
        expect(html).toContain('Open league page');
        expect(html).not.toContain('<table');
    });
});
