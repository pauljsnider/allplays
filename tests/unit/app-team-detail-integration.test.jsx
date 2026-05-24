// @vitest-environment jsdom
import React, { act } from '../../apps/app/node_modules/react/index.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRoot } from '../../apps/app/node_modules/react-dom/client.js';
import { MemoryRouter, Route, Routes } from '../../apps/app/node_modules/react-router-dom/dist/index.mjs';

const teamDetailMocks = vi.hoisted(() => ({
    loadParentTeamDetail: vi.fn()
}));
const publicActionMocks = vi.hoisted(() => ({
    openPublicUrl: vi.fn()
}));

vi.mock('../../apps/app/src/lib/teamDetailService.ts', () => ({
    loadParentTeamDetail: teamDetailMocks.loadParentTeamDetail
}));
vi.mock('../../apps/app/src/lib/publicActions.ts', () => publicActionMocks);

import { TeamDetail } from '../../apps/app/src/pages/TeamDetail.tsx';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const auth = {
    user: {
        uid: 'user-1',
        email: 'parent@example.com',
        displayName: 'Pat Parent',
        roles: ['parent'],
        parentOf: [{ teamId: 'team-1', playerId: 'player-1' }]
    },
    profile: {},
    loading: false,
    error: null,
    roles: ['parent'],
    isParent: true,
    isCoach: false,
    isAdmin: false,
    isPlatformAdmin: false,
    refresh: async () => {},
    signOut: async () => {}
};

function model() {
    const nextDate = new Date('2100-06-01T18:00:00Z');
    return {
        team: {
            id: 'team-1',
            name: 'Bears',
            sport: 'Basketball',
            photoUrl: 'https://img.example.test/team.png',
            description: 'Fast, parent-friendly team page.',
            zip: '66210',
            leagueUrl: 'https://league.example.test/standings',
            streamUrl: 'https://youtube.example.test/watch',
            websiteUrl: 'https://allplays.ai/team.html#teamId=team-1',
            mediaUrl: 'https://allplays.ai/team-media.html#teamId=team-1',
            registrationProvider: [{ label: 'Provider', value: 'Sports Connect' }]
        },
        players: [
            { id: 'player-1', name: 'Pat Star', number: '9', photoUrl: 'https://img.example.test/player.png', position: 'Guard', isLinked: true },
            { id: 'player-2', name: 'Sam Wing', number: '12', photoUrl: null, position: 'Forward', isLinked: false }
        ],
        linkedPlayers: [
            { id: 'player-1', name: 'Pat Star', number: '9', photoUrl: 'https://img.example.test/player.png', position: 'Guard', isLinked: true }
        ],
        upcomingEvents: [
            { id: 'game-1', type: 'game', title: 'vs. Falcons', date: nextDate, location: 'Main Gym', opponent: 'Falcons', status: '', homeScore: null, awayScore: null, isCancelled: false }
        ],
        recentResults: [
            { id: 'game-final', type: 'game', title: 'vs. Wolves', date: new Date('2026-05-01T18:00:00Z'), location: 'Main Gym', opponent: 'Wolves', status: 'completed', homeScore: 42, awayScore: 35, isCancelled: false }
        ],
        nextEvent: { id: 'game-1', type: 'game', title: 'vs. Falcons', date: nextDate, location: 'Main Gym', opponent: 'Falcons', status: '', homeScore: null, awayScore: null, isCancelled: false },
        record: { label: '2100', wins: 4, losses: 2, ties: 1, gamesPlayed: 7, winPercentage: 64.3 },
        standings: {
            enabled: true,
            label: 'Points table',
            rows: [{ team: 'Bears', rank: 1, record: '4-2-1', pf: 180, pa: 150 }],
            currentRow: { team: 'Bears', rank: 1, record: '4-2-1', pf: 180, pa: 150 }
        },
        leaderboards: [{
            id: 'pts',
            label: 'Points',
            leaders: [{ playerId: 'player-1', playerName: 'Pat Star', playerNumber: '9', photoUrl: 'https://img.example.test/player.png', rank: 1, formattedValue: '88' }]
        }],
        trackingSummaries: [{
            playerId: 'player-1',
            playerName: 'Pat Star',
            photoUrl: 'https://img.example.test/player.png',
            items: [{ id: 'item-1', title: 'Bring ball', description: 'For warmups', isComplete: false }]
        }],
        sponsors: [{ id: 'sponsor-1', name: 'Pizza Place', description: 'After the game', imageUrl: 'https://img.example.test/pizza.png', websiteUrl: 'https://pizza.example.test' }],
        counts: { games: 8, practices: 3, completedGames: 7 }
    };
}

async function renderTeamDetail() {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
        root.render(React.createElement(
            MemoryRouter,
            { initialEntries: ['/teams/team-1'] },
            React.createElement(
                Routes,
                null,
                React.createElement(Route, { path: '/teams/:teamId', element: React.createElement(TeamDetail, { auth }) })
            )
        ));
    });

    await flush();
    return { container, root };
}

async function flush() {
    await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
    });
}

async function clickButton(container, text) {
    const button = Array.from(container.querySelectorAll('button')).find((candidate) => candidate.textContent.includes(text));
    if (!button) throw new Error(`Button not found: ${text}`);
    await act(async () => {
        button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flush();
}

async function clickLink(container, text) {
    const link = Array.from(container.querySelectorAll('a')).find((candidate) => candidate.textContent.includes(text));
    if (!link) throw new Error(`Link not found: ${text}`);
    await act(async () => {
        link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    await flush();
}

function hrefs(container) {
    return Array.from(container.querySelectorAll('a')).map((link) => link.getAttribute('href'));
}

beforeEach(() => {
    vi.clearAllMocks();
    window.scrollTo = vi.fn();
    window.requestAnimationFrame = (callback) => {
        callback(0);
        return 0;
    };
    teamDetailMocks.loadParentTeamDetail.mockResolvedValue(model());
});

afterEach(() => {
    document.body.innerHTML = '';
});

describe('React app TeamDetail page', () => {
    it('loads parent-facing team.html features with team and player photos', async () => {
        const { container } = await renderTeamDetail();

        expect(teamDetailMocks.loadParentTeamDetail).toHaveBeenCalledWith('team-1', auth.user);
        expect(container.textContent).toContain('Bears');
        expect(container.querySelector('img[src="https://img.example.test/team.png"]')).toBeTruthy();
        expect(container.textContent).toContain('Season record (2100)');
        expect(container.textContent).toContain('Parent actions');
        expect(container.textContent).toContain('Team Pass');
        expect(Array.from(container.querySelectorAll('a')).map((link) => link.getAttribute('href'))).toContain('/schedule?teamId=team-1&filter=availability');

        await clickButton(container, 'Roster');
        expect(container.textContent).toContain('Pat Star');
        expect(container.textContent).toContain('Yours');
        expect(container.querySelector('img[src="https://img.example.test/player.png"]')).toBeTruthy();
        expect(Array.from(container.querySelectorAll('a')).map((link) => link.getAttribute('href'))).toContain('/players/team-1/player-1');

        await clickButton(container, 'Insights');
        expect(container.textContent).toContain('Bring ball');
        expect(container.textContent).toContain('Points');
        expect(container.textContent).toContain('88');

        await clickButton(container, 'More');
        expect(container.textContent).toContain('Website team page');
        expect(container.textContent).toContain('Media albums');
        expect(container.textContent).toContain('Watch stream');
        expect(container.textContent).toContain('League page');
        expect(container.textContent).toContain('Sports Connect');
        expect(container.textContent).toContain('Pizza Place');

        await clickLink(container, 'Watch stream');
        expect(publicActionMocks.openPublicUrl).toHaveBeenCalledWith('https://youtube.example.test/watch');
        await clickLink(container, 'Pizza Place');
        expect(publicActionMocks.openPublicUrl).toHaveBeenCalledWith('https://pizza.example.test');
    });

    it('exposes schedule, parent action links, and recent scores', async () => {
        const { container } = await renderTeamDetail();

        expect(hrefs(container)).toContain('/schedule?teamId=team-1&filter=availability');
        expect(hrefs(container)).toContain('/schedule?teamId=team-1');
        expect(hrefs(container)).toContain('/messages/team-1');
        await clickButton(container, 'Open website team page');
        expect(publicActionMocks.openPublicUrl).toHaveBeenCalledWith('https://allplays.ai/team.html#teamId=team-1');

        await clickButton(container, 'Schedule');
        expect(container.textContent).toContain('vs. Falcons');
        expect(container.textContent).toContain('vs. Wolves');
        expect(container.textContent).toContain('42-35');
        expect(hrefs(container)).toContain('/schedule/team-1/game-1');
        expect(hrefs(container)).toContain('/schedule/team-1/game-final');
    });

    it('renders empty tab states without trapping users in a spinner', async () => {
        const emptyModel = model();
        emptyModel.team.photoUrl = null;
        emptyModel.team.description = '';
        emptyModel.team.streamUrl = null;
        emptyModel.team.leagueUrl = null;
        emptyModel.team.registrationProvider = [];
        emptyModel.players = [];
        emptyModel.linkedPlayers = [];
        emptyModel.upcomingEvents = [];
        emptyModel.recentResults = [];
        emptyModel.nextEvent = null;
        emptyModel.record = { label: '2100', wins: 0, losses: 0, ties: 0, gamesPlayed: 0, winPercentage: null };
        emptyModel.standings = { enabled: false, label: 'No standings configured', rows: [], currentRow: null };
        emptyModel.leaderboards = [];
        emptyModel.trackingSummaries = [];
        emptyModel.sponsors = [];
        emptyModel.counts = { games: 0, practices: 0, completedGames: 0 };
        teamDetailMocks.loadParentTeamDetail.mockResolvedValueOnce(emptyModel);

        const { container } = await renderTeamDetail();
        expect(container.textContent).toContain('No completed games yet');
        expect(container.textContent).toContain('Schedule is clear for now');

        await clickButton(container, 'Schedule');
        expect(container.textContent).toContain('No team events found.');
        await clickButton(container, 'Roster');
        expect(container.textContent).toContain('No players have been added yet.');
        await clickButton(container, 'Insights');
        expect(container.textContent).toContain('No parent-visible tracking items for your players yet.');
        expect(container.textContent).toContain('Leaderboards appear after public stat configs and completed tracked games exist.');
        await clickButton(container, 'More');
        expect(container.textContent).toContain('Team links');
        expect(container.textContent).not.toContain('Registration provider');
        expect(container.textContent).not.toContain('Local attractions and sponsors');
        expect(container.textContent).not.toContain('Loading team');
    });

    it('shows the team unavailable state with a route back to teams', async () => {
        teamDetailMocks.loadParentTeamDetail.mockRejectedValueOnce(new Error('No team access'));
        const { container } = await renderTeamDetail();

        expect(container.textContent).toContain('Team unavailable');
        expect(container.textContent).toContain('No team access');
        expect(hrefs(container)).toContain('/teams');
        expect(container.textContent).not.toContain('Loading team');
    });
});
