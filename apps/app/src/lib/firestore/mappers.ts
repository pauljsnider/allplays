import type {
    ChatAttachmentFirestoreRecord,
    ChatConversationFirestoreRecord,
    ChatMessageFirestoreRecord,
    FirestoreDecodedDocument,
    FirestoreDocument,
    FirestoreValue,
    GameReportAggregatedStatsFirestoreRecord,
    GameReportEventFirestoreRecord,
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
    if (value === null || value === undefined) return null;
    if (typeof value === 'object' || typeof value === 'function' || typeof value === 'symbol') return null;
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
    if (value && typeof (value as { toDate?: unknown }).toDate === 'function') {
        const date = (value as { toDate: () => unknown }).toDate();
        return date instanceof Date && !Number.isNaN(date.getTime()) ? date : null;
    }
    if (value && typeof (value as { toMillis?: unknown }).toMillis === 'function') {
        const date = new Date((value as { toMillis: () => number }).toMillis());
        return Number.isNaN(date.getTime()) ? null : date;
    }
    if (value && typeof (value as { seconds?: unknown }).seconds === 'number') {
        const { seconds, nanoseconds } = value as { seconds: number; nanoseconds?: unknown };
        const millis = (seconds * 1000) + Math.floor(Number(nanoseconds || 0) / 1000000);
        const date = new Date(millis);
        return Number.isNaN(date.getTime()) ? null : date;
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

function asScheduleSourceMetadata(value: unknown): ScheduleEventFirestoreRecord['sourceMetadata'] {
    const source = asObject(value);
    if (!source) return null;
    return {
        ...source,
        sourceType: asTrimmedString(source.sourceType)
    };
}

function asTemporalValue(value: unknown): unknown {
    return asOptionalDate(value);
}

function asEventTimestamp(value: unknown): unknown {
    if (typeof value === 'number' && Number.isFinite(value)) {
        return value;
    }
    return asTemporalValue(value);
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
        directAccess: source.directAccess === 'accepted_friend' || source.directAccess === 'team_admin'
            ? source.directAccess
            : null,
        directUserIds: asUniqueStringArray(source.directUserIds),
        friendshipId: asTrimmedString(source.friendshipId),
        initiatedBy: asTrimmedString(source.initiatedBy),
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

export function mapChatConversationRecords(values: unknown): ChatConversationFirestoreRecord[] {
    return Array.isArray(values)
        ? values.map((value) => {
            const source = asLooseObject(value);
            return mapChatConversationRecord(source, asTrimmedString(source.id) || '');
        }).filter((conversation): conversation is ChatConversationFirestoreRecord => Boolean(conversation))
        : [];
}

export function mapChatMessageRecord(value: unknown, fallbackId = ''): ChatMessageFirestoreRecord | null {
    const source = asLooseObject(value);
    const id = asTrimmedString(source.id) || fallbackId;
    if (!id) return null;

    return {
        id,
        clientMessageId: asTrimmedString(source.clientMessageId),
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
        mentionedUids: asUniqueStringArray(source.mentionedUids),
        targetRole: asTrimmedString(source.targetRole),
        conversationId: asTrimmedString(source.conversationId),
        _doc: source._doc
    };
}

export function mapChatMessageRecords(values: unknown): ChatMessageFirestoreRecord[] {
    return Array.isArray(values)
        ? values.map((value) => {
            const source = asLooseObject(value);
            return mapChatMessageRecord(source, asTrimmedString(source.id) || '');
        }).filter((message): message is ChatMessageFirestoreRecord => Boolean(message))
        : [];
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

export function mapGameReportOpponentStatsRecord(value: unknown): GameReportOpponentFirestoreRecord {
    const source = asLooseObject(value);
    return {
        ...asGameReportStatsRecord(source),
        name: asTrimmedString(source.name),
        number: asTrimmedString(source.number),
        notes: asTrimmedString(source.notes),
        playerId: asTrimmedString(source.playerId),
        photoUrl: asTrimmedString(source.photoUrl)
    };
}

export function mapGameReportGameRecord(value: unknown, fallbackGameId = ''): GameReportGameFirestoreRecord {
    const source = asLooseObject(value);
    const opponentStatsSource = asObject(source.opponentStats);
    const opponentStats = opponentStatsSource
        ? Object.entries(opponentStatsSource).reduce<Record<string, GameReportOpponentFirestoreRecord>>((acc, [key, entry]) => {
            acc[key] = mapGameReportOpponentStatsRecord(entry);
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

export function mapGameReportEventRecord(value: unknown, fallbackId = ''): GameReportEventFirestoreRecord | null {
    const source = asLooseObject(value);
    const id = asTrimmedString(source.id) || fallbackId;
    if (!id) return null;

    return {
        ...source,
        id,
        text: asTrimmedString(source.text) || asTrimmedString(source.message) || 'Event logged',
        period: asTrimmedString(source.period) || 'Q1',
        clock: asTrimmedString(source.clock) || asTrimmedString(source.gameTime) || '',
        timestamp: asEventTimestamp(source.timestamp)
    };
}

export function mapGameReportEventRecords(value: unknown): GameReportEventFirestoreRecord[] {
    return Array.isArray(value)
        ? value.map((entry) => {
            const source = asLooseObject(entry);
            return mapGameReportEventRecord(source, asTrimmedString(source.id) || '');
        }).filter((entry): entry is GameReportEventFirestoreRecord => Boolean(entry))
        : [];
}

export function mapScheduleEventRecord(value: unknown, fallbackId = ''): ScheduleEventFirestoreRecord | null {
    const decoded = asLooseObject(value);
    const id = asTrimmedString(decoded.id) || fallbackId;
    if (!id) return null;

    const type = asTrimmedString(decoded.type) || 'game';
    const date = asOptionalDate(decoded.date);
    if ((type !== 'game' && type !== 'practice') || !date) {
        return null;
    }

    return {
        id,
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
        gameId: asTrimmedString(decoded.gameId),
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
        tournament: asObject(decoded.tournament),
        statTrackerConfigId: asTrimmedString(decoded.statTrackerConfigId),
        source: asTrimmedString(decoded.source),
        sourceMetadata: asScheduleSourceMetadata(decoded.sourceMetadata),
        visibility: asTrimmedString(decoded.visibility),
        assignments: asObjectArray(decoded.assignments),
        rsvpSummary: asObject(decoded.rsvpSummary),
        gamePlan: asObject(decoded.gamePlan),
        rotationPlan: asObject(decoded.rotationPlan),
        rotationActual: asObject(decoded.rotationActual),
        coachingNotes: asObjectArray(decoded.coachingNotes),
        isSeriesMaster: decoded.isSeriesMaster === true,
        recurrence: asObject(decoded.recurrence),
        startTime: asTrimmedString(decoded.startTime),
        endDayOffset: asOptionalNumber(decoded.endDayOffset),
        exDates: asUniqueStringArray(decoded.exDates),
        overrides: asObject(decoded.overrides) as Record<string, Record<string, unknown>> | null
    };
}

export function mapScheduleEventRecords(values: unknown): ScheduleEventFirestoreRecord[] {
    return Array.isArray(values)
        ? values.map((value) => {
            const source = asLooseObject(value);
            return mapScheduleEventRecord(source, asTrimmedString(source.id) || '');
        }).filter((document): document is ScheduleEventFirestoreRecord => Boolean(document))
        : [];
}

export function mapScheduleEventDocument(document: FirestoreDocument | null | undefined): ScheduleEventFirestoreRecord | null {
    const decoded = mapFirestoreDocument(document);
    return decoded ? mapScheduleEventRecord(decoded, decoded.id) : null;
}

export function mapScheduleEventDocuments(documents: FirestoreDocument[] | null | undefined): ScheduleEventFirestoreRecord[] {
    return Array.isArray(documents)
        ? documents.map((document) => mapScheduleEventDocument(document)).filter((document): document is ScheduleEventFirestoreRecord => Boolean(document))
        : [];
}
