import { describe, expect, it, vi } from 'vitest';
import { loadCalendarFeedEvents } from '../../services/chatgpt-mcp/src/calendar.js';

const ICS = `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:vipers-practice
SUMMARY:Vipers FC U8B Practice
DTSTART;TZID=America/Chicago:20260727T180000
DTEND;TZID=America/Chicago:20260727T190000
LOCATION:Practice Field
STATUS:CONFIRMED
END:VEVENT
BEGIN:VEVENT
UID:vipers-game
SUMMARY:Vipers FC U8B vs. Hawks
DTSTART;TZID=America/Chicago:20260801T100000
DTEND;TZID=America/Chicago:20260801T110000
LOCATION:Game Field
STATUS:CANCELLED
END:VEVENT
END:VCALENDAR`;

function calendarFetch(payload = { ok: true, icsText: ICS }) {
    return vi.fn(async () => ({
        ok: true,
        status: 200,
        headers: { get: () => null },
        text: async () => JSON.stringify(payload)
    }));
}

describe('chatgpt-mcp imported calendars', () => {
    it('fetches through the calendar proxy and projects only events in range', async () => {
        const fetchImpl = calendarFetch();
        const events = await loadCalendarFeedEvents('webcal://calendar.example.test/team.ics?token=private', {
            start: new Date('2026-07-24T00:00:00Z'),
            end: new Date('2026-07-31T23:59:59Z'),
            teamName: 'Vipers FC U8B',
            fetchImpl
        });

        expect(events).toEqual([expect.objectContaining({
            calendarEventId: 'vipers-practice',
            type: 'practice',
            date: new Date('2026-07-27T23:00:00.000Z'),
            endDate: new Date('2026-07-28T00:00:00.000Z'),
            title: 'Vipers FC U8B Practice',
            location: 'Practice Field',
            status: 'scheduled'
        })]);
        const [requestUrl, request] = fetchImpl.mock.calls[0];
        expect(requestUrl.hostname).toBe('us-central1-game-flow-c6311.cloudfunctions.net');
        expect(requestUrl.searchParams.get('url')).toContain('token=private');
        expect(request.headers.Origin).toBe('https://allplays.ai');
    });

    it('surfaces proxy failures without including the private calendar URL', async () => {
        const fetchImpl = vi.fn(async () => ({
            ok: false,
            status: 502,
            headers: { get: () => null },
            text: async () => JSON.stringify({ ok: false, error: 'Calendar unavailable' })
        }));

        await expect(loadCalendarFeedEvents('https://calendar.example.test/private.ics?token=secret', {
            start: new Date('2026-07-24T00:00:00Z'),
            end: new Date('2026-07-31T23:59:59Z'),
            fetchImpl
        })).rejects.toThrow('Calendar unavailable');
    });
});
