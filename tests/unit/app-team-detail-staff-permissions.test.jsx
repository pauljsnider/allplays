// @vitest-environment jsdom
import React, { act } from '../../apps/app/node_modules/react/index.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createRoot } from '../../apps/app/node_modules/react-dom/client.js';
import { MemoryRouter, Route, Routes } from '../../apps/app/node_modules/react-router-dom/dist/index.mjs';

const teamDetailMocks = vi.hoisted(() => ({
    loadParentTeamDetail: vi.fn()
}));
const publicActionMocks = vi.hoisted(() => ({
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

    it('hides staff permissions when the service omits the admin-only payload', async () => {
        const { container } = await renderTeamDetail(null);

        await clickButton(container, 'More');

        expect(container.textContent).not.toContain('Team Staff & Permissions');
        expect(container.textContent).not.toContain('owner@example.com');
    });
});
