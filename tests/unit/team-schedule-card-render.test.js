import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

function readTeamPage() {
    return readFileSync(new URL('../../team.html', import.meta.url), 'utf8');
}

function extractRenderDbGameBody() {
    const source = readTeamPage();
    const match = source.match(/function renderDbGame\(game\) \{([\s\S]*?)\n        \}\n\n        \/\/ ICS export helpers/);
    expect(match, 'renderDbGame should exist').toBeTruthy();
    return match[1];
}

function buildRenderDbGame(overrides = {}) {
    const body = extractRenderDbGameBody();
    const deps = {
        currentTeamId: 'team-1',
        formatDate: () => 'Tue, Mar 10',
        formatTime: () => '6:00 PM',
        escapeHtml: (value) => String(value ?? ''),
        mapLink: () => '',
        ...overrides
    };

    const createRenderer = new Function('deps', `
        const { currentTeamId, formatDate, formatTime, escapeHtml, mapLink } = deps;
        return function(game) {
${body}
        };
    `);

    return { deps, renderDbGame: createRenderer(deps) };
}

describe('team page schedule card rendering', () => {
    it('fails closed for cancelled future games', () => {
        const { renderDbGame } = buildRenderDbGame();

        const html = renderDbGame({
            id: 'game-cancelled',
            opponent: 'Tigers',
            location: 'Main Gym',
            date: '2099-03-10T18:00:00.000Z',
            status: 'cancelled',
            liveStatus: 'scheduled'
        });

        expect(html).toContain('>Cancelled</span>');
        expect(html).toContain('CANCELLED');
        expect(html).not.toContain('Upcoming</span>');
        expect(html).not.toContain('View Live');
        expect(html).not.toContain('Live Now');
        expect(html).not.toContain('data-share-mode="live"');
    });

    it('renders upcoming scheduled games with live-view CTAs', () => {
        const { renderDbGame } = buildRenderDbGame();

        const html = renderDbGame({
            id: 'game-upcoming',
            opponent: 'Wolves',
            location: 'North Field',
            date: '2099-03-10T18:00:00.000Z',
            status: 'scheduled'
        });

        expect(html).toContain('Upcoming</span>');
        expect(html).toContain('View Live');
        expect(html).toContain('data-share-mode="live"');
        expect(html).not.toContain('Replay');
    });

    it('renders live games with live badge, score block, and live URL', () => {
        const { renderDbGame } = buildRenderDbGame();

        const html = renderDbGame({
            id: 'game-live',
            opponent: 'Falcons',
            location: 'South Gym',
            date: '2099-03-10T18:00:00.000Z',
            status: 'scheduled',
            liveStatus: 'live',
            homeScore: 12,
            awayScore: 10
        });

        expect(html).toContain('LIVE NOW');
        expect(html).toContain('Live Now');
        expect(html).toContain('live-game.html?teamId=team-1&gameId=game-live');
        expect(html).toContain('>12</div>');
        expect(html).toContain('>10</div>');
        expect(html).not.toContain('View Report');
    });

    it('renders completed replay CTAs only when live playback exists', () => {
        const { renderDbGame } = buildRenderDbGame();

        const replayHtml = renderDbGame({
            id: 'game-completed-replay',
            opponent: 'Bears',
            location: 'Arena',
            date: '2024-03-10T18:00:00.000Z',
            status: 'completed',
            liveStatus: 'completed',
            homeScore: 55,
            awayScore: 49
        });

        expect(replayHtml).toContain('View Report');
        expect(replayHtml).toContain('Share Report');
        expect(replayHtml).toContain('Replay');
        expect(replayHtml).toContain('live-game.html?teamId=team-1&gameId=game-completed-replay&replay=true');
        expect(replayHtml).not.toContain('View Live');

        const reportOnlyHtml = renderDbGame({
            id: 'game-completed-report-only',
            opponent: 'Sharks',
            location: 'Arena',
            date: '2024-03-10T18:00:00.000Z',
            status: 'completed',
            liveStatus: 'scheduled',
            homeScore: 60,
            awayScore: 58
        });

        expect(reportOnlyHtml).toContain('View Report');
        expect(reportOnlyHtml).toContain('Share Report');
        expect(reportOnlyHtml).not.toContain('Replay');
    });

    it('renders tied completed games with the tie badge', () => {
        const { renderDbGame } = buildRenderDbGame();

        const html = renderDbGame({
            id: 'game-tied',
            opponent: 'Raiders',
            location: 'Arena',
            date: '2024-03-10T18:00:00.000Z',
            status: 'completed',
            homeScore: 3,
            awayScore: 3
        });

        expect(html).toMatch(/>\s*T\s*<\/span>/);
        expect(html).toContain('bg-yellow-100 text-yellow-800');
        expect(html).toContain('View Report');
    });
});
