import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const {
    buildTeamCalendarIcs,
    expandRecurringCalendarEvent,
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

    it('emits bounded future occurrences for old recurring practice masters', () => {
        const master = {
            id: 'practice-series',
            type: 'practice',
            isSeriesMaster: true,
            date: new Date('2025-01-06T18:00:00Z'),
            startTime: '18:00',
            endTime: '19:30',
            title: 'Weekly Skills',
            location: 'North Field',
            recurrence: {
                freq: 'weekly',
                interval: 1,
                byDays: ['MO']
            },
            exDates: ['2026-07-27'],
            overrides: {
                '2026-08-03': {
                    title: 'Indoor Skills',
                    location: 'Fieldhouse',
                    startTime: '19:00',
                    endTime: '20:00'
                }
            }
        };

        const occurrences = expandRecurringCalendarEvent(master, {
            now: new Date('2026-07-25T12:00:00Z')
        });
        const ics = buildTeamCalendarIcs({
            teamId: 'team-1',
            team: { name: 'Sharks', timeZone: 'UTC' },
            events: [master],
            now: new Date('2026-07-25T12:00:00Z')
        });

        expect(occurrences.find((occurrence) => occurrence.instanceDate === '2026-07-27')).toMatchObject({
            id: 'practice-series__2026-07-27',
            status: 'cancelled'
        });
        expect(ics).toContain('UID:team-1-practice-series__2026-07-27@allplays.ai');
        expect(ics).toContain('DTSTART:20260727T180000Z');
        expect(ics).toContain('STATUS:CANCELLED');
        expect(ics).toContain('UID:team-1-practice-series__2026-08-03@allplays.ai');
        expect(ics).toContain('DTSTART:20260803T190000Z');
        expect(ics).toContain('DTEND:20260803T200000Z');
        expect(ics).toContain('SUMMARY:Indoor Skills');
        expect(ics).toContain('LOCATION:Fieldhouse');
        expect(ics).not.toContain('UID:team-1-practice-series@allplays.ai');
    });

    it('preserves the stored local weekday when the practice starts on the next UTC day', () => {
        const occurrences = expandRecurringCalendarEvent({
            id: 'monday-evening',
            type: 'practice',
            isSeriesMaster: true,
            date: new Date('2025-01-07T00:00:00Z'),
            startTime: '19:00',
            endTime: '20:30',
            recurrence: {
                freq: 'weekly',
                interval: 1,
                byDays: ['MO']
            }
        }, {
            now: new Date('2026-07-25T12:00:00Z'),
            fallbackTimeZone: 'America/New_York'
        });

        expect(occurrences.find((occurrence) => occurrence.instanceDate === '2026-07-27')).toMatchObject({
            date: new Date('2026-07-27T23:00:00Z'),
            end: new Date('2026-07-28T00:30:00Z')
        });
    });

    it('preserves legacy Chicago wall-clock times across DST without a stored timezone', () => {
        const chicagoOccurrences = expandRecurringCalendarEvent({
            id: 'chicago-evening',
            type: 'practice',
            isSeriesMaster: true,
            date: new Date('2025-01-07T00:00:00Z'),
            startTime: '18:00',
            endTime: '19:30',
            recurrence: {
                freq: 'weekly',
                interval: 1,
                byDays: ['MO']
            }
        }, {
            now: new Date('2026-07-25T12:00:00Z')
        });
        expect(chicagoOccurrences.find((occurrence) => occurrence.instanceDate === '2026-07-27')).toMatchObject({
            date: new Date('2026-07-27T23:00:00Z'),
            end: new Date('2026-07-28T00:30:00Z')
        });
    });

    it('uses the configured team timezone for legacy US series across DST', () => {
        const newYorkOccurrences = expandRecurringCalendarEvent({
            id: 'new-york-evening',
            type: 'practice',
            isSeriesMaster: true,
            date: new Date('2025-01-06T23:00:00Z'),
            startTime: '18:00',
            endTime: '19:30',
            recurrence: {
                freq: 'weekly',
                interval: 1,
                byDays: ['MO']
            }
        }, {
            now: new Date('2026-07-25T12:00:00Z'),
            fallbackTimeZone: 'America/New_York'
        });
        const losAngelesOccurrences = expandRecurringCalendarEvent({
            id: 'los-angeles-evening',
            type: 'practice',
            isSeriesMaster: true,
            date: new Date('2025-01-07T02:00:00Z'),
            startTime: '18:00',
            endTime: '19:30',
            recurrence: {
                freq: 'weekly',
                interval: 1,
                byDays: ['MO']
            }
        }, {
            now: new Date('2026-07-25T12:00:00Z'),
            fallbackTimeZone: 'America/Los_Angeles'
        });

        expect(newYorkOccurrences.find((occurrence) => occurrence.instanceDate === '2026-07-27')).toMatchObject({
            date: new Date('2026-07-27T22:00:00Z'),
            end: new Date('2026-07-27T23:30:00Z')
        });
        expect(losAngelesOccurrences.find((occurrence) => occurrence.instanceDate === '2026-07-27')).toMatchObject({
            date: new Date('2026-07-28T01:00:00Z'),
            end: new Date('2026-07-28T02:30:00Z')
        });
    });

    it('uses configured Arizona and European timezones instead of guessing from a winter offset', () => {
        const legacyMaster = {
            type: 'practice',
            isSeriesMaster: true,
            startTime: '18:00',
            endTime: '19:30',
            recurrence: {
                freq: 'weekly',
                interval: 1,
                byDays: ['MO']
            }
        };
        const phoenixOccurrences = expandRecurringCalendarEvent({
            ...legacyMaster,
            id: 'phoenix-evening',
            date: new Date('2025-01-07T01:00:00Z')
        }, {
            now: new Date('2026-07-25T12:00:00Z'),
            fallbackTimeZone: 'America/Phoenix'
        });
        const londonOccurrences = expandRecurringCalendarEvent({
            ...legacyMaster,
            id: 'london-evening',
            date: new Date('2025-01-06T18:00:00Z')
        }, {
            now: new Date('2026-07-25T12:00:00Z'),
            fallbackTimeZone: 'Europe/London'
        });

        expect(phoenixOccurrences.find((occurrence) => occurrence.instanceDate === '2026-07-27')).toMatchObject({
            date: new Date('2026-07-28T01:00:00Z'),
            end: new Date('2026-07-28T02:30:00Z')
        });
        expect(londonOccurrences.find((occurrence) => occurrence.instanceDate === '2026-07-27')).toMatchObject({
            date: new Date('2026-07-27T17:00:00Z'),
            end: new Date('2026-07-27T18:30:00Z')
        });
    });

    it('uses the configured team timezone for legacy negative-antimeridian series', () => {
        const honoluluOccurrences = expandRecurringCalendarEvent({
            id: 'honolulu-evening',
            type: 'practice',
            isSeriesMaster: true,
            date: new Date('2025-01-07T04:00:00Z'),
            startTime: '18:00',
            endTime: '19:30',
            recurrence: {
                freq: 'weekly',
                interval: 1,
                byDays: ['MO']
            }
        }, {
            now: new Date('2026-07-25T12:00:00Z'),
            fallbackTimeZone: 'Pacific/Honolulu'
        });
        const pagoPagoOccurrences = expandRecurringCalendarEvent({
            id: 'pago-pago-evening',
            type: 'practice',
            isSeriesMaster: true,
            date: new Date('2025-01-07T05:00:00Z'),
            startTime: '18:00',
            endTime: '19:30',
            recurrence: {
                freq: 'weekly',
                interval: 1,
                byDays: ['MO']
            }
        }, {
            now: new Date('2026-07-25T12:00:00Z'),
            fallbackTimeZone: 'Pacific/Pago_Pago'
        });

        expect(honoluluOccurrences.find((occurrence) => occurrence.instanceDate === '2026-07-27')).toMatchObject({
            date: new Date('2026-07-28T04:00:00Z'),
            end: new Date('2026-07-28T05:30:00Z')
        });
        expect(pagoPagoOccurrences.find((occurrence) => occurrence.instanceDate === '2026-07-27')).toMatchObject({
            date: new Date('2026-07-28T05:00:00Z'),
            end: new Date('2026-07-28T06:30:00Z')
        });
    });

    it('preserves explicit timezones and configured legacy zones above UTC+12', () => {
        const karachiOccurrences = expandRecurringCalendarEvent({
            id: 'karachi-evening',
            type: 'practice',
            isSeriesMaster: true,
            date: new Date('2025-01-06T13:00:00Z'),
            startTime: '18:00',
            endTime: '19:30',
            timeZone: 'Asia/Karachi',
            recurrence: {
                freq: 'weekly',
                interval: 1,
                byDays: ['MO']
            }
        }, {
            now: new Date('2026-07-25T12:00:00Z')
        });
        const kiritimatiOccurrences = expandRecurringCalendarEvent({
            id: 'kiritimati-evening',
            type: 'practice',
            isSeriesMaster: true,
            date: new Date('2025-01-06T04:00:00Z'),
            startTime: '18:00',
            endTime: '19:30',
            recurrence: {
                freq: 'weekly',
                interval: 1,
                byDays: ['MO']
            }
        }, {
            now: new Date('2026-07-25T12:00:00Z'),
            fallbackTimeZone: 'Pacific/Kiritimati'
        });

        expect(karachiOccurrences.find((occurrence) => occurrence.instanceDate === '2026-07-27')).toMatchObject({
            date: new Date('2026-07-27T13:00:00Z'),
            end: new Date('2026-07-27T14:30:00Z')
        });
        expect(kiritimatiOccurrences.find((occurrence) => occurrence.instanceDate === '2026-07-27')).toMatchObject({
            date: new Date('2026-07-27T04:00:00Z'),
            end: new Date('2026-07-27T05:30:00Z')
        });
    });

    it('infers an overnight day offset for legacy occurrence overrides', () => {
        const occurrences = expandRecurringCalendarEvent({
            id: 'overnight-override',
            type: 'practice',
            isSeriesMaster: true,
            date: new Date('2025-01-07T00:00:00Z'),
            startTime: '18:00',
            endTime: '19:00',
            endDayOffset: 0,
            recurrence: {
                freq: 'weekly',
                interval: 1,
                byDays: ['MO']
            },
            overrides: {
                '2026-07-27': {
                    startTime: '23:30',
                    endTime: '01:00'
                }
            }
        }, {
            now: new Date('2026-07-25T12:00:00Z')
        });

        expect(occurrences.find((occurrence) => occurrence.instanceDate === '2026-07-27')).toMatchObject({
            date: new Date('2026-07-28T04:30:00Z'),
            end: new Date('2026-07-28T06:00:00Z')
        });
    });

    it('honors daily occurrence counts when the master predates the feed window', () => {
        const occurrences = expandRecurringCalendarEvent({
            id: 'daily-counted',
            type: 'practice',
            isSeriesMaster: true,
            date: new Date('2026-04-20T18:00:00Z'),
            startTime: '18:00',
            endTime: '19:00',
            recurrence: {
                freq: 'daily',
                interval: 1,
                count: 10
            }
        }, {
            now: new Date('2026-07-25T12:00:00Z'),
            fallbackTimeZone: 'UTC'
        });

        expect(occurrences.map((occurrence) => occurrence.instanceDate)).toEqual([
            '2026-04-27',
            '2026-04-28',
            '2026-04-29'
        ]);
    });

    it('honors daily end-date boundaries when the master predates the feed window', () => {
        const occurrences = expandRecurringCalendarEvent({
            id: 'daily-until',
            type: 'practice',
            isSeriesMaster: true,
            date: new Date('2026-04-20T18:00:00Z'),
            startTime: '18:00',
            endTime: '19:00',
            recurrence: {
                freq: 'daily',
                interval: 1,
                until: '2026-04-28'
            }
        }, {
            now: new Date('2026-07-25T12:00:00Z'),
            fallbackTimeZone: 'UTC'
        });

        expect(occurrences.map((occurrence) => occurrence.instanceDate)).toEqual([
            '2026-04-27',
            '2026-04-28'
        ]);
    });

    it('honors multi-week intervals when the master predates the feed window', () => {
        const occurrences = expandRecurringCalendarEvent({
            id: 'biweekly',
            type: 'practice',
            isSeriesMaster: true,
            date: new Date('2025-01-06T18:00:00Z'),
            startTime: '18:00',
            endTime: '19:00',
            recurrence: {
                freq: 'weekly',
                interval: 2,
                byDays: ['MO']
            }
        }, {
            now: new Date('2026-07-25T12:00:00Z'),
            fallbackTimeZone: 'UTC'
        });

        expect(occurrences.slice(0, 3).map((occurrence) => occurrence.instanceDate)).toEqual([
            '2026-04-27',
            '2026-05-11',
            '2026-05-25'
        ]);
        expect(occurrences.some((occurrence) => occurrence.instanceDate === '2026-05-04')).toBe(false);
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
        const feedEnd = functionsSource.indexOf('\n});', feedStart) + '\n});'.length;
        const teamCalendarFeedSource = functionsSource.slice(feedStart, feedEnd);

        expect(teamCalendarFeedSource).toContain('getCalendarFeedGamesQuery(teamId).get()');
        expect(teamCalendarFeedSource).toContain('getCalendarFeedRecurringMastersQuery(teamId).get()');
        expect(teamCalendarFeedSource).toContain('[...eventsSnap.docs, ...recurringPracticeDocs]');
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
