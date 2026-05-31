// @vitest-environment jsdom
import React, { act } from '../../apps/app/node_modules/react/index.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createRoot } from '../../apps/app/node_modules/react-dom/client.js';
import { MemoryRouter, Route, Routes } from '../../apps/app/node_modules/react-router-dom/dist/index.mjs';

const teamDetailMocks = vi.hoisted(() => ({
    loadParentTeamDetail: vi.fn(),
    grantScorekeeperAccessForApp: vi.fn(),
    revokeScorekeeperAccessForApp: vi.fn(),
    inviteTeamAdminForApp: vi.fn()
}));
const publicActionMocks = vi.hoisted(() => ({
    copyPublicText: vi.fn(),
    openPublicUrl: vi.fn()
}));

vi.mock('../../apps/app/src/lib/teamDetailService.ts', () => teamDetailMocks);
vi.mock('../../apps/app/src/lib/publicActions.ts', () => publicActionMocks);
vi.mock('../../apps/app/src/lib/scheduleService.ts', () => ({
    loadStaffRsvpReminderPreview: vi.fn(),
    sendStaffRsvpReminder: vi.fn()
}));

import { TeamDetail } from '../../apps/app/src/pages/TeamDetail.tsx';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const auth = {
    user: { uid: 'coach-1', email: 'coach@example.com', displayName: 'Coach', roles: ['coach'] },
    profile: {},
    loading: false,
    error: null,
    roles: ['coach'],
    isParent: false,
    isCoach: true,
    isAdmin: false,
    isPlatformAdmin: false,
    refresh: async () => {},
    signOut: async () => {}
};

function makeModel(staffPermissions) {
    return {
        team: {
            id: 'team-1',
            name: 'Bears',
            sport: 'Basketball',
            photoUrl: null,
            description: '',
            zip: '',
            leagueUrl: null,
            bracketUrl: null,
            streamUrl: null,
            websiteUrl: 'https://allplays.ai/team.html#teamId=team-1',
            editTeamUrl: 'https://allplays.ai/edit-team.html#teamId=team-1',
            mediaUrl: 'https://allplays.ai/team-media.html#teamId=team-1',
            registrationProvider: []
        },
        players: [],
        linkedPlayers: [],
        upcomingEvents: [],
        recentResults: [],
        nextEvent: null,
        record: { label: '2026', wins: 0, losses: 0, ties: 0, gamesPlayed: 0, winPercentage: null },
        standings: { enabled: false, label: 'No standings configured', rows: [], currentRow: null },
        leaderboards: [],
        trackingSummaries: [],
        sponsors: [],
        canManageTeam: Boolean(staffPermissions),
        staffPermissions,
        counts: { games: 0, practices: 0, completedGames: 0 }
    };
}

async function renderTeamDetail(staffPermissions) {
    teamDetailMocks.loadParentTeamDetail.mockResolvedValue(makeModel(staffPermissions));
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


async function fillInput(container, selector, value) {
    const input = container.querySelector(selector);
    if (!input) throw new Error(`Input not found: ${selector}`);
    await act(async () => {
        input.value = value;
        input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await flush();
}

async function clickButton(container, text) {
    const button = Array.from(container.querySelectorAll('button')).find((candidate) => candidate.textContent.includes(text));
    if (!button) throw new Error(`Button not found: ${text}`);
    await act(async () => {
        button.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
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
    publicActionMocks.copyPublicText.mockResolvedValue('copied');
    teamDetailMocks.grantScorekeeperAccessForApp.mockResolvedValue(undefined);
    teamDetailMocks.revokeScorekeeperAccessForApp.mockResolvedValue(undefined);
    teamDetailMocks.inviteTeamAdminForApp.mockResolvedValue({
        email: 'newcoach@example.com',
        status: 'sent',
        code: 'CODE123',
        teamName: 'Bears',
        acceptInviteUrl: 'https://allplays.ai/accept-invite?code=CODE123&type=admin'
    });
});

describe('React app TeamDetail staff permissions overview', () => {
    it('renders staff, pending invites, helper empty states, and manage fallback for admins', async () => {
        const { container } = await renderTeamDetail({
            staff: [{ label: 'owner@example.com', role: 'Owner' }, { label: 'coach@example.com', role: 'Admin' }],
            pendingInvites: ['pending@example.com'],
            helperPermissions: [
                { key: 'scorekeeper', title: 'Scorekeeper', grants: ['scorekeeper-1'], emptyText: 'No scorekeeper helpers are assigned yet.' },
                { key: 'stream-score', title: 'Stream & Score', grants: [], emptyText: 'No Stream & Score volunteers are assigned yet.' },
                { key: 'videographer', title: 'Videographer', grants: ['video@example.com'], emptyText: 'No videographer helpers are assigned yet.' },
                { key: 'volunteer', title: 'Volunteer', grants: [], emptyText: 'No general volunteer permissions are assigned yet.' }
            ],
            hasAnyStaff: true
        });

        await clickButton(container, 'More');

        expect(container.textContent).toContain('Team Staff & Permissions');
        expect(container.textContent).toContain('owner@example.com · Owner');
        expect(container.textContent).toContain('pending@example.com · Pending admin invite');
        expect(container.textContent).toContain('scorekeeper-1');
        expect(container.textContent).toContain('No Stream & Score volunteers are assigned yet.');
        expect(container.textContent).toContain('No general volunteer permissions are assigned yet.');

        await clickButton(container, 'Manage staff');
        expect(publicActionMocks.openPublicUrl).toHaveBeenCalledWith('https://allplays.ai/edit-team.html#teamId=team-1');
    });



    it('blocks duplicate staff and pending invite emails before calling the service', async () => {
        const { container } = await renderTeamDetail({
            staff: [{ label: 'owner@example.com', role: 'Owner' }, { label: 'coach@example.com', role: 'Admin' }],
            pendingInvites: ['pending@example.com'],
            helperPermissions: [],
            hasAnyStaff: true
        });

        await clickButton(container, 'More');
        await fillInput(container, 'input[type="email"]', ' Pending@Example.com ');
        await clickButton(container, 'Send invite');

        expect(container.textContent).toContain('That email is already listed as staff or pending.');
        expect(teamDetailMocks.inviteTeamAdminForApp).not.toHaveBeenCalled();
    });

    it('sends one native admin invite, refreshes staff state, and exposes fallback copy controls', async () => {
        teamDetailMocks.inviteTeamAdminForApp.mockResolvedValueOnce({
            email: 'newcoach@example.com',
            status: 'fallback_code',
            code: 'CODE123',
            teamName: 'Bears',
            acceptInviteUrl: 'https://allplays.ai/accept-invite?code=CODE123&type=admin'
        });
        const { container } = await renderTeamDetail({
            staff: [{ label: 'owner@example.com', role: 'Owner' }],
            pendingInvites: [],
            helperPermissions: [],
            hasAnyStaff: true
        });

        await clickButton(container, 'More');
        await fillInput(container, 'input[type="email"]', ' NewCoach@Example.com ');
        await clickButton(container, 'Send invite');

        expect(teamDetailMocks.inviteTeamAdminForApp).toHaveBeenCalledWith('team-1', 'newcoach@example.com');
        expect(teamDetailMocks.loadParentTeamDetail).toHaveBeenCalledTimes(2);
        expect(container.textContent).toContain('Email delivery needs a fallback for newcoach@example.com.');
        await clickButton(container, 'Copy code');
        await clickButton(container, 'Copy link');
        expect(publicActionMocks.copyPublicText).toHaveBeenCalledWith('CODE123');
        expect(publicActionMocks.copyPublicText).toHaveBeenCalledWith('https://allplays.ai/accept-invite?code=CODE123&type=admin');
    });

    it('grants scorekeeper access to an existing linked team member and refreshes staff state', async () => {
        const { container } = await renderTeamDetail({
            staff: [{ label: 'owner@example.com', role: 'Owner' }],
            pendingInvites: [],
            helperPermissions: [],
            scorekeeperGrantTargets: [
                { userId: 'parent-1', name: 'Parent One', email: 'parent@example.com', playerNames: ['Sam Wing'], isGranted: false }
            ],
            hasAnyStaff: true
        });

        await clickButton(container, 'More');

        expect(container.textContent).toContain('Scorekeeper helper access');
        expect(container.textContent).toContain('No scorekeeper helper grant. Linked to Sam Wing.');
        await clickButton(container, 'Grant scorekeeper');

        expect(teamDetailMocks.grantScorekeeperAccessForApp).toHaveBeenCalledWith('team-1', 'parent-1');
        expect(teamDetailMocks.loadParentTeamDetail).toHaveBeenCalledTimes(2);
        expect(container.textContent).toContain('Scorekeeper access granted.');
    });

    it('revokes scorekeeper access from an existing linked team member and refreshes staff state', async () => {
        const { container } = await renderTeamDetail({
            staff: [{ label: 'owner@example.com', role: 'Owner' }],
            pendingInvites: [],
            helperPermissions: [],
            scorekeeperGrantTargets: [
                { userId: 'scorekeeper-1', name: 'Score Keeper', email: '', playerNames: ['Pat Star'], isGranted: true }
            ],
            hasAnyStaff: true
        });

        await clickButton(container, 'More');

        expect(container.textContent).toContain('Can score games. Linked to Pat Star.');
        await clickButton(container, 'Revoke scorekeeper');

        expect(teamDetailMocks.revokeScorekeeperAccessForApp).toHaveBeenCalledWith('team-1', 'scorekeeper-1');
        expect(teamDetailMocks.loadParentTeamDetail).toHaveBeenCalledTimes(2);
        expect(container.textContent).toContain('Scorekeeper access revoked.');
    });

    it('disables individual scorekeeper grants when all confirmed members can score games', async () => {
        const { container } = await renderTeamDetail({
            staff: [{ label: 'owner@example.com', role: 'Owner' }],
            pendingInvites: [],
            helperPermissions: [],
            scorekeepingMode: 'all_confirmed',
            scorekeeperGrantTargets: [
                { userId: 'parent-1', name: 'Parent One', email: 'parent@example.com', playerNames: ['Sam Wing'], isGranted: false }
            ],
            hasAnyStaff: true
        });

        await clickButton(container, 'More');

        expect(container.textContent).toContain('All confirmed team members can score games');
        expect(container.textContent).not.toContain('Grant scorekeeper');
        expect(teamDetailMocks.grantScorekeeperAccessForApp).not.toHaveBeenCalled();
    });

    it('hides staff permissions when the service omits the admin-only payload', async () => {
        const { container } = await renderTeamDetail(null);

        await clickButton(container, 'More');

        expect(container.textContent).not.toContain('Team Staff & Permissions');
        expect(container.textContent).not.toContain('owner@example.com');
    });
});
