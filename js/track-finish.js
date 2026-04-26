export const STANDARD_TRACKER_MAX_PRIMARY_BATCH_WRITES = 500;
export const STANDARD_TRACKER_MAX_AGGREGATED_STATS_BATCH_WRITES = 450;

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

export function buildFinishBatchLimitError(gameLogLength, maxPrimaryBatchWrites = STANDARD_TRACKER_MAX_PRIMARY_BATCH_WRITES) {
    return new Error(`Game has ${gameLogLength} logged events. Finish requires chunked event persistence before it can safely exceed Firestore's ${maxPrimaryBatchWrites}-write batch limit.`);
}

export function buildAggregatedStatsWrites({ players = [], playerStatsByPlayerId = {}, columns = [] } = {}) {
    const safePlayers = Array.isArray(players) ? players : [];
    const safeStatsByPlayerId = playerStatsByPlayerId && typeof playerStatsByPlayerId === 'object'
        ? playerStatsByPlayerId
        : {};

    return safePlayers.map((player) => {
        const playerStats = safeStatsByPlayerId[player.id] || {};

        return {
            playerId: player.id,
            data: {
                playerName: player.name,
                playerNumber: player.number,
                stats: buildNormalizedPlayerStats(playerStats, columns)
            }
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
    finalHome,
    finalAway,
    summary = '',
    opponentStats = {},
    maxPrimaryBatchWrites = STANDARD_TRACKER_MAX_PRIMARY_BATCH_WRITES,
    maxAggregatedStatsBatchWrites = STANDARD_TRACKER_MAX_AGGREGATED_STATS_BATCH_WRITES
} = {}) {
    const safeGameLog = Array.isArray(gameLog) ? gameLog : [];
    const primaryBatchWriteCount = safeGameLog.length + 1;

    if (primaryBatchWriteCount > maxPrimaryBatchWrites) {
        throw buildFinishBatchLimitError(safeGameLog.length, maxPrimaryBatchWrites);
    }

    const primaryBatch = writeBatch(db);
    const aggregatedStatsWrites = buildAggregatedStatsWrites({
        players,
        playerStatsByPlayerId,
        columns
    });

    safeGameLog.forEach((entry) => {
        const eventRef = doc(collection(db, `teams/${teamId}/games/${gameId}/events`));
        primaryBatch.set(eventRef, {
            text: entry.text,
            gameTime: entry.time,
            period: entry.period,
            timestamp: entry.timestamp || Date.now(),
            type: entry.undoData?.type || 'game_log',
            playerId: entry.undoData?.playerId || null,
            statKey: entry.undoData?.statKey || null,
            value: entry.undoData?.value || null,
            isOpponent: entry.undoData?.isOpponent || false,
            createdBy: currentUserUid
        });
    });

    const gameRef = doc(db, `teams/${teamId}/games`, gameId);
    primaryBatch.update(gameRef, {
        homeScore: finalHome,
        awayScore: finalAway,
        summary,
        status: 'completed',
        opponentStats
    });

    await primaryBatch.commit();

    const aggregatedStatsBatchSizes = [];
    for (let i = 0; i < aggregatedStatsWrites.length; i += maxAggregatedStatsBatchWrites) {
        const statsBatch = writeBatch(db);
        const statsChunk = aggregatedStatsWrites.slice(i, i + maxAggregatedStatsBatchWrites);
        statsChunk.forEach(({ playerId, data }) => {
            const statsRef = doc(db, `teams/${teamId}/games/${gameId}/aggregatedStats`, playerId);
            statsBatch.set(statsRef, data);
        });
        aggregatedStatsBatchSizes.push(statsChunk.length);
        await statsBatch.commit();
    }

    return {
        primaryBatchWriteCount,
        aggregatedStatsBatchSizes,
        aggregatedStatsWriteCount: aggregatedStatsWrites.length
    };
}
