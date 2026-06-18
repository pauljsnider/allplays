import { sendPublicRsvpReminderEmails as legacySendPublicRsvpReminderEmails } from '../../../../../js/schedule-notifications.js';
import { normalizeOfficialLinkEmail as legacyNormalizeOfficialLinkEmail, normalizeOfficialLinkPhone as legacyNormalizeOfficialLinkPhone } from '../../../../../js/admin-user-official-links.js';
import { getAssignedOfficiatingSlots as legacyGetAssignedOfficiatingSlots, getOpenOfficiatingSlots as legacyGetOpenOfficiatingSlots } from '../../../../../js/officiating-utils.js';
import {
    expandRecurrence as legacyExpandRecurrence,
    extractOpponent as legacyExtractOpponent,
    fetchAndParseCalendar as legacyFetchAndParseCalendar,
    getCalendarEventTrackingId as legacyGetCalendarEventTrackingId,
    isPracticeEvent as legacyIsPracticeEvent,
    isTrackedCalendarEvent as legacyIsTrackedCalendarEvent
} from '../../../../../js/utils.js';
import { filterVisiblePracticeSessions as legacyFilterVisiblePracticeSessions } from '../../../../../js/parent-dashboard-practice-sessions.js';
import { buildPracticePacketCompletionPayload as legacyBuildPracticePacketCompletionPayload } from '../../../../../js/parent-dashboard-packets.js';
import { resolveMyRsvpByChildForGame as legacyResolveMyRsvpByChildForGame } from '../../../../../js/parent-dashboard-rsvp.js';
import { buildGameDayRsvpBreakdown as legacyBuildGameDayRsvpBreakdown } from '../../../../../js/game-day-rsvp-breakdown.js';
import { getPeriodsForFormation as legacyGetPeriodsForFormation } from '../../../../../js/game-day-periods.js';
import { getEventRideshareSummary as legacyGetEventRideshareSummary } from '../../../../../js/rideshare-helpers.js';
import { mergeAssignmentsWithClaims as legacyMergeAssignmentsWithClaims } from '../../../../../js/snack-helpers.js';
import { hasScorekeepingTeamAccess as legacyHasScorekeepingTeamAccess } from '../../../../../js/team-access.js';
import { isTeamActive as legacyIsTeamActive } from '../../../../../js/team-visibility.js';
import {
    applyLiveSubstitution as legacyApplyLiveSubstitution,
    getSubstitutionOptions as legacyGetSubstitutionOptions
} from '../../../../../js/game-day-live-substitutions.js';
import { buildRotationPlanFromGamePlan as legacyBuildRotationPlanFromGamePlan } from '../../../../../js/game-plan-interop.js';

function normalizeArray<T = unknown>(value: T[] | null | undefined) {
    return Array.isArray(value) ? value : [];
}

function normalizeRecord(value: unknown) {
    return value && typeof value === 'object' ? value as Record<string, unknown> : {};
}

export async function sendPublicRsvpReminderEmails(payload: {
    auth?: unknown;
    teamId?: string;
    gameId?: string;
    eventType?: string;
    eventTitle?: string;
    eventDate?: unknown;
}) {
    return await Promise.resolve(legacySendPublicRsvpReminderEmails(payload));
}

export function normalizeOfficialLinkEmail(value: unknown) {
    return String(legacyNormalizeOfficialLinkEmail(value) || '').trim().toLowerCase();
}

export function normalizeOfficialLinkPhone(value: unknown) {
    return String(legacyNormalizeOfficialLinkPhone(value) || '').trim();
}

export function getAssignedOfficiatingSlots(game: unknown, user: unknown) {
    return normalizeArray(legacyGetAssignedOfficiatingSlots(normalizeRecord(game), normalizeRecord(user)));
}

export function getOpenOfficiatingSlots(game: unknown) {
    return normalizeArray(legacyGetOpenOfficiatingSlots(game));
}

export function expandRecurrence(game: unknown): Record<string, any>[] {
    return normalizeArray<Record<string, any>>(legacyExpandRecurrence(game) as Record<string, any>[]);
}

export function extractOpponent(summary: unknown, teamName: unknown) {
    return String(legacyExtractOpponent(summary, teamName) || '').trim();
}

export async function fetchAndParseCalendar(url: string) {
    return normalizeArray(await Promise.resolve(legacyFetchAndParseCalendar(url)));
}

export function getCalendarEventTrackingId(event: unknown) {
    return String(legacyGetCalendarEventTrackingId(event) || '').trim();
}

export function isPracticeEvent(summary: unknown) {
    return legacyIsPracticeEvent(summary);
}

export function isTrackedCalendarEvent(event: unknown, trackedUids: string[]) {
    return legacyIsTrackedCalendarEvent(event, normalizeArray(trackedUids));
}

export function filterVisiblePracticeSessions(sessions: unknown[], games: unknown[]) {
    return normalizeArray(legacyFilterVisiblePracticeSessions(normalizeArray(sessions), normalizeArray(games)));
}

export function buildPracticePacketCompletionPayload(payload: Record<string, unknown>) {
    return normalizeRecord(legacyBuildPracticePacketCompletionPayload(payload));
}

export function resolveMyRsvpByChildForGame(events: unknown[], teamId: string, gameId: string, rsvps: unknown[], userId: string) {
    return normalizeRecord(legacyResolveMyRsvpByChildForGame(normalizeArray(events), teamId, gameId, normalizeArray(rsvps), userId));
}

export function buildGameDayRsvpBreakdown(input: { players: unknown[]; rsvps: unknown[] }) {
    return normalizeRecord(legacyBuildGameDayRsvpBreakdown({ players: normalizeArray(input.players), rsvps: normalizeArray(input.rsvps) }));
}

export function getPeriodsForFormation(value: unknown) {
    return normalizeArray(legacyGetPeriodsForFormation(value));
}

export function getEventRideshareSummary(offers: unknown[]) {
    return normalizeRecord(legacyGetEventRideshareSummary(normalizeArray(offers)));
}

export function mergeAssignmentsWithClaims(assignments: unknown[], claims: Record<string, unknown>) {
    return normalizeArray(legacyMergeAssignmentsWithClaims(normalizeArray(assignments), normalizeRecord(claims)));
}

export function hasScorekeepingTeamAccess(user: unknown, team: unknown, game: unknown, fallback: unknown) {
    return legacyHasScorekeepingTeamAccess(user, team, game, fallback);
}

export function isTeamActive(team: unknown) {
    return legacyIsTeamActive(team);
}

export function buildRotationPlanFromGamePlan(gamePlan: unknown): Record<string, any> {
    return normalizeRecord(legacyBuildRotationPlanFromGamePlan(normalizeRecord(gamePlan))) as Record<string, any>;
}

export function getSubstitutionOptions(input: Record<string, unknown>): any {
    return legacyGetSubstitutionOptions(normalizeRecord(input)) as any;
}

export function applyLiveSubstitution(input: Record<string, unknown>): any {
    return legacyApplyLiveSubstitution(normalizeRecord(input)) as any;
}
