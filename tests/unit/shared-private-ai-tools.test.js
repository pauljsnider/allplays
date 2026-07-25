import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import {
    createSharedPrivateAiReadToolDefinitions,
    getSharedPrivateAiReadToolDefinition,
    SHARED_PRIVATE_AI_READ_TOOL_CATALOG
} from '../../services/chatgpt-mcp/src/sharedPrivateAiTools.js';

const NOW = new Date('2026-07-24T12:00:00.000Z');
const USER = {
    uid: 'parent-1',
    email: 'parent@example.com',
    displayName: 'Pat Parent',
    roles: ['parent'],
    emailVerified: true
};

function scheduleFixture() {
    return {
        children: [{
            playerId: 'player-1',
            childId: 'player-1',
            name: 'Avery',
            childName: 'Avery',
            teamId: 'team-vipers',
            teamName: 'Vipers'
        }],
        events: [
            {
                id: 'game-past',
                teamId: 'team-vipers',
                teamName: 'Vipers',
                childId: 'player-1',
                childName: 'Avery',
                type: 'game',
                date: new Date('2026-07-20T18:00:00.000Z'),
                opponent: 'Hawks',
                location: 'Field 1',
                myRsvp: 'going',
                homeScore: 4,
                awayScore: 2,
                isDbGame: true
            },
            {
                id: 'practice-past',
                teamId: 'team-vipers',
                teamName: 'Vipers',
                childId: 'player-1',
                childName: 'Avery',
                type: 'practice',
                date: new Date('2026-07-21T18:00:00.000Z'),
                title: 'Recovery',
                isDbGame: true
            },
            {
                id: 'calendar-practice',
                teamId: 'team-vipers',
                teamName: 'Vipers',
                childId: 'player-1',
                childName: 'Avery',
                type: 'practice',
                date: new Date('2026-07-27T23:00:00.000Z'),
                title: 'Vipers Practice',
                location: 'North Field',
                source: 'calendar',
                isImported: true,
                isDbGame: false,
                calendarUrl: 'webcal://calendar.example.test/feed.ics?token=private',
                practiceHomePacket: { privateCoachNotes: 'do not include in schedule' },
                myRsvp: 'not_responded'
            },
            {
                id: 'game-future',
                teamId: 'team-vipers',
                teamName: 'Vipers',
                childId: 'player-1',
                childName: 'Avery',
                type: 'game',
                date: new Date('2026-07-30T18:30:00.000Z'),
                opponent: 'Rockets',
                location: 'Field 2',
                myRsvp: 'maybe',
                rsvpSummary: { going: 6, maybe: 1 },
                assignments: [{ role: 'Snacks', claimable: true }],
                rideshareSummary: { offerCount: 1, seatsLeft: 2, requests: 1 },
                isDbGame: true
            }
        ],
        warnings: ['One feed is temporarily unavailable.']
    };
}

function createFixtureAdapter() {
    return {
        now: () => NOW,
        loadProfile: vi.fn(async () => ({
            profile: { fullName: 'Pat Parent', phone: '555-0100', internalFlag: true },
            teams: [{ teamId: 'team-vipers', name: 'Vipers', linkedPlayers: [{ playerId: 'player-1', name: 'Avery' }] }]
        })),
        loadSchedule: vi.fn(async () => scheduleFixture()),
        loadScheduleEventDetail: vi.fn(async (_user, event) => ({
            events: scheduleFixture().events.filter((candidate) => candidate.id === event.id)
        })),
        loadRideOffers: vi.fn(async () => [{
            id: 'offer-1',
            sourceGameId: 'game-future',
            driverUserId: 'driver-1',
            driverName: 'Jordan',
            seatCapacity: 3,
            seatCountConfirmed: 1,
            direction: 'to',
            status: 'open',
            requests: [{ id: 'request-1', childId: 'player-1', childName: 'Avery', status: 'pending' }]
        }]),
        loadAssignments: vi.fn(async () => [{
            role: 'Snacks',
            claimable: true,
            claimed: false,
            internalValue: 'not projected'
        }]),
        loadPracticePacket: vi.fn(async (_user, event) => ({
            sessionId: 'session-1',
            teamId: event.teamId,
            eventId: event.id,
            title: event.title,
            date: event.date,
            location: event.location,
            homePacket: { blocks: [{ title: 'Footwork', minutes: 10 }] },
            children: [{ id: 'player-1', name: 'Avery', privateValue: true }],
            completions: [{ id: 'done-1', childId: 'player-1', childName: 'Avery', status: 'complete', privateValue: true }]
        }))
    };
}

function byName(definitions, name) {
    return definitions.find((definition) => definition.name === name);
}

describe('shared private AI read tools', () => {
    it('routes both the app registry and MCP registry through the shared factory', () => {
        const appSource = readFileSync(
            new URL('../../apps/app/src/lib/privateAiService.ts', import.meta.url),
            'utf8'
        );
        const serverSource = readFileSync(
            new URL('../../services/chatgpt-mcp/src/server.js', import.meta.url),
            'utf8'
        );

        expect(appSource).toContain('createSharedPrivateAiReadToolDefinitions');
        expect(appSource).toContain('...sharedPrivateAiReadToolDefinitions');
        expect(appSource).not.toContain('function summarizeSchedule(');
        expect(serverSource).toContain('for (const catalogTool of SHARED_PRIVATE_AI_READ_TOOL_CATALOG)');
        expect(serverSource).toContain('createSharedPrivateAiReadToolDefinitions(adapter)');
        expect(serverSource).not.toContain("server.registerTool('list_schedule'");
    });

    it('publishes the one schedule/profile read catalog used by the app and MCP', () => {
        expect(SHARED_PRIVATE_AI_READ_TOOL_CATALOG.map((tool) => tool.name)).toEqual([
            'get_profile',
            'list_schedule',
            'get_last_game',
            'get_schedule_event',
            'list_rsvps',
            'list_ride_offers',
            'list_assignments',
            'get_practice_packet'
        ]);
        expect(getSharedPrivateAiReadToolDefinition('get_schedule')?.name).toBe('list_schedule');
        expect(getSharedPrivateAiReadToolDefinition('list_tasks_for_event')?.name).toBe('list_assignments');
    });

    it('filters and projects stored and imported schedule events without leaking source data', async () => {
        const adapter = createFixtureAdapter();
        const definitions = createSharedPrivateAiReadToolDefinitions(adapter);

        const result = await byName(definitions, 'list_schedule').resolve(USER, {
            startDate: '2026-07-24',
            endDate: '2026-07-31',
            teamName: 'vip',
            playerName: 'ave',
            limit: 10
        });

        expect(result.events.map((event) => event.eventId)).toEqual(['calendar-practice', 'game-future']);
        expect(result.events[0]).toMatchObject({
            teamName: 'Vipers',
            childName: 'Avery',
            source: 'calendar',
            isImported: true,
            title: 'Vipers Practice'
        });
        expect(result.events[1]).toMatchObject({
            title: 'vs. Rockets',
            myRsvp: 'maybe',
            openAssignments: ['Snacks']
        });
        expect(JSON.stringify(result)).not.toContain('calendar.example.test');
        expect(JSON.stringify(result)).not.toContain('privateCoachNotes');
        expect(adapter.loadSchedule).toHaveBeenCalledWith(USER, expect.objectContaining({
            includePastGames: false
        }));
    });

    it('returns the last game rather than a newer practice', async () => {
        const definitions = createSharedPrivateAiReadToolDefinitions(createFixtureAdapter());
        const result = await byName(definitions, 'get_last_game').resolve(USER, {
            teamId: 'team-vipers',
            playerId: 'player-1'
        });

        expect(result.lastGame).toMatchObject({
            eventId: 'game-past',
            title: 'vs. Hawks',
            myRsvp: 'going',
            score: { home: 4, away: 2 }
        });
        expect(result.recentGames).toHaveLength(1);
        expect(result.upcomingGames.map((event) => event.eventId)).toEqual(['game-future']);
    });

    it('uses the shared event resolver for RSVP, assignment, rideshare, and packet detail tools', async () => {
        const adapter = createFixtureAdapter();
        const definitions = createSharedPrivateAiReadToolDefinitions(adapter);

        const event = await byName(definitions, 'get_schedule_event').resolve(USER, {
            eventId: 'game-future',
            teamId: 'team-vipers'
        });
        const rsvps = await byName(definitions, 'list_rsvps').resolve(USER, {
            startDate: '2026-07-30',
            endDate: '2026-07-30'
        });
        const assignments = await byName(definitions, 'list_assignments').resolve(USER, {
            eventId: 'game-future',
            teamId: 'team-vipers'
        });
        const rides = await byName(definitions, 'list_ride_offers').resolve(USER, {
            eventId: 'game-future',
            teamId: 'team-vipers'
        });
        const packet = await byName(definitions, 'get_practice_packet').resolve(USER, {
            eventId: 'calendar-practice',
            teamId: 'team-vipers'
        });

        expect(event.event.eventId).toBe('game-future');
        expect(rsvps.events).toEqual([expect.objectContaining({ eventId: 'game-future', myRsvp: 'maybe' })]);
        expect(assignments.assignments).toEqual([{ role: 'Snacks', claimable: true, claimed: false }]);
        expect(rides).toMatchObject({
            summary: { offers: 1, openOffers: 1, seatsLeft: 2, requests: 1 },
            offers: [{ id: 'offer-1', seatsLeft: 2 }]
        });
        expect(packet).toMatchObject({
            sessionId: 'session-1',
            eventId: 'calendar-practice',
            homePacket: { blocks: [{ title: 'Footwork', minutes: 10 }] },
            children: [{ id: 'player-1', name: 'Avery' }],
            completions: [{ id: 'done-1', childId: 'player-1', childName: 'Avery', status: 'complete' }]
        });
    });
});
