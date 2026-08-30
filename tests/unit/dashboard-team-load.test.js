import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const firebaseMocks = vi.hoisted(() => ({
    auth: { currentUser: null, app: { options: { projectId: 'game-flow-c6311' } } },
    listManagedTeams: vi.fn()
}));

vi.mock('../../js/firebase.js?v=33', () => ({
    auth: firebaseMocks.auth,
    functions: {},
    httpsCallable: vi.fn((_functions, name) => {
        if (name === 'listManagedTeams') return firebaseMocks.listManagedTeams;
        throw new Error(`Unexpected callable: ${name}`);
    })
}));

vi.mock('../../js/firebase-app-check-rest.js?v=1', () => ({
    getPrimaryAppCheckHeaders: vi.fn(async (headers) => headers)
}));

const { loadDashboardTeams } = await import('../../js/dashboard-team-load.js?v=4');

function dashboardResult({ items = [], parentItems = [], isPartial = false, includesAllTeams = false } = {}) {
    return {
        dashboardTeamLoadVersion: 1,
        includesAllTeams,
        items,
        parentItems,
        isPartial
    };
}

describe('dashboard team load', () => {
    const originalFetch = globalThis.fetch;

    beforeEach(() => {
        vi.clearAllMocks();
        firebaseMocks.auth.currentUser = {
            uid: 'coach-1',
            getIdToken: vi.fn().mockResolvedValue('fake-id-token')
        };
        firebaseMocks.listManagedTeams.mockResolvedValue({ data: dashboardResult() });
        globalThis.fetch = vi.fn();
    });

    afterEach(() => {
        globalThis.fetch = originalFetch;
        vi.useRealTimers();
    });

    it('loads, filters, sorts, and de-duplicates staff and parent teams in one request', async () => {
        firebaseMocks.listManagedTeams.mockResolvedValue({
            data: dashboardResult({
                items: [
                    { id: 'team-b', name: 'Bravo', active: true },
                    { id: 'team-a', name: 'Alpha', active: true },
                    { id: 'team-old', name: 'Archived', archived: true }
                ],
                parentItems: [
                    { id: 'team-c', name: 'Charlie', active: true },
                    { id: 'team-a', name: 'Alpha parent copy', active: true }
                ]
            })
        });

        await expect(loadDashboardTeams({ timeoutMs: 10000 })).resolves.toEqual({
            fullAccessTeams: [
                { id: 'team-a', name: 'Alpha', active: true },
                { id: 'team-b', name: 'Bravo', active: true }
            ],
            parentTeams: [{ id: 'team-c', name: 'Charlie', active: true }]
        });
        expect(firebaseMocks.listManagedTeams).toHaveBeenCalledWith({ includeParentTeams: true });
        expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    it('accepts a complete empty result as authoritative absence', async () => {
        await expect(loadDashboardTeams()).resolves.toEqual({
            fullAccessTeams: [],
            parentTeams: []
        });
    });

    it('recovers from a partial first transport through the bounded authenticated hedge', async () => {
        vi.useFakeTimers();
        firebaseMocks.listManagedTeams.mockResolvedValue({
            data: dashboardResult({
                items: [{ id: 'partial-team', name: 'Partial' }],
                isPartial: true
            })
        });
        globalThis.fetch = vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({
                result: dashboardResult({
                    items: [{ id: 'team-1', name: 'Recovered' }]
                })
            })
        });

        const resultPromise = loadDashboardTeams();
        await vi.advanceTimersByTimeAsync(750);

        await expect(resultPromise).resolves.toEqual({
            fullAccessTeams: [{ id: 'team-1', name: 'Recovered' }],
            parentTeams: []
        });
        expect(globalThis.fetch).toHaveBeenCalledWith(
            'https://us-central1-game-flow-c6311.cloudfunctions.net/listManagedTeams',
            expect.objectContaining({
                method: 'POST',
                headers: expect.objectContaining({ Authorization: 'Bearer fake-id-token' }),
                body: JSON.stringify({ data: { includeParentTeams: true } })
            })
        );
    });

    it('does not let a stalled callable hold the dashboard past the hedge delay', async () => {
        vi.useFakeTimers();
        firebaseMocks.listManagedTeams.mockReturnValue(new Promise(() => {}));
        globalThis.fetch = vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({
                result: dashboardResult({
                    items: [{ id: 'team-1', name: 'Fast HTTP result' }]
                })
            })
        });

        const resultPromise = loadDashboardTeams();
        await vi.advanceTimersByTimeAsync(749);
        expect(globalThis.fetch).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(1);

        await expect(resultPromise).resolves.toEqual({
            fullAccessTeams: [{ id: 'team-1', name: 'Fast HTTP result' }],
            parentTeams: []
        });
    });

    it('rejects repeated partial-empty results instead of rendering a false empty state', async () => {
        vi.useFakeTimers();
        firebaseMocks.listManagedTeams.mockResolvedValue({
            data: dashboardResult({ isPartial: true })
        });
        globalThis.fetch = vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({ result: dashboardResult({ isPartial: true }) })
        });

        const resultPromise = loadDashboardTeams();
        const assertion = expect(resultPromise).rejects.toMatchObject({
            code: 'dashboard-team-discovery-partial',
            partialResult: { fullAccessTeams: [], parentTeams: [] }
        });
        await vi.advanceTimersByTimeAsync(750);
        await assertion;
    });

    it('does not cache a partial nonempty result, so a later load can expand it', async () => {
        vi.useFakeTimers();
        firebaseMocks.listManagedTeams
            .mockResolvedValueOnce({
                data: dashboardResult({
                    items: [{ id: 'team-1', name: 'Known team' }],
                    isPartial: true
                })
            })
            .mockResolvedValueOnce({
                data: dashboardResult({
                    items: [
                        { id: 'team-1', name: 'Known team' },
                        { id: 'team-2', name: 'Recovered team' }
                    ]
                })
            });
        globalThis.fetch = vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({
                result: dashboardResult({
                    items: [{ id: 'team-1', name: 'Known team' }],
                    isPartial: true
                })
            })
        });

        const firstLoad = loadDashboardTeams();
        const firstAssertion = expect(firstLoad).rejects.toMatchObject({
            code: 'dashboard-team-discovery-partial'
        });
        await vi.advanceTimersByTimeAsync(750);
        await firstAssertion;

        const secondLoad = loadDashboardTeams();
        await vi.advanceTimersByTimeAsync(0);
        await expect(secondLoad).resolves.toEqual({
            fullAccessTeams: [
                { id: 'team-1', name: 'Known team' },
                { id: 'team-2', name: 'Recovered team' }
            ],
            parentTeams: []
        });
        expect(firebaseMocks.listManagedTeams).toHaveBeenCalledTimes(2);
    });

    it('requires an explicit all-teams acknowledgement for a platform-admin request', async () => {
        vi.useFakeTimers();
        firebaseMocks.listManagedTeams.mockResolvedValue({
            data: dashboardResult({ includesAllTeams: false })
        });
        globalThis.fetch = vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({ result: dashboardResult({ includesAllTeams: false }) })
        });

        const resultPromise = loadDashboardTeams({ includeAllTeams: true });
        const assertion = expect(resultPromise).rejects.toMatchObject({
            code: 'dashboard-team-discovery-incomplete-admin'
        });
        await vi.advanceTimersByTimeAsync(750);
        await assertion;
        expect(firebaseMocks.listManagedTeams).toHaveBeenCalledWith({
            includeParentTeams: true,
            includeAllTeams: true
        });
    });

    it('stops waiting at the requested deadline when both transports stall', async () => {
        vi.useFakeTimers();
        firebaseMocks.listManagedTeams.mockReturnValue(new Promise(() => {}));
        globalThis.fetch = vi.fn(() => new Promise(() => {}));

        const resultPromise = loadDashboardTeams({ timeoutMs: 1000 });
        const assertion = expect(resultPromise).rejects.toThrow('Dashboard team discovery timed out.');
        await vi.advanceTimersByTimeAsync(1000);
        await assertion;
    });

    it('fails before making a request when no signed-in user is available', async () => {
        firebaseMocks.auth.currentUser = null;

        await expect(loadDashboardTeams()).rejects.toThrow('Sign in to load your teams.');
        expect(firebaseMocks.listManagedTeams).not.toHaveBeenCalled();
    });
});
