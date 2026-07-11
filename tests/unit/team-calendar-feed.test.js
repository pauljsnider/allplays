import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const {
    buildTeamCalendarIcs,
    formatRsvpSummary,
    hashCalendarToken,
    normalizeCalendarRequest
} = require('../../functions/team-calendar-feed-core.cjs');

const functionsSource = readFileSync(new URL('../../functions/index.js', import.meta.url), 'utf8');

describe('team calendar subscription feed', () => {
    it('builds valid ICS for visible games and practices with stable UIDs', () => {
        const ics = buildTeamCalendarIcs({
            teamId: 'team-1',
            team: { name: 'Sharks' },
            now: new Date('2026-05-09T01:00:00Z'),
            events: [
                {
                    id: 'game-1',
                    type: 'game',
                    date: new Date('2026-05-10T15:00:00Z'),
                    updatedAt: new Date('2026-05-08T12:00:00Z'),
                    opponent: 'Tigers',
                    location: 'Field 1, North',
                    notes: 'Bring white jerseys',
                    arrivalTime: new Date('2026-05-10T14:15:00Z'),
                    status: 'scheduled'
                },
                {
                    id: 'practice-1',
                    type: 'practice',
                    title: 'Pitching practice',
                    date: new Date('2026-05-11T22:00:00Z'),
                    end: new Date('2026-05-11T23:30:00Z'),
                    location: 'Cages',
                    status: 'scheduled'
                }
            ]
        });

        expect(ics).toContain('BEGIN:VCALENDAR');
        expect(ics).toContain('VERSION:2.0');
        expect(ics).not.toContain('Content-Type');
        expect(ics).toContain('UID:team-1-game-1@allplays.ai');
        expect(ics).toContain('UID:team-1-practice-1@allplays.ai');
        expect(ics).toContain('SUMMARY:Sharks vs Tigers');
        expect(ics).toContain('SUMMARY:Pitching practice');
        expect(ics).toContain('DTSTART:20260510T150000Z');
        expect(ics).toContain('DTEND:20260511T233000Z');
        expect(ics).toContain('LOCATION:Field 1\\, North');
        expect(ics).toContain('DESCRIPTION:Status: scheduled\\nArrival: 20260510T141500Z\\nBring white');
        expect(ics).toContain(' ys');
        expect(ics).toContain('STATUS:CONFIRMED');
    });

    it('keeps UIDs stable while updated event output changes', () => {
        const baseEvent = {
            id: 'game-9',
            type: 'game',
            date: new Date('2026-05-10T15:00:00Z'),
            opponent: 'Tigers',
            location: 'Field 1',
            status: 'scheduled'
        };
        const first = buildTeamCalendarIcs({ teamId: 'team-1', team: { name: 'Sharks' }, events: [baseEvent], now: new Date('2026-05-09T01:00:00Z') });
        const updated = buildTeamCalendarIcs({
            teamId: 'team-1',
            team: { name: 'Sharks' },
            events: [{ ...baseEvent, date: new Date('2026-05-10T16:00:00Z'), location: 'Field 2', status: 'cancelled' }],
            now: new Date('2026-05-09T02:00:00Z')
        });

        expect(first).toContain('UID:team-1-game-9@allplays.ai');
        expect(updated).toContain('UID:team-1-game-9@allplays.ai');
        expect(updated).toContain('DTSTART:20260510T160000Z');
        expect(updated).toContain('LOCATION:Field 2');
        expect(updated).toContain('STATUS:CANCELLED');
    });

    it('builds feeds from game-level fields without depending on attendee RSVP arrays', () => {
        const baseEvent = {
            id: 'game-2',
            type: 'game',
            date: new Date('2026-05-12T18:00:00Z'),
            opponent: 'Wolves',
            location: 'Field 3',
            notes: 'Hydrate',
            arrivalTime: new Date('2026-05-12T17:30:00Z'),
            status: 'scheduled',
            rsvpSummary: { going: 8, maybe: 1, notGoing: 2, notResponded: 3 }
        };

        const withoutRsvps = buildTeamCalendarIcs({
            teamId: 'team-1',
            team: { name: 'Sharks' },
            now: new Date('2026-05-09T01:00:00Z'),
            events: [baseEvent]
        });
        const withIgnoredAttendees = buildTeamCalendarIcs({
            teamId: 'team-1',
            team: { name: 'Sharks' },
            now: new Date('2026-05-09T01:00:00Z'),
            events: [{ ...baseEvent, rsvps: [{ displayName: 'Player One', response: 'going' }] }]
        });

        expect(withoutRsvps).toBe(withIgnoredAttendees);
        expect(withoutRsvps).toContain('UID:team-1-game-2@allplays.ai');
        expect(withoutRsvps).toContain('DTSTART:20260512T180000Z');
        expect(withoutRsvps).toContain('LOCATION:Field 3');
        expect(withoutRsvps).toContain('Arrival: 20260512T173000Z');
        expect(withoutRsvps).toContain('Hydrate');
        expect(withoutRsvps).toContain('RSVPs:');
        expect(withoutRsvps).toContain('8 going\\, 1 maybe\\, 2 not going\\, 3 not responded');
        expect(withoutRsvps).not.toContain('Player One');
    });

    it('formats only aggregate RSVP summary values for calendar descriptions', () => {
        expect(formatRsvpSummary({ going: 2, maybe: 0, notGoing: 1, notResponded: 4 })).toBe('2 going, 0 maybe, 1 not going, 4 not responded');
        expect(formatRsvpSummary(null)).toBe('');
    });

    it('normalizes stable private token requests without exposing raw tokens', () => {
        const request = normalizeCalendarRequest({ teamId: 'team-1', token: ' secret-token ' });

        expect(request).toEqual({
            teamId: 'team-1',
            token: 'secret-token',
            tokenHash: hashCalendarToken('secret-token')
        });
        expect(request.tokenHash).toMatch(/^[a-f0-9]{64}$/);
        expect(request.tokenHash).not.toBe('secret-token');
    });

    it('registers an HTTPS endpoint that rejects missing, invalid, and revoked tokens', () => {
        expect(functionsSource).toContain('exports.teamCalendarFeed = functions.https.onRequest');
        expect(functionsSource).toContain("res.status(401).send('Missing calendar token')");
        expect(functionsSource).toContain("res.status(403).send('Invalid calendar token')");
        expect(functionsSource).toContain("res.status(403).send('Revoked calendar token')");
        expect(functionsSource).toContain("res.set('Content-Type', 'text/calendar; charset=utf-8')");
        expect(functionsSource).toContain('buildTeamCalendarIcs({ teamId, team, events })');
    });

    it('builds private feeds from stored game summaries without fallback RSVP scans', () => {
        const feedStart = functionsSource.indexOf('exports.teamCalendarFeed = functions.https.onRequest');
        const feedEnd = functionsSource.indexOf('exports.resolveFamilyShareTokenChildren', feedStart);
        const teamCalendarFeedSource = functionsSource.slice(feedStart, feedEnd);

        expect(teamCalendarFeedSource).toContain('getCalendarFeedGamesQuery(teamId).get()');
        expect(teamCalendarFeedSource).not.toContain("firestore.collection(`teams/${teamId}/games`).get()");
        expect(teamCalendarFeedSource).not.toContain("firestore.collection(`teams/${teamId}/games`).orderBy('date').get()");
        expect(teamCalendarFeedSource).toContain('const game = { id: docSnap.id, ...(docSnap.data() || {}) }');
        expect(teamCalendarFeedSource).toContain('buildTeamCalendarIcs({ teamId, team, events })');
        expect(teamCalendarFeedSource).not.toContain('loadMissingTeamCalendarRsvpSummaries');
        expect(teamCalendarFeedSource).not.toContain('loadTeamCalendarRsvpSummaries');
        expect(teamCalendarFeedSource).not.toContain("firestore.collection(`teams/${teamId}/players`).get()");
        expect(teamCalendarFeedSource).not.toContain("firestore.collection(`teams/${teamId}/games/${gameId}/rsvps`).get()");
        expect(teamCalendarFeedSource).not.toContain('responsesByPlayerId');
        expect(teamCalendarFeedSource).not.toContain('game.rsvps');
        expect(functionsSource).not.toContain('async function loadMissingTeamCalendarRsvpSummaries');
    });
});
