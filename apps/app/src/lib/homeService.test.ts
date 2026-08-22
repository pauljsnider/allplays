// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearAppDataCache, getCachedAppData, getParentScheduleSummaryCacheKey } from './appDataCache';

const chatServiceMocks = vi.hoisted(() => ({
    loadChatInbox: vi.fn()
}));

const scheduleServiceMocks = vi.hoisted(() => ({
    hasRawExternalScheduleEvents: vi.fn((schedule: any) => Boolean(schedule?.events?.some((event: any) => (
        event.isDbGame !== true && event.sourceType === 'calendar'
        || Array.isArray(event.calendarUrls) && event.calendarUrls.some((url: unknown) => Boolean(String(url || '').trim()))
    )))),
    isParentScheduleCacheSafe: vi.fn((schedule: any) => schedule?.isPartial !== true && !schedule?.events?.some((event: any) => (
        event.isDbGame !== true && event.sourceType === 'calendar'
        || Array.isArray(event.calendarUrls) && event.calendarUrls.some((url: unknown) => Boolean(String(url || '').trim()))
    ))),
    hydrateParentScheduleDetails: vi.fn(),
    loadParentSchedule: vi.fn(),
    loadParentScheduleScope: vi.fn(),
    reconcileParentSchedulePartial: vi.fn((current: any, next: any) => (
        current && next?.isPartial === true && !next.events?.length
            ? { ...next, events: current.events || [] }
            : next
    ))
}));

const feesMocks = vi.hoisted(() => ({
    listParentTeamFeeRecipients: vi.fn(),
    normalizeParentFeeRecord: vi.fn((value) => value)
}));

const nativeRuntimeMocks = vi.hoisted(() => ({
    isNativeRuntime: vi.fn(() => false)
}));

const profileServiceMocks = vi.hoisted(() => ({
    loadManagedTeamsFromNativeCallable: vi.fn(),
    loadProfileDocument: vi.fn()
}));

vi.mock('./chatService', () => chatServiceMocks);
vi.mock('./scheduleService', () => scheduleServiceMocks);
vi.mock('./adapters/legacyHomeFees', () => ({
    normalizeParentFeeRecord: feesMocks.normalizeParentFeeRecord
}));
vi.mock('./parentFeeRecipientsService', () => ({
    listParentTeamFeeRecipientsForApp: feesMocks.listParentTeamFeeRecipients
}));
vi.mock('./nativeRuntime', () => nativeRuntimeMocks);
vi.mock('./profileService', () => profileServiceMocks);
vi.mock('./uxTiming', () => ({
    startUxTimer: vi.fn(() => ({ end: vi.fn() }))
}));
vi.mock('./logger', () => ({
    createLogger: vi.fn(() => ({ warn: vi.fn() }))
}));

import {
    loadParentHomeSummaryBootstrap,
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
        scheduleServiceMocks.loadParentScheduleScope.mockResolvedValue({
            profile: {},
            children: [],
            staffTeams: [],
            isPartial: false
        });
        nativeRuntimeMocks.isNativeRuntime.mockReturnValue(false);
        profileServiceMocks.loadManagedTeamsFromNativeCallable.mockReset();
        profileServiceMocks.loadProfileDocument.mockReset();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('shares one native profile and managed-team projection across Home schedule and chat', async () => {
        nativeRuntimeMocks.isNativeRuntime.mockReturnValue(true);
        const profile = { parentOf: [], coachOf: ['team-owned'] };
        const managedTeams = [{
            id: 'team-owned',
            name: 'Vipers',
            chatAccessVerified: true,
            conversations: [{ id: 'team' }]
        }];
        profileServiceMocks.loadProfileDocument.mockResolvedValue(profile);
        profileServiceMocks.loadManagedTeamsFromNativeCallable.mockResolvedValue({
            teams: managedTeams,
            isPartial: false
        });
        scheduleServiceMocks.loadParentSchedule.mockImplementation(async (_authUser, options) => {
            const [sharedProfile, sharedTeams] = await Promise.all([
                options.nativeProfileLoader(),
                options.nativeStaffTeamsLoader()
            ]);
            expect(sharedProfile).toBe(profile);
            expect(sharedTeams.teams).toBe(managedTeams);
            return {
                children: [],
                events: [],
                staffTeams: [{ teamId: 'team-owned', teamName: 'Vipers' }]
            };
        });
        chatServiceMocks.loadChatInbox.mockImplementation(async (_authUser, options) => {
            const [sharedProfile, sharedTeams] = await Promise.all([
                options.nativeProfileLoader(),
                options.nativeManagedTeamsLoader()
            ]);
            expect(sharedProfile).toBe(profile);
            expect(sharedTeams.teams).toBe(managedTeams);
            return {
                teams: [{ id: 'team-owned', name: 'Vipers', role: 'Coach', unreadCount: 0 }],
                isPartial: false
            };
        });
        const summary = await loadParentHomeSummaryBootstrap(user, {
            force: true
        });
        await loadParentHomeWithSecondaryData(user, {
            force: true,
            schedule: summary.schedule,
            nativeContext: summary.nativeContext
        });

        expect(profileServiceMocks.loadProfileDocument).toHaveBeenCalledTimes(1);
        expect(profileServiceMocks.loadProfileDocument).toHaveBeenCalledWith(user.uid);
        expect(profileServiceMocks.loadManagedTeamsFromNativeCallable).toHaveBeenCalledTimes(1);
        expect(profileServiceMocks.loadManagedTeamsFromNativeCallable).toHaveBeenCalledWith({
            includeChatMetadata: true,
            timeoutMs: 15000
        });
    });

    it('reports a complete stale-summary background refresh separately from initial partials', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-08-13T12:00:00.000Z'));
        const staleSchedule = {
            children: [],
            events: [],
            staffTeams: [{ teamId: 'team-1', teamName: 'Bears' }]
        } as any;
        const refreshedSchedule = {
            children: [],
            events: [],
            staffTeams: [{ teamId: 'team-2', teamName: 'Storm' }]
        } as any;
        scheduleServiceMocks.loadParentSchedule.mockResolvedValueOnce(staleSchedule);

        const first = await loadParentHomeSummaryBootstrap(user, { force: true });
        expect(first.home.teams.map((team) => team.teamId)).toEqual(['team-1']);

        vi.setSystemTime(new Date('2026-08-13T12:00:46.000Z'));
        const refresh = deferred<typeof refreshedSchedule>();
        scheduleServiceMocks.loadParentSchedule.mockReturnValueOnce(refresh.promise);
        const onPartial = vi.fn();
        const onRefresh = vi.fn();

        const stale = await loadParentHomeSummaryBootstrap(user, { onPartial, onRefresh });
        expect(stale.home.teams.map((team) => team.teamId)).toEqual(['team-1']);
        expect(onRefresh).not.toHaveBeenCalled();

        refresh.resolve(refreshedSchedule);
        await vi.waitFor(() => {
            expect(onRefresh).toHaveBeenCalledTimes(1);
        });

        expect(onPartial).toHaveBeenCalledWith(expect.objectContaining({
            home: expect.objectContaining({
                teams: [expect.objectContaining({ teamId: 'team-2' })]
            })
        }));
        expect(onRefresh).toHaveBeenCalledWith(expect.objectContaining({
            schedule: refreshedSchedule,
            home: expect.objectContaining({
                teams: [expect.objectContaining({ teamId: 'team-2' })]
            })
        }));
    });

    it('reports a stale-summary background refresh failure through the bootstrap boundary', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-08-13T12:00:00.000Z'));
        const staleSchedule = {
            children: [],
            events: [],
            staffTeams: [{ teamId: 'team-1', teamName: 'Bears' }]
        } as any;
        scheduleServiceMocks.loadParentSchedule.mockResolvedValueOnce(staleSchedule);

        await loadParentHomeSummaryBootstrap(user, { force: true });

        vi.setSystemTime(new Date('2026-08-13T12:00:46.000Z'));
        const refreshError = new Error('summary refresh unavailable');
        scheduleServiceMocks.loadParentSchedule.mockRejectedValueOnce(refreshError);
        const onBackgroundError = vi.fn();

        const stale = await loadParentHomeSummaryBootstrap(user, { onBackgroundError });
        expect(stale.schedule).toBe(staleSchedule);

        await vi.waitFor(() => {
            expect(onBackgroundError).toHaveBeenCalledWith(refreshError);
        });
    });

    it('preserves the last complete Home schedule when a background refresh is partial', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-08-13T12:00:00.000Z'));
        const completeSchedule = {
            children: [],
            events: [{ id: 'verified-event' }],
            isPartial: false
        } as any;
        scheduleServiceMocks.loadParentSchedule.mockResolvedValueOnce(completeSchedule);

        await loadParentScheduleSummary(user, { force: true });

        vi.setSystemTime(new Date('2026-08-13T12:00:46.000Z'));
        scheduleServiceMocks.loadParentSchedule.mockResolvedValueOnce({
            children: [],
            events: [],
            scopeIsPartial: false,
            isPartial: true
        });
        const onBackgroundError = vi.fn();

        const stale = await loadParentScheduleSummary(user, { onBackgroundError });

        expect(stale).toBe(completeSchedule);
        await vi.waitFor(() => {
            expect(onBackgroundError).toHaveBeenCalledWith(expect.objectContaining({
                message: expect.stringContaining('complete schedule could not be loaded')
            }));
        });
    });

    it.each([
        {
            label: 'terminal player denial',
            partial: {
                children: [],
                events: [],
                scopeIsPartial: false,
                accessLostTeamIds: ['team-1'],
                teamLoadStates: { 'team-1': 'access-lost' },
                isPartial: true
            }
        },
        {
            label: 'transient omitted scope',
            partial: {
                children: [],
                events: [],
                scopeIsPartial: true,
                teamLoadStates: {},
                isPartial: true
            }
        }
    ])('invalidates cached private rows after $label', async ({ partial }) => {
        const completeSchedule = {
            children: [{ teamId: 'team-1', teamName: 'Bears', playerId: 'player-1', playerName: 'Pat' }],
            staffTeams: [],
            events: [{ id: 'private-event', teamId: 'team-1', childId: 'player-1', date: new Date('2100-01-01') }],
            sourceKeysByTeam: { 'team-1': 'no-external-calendar:v1' },
            isPartial: false
        } as any;
        scheduleServiceMocks.loadParentSchedule.mockResolvedValueOnce(completeSchedule);
        await loadParentScheduleSummary(user, { force: true });

        scheduleServiceMocks.loadParentSchedule.mockImplementationOnce(async (_user, options) => {
            options.onPartial?.(partial as any);
            throw new Error('current schedule incomplete');
        });
        await expect(loadParentScheduleSummary(user, {
            force: true,
            onPartial: vi.fn()
        })).rejects.toThrow('current schedule incomplete');

        expect(getCachedAppData(getParentScheduleSummaryCacheKey(user.uid))).toBeNull();
        const recovered = { children: [], events: [], staffTeams: [], sourceKeysByTeam: {}, isPartial: false } as any;
        scheduleServiceMocks.loadParentSchedule.mockResolvedValueOnce(recovered);
        await expect(loadParentScheduleSummary(user)).resolves.toBe(recovered);
        expect(scheduleServiceMocks.loadParentSchedule).toHaveBeenCalledTimes(3);
    });

    it('never restores the old sibling cache when a scope-shrink partial is followed by a complete load', async () => {
        const child = (playerId: string) => ({ teamId: 'team-1', teamName: 'Bears', playerId, playerName: playerId });
        const event = (playerId: string) => ({
            id: `event-${playerId}`,
            teamId: 'team-1',
            childId: playerId,
            date: new Date('2100-01-01')
        });
        const oldComplete = {
            children: [child('p1'), child('p2')],
            staffTeams: [],
            events: [event('p1'), event('p2')],
            sourceKeysByTeam: { 'team-1': 'no-external-calendar:v1' },
            isPartial: false
        } as any;
        const newComplete = {
            ...oldComplete,
            children: [child('p1')],
            events: [event('p1')]
        } as any;
        scheduleServiceMocks.loadParentSchedule.mockResolvedValueOnce(oldComplete);
        await loadParentScheduleSummary(user, { force: true });

        scheduleServiceMocks.loadParentScheduleScope.mockResolvedValueOnce({
            profile: { parentTeamIds: ['team-1'], parentPlayerKeys: ['team-1::p1', 'team-1::p2'] },
            children: [child('p1'), child('p2')],
            staffTeams: [],
            isPartial: false
        });
        scheduleServiceMocks.loadParentSchedule.mockImplementationOnce(async (_user, options) => {
            options.onPartial?.({
                children: [child('p1')],
                staffTeams: [],
                events: [],
                scopeIsPartial: false,
                pendingTeamIds: ['team-1'],
                teamLoadStates: { 'team-1': 'pending' },
                sourceKeysByTeam: { 'team-1': 'no-external-calendar:v1' },
                isPartial: true
            });
            return newComplete;
        });
        await expect(loadParentScheduleSummary(user, { force: true })).resolves.toBe(newComplete);

        const cachedAfterRefresh = getCachedAppData<any>(getParentScheduleSummaryCacheKey(user.uid));
        expect(cachedAfterRefresh?.children || []).not.toContainEqual(child('p2'));
        expect(scheduleServiceMocks.loadParentSchedule).toHaveBeenCalledTimes(2);
    });

    it('validates a fresh cached summary against current scope before returning revoked sibling rows', async () => {
        const child = (playerId: string) => ({ teamId: 'team-1', teamName: 'Bears', playerId, playerName: playerId });
        const event = (playerId: string) => ({
            id: `event-${playerId}`,
            teamId: 'team-1',
            childId: playerId,
            date: new Date('2100-01-01')
        });
        const oldComplete = {
            children: [child('p1'), child('p2')],
            staffTeams: [],
            events: [event('p1'), event('p2')],
            sourceKeysByTeam: { 'team-1': 'no-external-calendar:v1' },
            isPartial: false
        } as any;
        const currentComplete = {
            ...oldComplete,
            children: [child('p1')],
            events: [event('p1')]
        } as any;
        scheduleServiceMocks.loadParentSchedule.mockResolvedValueOnce(oldComplete);
        await loadParentScheduleSummary(user, { force: true });

        scheduleServiceMocks.loadParentScheduleScope.mockResolvedValueOnce({
            profile: { parentTeamIds: ['team-1'], parentPlayerKeys: ['team-1::p1'] },
            children: [child('p1')],
            staffTeams: [],
            isPartial: false
        });
        scheduleServiceMocks.loadParentSchedule.mockResolvedValueOnce(currentComplete);

        await expect(loadParentScheduleSummary(user)).resolves.toBe(currentComplete);
        expect(scheduleServiceMocks.loadParentSchedule).toHaveBeenCalledTimes(2);
        expect(scheduleServiceMocks.loadParentSchedule).toHaveBeenLastCalledWith(
            user,
            expect.objectContaining({
                parentScope: expect.objectContaining({ children: [child('p1')] })
            })
        );
        expect(getCachedAppData<any>(getParentScheduleSummaryCacheKey(user.uid))?.events).toEqual([event('p1')]);
    });

    it('does not persist or reuse a DB-only schedule row carrying a raw calendar URL', async () => {
        const privateUrl = 'https://calendar.example.com/private-token.ics';
        const unsafeSchedule = {
            children: [{ teamId: 'team-1', teamName: 'Bears', playerId: 'player-1', playerName: 'Pat' }],
            staffTeams: [],
            sourceKeysByTeam: { 'team-1': `direct-calendar:v1:${'a'.repeat(64)}` },
            events: [{
                id: 'db-game',
                eventKey: 'team-1:db-game:player-1',
                teamId: 'team-1',
                childId: 'player-1',
                type: 'game',
                date: new Date('2100-06-01T18:00:00.000Z'),
                isDbGame: true,
                sourceType: 'db',
                calendarUrls: [privateUrl]
            }],
            isPartial: false
        } as any;
        const safeSchedule = {
            ...unsafeSchedule,
            sourceKeysByTeam: { 'team-1': 'no-external-calendar:v1' },
            events: []
        };
        scheduleServiceMocks.loadParentSchedule
            .mockResolvedValueOnce(unsafeSchedule)
            .mockResolvedValueOnce(safeSchedule);

        await expect(loadParentScheduleSummary(user, { force: true })).resolves.toBe(unsafeSchedule);
        expect(window.localStorage.setItem).not.toHaveBeenCalledWith(
            expect.any(String),
            expect.stringContaining(privateUrl)
        );

        await expect(loadParentScheduleSummary(user)).resolves.toBe(safeSchedule);
        expect(scheduleServiceMocks.loadParentSchedule).toHaveBeenCalledTimes(2);
    });

    it('renders the last complete Home immediately while refreshing it in the background', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-08-13T12:00:00.000Z'));
        const schedule = { children: [], events: [] } as any;
        chatServiceMocks.loadChatInbox.mockResolvedValueOnce({
            teams: [{ id: 'team-1', name: 'Vipers', role: 'Coach', unreadCount: 0 }],
            isPartial: false
        });
        const first = await loadParentHomeWithSecondaryData(user, { schedule, force: true });
        expect(first.teams.map((team) => team.teamId)).toEqual(['team-1']);

        vi.setSystemTime(new Date('2026-08-13T12:00:31.000Z'));
        chatServiceMocks.loadChatInbox.mockResolvedValueOnce({
            teams: [{ id: 'team-2', name: 'Current', role: 'Coach', unreadCount: 0 }],
            isPartial: false
        });
        let resolveUpdated!: () => void;
        const updated = new Promise<void>((resolve) => {
            resolveUpdated = resolve;
        });
        const stale = await loadParentHomeWithSecondaryData(user, {
            schedule,
            onPartial: (home) => {
                if (home.teams.some((team) => team.teamId === 'team-2')) resolveUpdated();
            }
        });

        expect(stale.teams.map((team) => team.teamId)).toEqual(['team-1']);
        await updated;
        const refreshed = await loadParentHomeWithSecondaryData(user, { schedule });
        expect(refreshed.teams.map((team) => team.teamId)).toEqual(['team-2']);
        vi.useRealTimers();
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

    it('revalidates a fresh Teams bootstrap cache before returning a revoked sibling', async () => {
        const child = (playerId: string) => ({
            teamId: 'team-1',
            teamName: 'Bears',
            playerId,
            playerName: playerId
        });
        const oldScope = {
            profile: { parentTeamIds: ['team-1'], parentPlayerKeys: ['team-1::p1', 'team-1::p2'] },
            children: [child('p1'), child('p2')],
            staffTeams: [],
            isPartial: false
        };
        const currentScope = {
            profile: { parentTeamIds: ['team-1'], parentPlayerKeys: ['team-1::p1'] },
            children: [child('p1')],
            staffTeams: [],
            isPartial: false
        };
        scheduleServiceMocks.loadParentScheduleScope
            .mockResolvedValueOnce(oldScope)
            .mockResolvedValueOnce(currentScope);

        const seeded = await loadParentTeamsSummaryBootstrap(user, { force: true });
        expect(seeded.scheduleScope.children).toEqual([child('p1'), child('p2')]);

        const refreshed = await loadParentTeamsSummaryBootstrap(user);
        expect(refreshed.scheduleScope.children).toEqual([child('p1')]);
        expect(refreshed.home.players.map((player) => player.playerId)).toEqual(['p1']);
        expect(scheduleServiceMocks.loadParentScheduleScope).toHaveBeenCalledTimes(2);
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

    it('revalidates a complete empty chooser before serving its fresh cache', async () => {
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
        expect(scheduleServiceMocks.loadParentScheduleScope).toHaveBeenCalledTimes(2);
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
        scheduleServiceMocks.loadParentScheduleScope.mockResolvedValue(scheduleScope);

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

    it('rejects partial parent schedule summaries, leaves them uncached, and recovers on a complete load', async () => {
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

        await expect(loadParentScheduleSummary(user, { force: true })).rejects.toThrow(
            'The complete schedule could not be loaded'
        );
        const complete = await loadParentScheduleSummary(user);

        expect(complete.isPartial).toBe(false);
        expect(scheduleServiceMocks.loadParentSchedule).toHaveBeenCalledTimes(2);
        expect(window.localStorage.getItem('allplays:appDataCache:app-schedule-summary%3Aparent-1')).toContain('event-1');
    });

    it('rejects an explicitly supplied partial Home schedule before caching a false empty summary', async () => {
        const partialSchedule = {
            children: [{ teamId: 'team-1', teamName: 'Fast Falcons', playerId: 'player-1', playerName: 'Avery Ace' }],
            events: [],
            isPartial: true
        } as any;

        await expect(loadParentHomeWithSecondaryData(user, {
            schedule: partialSchedule,
            force: true
        })).rejects.toThrow('The complete schedule could not be loaded');

        expect(scheduleServiceMocks.hydrateParentScheduleDetails).not.toHaveBeenCalled();
        expect(chatServiceMocks.loadChatInbox).not.toHaveBeenCalled();
        expect(feesMocks.listParentTeamFeeRecipients).not.toHaveBeenCalled();
        expect(window.localStorage.getItem('allplays:appDataCache:home-secondary%3Av2%3Aparent-1')).toBeNull();
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
