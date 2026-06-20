// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clearAppDataCache } from '../../apps/app/src/lib/appDataCache.ts';

const scheduleMocks = vi.hoisted(() => ({
    loadParentSchedule: vi.fn(),
    loadParentScheduleChildren: vi.fn(),
    hydrateParentScheduleDetails: vi.fn((schedule) => Promise.resolve(schedule))
}));

const chatMocks = vi.hoisted(() => ({
    loadChatInbox: vi.fn()
}));

const dbMocks = vi.hoisted(() => ({
    listParentTeamFeeRecipients: vi.fn()
}));

const feeMocks = vi.hoisted(() => ({
    normalizeParentFeeRecord: vi.fn((fee) => ({
        id: fee.id,
        teamId: fee.teamId,
        teamName: fee.teamName,
        playerId: fee.playerId,
        playerName: fee.playerName,
        title: fee.title,
        status: fee.status,
        balanceDueCents: fee.balanceDueCents,
        dueDate: fee.dueDate
    }))
}));

vi.mock('../../apps/app/src/lib/scheduleService.ts', () => scheduleMocks);
vi.mock('../../apps/app/src/lib/chatService.ts', () => chatMocks);
vi.mock('../../js/db.js', () => dbMocks);
vi.mock('../../js/parent-dashboard-fees.js', () => feeMocks);

const user = {
    uid: 'user-1',
    email: 'parent@example.com',
    displayName: 'Pat Parent',
    parentOf: [
        {
            teamId: 'team-1',
            teamName: 'Bears',
            playerId: 'player-1',
            playerName: 'Pat Star'
        }
    ]
};

function event(overrides = {}) {
    return {
        eventKey: overrides.eventKey || 'team-1::game-1::player-1',
        id: overrides.id || 'game-1',
        teamId: overrides.teamId || 'team-1',
        teamName: overrides.teamName || 'Bears',
        type: overrides.type || 'game',
        date: overrides.date || new Date('2100-06-01T18:00:00Z'),
        location: 'Main Gym',
        opponent: 'Falcons',
        title: null,
        childId: overrides.childId || 'player-1',
        childName: overrides.childName || 'Pat Star',
        isDbGame: overrides.isDbGame !== false,
        isCancelled: false,
        myRsvp: overrides.myRsvp || 'not_responded',
        assignments: overrides.assignments || [],
        ...overrides
    };
}

beforeEach(() => {
    vi.clearAllMocks();
    clearAppDataCache();
    scheduleMocks.loadParentSchedule.mockResolvedValue({
        children: [
            {
                teamId: 'team-1',
                teamName: 'Bears',
                playerId: 'player-1',
                playerName: 'Pat Star'
            }
        ],
        events: [event()]
    });
    scheduleMocks.loadParentScheduleChildren.mockResolvedValue([
        {
            teamId: 'team-1',
            teamName: 'Bears',
            playerId: 'player-1',
            playerName: 'Pat Star'
        }
    ]);
    chatMocks.loadChatInbox.mockResolvedValue({
        teams: [
            {
                id: 'team-1',
                name: 'Bears',
                role: 'Parent',
                sport: 'Basketball',
                unreadCount: 2
            },
            {
                id: 'team-staff',
                name: 'Staff Wolves',
                role: 'Coach',
                sport: 'Soccer',
                unreadCount: 3
            }
        ]
    });
    dbMocks.listParentTeamFeeRecipients.mockResolvedValue([
        {
            id: 'fee-1',
            teamId: 'team-1',
            teamName: 'Bears',
            playerId: 'player-1',
            playerName: 'Pat Star',
            title: 'Tournament fee',
            status: 'unpaid',
            balanceDueCents: 2500
        }
    ]);
});

describe('React app Home service', () => {
    it('composes schedule, chat, and fee data into the parent Home model', async () => {
        const { loadParentHome } = await import('../../apps/app/src/lib/homeService.ts');

        const home = await loadParentHome(user);

        expect(scheduleMocks.loadParentSchedule).toHaveBeenCalledWith(user, { hydrateDetails: false, expandStaffPlayers: false });
        expect(chatMocks.loadChatInbox).toHaveBeenCalledWith(user);
        expect(dbMocks.listParentTeamFeeRecipients).toHaveBeenCalledWith(user.uid, [
            expect.objectContaining({ teamId: 'team-1', playerId: 'player-1' })
        ]);
        expect(feeMocks.normalizeParentFeeRecord).toHaveBeenCalledWith(expect.objectContaining({ id: 'fee-1' }));
        expect(home.players).toHaveLength(1);
        expect(home.teams).toEqual(expect.arrayContaining([
            expect.objectContaining({
                teamId: 'team-1',
                teamName: 'Bears',
                unreadCount: 2,
                players: [expect.objectContaining({ playerId: 'player-1' })]
            }),
            expect.objectContaining({
                teamId: 'team-staff',
                teamName: 'Staff Wolves',
                role: 'Coach',
                sport: 'Soccer',
                unreadCount: 3,
                players: []
            })
        ]));
        expect(home.metrics).toEqual(expect.objectContaining({
            players: 1,
            teams: 2,
            rsvpNeeded: 1,
            unreadMessages: 5
        }));
        expect(home.fees).toEqual([
            expect.objectContaining({
                id: 'fee-1',
                title: 'Tournament fee',
                balanceDueCents: 2500
            })
        ]);
        expect(home.actionItems.map((item) => item.kind)).toEqual(expect.arrayContaining(['rsvp', 'fee', 'message']));
    });

    it('throws a typed network error when Home secondary data fails to load', async () => {
        chatMocks.loadChatInbox.mockRejectedValueOnce(new TypeError('Failed to fetch'));
        const { loadParentHome } = await import('../../apps/app/src/lib/homeService.ts');

        await expect(loadParentHome(user)).rejects.toMatchObject({
            name: 'AppServiceError',
            type: 'network',
            message: 'Failed to fetch'
        });
    });

    it('throws a typed permission error when Home fees are denied', async () => {
        dbMocks.listParentTeamFeeRecipients.mockRejectedValueOnce(new Error('Permission denied for fees'));
        const { loadParentHomeWithSecondaryData } = await import('../../apps/app/src/lib/homeService.ts');

        await expect(loadParentHomeWithSecondaryData(user, {
            schedule: {
                children: [
                    {
                        teamId: 'team-1',
                        teamName: 'Bears',
                        playerId: 'player-1',
                        playerName: 'Pat Star'
                    }
                ],
                events: [event()]
            }
        })).rejects.toMatchObject({
            name: 'AppServiceError',
            type: 'permission',
            message: 'Permission denied for fees'
        });
    });

    it('keeps rendering Home secondary data when fees fail for a non-permission reason', async () => {
        dbMocks.listParentTeamFeeRecipients.mockRejectedValueOnce(new TypeError('Failed to fetch'));
        const { loadParentHomeWithSecondaryData } = await import('../../apps/app/src/lib/homeService.ts');

        const home = await loadParentHomeWithSecondaryData(user, {
            schedule: {
                children: [
                    {
                        teamId: 'team-1',
                        teamName: 'Bears',
                        playerId: 'player-1',
                        playerName: 'Pat Star'
                    }
                ],
                events: [event()]
            }
        });

        expect(home.fees).toEqual([]);
        expect(home.teams).toEqual(expect.arrayContaining([
            expect.objectContaining({ teamId: 'team-1', unreadCount: 2 })
        ]));
    });

    it('preserves every completed secondary slice in the final progressive Home model', async () => {
        let resolveChat;
        let resolveFees;
        chatMocks.loadChatInbox.mockImplementationOnce(() => new Promise((resolve) => {
            resolveChat = resolve;
        }));
        dbMocks.listParentTeamFeeRecipients.mockImplementationOnce(() => new Promise((resolve) => {
            resolveFees = resolve;
        }));
        const onPartial = vi.fn();
        const { loadParentHomeWithSecondaryData } = await import('../../apps/app/src/lib/homeService.ts');

        const promise = loadParentHomeWithSecondaryData(user, {
            schedule: {
                children: [
                    {
                        teamId: 'team-1',
                        teamName: 'Bears',
                        playerId: 'player-1',
                        playerName: 'Pat Star'
                    }
                ],
                events: [event()]
            },
            onPartial
        });

        resolveChat({
            teams: [
                {
                    id: 'team-1',
                    name: 'Bears',
                    role: 'Parent',
                    sport: 'Basketball',
                    unreadCount: 4
                }
            ]
        });
        await Promise.resolve();
        expect(onPartial).toHaveBeenCalledWith(expect.objectContaining({
            metrics: expect.objectContaining({ unreadMessages: 4 }),
            fees: []
        }));

        resolveFees([
            {
                id: 'fee-late',
                teamId: 'team-1',
                teamName: 'Bears',
                playerId: 'player-1',
                playerName: 'Pat Star',
                title: 'Late dues',
                status: 'unpaid',
                balanceDueCents: 5000
            }
        ]);

        const home = await promise;

        expect(home.teams).toEqual(expect.arrayContaining([
            expect.objectContaining({ teamId: 'team-1', unreadCount: 4 })
        ]));
        expect(home.fees).toEqual([
            expect.objectContaining({ id: 'fee-late', title: 'Late dues' })
        ]);
        expect(home.actionItems.map((item) => item.kind)).toEqual(expect.arrayContaining(['fee', 'message']));
    });

    it('throws a typed network error when the Teams summary chat load fails', async () => {
        chatMocks.loadChatInbox.mockRejectedValueOnce(new TypeError('Failed to fetch'));
        const { loadParentTeamsSummary } = await import('../../apps/app/src/lib/homeService.ts');

        await expect(loadParentTeamsSummary(user, { force: true })).rejects.toMatchObject({
            name: 'AppServiceError',
            type: 'network',
            message: 'Failed to fetch'
        });

        expect(chatMocks.loadChatInbox).toHaveBeenCalledWith(user, { includeLastMessages: false });
    });

    it('uses the shared parent child resolver for the fast Teams summary', async () => {
        const { loadParentTeamsSummary } = await import('../../apps/app/src/lib/homeService.ts');

        const home = await loadParentTeamsSummary({ ...user, parentOf: [] }, { force: true });

        expect(scheduleMocks.loadParentScheduleChildren).toHaveBeenCalledWith(expect.objectContaining({
            uid: 'user-1',
            parentOf: []
        }));
        expect(home.players).toEqual([
            expect.objectContaining({
                teamId: 'team-1',
                playerId: 'player-1',
                playerName: 'Pat Star'
            })
        ]);
        expect(home.teams).toEqual(expect.arrayContaining([
            expect.objectContaining({
                teamId: 'team-1',
                players: [expect.objectContaining({ playerId: 'player-1' })]
            })
        ]));
    });

    it('composes the fast Home summary without optional secondary data', async () => {
        const { loadParentHomeSummary } = await import('../../apps/app/src/lib/homeService.ts');

        const home = await loadParentHomeSummary(user, { force: true });

        expect(scheduleMocks.loadParentSchedule).toHaveBeenCalledWith(user, { hydrateDetails: false, expandStaffPlayers: false });
        expect(chatMocks.loadChatInbox).not.toHaveBeenCalled();
        expect(dbMocks.listParentTeamFeeRecipients).not.toHaveBeenCalled();
        expect(home.players).toHaveLength(1);
        expect(home.metrics).toEqual(expect.objectContaining({
            players: 1,
            teams: 1,
            rsvpNeeded: 1,
            unreadMessages: 0
        }));
        expect(home.fees).toEqual([]);
    });

    it('reuses one base schedule load across summary and secondary Home refresh', async () => {
        scheduleMocks.loadParentSchedule.mockImplementation((_, options = {}) => Promise.resolve({
            children: [
                {
                    teamId: 'team-1',
                    teamName: 'Bears',
                    playerId: 'player-1',
                    playerName: 'Pat Star'
                }
            ],
            events: [event({
                assignments: [{ role: 'Snacks', claimable: true }],
                myRsvp: 'not_responded'
            })]
        }));
        const { loadParentHomeSummaryBootstrap, loadParentHomeWithSecondaryData } = await import('../../apps/app/src/lib/homeService.ts');

        const summary = await loadParentHomeSummaryBootstrap(user, { force: true });
        const detailed = await loadParentHomeWithSecondaryData(user, { force: true, schedule: summary.schedule });

        expect(scheduleMocks.loadParentSchedule).toHaveBeenCalledTimes(1);
        expect(scheduleMocks.loadParentSchedule).toHaveBeenCalledWith(user, { hydrateDetails: false, expandStaffPlayers: false });
        expect(scheduleMocks.hydrateParentScheduleDetails).toHaveBeenCalledTimes(1);
        expect(scheduleMocks.hydrateParentScheduleDetails).toHaveBeenCalledWith(expect.objectContaining({
            children: [expect.objectContaining({ teamId: 'team-1', playerId: 'player-1' })],
            events: [expect.objectContaining({ id: 'game-1' })]
        }), user);
        expect(summary.home.actionItems.map((item) => item.kind)).toEqual(expect.arrayContaining(['rsvp', 'assignment']));
        expect(detailed.actionItems.map((item) => item.kind)).toEqual(expect.arrayContaining(['rsvp', 'assignment']));
        expect(detailed.metrics.rsvpNeeded).toBe(1);
    });

    it('returns an empty model without touching Firebase when signed out', async () => {
        const { loadParentHome } = await import('../../apps/app/src/lib/homeService.ts');

        const home = await loadParentHome(null);

        expect(scheduleMocks.loadParentSchedule).not.toHaveBeenCalled();
        expect(chatMocks.loadChatInbox).not.toHaveBeenCalled();
        expect(dbMocks.listParentTeamFeeRecipients).not.toHaveBeenCalled();
        expect(home).toEqual(expect.objectContaining({
            players: [],
            teams: [],
            upcomingEvents: [],
            actionItems: [],
            fees: []
        }));
    });
});
