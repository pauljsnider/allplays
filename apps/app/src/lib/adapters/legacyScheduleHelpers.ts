import { sendPublicRsvpReminderEmails as legacySendPublicRsvpReminderEmails } from '../../../../../js/schedule-notifications.js';
import { normalizeOfficialLinkEmail as legacyNormalizeOfficialLinkEmail, normalizeOfficialLinkPhone as legacyNormalizeOfficialLinkPhone } from '../../../../../js/admin-user-official-links.js';
import { getAssignedOfficiatingSlots as legacyGetAssignedOfficiatingSlots, getOpenOfficiatingSlots as legacyGetOpenOfficiatingSlots } from '../../../../../js/officiating-utils.js';
import {
    expandRecurrence as legacyExpandRecurrence,
    extractOpponent as legacyExtractOpponent,
    fetchAndParseCalendar as legacyFetchAndParseCalendar,
    generateSeriesId as legacyGenerateSeriesId,
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
import { applyPracticeRecurrenceFields as legacyApplyPracticeRecurrenceFields } from '../../../../../js/edit-schedule-practice-payload.js';

type LegacyRecord = Record<string, unknown>;

type LegacyCalendarEvent = LegacyRecord & {
    uid?: string;
    summary?: string;
    location?: string;
    dtstart?: string | Date;
};

type LegacyPracticeOccurrence = LegacyRecord & {
    masterId?: string;
    instanceDate?: string;
    date?: string | Date;
    endDate?: string | Date;
    location?: string;
    title?: string;
};

type LegacyRsvpBreakdownRow = LegacyRecord & {
    playerId?: string;
    playerName?: string;
    response?: string;
};

export type LegacyGameDayRsvpBreakdown = {
    grouped: {
        going: LegacyRsvpBreakdownRow[];
        maybe: LegacyRsvpBreakdownRow[];
        not_going: LegacyRsvpBreakdownRow[];
        not_responded: LegacyRsvpBreakdownRow[];
    };
    counts: Record<string, number>;
};

export type LegacyRotationPlan = Record<string, Record<string, string>>;

export type LegacySubstitutionPlayer = {
    id: string;
    name: string;
    number?: string | null;
};

export type LegacySubstitutionOptions = {
    onField: Record<string, string>;
    onFieldPlayers: LegacySubstitutionPlayer[];
    offFieldPlayers: LegacySubstitutionPlayer[];
};

export type LegacyRotationActualEntry = LegacyRecord & {
    position?: string;
    out?: string;
    outId?: string;
    outPlayerId?: string;
    in?: string;
    inId?: string;
    inPlayerId?: string;
    appliedAt?: string;
};

export type LegacyRotationActual = Record<string, Record<string, LegacyRotationActualEntry[]>>;

export type LegacyLiveSubstitutionResult = {
    position: string;
    outPlayer: LegacySubstitutionPlayer;
    inPlayer: LegacySubstitutionPlayer;
    rotationPlan: LegacyRotationPlan;
    rotationActual: LegacyRotationActual;
} | null;

function normalizeArray<T = unknown>(value: T[] | null | undefined): T[] {
    return Array.isArray(value) ? value : [];
}

function normalizeRecord<T extends LegacyRecord = LegacyRecord>(value: unknown): T {
    return (value && typeof value === 'object' ? value : {}) as T;
}

function normalizeCalendarEvent(value: unknown): LegacyCalendarEvent {
    return normalizeRecord<LegacyCalendarEvent>(value);
}

function normalizeSubstitutionPlayer(value: unknown): LegacySubstitutionPlayer {
    const record = normalizeRecord(value);
    return {
        id: String(record.id || '').trim(),
        name: String(record.name || '').trim() || 'Player',
        number: record.number == null ? null : String(record.number || '').trim() || null
    };
}

function normalizeRotationPlan(value: unknown): LegacyRotationPlan {
    return Object.entries(normalizeRecord(value)).reduce<LegacyRotationPlan>((acc, [period, slots]) => {
        const normalizedSlots = Object.entries(normalizeRecord(slots)).reduce<Record<string, string>>((slotAcc, [slotId, playerId]) => {
            const safeSlotId = String(slotId || '').trim();
            const safePlayerId = String(playerId || '').trim();
            if (!safeSlotId || !safePlayerId) return slotAcc;
            slotAcc[safeSlotId] = safePlayerId;
            return slotAcc;
        }, {});
        if (Object.keys(normalizedSlots).length > 0) {
            acc[String(period || '').trim()] = normalizedSlots;
        }
        return acc;
    }, {});
}

function normalizeRotationActual(value: unknown): LegacyRotationActual {
    return Object.entries(normalizeRecord(value)).reduce<LegacyRotationActual>((acc, [period, entries]) => {
        const normalizedEntries = Object.entries(normalizeRecord(entries)).reduce<Record<string, LegacyRotationActualEntry[]>>((entryAcc, [entryId, items]) => {
            const safeEntryId = String(entryId || '').trim();
            if (!safeEntryId) return entryAcc;
            entryAcc[safeEntryId] = normalizeArray(items).map((item) => normalizeRecord<LegacyRotationActualEntry>(item));
            return entryAcc;
        }, {});
        if (Object.keys(normalizedEntries).length > 0) {
            acc[String(period || '').trim()] = normalizedEntries;
        }
        return acc;
    }, {});
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

export function normalizeOfficialLinkEmail(value: unknown): string {
    return String(legacyNormalizeOfficialLinkEmail(value) || '').trim().toLowerCase();
}

export function normalizeOfficialLinkPhone(value: unknown): string {
    return String(legacyNormalizeOfficialLinkPhone(value) || '').trim();
}

export function getAssignedOfficiatingSlots(game: unknown, user: unknown): LegacyRecord[] {
    return normalizeArray(legacyGetAssignedOfficiatingSlots(normalizeRecord(game), normalizeRecord(user))) as LegacyRecord[];
}

export function getOpenOfficiatingSlots(game: unknown): LegacyRecord[] {
    return normalizeArray(legacyGetOpenOfficiatingSlots(game)) as LegacyRecord[];
}

export function expandRecurrence(game: unknown): LegacyPracticeOccurrence[] {
    return normalizeArray<LegacyPracticeOccurrence>(legacyExpandRecurrence(game) as LegacyPracticeOccurrence[]);
}

export function extractOpponent(summary: unknown, teamName: unknown): string {
    return String(legacyExtractOpponent(summary, teamName) || '').trim();
}

export async function fetchAndParseCalendar(url: string): Promise<LegacyCalendarEvent[]> {
    return normalizeArray<LegacyCalendarEvent>(await Promise.resolve(legacyFetchAndParseCalendar(url)) as LegacyCalendarEvent[]);
}

export function getCalendarEventTrackingId(event: unknown): string {
    return String(legacyGetCalendarEventTrackingId(event) || '').trim();
}

export function isPracticeEvent(summary: unknown): boolean {
    return legacyIsPracticeEvent(summary);
}

export function isTrackedCalendarEvent(event: unknown, trackedUids: string[]): boolean {
    return legacyIsTrackedCalendarEvent(normalizeCalendarEvent(event), normalizeArray(trackedUids));
}

export function filterVisiblePracticeSessions(sessions: unknown[], games: unknown[]): LegacyRecord[] {
    return normalizeArray(legacyFilterVisiblePracticeSessions(normalizeArray(sessions), normalizeArray(games))) as LegacyRecord[];
}

export function buildPracticePacketCompletionPayload(payload: Record<string, unknown>): LegacyRecord {
    return normalizeRecord(legacyBuildPracticePacketCompletionPayload(payload));
}

export function resolveMyRsvpByChildForGame(events: unknown[], teamId: string, gameId: string, rsvps: unknown[], userId: string): LegacyRecord {
    return normalizeRecord(legacyResolveMyRsvpByChildForGame(normalizeArray(events), teamId, gameId, normalizeArray(rsvps), userId));
}

export function buildGameDayRsvpBreakdown(input: { players: unknown[]; rsvps: unknown[] }): LegacyGameDayRsvpBreakdown {
    const breakdown = normalizeRecord<LegacyGameDayRsvpBreakdown>(legacyBuildGameDayRsvpBreakdown({
        players: normalizeArray(input.players),
        rsvps: normalizeArray(input.rsvps)
    }));
    return {
        grouped: {
            going: normalizeArray(breakdown.grouped?.going),
            maybe: normalizeArray(breakdown.grouped?.maybe),
            not_going: normalizeArray(breakdown.grouped?.not_going),
            not_responded: normalizeArray(breakdown.grouped?.not_responded)
        },
        counts: normalizeRecord<Record<string, number>>(breakdown.counts)
    };
}

export function getPeriodsForFormation(value: unknown): string[] {
    return normalizeArray(legacyGetPeriodsForFormation(value)).map((period) => String(period || '').trim()).filter(Boolean);
}

export function getEventRideshareSummary(offers: unknown[]): LegacyRecord {
    return normalizeRecord(legacyGetEventRideshareSummary(normalizeArray(offers)));
}

export function mergeAssignmentsWithClaims(assignments: unknown[], claims: Record<string, unknown>): LegacyRecord[] {
    return normalizeArray(legacyMergeAssignmentsWithClaims(normalizeArray(assignments), normalizeRecord(claims))) as LegacyRecord[];
}

export function hasScorekeepingTeamAccess(user: unknown, team: unknown, game: unknown, fallback: unknown): boolean {
    return legacyHasScorekeepingTeamAccess(user, team, game, fallback);
}

export function isTeamActive(team: unknown): boolean {
    return legacyIsTeamActive(team);
}

export function buildRotationPlanFromGamePlan(gamePlan: unknown): LegacyRotationPlan {
    return normalizeRotationPlan(legacyBuildRotationPlanFromGamePlan(normalizeRecord(gamePlan)));
}

export function getSubstitutionOptions(input: Record<string, unknown>): LegacySubstitutionOptions {
    const result = normalizeRecord(legacyGetSubstitutionOptions(normalizeRecord(input)));
    return {
        onField: Object.entries(normalizeRecord(result.onField)).reduce<Record<string, string>>((acc, [position, playerId]) => {
            const safePosition = String(position || '').trim();
            const safePlayerId = String(playerId || '').trim();
            if (!safePosition || !safePlayerId) return acc;
            acc[safePosition] = safePlayerId;
            return acc;
        }, {}),
        onFieldPlayers: normalizeArray(result.onFieldPlayers).map(normalizeSubstitutionPlayer).filter((player) => player.id),
        offFieldPlayers: normalizeArray(result.offFieldPlayers).map(normalizeSubstitutionPlayer).filter((player) => player.id)
    };
}

export function applyLiveSubstitution(input: Record<string, unknown>): LegacyLiveSubstitutionResult {
    const result = legacyApplyLiveSubstitution(normalizeRecord(input));
    if (!result || typeof result !== 'object') return null;
    const normalized = normalizeRecord(result);
    return {
        position: String(normalized.position || '').trim() || 'unknown',
        outPlayer: normalizeSubstitutionPlayer(normalized.outPlayer),
        inPlayer: normalizeSubstitutionPlayer(normalized.inPlayer),
        rotationPlan: normalizeRotationPlan(normalized.rotationPlan),
        rotationActual: normalizeRotationActual(normalized.rotationActual)
    };
}

export function generateSeriesId(): string {
    return String(legacyGenerateSeriesId() || '').trim();
}

export function applyPracticeRecurrenceFields(payload: {
    practiceData: Record<string, any>;
    isRecurring?: boolean;
    editingPracticeId?: string | null;
    editingSeriesId?: string | null;
    recurrenceConfig?: Record<string, unknown>;
    startDate?: Date;
    endDate?: Date;
    Timestamp: { fromDate: (date: Date) => unknown };
    deleteField: () => unknown;
    generateSeriesId?: () => string;
}): Record<string, any> {
    return legacyApplyPracticeRecurrenceFields({
        ...payload,
        generateSeriesId: payload.generateSeriesId || generateSeriesId
    }) as Record<string, any>;
}
