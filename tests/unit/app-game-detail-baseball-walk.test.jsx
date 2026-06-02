// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GameDetail } from '../../apps/app/src/pages/GameDetail.tsx';

vi.mock('../../apps/app/src/data/mockData', () => ({
    mockPlayers: [
        {
            id: 'player-baseball-1',
            name: 'Slugger',
            teamId: 'team-baseball',
            teamName: 'Sharks',
            number: '7',
            role: 'athlete'
        },
        {
            id: 'player-basketball-1',
            name: 'Guard',
            teamId: 'team-basketball',
            teamName: 'Bears',
            number: '12',
            role: 'athlete'
        }
    ],
    mockTeams: [
        {
            id: 'team-baseball',
            name: 'Sharks',
            sport: 'Baseball',
            role: 'Coach',
            record: '8-3',
            rosterSize: 11,
            nextGameId: 'game-baseball',
            unreadCount: 0
        },
        {
            id: 'team-basketball',
            name: 'Bears',
            sport: 'Basketball',
            role: 'Coach',
            record: '5-2',
            rosterSize: 9,
            nextGameId: 'game-basketball',
            unreadCount: 0
        }
    ],
    mockGames: [
        {
            id: 'game-baseball',
            teamId: 'team-baseball',
            teamName: 'Sharks',
            opponent: 'Falcons',
            type: 'game',
            dateLabel: 'Sat, May 23',
            timeLabel: '10:30 AM',
            location: 'Diamond 1',
            playerIds: ['player-baseball-1'],
            availability: 'needed',
            rideshare: { seatsLeft: 2, requests: 1 },
            assignments: ['Scorebook: Jamie'],
            status: 'upcoming'
        },
        {
            id: 'game-basketball',
            teamId: 'team-basketball',
            teamName: 'Bears',
            opponent: 'Rockets',
            type: 'game',
            dateLabel: 'Thu, May 28',
            timeLabel: '7:15 PM',
            location: 'North Gym',
            playerIds: ['player-basketball-1'],
            availability: 'maybe',
            rideshare: { seatsLeft: 4, requests: 0 },
            assignments: ['Clock: Assigned'],
            status: 'upcoming'
        }
    ]
}));

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
        { path: '/schedule', element: React.createElement('div', null, 'Schedule') }
    ], {
        initialEntries: [initialPath]
    });

    await act(async () => {
        root.render(React.createElement(RouterProvider, { router }));
    });

    return { container, root, router };
}

function getButton(container, text) {
    const button = Array.from(container.querySelectorAll('button')).find((candidate) => candidate.textContent.includes(text));
    if (!button) throw new Error(`Missing button: ${text}`);
    return button;
}

afterEach(() => {
    document.body.innerHTML = '';
    vi.clearAllMocks();
});

describe('app GameDetail baseball walk scoring', () => {
    it('applies a walk from the UI and updates bases, score, and count', async () => {
        const { container, root } = await renderGameDetail();

        await act(async () => {
            container.querySelector('[data-testid="baseball-base-first"]').click();
        });
        await act(async () => {
            container.querySelector('[data-testid="baseball-base-second"]').click();
        });
        await act(async () => {
            container.querySelector('[data-testid="baseball-base-third"]').click();
        });
        await act(async () => {
            getButton(container, 'Walk').click();
        });

        expect(container.textContent).toContain('Walk, 1 run scored');
        expect(container.textContent).toContain('Sharks 0 · Falcons 1');
        expect(container.querySelector('[data-testid="baseball-count"]').textContent).toBe('0-0');
        expect(container.querySelector('[data-testid="baseball-base-first"]').getAttribute('aria-pressed')).toBe('true');
        expect(container.querySelector('[data-testid="baseball-base-second"]').getAttribute('aria-pressed')).toBe('true');
        expect(container.querySelector('[data-testid="baseball-base-third"]').getAttribute('aria-pressed')).toBe('true');

        await act(async () => {
            root.unmount();
        });
    });

    it('hides baseball scoring controls for non-baseball games', async () => {
        const { container, root } = await renderGameDetail('/games/game-basketball');

        expect(container.textContent).not.toContain('Baseball live scoring');

        await act(async () => {
            root.unmount();
        });
    });

    it('keeps hook order stable when navigating from a valid game to a missing game', async () => {
        const { container, root, router } = await renderGameDetail('/games/game-baseball');

        expect(container.textContent).toContain('Baseball live scoring');

        await act(async () => {
            await router.navigate('/games/unknown-game');
        });

        expect(container.textContent).toContain('Schedule');

        await act(async () => {
            root.unmount();
        });
    });
});
