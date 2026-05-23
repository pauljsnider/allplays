import { describe, expect, it } from 'vitest';

import {
    buildHomeActionItems,
    buildParentHomeModel,
    getEventDetailPath,
    getPlayerDetailPath,
    getTeamHomePath
} from '../../apps/app/src/lib/homeLogic.ts';

function child(overrides = {}) {
    return {
        teamId: overrides.teamId || 'team-1',
        teamName: overrides.teamName || 'Bears',
        playerId: overrides.playerId || 'player-1',
        playerName: overrides.playerName || 'Pat',
        ...overrides
    };
}

function event(overrides = {}) {
    const teamId = overrides.teamId || 'team-1';
    const id = overrides.id || 'game-1';
    const childId = overrides.childId || 'player-1';
    return {
        eventKey: overrides.eventKey || `${teamId}::${id}::${childId}`,
        id,
        teamId,
        teamName: overrides.teamName || 'Bears',
        type: overrides.type || 'game',
        date: overrides.date || new Date('2100-06-01T18:00:00Z'),
        location: overrides.location || 'Main Gym',
        opponent: overrides.opponent || 'Falcons',
        title: overrides.title || null,
        childId,
        childName: overrides.childName || 'Pat',
        isDbGame: overrides.isDbGame !== false,
        isCancelled: overrides.isCancelled === true,
        myRsvp: overrides.myRsvp || 'not_responded',
        assignments: overrides.assignments || [],
        ...overrides
    };
}

describe('React app Home model helpers', () => {
    it('builds a parent action queue from schedule, packets, assignments, fees, and chat', () => {
        const now = new Date('2100-05-30T12:00:00Z');
        const children = [
            child({ teamId: 'team-1', teamName: 'Bears', playerId: 'player-1', playerName: 'Pat' }),
            child({ teamId: 'team-2', teamName: 'Thunder', playerId: 'player-2', playerName: 'Sam' })
        ];
        const events = [
            event({
                id: 'game-1',
                teamId: 'team-1',
                teamName: 'Bears',
                childId: 'player-1',
                childName: 'Pat',
                myRsvp: 'not_responded',
                date: new Date('2100-06-01T18:00:00Z')
            }),
            event({
                eventKey: 'team-1::game-1::player-2',
                id: 'game-1',
                teamId: 'team-1',
                teamName: 'Bears',
                childId: 'player-2',
                childName: 'Sam',
                myRsvp: 'going',
                date: new Date('2100-06-01T18:00:00Z')
            }),
            event({
                id: 'practice-1',
                type: 'practice',
                title: 'Practice',
                childId: 'player-1',
                childName: 'Pat',
                myRsvp: 'going',
                date: new Date('2100-06-02T19:00:00Z'),
                practiceHomePacketSummary: '2 drills · 20 min'
            }),
            event({
                id: 'game-2',
                teamId: 'team-2',
                teamName: 'Thunder',
                childId: 'player-2',
                childName: 'Sam',
                myRsvp: 'going',
                date: new Date('2100-06-03T18:00:00Z'),
                assignments: [
                    { role: 'Snacks', value: '', claimable: true, claim: null },
                    { role: 'Clock', value: 'Jamie', claimable: false, claim: null }
                ]
            }),
            event({
                id: 'cancelled',
                childId: 'player-1',
                childName: 'Pat',
                isCancelled: true,
                date: new Date('2100-06-04T18:00:00Z')
            }),
            event({
                id: 'old-game',
                childId: 'player-1',
                childName: 'Pat',
                date: new Date('2000-06-01T18:00:00Z')
            })
        ];
        const fees = [
            { id: 'fee-1', title: 'Spring dues', teamId: 'team-1', teamName: 'Bears', playerName: 'Pat', status: 'partial', balanceDueCents: 1500 },
            { id: 'fee-2', title: 'Paid dues', teamId: 'team-1', teamName: 'Bears', status: 'paid', balanceDueCents: 0 }
        ];
        const inboxTeams = [
            { id: 'team-2', name: 'Thunder', role: 'Parent', unreadCount: 4, sport: 'Soccer' }
        ];

        const model = buildParentHomeModel({ children, events, fees, inboxTeams, now });

        expect(model.metrics).toEqual({
            players: 2,
            teams: 2,
            rsvpNeeded: 1,
            unreadMessages: 4,
            packetsReady: 1
        });
        expect(model.fees.map((fee) => fee.id)).toEqual(['fee-1']);
        expect(model.upcomingEvents.map((item) => item.id)).toEqual(['game-1', 'practice-1', 'game-2']);
        expect(model.players.find((player) => player.playerId === 'player-1')).toMatchObject({
            rsvpNeeded: 1,
            packetsReady: 1,
            openAssignments: 0
        });
        expect(model.teams.find((team) => team.teamId === 'team-2')).toMatchObject({
            role: 'Parent',
            unreadCount: 4,
            openActions: 2
        });
        expect(model.actionItems.map((action) => action.kind)).toEqual(['rsvp', 'packet', 'assignment', 'fee', 'message']);
        expect(model.actionItems.find((action) => action.kind === 'rsvp')).toMatchObject({
            title: 'Pat needs availability',
            to: '/schedule/team-1/game-1?childId=player-1&section=availability'
        });
    });

    it('keeps Home drill-in links encoded for team-scoped player and event routes', () => {
        expect(getPlayerDetailPath('team/with slash', 'player 1')).toBe('/players/team%2Fwith%20slash/player%201');
        expect(getTeamHomePath('team/with slash')).toBe('/teams?selectedTeamId=team%2Fwith+slash&from=home');
        expect(getEventDetailPath({
            teamId: 'team/with slash',
            id: 'game 1',
            childId: 'player 1'
        }, 'assignments')).toBe('/schedule/team%2Fwith%20slash/game%201?childId=player+1&section=assignments');

        const actions = buildHomeActionItems({
            events: [
                event({
                    id: 'locked-game',
                    availabilityLocked: true,
                    myRsvp: 'not_responded'
                })
            ],
            now: new Date('2100-05-30T12:00:00Z')
        });

        expect(actions).toEqual([]);
    });

    it('includes chat-access teams without linked players so Home and Messages stay aligned', () => {
        const model = buildParentHomeModel({
            children: [
                child({ teamId: 'team-1', teamName: 'Bears', playerId: 'player-1', playerName: 'Pat' })
            ],
            events: [],
            inboxTeams: [
                { id: 'team-1', name: 'Bears', role: 'Parent', unreadCount: 0, sport: 'Basketball' },
                { id: 'team-staff', name: 'Staff Wolves', role: 'Coach', unreadCount: 3, sport: 'Soccer' }
            ],
            now: new Date('2100-05-30T12:00:00Z')
        });

        expect(model.metrics.teams).toBe(2);
        expect(model.teams.find((team) => team.teamId === 'team-staff')).toMatchObject({
            teamName: 'Staff Wolves',
            role: 'Coach',
            sport: 'Soccer',
            players: [],
            unreadCount: 3,
            openActions: 1
        });
        expect(model.actionItems.find((action) => action.id === 'message:team-staff')).toMatchObject({
            kind: 'message',
            to: '/messages/team-staff'
        });
    });
});
