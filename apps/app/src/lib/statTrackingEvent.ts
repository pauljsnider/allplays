export type TrackerUser = {
    uid: string;
    displayName?: string | null;
    email?: string | null;
};

export type TrackerUndoData = {
    type?: string | null;
    playerId?: string | null;
    statKey?: string | null;
    value?: number | null;
    isOpponent?: boolean;
};

export type TrackerOpponentStatsEntry = {
    name: string;
    number: string;
    playerId: string | null;
    photoUrl: string;
    [statKey: string]: string | number | null;
};

export type TrackerEventInput = {
    text: string;
    clock?: string | null;
    gameTime?: string | null;
    period?: string | null;
    timestamp?: number | Date | null;
    undoData?: TrackerUndoData | null;
    playerName?: string | null;
    playerNumber?: string | null;
    opponentPlayerName?: string | null;
    opponentPlayerNumber?: string | number | null;
    opponentPlayerPhoto?: string | null;
    opponentStatsEntryId?: string | null;
    opponentStatsEntryBefore?: TrackerOpponentStatsEntry | null;
    opponentStatsEntryAfter?: TrackerOpponentStatsEntry | null;
    teamSide?: 'home' | 'away';
};

export type TrackerEventDocument = {
    text: string;
    gameTime: string;
    period: string;
    timestamp: number;
    type: string;
    playerId: string | null;
    statKey: string | null;
    value: number | null;
    isOpponent: boolean;
    opponentPlayerName?: string | null;
    opponentPlayerNumber?: string;
    opponentPlayerPhoto?: string;
    createdBy: string;
};

const BASE_TRACKER_PERIOD = 'Q1';

function normalizeText(value: unknown) {
    return String(value || '').trim();
}

function normalizeStatKey(value: unknown) {
    return normalizeText(value).toLowerCase();
}

function normalizeTimestamp(value: unknown) {
    if (value instanceof Date) {
        return Number.isNaN(value.getTime()) ? Date.now() : value.getTime();
    }
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : Date.now();
}

export function buildTrackerEventDocument(input: TrackerEventInput, user: TrackerUser): TrackerEventDocument {
    const undoData = input.undoData || {};
    const statKey = normalizeStatKey(undoData.statKey);
    const value = Number(undoData.value);
    const isOpponent = undoData.isOpponent === true;

    const event: TrackerEventDocument = {
        text: String(input.text || ''),
        gameTime: String(input.gameTime || input.clock || ''),
        period: String(input.period || BASE_TRACKER_PERIOD),
        timestamp: normalizeTimestamp(input.timestamp),
        type: String(undoData.type || 'game_log'),
        playerId: normalizeText(undoData.playerId) || null,
        statKey: statKey || null,
        value: Number.isFinite(value) ? value : null,
        isOpponent,
        createdBy: String(user.uid || '')
    };

    if (isOpponent) {
        event.opponentPlayerName = normalizeText(input.opponentPlayerName || input.playerName) || null;
        event.opponentPlayerNumber = normalizeText(input.opponentPlayerNumber ?? input.playerNumber);
        event.opponentPlayerPhoto = normalizeText(input.opponentPlayerPhoto);
    }

    return event;
}
