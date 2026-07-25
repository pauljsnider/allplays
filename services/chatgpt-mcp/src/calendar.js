// Read-only projection of the external ICS feeds already attached to an
// AllPlays team. Fetching stays behind the production calendar proxy so the
// MCP service never becomes a second arbitrary-URL fetcher.

import ical from 'node-ical';

const DEFAULT_CALENDAR_FETCH_FUNCTION_URL =
    'https://us-central1-game-flow-c6311.cloudfunctions.net/fetchCalendarIcs';
const MAX_CALENDAR_FUNCTION_BYTES = (2 * 1024 * 1024) + (64 * 1024);
const CALENDAR_FETCH_TIMEOUT_MS = 12_000;

function cleanString(value) {
    return typeof value === 'string' ? value.trim() : '';
}

function eventDate(value) {
    if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
    const parsed = value ? new Date(value) : null;
    return parsed && !Number.isNaN(parsed.getTime()) ? parsed : null;
}

function isPracticeEvent(summary) {
    const normalized = cleanString(summary).toLowerCase();
    return normalized.includes('practice')
        || normalized.includes('training')
        || normalized.includes('skills club');
}

function extractOpponent(summary, teamName = '') {
    const value = cleanString(summary);
    if (!value) return null;

    const atMatch = value.match(/@\s*(.+)/);
    if (atMatch) return cleanString(atMatch[1]) || null;

    const vsMatch = value.match(/vs\.?\s+(.+)/i);
    if (vsMatch) {
        const opponent = cleanString(vsMatch[1]);
        if (!teamName) return opponent || null;
        const escaped = teamName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        return cleanString(opponent.replace(new RegExp(`\\b${escaped}\\b`, 'gi'), '')) || opponent || null;
    }

    return value;
}

function calendarEventId(event, start, recurring) {
    const uid = cleanString(event.uid);
    const fallback = `${cleanString(event.summary) || 'calendar-event'}-${start.getTime()}`;
    return recurring ? `${uid || fallback}__${start.toISOString()}` : uid || fallback;
}

function projectCalendarEvent(event, { start, end, teamName, recurring }) {
    const startsAt = eventDate(event.start);
    if (!startsAt || startsAt < start || startsAt > end) return null;
    const endsAt = eventDate(event.end);
    const summary = cleanString(event.summary);
    const practice = isPracticeEvent(summary);
    const status = cleanString(event.status).toUpperCase();

    return {
        calendarEventId: calendarEventId(event, startsAt, recurring),
        calendarEventUid: cleanString(event.uid) || null,
        type: practice ? 'practice' : 'game',
        date: startsAt,
        endDate: endsAt,
        opponent: practice ? null : extractOpponent(summary, teamName),
        title: practice ? summary || 'Practice' : null,
        location: cleanString(event.location) || null,
        status: status === 'CANCELLED' || status === 'CANCELED' ? 'cancelled' : 'scheduled'
    };
}

async function readCalendarProxyResponse(calendarUrl, fetchImpl) {
    const endpoint = cleanString(process.env.CALENDAR_FETCH_FUNCTION_URL)
        || DEFAULT_CALENDAR_FETCH_FUNCTION_URL;
    const requestUrl = new URL(endpoint);
    requestUrl.searchParams.set('url', calendarUrl);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), CALENDAR_FETCH_TIMEOUT_MS);

    try {
        const response = await fetchImpl(requestUrl, {
            headers: {
                Accept: 'application/json',
                Origin: 'https://allplays.ai'
            },
            redirect: 'error',
            signal: controller.signal
        });
        const contentLength = Number.parseInt(response.headers?.get?.('content-length') || '', 10);
        if (Number.isFinite(contentLength) && contentLength > MAX_CALENDAR_FUNCTION_BYTES) {
            throw new Error('Calendar proxy response exceeded the size limit.');
        }
        const rawPayload = await response.text();
        if (Buffer.byteLength(rawPayload, 'utf8') > MAX_CALENDAR_FUNCTION_BYTES) {
            throw new Error('Calendar proxy response exceeded the size limit.');
        }
        let payload;
        try {
            payload = JSON.parse(rawPayload);
        } catch {
            throw new Error('Calendar proxy returned invalid JSON.');
        }
        if (!response.ok || payload?.ok !== true || typeof payload.icsText !== 'string') {
            throw new Error(payload?.error || `Calendar proxy request failed (${response.status}).`);
        }
        return payload.icsText;
    } finally {
        clearTimeout(timeoutId);
    }
}

/**
 * Fetch and project one team calendar feed into the same narrow event shape
 * used by the MCP schedule tool. The private feed URL is never returned.
 */
export async function loadCalendarFeedEvents(calendarUrl, {
    start,
    end,
    teamName = '',
    fetchImpl = fetch
} = {}) {
    if (!cleanString(calendarUrl)) return [];
    if (!(start instanceof Date) || !(end instanceof Date)) {
        throw new TypeError('Calendar projection requires a date range.');
    }

    const icsText = await readCalendarProxyResponse(calendarUrl, fetchImpl);
    const parsed = await ical.async.parseICS(icsText);
    const events = [];

    for (const sourceEvent of Object.values(parsed)) {
        if (!sourceEvent || sourceEvent.type !== 'VEVENT') continue;
        const recurring = Boolean(sourceEvent.rrule);
        const occurrences = recurring
            ? ical.expandRecurringEvent(sourceEvent, { from: start, to: end })
            : [sourceEvent];
        for (const occurrence of occurrences) {
            const event = projectCalendarEvent(occurrence, { start, end, teamName, recurring });
            if (event) events.push(event);
        }
    }

    events.sort((a, b) => a.date - b.date);
    return events;
}
