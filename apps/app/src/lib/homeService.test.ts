// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clearAppDataCache } from './appDataCache';

const chatServiceMocks = vi.hoisted(() => ({
    loadChatInbox: vi.fn()
}));

const scheduleServiceMocks = vi.hoisted(() => ({
    hydrateParentScheduleDetails: vi.fn(),
    loadParentSchedule: vi.fn(),
    loadParentScheduleScope: vi.fn()
}));

const feesMocks = vi.hoisted(() => ({
    listParentTeamFeeRecipients: vi.fn(),
    normalizeParentFeeRecord: vi.fn((value) => value)
}));

vi.mock('./chatService', () => chatServiceMocks);
vi.mock('./scheduleService', () => scheduleServiceMocks);
vi.mock('./adapters/legacyHomeFees', () => ({
    normalizeParentFeeRecord: feesMocks.normalizeParentFeeRecord
}));
vi.mock('./parentFeeRecipientsService', () => ({
    listParentTeamFeeRecipientsForApp: feesMocks.listParentTeamFeeRecipients
}));
vi.mock('./uxTiming', () => ({
    startUxTimer: vi.fn(() => ({ end: vi.fn() }))
}));
vi.mock('./logger', () => ({
    createLogger: vi.fn(() => ({ warn: vi.fn() }))
}));

import {
    loadParentHomeSummary,
    loadParentHomeWithSecondaryData,
    loadParentSearchTeamsSummary,
    loadParentScheduleSummary,
    loadParentTeamsSummaryBootstrap
} from './homeService';

const user = {
    uid: 'parent-1',
    email: 'parent@example.com',
    displayName: 'Pat Parent'
} as any;

function installTestLocalStorage() {
    const store = new Map<string, string>();
    Object.defineProperty(window, 'localStorage', {
        configurable: true,
        value: {
            getItem: vi.fn((key: string) => store.get(key) || null),
            setItem: vi.fn((key: string, value: string) => {
                store.set(key, String(value));
            }),
            removeItem: vi.fn((key: string) => {
                store.delete(key);
            }),
            key: vi.fn((index: number) => Array.from(store.keys())[index] || null),
            clear: vi.fn(() => {
                store.clear();
            }),
            get length() {
                return store.size;
            }
        }
    });
}

function deferred<T>() {
    let resolve!: (value: T | PromiseLike<T>) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

describe('homeService Teams bootstrap reuse', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        installTestLocalStorage();
        clearAppDataCache();
        window.localStorage.clear();
        chatServiceMocks.loadChatInbox.mockResolvedValue({ teams: [] });
        feesMocks.listParentTeamFeeRecipients.mockResolvedValue([]);
        scheduleServiceMocks.hydrateParentScheduleDetails.mockImplementation(async (schedule) => schedule);
    });

    it('reuses the fast summary schedule scope for teams enrichment without persisting the profile', async () => {
        const scheduleScope = {
            profile: { parentTeamIds: ['team-1'], notifyByEmail: true },
            children: [{
                teamId: 'team-1',
                teamName: 'Fast Falcons',
                playerId: 'player-1',
                playerName: 'Avery Ace'
            }],
            staffTeams: [{ teamId: 'team-owned', teamName: 'Vipers' }]
        };
        scheduleServiceMocks.loadParentScheduleScope.mockResolvedValue(scheduleScope);
        scheduleServiceMocks.loadParentSchedule.mockImplementation(async (_authUser, options) => ({
            children: options?.parentScope?.children || [],
            events: []
        }));

        const fastSummary = await loadParentTeamsSummaryBootstrap(user, { force: true });
        await loadParentHomeSummary(user, {
            force: true,
            scheduleScope: fastSummary.scheduleScope
        });

        expect(scheduleServiceMocks.loadParentScheduleScope).toHaveBeenCalledTimes(1);
        expect(scheduleServiceMocks.loadParentSchedule).toHaveBeenCalledTimes(1);
        expect(scheduleServiceMocks.loadParentSchedule).toHaveBeenCalledWith(user, expect.objectContaining({
            hydrateDetails: false,
            expandStaffPlayers: false,
            parentScope: scheduleScope
        }));
        expect(window.localStorage.getItem('allplays:appDataCache:teams-summary-bootstrap%3Aparent-1')).toBeNull();
    });

    it('includes a newly created staff team before it has players, events, or chat', async () => {
        scheduleServiceMocks.loadParentScheduleScope.mockResolvedValue({
            profile: { coachOf: ['team-owned'] },
            children: [{
                teamId: 'team-parent',
                teamName: 'Jr KC Current',
                playerId: 'player-1',
                playerName: 'Madison Snider'
            }],
            staffTeams: [{ teamId: 'team-owned', teamName: 'Vipers' }]
        });
        chatServiceMocks.loadChatInbox.mockResolvedValue({
            teams: [{
                id: 'team-parent',
                name: 'Jr KC Current',
                role: 'Parent',
                unreadCount: 0
            }]
        });

        const summary = await loadParentTeamsSummaryBootstrap(user, { force: true });

        expect(summary.home.teams).toEqual(expect.arrayContaining([
            expect.objectContaining({ teamId: 'team-parent', teamName: 'Jr KC Current' }),
            expect.objectContaining({
                teamId: 'team-owned',
                teamName: 'Vipers',
                role: 'Coach',
                players: []
            })
        ]));
        expect(summary.home.metrics.teams).toBe(2);
    });

    it('builds search teams from parent and zero-event staff scope without loading schedules', async () => {
        scheduleServiceMocks.loadParentScheduleScope.mockResolvedValue({
            profile: { coachOf: ['team-owned'] },
            children: [{
                teamId: 'team-parent-1',
                teamName: 'Jr Current',
                playerId: 'player-1',
                playerName: 'Madison Snider'
            }, {
                teamId: 'team-parent-2',
                teamName: 'Fast Falcons',
                playerId: 'player-2',
                playerName: 'Avery Ace'
            }],
            staffTeams: [{ teamId: 'team-owned', teamName: 'Vipers' }],
            isPartial: false
        });

        const summary = await loadParentSearchTeamsSummary(user);

        expect(summary.teams).toEqual(expect.arrayContaining([
            expect.objectContaining({ teamId: 'team-parent-1', teamName: 'Jr Current' }),
            expect.objectContaining({ teamId: 'team-parent-2', teamName: 'Fast Falcons' }),
            expect.objectContaining({
                teamId: 'team-owned',
                teamName: 'Vipers',
                role: 'Coach',
                players: [],
                eventCount: 0
            })
        ]));
        expect(scheduleServiceMocks.loadParentScheduleScope).toHaveBeenCalledTimes(1);
        expect(scheduleServiceMocks.loadParentSchedule).not.toHaveBeenCalled();
        expect(chatServiceMocks.loadChatInbox).not.toHaveBeenCalled();
    });

    it('rejects partial search access scope so an incomplete team list is retryable', async () => {
        scheduleServiceMocks.loadParentScheduleScope.mockResolvedValue({
            profile: {},
            children: [{
                teamId: 'team-parent-1',
                teamName: 'Jr Current',
                playerId: 'player-1',
                playerName: 'Madison Snider'
            }],
            staffTeams: [],
            isPartial: true
        });

        await expect(loadParentSearchTeamsSummary(user)).rejects.toThrow(
            'Search team access discovery is incomplete'
        );
        expect(scheduleServiceMocks.loadParentSchedule).not.toHaveBeenCalled();
    });

    it('streams a verified chat team before slower family scope discovery completes', async () => {
        const scheduleScope = deferred<any>();
        const onPartial = vi.fn();
        chatServiceMocks.loadChatInbox.mockResolvedValue({
            teams: [{
                id: 'team-owned',
                name: 'Vipers',
                role: 'Coach',
                unreadCount: 0
            }]
        });
        scheduleServiceMocks.loadParentScheduleScope.mockReturnValue(scheduleScope.promise);

        const resultPromise = loadParentTeamsSummaryBootstrap(user, { force: true, onPartial });
        await vi.waitFor(() => {
            expect(onPartial).toHaveBeenCalledWith(expect.objectContaining({
                teams: [expect.objectContaining({ teamId: 'team-owned', teamName: 'Vipers' })]
            }));
        });

        scheduleScope.resolve({
            profile: {},
            children: [],
            staffTeams: [{ teamId: 'team-owned', teamName: 'Vipers' }],
            isPartial: false
        });
        const result = await resultPromise;
        expect(result.home.teams).toEqual([
            expect.objectContaining({ teamId: 'team-owned', teamName: 'Vipers' })
        ]);
    });

    it('does not stream an empty slice before complete access discovery', async () => {
        const scheduleScope = deferred<any>();
        const onPartial = vi.fn();
        chatServiceMocks.loadChatInbox.mockResolvedValue({ teams: [] });
        scheduleServiceMocks.loadParentScheduleScope.mockReturnValue(scheduleScope.promise);

        const resultPromise = loadParentTeamsSummaryBootstrap(user, { force: true, onPartial });
        await vi.waitFor(() => expect(chatServiceMocks.loadChatInbox).toHaveBeenCalledTimes(1));
        expect(onPartial).not.toHaveBeenCalled();

        scheduleScope.resolve({
            profile: {},
            children: [],
            staffTeams: [],
            isPartial: false
        });
        await expect(resultPromise).resolves.toMatchObject({ home: { teams: [] } });
        expect(onPartial).not.toHaveBeenCalled();
    });

    it('surfaces a partial-empty staff scope and recovers on the next retry', async () => {
        const freshStaffUser = {
            uid: 'staff-1',
            email: 'staff@example.com'
        } as any;
        scheduleServiceMocks.loadParentScheduleScope
            .mockResolvedValueOnce({
                profile: {},
                children: [],
                staffTeams: [],
                staffTeamsPartial: true,
                isPartial: true
            })
            .mockResolvedValueOnce({
                profile: { coachOf: ['team-owned'] },
                children: [],
                staffTeams: [{ teamId: 'team-owned', teamName: 'Vipers' }],
                staffTeamsPartial: false,
                isPartial: false
            });

        await expect(loadParentTeamsSummaryBootstrap(freshStaffUser, { force: true })).rejects.toThrow(
            'Team access discovery is incomplete'
        );
        const summary = await loadParentTeamsSummaryBootstrap(freshStaffUser);

        expect(scheduleServiceMocks.loadParentScheduleScope).toHaveBeenCalledTimes(2);
        expect(summary.scheduleScope).toMatchObject({
            staffTeamsPartial: false,
            isPartial: false
        });
        expect(summary.home.teams).toEqual([
            expect.objectContaining({
                teamId: 'team-owned',
                teamName: 'Vipers',
                role: 'Coach'
            })
        ]);
    });

    it('does not cache a repeated partial-empty staff scope as an authoritative empty chooser', async () => {
        const freshStaffUser = {
            uid: 'staff-1',
            email: 'staff@example.com'
        } as any;
        const partialEmptyScope = {
            profile: {},
            children: [],
            staffTeams: [],
            staffTeamsPartial: true,
            isPartial: true
        };
        scheduleServiceMocks.loadParentScheduleScope
            .mockResolvedValueOnce(partialEmptyScope)
            .mockResolvedValueOnce(partialEmptyScope)
            .mockResolvedValueOnce({
                profile: {},
                children: [],
                staffTeams: [{ teamId: 'team-owned', teamName: 'Vipers' }],
                staffTeamsPartial: false,
                isPartial: false
            });

        await expect(loadParentTeamsSummaryBootstrap(freshStaffUser, { force: true })).rejects.toThrow(
            'Team access discovery is incomplete'
        );
        await expect(loadParentTeamsSummaryBootstrap(freshStaffUser)).rejects.toThrow(
            'Team access discovery is incomplete'
        );
        const recovered = await loadParentTeamsSummaryBootstrap(freshStaffUser);

        expect(scheduleServiceMocks.loadParentScheduleScope).toHaveBeenCalledTimes(3);
        expect(recovered.home.teams).toEqual([
            expect.objectContaining({ teamId: 'team-owned', teamName: 'Vipers' })
        ]);
    });

    it('renders a partial nonempty chooser without caching it as complete', async () => {
        scheduleServiceMocks.loadParentScheduleScope
            .mockResolvedValueOnce({
                profile: {},
                children: [],
                staffTeams: [{ teamId: 'team-1', teamName: 'Vipers' }],
                staffTeamsPartial: true,
                isPartial: true
            })
            .mockResolvedValueOnce({
                profile: {},
                children: [],
                staffTeams: [
                    { teamId: 'team-1', teamName: 'Vipers' },
                    { teamId: 'team-2', teamName: 'Current' }
                ],
                staffTeamsPartial: false,
                isPartial: false
            });

        const partial = await loadParentTeamsSummaryBootstrap(user);
        const complete = await loadParentTeamsSummaryBootstrap(user);

        expect(partial.scheduleScope.isPartial).toBe(true);
        expect(partial.home.teams).toEqual([
            expect.objectContaining({ teamId: 'team-1', teamName: 'Vipers' })
        ]);
        expect(complete.home.teams).toHaveLength(2);
        expect(scheduleServiceMocks.loadParentScheduleScope).toHaveBeenCalledTimes(2);
    });

    it('keeps parent-linked teams usable when only staff discovery and chat are partial', async () => {
        chatServiceMocks.loadChatInbox.mockRejectedValueOnce(new TypeError('Failed to fetch'));
        scheduleServiceMocks.loadParentScheduleScope.mockResolvedValueOnce({
            profile: {},
            children: [{
                teamId: 'team-parent',
                teamName: 'Jr KC Current',
                playerId: 'player-1',
                playerName: 'Madison Snider'
            }],
            staffTeams: [],
            staffTeamsPartial: true,
            isPartial: true
        });

        const summary = await loadParentTeamsSummaryBootstrap(user, { force: true });

        expect(summary.home.teams).toEqual([
            expect.objectContaining({ teamId: 'team-parent', teamName: 'Jr KC Current' })
        ]);
        expect(summary.scheduleScope.isPartial).toBe(true);
    });

    it('caches a complete empty chooser for a genuinely teamless account', async () => {
        scheduleServiceMocks.loadParentScheduleScope.mockResolvedValue({
            profile: {},
            children: [],
            staffTeams: [],
            staffTeamsPartial: false,
            isPartial: false
        });

        const first = await loadParentTeamsSummaryBootstrap(user);
        const second = await loadParentTeamsSummaryBootstrap(user);

        expect(first.home.teams).toEqual([]);
        expect(second.home.teams).toEqual([]);
        expect(scheduleServiceMocks.loadParentScheduleScope).toHaveBeenCalledTimes(1);
    });

    it('refreshes a cached schedule summary when the fast scope contains staff teams', async () => {
        const scheduleScope = {
            profile: { coachOf: ['team-owned'] },
            children: [{
                teamId: 'team-parent',
                teamName: 'Jr KC Current',
                playerId: 'player-1',
                playerName: 'Madison Snider'
            }],
            staffTeams: [{ teamId: 'team-owned', teamName: 'Vipers' }]
        };
        scheduleServiceMocks.loadParentSchedule
            .mockResolvedValueOnce({
                children: scheduleScope.children,
                events: []
            })
            .mockImplementationOnce(async (_authUser, options) => ({
                children: options?.parentScope?.children || [],
                events: [],
                staffTeams: options?.parentScope?.staffTeams || []
            }));

        await loadParentScheduleSummary(user, { force: true });
        const refreshed = await loadParentScheduleSummary(user, { scheduleScope });

        expect(scheduleServiceMocks.loadParentSchedule).toHaveBeenCalledTimes(2);
        expect(scheduleServiceMocks.loadParentSchedule).toHaveBeenLastCalledWith(user, expect.objectContaining({
            parentScope: scheduleScope
        }));
        expect(refreshed.staffTeams).toEqual([
            { teamId: 'team-owned', teamName: 'Vipers' }
        ]);
    });

    it('does not cache partial parent schedule summaries as complete results', async () => {
        scheduleServiceMocks.loadParentSchedule
            .mockResolvedValueOnce({
                children: [{ teamId: 'team-1', teamName: 'Fast Falcons', playerId: 'player-1', playerName: 'Avery Ace' }],
                events: [],
                isPartial: true
            })
            .mockResolvedValueOnce({
                children: [{ teamId: 'team-1', teamName: 'Fast Falcons', playerId: 'player-1', playerName: 'Avery Ace' }],
                events: [{ id: 'event-1' }],
                isPartial: false
            });

        const partial = await loadParentScheduleSummary(user, { force: true });
        const complete = await loadParentScheduleSummary(user);

        expect(partial.isPartial).toBe(true);
        expect(complete.isPartial).toBe(false);
        expect(scheduleServiceMocks.loadParentSchedule).toHaveBeenCalledTimes(2);
        expect(window.localStorage.getItem('allplays:appDataCache:app-schedule-summary%3Aparent-1')).toContain('event-1');
    });

    it.each([
        ['schedule hydration', () => scheduleServiceMocks.hydrateParentScheduleDetails.mockRejectedValueOnce(new Error('schedule unavailable'))],
        ['chat inbox', () => chatServiceMocks.loadChatInbox.mockRejectedValueOnce(new Error('chat unavailable'))],
        ['fees', () => feesMocks.listParentTeamFeeRecipients.mockRejectedValueOnce(new Error('fees unavailable'))]
    ])('reports a retryable partial result when %s fails and does not cache its empty fallback', async (_slice, failSlice) => {
        const schedule = {
            children: [{
                teamId: 'team-1',
                teamName: 'Fast Falcons',
                playerId: 'player-1',
                playerName: 'Avery Ace'
            }],
            events: [{
                id: 'event-1',
                teamId: 'team-1',
                title: 'Practice',
                date: new Date('2100-08-12T18:00:00.000Z')
            }]
        } as any;
        failSlice();

        await expect(loadParentHomeWithSecondaryData(user, { schedule, force: true })).rejects.toThrow('unavailable');

        await expect(loadParentHomeWithSecondaryData(user, { schedule })).resolves.toMatchObject({
            upcomingEvents: [expect.objectContaining({ id: 'event-1', teamId: 'team-1' })]
        });
    });

    it('streams valid Home slices but rejects with retryable state when one secondary slice is denied', async () => {
        const schedule = {
            children: [{
                teamId: 'team-1',
                teamName: 'Fast Falcons',
                playerId: 'player-1',
                playerName: 'Avery Ace'
            }],
            events: [{
                id: 'event-1',
                teamId: 'team-1',
                title: 'Practice',
                date: new Date('2100-08-12T18:00:00.000Z')
            }]
        } as any;
        const permissionError = Object.assign(new Error('Missing or insufficient permissions.'), {
            code: 'permission-denied'
        });
        scheduleServiceMocks.hydrateParentScheduleDetails.mockRejectedValueOnce(permissionError);
        chatServiceMocks.loadChatInbox.mockResolvedValueOnce({
            teams: [{ id: 'team-1', name: 'Fast Falcons', role: 'Parent', unreadCount: 0 }]
        });

        const partials: any[] = [];
        await expect(loadParentHomeWithSecondaryData(user, {
            schedule,
            force: true,
            onPartial: (partial) => partials.push(partial)
        })).rejects.toThrow('Missing or insufficient permissions.');

        expect(partials.some((partial) => partial.upcomingEvents.some((event: any) => event.id === 'event-1'))).toBe(true);
        expect(partials.some((partial) => partial.teams.some((team: any) => team.teamId === 'team-1'))).toBe(true);
    });

    it('does not cache a partial chat inbox as authoritative Home absence', async () => {
        const schedule = { children: [], events: [] } as any;
        chatServiceMocks.loadChatInbox
            .mockResolvedValueOnce({ teams: [{ id: 'team-1', name: 'Vipers', role: 'Coach', unreadCount: 0 }], isPartial: true })
            .mockResolvedValueOnce({
                teams: [
                    { id: 'team-1', name: 'Vipers', role: 'Coach', unreadCount: 0 },
                    { id: 'team-2', name: 'Current', role: 'Coach', unreadCount: 0 }
                ],
                isPartial: false
            });

        await expect(loadParentHomeWithSecondaryData(user, { schedule, force: true }))
            .rejects.toThrow('Home chat access is incomplete');
        const complete = await loadParentHomeWithSecondaryData(user, { schedule });

        expect(complete.teams.map((team) => team.teamId)).toEqual(['team-2', 'team-1']);
        expect(chatServiceMocks.loadChatInbox).toHaveBeenCalledTimes(2);
    });

    it('still surfaces a retryable error when every Home secondary slice fails', async () => {
        const schedule = { children: [], events: [] } as any;
        scheduleServiceMocks.hydrateParentScheduleDetails.mockRejectedValueOnce(new Error('schedule unavailable'));
        chatServiceMocks.loadChatInbox.mockRejectedValueOnce(new Error('chat unavailable'));
        feesMocks.listParentTeamFeeRecipients.mockRejectedValueOnce(new Error('fees unavailable'));

        await expect(loadParentHomeWithSecondaryData(user, { schedule, force: true }))
            .rejects.toThrow('schedule unavailable');
    });

    it('rejects a partial chat inbox instead of caching it as complete Home data', async () => {
        const schedule = { children: [], events: [] } as any;
        chatServiceMocks.loadChatInbox
            .mockResolvedValueOnce({
                teams: [{ id: 'team-1', name: 'Known Team', unreadCount: 2 }],
                isPartial: true
            })
            .mockResolvedValueOnce({
                teams: [
                    { id: 'team-1', name: 'Known Team', unreadCount: 2 },
                    { id: 'team-2', name: 'Recovered Team', unreadCount: 1 }
                ],
                isPartial: false
            });

        await expect(loadParentHomeWithSecondaryData(user, { schedule, force: true }))
            .rejects.toThrow('Home chat access is incomplete');
        const recovered = await loadParentHomeWithSecondaryData(user, { schedule });

        expect(recovered.teams).toEqual(expect.arrayContaining([
            expect.objectContaining({ teamId: 'team-1' }),
            expect.objectContaining({ teamId: 'team-2' })
        ]));
        expect(chatServiceMocks.loadChatInbox).toHaveBeenCalledTimes(2);
    });
});
