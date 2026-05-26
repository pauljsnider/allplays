// @vitest-environment jsdom
import React, { act } from '../../apps/app/node_modules/react/index.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRoot } from '../../apps/app/node_modules/react-dom/client.js';
import { MemoryRouter, Route, Routes, useLocation } from '../../apps/app/node_modules/react-router-dom/dist/index.mjs';

const dbMocks = vi.hoisted(() => ({
    getTeams: vi.fn()
}));

const homeMocks = vi.hoisted(() => ({
    loadParentHome: vi.fn()
}));

const firebaseMocks = vi.hoisted(() => ({
    db: {},
    collectionGroup: vi.fn((db, collectionName) => ({ db, collectionName })),
    getDocs: vi.fn(),
    query: vi.fn((...parts) => ({ parts })),
    where: vi.fn((field, op, value) => ({ type: 'where', field, op, value })),
    orderBy: vi.fn((field) => ({ type: 'orderBy', field })),
    limit: vi.fn((count) => ({ type: 'limit', count }))
}));

const publicActionMocks = vi.hoisted(() => ({
    openPublicUrl: vi.fn()
}));

const helpMocks = vi.hoisted(() => ({
    searchHelpKnowledge: vi.fn()
}));

vi.mock('../../js/db.js', () => dbMocks);
vi.mock('../../js/firebase.js', () => firebaseMocks);
vi.mock('../../apps/app/src/lib/homeService.ts', () => homeMocks);
vi.mock('../../apps/app/src/lib/publicActions.ts', () => publicActionMocks);
vi.mock('../../apps/app/src/lib/helpKnowledgeService.ts', () => helpMocks);

import { AppShell } from '../../apps/app/src/components/AppShell.tsx';
import { resetAppSearchCacheForTests } from '../../apps/app/src/lib/searchService.ts';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const auth = {
    user: {
        uid: 'user-1',
        email: 'parent@example.com',
        displayName: 'Pat Parent',
        roles: ['parent'],
        parentOf: [{ teamId: 'team-home', playerId: 'player-home' }]
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

function firestorePlayer(path, data) {
    return {
        id: path.split('/').pop(),
        ref: { path },
        data: () => data
    };
}

function RouteEcho() {
    const location = useLocation();
    return React.createElement('div', { 'data-testid': 'route' }, `${location.pathname}${location.search}`);
}

async function renderShell(authOverride = auth, initialEntry = '/home') {
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
                React.createElement(Route, {
                    path: '*',
                    element: React.createElement(AppShell, { auth: authOverride }, React.createElement(RouteEcho))
                })
            )
        ));
    });
    await flush();
    return { container, root };
}

async function flush(ms = 0) {
    await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, ms));
    });
}

function buttonByText(container, text) {
    const button = Array.from(container.querySelectorAll('button')).find((candidate) => candidate.textContent.includes(text) || candidate.getAttribute('aria-label') === text);
    if (!button) throw new Error(`Button not found: ${text}`);
    return button;
}

async function clickButton(container, text) {
    await act(async () => {
        buttonByText(container, text).dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    await flush();
}

async function pressDialogKey(container, key) {
    const dialog = container.querySelector('[role="dialog"]');
    if (!dialog) throw new Error('Search dialog not found');
    await act(async () => {
        dialog.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
    });
    await flush();
}

async function fillSearch(container, value) {
    const input = container.querySelector('input[aria-label="Search teams, players, actions, help"]');
    if (!input) throw new Error('Search input not found');
    await act(async () => {
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
        setter.call(input, value);
        input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }));
    });
    await flush(350);
}

beforeEach(() => {
    vi.clearAllMocks();
    resetAppSearchCacheForTests();
    window.matchMedia = vi.fn(() => ({
        matches: false,
        media: '(min-width: 1024px)',
        addEventListener: vi.fn(),
        removeEventListener: vi.fn()
    }));
    dbMocks.getTeams.mockResolvedValue([
        { id: 'team-1', name: 'Bears', sport: 'Basketball', zip: '66210', isPublic: true },
        { id: 'team-private', name: 'Private', sport: 'Soccer', isPublic: false }
    ]);
    homeMocks.loadParentHome.mockResolvedValue({
        teams: [{
            teamId: 'team-home',
            teamName: 'Home Rockets',
            sport: 'Soccer',
            players: [],
            nextEvent: null,
            eventCount: 0,
            unreadCount: 0,
            openActions: 0
        }]
    });
    firebaseMocks.getDocs.mockResolvedValue({
        docs: [
            firestorePlayer('teams/team-1/players/player-1', { name: 'Pat Star', number: '9' }),
            firestorePlayer('teams/team-private/players/player-2', { name: 'Pat Secret', number: '10' })
        ]
    });
    helpMocks.searchHelpKnowledge.mockReturnValue([]);
});

afterEach(() => {
    document.body.innerHTML = '';
});

describe('React app shell search', () => {
    it('loads actions and visible teams, searches players, and navigates native results', async () => {
        const { container } = await renderShell();

        await clickButton(container, 'Search');
        expect(container.textContent).toContain('Browse Teams');
        await flush();
        expect(container.textContent).toContain('Bears');
        expect(container.textContent).toContain('Home Rockets');
        expect(container.textContent).not.toContain('Private');
        expect(container.textContent).toContain('Type at least 2 characters to search players');

        await fillSearch(container, 'pat');
        expect(firebaseMocks.getDocs).toHaveBeenCalled();
        expect(container.textContent).toContain('#9 Pat Star');
        expect(container.textContent).not.toContain('Pat Secret');

        await clickButton(container, '#9 Pat Star');
        expect(container.querySelector('[data-testid="route"]').textContent).toBe('/players/team-1/player-1');
    });

    it('renders help matches and opens help articles inside the app', async () => {
        helpMocks.searchHelpKnowledge.mockReturnValue([{
            id: 'account-password-reset',
            title: 'Reset a password',
            file: 'help-account.html',
            url: 'https://allplays.ai/help-account.html',
            roles: ['parent'],
            summary: 'Recover account access.',
            snippet: 'Use password reset when a parent cannot sign in.',
            score: 42
        }]);
        const { container } = await renderShell();

        await clickButton(container, 'Search');
        await fillSearch(container, 'password reset');

        expect(container.textContent).toContain('Help');
        expect(container.textContent).toContain('Reset a password');
        expect(container.textContent).toContain('Use password reset when a parent cannot sign in.');
        expect(container.textContent).toContain('parent');

        await pressDialogKey(container, 'Enter');
        expect(container.querySelector('[data-testid="route"]').textContent).toBe('/help/account-password-reset');
        expect(publicActionMocks.openPublicUrl).not.toHaveBeenCalled();
    });

    it('opens website-only search actions through the public URL adapter', async () => {
        const { container } = await renderShell();

        await clickButton(container, 'Search');
        await clickButton(container, 'Browse Teams');

        expect(publicActionMocks.openPublicUrl).toHaveBeenCalledWith('https://allplays.ai/teams.html');
    });

    it('opens the add workflow launcher with native and website actions', async () => {
        const { container } = await renderShell();

        await clickButton(container, 'Add');

        expect(container.textContent).toContain('Add to ALL PLAYS');
        expect(container.textContent).toContain('Create team');
        expect(container.textContent).toContain('Add player');
        expect(container.textContent).toContain('Game or practice');
        expect(container.textContent).toContain('Invite family');

        await clickButton(container, 'Join with code');
        expect(container.querySelector('[data-testid="route"]').textContent).toBe('/accept-invite');

        await clickButton(container, 'Add');
        await clickButton(container, 'Create team');
        expect(publicActionMocks.openPublicUrl).toHaveBeenCalledWith('https://allplays.ai/dashboard.html');
    });

    it('supports Cmd/Ctrl+K and Enter keyboard navigation', async () => {
        const { container } = await renderShell();

        await act(async () => {
            window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true }));
        });
        await flush();
        expect(container.textContent).toContain('Browse Teams');

        await pressDialogKey(container, 'ArrowDown');
        await pressDialogKey(container, 'ArrowDown');
        await pressDialogKey(container, 'Enter');

        expect(container.querySelector('[data-testid="route"]').textContent).toBe('/teams');
    });

    it('closes search with Escape and the close button without changing routes', async () => {
        const { container } = await renderShell();

        await clickButton(container, 'Search');
        expect(container.querySelector('[role="dialog"]')).toBeTruthy();

        await pressDialogKey(container, 'Escape');
        expect(container.querySelector('[role="dialog"]')).toBeNull();
        expect(container.querySelector('[data-testid="route"]').textContent).toBe('/home');

        await clickButton(container, 'Search');
        expect(container.querySelector('[role="dialog"]')).toBeTruthy();
        await clickButton(container, 'Close search');
        expect(container.querySelector('[role="dialog"]')).toBeNull();
    });

    it('shows signed-out search actions without loading parent-only team access', async () => {
        const signedOutAuth = {
            ...auth,
            user: null,
            profile: null,
            roles: [],
            isParent: false
        };

        const { container } = await renderShell(signedOutAuth);

        await clickButton(container, 'Search');
        await flush();
        expect(container.textContent).toContain('Browse Teams');
        expect(container.textContent).toContain('Sign In');
        expect(container.textContent).toContain('Get Started');
        expect(container.textContent).toContain('Bears');
        expect(homeMocks.loadParentHome).not.toHaveBeenCalled();

        await clickButton(container, 'Get Started');
        expect(container.querySelector('[data-testid="route"]').textContent).toBe('/auth?mode=signup');
    });

    it('keeps one-character player searches local and shows empty result states', async () => {
        dbMocks.getTeams.mockResolvedValueOnce([
            { id: 'team-1', name: 'Bears', sport: 'Basketball', zip: '66210', isPublic: true }
        ]);
        homeMocks.loadParentHome.mockResolvedValueOnce({ teams: [] });
        firebaseMocks.getDocs.mockResolvedValueOnce({ docs: [] });
        const { container } = await renderShell();

        await clickButton(container, 'Search');
        await fillSearch(container, 'p');
        expect(firebaseMocks.getDocs).not.toHaveBeenCalled();
        expect(container.textContent).toContain('Type at least 2 characters to search players');

        await fillSearch(container, 'zzzz');
        expect(firebaseMocks.getDocs).toHaveBeenCalled();
        expect(container.textContent).toContain('No matching teams');
        expect(container.textContent).toContain('No matching players');
        expect(container.textContent).toContain('No results');
    });

    it('shows team and player search errors in the dialog', async () => {
        dbMocks.getTeams.mockRejectedValueOnce(new Error('Site teams unavailable'));
        homeMocks.loadParentHome.mockRejectedValueOnce(new Error('Home teams unavailable'));
        const { container } = await renderShell();

        await clickButton(container, 'Search');
        await flush();
        expect(container.textContent).toContain('Site teams unavailable');
        expect(container.textContent).toContain('Type at least 2 characters to search players');

        await clickButton(container, 'Close search');
        resetAppSearchCacheForTests();
        dbMocks.getTeams.mockResolvedValueOnce([
            { id: 'team-1', name: 'Bears', sport: 'Basketball', zip: '66210', isPublic: true }
        ]);
        homeMocks.loadParentHome.mockResolvedValueOnce({ teams: [] });
        firebaseMocks.getDocs.mockRejectedValue(Object.assign(new Error('Permission denied'), { code: 'permission-denied' }));

        await clickButton(container, 'Search');
        await fillSearch(container, 'pa');
        expect(container.textContent).toContain('Player search unavailable for this account.');

        await clickButton(container, 'Close search');
        resetAppSearchCacheForTests();
        dbMocks.getTeams.mockResolvedValueOnce([
            { id: 'team-1', name: 'Bears', sport: 'Basketball', zip: '66210', isPublic: true }
        ]);
        homeMocks.loadParentHome.mockResolvedValueOnce({ teams: [] });
        firebaseMocks.getDocs.mockRejectedValue(Object.assign(new Error('not ready yet: create index'), { code: 'failed-precondition' }));

        await clickButton(container, 'Search');
        await fillSearch(container, 'pa');
        expect(container.textContent).toContain('Player search index is building. Try again in a few minutes.');
    });
});
