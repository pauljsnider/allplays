import type {
    ChatAttachmentFirestoreRecord,
    ChatConversationFirestoreRecord,
    ChatMessageFirestoreRecord,
    FirestoreDecodedDocument,
    FirestoreDocument,
    FirestoreValue,
    GameReportAggregatedStatsFirestoreRecord,
    GameReportGameFirestoreRecord,
    GameReportOpponentFirestoreRecord,
    GameReportPlayerFirestoreRecord,
    GameReportStatsRecord,
    GameReportTeamFirestoreRecord,
    GameReportTeamStatsFirestoreRecord,
    ScheduleEventFirestoreRecord
} from './types';

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

function asUniqueStringArray(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return Array.from(new Set(value
        .map((entry) => asTrimmedString(entry))
        .filter((entry): entry is string => Boolean(entry))));
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

function asTemporalValue(value: unknown): unknown {
    if (value instanceof Date) {
        return Number.isNaN(value.getTime()) ? null : value;
    }
    if (value && typeof (value as { toDate?: unknown }).toDate === 'function') {
        return value;
    }
    if (typeof (value as { seconds?: unknown })?.seconds === 'number') {
        return value;
    }
    return asOptionalDate(value);
}

function asLooseObject(value: unknown): Record<string, unknown> {
    return asObject(value) || {};
}

function asObjectArray(value: unknown): Array<Record<string, unknown>> {
    return Array.isArray(value)
        ? value.filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === 'object' && !Array.isArray(entry))
        : [];
}

function asChatConversationType(value: unknown): ChatConversationFirestoreRecord['type'] {
    return value === 'team' || value === 'group' || value === 'direct' ? value : 'group';
}

function asChatAttachmentType(value: unknown, mimeType: unknown): ChatAttachmentFirestoreRecord['type'] {
    if (value === 'image' || value === 'video') return value;
    return asTrimmedString(mimeType)?.toLowerCase().startsWith('video/') ? 'video' : 'image';
}

function asChatTargetType(value: unknown): ChatMessageFirestoreRecord['targetType'] {
    return value === 'staff' || value === 'individuals' || value === 'full_team' ? value : 'full_team';
}

function asReactionMap(value: unknown): Record<string, string[]> {
    const source = asObject(value);
    if (!source) return {};

    return Object.entries(source).reduce<Record<string, string[]>>((acc, [key, entry]) => {
        const normalizedKey = asTrimmedString(key);
        const normalizedUsers = asUniqueStringArray(entry);
        if (normalizedKey && normalizedUsers.length > 0) {
            acc[normalizedKey] = normalizedUsers;
        }
        return acc;
    }, {});
}

export function mapChatAttachmentRecord(value: unknown): ChatAttachmentFirestoreRecord | null {
    const source = asObject(value);
    if (!source) return null;

    const mimeType = asTrimmedString(source.mimeType);
    return {
        type: asChatAttachmentType(source.type, mimeType),
        url: asTrimmedString(source.url),
        path: asTrimmedString(source.path),
        thumbnailUrl: asTrimmedString(source.thumbnailUrl),
        name: asTrimmedString(source.name),
        mimeType,
        size: asOptionalNumber(source.size),
        uploadedAt: asTemporalValue(source.uploadedAt)
    };
}

export function mapChatConversationRecord(value: unknown, fallbackId = ''): ChatConversationFirestoreRecord | null {
    const source = asLooseObject(value);
    const id = asTrimmedString(source.id) || fallbackId;
    if (!id) return null;

    return {
        id,
        type: asChatConversationType(source.type),
        name: asTrimmedString(source.name),
        participantIds: asUniqueStringArray(source.participantIds),
        participantRoles: asUniqueStringArray(source.participantRoles),
        mutedBy: asUniqueStringArray(source.mutedBy),
        isDefault: source.isDefault === true,
        isLegacy: source.isLegacy === true,
        updatedAt: asTemporalValue(source.updatedAt),
        lastMessageAt: asTemporalValue(source.lastMessageAt)
    };
}

export function mapChatConversationDocument(document: FirestoreDocument | null | undefined): ChatConversationFirestoreRecord | null {
    const decoded = mapFirestoreDocument(document);
    return decoded ? mapChatConversationRecord(decoded, decoded.id) : null;
}

export function mapChatMessageRecord(value: unknown, fallbackId = ''): ChatMessageFirestoreRecord | null {
    const source = asLooseObject(value);
    const id = asTrimmedString(source.id) || fallbackId;
    if (!id) return null;

    return {
        id,
        text: asTrimmedString(source.text),
        senderId: asTrimmedString(source.senderId),
        senderName: asTrimmedString(source.senderName),
        senderEmail: asTrimmedString(source.senderEmail),
        senderPhotoUrl: asTrimmedString(source.senderPhotoUrl),
        attachments: asObjectArray(source.attachments)
            .map((attachment) => mapChatAttachmentRecord(attachment))
            .filter((attachment): attachment is ChatAttachmentFirestoreRecord => Boolean(attachment)),
        imageUrl: asTrimmedString(source.imageUrl),
        imagePath: asTrimmedString(source.imagePath),
        imageName: asTrimmedString(source.imageName),
        imageType: asTrimmedString(source.imageType),
        imageSize: asOptionalNumber(source.imageSize),
        createdAt: asTemporalValue(source.createdAt),
        editedAt: asTemporalValue(source.editedAt),
        deleted: source.deleted === true,
        ai: source.ai === true,
        aiName: asTrimmedString(source.aiName),
        aiQuestion: asTrimmedString(source.aiQuestion),
        aiMeta: asObject(source.aiMeta),
        reactions: asReactionMap(source.reactions),
        targetType: asChatTargetType(source.targetType),
        recipientIds: asUniqueStringArray(source.recipientIds),
        targetRole: asTrimmedString(source.targetRole),
        conversationId: asTrimmedString(source.conversationId),
        _doc: source._doc
    };
}

export function mapChatMessageDocument(document: FirestoreDocument | null | undefined): ChatMessageFirestoreRecord | null {
    const decoded = mapFirestoreDocument(document);
    return decoded ? mapChatMessageRecord(decoded, decoded.id) : null;
}

function asGameReportStatsRecord(value: unknown): GameReportStatsRecord {
    const source = asObject(value);
    if (!source) return {};

    return Object.entries(source).reduce<GameReportStatsRecord>((acc, [key, entry]) => {
        if (typeof entry === 'number' && Number.isFinite(entry)) {
            acc[key] = entry;
            return acc;
        }
        if (typeof entry === 'string' || typeof entry === 'boolean' || entry === null) {
            acc[key] = entry;
        }
        return acc;
    }, {});
}

export function mapGameReportTeamRecord(value: unknown, fallbackTeamId = ''): GameReportTeamFirestoreRecord {
    const source = asLooseObject(value);
    return {
        ...source,
        id: asTrimmedString(source.id) || fallbackTeamId,
        name: asTrimmedString(source.name),
        sport: asTrimmedString(source.sport)
    };
}

export function mapGameReportPlayerRecords(value: unknown): GameReportPlayerFirestoreRecord[] {
    if (!Array.isArray(value)) return [];

    return value.map((entry) => {
        const source = asLooseObject(entry);
        return {
            ...source,
            id: asTrimmedString(source.id) || '',
            name: asTrimmedString(source.name),
            number: asTrimmedString(source.number),
            photoUrl: asTrimmedString(source.photoUrl)
        };
    }).filter((entry) => Boolean(entry.id));
}

export function mapGameReportGameRecord(value: unknown, fallbackGameId = ''): GameReportGameFirestoreRecord {
    const source = asLooseObject(value);
    const opponentStatsSource = asObject(source.opponentStats);
    const opponentStats = opponentStatsSource
        ? Object.entries(opponentStatsSource).reduce<Record<string, GameReportOpponentFirestoreRecord>>((acc, [key, entry]) => {
            acc[key] = asLooseObject(entry);
            return acc;
        }, {})
        : {};

    return {
        ...source,
        id: asTrimmedString(source.id) || fallbackGameId,
        summary: asTrimmedString(source.summary),
        statSheetPhotoUrl: asTrimmedString(source.statSheetPhotoUrl),
        opponentStats
    };
}

export function mapGameReportAggregatedStatsRecord(id: string, value: unknown): GameReportAggregatedStatsFirestoreRecord {
    const source = asLooseObject(value);
    return {
        id,
        stats: asGameReportStatsRecord(source.stats),
        timeMs: asOptionalNumber(source.timeMs) || 0,
        didNotPlay: source.didNotPlay === true,
        participated: source.participated === true,
        participationStatus: asTrimmedString(source.participationStatus) || '',
        participationSource: asTrimmedString(source.participationSource) || ''
    };
}

export function mapGameReportTeamStatsRecord(value: unknown): GameReportTeamStatsFirestoreRecord {
    return asGameReportStatsRecord(value);
}

export function mapScheduleEventDocument(document: FirestoreDocument | null | undefined): ScheduleEventFirestoreRecord | null {
    const decoded = mapFirestoreDocument(document);
    if (!decoded?.id) return null;

    const type = asTrimmedString(decoded.type) || 'game';
    const date = asOptionalDate(decoded.date);
    if ((type !== 'game' && type !== 'practice') || !date) {
        return null;
    }

    return {
        id: decoded.id,
        type,
        date,
        calendarEventUid: asTrimmedString(decoded.calendarEventUid),
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
