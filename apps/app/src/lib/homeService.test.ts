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
vi.mock('./adapters/legacyHomeFees', () => feesMocks);
vi.mock('./uxTiming', () => ({
    startUxTimer: vi.fn(() => ({ end: vi.fn() }))
}));
vi.mock('./logger', () => ({
    createLogger: vi.fn(() => ({ warn: vi.fn() }))
}));

import {
    loadParentHomeSummary,
    loadParentHomeWithSecondaryData,
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

    it('rejects a partial nonempty chooser so a later complete load cannot be masked', async () => {
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

        await expect(loadParentTeamsSummaryBootstrap(user)).rejects.toThrow(
            'Team access discovery is incomplete'
        );
        const complete = await loadParentTeamsSummaryBootstrap(user);

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

    it('keeps a valid Home schedule usable when one secondary slice is permission denied', async () => {
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
                date: new Date('2026-08-12T18:00:00.000Z')
            }]
        } as any;
        const permissionError = Object.assign(new Error('Missing or insufficient permissions.'), {
            code: 'permission-denied'
        });
        scheduleServiceMocks.hydrateParentScheduleDetails.mockRejectedValueOnce(permissionError);
        chatServiceMocks.loadChatInbox.mockResolvedValueOnce({
            teams: [{ id: 'team-1', name: 'Fast Falcons', role: 'Parent', unreadCount: 0 }]
        });

        const home = await loadParentHomeWithSecondaryData(user, { schedule, force: true });

        expect(home.upcomingEvents).toEqual(expect.arrayContaining([
            expect.objectContaining({ id: 'event-1', teamId: 'team-1' })
        ]));
        expect(home.teams).toEqual(expect.arrayContaining([
            expect.objectContaining({ teamId: 'team-1', teamName: 'Fast Falcons' })
        ]));
    });

    it('still surfaces a retryable error when every Home secondary slice fails', async () => {
        const schedule = { children: [], events: [] } as any;
        scheduleServiceMocks.hydrateParentScheduleDetails.mockRejectedValueOnce(new Error('schedule unavailable'));
        chatServiceMocks.loadChatInbox.mockRejectedValueOnce(new Error('chat unavailable'));
        feesMocks.listParentTeamFeeRecipients.mockRejectedValueOnce(new Error('fees unavailable'));

        await expect(loadParentHomeWithSecondaryData(user, { schedule, force: true }))
            .rejects.toThrow('schedule unavailable');
    });
});
