import { buildPrivateTeamCalendarFeedUrl as buildPrivateTeamCalendarFeedUrlFromRuntime } from './calendarFeedUrls';
import { loadParentScheduleSummary } from './homeService';
import { resolvePrivateTeamCalendarFeedUrl } from './privateCalendarFeedResolver';
import { formatEventDateLabel, formatEventTimeLabel, getScheduleLocationLabel, getScheduleTitle, type ParentScheduleEvent } from './scheduleLogic';
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
            `LOCATION:${escapeIcs(getScheduleLocationLabel(event))}`,
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

export function buildPrivateTeamCalendarFeedUrl(teamId: string, token: unknown) {
    return buildPrivateTeamCalendarFeedUrlFromRuntime(teamId, token);
}

export async function getPrivateTeamCalendarFeedUrl(teamId: string) {
    return resolvePrivateTeamCalendarFeedUrl(teamId);
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
        getScheduleLocationLabel(event, 'Location TBD')
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
