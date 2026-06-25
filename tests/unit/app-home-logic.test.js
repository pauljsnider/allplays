import { describe, expect, it } from 'vitest';

import {
    buildHomeActionItems,
    buildParentHomeModel,
    getEventDetailPath,
    getPlayerDetailPath,
    getTeamHomePath
} from '../../apps/app/src/lib/homeLogic.ts';

class InstrumentedEvents extends Array {
    constructor(...items) {
        super(...items);
        this.rootFilterCalls = 0;
    }

    filter(callback, thisArg) {
        this.rootFilterCalls += 1;
        return Array.prototype.filter.call(this, callback, thisArg);
    }
}

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

    it('hides deactivated and archived teams from the My Teams list', () => {
        const model = buildParentHomeModel({
            children: [
                // Parent-linked player on a deactivated team (inbox marks it inactive)
                child({ teamId: 'team-dead', teamName: 'Deer', playerId: 'player-x', playerName: 'Paul' }),
                // Parent-linked player on an active team
                child({ teamId: 'team-live', teamName: 'Current', playerId: 'player-y', playerName: 'Madison' })
            ],
            events: [],
            inboxTeams: [
                { id: 'team-dead', name: 'Deer', role: 'Admin', unreadCount: 0, active: false },
                { id: 'team-live', name: 'Current', role: 'Admin', unreadCount: 0, active: true },
                // Owned/coached teams surfaced only via chat inbox
                { id: 'team-archived', name: 'Old Bears', role: 'Coach', unreadCount: 2, archived: true },
                { id: 'team-status', name: 'Disabled FC', role: 'Coach', unreadCount: 1, status: 'inactive' },
                { id: 'team-ok', name: 'Wildcats', role: 'Coach', unreadCount: 5, active: true }
            ],
            now: new Date('2100-05-30T12:00:00Z')
        });

        const teamIds = model.teams.map((team) => team.teamId).sort();
        expect(teamIds).toEqual(['team-live', 'team-ok']);
        expect(model.metrics.teams).toBe(2);
        // Inactive teams must not leak in through either the child or inbox path.
        expect(model.teams.find((team) => team.teamId === 'team-dead')).toBeUndefined();
        expect(model.teams.find((team) => team.teamId === 'team-archived')).toBeUndefined();
        expect(model.teams.find((team) => team.teamId === 'team-status')).toBeUndefined();
    });

    it('builds the same Home outputs from indexed event aggregates across multiple teams and players', () => {
        const now = new Date('2100-05-30T12:00:00Z');
        const model = buildParentHomeModel({
            children: [
                child({ teamId: 'team-1', teamName: 'Bears', playerId: 'player-1', playerName: 'Pat' }),
                child({ teamId: 'team-1', teamName: 'Bears', playerId: 'player-2', playerName: 'Sam' }),
                child({ teamId: 'team-2', teamName: 'Storm', playerId: 'player-3', playerName: 'Alex' })
            ],
            events: [
                event({
                    id: 'game-1',
                    teamId: 'team-1',
                    teamName: 'Bears',
                    childId: 'player-1',
                    childName: 'Pat',
                    date: new Date('2100-06-01T18:00:00Z'),
                    myRsvp: 'not_responded'
                }),
                event({
                    eventKey: 'team-1::game-1::player-2',
                    id: 'game-1',
                    teamId: 'team-1',
                    teamName: 'Bears',
                    childId: 'player-2',
                    childName: 'Sam',
                    date: new Date('2100-06-01T18:00:00Z'),
                    myRsvp: 'going'
                }),
                event({
                    id: 'practice-1',
                    type: 'practice',
                    teamId: 'team-1',
                    teamName: 'Bears',
                    childId: 'player-1',
                    childName: 'Pat',
                    date: new Date('2100-06-02T18:00:00Z'),
                    myRsvp: 'going',
                    practiceHomePacketSummary: 'Mobility packet'
                }),
                event({
                    id: 'game-2',
                    teamId: 'team-2',
                    teamName: 'Storm',
                    childId: 'player-3',
                    childName: 'Alex',
                    date: new Date('2100-06-03T18:00:00Z'),
                    myRsvp: 'going',
                    assignments: [
                        { role: 'Clock', value: '', claimable: true, claim: null },
                        { role: 'Scorebook', value: '', claimable: true, claim: null }
                    ]
                }),
                event({
                    eventKey: 'team-2::game-2::player-3::duplicate',
                    id: 'game-2',
                    teamId: 'team-2',
                    teamName: 'Storm',
                    childId: 'player-3',
                    childName: 'Alex',
                    date: new Date('2100-06-03T18:00:00Z'),
                    myRsvp: 'going',
                    assignments: [
                        { role: 'Clock', value: '', claimable: true, claim: null },
                        { role: 'Scorebook', value: '', claimable: true, claim: null }
                    ]
                })
            ],
            inboxTeams: [
                { id: 'team-1', name: 'Bears', role: 'Parent', unreadCount: 2, sport: 'Basketball' },
                { id: 'team-2', name: 'Storm', role: 'Parent', unreadCount: 0, sport: 'Soccer' }
            ],
            fees: [
                { id: 'fee-1', title: 'Travel', teamId: 'team-2', teamName: 'Storm', status: 'partial', balanceDueCents: 2000 }
            ],
            now
        });

        expect(model.upcomingEvents.map((entry) => `${entry.teamId}:${entry.id}`)).toEqual([
            'team-1:game-1',
            'team-1:practice-1',
            'team-2:game-2'
        ]);
        expect(model.players.map((player) => ({
            name: player.playerName,
            nextEvent: player.nextEvent?.id || null,
            rsvpNeeded: player.rsvpNeeded,
            packetsReady: player.packetsReady,
            openAssignments: player.openAssignments,
            unreadCount: player.unreadCount
        }))).toEqual([
            { name: 'Alex', nextEvent: 'game-2', rsvpNeeded: 0, packetsReady: 0, openAssignments: 4, unreadCount: 0 },
            { name: 'Pat', nextEvent: 'game-1', rsvpNeeded: 1, packetsReady: 1, openAssignments: 0, unreadCount: 2 },
            { name: 'Sam', nextEvent: 'game-1', rsvpNeeded: 0, packetsReady: 0, openAssignments: 0, unreadCount: 2 }
        ]);
        expect(model.teams.map((team) => ({
            teamId: team.teamId,
            nextEvent: team.nextEvent?.id || null,
            eventCount: team.eventCount,
            unreadCount: team.unreadCount,
            openActions: team.openActions
        }))).toEqual([
            { teamId: 'team-1', nextEvent: 'game-1', eventCount: 2, unreadCount: 2, openActions: 3 },
            { teamId: 'team-2', nextEvent: 'game-2', eventCount: 1, unreadCount: 0, openActions: 4 }
        ]);
        expect(model.actionItems.map((action) => action.kind)).toEqual(['rsvp', 'packet', 'assignment', 'assignment', 'fee', 'message']);
        expect(model.metrics).toEqual({
            players: 3,
            teams: 2,
            rsvpNeeded: 1,
            unreadMessages: 2,
            packetsReady: 1
        });
    });

    it('avoids repeated full-event scans when building large Home models', () => {
        const now = new Date('2100-05-30T12:00:00Z');
        const children = [];
        const events = new InstrumentedEvents();

        for (let teamIndex = 1; teamIndex <= 12; teamIndex += 1) {
            for (let playerIndex = 1; playerIndex <= 5; playerIndex += 1) {
                const teamId = `team-${teamIndex}`;
                const playerId = `player-${teamIndex}-${playerIndex}`;
                children.push(child({
                    teamId,
                    teamName: `Team ${teamIndex}`,
                    playerId,
                    playerName: `Player ${teamIndex}-${playerIndex}`
                }));

                for (let eventIndex = 1; eventIndex <= 4; eventIndex += 1) {
                    events.push(event({
                        eventKey: `${teamId}::event-${playerId}-${eventIndex}`,
                        id: `event-${teamIndex}-${eventIndex}`,
                        teamId,
                        teamName: `Team ${teamIndex}`,
                        childId: playerId,
                        childName: `Player ${teamIndex}-${playerIndex}`,
                        type: eventIndex % 2 === 0 ? 'practice' : 'game',
                        myRsvp: eventIndex % 2 === 0 ? 'going' : 'not_responded',
                        date: new Date(`2100-06-${String(eventIndex + 1).padStart(2, '0')}T18:00:00Z`),
                        practiceHomePacketSummary: eventIndex % 2 === 0 ? 'Skills packet' : null,
                        assignments: eventIndex % 2 === 0 ? [] : [
                            { role: 'Clock', value: '', claimable: true, claim: null }
                        ]
                    }));
                }
            }
        }

        const model = buildParentHomeModel({ children, events, now });

        expect(model.players).toHaveLength(children.length);
        expect(model.teams).toHaveLength(12);
        expect(events.rootFilterCalls).toBe(0);
    });
});
