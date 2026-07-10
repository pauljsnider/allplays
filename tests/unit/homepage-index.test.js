import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
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
        ['nav-cta-desktop', new MockElement('nav-cta-desktop')],
        ['nav-cta-mobile', new MockElement('nav-cta-mobile')],
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
    replayError = null,
    getRedirectUrl = () => 'dashboard.html',
    formatDate = (value) => `DATE:${value}`,
    formatTime = (value) => `TIME:${value}`
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
        getRedirectUrl,
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
        formatDate,
        formatTime,
        logger: {
            warn: vi.fn(),
            error: vi.fn()
        }
    });

    return { elements, renderHeader };
}

describe('homepage index workflow', () => {
    it('keeps public homepage CTAs on the request-access path instead of blocked signup', () => {
        const homepageHtml = readFileSync(resolve(process.cwd(), 'index.html'), 'utf8');

        expect(homepageHtml).not.toContain('login.html#signup');
        expect(homepageHtml).toContain('mailto:paul@paulsnider.net?subject=ALL%20PLAYS%20Access%20Request');
        expect(homepageHtml).toContain('Request Access');
        expect(homepageHtml).toContain("./js/homepage.js?v=4");
    });

    it('routes coach users to the team dashboard CTA, deduplicates live and upcoming games, and preserves replay links', async () => {
        const duplicatedLiveGame = createGame({ liveViewerCount: 5 });
        const replayGame = createGame({
            id: 'game-2',
            teamId: 'team-9',
            opponent: 'Bears',
            homeScore: 77,
            awayScore: 72,
            date: '2026-03-29T19:30:00.000Z',
            team: {
                id: 'team-9',
                name: 'Panthers',
                photoUrl: ''
            }
        });

        const { elements, renderHeader } = await runHomepage({
            user: { uid: 'coach-1', coachOf: ['team-1'] },
            liveGames: [duplicatedLiveGame],
            upcomingGames: [duplicatedLiveGame],
            replayGames: [replayGame],
            getRedirectUrl(user) {
                return user.coachOf?.length ? 'dashboard.html' : 'parent-dashboard.html';
            }
        });

        expect(renderHeader).toHaveBeenCalledWith(elements.get('header-container'), { uid: 'coach-1', coachOf: ['team-1'] });
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
        expect(replayMarkup).toContain('Panthers');
        expect(replayMarkup).toContain('vs Bears');
        expect(replayMarkup).toContain('77 - 72');
        expect(replayMarkup).toContain('DATE:2026-03-29T19:30:00.000Z');
        expect(replayMarkup).toContain('Watch Replay');
        expect(replayMarkup).toContain('href="live-game.html?teamId=team-9&gameId=game-2&replay=true"');
    });

    it('renders db-shaped live, upcoming, and replay games with Timestamp-like dates and parent team metadata', async () => {
        function timestampLike(isoValue) {
            return {
                toDate() {
                    return new Date(isoValue);
                }
            };
        }

        const liveGame = {
            id: 'live-game-1',
            teamId: 'team-live-1',
            opponent: 'Roadrunners',
            date: timestampLike('2026-04-10T23:00:00.000Z'),
            homeScore: 18,
            awayScore: 14,
            liveViewerCount: 9,
            liveStatus: 'live',
            team: {
                id: 'team-live-1',
                name: 'Live Tigers',
                parentName: 'North Club',
                photoUrl: ''
            }
        };
        const upcomingGame = {
            id: 'upcoming-game-1',
            teamId: 'team-upcoming-1',
            opponent: 'Rockets',
            date: timestampLike('2026-04-11T20:30:00.000Z'),
            status: 'scheduled',
            liveStatus: 'scheduled',
            team: {
                id: 'team-upcoming-1',
                name: 'Future Panthers',
                parentName: 'East Club',
                photoUrl: ''
            }
        };
        const replayGame = {
            id: 'replay-game-1',
            teamId: 'team-replay-1',
            opponent: 'Bears',
            date: timestampLike('2026-04-09T01:15:00.000Z'),
            homeScore: 44,
            awayScore: 41,
            liveStatus: 'completed',
            team: {
                id: 'team-replay-1',
                name: 'Replay Wolves',
                parentName: 'West Club',
                photoUrl: ''
            }
        };

        const { elements } = await runHomepage({
            liveGames: [liveGame],
            upcomingGames: [upcomingGame],
            replayGames: [replayGame],
            formatDate(value) {
                return `DATE:${value.toDate().toISOString()}`;
            },
            formatTime(value) {
                return `TIME:${value.toDate().toISOString()}`;
            }
        });

        const liveMarkup = elements.get('live-games-list').innerHTML;
        expect(liveMarkup).not.toContain('Loading games...');
        expect(liveMarkup).toContain('Live Tigers');
        expect(liveMarkup).toContain('Live Now');
        expect(liveMarkup).toContain('9 watching');
        expect(liveMarkup).toContain('href="live-game.html?teamId=team-live-1&gameId=live-game-1"');
        expect(liveMarkup).toContain('Future Panthers');
        expect(liveMarkup).toContain('vs Rockets');
        expect(liveMarkup).toContain('DATE:2026-04-11T20:30:00.000Z');
        expect(liveMarkup).toContain('TIME:2026-04-11T20:30:00.000Z');
        expect(liveMarkup).toContain('href="live-game.html?teamId=team-upcoming-1&gameId=upcoming-game-1"');

        const replayMarkup = elements.get('past-games-list').innerHTML;
        expect(replayMarkup).not.toContain('Loading replays...');
        expect(replayMarkup).toContain('Replay Wolves');
        expect(replayMarkup).toContain('vs Bears');
        expect(replayMarkup).toContain('44 - 41');
        expect(replayMarkup).toContain('DATE:2026-04-09T01:15:00.000Z');
        expect(replayMarkup).toContain('href="live-game.html?teamId=team-replay-1&gameId=replay-game-1&replay=true"');
    });

    it('routes parent users to the parent dashboard CTA', async () => {
        const { elements, renderHeader } = await runHomepage({
            user: {
                uid: 'parent-1',
                parentOf: [{ teamId: 'team-1', playerId: 'player-1' }]
            },
            getRedirectUrl(user) {
                return user.parentOf?.length ? 'parent-dashboard.html' : 'dashboard.html';
            }
        });

        expect(renderHeader).toHaveBeenCalledWith(elements.get('header-container'), {
            uid: 'parent-1',
            parentOf: [{ teamId: 'team-1', playerId: 'player-1' }]
        });
        expect(elements.get('hero-cta').textContent).toBe('Go to Dashboard');
        expect(elements.get('hero-cta').href).toBe('parent-dashboard.html');
    });

    it('keeps upcoming cards visible when live games fail and sets the guest CTA to request access', async () => {
        const upcomingGame = createGame({ id: 'game-3', opponent: 'Owls' });

        const { elements } = await runHomepage({
            liveError: new Error('missing live index'),
            upcomingGames: [upcomingGame]
        });

        expect(elements.get('hero-cta').textContent).toBe('Request Access');
        expect(elements.get('hero-cta').href).toBe('mailto:paul@paulsnider.net?subject=ALL%20PLAYS%20Access%20Request');
        expect(elements.get('nav-cta-desktop').textContent).toBe('Request Access');
        expect(elements.get('nav-cta-desktop').href).toBe('mailto:paul@paulsnider.net?subject=ALL%20PLAYS%20Access%20Request');
        expect(elements.get('nav-cta-mobile').textContent).toBe('Request Access');
        expect(elements.get('nav-cta-mobile').href).toBe('mailto:paul@paulsnider.net?subject=ALL%20PLAYS%20Access%20Request');

        const liveMarkup = elements.get('live-games-list').innerHTML;
        expect(liveMarkup).not.toContain('Loading games...');
        expect(liveMarkup).toContain('View Details');
        expect(liveMarkup).toContain('gameId=game-3');
        expect(liveMarkup).toContain('DATE:2026-03-28T18:00:00.000Z');
        expect(liveMarkup).toContain('TIME:2026-03-28T18:00:00.000Z');
    });

    it('replaces replay loading placeholder with exact empty-state copy', async () => {
        const { elements } = await runHomepage({
            liveGames: [],
            upcomingGames: [],
            replayGames: []
        });

        expect(elements.get('past-games-list').innerHTML).not.toContain('Loading replays...');
        expect(elements.get('past-games-list').textContent).toBe('No recent replays available');
    });

    it('replaces loading placeholders with exact error fallback copy when replay loading fails', async () => {
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

    it('excludes canceled and deleted upcoming games from the homepage list', async () => {
        const cancelledGame = createGame({
            id: 'game-cancelled',
            opponent: 'Cancelled Falcons',
            status: 'cancelled'
        });
        const canceledGame = createGame({
            id: 'game-canceled',
            opponent: 'Canceled Bears',
            status: 'canceled'
        });
        const deletedGame = createGame({
            id: 'game-deleted',
            opponent: 'Deleted Hawks',
            status: 'deleted'
        });
        const scheduledGame = createGame({
            id: 'game-4',
            opponent: 'Owls'
        });

        const { elements } = await runHomepage({
            upcomingGames: [cancelledGame, canceledGame, deletedGame, scheduledGame]
        });

        const liveMarkup = elements.get('live-games-list').innerHTML;
        expect(liveMarkup).toContain('gameId=game-4');
        expect(liveMarkup).toContain('vs Owls');
        expect(liveMarkup).not.toContain('gameId=game-cancelled');
        expect(liveMarkup).not.toContain('Cancelled Falcons');
        expect(liveMarkup).not.toContain('gameId=game-canceled');
        expect(liveMarkup).not.toContain('Canceled Bears');
        expect(liveMarkup).not.toContain('gameId=game-deleted');
        expect(liveMarkup).not.toContain('Deleted Hawks');
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
