// @vitest-environment jsdom
import React, { act } from '../../apps/app/node_modules/react/index.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRoot } from '../../apps/app/node_modules/react-dom/client.js';
import { MemoryRouter, Route, Routes } from '../../apps/app/node_modules/react-router-dom/dist/index.mjs';

const homeMocks = vi.hoisted(() => ({
    loadParentHome: vi.fn(),
    loadParentHomeSummary: vi.fn()
}));
const publicActionMocks = vi.hoisted(() => ({
    openPublicUrl: vi.fn()
}));

vi.mock('../../apps/app/src/lib/homeService.ts', () => homeMocks);
vi.mock('../../apps/app/src/lib/publicActions.ts', () => publicActionMocks);

import { Teams } from '../../apps/app/src/pages/Teams.tsx';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const auth = {
    user: {
        uid: 'user-1',
        email: 'parent@example.com',
        displayName: 'Pat Parent',
        roles: ['parent', 'coach']
    },
    profile: {},
    loading: false,
    error: null,
    roles: ['parent', 'coach'],
    isParent: true,
    isCoach: true,
    isAdmin: false,
    isPlatformAdmin: false,
    refresh: async () => {},
    signOut: async () => {}
};

async function renderTeams(initialEntry = '/teams') {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
        root.render(React.createElement(
            MemoryRouter,
            { initialEntries: [initialEntry] },
            React.createElement(
                Routes,
                null,
                React.createElement(Route, { path: '/teams', element: React.createElement(Teams, { auth }) })
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

async function waitForText(container, text) {
    for (let index = 0; index < 25; index += 1) {
        if (container.textContent.includes(text)) return;
        await flush();
    }
    throw new Error(`Timed out waiting for text: ${text}`);
}

function buttonByText(container, text) {
    const button = Array.from(container.querySelectorAll('button')).find((candidate) => candidate.textContent.includes(text));
    if (!button) {
        const labels = Array.from(container.querySelectorAll('button')).map((candidate) => candidate.textContent.trim() || candidate.getAttribute('aria-label') || '(unlabeled)');
        throw new Error(`Button not found: ${text}. Available buttons: ${labels.join(', ')}`);
    }
    return button;
}

async function clickButton(container, text) {
    await act(async () => {
        buttonByText(container, text).dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flush();
}

function getHrefs(container) {
    return Array.from(container.querySelectorAll('a')).map((link) => link.getAttribute('href'));
}

async function clickLink(container, text) {
    const link = Array.from(container.querySelectorAll('a')).find((candidate) => candidate.textContent.includes(text));
    if (!link) {
        const labels = Array.from(container.querySelectorAll('a')).map((candidate) => candidate.textContent.trim() || candidate.getAttribute('aria-label') || '(unlabeled)');
        throw new Error(`Link not found: ${text}. Available links: ${labels.join(', ')}`);
    }
    await act(async () => {
        link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    await flush();
}

beforeEach(() => {
    vi.clearAllMocks();
    window.requestAnimationFrame = (callback) => {
        callback(0);
        return 0;
    };
    window.scrollTo = vi.fn();
    homeMocks.loadParentHomeSummary.mockImplementation((...args) => homeMocks.loadParentHome(...args));
    homeMocks.loadParentHome.mockResolvedValue({
        players: [],
        upcomingEvents: [],
        actionItems: [],
        fees: [],
        metrics: {
            players: 1,
            teams: 2,
            rsvpNeeded: 0,
            unreadMessages: 3,
            packetsReady: 0
        },
        teams: [
            {
                teamId: 'team-1',
                teamName: 'Bears',
                role: 'Parent',
                sport: 'Basketball',
                photoUrl: 'https://img.example.test/bears.png',
                players: [{ teamId: 'team-1', teamName: 'Bears', playerId: 'player-1', playerName: 'Pat Star' }],
                nextEvent: null,
                eventCount: 2,
                unreadCount: 0,
                openActions: 0
            },
            {
                teamId: 'team-staff',
                teamName: 'Staff Wolves',
                role: 'Coach',
                sport: 'Soccer',
                photoUrl: 'https://img.example.test/wolves.png',
                players: [],
                nextEvent: null,
                eventCount: 0,
                unreadCount: 3,
                openActions: 1
            }
        ]
    });
});

afterEach(() => {
    document.body.innerHTML = '';
});

describe('React app Teams page', () => {
    it('renders the same parent and staff/admin teams used by the app inbox', async () => {
        const { container } = await renderTeams('/teams?selectedTeamId=team-staff&from=home');

        expect(homeMocks.loadParentHomeSummary).toHaveBeenCalledWith(auth.user, { force: false });
        expect(container.textContent).toContain('2 teams ready');
        expect(container.textContent).toContain('Choose a team');
        expect(container.textContent).toContain('Staff Wolves');
        expect(container.textContent).toContain('Bears');
        expect(container.querySelector('img[src="https://img.example.test/wolves.png"]')).toBeTruthy();
        expect(container.textContent).toContain('No player is linked to this account for the team, but team chat is available.');
        expect(container.textContent).toContain('Team navigation');
        expect(container.textContent.indexOf('Choose a team')).toBeLessThan(container.textContent.indexOf('Team navigation'));
        expect(container.textContent).toContain('Coach/admin tools');
        expect(container.textContent).toContain('Website tools available');
        let hrefs = getHrefs(container);
        expect(hrefs).toContain('/messages/team-staff');
        expect(hrefs).toContain('/teams/team-staff');
        expect(hrefs).not.toContain('/schedule?teamId=team-staff');
        expect(hrefs).toContain('https://allplays.ai/team.html#teamId=team-staff');
        expect(hrefs).toContain('https://allplays.ai/edit-roster.html#teamId=team-staff');
        expect(hrefs).toContain('https://allplays.ai/edit-schedule.html#teamId=team-staff');
        expect(hrefs).toContain('/teams/team-staff/fees');
        expect(hrefs).not.toContain('https://allplays.ai/team-fees.html#teamId=team-staff');
        expect(container.textContent).not.toContain('Practice command');
        expect(Array.from(container.querySelectorAll('button')).find((button) => button.textContent.includes('Staff Wolves'))?.getAttribute('aria-pressed')).toBe('true');

        await clickLink(container, 'Website team page');
        expect(publicActionMocks.openPublicUrl).toHaveBeenCalledWith('https://allplays.ai/team.html#teamId=team-staff');

        await clickButton(container, '6 more');
        expect(container.textContent).toContain('Practice command');
        hrefs = getHrefs(container);
        expect(hrefs).toContain('https://allplays.ai/drills.html#teamId=team-staff');
        expect(hrefs).toContain('https://allplays.ai/game-day.html?teamId=team-staff');

        await clickButton(container, 'Bears');
        await clickButton(container, 'Staff Wolves');
        expect(container.textContent).not.toContain('Practice command');
        expect(buttonByText(container, '6 more')).toBeTruthy();
    });

    it('selects teams in place and keeps player/chat links available', async () => {
        const { container } = await renderTeams('/teams?selectedTeamId=team-staff&from=home');
        await waitForText(container, 'Staff Wolves');

        await clickButton(container, 'Bears');

        expect(buttonByText(container, 'Bears').getAttribute('aria-pressed')).toBe('true');
        expect(container.textContent.indexOf('Choose a team')).toBeLessThan(container.textContent.indexOf('Team navigation'));
        const hrefs = getHrefs(container);
        expect(hrefs).toContain('/messages/team-1');
        expect(hrefs).toContain('/teams/team-1');
        expect(hrefs).toContain('/schedule?teamId=team-1');
        expect(hrefs).toContain('/schedule?teamId=team-1&view=packets');
        expect(hrefs).toContain('https://allplays.ai/team.html#teamId=team-1');
        expect(hrefs).toContain('/teams/team-1/media');
        expect(hrefs).toContain('/parent-tools/fees');
        expect(hrefs).toContain('/parent-tools/registrations');
        expect(hrefs).toContain('/parent-tools/certificates');
        expect(hrefs).toContain('/players/team-1/player-1');
        expect(container.textContent).toContain('Pat Star');
        expect(container.textContent).not.toContain('Coach/admin tools');
        expect(window.scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'smooth' });
    });

    it('refreshes team data without dropping into the loading shell', async () => {
        homeMocks.loadParentHome
            .mockResolvedValueOnce({
                players: [],
                teams: [{
                    teamId: 'team-1',
                    teamName: 'Bears',
                    role: 'Parent',
                    sport: 'Basketball',
                    players: [],
                    nextEvent: null,
                    eventCount: 0,
                    unreadCount: 0,
                    openActions: 0
                }],
                upcomingEvents: [],
                actionItems: [],
                fees: [],
                metrics: { players: 0, teams: 1, rsvpNeeded: 0, unreadMessages: 0, packetsReady: 0 }
            })
            .mockResolvedValueOnce({
                players: [],
                teams: [
                    {
                        teamId: 'team-1',
                        teamName: 'Bears',
                        role: 'Parent',
                        sport: 'Basketball',
                        players: [],
                        nextEvent: null,
                        eventCount: 0,
                        unreadCount: 0,
                        openActions: 0
                    },
                    {
                        teamId: 'team-2',
                        teamName: 'Lions',
                        role: 'Coach',
                        sport: 'Soccer',
                        players: [],
                        nextEvent: null,
                        eventCount: 0,
                        unreadCount: 1,
                        openActions: 0
                    }
                ],
                upcomingEvents: [],
                actionItems: [],
                fees: [],
                metrics: { players: 0, teams: 2, rsvpNeeded: 0, unreadMessages: 1, packetsReady: 0 }
            });

        const { container } = await renderTeams('/teams');
        await waitForText(container, '1 team ready');

        await act(async () => {
            container.querySelector('button[aria-label="Refresh teams"]').dispatchEvent(new MouseEvent('click', { bubbles: true }));
        });
        await flush();
        await waitForText(container, '2 teams ready');

        expect(homeMocks.loadParentHomeSummary).toHaveBeenCalledTimes(2);
        expect(container.textContent).toContain('Lions');
        expect(container.textContent).not.toContain('Loading teams');
    });

    it('uses a website Players resource for teams with multiple linked players', async () => {
        homeMocks.loadParentHome.mockResolvedValueOnce({
            players: [],
            teams: [{
                teamId: 'team-multi',
                teamName: 'Multi Bears',
                role: 'Parent',
                sport: 'Basketball',
                players: [
                    { teamId: 'team-multi', teamName: 'Multi Bears', playerId: 'player-1', playerName: 'Pat Star' },
                    { teamId: 'team-multi', teamName: 'Multi Bears', playerId: 'player-2', playerName: 'Sam Wing' }
                ],
                nextEvent: null,
                eventCount: 1,
                unreadCount: 0,
                openActions: 0
            }],
            upcomingEvents: [],
            actionItems: [],
            fees: [],
            metrics: { players: 2, teams: 1, rsvpNeeded: 0, unreadMessages: 0, packetsReady: 0 }
        });

        const { container } = await renderTeams('/teams');
        await waitForText(container, 'Multi Bears');

        const hrefs = getHrefs(container);
        expect(container.textContent).toContain('2 linked player profiles and reports');
        expect(container.textContent).not.toContain('Player profileReports, editable profile, incentives, clips');
        expect(hrefs).toContain('https://allplays.ai/team.html#teamId=team-multi');
        expect(hrefs).toContain('/players/team-multi/player-1');
        expect(hrefs).toContain('/players/team-multi/player-2');
    });

    it('shows clear empty and error states instead of a spinner', async () => {
        homeMocks.loadParentHome.mockRejectedValueOnce(new Error('Team service down'));

        const { container } = await renderTeams('/teams');

        await waitForText(container, 'Team service down');
        expect(container.textContent).toContain('No teams available');
        expect(container.textContent).not.toContain('Loading teams');
    });

    it('handles signed-in accounts that do not have team access yet', async () => {
        homeMocks.loadParentHome.mockResolvedValueOnce({
            players: [],
            teams: [],
            upcomingEvents: [],
            actionItems: [],
            fees: [],
            metrics: {
                players: 0,
                teams: 0,
                rsvpNeeded: 0,
                unreadMessages: 0,
                packetsReady: 0
            }
        });

        const { container } = await renderTeams('/teams');

        await waitForText(container, 'No teams available');
        expect(container.textContent).toContain('No teams linked yet');
        expect(container.textContent).toContain('Accept invite');
        expect(container.textContent).toContain('Browse teams');
        expect(container.textContent).not.toContain('Loading teams');
        expect(container.textContent).not.toContain('Website tools available');
    });
});
