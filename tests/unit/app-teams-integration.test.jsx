// @vitest-environment jsdom
import React, { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const homeMocks = vi.hoisted(() => ({
    loadParentHome: vi.fn(),
    loadParentHomeSummary: vi.fn(),
    loadParentTeamsSummary: vi.fn()
}));
const publicActionMocks = vi.hoisted(() => ({
    openPublicUrl: vi.fn()
}));

vi.mock('../../apps/app/src/lib/homeService.ts', () => homeMocks);
vi.mock('../../apps/app/src/lib/publicActions.ts', () => publicActionMocks);

import { Teams } from '../../apps/app/src/pages/Teams.tsx';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const mountedRoots = new Set();

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
    mountedRoots.add(root);

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

async function typeIntoInput(container, placeholder, value) {
    const input = Array.from(container.querySelectorAll('input')).find((candidate) => candidate.getAttribute('placeholder') === placeholder);
    if (!input) {
        throw new Error(`Input not found: ${placeholder}`);
    }
    await act(async () => {
        const prototype = Object.getPrototypeOf(input);
        const descriptor = Object.getOwnPropertyDescriptor(prototype, 'value');
        descriptor?.set?.call(input, value);
        input.dispatchEvent(new Event('input', { bubbles: true }));
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
    homeMocks.loadParentTeamsSummary.mockImplementation((...args) => homeMocks.loadParentHome(...args));
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

afterEach(async () => {
    await act(async () => {
        mountedRoots.forEach((root) => root.unmount());
    });
    mountedRoots.clear();
    document.body.innerHTML = '';
});

describe('React app Teams page', () => {
    it('renders the same parent and staff/admin teams used by the app inbox', async () => {
        const { container } = await renderTeams('/teams?selectedTeamId=team-staff&from=home');

        expect(homeMocks.loadParentTeamsSummary).toHaveBeenCalledWith(auth.user, { force: false });
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
        expect(container.textContent).toContain('Discover public teams');
        expect(getHrefs(container)).toContain('/teams/browse');
        let hrefs = getHrefs(container);
        expect(hrefs).toContain('/messages/team-staff');
        expect(hrefs).toContain('/teams/team-staff');
        expect(hrefs).not.toContain('/schedule?teamId=team-staff');
        expect(hrefs).toContain('https://allplays.ai/team.html#teamId=team-staff');
        expect(hrefs).toContain('https://allplays.ai/edit-roster.html#teamId=team-staff');
        expect(hrefs).toContain('https://allplays.ai/edit-schedule.html#teamId=team-staff');
        expect(hrefs).toContain('/teams/team-staff/fees');
        expect(hrefs).not.toContain('https://allplays.ai/team-fees.html#teamId=team-staff');
        expect(container.textContent).not.toContain('Team drills');
        expect(Array.from(container.querySelectorAll('button')).find((button) => button.textContent.includes('Staff Wolves'))?.getAttribute('aria-pressed')).toBe('true');

        await clickLink(container, 'Website team page');
        expect(publicActionMocks.openPublicUrl).toHaveBeenCalledWith('https://allplays.ai/team.html#teamId=team-staff');

        await clickButton(container, '6 more');
        expect(container.textContent).toContain('Team drills');
        hrefs = getHrefs(container);
        expect(hrefs).toContain('/teams/team-staff/drills');
        expect(hrefs).toContain('https://allplays.ai/game-day.html?teamId=team-staff');

        await clickButton(container, 'Bears');
        await clickButton(container, 'Staff Wolves');
        expect(container.textContent).not.toContain('Team drills');
        expect(buttonByText(container, '6 more')).toBeTruthy();
    });

    it('filters the mobile launcher by team and player text before selecting a result', async () => {
        const { container } = await renderTeams('/teams?selectedTeamId=team-staff&from=home');
        await waitForText(container, 'Staff Wolves');

        const filterInput = container.querySelector('input[placeholder="Search teams or players"]');
        expect(filterInput).toBeTruthy();

        await typeIntoInput(container, 'Search teams or players', 'Pat');
        expect(Array.from(container.querySelectorAll('button')).some((button) => button.textContent.includes('Bears'))).toBe(true);
        expect(Array.from(container.querySelectorAll('button')).some((button) => button.textContent.includes('Staff Wolves'))).toBe(false);

        await typeIntoInput(container, 'Search teams or players', 'Wolves');
        expect(Array.from(container.querySelectorAll('button')).some((button) => button.textContent.includes('Staff Wolves'))).toBe(true);
        expect(Array.from(container.querySelectorAll('button')).some((button) => button.textContent.includes('Bears'))).toBe(false);

        await typeIntoInput(container, 'Search teams or players', 'zzz');
        expect(container.textContent).toContain('No teams match that search.');

        await typeIntoInput(container, 'Search teams or players', 'Bears');
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
        homeMocks.loadParentTeamsSummary
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
        homeMocks.loadParentHomeSummary.mockResolvedValue({
            players: [],
            teams: [],
            upcomingEvents: [],
            actionItems: [],
            fees: [],
            metrics: { players: 0, teams: 0, rsvpNeeded: 0, unreadMessages: 0, packetsReady: 0 }
        });

        const { container } = await renderTeams('/teams');
        await waitForText(container, '1 team ready');

        await act(async () => {
            container.querySelector('button[aria-label="Refresh teams"]').dispatchEvent(new MouseEvent('click', { bubbles: true }));
        });
        await flush();
        await waitForText(container, '2 teams ready');

        expect(homeMocks.loadParentTeamsSummary).toHaveBeenCalledTimes(2);
        expect(container.textContent).toContain('Lions');
        expect(container.textContent).not.toContain('Loading teams');
    });

    it('uses a website Players resource for teams with multiple linked players', async () => {
        const multiTeamModel = {
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
        };
        homeMocks.loadParentTeamsSummary.mockResolvedValueOnce(multiTeamModel);
        homeMocks.loadParentHomeSummary.mockResolvedValueOnce(multiTeamModel);

        const { container } = await renderTeams('/teams');
        await waitForText(container, 'Multi Bears');

        const hrefs = getHrefs(container);
        expect(container.textContent).toContain('2 linked player profiles and reports');
        expect(container.textContent).not.toContain('Player profileReports, editable profile, incentives, clips');
        expect(hrefs).toContain('https://allplays.ai/team.html#teamId=team-multi');
        expect(hrefs).toContain('/players/team-multi/player-1');
        expect(hrefs).toContain('/players/team-multi/player-2');
    });

    it('shows clear retryable error UI instead of a spinner when the initial load fails', async () => {
        homeMocks.loadParentTeamsSummary.mockRejectedValueOnce(new Error('Team service down'));

        const { container } = await renderTeams('/teams');

        await waitForText(container, 'Teams could not load');
        expect(container.textContent).toContain('Try loading teams again to restore your team dashboard.');
        expect(buttonByText(container, 'Retry')).toBeTruthy();
        expect(container.textContent).not.toContain('Loading teams');
        expect(container.textContent).not.toContain('No teams available');
    });

    it('handles signed-in accounts that do not have team access yet', async () => {
        const emptyTeamsModel = {
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
        };
        homeMocks.loadParentTeamsSummary.mockResolvedValueOnce(emptyTeamsModel);
        homeMocks.loadParentHomeSummary.mockResolvedValueOnce(emptyTeamsModel);

        const { container } = await renderTeams('/teams');

        await waitForText(container, 'No teams available');
        expect(container.textContent).toContain('No teams linked yet');
        expect(container.textContent).toContain('Accept invite');
        expect(container.textContent).toContain('Browse teams');
        expect(getHrefs(container)).toContain('/teams/browse');
        expect(container.textContent).not.toContain('Loading teams');
        expect(container.textContent).not.toContain('Website tools available');
    });

    it('auto-navigates to the team hub when the user has exactly one team', async () => {
        const singleTeamModel = {
            players: [],
            upcomingEvents: [],
            actionItems: [],
            fees: [],
            metrics: { players: 1, teams: 1, rsvpNeeded: 0, unreadMessages: 0, packetsReady: 0 },
            teams: [
                {
                    teamId: 'team-solo',
                    teamName: 'Solo Bears',
                    role: 'Parent',
                    sport: 'Basketball',
                    photoUrl: null,
                    players: [{ teamId: 'team-solo', teamName: 'Solo Bears', playerId: 'player-1', playerName: 'Alex Star' }],
                    nextEvent: null,
                    eventCount: 3,
                    unreadCount: 0,
                    openActions: 0
                }
            ]
        };
        homeMocks.loadParentTeamsSummary.mockResolvedValueOnce(singleTeamModel);
        homeMocks.loadParentHomeSummary.mockResolvedValueOnce(singleTeamModel);

        const container = document.createElement('div');
        document.body.appendChild(container);
        const root = createRoot(container);
        mountedRoots.add(root);

        function TeamHubRoute() {
            return React.createElement('div', { 'data-testid': 'team-hub' }, 'Team hub stub');
        }

        await act(async () => {
            root.render(React.createElement(
                MemoryRouter,
                { initialEntries: ['/teams'] },
                React.createElement(
                    Routes,
                    null,
                    React.createElement(Route, { path: '/teams', element: React.createElement(Teams, { auth }) }),
                    React.createElement(Route, { path: '/teams/:teamId', element: React.createElement(TeamHubRoute) })
                )
            ));
        });

        await waitForText(container, 'Team hub stub');
        expect(container.textContent).not.toContain('Choose a team');
        expect(container.textContent).not.toContain('Loading teams');
    });

    it('does not auto-navigate away from an explicitly selected team while richer team data is still loading', async () => {
        const singleTeamModel = {
            players: [],
            upcomingEvents: [],
            actionItems: [],
            fees: [],
            metrics: { players: 1, teams: 1, rsvpNeeded: 0, unreadMessages: 0, packetsReady: 0 },
            teams: [
                {
                    teamId: 'team-solo',
                    teamName: 'Solo Bears',
                    role: 'Parent',
                    sport: 'Basketball',
                    photoUrl: null,
                    players: [{ teamId: 'team-solo', teamName: 'Solo Bears', playerId: 'player-1', playerName: 'Alex Star' }],
                    nextEvent: null,
                    eventCount: 3,
                    unreadCount: 0,
                    openActions: 0
                }
            ]
        };
        const multiTeamModel = {
            ...singleTeamModel,
            metrics: { players: 1, teams: 2, rsvpNeeded: 0, unreadMessages: 3, packetsReady: 0 },
            teams: [
                singleTeamModel.teams[0],
                {
                    teamId: 'team-staff',
                    teamName: 'Staff Wolves',
                    role: 'Coach',
                    sport: 'Soccer',
                    photoUrl: null,
                    players: [],
                    nextEvent: null,
                    eventCount: 0,
                    unreadCount: 3,
                    openActions: 1
                }
            ]
        };
        homeMocks.loadParentTeamsSummary.mockResolvedValueOnce(singleTeamModel);
        homeMocks.loadParentHomeSummary.mockResolvedValueOnce(multiTeamModel);

        const container = document.createElement('div');
        document.body.appendChild(container);
        const root = createRoot(container);
        mountedRoots.add(root);

        function TeamHubRoute() {
            return React.createElement('div', { 'data-testid': 'team-hub' }, 'Team hub stub');
        }

        await act(async () => {
            root.render(React.createElement(
                MemoryRouter,
                { initialEntries: ['/teams?selectedTeamId=team-staff&from=home'] },
                React.createElement(
                    Routes,
                    null,
                    React.createElement(Route, { path: '/teams', element: React.createElement(Teams, { auth }) }),
                    React.createElement(Route, { path: '/teams/:teamId', element: React.createElement(TeamHubRoute) })
                )
            ));
        });

        await waitForText(container, '2 teams ready');
        expect(container.textContent).toContain('Choose a team');
        expect(container.querySelector('[data-testid="team-hub"]')).toBeNull();
        expect(buttonByText(container, 'Staff Wolves').getAttribute('aria-pressed')).toBe('true');
    });
});
