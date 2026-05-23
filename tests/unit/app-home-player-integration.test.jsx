// @vitest-environment jsdom
import React, { act } from '../../apps/app/node_modules/react/index.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRoot } from '../../apps/app/node_modules/react-dom/client.js';
import { MemoryRouter, Route, Routes } from '../../apps/app/node_modules/react-router-dom/dist/index.mjs';

const homeMocks = vi.hoisted(() => ({
    loadParentHome: vi.fn()
}));

const playerMocks = vi.hoisted(() => ({
    loadParentPlayerDetail: vi.fn(),
    markParentPlayerIncentivePaid: vi.fn(),
    retireParentPlayerIncentiveRule: vi.fn(),
    saveParentAthleteProfileDraft: vi.fn(),
    saveParentPlayerIncentiveCap: vi.fn(),
    saveParentPlayerIncentiveRule: vi.fn(),
    sendParentCoParentInvite: vi.fn(),
    toggleParentPlayerIncentiveRule: vi.fn(),
    updateParentPlayerEditableProfile: vi.fn()
}));

vi.mock('../../apps/app/src/lib/homeService.ts', () => homeMocks);
vi.mock('../../apps/app/src/lib/playerService.ts', () => playerMocks);

import { Home } from '../../apps/app/src/pages/Home.tsx';
import { PlayerDetail } from '../../apps/app/src/pages/PlayerDetail.tsx';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const auth = {
    user: {
        uid: 'user-1',
        email: 'parent@example.com',
        displayName: 'Pat Parent'
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

function event(overrides = {}) {
    const teamId = overrides.teamId || 'team-1';
    const id = overrides.id || 'game-1';
    const childId = overrides.childId || 'player-1';
    return {
        eventKey: overrides.eventKey || `${teamId}::${id}::${childId}`,
        id,
        teamId,
        teamName: overrides.teamName || 'Bears',
        type: overrides.type || 'game',
        date: overrides.date || new Date('2100-06-01T18:00:00Z'),
        location: overrides.location || 'Main Gym',
        opponent: overrides.opponent || 'Falcons',
        title: overrides.title || null,
        childId,
        childName: overrides.childName || 'Pat',
        isDbGame: overrides.isDbGame !== false,
        isCancelled: overrides.isCancelled === true,
        myRsvp: overrides.myRsvp || 'not_responded',
        assignments: overrides.assignments || [],
        ...overrides
    };
}

async function renderApp(initialEntry = '/home') {
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
                React.createElement(Route, { path: '/home', element: React.createElement(Home, { auth }) }),
                React.createElement(Route, { path: '/players/:teamId/:playerId', element: React.createElement(PlayerDetail, { auth }) }),
                React.createElement(Route, { path: '/players/:playerId', element: React.createElement(PlayerDetail, { auth }) })
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
    const button = Array.from(container.querySelectorAll('button')).find((candidate) => candidate.textContent.trim() === text);
    if (!button) {
        throw new Error(`Button not found: ${text}`);
    }
    return button;
}

async function clickButton(container, text) {
    await act(async () => {
        buttonByText(container, text).dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flush();
}

async function clickLinkByHref(container, href) {
    const link = Array.from(container.querySelectorAll('a')).find((candidate) => candidate.getAttribute('href') === href);
    if (!link) {
        throw new Error(`Link not found: ${href}`);
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

    const nextEvent = event({ id: 'game-next', opponent: 'Falcons' });
    const practice = event({
        id: 'practice-1',
        type: 'practice',
        title: 'Practice',
        date: new Date('2100-06-02T19:00:00Z'),
        myRsvp: 'going',
        practiceHomePacketSummary: '2 drills · 20 min'
    });
    const statEvent = event({
        id: 'game-final',
        date: new Date('2000-06-01T18:00:00Z'),
        status: 'completed',
        myRsvp: 'going'
    });

    homeMocks.loadParentHome.mockResolvedValue({
        players: [
            {
                teamId: 'team-1',
                teamName: 'Bears',
                playerId: 'player-1',
                playerName: 'Pat Star',
                nextEvent,
                rsvpNeeded: 1,
                packetsReady: 1,
                openAssignments: 0,
                unreadCount: 2
            }
        ],
        teams: [
            {
                teamId: 'team-1',
                teamName: 'Bears',
                role: 'Parent',
                sport: 'Basketball',
                players: [{ teamId: 'team-1', teamName: 'Bears', playerId: 'player-1', playerName: 'Pat Star' }],
                nextEvent,
                eventCount: 2,
                unreadCount: 2,
                openActions: 2
            }
        ],
        upcomingEvents: [nextEvent, practice],
        actionItems: [
            {
                id: 'rsvp:game-next',
                kind: 'rsvp',
                tone: 'amber',
                title: 'Pat Star needs availability',
                detail: 'Bears vs. Falcons',
                to: '/schedule/team-1/game-next?childId=player-1&section=availability',
                priority: 10,
                date: nextEvent.date
            }
        ],
        fees: [],
        metrics: {
            players: 1,
            teams: 1,
            rsvpNeeded: 1,
            unreadMessages: 2,
            packetsReady: 1
        }
    });

    playerMocks.loadParentPlayerDetail.mockResolvedValue({
        child: { teamId: 'team-1', teamName: 'Bears', playerId: 'player-1', playerName: 'Pat Star' },
        player: { id: 'player-1', name: 'Pat Star', teamId: 'team-1', teamName: 'Bears', number: '9', photoUrl: '' },
        team: { id: 'team-1', name: 'Bears', sport: 'basketball' },
        events: [statEvent, nextEvent, practice],
        nextEvent,
        actionCounts: {
            rsvpNeeded: 1,
            packetsReady: 1,
            openAssignments: 0
        },
        statRows: [{ event: statEvent, stats: { pts: 12, reb: 4 } }],
        clips: [{ title: 'Fast break', url: 'https://video.example.test/clip', gameLabel: 'vs. Falcons' }],
        certificates: [{ id: 'cert-1', title: 'Hustle Award' }],
        trackingSummary: [{ playerId: 'player-1', items: [{ id: 'item-1', title: 'Bring ball', isComplete: true }] }],
        privateProfile: {
            emergencyContact: { name: 'Jamie Parent', phone: '555-0100' },
            medicalInfo: 'Peanut allergy'
        },
        incentives: {
            rules: [{ id: 'rule-1', statKey: 'pts', type: 'per_unit', amountCents: 100, active: true }],
            currentRules: [{ id: 'rule-1', statKey: 'pts', type: 'per_unit', amountCents: 100, active: true }],
            statOptions: [{ key: 'pts', label: 'PTS' }],
            maxPerGameCents: null,
            seasonGameEarnings: [{
                event: statEvent,
                stats: { pts: 12, reb: 4 },
                totalCents: 1200,
                uncappedTotalCents: 1200,
                wasCapped: false,
                breakdown: [{ rule: { statKey: 'pts', type: 'per_unit', amountCents: 100 }, statValue: 12, earned: 1200 }],
                paid: false,
                paidAmountCents: 0
            }],
            totalEarnedCents: 1200,
            totalPaidCents: 0,
            unpaidCents: 1200
        },
        athleteProfile: {
            profile: { id: 'profile-1', athlete: { name: 'Pat Star', headline: '2028 Guard' }, bio: { position: 'Guard' }, privacy: 'public', seasons: [{ teamId: 'team-1', playerId: 'player-1' }] },
            shareUrl: 'https://allplays.ai/athlete-profile.html?profileId=profile-1',
            builderUrl: 'https://allplays.ai/athlete-profile-builder.html?teamId=team-1&playerId=player-1&profileId=profile-1'
        }
    });
    playerMocks.updateParentPlayerEditableProfile.mockResolvedValue();
    playerMocks.saveParentAthleteProfileDraft.mockResolvedValue({
        shareUrl: 'https://allplays.ai/athlete-profile.html?profileId=profile-1'
    });
    playerMocks.saveParentPlayerIncentiveRule.mockResolvedValue('rule-2');
    playerMocks.saveParentPlayerIncentiveCap.mockResolvedValue();
    playerMocks.markParentPlayerIncentivePaid.mockResolvedValue();
});

afterEach(() => {
    document.body.innerHTML = '';
});

describe('React app Home and player drill-in integration', () => {
    it('uses the section submenu pattern and navigates from Home to the team-scoped player page', async () => {
        const { container } = await renderApp('/home');
        await waitForText(container, 'Today for your players');
        await waitForText(container, 'Do first');
        expect(container.textContent).toContain('Team chats');
        expect(container.textContent).toContain('2 unread messages');
        expect(container.textContent).toContain('Next up');
        await waitForText(container, 'More to do');
        expect(homeMocks.loadParentHome).toHaveBeenCalledWith(auth.user);

        await clickButton(container, 'Teams');
        await waitForText(container, 'Teams');
        const teamLink = Array.from(container.querySelectorAll('a')).find((link) => link.getAttribute('href') === '/teams?selectedTeamId=team-1&from=home');
        expect(teamLink?.getAttribute('href')).toBe('/teams?selectedTeamId=team-1&from=home');
        expect(teamLink?.getAttribute('aria-label')).toBe('Open Bears in My Teams');

        await clickButton(container, 'Access');
        await waitForText(container, 'Accept invite');
        expect(container.textContent).toContain('Request player access');
        expect(container.textContent).toContain('Calendar tools');
        expect(container.textContent).toContain('Family share');
        expect(Array.from(container.querySelectorAll('a')).map((link) => link.getAttribute('href'))).toEqual(expect.arrayContaining([
            '/accept-invite',
            '/parent-tools/access',
            '/parent-tools/calendar',
            '/parent-tools/share',
            '/parent-tools/registrations',
            '/parent-tools/certificates'
        ]));

        await clickButton(container, 'Players');
        await waitForText(container, 'Player Drill-In');
        const playerLink = Array.from(container.querySelectorAll('a')).find((link) => link.getAttribute('href') === '/players/team-1/player-1');
        expect(playerLink?.getAttribute('href')).toBe('/players/team-1/player-1');

        await clickLinkByHref(container, '/players/team-1/player-1');
        await waitForText(container, 'Pat Star');
        expect(playerMocks.loadParentPlayerDetail).toHaveBeenCalledWith(auth.user, 'team-1', 'player-1');
        expect(container.textContent).toContain('Availability needed');

        await clickButton(container, 'Reports');
        await waitForText(container, 'Player reports');
        expect(container.textContent).toContain('Game Stats');
        expect(container.textContent).toContain('Season Averages');
        expect(container.textContent).toContain('Bring ball');
        await clickButton(container, 'Video Clips');
        expect(container.textContent).toContain('Fast break');

        await clickButton(container, 'Profile');
        await waitForText(container, 'Edit Profile');
        expect(container.textContent).toContain('Athlete Profile');
        expect(container.textContent).toContain('Family');
        expect(container.textContent).toContain('Incentives');
        expect(container.textContent).toContain('Certificates');
        await clickButton(container, 'Family');
        expect(container.textContent).toContain('Invite Co-Parent');
        await clickButton(container, 'Incentives');
        await waitForText(container, 'Incentive wallet');
        expect(container.textContent).toContain('Payouts need attention');
        expect(container.textContent).toContain('Active rules');
        await clickButton(container, 'Payouts');
        await waitForText(container, 'Game payouts');
        expect(container.textContent).toContain('Mark Paid');
        expect(container.textContent).toContain('12 PTS x $1.00 = +$12.00');
        await clickButton(container, 'Rules');
        await waitForText(container, 'Rules and limits');
        expect(container.textContent).toContain('PTS: +$1.00 per pts');
        expect(container.textContent).toContain('Max earned per game');
        expect(window.scrollTo).toHaveBeenCalled();
    });

    it('keeps the current player profile subview after saves refresh player data', async () => {
        const { container } = await renderApp('/players/team-1/player-1');
        await waitForText(container, 'Pat Star');

        await clickButton(container, 'Profile');
        await clickButton(container, 'Athlete Profile');
        await waitForText(container, 'Athlete Profile Builder');
        expect(buttonByText(container, 'Athlete Profile').getAttribute('aria-pressed')).toBe('true');

        await clickButton(container, 'Save Athlete Profile');
        await waitForText(container, 'Saved');
        expect(playerMocks.saveParentAthleteProfileDraft).toHaveBeenCalledWith(expect.objectContaining({
            user: auth.user,
            teamId: 'team-1',
            playerId: 'player-1',
            profileId: 'profile-1'
        }));
        expect(playerMocks.loadParentPlayerDetail).toHaveBeenCalledTimes(2);
        expect(buttonByText(container, 'Athlete Profile').getAttribute('aria-pressed')).toBe('true');
        expect(container.textContent).toContain('Athlete Profile Builder');
        expect(container.textContent).not.toContain('Parents can update the player photo');
        expect(container.textContent).not.toContain('Loading player');

        await clickButton(container, 'Incentives');
        await waitForText(container, 'Incentive wallet');
        await clickButton(container, 'Rules');
        await waitForText(container, 'Rules and limits');
        await clickButton(container, 'Add Rule');
        await clickButton(container, 'Add Rule');
        await waitForText(container, 'Rule added.');
        expect(buttonByText(container, 'Incentives').getAttribute('aria-pressed')).toBe('true');
        expect(buttonByText(container, 'Rules').getAttribute('aria-pressed')).toBe('true');
        expect(container.textContent).toContain('Rules and limits');
        expect(container.textContent).not.toContain('Loading player');
    });

    it('surfaces chat-access teams without linked players so Home and Messages stay aligned', async () => {
        homeMocks.loadParentHome.mockResolvedValueOnce({
            players: [],
            teams: [
                {
                    teamId: 'team-staff',
                    teamName: 'Staff Wolves',
                    role: 'Coach',
                    sport: 'Soccer',
                    players: [],
                    nextEvent: null,
                    eventCount: 0,
                    unreadCount: 3,
                    openActions: 1
                }
            ],
            upcomingEvents: [],
            actionItems: [],
            fees: [],
            metrics: {
                players: 0,
                teams: 1,
                rsvpNeeded: 0,
                unreadMessages: 3,
                packetsReady: 0
            }
        });

        const { container } = await renderApp('/home');
        await waitForText(container, 'Today for your players');
        expect(container.textContent).toContain('3 unread messages');
        expect(container.textContent).toContain('Staff Wolves');
        expect(container.textContent).toContain('All caught up');
        expect(container.textContent).toContain('No upcoming events');

        await clickButton(container, 'Teams');
        await waitForText(container, 'Coach · Soccer');
        const teamLink = Array.from(container.querySelectorAll('a')).find((link) => link.getAttribute('href') === '/teams?selectedTeamId=team-staff&from=home');
        expect(teamLink).toBeTruthy();
        expect(teamLink?.getAttribute('aria-label')).toBe('Open Staff Wolves in My Teams');

        await clickButton(container, 'Players');
        await waitForText(container, 'No players linked yet');
    });

    it('shows a useful empty Home state when the live Home service fails', async () => {
        homeMocks.loadParentHome.mockRejectedValueOnce(new Error('Home service down'));

        const { container } = await renderApp('/home');

        await waitForText(container, 'Home service down');
        expect(container.textContent).toContain('All caught up');
        expect(container.textContent).toContain('Team chats');
        expect(container.textContent).toContain('Caught up');
        expect(container.textContent).toContain('No upcoming events');
        expect(container.textContent).not.toContain('Loading Home');
    });
});
