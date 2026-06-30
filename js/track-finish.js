import { splitPlayerStatsByVisibility } from './stat-leaderboards.js?v=2';

export const STANDARD_TRACKER_MAX_PRIMARY_BATCH_WRITES = 500;
export const STANDARD_TRACKER_MAX_EVENT_BATCH_WRITES = 500;
export const STANDARD_TRACKER_MAX_AGGREGATED_STATS_BATCH_WRITES = 450;

export function buildFinishEventDocumentId(index) {
    return `finish-log-${String(Number(index || 0) + 1).padStart(6, '0')}`;
}

export function buildNormalizedPlayerStats(playerStats = {}, columns = []) {
    const playerStatsByLowerKey = {};
    const normalizedStats = {};

    Object.entries(playerStats || {}).forEach(([statKey, value]) => {
        playerStatsByLowerKey[String(statKey).toLowerCase()] = Number(value) || 0;
    });

    (Array.isArray(columns) ? columns : []).forEach((col) => {
        const key = String(col || '').toLowerCase();
        normalizedStats[key] = Object.prototype.hasOwnProperty.call(playerStatsByLowerKey, key)
            ? playerStatsByLowerKey[key]
            : 0;
    });

    Object.entries(playerStats || {}).forEach(([statKey, value]) => {
        const normalizedKey = String(statKey).toLowerCase();
        if (normalizedStats[statKey] === undefined && normalizedStats[normalizedKey] === undefined) {
            normalizedStats[statKey] = Number(value) || 0;
        }
    });

    return normalizedStats;
}

function hasTrackedPlayerActivity(playerStats = {}, normalizedStats = {}, includeTimeMs = false) {
    const hasStatActivity = Object.entries(normalizedStats || {}).some(([key, value]) => {
        if (includeTimeMs && String(key).toLowerCase() === 'time') return false;
        return Number(value) !== 0;
    });

    if (hasStatActivity) return true;

    return includeTimeMs && (Number(playerStats.time) || 0) > 0;
}

export function buildAggregatedStatsWrites({ players = [], playerStatsByPlayerId = {}, columns = [], statTrackerConfig = {}, includeTimeMs = false } = {}) {
    const safePlayers = Array.isArray(players) ? players : [];
    const safeStatsByPlayerId = playerStatsByPlayerId && typeof playerStatsByPlayerId === 'object'
        ? playerStatsByPlayerId
        : {};

    return safePlayers.map((player) => {
        const hasPlayerStatsRecord = Object.prototype.hasOwnProperty.call(safeStatsByPlayerId, player.id);
        const playerStats = hasPlayerStatsRecord ? safeStatsByPlayerId[player.id] || {} : {};

        const normalizedStats = buildNormalizedPlayerStats(playerStats, columns);
        const playerAppeared = includeTimeMs
            ? hasTrackedPlayerActivity(playerStats, normalizedStats, includeTimeMs)
            : hasPlayerStatsRecord || hasTrackedPlayerActivity(playerStats, normalizedStats, includeTimeMs);
        // If we are including timeMs, ensure the internal 'time' accumulator is not persisted as a stat.
        if (includeTimeMs && normalizedStats.time !== undefined) {
            delete normalizedStats.time;
        }
        const { publicStats, privateStats } = splitPlayerStatsByVisibility(statTrackerConfig, normalizedStats);

        const playerNumber = player.number ?? player.num ?? '';
        const baseParticipationData = {
            playerName: player.name,
            playerNumber,
            participated: playerAppeared,
            participationStatus: playerAppeared ? 'appeared' : 'did-not-appear',
            participationSource: 'standard-tracker-finish',
            ...(playerAppeared ? {} : { didNotPlay: true })
        };
        const publicData = {
            ...baseParticipationData,
            stats: publicStats
        };
        const privateData = Object.keys(privateStats).length > 0 ? {
            ...baseParticipationData,
            stats: privateStats
        } : null;

        if (includeTimeMs) {
            publicData.timeMs = Number(playerStats.time) || 0;
            if (privateData) {
                privateData.timeMs = Number(playerStats.time) || 0;
            }
        }

        return {
            playerId: player.id,
            publicData,
            privateData
        };
    });
}

export async function commitStandardTrackerFinishData({
    db,
    writeBatch,
    doc,
    collection,
    teamId,
    gameId,
    currentUserUid,
    gameLog = [],
    players = [],
    playerStatsByPlayerId = {},
    columns = [],
    statTrackerConfig = {},
    finalHome,
    finalAway,
    summary = '',
    opponentStats = {},
    maxPrimaryBatchWrites = STANDARD_TRACKER_MAX_PRIMARY_BATCH_WRITES,
    maxEventBatchWrites = STANDARD_TRACKER_MAX_EVENT_BATCH_WRITES,
    maxAggregatedStatsBatchWrites = STANDARD_TRACKER_MAX_AGGREGATED_STATS_BATCH_WRITES,
    includeTimeMs = false
} = {}) {
    const safeGameLog = Array.isArray(gameLog) ? gameLog : [];
    const legacyPrimaryBatchWriteCount = safeGameLog.length + 1;
    const aggregatedStatsWrites = buildAggregatedStatsWrites({
        players,
        playerStatsByPlayerId,
        columns,
        statTrackerConfig,
        includeTimeMs
    });

    const eventBatchSizes = [];
    let eventBatch = null;
    let eventBatchWriteCount = 0;

    function ensureEventBatch() {
        if (!eventBatch) {
            eventBatch = writeBatch(db);
        }
    }

    async function commitEventBatch() {
        if (!eventBatch || eventBatchWriteCount === 0) return;
        eventBatchSizes.push(eventBatchWriteCount);
        await eventBatch.commit();
        eventBatch = null;
        eventBatchWriteCount = 0;
    }

    for (const [eventIndex, entry] of safeGameLog.entries()) {
        if (eventBatchWriteCount >= maxEventBatchWrites) {
            await commitEventBatch();
        }
        ensureEventBatch();
        const eventRef = doc(db, `teams/${teamId}/games/${gameId}/events`, buildFinishEventDocumentId(eventIndex));
        eventBatch.set(eventRef, {
            text: entry.text,
            gameTime: entry.time ?? entry.clock,
            period: entry.period,
            timestamp: entry.timestamp || entry.ts || Date.now(),
            type: entry.undoData?.type || 'game_log',
            playerId: entry.undoData?.playerId || null,
            statKey: entry.undoData?.statKey || null,
            value: entry.undoData?.value || null,
            isOpponent: entry.undoData?.isOpponent || false,
            createdBy: currentUserUid
        });
        eventBatchWriteCount += 1;
    }
    await commitEventBatch();

    const aggregatedStatsBatchSizes = [];
    let statsBatch = null;
    let statsBatchWriteCount = 0;

    function ensureStatsBatch() {
        if (!statsBatch) {
            statsBatch = writeBatch(db);
        }
    }

    async function commitStatsBatch() {
        if (!statsBatch || statsBatchWriteCount === 0) return;
        aggregatedStatsBatchSizes.push(statsBatchWriteCount);
        await statsBatch.commit();
        statsBatch = null;
        statsBatchWriteCount = 0;
    }

    for (const { playerId, publicData, privateData } of aggregatedStatsWrites) {
        const writeCount = 2;
        if (statsBatchWriteCount > 0 && statsBatchWriteCount + writeCount > maxAggregatedStatsBatchWrites) {
            await commitStatsBatch();
        }

        ensureStatsBatch();
        const statsRef = doc(db, `teams/${teamId}/games/${gameId}/aggregatedStats`, playerId);
        const privateStatsRef = doc(db, `teams/${teamId}/games/${gameId}/privatePlayerStats`, playerId);
        statsBatch.set(statsRef, publicData);
        statsBatchWriteCount += 1;

        if (privateData) {
            statsBatch.set(privateStatsRef, privateData);
        } else {
            statsBatch.delete(privateStatsRef);
        }
        statsBatchWriteCount += 1;
    }
    await commitStatsBatch();

    const gameUpdateBatch = writeBatch(db);
    const gameRef = doc(db, `teams/${teamId}/games`, gameId);
    gameUpdateBatch.update(gameRef, {
        homeScore: finalHome,
        awayScore: finalAway,
        summary,
        status: 'completed',
        opponentStats
    });
    await gameUpdateBatch.commit();

    return {
        primaryBatchWriteCount: legacyPrimaryBatchWriteCount,
        eventBatchSizes,
        gameUpdateBatchSize: 1,
        aggregatedStatsBatchSizes,
        aggregatedStatsWriteCount: aggregatedStatsBatchSizes.reduce((total, size) => total + size, 0)
    };
}
