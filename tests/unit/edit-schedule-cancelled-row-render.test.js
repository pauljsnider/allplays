import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

function readEditSchedule() {
    return readFileSync(new URL('../../edit-schedule.html', import.meta.url), 'utf8');
}

function extractRenderDbGameBody() {
    const source = readEditSchedule();
    const match = source.match(/function renderDbGame\(game\) \{([\s\S]*?)\n        \}\n\n        function startEditGame/);
    expect(match, 'renderDbGame should exist').toBeTruthy();
    return match[1];
}

function buildRenderDbGame(overrides = {}) {
    const body = extractRenderDbGameBody();
    const deps = {
        gamesCache: {},
        currentTeamId: 'team-1',
        formatDate: () => 'Tue, Mar 10',
        formatTime: () => '6:00 PM',
        escapeHtml: (value) => String(value ?? ''),
        mapLink: () => '',
        renderTournamentSummary: () => '',
        ...overrides
    };

    const createRenderer = new Function('deps', `
        const { gamesCache, currentTeamId, formatDate, formatTime, escapeHtml, mapLink, renderTournamentSummary } = deps;
        return function(game) {
${body}
        };
    `);

    return { deps, renderDbGame: createRenderer(deps) };
}

describe('edit schedule cancelled game row rendering', () => {
    it('shows the cancelled state and removes cancellation actions after refresh', () => {
        const { deps, renderDbGame } = buildRenderDbGame();

        const html = renderDbGame({
            id: 'game-123',
            opponent: 'Tigers',
            location: 'Main Gym',
            date: '2026-03-10T18:00:00.000Z',
            status: 'cancelled',
            liveStatus: 'scheduled'
        });

        expect(deps.gamesCache['game-123']).toMatchObject({
            id: 'game-123',
            status: 'cancelled'
        });
        expect(html).toContain('CANCELLED');
        expect(html).toContain('>Cancelled</span>');
        expect(html).not.toContain('Command Center');
        expect(html).not.toContain('cancel-game-btn');
    });
});
