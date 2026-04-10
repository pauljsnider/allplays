import { describe, expect, it, vi } from 'vitest';
import { initHomepage } from '../../js/homepage.js';

class MockElement {
    constructor(id = '') {
        this.id = id;
        this.textContent = '';
        this.href = '';
        this._innerHTML = '';
    }

    set innerHTML(value) {
        this._innerHTML = String(value);
        this.textContent = this._innerHTML.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    }

    get innerHTML() {
        return this._innerHTML;
    }
}

function createEnvironment() {
    const elements = new Map([
        ['header-container', new MockElement('header-container')],
        ['hero-cta', new MockElement('hero-cta')],
        ['live-games-list', new MockElement('live-games-list')],
        ['past-games-list', new MockElement('past-games-list')]
    ]);

    elements.get('live-games-list').innerHTML = '<div>Loading games...</div>';
    elements.get('past-games-list').innerHTML = '<div>Loading replays...</div>';

    return {
        document: {
            getElementById(id) {
                const element = elements.get(id);
                if (!element) {
                    throw new Error(`Unknown element: ${id}`);
                }
                return element;
            }
        },
        elements
    };
}

function createGame(overrides = {}) {
    return {
        id: 'game-1',
        teamId: 'team-1',
        opponent: 'Falcons',
        date: '2026-03-28T18:00:00.000Z',
        homeScore: 12,
        awayScore: 10,
        team: {
            id: 'team-1',
            name: 'Tigers',
            photoUrl: ''
        },
        ...overrides
    };
}

async function runHomepage({
    user = null,
    liveGames = [],
    upcomingGames = [],
    replayGames = [],
    liveError = null,
    upcomingError = null,
    replayError = null
} = {}) {
    const { document, elements } = createEnvironment();
    const renderHeader = vi.fn((container, currentUser) => {
        container.textContent = currentUser ? 'signed-in' : 'signed-out';
    });

    await initHomepage({
        document,
        checkAuth(callback) {
            callback(user);
        },
        renderHeader,
        async getLiveGamesNow() {
            if (liveError) {
                throw liveError;
            }
            return liveGames;
        },
        async getUpcomingLiveGames() {
            if (upcomingError) {
                throw upcomingError;
            }
            return upcomingGames;
        },
        async getRecentLiveTrackedGames() {
            if (replayError) {
                throw replayError;
            }
            return replayGames;
        },
        formatDate(value) {
            return `DATE:${value}`;
        },
        formatTime(value) {
            return `TIME:${value}`;
        },
        logger: {
            warn: vi.fn(),
            error: vi.fn()
        }
    });

    return { elements, renderHeader };
}

describe('homepage index workflow', () => {
    it('renders auth-aware CTA, deduplicates live and upcoming games, and preserves replay links', async () => {
        const duplicatedLiveGame = createGame({ liveViewerCount: 5 });
        const replayGame = createGame({
            id: 'game-2',
            opponent: 'Bears',
            homeScore: 77,
            awayScore: 72
        });

        const { elements, renderHeader } = await runHomepage({
            user: { uid: 'coach-1' },
            liveGames: [duplicatedLiveGame],
            upcomingGames: [duplicatedLiveGame],
            replayGames: [replayGame]
        });

        expect(renderHeader).toHaveBeenCalledWith(elements.get('header-container'), { uid: 'coach-1' });
        expect(elements.get('hero-cta').textContent).toBe('Go to Dashboard');
        expect(elements.get('hero-cta').href).toBe('dashboard.html');

        const liveMarkup = elements.get('live-games-list').innerHTML;
        expect(liveMarkup).not.toContain('Loading games...');
        expect(liveMarkup).toContain('Live Now');
        expect(liveMarkup).toContain('5 watching');
        expect(liveMarkup).toContain('Watch Now');
        expect((liveMarkup.match(/gameId=game-1/g) || []).length).toBe(1);

        const replayMarkup = elements.get('past-games-list').innerHTML;
        expect(replayMarkup).not.toContain('Loading replays...');
        expect(replayMarkup).toContain('Watch Replay');
        expect(replayMarkup).toContain('gameId=game-2&replay=true');
    });

    it('keeps upcoming cards visible when live games fail and sets the guest CTA', async () => {
        const upcomingGame = createGame({ id: 'game-3', opponent: 'Owls' });

        const { elements } = await runHomepage({
            liveError: new Error('missing live index'),
            upcomingGames: [upcomingGame]
        });

        expect(elements.get('hero-cta').textContent).toBe('Create Your Team');
        expect(elements.get('hero-cta').href).toBe('login.html#signup');

        const liveMarkup = elements.get('live-games-list').innerHTML;
        expect(liveMarkup).not.toContain('Loading games...');
        expect(liveMarkup).toContain('View Details');
        expect(liveMarkup).toContain('gameId=game-3');
        expect(liveMarkup).toContain('DATE:2026-03-28T18:00:00.000Z');
        expect(liveMarkup).toContain('TIME:2026-03-28T18:00:00.000Z');
    });

    it('excludes cancelled upcoming games from the homepage list', async () => {
        const cancelledGame = createGame({
            id: 'game-cancelled',
            opponent: 'Cancelled Falcons',
            status: 'cancelled'
        });
        const scheduledGame = createGame({
            id: 'game-4',
            opponent: 'Owls'
        });

        const { elements } = await runHomepage({
            upcomingGames: [cancelledGame, scheduledGame]
        });

        const liveMarkup = elements.get('live-games-list').innerHTML;
        expect(liveMarkup).toContain('gameId=game-4');
        expect(liveMarkup).toContain('vs Owls');
        expect(liveMarkup).not.toContain('gameId=game-cancelled');
        expect(liveMarkup).not.toContain('Cancelled Falcons');
    });

    it('replaces loading placeholders with exact empty and error fallback copy', async () => {
        const { elements } = await runHomepage({
            liveGames: [],
            upcomingGames: [],
            replayError: new Error('replay query failed')
        });

        expect(elements.get('live-games-list').innerHTML).not.toContain('Loading games...');
        expect(elements.get('past-games-list').innerHTML).not.toContain('Loading replays...');
        expect(elements.get('live-games-list').textContent).toBe('No upcoming live games scheduled');
        expect(elements.get('past-games-list').textContent).toBe('Unable to load replays');
    });

    it('escapes untrusted homepage game fields before inserting markup', async () => {
        const hostileLiveGame = createGame({
            id: 'game-1"&bad=<svg>',
            teamId: 'team-1"&evil=<script>',
            opponent: '<img src=x onerror=alert(1)>',
            liveViewerCount: '7<script>alert(1)</script>',
            homeScore: '<b>12</b>',
            awayScore: '"10"',
            team: {
                id: 'team-1',
                name: 'Tigers"><script>alert(1)</script>',
                photoUrl: 'https://img.example.com/logo.png" onerror="alert(1)'
            }
        });
        const hostileReplayGame = createGame({
            id: 'game-2"&replay=false',
            teamId: 'team-2"&x=<img>',
            opponent: '<svg onload=alert(2)>',
            team: {
                id: 'team-2',
                name: 'Bears & <wolves>',
                photoUrl: ''
            }
        });

        const { elements } = await runHomepage({
            liveGames: [hostileLiveGame],
            replayGames: [hostileReplayGame]
        });

        const liveMarkup = elements.get('live-games-list').innerHTML;
        expect(liveMarkup).toContain('Tigers&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;');
        expect(liveMarkup).toContain('vs &lt;img src=x onerror=alert(1)&gt;');
        expect(liveMarkup).toContain('7&lt;script&gt;alert(1)&lt;/script&gt; watching');
        expect(liveMarkup).toContain('&lt;b&gt;12&lt;/b&gt; - &quot;10&quot;');
        expect(liveMarkup).toContain('teamId=team-1%22%26evil%3D%3Cscript%3E');
        expect(liveMarkup).toContain('gameId=game-1%22%26bad%3D%3Csvg%3E');
        expect(liveMarkup).toContain('src="https://img.example.com/logo.png&quot; onerror=&quot;alert(1)"');
        expect(liveMarkup).not.toContain('<script>alert(1)</script>');
        expect(liveMarkup).not.toContain('<img src=x onerror=alert(1)>');

        const replayMarkup = elements.get('past-games-list').innerHTML;
        expect(replayMarkup).toContain('Bears &amp; &lt;wolves&gt;');
        expect(replayMarkup).toContain('vs &lt;svg onload=alert(2)&gt;');
        expect(replayMarkup).toContain('teamId=team-2%22%26x%3D%3Cimg%3E');
        expect(replayMarkup).toContain('gameId=game-2%22%26replay%3Dfalse&replay=true');
        expect(replayMarkup).not.toContain('<svg onload=alert(2)>');
    });
});
