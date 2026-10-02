// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearAppDataCache, getCachedAppData, getParentScheduleSummaryCacheKey, invalidateCachedAppData } from './appDataCache';

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
        nativeRuntimeMocks.isNativeRuntime.mockReturnValue(false);
        profileServiceMocks.loadManagedTeamsFromNativeCallable.mockReset();
        profileServiceMocks.loadProfileDocument.mockReset();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('opts only Home bootstrap into parent previews and does not cache incomplete discovery as complete', async () => {
        const incomplete = { children: [], events: [], staffTeams: [], isPartial: true };
        const pending = deferred<typeof incomplete>();
        const onPartial = vi.fn();
        scheduleServiceMocks.loadParentSchedule.mockImplementationOnce((_user, options) => {
            options.onPartial(incomplete);
            return pending.promise;
        }).mockResolvedValue(incomplete);
        const bootstrap = loadParentHomeSummaryBootstrap(user, { onPartial });
        expect(onPartial).toHaveBeenCalledWith(expect.objectContaining({ schedule: incomplete }));
        expect(window.localStorage.length).toBe(0);
        pending.resolve(incomplete);
        expect((await bootstrap).schedule.isPartial).toBe(true);
        expect(scheduleServiceMocks.loadParentSchedule).toHaveBeenLastCalledWith(user, expect.objectContaining({ previewParentChildren: true }));
        await loadParentHomeSummaryBootstrap(user);
        expect(scheduleServiceMocks.loadParentSchedule).toHaveBeenCalledTimes(2);
        expect(window.localStorage.length).toBe(0);
        await loadParentScheduleSummary(user);
        expect(scheduleServiceMocks.loadParentSchedule).toHaveBeenLastCalledWith(user, expect.objectContaining({ previewParentChildren: undefined }));
    });

    it('keeps Home previews when a non-preview schedule summary is already in flight', async () => {
        const preview = {
            children: [{ teamId: 'team-1', teamName: 'Fast Falcons', playerId: 'player-1', playerName: 'Avery Ace' }],
            events: [],
            staffTeams: [],
            isPartial: true
        };
        const complete = { ...preview, isPartial: false };
        const pendingNonPreview = deferred<typeof complete>();
        const pendingHome = deferred<typeof complete>();
        const onPartial = vi.fn();
        scheduleServiceMocks.loadParentSchedule
            .mockImplementationOnce((_user, options) => {
                expect(options.previewParentChildren).toBeUndefined();
                return pendingNonPreview.promise;
            })
            .mockImplementationOnce((_user, options) => {
                expect(options.previewParentChildren).toBe(true);
                options.onPartial(preview);
                return pendingHome.promise;
            });

        const nonPreviewLoad = loadParentScheduleSummary(user);
        const homeLoad = loadParentHomeSummaryBootstrap(user, { onPartial });

        expect(scheduleServiceMocks.loadParentSchedule).toHaveBeenCalledTimes(2);
        expect(onPartial).toHaveBeenCalledWith(expect.objectContaining({ schedule: preview }));

        pendingNonPreview.resolve(complete);
        pendingHome.resolve(complete);
        await expect(nonPreviewLoad).resolves.toEqual(complete);
        await expect(homeLoad).resolves.toEqual(expect.objectContaining({ schedule: complete }));
    });

    it('replays an in-flight Home preview to a later Home caller', async () => {
        const preview = {
            children: [{ teamId: 'team-1', teamName: 'Fast Falcons', playerId: 'player-1', playerName: 'Avery Ace' }],
            events: [],
            staffTeams: [],
            isPartial: true
        };
        const complete = { ...preview, isPartial: false };
        const pendingHome = deferred<typeof complete>();
        const firstOnPartial = vi.fn();
        const secondOnPartial = vi.fn();
        scheduleServiceMocks.loadParentSchedule.mockImplementationOnce((_user, options) => {
            options.onPartial(preview);
            return pendingHome.promise;
        });

        const firstHomeLoad = loadParentHomeSummaryBootstrap(user, { onPartial: firstOnPartial });
        const secondHomeLoad = loadParentHomeSummaryBootstrap(user, { onPartial: secondOnPartial });

        expect(scheduleServiceMocks.loadParentSchedule).toHaveBeenCalledTimes(1);
        expect(firstOnPartial).toHaveBeenCalledWith(expect.objectContaining({ schedule: preview }));
        expect(secondOnPartial).toHaveBeenCalledWith(expect.objectContaining({ schedule: preview }));

        pendingHome.resolve(complete);
        await expect(firstHomeLoad).resolves.toEqual(expect.objectContaining({ schedule: complete }));
        await expect(secondHomeLoad).resolves.toEqual(expect.objectContaining({ schedule: complete }));
    });

    it.each([
        ['key', 'old-first'], ['key', 'new-first'],
        ['clear-all', 'old-first'], ['clear-all', 'new-first'],
        ['clear-prefix', 'old-first'], ['clear-prefix', 'new-first']
    ])('does not join or replay invalidated Home previews (%s, %s)', async (invalidation, completionOrder) => {
        const key = getParentScheduleSummaryCacheKey(user.uid);
        const oldPreview = { children: [], events: [], staffTeams: [], isPartial: true, marker: 'old' };
        const newPreview = { ...oldPreview, marker: 'new' };
        const oldComplete = { ...oldPreview, isPartial: false };
        const newComplete = { ...newPreview, isPartial: false };
        const oldPending = deferred<typeof oldComplete>();
        const newPending = deferred<typeof newComplete>();
        const oldCallback = vi.fn();
        const newCallback = vi.fn();
        let oldOptions: any;
        let newOptions: any;
        scheduleServiceMocks.loadParentSchedule
            .mockImplementationOnce((_user, options) => {
                oldOptions = options;
                options.onPartial(oldPreview);
                return oldPending.promise;
            })
            .mockImplementationOnce((_user, options) => {
                newOptions = options;
                return newPending.promise;
            });
        const oldLoad = loadParentHomeSummaryBootstrap(user, { onPartial: oldCallback });
        if (invalidation === 'key') invalidateCachedAppData(key);
        else clearAppDataCache(invalidation === 'clear-prefix' ? 'app-schedule-summary:' : '');
        const newLoad = loadParentHomeSummaryBootstrap(user, { onPartial: newCallback });
        try {
            expect(scheduleServiceMocks.loadParentSchedule).toHaveBeenCalledTimes(2);
            expect(newCallback).not.toHaveBeenCalled();
            oldOptions.onPartial(oldPreview);
            expect(oldCallback).toHaveBeenCalledWith(expect.objectContaining({ schedule: oldPreview }));
            expect(newCallback).not.toHaveBeenCalled();
            newOptions.onPartial(newPreview);
            expect(newCallback).toHaveBeenCalledWith(expect.objectContaining({ schedule: newPreview }));
            if (completionOrder === 'old-first') {
                oldPending.resolve(oldComplete);
                await oldLoad;
                expect(getCachedAppData(key)).toBeNull();
                newPending.resolve(newComplete);
            } else {
                newPending.resolve(newComplete);
                await newLoad;
                oldPending.resolve(oldComplete);
            }
            await expect(oldLoad).resolves.toEqual(expect.objectContaining({ schedule: oldComplete }));
            await expect(newLoad).resolves.toEqual(expect.objectContaining({ schedule: newComplete }));
            expect(newCallback).not.toHaveBeenCalledWith(expect.objectContaining({ schedule: oldPreview }));
            expect(newCallback).not.toHaveBeenCalledWith(expect.objectContaining({ schedule: oldComplete }));
            expect(getCachedAppData(key)).toEqual(newComplete);
            const stored = window.localStorage.getItem(`allplays:appDataCache:${encodeURIComponent(key)}`);
            expect(JSON.parse(stored || '{}').value).toEqual(newComplete);
        } finally {
            oldPending.resolve(oldComplete);
            newPending.resolve(newComplete);
            await Promise.all([oldLoad, newLoad]);
        }
    });

    it('isolates previews from overlapping forced Home generations and keeps the newer cache value', async () => {
        const olderPreview = {
            children: [{ teamId: 'team-old', teamName: 'Old Team', playerId: 'old-player', playerName: 'Old Player' }],
            events: [],
            staffTeams: [],
            isPartial: true
        };
        const newerPreview = {
            children: [{ teamId: 'team-new', teamName: 'New Team', playerId: 'new-player', playerName: 'New Player' }],
            events: [],
            staffTeams: [],
            isPartial: true
        };
        const olderComplete = { ...olderPreview, isPartial: false };
        const newerComplete = { ...newerPreview, isPartial: false };
        const older = deferred<typeof olderComplete>();
        const newer = deferred<typeof newerComplete>();
        const olderOnPartial = vi.fn();
        const newerOnPartial = vi.fn();
        let olderOptions: any;
        let newerOptions: any;
        scheduleServiceMocks.loadParentSchedule
            .mockImplementationOnce((_user, options) => {
                olderOptions = options;
                return older.promise;
            })
            .mockImplementationOnce((_user, options) => {
                newerOptions = options;
                return newer.promise;
            });

        const olderHome = loadParentHomeSummaryBootstrap(user, { force: true, onPartial: olderOnPartial });
        const newerHome = loadParentHomeSummaryBootstrap(user, { force: true, onPartial: newerOnPartial });
        newerOptions.onPartial(newerPreview);
        olderOptions.onPartial(olderPreview);

        expect(olderOnPartial).toHaveBeenCalledWith(expect.objectContaining({ schedule: olderPreview }));
        expect(olderOnPartial).not.toHaveBeenCalledWith(expect.objectContaining({ schedule: newerPreview }));
        expect(newerOnPartial).toHaveBeenCalledWith(expect.objectContaining({ schedule: newerPreview }));
        expect(newerOnPartial).not.toHaveBeenCalledWith(expect.objectContaining({ schedule: olderPreview }));

        newer.resolve(newerComplete);
        await expect(newerHome).resolves.toEqual(expect.objectContaining({ schedule: newerComplete }));
        older.resolve(olderComplete);
        await expect(olderHome).resolves.toEqual(expect.objectContaining({ schedule: olderComplete }));

        scheduleServiceMocks.loadParentSchedule.mockClear();
        await expect(loadParentScheduleSummary(user)).resolves.toEqual(newerComplete);
        expect(scheduleServiceMocks.loadParentSchedule).not.toHaveBeenCalled();
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

    it.each(['complete', 'partial', 'error'])('shares a stale Home refresh until %s settlement', async (outcome) => {
        vi.useFakeTimers();
        vi.setSystemTime(0);
        const stale = { children: [], events: [] } as any;
        scheduleServiceMocks.loadParentSchedule.mockResolvedValueOnce(stale);
        await loadParentScheduleSummary(user, { previewParentChildren: true });
        vi.setSystemTime(46000);
        const refresh = deferred<any>();
        scheduleServiceMocks.loadParentSchedule.mockReturnValue(refresh.promise);
        const first = { previewParentChildren: true, onPartial: vi.fn(), onRefresh: vi.fn(), onBackgroundError: vi.fn() };
        const second = { previewParentChildren: true, onPartial: vi.fn(), onRefresh: vi.fn(), onBackgroundError: vi.fn() };
        expect(await loadParentScheduleSummary(user, first)).toBe(stale);
        expect(await loadParentScheduleSummary(user, second)).toBe(stale);
        expect(scheduleServiceMocks.loadParentSchedule).toHaveBeenCalledTimes(2);
        scheduleServiceMocks.loadParentSchedule.mock.calls[1][1].onPartial({ ...stale, isPartial: true });
        expect(first.onPartial).not.toHaveBeenCalled();
        expect(second.onPartial).not.toHaveBeenCalled();
        const result = { ...stale, isPartial: outcome === 'partial' };
        const error = new Error('refresh unavailable');
        if (outcome === 'error') refresh.reject(error);
        else refresh.resolve(result);
        await vi.waitFor(() => {
            for (const subscriber of [first, second]) {
                if (outcome === 'error') expect(subscriber.onBackgroundError).toHaveBeenCalledWith(error);
                else expect(subscriber.onRefresh).toHaveBeenCalledWith(result);
            }
        });
        scheduleServiceMocks.loadParentSchedule.mockResolvedValue(stale);
        await loadParentScheduleSummary(user, { previewParentChildren: true });
        expect(scheduleServiceMocks.loadParentSchedule).toHaveBeenCalledTimes(outcome === 'complete' ? 2 : 3);
    });

    it('waits for the shared refresh once the stale Home value expires', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(0);
        const stale = { children: [], events: [] } as any;
        scheduleServiceMocks.loadParentSchedule.mockResolvedValueOnce(stale);
        await loadParentScheduleSummary(user, { previewParentChildren: true });
        vi.setSystemTime(46000);
        const refresh = deferred<any>();
        scheduleServiceMocks.loadParentSchedule.mockReturnValue(refresh.promise);
        expect(await loadParentScheduleSummary(user, { previewParentChildren: true })).toBe(stale);
        vi.setSystemTime(345000);
        const returned = vi.fn();
        const expired = loadParentScheduleSummary(user, { previewParentChildren: true }).then(returned);
        await Promise.resolve();
        expect(returned).not.toHaveBeenCalled();
        const fresh = { ...stale, staffTeams: [] };
        refresh.resolve(fresh);
        await expired;
        expect(returned).toHaveBeenCalledWith(fresh);
        expect(scheduleServiceMocks.loadParentSchedule).toHaveBeenCalledTimes(2);
    });

    it.each(['invalidate', 'force', 'other-user'])('isolates a stale refresh from a newer %s request', async (boundary) => {
        vi.useFakeTimers();
        vi.setSystemTime(0);
        const stale = { children: [], events: [] } as any;
        scheduleServiceMocks.loadParentSchedule.mockResolvedValueOnce(stale);
        await loadParentScheduleSummary(user, { previewParentChildren: true });
        vi.setSystemTime(46000);
        const oldRefresh = deferred<any>();
        const newRefresh = deferred<any>();
        scheduleServiceMocks.loadParentSchedule.mockReturnValueOnce(oldRefresh.promise).mockReturnValueOnce(newRefresh.promise);
        const oldCallback = vi.fn();
        expect(await loadParentScheduleSummary(user, { previewParentChildren: true, onRefresh: oldCallback })).toBe(stale);
        if (boundary === 'invalidate') invalidateCachedAppData(getParentScheduleSummaryCacheKey(user.uid));
        const nextUser = boundary === 'other-user' ? { ...user, uid: 'parent-2' } : user;
        const newCallback = vi.fn();
        const next = loadParentScheduleSummary(nextUser, {
            previewParentChildren: true, force: boundary === 'force', onPartial: newCallback
        });
        const oldResult = { ...stale, staffTeams: [{ teamId: 'old', teamName: 'Old' }] };
        oldRefresh.resolve(oldResult);
        await vi.waitFor(() => expect(oldCallback).toHaveBeenCalledWith(oldResult));
        expect(newCallback).not.toHaveBeenCalled();
        // Settling the previous request must not delete the new request's registry entry.
        const joined = loadParentScheduleSummary(nextUser, { previewParentChildren: true });
        expect(scheduleServiceMocks.loadParentSchedule).toHaveBeenCalledTimes(3);
        const newResult = { ...stale, staffTeams: [{ teamId: 'new', teamName: 'New' }] };
        newRefresh.resolve(newResult);
        expect(await next).toBe(newResult);
        expect(await joined).toBe(newResult);
        expect(getCachedAppData(getParentScheduleSummaryCacheKey(nextUser.uid))).toBe(newResult);
    });

    it('suppresses synchronous discovery partials when returning a cached Home', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(0);
        const stale = { children: [], events: [] } as any;
        scheduleServiceMocks.loadParentSchedule.mockResolvedValueOnce(stale);
        await loadParentScheduleSummary(user, { previewParentChildren: true });
        vi.setSystemTime(46000);
        const refresh = deferred<any>();
        scheduleServiceMocks.loadParentSchedule.mockImplementationOnce((_user, options) => {
            options.onPartial({ ...stale, isPartial: true });
            return refresh.promise;
        });
        const onPartial = vi.fn();
        expect(await loadParentScheduleSummary(user, { previewParentChildren: true, onPartial })).toBe(stale);
        expect(onPartial).not.toHaveBeenCalled();
        refresh.resolve(stale);
        await vi.waitFor(() => expect(onPartial).toHaveBeenCalledTimes(1));
    });

    it('detaches failed background requests before synchronous retry callbacks', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(0);
        const stale = { children: [], events: [] } as any;
        scheduleServiceMocks.loadParentSchedule.mockResolvedValueOnce(stale);
        await loadParentScheduleSummary(user, { previewParentChildren: true });
        vi.setSystemTime(46000);
        const failed = deferred<any>();
        const retry = deferred<any>();
        scheduleServiceMocks.loadParentSchedule.mockReturnValueOnce(failed.promise).mockReturnValueOnce(retry.promise);
        const retryErrors = vi.fn();
        const retryRefreshes = [vi.fn(), vi.fn()];
        const retryLoads: Promise<unknown>[] = [];
        const errors = retryRefreshes.map((onRefresh) => vi.fn(() => {
            retryLoads.push(loadParentScheduleSummary(user, {
                previewParentChildren: true, onRefresh, onBackgroundError: retryErrors
            }));
        }));
        for (const onBackgroundError of errors) {
            expect(await loadParentScheduleSummary(user, { previewParentChildren: true, onBackgroundError })).toBe(stale);
        }
        const error = new Error('refresh unavailable');
        failed.reject(error);
        await vi.waitFor(() => errors.forEach((callback) => expect(callback).toHaveBeenCalledExactlyOnceWith(error)));
        expect(scheduleServiceMocks.loadParentSchedule).toHaveBeenCalledTimes(3);
        expect(retryErrors).not.toHaveBeenCalled();
        expect(await Promise.all(retryLoads)).toEqual([stale, stale]);
        const fresh = { ...stale, staffTeams: [] };
        retry.resolve(fresh);
        await vi.waitFor(() => retryRefreshes.forEach((callback) => expect(callback).toHaveBeenCalledExactlyOnceWith(fresh)));
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
