// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GameDetail } from '../../apps/app/src/pages/GameDetail.tsx';

const scheduleServiceMocks = vi.hoisted(() => ({
    loadParentSchedule: vi.fn()
}));

vi.mock('../../apps/app/src/lib/scheduleService', () => scheduleServiceMocks);

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const coachAuth = {
    user: {
        uid: 'coach-1',
        email: 'coach@example.com',
        displayName: 'Coach',
        roles: ['coach']
    },
    profile: null,
    loading: false,
    error: null,
    roles: ['coach'],
    isParent: false,
    isCoach: true,
    isAdmin: false,
    isPlatformAdmin: false,
    refresh: vi.fn().mockResolvedValue(null),
    signOut: vi.fn().mockResolvedValue(undefined)
};

async function renderGameDetail(initialPath = '/games/game-baseball') {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    const router = createMemoryRouter([
        { path: '/games/:gameId', element: React.createElement(GameDetail, { auth: coachAuth }) },
        {
            path: '/schedule/:teamId/:eventId',
            element: React.createElement('div', null,
                React.createElement('h1', null, 'Availability'),
                React.createElement('div', null, 'Rideshare'),
                React.createElement('div', null, 'Assignments'),
                React.createElement('div', null, 'Live event workflow')
            )
        },
        { path: '/schedule', element: React.createElement('div', null, 'Schedule') }
    ], {
        initialEntries: [initialPath]
    });

    await act(async () => {
        root.render(React.createElement(RouterProvider, { router }));
    });

    return { container, root, router };
}

afterEach(() => {
    document.body.innerHTML = '';
    vi.clearAllMocks();
});

describe('app GameDetail route resolution', () => {
    it('routes tracked games into the live schedule event detail workflow', async () => {
        scheduleServiceMocks.loadParentSchedule.mockResolvedValue({
            children: [],
            events: [
                {
                    id: 'game-baseball',
                    teamId: 'team-baseball',
                    childId: 'player-1',
                    type: 'game'
                }
            ]
        });

        const { container, root, router } = await renderGameDetail();

        await act(async () => {
            await Promise.resolve();
        });

        expect(router.state.location.pathname).toBe('/schedule/team-baseball/game-baseball');
        expect(router.state.location.search).toBe('?childId=player-1');
        expect(container.textContent).toContain('Availability');
        expect(container.textContent).toContain('Rideshare');
        expect(container.textContent).toContain('Assignments');
        expect(container.textContent).toContain('Live event workflow');
        expect(container.textContent).not.toContain('Live chat');
        expect(scheduleServiceMocks.loadParentSchedule).toHaveBeenCalledWith(coachAuth.user, {
            hydrateDetails: false,
            expandStaffPlayers: false
        });

        await act(async () => {
            root.unmount();
        });
    });

    it('shows a recovery state when the game cannot be resolved', async () => {
        scheduleServiceMocks.loadParentSchedule.mockResolvedValue({
            children: [],
            events: []
        });

        const { container, root } = await renderGameDetail('/games/unknown-game');

        await act(async () => {
            await Promise.resolve();
        });

        expect(container.textContent).toContain('Game not available');
        expect(container.textContent).toContain('We could not find this game in your live schedule.');
        expect(container.querySelector('a[href="/schedule"]')?.textContent).toContain('Schedule');

        await act(async () => {
            root.unmount();
        });
    });
});
