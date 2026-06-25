import { getTeam } from './adapters/legacyParentTools';
import { firebaseAuth, getNativeAuthIdToken } from './authService';
import { loadParentScheduleSummary } from './homeService';
import { formatEventDateLabel, formatEventTimeLabel, getScheduleTitle, type ParentScheduleEvent } from './scheduleLogic';
import type { AuthUser } from './types';

export type ParentCalendarTeam = {
    teamId: string;
    teamName: string;
    eventCount: number;
};

export async function loadParentCalendarTools(user: AuthUser | null, options: { force?: boolean } = {}) {
    if (!user?.uid) return { events: [], teams: [] };
    const schedule = await loadParentScheduleSummary(user, { force: options.force });
    const teamsById = new Map<string, ParentCalendarTeam>();
    (schedule.events || []).forEach((event) => {
        if (!event.teamId) return;
        const existing = teamsById.get(event.teamId);
        teamsById.set(event.teamId, {
            teamId: event.teamId,
            teamName: event.teamName || existing?.teamName || 'Team',
            eventCount: (existing?.eventCount || 0) + 1
        });
    });
    return {
        events: schedule.events || [],
        teams: [...teamsById.values()].sort((a, b) => a.teamName.localeCompare(b.teamName))
    };
}

export function buildParentScheduleIcs(events: ParentScheduleEvent[], calendarName = 'ALL PLAYS Schedule') {
    const lines = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//ALL PLAYS//Parent App//EN',
        `X-WR-CALNAME:${escapeIcs(calendarName)}`
    ];

    (events || []).forEach((event) => {
        const start = toDate(event.date);
        if (!start) return;
        const end = toDate(event.endDate) || new Date(start.getTime() + 60 * 60 * 1000);
        const title = getScheduleTitle(event);
        const description = [
            event.teamName,
            event.type === 'practice' ? 'Practice' : 'Game',
            event.childName ? `Player: ${event.childName}` : '',
            event.notes || ''
        ].filter(Boolean).join('\n');
        lines.push(
            'BEGIN:VEVENT',
            `UID:${escapeIcs(event.eventKey || `${event.teamId}-${event.id}`)}@allplays.ai`,
            `DTSTAMP:${formatIcsDate(new Date())}`,
            `DTSTART:${formatIcsDate(start)}`,
            `DTEND:${formatIcsDate(end)}`,
            `SUMMARY:${escapeIcs(title)}`,
            `LOCATION:${escapeIcs(event.location || 'TBD')}`,
            `DESCRIPTION:${escapeIcs(description)}`,
            'END:VEVENT'
        );
    });

    lines.push('END:VCALENDAR');
    return lines.join('\r\n');
}

export function buildParentScheduleEventIcs(event: ParentScheduleEvent, calendarName = 'ALL PLAYS Schedule') {
    return buildParentScheduleIcs(event ? [event] : [], calendarName);
}

export function buildPrivateTeamCalendarFeedUrl(teamId: string, team: Record<string, any> | null | undefined) {
    const directUrl = team?.privateCalendarFeedUrl
        || team?.calendarSubscriptionUrl
        || team?.calendarFeedUrl
        || team?.teamCalendarFeedUrl;
    if (typeof directUrl === 'string' && directUrl.trim()) {
        return directUrl.trim().replace(/^webcal:\/\//i, 'https://');
    }

    const token = team?.calendarSubscriptionToken
        || team?.privateCalendarToken
        || team?.calendarFeedToken
        || team?.teamCalendarToken;
    if (!teamId || !token) return '';

    const configured = (window as any).__ALLPLAYS_CONFIG__?.teamCalendarFeedFunctionUrl || (window as any).ALLPLAYS_TEAM_CALENDAR_FEED_URL;
    const fallback = (window as any).__ALLPLAYS_CONFIG__?.calendarFetchFunctionUrl || (window as any).ALLPLAYS_CALENDAR_FUNCTION_URL;
    const baseUrl = typeof configured === 'string' && configured.trim()
        ? configured.trim()
        : typeof fallback === 'string' && fallback.includes('fetchCalendarIcs')
            ? fallback.replace('fetchCalendarIcs', 'teamCalendarFeed')
            : 'https://us-central1-all-plays-prod.cloudfunctions.net/teamCalendarFeed';
    const separator = baseUrl.includes('?') ? '&' : '?';
    return `${baseUrl}${separator}teamId=${encodeURIComponent(teamId)}&token=${encodeURIComponent(token)}`;
}

export async function getPrivateTeamCalendarFeedUrl(teamId: string) {
    const teamSnap = await Promise.resolve(getTeam(teamId)).catch(() => null);
    const teamFeedUrl = buildPrivateTeamCalendarFeedUrl(teamId, teamSnap);
    if (teamFeedUrl) return teamFeedUrl;
    const token = await getNativeAuthIdToken(false).catch(() => null)
        || await firebaseAuth.currentUser?.getIdToken?.(false).catch(() => null);
    if (!teamId || !token) return '';
    const configured = (window as any).__ALLPLAYS_CONFIG__?.teamCalendarFeedFunctionUrl || (window as any).ALLPLAYS_TEAM_CALENDAR_FEED_URL;
    const fallback = (window as any).__ALLPLAYS_CONFIG__?.calendarFetchFunctionUrl || (window as any).ALLPLAYS_CALENDAR_FUNCTION_URL;
    const baseUrl = typeof configured === 'string' && configured.trim()
        ? configured.trim()
        : typeof fallback === 'string' && fallback.includes('fetchCalendarIcs')
            ? fallback.replace('fetchCalendarIcs', 'teamCalendarFeed')
            : 'https://us-central1-all-plays-prod.cloudfunctions.net/teamCalendarFeed';
    const separator = baseUrl.includes('?') ? '&' : '?';
    return `${baseUrl}${separator}teamId=${encodeURIComponent(teamId)}&token=${encodeURIComponent(token)}`;
}

export function getAppleCalendarFeedUrl(feedUrl: string) {
    return String(feedUrl || '').replace(/^https?:\/\//i, 'webcal://');
}

export function getGoogleCalendarFeedUrl(feedUrl: string) {
    return `https://calendar.google.com/calendar/render?cid=${encodeURIComponent(feedUrl)}`;
}

export function getCalendarEventShareText(event: ParentScheduleEvent) {
    return [
        getScheduleTitle(event),
        formatEventDateLabel(event.date),
        formatEventTimeLabel(event.date),
        event.location || 'Location TBD'
    ].filter(Boolean).join(' - ');
}

function escapeIcs(value: unknown) {
    return String(value || '')
        .replace(/\\/g, '\\\\')
        .replace(/\n/g, '\\n')
        .replace(/,/g, '\\,')
        .replace(/;/g, '\\;');
}

function formatIcsDate(date: Date) {
    return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

function toDate(value: unknown): Date | null {
    if (!value) return null;
    const date = value instanceof Date ? value : typeof (value as any)?.toDate === 'function' ? (value as any).toDate() : new Date(value as any);
    return Number.isNaN(date.getTime()) ? null : date;
}
