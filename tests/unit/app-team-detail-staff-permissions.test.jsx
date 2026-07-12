// @vitest-environment jsdom
import React, { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const teamDetailMocks = vi.hoisted(() => ({
    addRosterPlayerForApp: vi.fn(),
    loadParentTeamDetail: vi.fn(),
    loadParentTeamDetailBootstrap: vi.fn(),
    loadRosterFieldDefinitionsForApp: vi.fn(),
    loadTeamDetailInsights: vi.fn(),
    loadTeamDetailSponsors: vi.fn(),
    loadTeamStaffPermissions: vi.fn(),
    grantScorekeeperAccessForApp: vi.fn(),
    grantTeamMediaManagerAccessForApp: vi.fn(),
    grantVideographerAccessForApp: vi.fn(),
    revokeScorekeeperAccessForApp: vi.fn(),
    revokeTeamMediaManagerAccessForApp: vi.fn(),
    revokeVideographerAccessForApp: vi.fn(),
    inviteTeamAdminForApp: vi.fn(),
    saveTeamScheduleNotificationsForApp: vi.fn(),
    buildPublicTeamGamesIcsUrl: vi.fn((teamId) => `https://us-central1-all-plays-prod.cloudfunctions.net/publicTeamGamesIcs?teamId=${encodeURIComponent(teamId)}`),
    canExposePublicFanFeed: vi.fn(() => false)
}));
const publicActionMocks = vi.hoisted(() => ({
    copyPublicText: vi.fn(),
    openPublicUrl: vi.fn(),
    sharePublicUrl: vi.fn()
}));

vi.mock('../../apps/app/src/lib/teamDetailService.ts', () => teamDetailMocks);
vi.mock('../../apps/app/src/lib/publicActions.ts', () => publicActionMocks);
vi.mock('../../apps/app/src/lib/scheduleService.ts', () => ({
    createStaffRsvpReminderPreviewLoader: vi.fn(() => ({ loadPreview: vi.fn() })),
    sendStaffRsvpReminder: vi.fn()
}));

import { TeamDetail } from '../../apps/app/src/pages/TeamDetail.tsx';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const mountedViews = [];

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
            isPublic: true,
            active: true,
            leagueUrl: null,
            bracketUrl: null,
            streamUrl: null,
            websiteUrl: 'https://allplays.ai/team.html#teamId=team-1',
            editTeamUrl: 'https://allplays.ai/edit-team.html#teamId=team-1',
            mediaUrl: 'https://allplays.ai/team-media.html#teamId=team-1',
            registrationProvider: [],
            scheduleNotifications: {
                enabled: true,
                reminderHours: 24,
                delivery: 'team_chat',
                hasExplicitReminderHours: false,
                summary: 'Fallback reminder window: 24 hours before event start. No team default is set yet.'
            }
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
        canManageAdmins: Boolean(staffPermissions),
        staffPermissions,
        counts: { games: 0, practices: 0, completedGames: 0 }
    };
}

async function renderTeamDetail(staffPermissions) {
    teamDetailMocks.loadParentTeamDetailBootstrap.mockResolvedValue(makeModel(staffPermissions));
    teamDetailMocks.loadParentTeamDetail.mockResolvedValue(makeModel(staffPermissions));
    teamDetailMocks.loadTeamStaffPermissions.mockResolvedValue(staffPermissions);
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
    mountedViews.push({ container, root });
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

afterEach(async () => {
    while (mountedViews.length) {
        const view = mountedViews.pop();
        await act(async () => {
            view.root.unmount();
        });
        view.container.remove();
    }
});

beforeEach(() => {
    vi.clearAllMocks();
    window.requestAnimationFrame = (callback) => {
        callback(0);
        return 0;
    };
    window.scrollTo = vi.fn();
    publicActionMocks.copyPublicText.mockResolvedValue('copied');
    teamDetailMocks.loadTeamDetailInsights.mockResolvedValue({ leaderboards: [], trackingSummaries: [] });
    teamDetailMocks.loadTeamDetailSponsors.mockResolvedValue({ sponsors: [] });
    teamDetailMocks.grantScorekeeperAccessForApp.mockResolvedValue(undefined);
    teamDetailMocks.grantTeamMediaManagerAccessForApp.mockResolvedValue(undefined);
    teamDetailMocks.grantVideographerAccessForApp.mockResolvedValue(undefined);
    teamDetailMocks.revokeScorekeeperAccessForApp.mockResolvedValue(undefined);
    teamDetailMocks.revokeTeamMediaManagerAccessForApp.mockResolvedValue(undefined);
    teamDetailMocks.revokeVideographerAccessForApp.mockResolvedValue(undefined);
    teamDetailMocks.inviteTeamAdminForApp.mockResolvedValue({
        email: 'newcoach@example.com',
        status: 'sent',
        code: 'CODE123',
        teamName: 'Bears',
        acceptInviteUrl: 'https://allplays.ai/accept-invite?code=CODE123&type=admin'
    });
    teamDetailMocks.saveTeamScheduleNotificationsForApp.mockResolvedValue({
        enabled: true,
        reminderHours: 24,
        delivery: 'team_chat',
        hasExplicitReminderHours: true,
        summary: 'Team default reminder window: 24 hours before event start.'
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
            scorekeeperGrantTargets: [],
            videographerGrantTargets: [],
            hasAnyStaff: true
        });

        await clickButton(container, 'More');

        expect(container.textContent).toContain('Team Staff & Permissions');
        expect(container.textContent).toContain('owner@example.com · Owner');
        expect(container.textContent).toContain('pending@example.com · Pending admin invite');
        expect(container.textContent).toContain('scorekeeper-1');
        expect(container.textContent).toContain('No Stream & Score volunteers are assigned yet.');
        expect(container.textContent).toContain('No general volunteer permissions are assigned yet.');
        expect(container.textContent).toContain('Owners and platform admins can manage team admins here in the app.');
        expect(container.textContent).not.toContain('Manage staff');
    });



    it('blocks duplicate staff and pending invite emails before calling the service', async () => {
        const { container } = await renderTeamDetail({
            staff: [{ label: 'owner@example.com', role: 'Owner' }, { label: 'coach@example.com', role: 'Admin' }],
            pendingInvites: ['pending@example.com'],
            helperPermissions: [],
            scorekeeperGrantTargets: [],
            videographerGrantTargets: [],
            hasAnyStaff: true
        });

        await clickButton(container, 'More');
        await fillInput(container, '#team-admin-invite-email', ' Pending@Example.com ');
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
            scorekeeperGrantTargets: [],
            videographerGrantTargets: [],
            hasAnyStaff: true
        });

        await clickButton(container, 'More');
        await fillInput(container, '#team-admin-invite-email', ' NewCoach@Example.com ');
        await clickButton(container, 'Send invite');

        expect(teamDetailMocks.inviteTeamAdminForApp).toHaveBeenCalledWith('team-1', 'newcoach@example.com', auth.user);
        expect(teamDetailMocks.loadParentTeamDetail).toHaveBeenCalledTimes(2);
        expect(container.textContent).toContain('Email delivery needs a fallback for newcoach@example.com.');
        await clickButton(container, 'Copy code');
        await clickButton(container, 'Copy link');
        expect(publicActionMocks.copyPublicText).toHaveBeenCalledWith('CODE123');
        expect(publicActionMocks.copyPublicText).toHaveBeenCalledWith('https://allplays.ai/accept-invite?code=CODE123&type=admin');
    });

    it('keeps the screening block message visible when a helper grant is rejected', async () => {
        teamDetailMocks.grantScorekeeperAccessForApp.mockRejectedValueOnce(new Error('Screening must be cleared before volunteer or staff access can be granted.'));
        const { container } = await renderTeamDetail({
            staff: [{ label: 'owner@example.com', role: 'Owner' }],
            pendingInvites: [],
            helperPermissions: [],
            scorekeeperGrantTargets: [
                { userId: 'parent-1', name: 'Parent One', email: 'parent@example.com', playerNames: ['Sam Wing'], isGranted: false }
            ],
            videographerGrantTargets: [],
            hasAnyStaff: true
        });

        await clickButton(container, 'More');
        await clickButton(container, 'Grant scorekeeper');

        expect(container.textContent).toContain('Screening must be cleared before volunteer or staff access can be granted.');
    });

    it('grants scorekeeper access to an existing linked team member and refreshes staff state', async () => {
        const { container } = await renderTeamDetail({
            staff: [{ label: 'owner@example.com', role: 'Owner' }],
            pendingInvites: [],
            helperPermissions: [],
            scorekeeperGrantTargets: [
                { userId: 'parent-1', name: 'Parent One', email: 'parent@example.com', playerNames: ['Sam Wing'], isGranted: false }
            ],
            videographerGrantTargets: [],
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
            videographerGrantTargets: [],
            hasAnyStaff: true
        });

        await clickButton(container, 'More');

        expect(container.textContent).toContain('Can score games. Linked to Pat Star.');
        await clickButton(container, 'Revoke scorekeeper');

        expect(teamDetailMocks.revokeScorekeeperAccessForApp).toHaveBeenCalledWith('team-1', 'scorekeeper-1');
        expect(teamDetailMocks.loadParentTeamDetail).toHaveBeenCalledTimes(2);
        expect(container.textContent).toContain('Scorekeeper access revoked.');
    });

    it('grants Team Media manager access to an existing linked team member and refreshes staff state', async () => {
        const { container } = await renderTeamDetail({
            staff: [{ label: 'owner@example.com', role: 'Owner' }],
            pendingInvites: [],
            helperPermissions: [],
            scorekeeperGrantTargets: [],
            teamMediaManagerGrantTargets: [
                { userId: 'parent-1', name: 'Parent One', email: 'parent@example.com', playerNames: ['Sam Wing'], isGranted: false }
            ],
            videographerGrantTargets: [],
            hasAnyStaff: true
        });

        await clickButton(container, 'More');

        expect(container.textContent).toContain('Team Media manager access');
        expect(container.textContent).toContain('No Team Media manager grant. Linked to Sam Wing.');
        await clickButton(container, 'Grant media manager');

        expect(teamDetailMocks.grantTeamMediaManagerAccessForApp).toHaveBeenCalledWith('team-1', 'parent-1');
        expect(teamDetailMocks.loadParentTeamDetail).toHaveBeenCalledTimes(2);
        expect(container.textContent).toContain('Team Media manager access granted.');
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
            videographerGrantTargets: [],
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

    it('grants videographer access to an existing linked team member and refreshes staff state', async () => {
        const { container } = await renderTeamDetail({
            staff: [{ label: 'owner@example.com', role: 'Owner' }],
            pendingInvites: [],
            helperPermissions: [],
            scorekeeperGrantTargets: [],
            videographerGrantTargets: [
                { userId: 'parent-1', name: 'Parent One', email: 'parent@example.com', playerNames: ['Sam Wing'], isGranted: false }
            ],
            hasAnyStaff: true
        });

        await clickButton(container, 'More');

        expect(container.textContent).toContain('Videographer access');
        expect(container.textContent).toContain('No videographer helper grant. Linked to Sam Wing.');
        await clickButton(container, 'Grant videographer');

        expect(teamDetailMocks.grantVideographerAccessForApp).toHaveBeenCalledWith('team-1', 'parent-1');
        expect(teamDetailMocks.loadParentTeamDetail).toHaveBeenCalledTimes(2);
        expect(container.textContent).toContain('Videographer access granted.');
    });

    it('revokes videographer access from an existing linked team member and refreshes staff state', async () => {
        const { container } = await renderTeamDetail({
            staff: [{ label: 'owner@example.com', role: 'Owner' }],
            pendingInvites: [],
            helperPermissions: [],
            scorekeeperGrantTargets: [],
            videographerGrantTargets: [
                { userId: 'video-1', name: 'Video Helper', email: '', playerNames: ['Pat Star'], isGranted: true }
            ],
            hasAnyStaff: true
        });

        await clickButton(container, 'More');

        expect(container.textContent).toContain('Can capture live-game camera and media. Linked to Pat Star.');
        await clickButton(container, 'Revoke videographer');

        expect(teamDetailMocks.revokeVideographerAccessForApp).toHaveBeenCalledWith('team-1', 'video-1');
        expect(teamDetailMocks.loadParentTeamDetail).toHaveBeenCalledTimes(2);
        expect(container.textContent).toContain('Videographer access revoked.');
    });
});
