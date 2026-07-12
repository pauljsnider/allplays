// @vitest-environment jsdom
import React, { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';

const dbMocks = vi.hoisted(() => ({
    getTeams: vi.fn(),
    discoverPublicTeams: vi.fn()
}));

const homeMocks = vi.hoisted(() => ({
    loadParentHome: vi.fn(),
    loadParentHomeSummary: vi.fn()
}));

const firebaseMocks = vi.hoisted(() => ({
    db: {},
    collection: vi.fn((db, collectionName) => ({ db, collectionName })),
    collectionGroup: vi.fn((db, collectionName) => ({ db, collectionName })),
    doc: vi.fn(),
    getDoc: vi.fn(),
    getDocs: vi.fn(),
    onSnapshot: vi.fn(() => vi.fn()),
    query: vi.fn((...parts) => ({ parts })),
    serverTimestamp: vi.fn(() => ({ _isServerTimestamp: true })),
    updateDoc: vi.fn(),
    where: vi.fn((field, op, value) => ({ type: 'where', field, op, value })),
    orderBy: vi.fn((field) => ({ type: 'orderBy', field })),
    limit: vi.fn((count) => ({ type: 'limit', count }))
}));

const publicActionMocks = vi.hoisted(() => ({
    openPublicUrl: vi.fn()
}));

const routePreloadMocks = vi.hoisted(() => ({
    preloadSearchRoute: vi.fn(async () => true)
}));

const helpMocks = vi.hoisted(() => ({
    searchHelpKnowledge: vi.fn()
}));

vi.mock('../../js/db.js', () => dbMocks);
vi.mock('../../js/firebase.js', () => firebaseMocks);
vi.mock('../../apps/app/src/lib/homeService.ts', () => homeMocks);
vi.mock('../../apps/app/src/lib/publicActions.ts', () => publicActionMocks);
vi.mock('../../apps/app/src/lib/helpKnowledgeService.ts', () => helpMocks);
vi.mock('../../apps/app/src/lib/searchRoutePreload.ts', () => routePreloadMocks);

import { AppShell } from '../../apps/app/src/components/AppShell.tsx';
import { resetAppSearchCache } from '../../apps/app/src/lib/searchService.ts';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const auth = {
    user: {
        uid: 'user-1',
        email: 'parent@example.com',
        displayName: 'Pat Parent',
        roles: ['parent'],
        parentOf: [{ teamId: 'team-home', teamName: 'Home Rockets', sport: 'Soccer', playerId: 'player-home' }]
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

function firestoreTeam(id, data) {
    return {
        id,
        ref: { path: `teams/${id}` },
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

async function hoverButton(container, text) {
    await act(async () => {
        buttonByText(container, text).dispatchEvent(new MouseEvent('mouseover', { bubbles: true, cancelable: true }));
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

async function waitForText(container, text) {
    for (let index = 0; index < 50; index += 1) {
        if (container.textContent.includes(text)) return;
        await flush(10);
    }
    throw new Error(`Timed out waiting for text: ${text}`);
}

beforeEach(() => {
    vi.clearAllMocks();
    resetAppSearchCache();
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
    dbMocks.discoverPublicTeams.mockImplementation(async ({ searchText } = {}) => {
        const normalized = String(searchText || '').trim().toLowerCase();
        if (!normalized) {
            return { teams: [], nextCursor: null };
        }
        if (normalized.includes('bea')) {
            return {
                teams: [
                    { id: 'team-1', name: 'Bears', sport: 'Basketball', zip: '66210', isPublic: true, appAccess: true }
                ],
                nextCursor: null
            };
        }
        return { teams: [], nextCursor: null };
    });
    homeMocks.loadParentHomeSummary.mockImplementation((...args) => homeMocks.loadParentHome(...args));
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
    firebaseMocks.getDoc.mockResolvedValue({ exists: () => true, data: () => ({}) });
    firebaseMocks.getDocs.mockImplementation(async (request) => {
        const parts = request?.parts || [];
        const collectionName = parts.find((part) => part?.collectionName)?.collectionName;
        const ownerQuery = parts.find((part) => part?.type === 'where' && part.field === 'ownerId');
        const adminQuery = parts.find((part) => part?.type === 'where' && part.field === 'adminEmails');
        const streamMemberQuery = parts.find((part) => part?.type === 'where' && part.field === 'teamPermissions.streaming.memberIds');
        const streamEmailQuery = parts.find((part) => part?.type === 'where' && part.field === 'streamVolunteerEmails');
        const nameLowerBound = parts.find((part) => part?.type === 'where' && part.field === 'name' && part.op === '>=')?.value;

        if (collectionName === 'teams') {
            if (ownerQuery || adminQuery || streamMemberQuery || streamEmailQuery) {
                return { docs: [] };
            }
            if (nameLowerBound === 'bea' || nameLowerBound === 'Bea') {
                return { docs: [firestoreTeam('team-1', { name: 'Bears', sport: 'Basketball', zip: '66210', isPublic: true })] };
            }
            return { docs: [] };
        }

        return {
            docs: [
                firestorePlayer('teams/team-home/players/player-1', { name: 'Pat Star', number: '9' }),
                firestorePlayer('teams/team-private/players/player-2', { name: 'Pat Secret', number: '10' })
            ]
        };
    });
    helpMocks.searchHelpKnowledge.mockReturnValue([]);
    routePreloadMocks.preloadSearchRoute.mockResolvedValue(true);
});

afterEach(() => {
    document.body.innerHTML = '';
});

describe('React app shell search', () => {
    it('renders stable mobile action labels for private AI and search', async () => {
        const { container } = await renderShell();

        expect(buttonByText(container, 'Private AI').textContent).toContain('Private AI');
        expect(buttonByText(container, 'Search').textContent).toContain('Search');
    });

    it('opens mobile search results from the shell trigger', async () => {
        const { container } = await renderShell();
        const initialHydrationCalls = homeMocks.loadParentHomeSummary.mock.calls.length;
        const initialFirestoreCalls = firebaseMocks.getDocs.mock.calls.length;
        const initialPublicSearchCalls = dbMocks.discoverPublicTeams.mock.calls.length;

        await clickButton(container, 'Search');
        await waitForText(container, 'Browse Teams');
        expect(container.textContent).toContain('Home Rockets');
        expect(container.textContent).not.toContain('Bears');
        expect(container.textContent).not.toContain('PrivateSoccer');
        expect(container.textContent).toContain('Type at least 2 characters to search players');
        expect(homeMocks.loadParentHomeSummary).toHaveBeenCalledTimes(initialHydrationCalls);
        expect(firebaseMocks.getDocs).toHaveBeenCalledTimes(initialFirestoreCalls);
        expect(dbMocks.discoverPublicTeams).toHaveBeenCalledTimes(initialPublicSearchCalls);

        await fillSearch(container, 'bea');
        expect(container.textContent).toContain('Bears');
        expect(homeMocks.loadParentHomeSummary.mock.calls.length).toBeGreaterThan(initialHydrationCalls);
        expect(firebaseMocks.getDocs.mock.calls.length).toBeGreaterThan(initialFirestoreCalls);
        expect(dbMocks.discoverPublicTeams.mock.calls.length).toBeGreaterThan(initialPublicSearchCalls);

        await fillSearch(container, 'pat');
        expect(firebaseMocks.getDocs).toHaveBeenCalled();
        await waitForText(container, '#9 Pat Star');
        expect(container.textContent).toContain('#9 Pat Star');
        expect(container.textContent).not.toContain('Pat Secret');

        await clickButton(container, '#9 Pat Star');
        expect(container.querySelector('[data-testid="route"]').textContent).toBe('/players/team-home/player-1');
    });

    it('shows local team matches before delayed public-team enrichment resolves', async () => {
        let resolvePublicTeams;
        dbMocks.discoverPublicTeams.mockImplementationOnce(() => new Promise((resolve) => {
            resolvePublicTeams = resolve;
        }));

        const { container } = await renderShell();

        await clickButton(container, 'Search');
        await fillSearch(container, 'home');

        expect(container.textContent).toContain('Home Rockets');
        expect(container.textContent).not.toContain('Home Heroes');
        expect(container.textContent).not.toContain('Searching teams...');

        resolvePublicTeams({
            teams: [
                { id: 'team-public-home', name: 'Home Heroes', sport: 'Basketball', city: 'Austin', state: 'TX', isPublic: true }
            ],
            nextCursor: null
        });
        await flush(50);

        await waitForText(container, 'Home Heroes');
        expect(container.textContent).toContain('Home Rockets');
    });

    it('lets player search start before slow team hydration finishes and merges team results afterward', async () => {
        let resolveParentHome;
        homeMocks.loadParentHome.mockImplementationOnce(() => new Promise((resolve) => {
            resolveParentHome = resolve;
        }));
        firebaseMocks.getDocs.mockImplementation(async (request) => {
            const parts = request?.parts || [];
            const collectionName = parts.find((part) => part?.collectionName)?.collectionName;
            const lowerBound = parts.find((part) => part?.type === 'where' && part.field === 'name' && part.op === '>=')?.value;
            const ownerQuery = parts.find((part) => part?.type === 'where' && part.field === 'ownerId');
            const adminQuery = parts.find((part) => part?.type === 'where' && part.field === 'adminEmails');
            const streamMemberQuery = parts.find((part) => part?.type === 'where' && part.field === 'teamPermissions.streaming.memberIds');
            const streamEmailQuery = parts.find((part) => part?.type === 'where' && part.field === 'streamVolunteerEmails');

            if (collectionName === 'teams') {
                if (ownerQuery || adminQuery || streamMemberQuery || streamEmailQuery) {
                    return { docs: [] };
                }
                if (lowerBound === 'roc' || lowerBound === 'Roc') {
                    return { docs: [firestoreTeam('team-2', { name: 'Rockets', sport: 'Soccer', zip: '64114', isPublic: false })] };
                }
                return { docs: [] };
            }

            return {
                docs: [
                    firestorePlayer('teams/team-home/players/player-1', { name: 'Roc Star', number: '9' }),
                    firestorePlayer('teams/team-2/players/player-2', { name: 'Rocket Kid', number: '10' })
                ]
            };
        });

        const { container } = await renderShell();

        await clickButton(container, 'Search');
        await fillSearch(container, 'roc');
        await waitForText(container, '#9 Roc Star');
        expect(container.textContent).toContain('#9 Roc Star');
        expect(container.textContent).not.toContain('Rocket Kid');

        resolveParentHome({
            teams: [{
                teamId: 'team-2',
                teamName: 'Rockets',
                sport: 'Soccer',
                players: [],
                nextEvent: null,
                eventCount: 0,
                unreadCount: 0,
                openActions: 0
            }]
        });
        await flush(400);

        await waitForText(container, 'Rockets');
        expect(container.textContent).toContain('#10 Rocket Kid');
    });

    it('avoids repeated Firestore player lookups for narrower mobile search refinements', async () => {
        firebaseMocks.getDocs.mockImplementation(async (request) => {
            const parts = request?.parts || [];
            const collectionName = parts.find((part) => part?.collectionName)?.collectionName;
            const lowerBound = parts.find((part) => part?.type === 'where' && part.field === 'name' && part.op === '>=')?.value;
            const ownerQuery = parts.find((part) => part?.type === 'where' && part.field === 'ownerId');
            const adminQuery = parts.find((part) => part?.type === 'where' && part.field === 'adminEmails');
            const streamMemberQuery = parts.find((part) => part?.type === 'where' && part.field === 'teamPermissions.streaming.memberIds');
            const streamEmailQuery = parts.find((part) => part?.type === 'where' && part.field === 'streamVolunteerEmails');

            if (collectionName === 'teams') {
                if (ownerQuery || adminQuery || streamMemberQuery || streamEmailQuery) {
                    return { docs: [] };
                }
                return { docs: [] };
            }

            if (lowerBound === 'pa' || lowerBound === 'Pa') {
                return {
                    docs: [
                        firestorePlayer('teams/team-home/players/player-1', { name: 'Pat Star', number: '9' }),
                        firestorePlayer('teams/team-home/players/player-2', { name: 'Pat Stone', number: '10' }),
                        firestorePlayer('teams/team-home/players/player-3', { name: 'Paige Forward', number: '11' })
                    ]
                };
            }

            throw new Error(`Unexpected player query: ${lowerBound}`);
        });

        const { container } = await renderShell();

        await clickButton(container, 'Search');
        const getPlayerSearchCallCount = () => firebaseMocks.getDocs.mock.calls.filter(([request]) => {
            const parts = request?.parts || [];
            return parts.some((part) => {
                const collectionName = part?.collectionName;
                return collectionName === 'players' || String(collectionName || '').endsWith('/players');
            });
        }).length;
        const baselinePlayerCalls = getPlayerSearchCallCount();
        await fillSearch(container, 'pa');
        expect(getPlayerSearchCallCount() - baselinePlayerCalls).toBe(2);
        await waitForText(container, '#9 Pat Star');
        expect(container.textContent).toContain('#9 Pat Star');
        expect(container.textContent).toContain('#10 Pat Stone');

        await fillSearch(container, 'pat');
        expect(getPlayerSearchCallCount() - baselinePlayerCalls).toBe(2);
        expect(container.textContent).toContain('#9 Pat Star');
        expect(container.textContent).toContain('#10 Pat Stone');
        expect(container.textContent).not.toContain('Paige Forward');
    });

    it('reuses cached public-team searches for repeated normalized dialog queries', async () => {
        dbMocks.discoverPublicTeams.mockResolvedValue({
            teams: [
                { id: 'team-1', name: 'Bears', sport: 'Basketball', zip: '66210', isPublic: true, appAccess: true },
                { id: 'team-public-2', name: 'Bear Creek', sport: 'Soccer', city: 'Olathe', state: 'KS', isPublic: true }
            ],
            nextCursor: null
        });

        const { container } = await renderShell();

        await clickButton(container, 'Search');
        await fillSearch(container, 'bea');
        await waitForText(container, 'Bear Creek');

        await fillSearch(container, ' BEA ');
        await waitForText(container, 'Bear Creek');

        expect(dbMocks.discoverPublicTeams).toHaveBeenCalledTimes(1);
    });

    it('scopes dialog help matches to the user role and routes advanced help filtering to the help portal', async () => {
        helpMocks.searchHelpKnowledge.mockReturnValue([
            {
                id: 'coach-roster-help',
                title: 'Manage a roster',
                file: 'help-coach.html',
                url: 'https://allplays.ai/help-coach.html',
                roles: ['coach', 'admin'],
                summary: 'Keep player details current.',
                snippet: 'Update roster information before game day.',
                score: 30
            },
            {
                id: 'parent-password-help',
                title: 'Reset a password',
                file: 'help-account.html',
                url: 'https://allplays.ai/help-account.html',
                roles: ['parent'],
                summary: 'Recover account access.',
                snippet: 'Use password reset when a parent cannot sign in.',
                score: 20
            }
        ]);
        const { container } = await renderShell();

        await clickButton(container, 'Search');
        await fillSearch(container, 'help');

        expect(container.querySelector('[aria-label="Filter help by role"]')).toBeNull();
        expect(Array.from(container.querySelectorAll('button')).some((button) => button.textContent === 'Coach')).toBe(false);
        expect(Array.from(container.querySelectorAll('button')).some((button) => button.textContent === 'Member')).toBe(false);
        expect(helpMocks.searchHelpKnowledge).toHaveBeenLastCalledWith({
            query: 'help',
            roles: ['parent'],
            roleFilter: 'parent',
            limit: 5
        });
        expect(container.textContent).not.toContain('Manage a roster');
        expect(container.textContent).toContain('Reset a password');
        expect(buttonByText(container, 'More help results')).toBeTruthy();

        await pressDialogKey(container, 'Enter');
        expect(container.querySelector('[data-testid="route"]').textContent).toBe('/help/parent-password-help');
        expect(publicActionMocks.openPublicUrl).not.toHaveBeenCalled();

        await clickButton(container, 'Search');
        await fillSearch(container, 'help');
        await clickButton(container, 'More help results');
        expect(container.querySelector('[data-testid="route"]').textContent).toBe('/help');
        expect(publicActionMocks.openPublicUrl).not.toHaveBeenCalled();
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
        await waitForText(container, 'Browse Teams');
        await fillSearch(container, 'password reset');

        expect(container.textContent).toContain('Help');
        expect(container.textContent).toContain('Reset a password');
        expect(container.textContent).toContain('Use password reset when a parent cannot sign in.');
        expect(container.textContent).toContain('parent');

        await pressDialogKey(container, 'Enter');
        expect(container.querySelector('[data-testid="route"]').textContent).toBe('/help/account-password-reset');
        expect(publicActionMocks.openPublicUrl).not.toHaveBeenCalled();
    });

    it('keeps dialog help search scoped to the user primary role filter', async () => {
        helpMocks.searchHelpKnowledge.mockImplementation(({ roleFilter }) => {
            if (roleFilter === 'coach') {
                return [{
                    id: 'live-tracker-coach-guide',
                    title: 'Track Live Games with the Live Tracker',
                    file: 'help-live-tracker.html',
                    url: 'https://allplays.ai/help-live-tracker.html',
                    roles: ['coach', 'admin'],
                    summary: 'Use the live tracker from tip-off to final buzzer.',
                    snippet: 'Coaches and admins can run live tracker game flows.',
                    score: 42
                }];
            }
            if (roleFilter === 'member') {
                return [];
            }
            return [{
                id: 'watch-live-games',
                title: 'Watch Live Games and Replays',
                file: 'help-watch-chat.html',
                url: 'https://allplays.ai/help-watch-chat.html',
                roles: ['parent', 'member'],
                summary: 'Open a game and follow it live.',
                snippet: 'Parents and members can watch live games and replay links.',
                score: 21
            }];
        });
        const coachParentAuth = {
            ...auth,
            user: { ...auth.user, roles: ['parent', 'coach'] },
            roles: ['parent', 'coach'],
            isCoach: true
        };
        const { container } = await renderShell(coachParentAuth);

        await clickButton(container, 'Search');
        await fillSearch(container, 'live tracker');

        expect(container.querySelector('[aria-label="Filter help by role"]')).toBeNull();
        expect(Array.from(container.querySelectorAll('button')).some((button) => button.textContent === 'Coach')).toBe(false);
        expect(Array.from(container.querySelectorAll('button')).some((button) => button.textContent === 'Member')).toBe(false);
        expect(helpMocks.searchHelpKnowledge).toHaveBeenLastCalledWith({
            query: 'live tracker',
            roles: ['parent', 'coach'],
            roleFilter: 'coach',
            limit: 5
        });
        expect(container.textContent).toContain('Track Live Games with the Live Tracker');
        expect(container.textContent).not.toContain('Watch Live Games and Replays');
        expect(buttonByText(container, 'More help results')).toBeTruthy();
    });

    it('opens Browse Teams through the native app route for signed-in users', async () => {
        const { container } = await renderShell();

        await clickButton(container, 'Search');
        await clickButton(container, 'Browse Teams');

        expect(container.querySelector('[data-testid="route"]').textContent).toBe('/teams/browse');
        expect(publicActionMocks.openPublicUrl).not.toHaveBeenCalled();
        expect(routePreloadMocks.preloadSearchRoute).toHaveBeenCalledWith('/teams/browse');
    });

    it('preloads a highlighted app route before Enter and does not preload it twice on selection', async () => {
        const { container } = await renderShell();

        await clickButton(container, 'Search');
        await fillSearch(container, 'bea');
        expect(container.textContent).toContain('Bears');

        await pressDialogKey(container, 'ArrowDown');
        expect(routePreloadMocks.preloadSearchRoute).toHaveBeenCalledWith('/teams/team-1/public');
        expect(container.querySelector('[data-testid="route"]').textContent).toBe('/home');

        await pressDialogKey(container, 'Enter');
        expect(container.querySelector('[data-testid="route"]').textContent).toBe('/teams/team-1/public');
        expect(routePreloadMocks.preloadSearchRoute).toHaveBeenCalledTimes(1);
    });

    it('preloads query-string app action routes on hover', async () => {
        const { container } = await renderShell();

        await clickButton(container, 'Search');
        await fillSearch(container, 'feed');
        expect(container.textContent).toContain('Social Feed');

        await hoverButton(container, 'Social Feed');

        expect(routePreloadMocks.preloadSearchRoute).toHaveBeenCalledWith('/home?section=feed');
    });

    it('opens the add workflow launcher with native and website actions', async () => {
        const { container } = await renderShell();

        await clickButton(container, 'Add');

        expect(container.textContent).toContain('Add to ALL PLAYS');
        expect(container.textContent).toContain('Create team');

        await clickButton(container, 'More workflows');
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
        expect(container.textContent).not.toContain('Bears');
        expect(homeMocks.loadParentHomeSummary).not.toHaveBeenCalled();

        await clickButton(container, 'Get Started');
        expect(routePreloadMocks.preloadSearchRoute).toHaveBeenCalledWith('/auth?mode=signup');
        expect(container.querySelector('[data-testid="route"]').textContent).toBe('/auth?mode=signup');
    });

    it('keeps one-character player searches local and shows empty result states', async () => {
        homeMocks.loadParentHome.mockResolvedValueOnce({ teams: [] });
        dbMocks.discoverPublicTeams.mockResolvedValueOnce({ teams: [], nextCursor: null });
        firebaseMocks.getDocs.mockResolvedValueOnce({ docs: [] });
        const { container } = await renderShell();

        await clickButton(container, 'Search');
        const baselineCalls = firebaseMocks.getDocs.mock.calls.length;
        await fillSearch(container, 'p');
        expect(firebaseMocks.getDocs.mock.calls.length).toBe(baselineCalls);
        expect(container.textContent).toContain('Type at least 2 characters to search players');

        await fillSearch(container, 'zzzz');
        expect(firebaseMocks.getDocs.mock.calls.length).toBeGreaterThan(baselineCalls);
        expect(container.textContent).toContain('No matching teams');
        expect(container.textContent).toContain('No matching players');
        expect(container.textContent).toContain('No results');
    });

    it('shows team and player search errors in the dialog', async () => {
        dbMocks.discoverPublicTeams.mockRejectedValue(new Error('Team search unavailable'));
        homeMocks.loadParentHome.mockRejectedValueOnce(new Error('Home teams unavailable'));
        const { container } = await renderShell();

        await clickButton(container, 'Search');
        expect(container.textContent).not.toContain('Home teams unavailable');
        expect(container.textContent).toContain('Type at least 2 characters to search players');
        await fillSearch(container, 'zz');
        expect(container.textContent).toContain('Team search unavailable');

        await clickButton(container, 'Close search');
        resetAppSearchCache();
        homeMocks.loadParentHome.mockResolvedValueOnce({ teams: [] });
        firebaseMocks.getDocs.mockRejectedValue(Object.assign(new Error('Permission denied'), { code: 'permission-denied' }));

        await clickButton(container, 'Search');
        await fillSearch(container, 'pa');
        expect(container.textContent).toContain('Player search unavailable for this account.');

        await clickButton(container, 'Close search');
        resetAppSearchCache();
        homeMocks.loadParentHome.mockResolvedValueOnce({ teams: [] });
        firebaseMocks.getDocs.mockRejectedValue(Object.assign(new Error('not ready yet: create index'), { code: 'failed-precondition' }));

        await clickButton(container, 'Search');
        await fillSearch(container, 'pa');
        expect(container.textContent).toContain('Player search index is building. Try again in a few minutes.');
    });
});
