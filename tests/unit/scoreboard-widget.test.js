import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

function readPage(relativePath) {
    return readFileSync(new URL(`../../${relativePath}`, import.meta.url), 'utf8');
}

function escapeHtml(value) {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function formatShortDate(date) {
    return date.toISOString().slice(5, 10);
}

function formatTime(date) {
    return date.toISOString().slice(11, 16);
}

function extractWidgetHarness({ getTeam, getGames, getUrlParams }) {
    const source = readPage('widget-scoreboard.html');
    const script = source.match(/<script type="module">([\s\S]*?)<\/script>/)?.[1];
    if (!script) throw new Error('Unable to locate widget module script');

    const executableScript = script
        .replace(/^\s*import .*$/gm, '')
        .replace(/\n\s*window\.addEventListener\('pagehide', clearRefreshTimer\);/, '')
        .replace(/\n\s*window\.addEventListener\('beforeunload', clearRefreshTimer\);/, '')
        .replace(/\n\s*init\(\);\s*$/, '');

    return new Function(
        'getTeam',
        'getGames',
        'getUrlParams',
        'formatShortDate',
        'formatTime',
        'escapeHtml',
        `${executableScript}; return { state, selectWidgetGames, getGameUrl, renderGame, renderEmpty, loadWidget, init };`
    )(getTeam, getGames, getUrlParams, formatShortDate, formatTime, escapeHtml);
}

function createWidgetDom(url = 'https://example.test/widget-scoreboard.html?teamId=team%201/blue') {
    const dom = new JSDOM(readPage('widget-scoreboard.html'), { url });
    vi.spyOn(dom.window, 'setInterval').mockReturnValue(42);
    globalThis.window = dom.window;
    globalThis.document = dom.window.document;
    return dom;
}

afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    delete globalThis.window;
    delete globalThis.document;
});

describe('scoreboard widget embed', () => {
    it('adds team page tools to copy an iframe embed code and link', () => {
        const source = readPage('team.html');

        expect(source).toContain('id="scoreboard-widget-tools"');
        expect(source).toContain('Scoreboard widget');
        expect(source).toContain('data-copy-scoreboard-widget="embed"');
        expect(source).toContain('data-copy-scoreboard-widget="link"');
        expect(source).toContain('function buildScoreboardWidgetEmbedCode()');
        expect(source).toContain('widget-scoreboard.html?teamId=${encodeURIComponent(currentTeamId)}');
        expect(source).toContain('<iframe src="${url}"');
    });

    it('adds a read-only public widget page backed by team games', () => {
        const source = readPage('widget-scoreboard.html');

        expect(source).toContain('ALL PLAYS live scoreboard');
        expect(source).toContain("import { getTeam, getGames } from './js/db.js?v=91';");
        expect(source).toContain('const REFRESH_MS = 60000;');
        expect(source).toContain('function selectWidgetGames(games)');
        expect(source).toContain('.filter((game) => game._date && (isLive(game) || game._date >= now || (isCompleted(game) && game._date >= recentCutoff)))');
        expect(source).not.toContain('|| !isCompleted(game) || isLive(game)');
        expect(source).toContain('function renderGame(game)');
        expect(source).toContain('function isSharedScheduleMirror(game)');
        expect(source).toContain("return !!String(game?.sharedScheduleSourceTeamId || '').trim();");
        expect(source).toContain('const useStoredScoreOrder = isSharedScheduleMirror(game) || game.isHome !== false;');
        expect(source).toContain('const teamScore = useStoredScoreOrder ? homeScore : awayScore;');
        expect(source).toContain('const opponentScore = useStoredScoreOrder ? awayScore : homeScore;');
        expect(source).toContain("const scoreLabel = typeof game.isHome === 'boolean' ? 'team - opponent' : 'home - away';");
        expect(source).toContain('${teamScore} - ${opponentScore}');
        expect(source).toContain('${scoreLabel}');
        expect(source).toContain('team - opponent');
        expect(source).toContain('home - away');
        expect(source).not.toContain('tracking-wide">team - opponent</div>');
        expect(source).not.toContain('${homeScore} - ${awayScore}');
        expect(source).toContain('live-game.html?teamId=${encodeURIComponent(state.teamId)}&gameId=${encodeURIComponent(gameId)}');
        expect(source).toContain('function clearRefreshTimer()');
        expect(source).toContain("window.addEventListener('pagehide', clearRefreshTimer);");
        expect(source).toContain("window.addEventListener('beforeunload', clearRefreshTimer);");
        expect(source).toContain('Read-only public scoreboard');
    });

    it('treats legacy final games as completed recent results', () => {
        const source = readPage('widget-scoreboard.html');

        expect(source).toContain("const status = normalizeStatus(game?.status);");
        expect(source).toContain("return liveStatus === 'completed' || liveStatus === 'final' || status === 'completed' || status === 'final';");
        expect(source).toContain('.filter((game) => game._date && (isLive(game) || game._date >= now || (isCompleted(game) && game._date >= recentCutoff)))');
        expect(source).toContain("if (isCompleted(game)) return 'Final';");
        expect(source).toContain('game.html?teamId=${encodeURIComponent(state.teamId)}&gameId=${encodeURIComponent(gameId)}');
        expect(source).toContain('const showScore = isLive(game) || isCompleted(game);');
    });

    it('executes the widget DOM flow with filtering and scoreboard ordering', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-07-07T12:00:00Z'));
        createWidgetDom();

        const games = [
            { id: 'old-final', opponent: 'Old Final', date: '2026-06-29T12:00:00Z', liveStatus: 'completed' },
            { id: 'practice', opponent: 'Practice', type: 'practice', date: '2026-07-07T13:00:00Z' },
            { id: 'cancelled', opponent: 'Cancelled', status: 'canceled', date: '2026-07-07T14:00:00Z' },
            { id: 'upcoming-late', opponent: 'Late Upcoming', date: '2026-07-08T18:00:00Z' },
            { id: 'recent-final-newer', opponent: 'Newer Final', date: '2026-07-06T18:00:00Z', liveStatus: 'completed' },
            { id: 'live-game', opponent: 'Live Opponent', date: '2026-07-07T11:00:00Z', liveStatus: 'live' },
            { id: 'upcoming-soon', opponent: 'Soon Upcoming', date: '2026-07-07T13:00:00Z' },
            { id: 'recent-final-older', opponent: 'Older Final', date: '2026-07-05T18:00:00Z', status: 'final' }
        ];
        const harness = extractWidgetHarness({
            getTeam: vi.fn().mockResolvedValue({ name: 'Bears & Wolves' }),
            getGames: vi.fn().mockResolvedValue(games),
            getUrlParams: () => ({ teamId: 'team 1/blue' })
        });

        harness.init();
        await Promise.resolve();
        await Promise.resolve();

        expect(document.getElementById('widget-team-name').textContent).toBe('Bears & Wolves');
        expect(document.getElementById('widget-team-link').getAttribute('href')).toBe('team.html?teamId=team%201%2Fblue');

        const renderedOpponents = [...document.querySelectorAll('#widget-games h2')].map((heading) => heading.textContent);
        expect(renderedOpponents).toEqual([
            'vs. Live Opponent',
            'vs. Soon Upcoming',
            'vs. Late Upcoming',
            'vs. Newer Final',
            'vs. Older Final'
        ]);
        expect(document.getElementById('widget-games').textContent).not.toContain('Practice');
        expect(document.getElementById('widget-games').textContent).not.toContain('Cancelled');
        expect(document.getElementById('widget-games').textContent).not.toContain('Old Final');
    });

    it('renders team-oriented away scores and route targets for live and completed games', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-07-07T12:00:00Z'));
        createWidgetDom();

        const harness = extractWidgetHarness({
            getTeam: vi.fn().mockResolvedValue({ name: 'Road Team' }),
            getGames: vi.fn().mockResolvedValue([
                {
                    id: 'live-game',
                    opponent: 'Live Opponent',
                    date: '2026-07-07T11:00:00Z',
                    liveStatus: 'live',
                    isHome: true,
                    homeScore: 21,
                    awayScore: 19
                },
                {
                    id: 'away-final',
                    opponent: 'Home Rival',
                    date: '2026-07-06T18:00:00Z',
                    liveStatus: 'completed',
                    isHome: false,
                    homeScore: 71,
                    awayScore: 68
                }
            ]),
            getUrlParams: () => ({ teamId: 'team 1/blue' })
        });

        harness.init();
        await Promise.resolve();
        await Promise.resolve();

        const articles = [...document.querySelectorAll('#widget-games article')];
        expect(articles).toHaveLength(2);
        expect(articles[0].querySelector('a').getAttribute('href')).toBe('live-game.html?teamId=team%201%2Fblue&gameId=live-game');
        expect(articles[1].querySelector('a').getAttribute('href')).toBe('game.html?teamId=team%201%2Fblue&gameId=away-final');
        expect(articles[1].textContent).toContain('68 - 71');
        expect(articles[1].textContent).toContain('team - opponent');
        expect(articles[1].textContent).not.toContain('71 - 68');
    });

    it('preserves mirrored shared schedule scores as team-oriented results', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-07-07T12:00:00Z'));
        createWidgetDom('https://example.test/widget-scoreboard.html?teamId=team-bravo');

        const harness = extractWidgetHarness({
            getTeam: vi.fn().mockResolvedValue({ name: 'Bravo FC' }),
            getGames: vi.fn().mockResolvedValue([
                {
                    id: 'mirrored-final',
                    opponent: 'Alpha FC',
                    date: '2026-07-06T18:00:00Z',
                    liveStatus: 'completed',
                    isHome: false,
                    homeScore: 5,
                    awayScore: 10,
                    sharedScheduleId: 'shared_team-alpha_game-123',
                    sharedScheduleSourceTeamId: 'team-alpha',
                    sharedScheduleOpponentTeamId: 'team-alpha',
                    sharedScheduleOpponentGameId: 'game-123'
                }
            ]),
            getUrlParams: () => ({ teamId: 'team-bravo' })
        });

        harness.init();
        await Promise.resolve();
        await Promise.resolve();

        const article = document.querySelector('#widget-games article');
        expect(article.textContent).toContain('5 - 10');
        expect(article.textContent).toContain('team - opponent');
        expect(article.textContent).not.toContain('10 - 5');
    });

    it('shows the empty state when no games qualify', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-07-07T12:00:00Z'));
        createWidgetDom();

        const harness = extractWidgetHarness({
            getTeam: vi.fn().mockResolvedValue({ name: 'Quiet Team' }),
            getGames: vi.fn().mockResolvedValue([
                { id: 'practice', type: 'practice', opponent: 'Practice', date: '2026-07-07T13:00:00Z' },
                { id: 'old-final', opponent: 'Old Final', date: '2026-06-01T12:00:00Z', liveStatus: 'completed' },
                { id: 'cancelled', opponent: 'Cancelled', status: 'canceled', date: '2026-07-08T12:00:00Z' }
            ]),
            getUrlParams: () => ({ teamId: 'team 1/blue' })
        });

        harness.init();
        await Promise.resolve();
        await Promise.resolve();

        expect(document.getElementById('widget-games').textContent).toContain('No live, upcoming, or recent games to show.');
        expect(document.querySelectorAll('#widget-games article')).toHaveLength(0);
    });
});
