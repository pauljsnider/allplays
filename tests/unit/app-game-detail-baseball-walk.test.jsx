// @vitest-environment jsdom
import React, { act } from '../../apps/app/node_modules/react/index.js';
import { createRoot } from '../../apps/app/node_modules/react-dom/client.js';
import { MemoryRouter, Route, Routes } from '../../apps/app/node_modules/react-router-dom/dist/index.mjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GameDetail } from '../../apps/app/src/pages/GameDetail.tsx';

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

async function renderGameDetail() {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
        root.render(React.createElement(
            MemoryRouter,
            { initialEntries: ['/games/game-1'] },
            React.createElement(
                Routes,
                null,
                React.createElement(Route, { path: '/games/:gameId', element: React.createElement(GameDetail, { auth: coachAuth }) })
            )
        ));
    });

    return { container, root };
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
        expect(container.textContent).toContain('Bears 0 · Falcons 1');
        expect(container.querySelector('[data-testid="baseball-count"]').textContent).toBe('0-0');
        expect(container.querySelector('[data-testid="baseball-base-first"]').getAttribute('aria-pressed')).toBe('true');
        expect(container.querySelector('[data-testid="baseball-base-second"]').getAttribute('aria-pressed')).toBe('true');
        expect(container.querySelector('[data-testid="baseball-base-third"]').getAttribute('aria-pressed')).toBe('true');

        await act(async () => {
            root.unmount();
        });
    });
});
