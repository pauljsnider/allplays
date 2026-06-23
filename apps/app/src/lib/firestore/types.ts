export type FirestoreScalarValue = {
    stringValue?: string;
    booleanValue?: boolean;
    integerValue?: string;
    doubleValue?: number;
    timestampValue?: string;
    nullValue?: 'NULL_VALUE';
};

export type FirestoreArrayValue = {
    arrayValue?: {
        values?: FirestoreValue[];
    };
};

export type FirestoreMapValue = {
    mapValue?: {
        fields?: Record<string, FirestoreValue>;
    };
};

export type FirestoreValue = FirestoreScalarValue & FirestoreArrayValue & FirestoreMapValue;

export type FirestoreDocument = {
    name?: string;
    fields?: Record<string, FirestoreValue>;
};

export type FirestoreDecodedDocument = Record<string, unknown> & {
    id: string;
};

export type ChatConversationFirestoreRecord = {
    id: string;
    type: 'team' | 'group' | 'direct';
    name?: string | null;
    participantIds?: string[];
    participantRoles?: string[];
    mutedBy?: string[];
    isDefault?: boolean;
    isLegacy?: boolean;
    updatedAt?: unknown;
    lastMessageAt?: unknown;
};

export type ChatAttachmentFirestoreRecord = {
    type: 'image' | 'video';
    url: string | null;
    path?: string | null;
    thumbnailUrl?: string | null;
    name?: string | null;
    mimeType?: string | null;
    size?: number | null;
    uploadedAt?: unknown;
};

export type ChatMessageFirestoreRecord = {
    id: string;
    clientMessageId?: string | null;
    text?: string | null;
    senderId?: string | null;
    senderName?: string | null;
    senderEmail?: string | null;
    senderPhotoUrl?: string | null;
    attachments?: ChatAttachmentFirestoreRecord[];
    imageUrl?: string | null;
    imagePath?: string | null;
    imageName?: string | null;
    imageType?: string | null;
    imageSize?: number | null;
    createdAt?: unknown;
    editedAt?: unknown;
    deleted?: boolean;
    ai?: boolean;
    aiName?: string | null;
    aiQuestion?: string | null;
    aiMeta?: Record<string, unknown> | null;
    reactions?: Record<string, string[]>;
    targetType?: 'full_team' | 'staff' | 'individuals';
    recipientIds?: string[];
    mentionedUids?: string[];
    targetRole?: string | null;
    conversationId?: string | null;
    sendStatus?: 'pending' | 'failed';
    sendError?: string | null;
    attachmentCount?: number;
    _doc?: unknown;
};

export type ScheduleEventFirestoreRecord = {
    id: string;
    type: 'game' | 'practice';
    date: Date;
    calendarEventUid?: string | null;
    endDate?: Date | null;
    end?: Date | null;
    endTime?: Date | null;
    opponent?: string | null;
    title?: string | null;
    location?: string | null;
    opponentTeamId?: string | null;
    opponentTeamName?: string | null;
    awayTeamName?: string | null;
    opponentTeamPhoto?: string | null;
    sharedScheduleOpponentTeamId?: string | null;
    gameId?: string | null;
    status?: string | null;
    liveStatus?: string | null;
    liveClockMs?: number | null;
    liveClockRunning?: boolean | null;
    liveClockPeriod?: string | null;
    liveClockUpdatedAt?: Date | null;
    homeScore?: number | null;
    awayScore?: number | null;
    postGameNotes?: string | null;
    summary?: string | null;
    practiceFeedItems?: Array<Record<string, unknown>>;
    isHome?: boolean | null;
    kitColor?: string | null;
    arrivalTime?: Date | null;
    notes?: string | null;
    seasonLabel?: string | null;
    competitionType?: string | null;
    countsTowardSeasonRecord?: boolean | null;
    tournament?: Record<string, unknown> | null;
    statTrackerConfigId?: string | null;
    source?: string | null;
    sourceMetadata?: (Record<string, unknown> & { sourceType?: string | null }) | null;
    visibility?: string | null;
    assignments?: Array<Record<string, unknown>>;
    rsvpSummary?: Record<string, unknown> | null;
    gamePlan?: Record<string, unknown> | null;
    rotationPlan?: Record<string, unknown> | null;
    rotationActual?: Record<string, unknown> | null;
    coachingNotes?: Array<Record<string, unknown>>;
    isSeriesMaster?: boolean;
    recurrence?: Record<string, unknown> | null;
    startTime?: string | null;
    endDayOffset?: number | null;
    exDates?: string[];
    overrides?: Record<string, Record<string, unknown>> | null;
};

export type GameReportStatValue = string | number | boolean | null;

export type GameReportStatsRecord = Record<string, GameReportStatValue>;

export type GameReportPlayerFirestoreRecord = {
    id: string;
    name?: string | null;
    number?: string | null;
    photoUrl?: string | null;
    [key: string]: unknown;
};

export type GameReportTeamFirestoreRecord = {
    id: string;
    name?: string | null;
    sport?: string | null;
    [key: string]: unknown;
};

export type GameReportOpponentFirestoreRecord = {
    name?: string | null;
    number?: string | null;
    notes?: string | null;
    playerId?: string | null;
    photoUrl?: string | null;
    [key: string]: unknown;
};

export type GameReportGameFirestoreRecord = {
    id: string;
    summary?: string | null;
    statSheetPhotoUrl?: string | null;
    opponentStats?: Record<string, GameReportOpponentFirestoreRecord>;
    [key: string]: unknown;
};

export type GameReportAggregatedStatsFirestoreRecord = {
    id: string;
    stats: GameReportStatsRecord;
    timeMs: number;
    didNotPlay: boolean;
    participated: boolean;
    participationStatus: string;
    participationSource: string;
};

export type GameReportTeamStatsFirestoreRecord = GameReportStatsRecord;

export type GameReportEventFirestoreRecord = {
    id: string;
    text: string;
    period: string;
    clock: string;
    timestamp?: unknown;
    [key: string]: unknown;
};
