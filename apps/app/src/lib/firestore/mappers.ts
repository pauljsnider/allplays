import type { FirestoreDecodedDocument, FirestoreDocument, FirestoreValue, ScheduleEventFirestoreRecord } from './types';

function decodeFirestoreValue(value: FirestoreValue | undefined): unknown {
    if (!value || typeof value !== 'object') return null;
    if ('stringValue' in value && value.stringValue !== undefined) return value.stringValue;
    if ('booleanValue' in value && value.booleanValue !== undefined) return value.booleanValue;
    if ('integerValue' in value && value.integerValue !== undefined) return Number(value.integerValue || 0);
    if ('doubleValue' in value && value.doubleValue !== undefined) return Number(value.doubleValue || 0);
    if ('timestampValue' in value && value.timestampValue !== undefined) return new Date(value.timestampValue);
    if ('nullValue' in value && value.nullValue !== undefined) return null;
    if ('arrayValue' in value) return (value.arrayValue?.values || []).map((entry) => decodeFirestoreValue(entry));
    if ('mapValue' in value) return decodeFirestoreFields(value.mapValue?.fields || {});
    return null;
}

export function decodeFirestoreFields(fields: Record<string, FirestoreValue> = {}): Record<string, unknown> {
    return Object.keys(fields).reduce<Record<string, unknown>>((acc, key) => {
        acc[key] = decodeFirestoreValue(fields[key]);
        return acc;
    }, {});
}

export function mapFirestoreDocument(document: FirestoreDocument | null | undefined): FirestoreDecodedDocument | null {
    if (!document?.name) return null;
    return {
        id: String(document.name).split('/').pop() || '',
        ...decodeFirestoreFields(document.fields || {})
    };
}

function asTrimmedString(value: unknown): string | null {
    const normalized = String(value || '').trim();
    return normalized || null;
}

function asOptionalDate(value: unknown): Date | null {
    if (value instanceof Date) {
        return Number.isNaN(value.getTime()) ? null : value;
    }
    const stringValue = asTrimmedString(value);
    if (!stringValue) return null;
    const parsed = new Date(stringValue);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function asOptionalNumber(value: unknown): number | null {
    if (value === null || value === undefined || value === '') return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
}

function asOptionalBoolean(value: unknown): boolean | null {
    return typeof value === 'boolean' ? value : null;
}

function asObject(value: unknown): Record<string, unknown> | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    return value as Record<string, unknown>;
}

function asObjectArray(value: unknown): Array<Record<string, unknown>> {
    return Array.isArray(value)
        ? value.filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === 'object' && !Array.isArray(entry))
        : [];
}

export function mapScheduleEventDocument(document: FirestoreDocument | null | undefined): ScheduleEventFirestoreRecord | null {
    const decoded = mapFirestoreDocument(document);
    if (!decoded?.id) return null;

    const type = asTrimmedString(decoded.type);
    const date = asOptionalDate(decoded.date);
    if ((type !== 'game' && type !== 'practice') || !date) {
        return null;
    }

    return {
        id: decoded.id,
        type,
        date,
        endDate: asOptionalDate(decoded.endDate),
        end: asOptionalDate(decoded.end),
        endTime: asOptionalDate(decoded.endTime),
        opponent: asTrimmedString(decoded.opponent),
        title: asTrimmedString(decoded.title),
        location: asTrimmedString(decoded.location),
        opponentTeamId: asTrimmedString(decoded.opponentTeamId),
        opponentTeamName: asTrimmedString(decoded.opponentTeamName),
        awayTeamName: asTrimmedString(decoded.awayTeamName),
        opponentTeamPhoto: asTrimmedString(decoded.opponentTeamPhoto),
        sharedScheduleOpponentTeamId: asTrimmedString(decoded.sharedScheduleOpponentTeamId),
        status: asTrimmedString(decoded.status),
        liveStatus: asTrimmedString(decoded.liveStatus),
        liveClockMs: asOptionalNumber(decoded.liveClockMs),
        liveClockRunning: asOptionalBoolean(decoded.liveClockRunning),
        liveClockPeriod: asTrimmedString(decoded.liveClockPeriod),
        liveClockUpdatedAt: asOptionalDate(decoded.liveClockUpdatedAt),
        homeScore: asOptionalNumber(decoded.homeScore),
        awayScore: asOptionalNumber(decoded.awayScore),
        postGameNotes: asTrimmedString(decoded.postGameNotes),
        summary: asTrimmedString(decoded.summary),
        practiceFeedItems: asObjectArray(decoded.practiceFeedItems),
        isHome: asOptionalBoolean(decoded.isHome),
        kitColor: asTrimmedString(decoded.kitColor),
        arrivalTime: asOptionalDate(decoded.arrivalTime),
        notes: asTrimmedString(decoded.notes),
        seasonLabel: asTrimmedString(decoded.seasonLabel),
        competitionType: asTrimmedString(decoded.competitionType),
        countsTowardSeasonRecord: asOptionalBoolean(decoded.countsTowardSeasonRecord),
        source: asTrimmedString(decoded.source),
        sourceMetadata: asObject(decoded.sourceMetadata),
        visibility: asTrimmedString(decoded.visibility),
        assignments: asObjectArray(decoded.assignments),
        rsvpSummary: asObject(decoded.rsvpSummary),
        gamePlan: asObject(decoded.gamePlan),
        rotationPlan: asObject(decoded.rotationPlan),
        rotationActual: asObject(decoded.rotationActual),
        coachingNotes: asObjectArray(decoded.coachingNotes),
        isSeriesMaster: decoded.isSeriesMaster === true,
        recurrence: asObject(decoded.recurrence)
    };
}

export function mapScheduleEventDocuments(documents: FirestoreDocument[] | null | undefined): ScheduleEventFirestoreRecord[] {
    return Array.isArray(documents)
        ? documents.map((document) => mapScheduleEventDocument(document)).filter((document): document is ScheduleEventFirestoreRecord => Boolean(document))
        : [];
}
