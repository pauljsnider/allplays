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
    source?: string | null;
    sourceMetadata?: Record<string, unknown> | null;
    visibility?: string | null;
    assignments?: Array<Record<string, unknown>>;
    rsvpSummary?: Record<string, unknown> | null;
    gamePlan?: Record<string, unknown> | null;
    rotationPlan?: Record<string, unknown> | null;
    rotationActual?: Record<string, unknown> | null;
    coachingNotes?: Array<Record<string, unknown>>;
    isSeriesMaster?: boolean;
    recurrence?: Record<string, unknown> | null;
};
