import {
    getDiamondProjectionIdentity,
    isDiamondV2Game
} from './diamond-stat-presentation.js?v=7';

export const DIAMOND_MANAGER_STATS_MAX_GAMES = 40;
export const DIAMOND_MANAGER_STATS_MAX_PLAYERS = 25;
export const DIAMOND_MANAGER_STATS_MAX_RESPONSE_BYTES = 7_000_000;

function normalizeId(value) {
    const id = String(value || '').trim();
    return id && id.length <= 128 && !id.includes('/') ? id : '';
}

export function buildDiamondManagerStatsGameHeads(games = []) {
    if (!Array.isArray(games) || games.length < 1 || games.length > DIAMOND_MANAGER_STATS_MAX_GAMES) return null;
    const seen = new Set();
    const heads = [];
    for (const candidate of games) {
        if (!isDiamondV2Game(candidate)) continue;
        const gameId = normalizeId(candidate?.id || candidate?.gameId);
        const identity = getDiamondProjectionIdentity(candidate);
        if (!gameId || !identity || seen.has(gameId)) return null;
        seen.add(gameId);
        heads.push({ gameId, ...identity });
    }
    return heads.length ? heads : null;
}

function unavailable(reason, status = 'unavailable') {
    return Object.freeze({
        status,
        reason,
        absenceConfirmed: false,
        documentsByGameId: new Map(),
        teamDocumentsByGameId: new Map()
    });
}

function isRecord(value) {
    return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

export async function loadDiamondManagerStats({ teamId, games, playerIds, invoke }) {
    const normalizedTeamId = normalizeId(teamId);
    const normalizedPlayerIds = [...new Set((Array.isArray(playerIds) ? playerIds : [])
        .map(normalizeId)
        .filter(Boolean))].sort();
    const gameHeads = buildDiamondManagerStatsGameHeads(games);
    if (!normalizedTeamId || !gameHeads || !normalizedPlayerIds.length || typeof invoke !== 'function') {
        return unavailable('invalid-or-incomplete-request', 'partial');
    }
    if (normalizedPlayerIds.length > DIAMOND_MANAGER_STATS_MAX_PLAYERS) {
        return unavailable('player-bound-exceeded', 'partial');
    }

    let payload;
    try {
        const response = await invoke({
            teamId: normalizedTeamId,
            gameHeads,
            playerIds: normalizedPlayerIds
        });
        payload = response?.data && typeof response.data === 'object' ? response.data : {};
    } catch {
        return unavailable('private-read-unavailable');
    }
    const expectedDocumentCount = gameHeads.length * normalizedPlayerIds.length;
    if (
        payload.schemaVersion !== 1
        || payload.trackingEngine !== 'diamond-v2'
        || payload.visibility !== 'manager-internal'
        || payload.status !== 'complete'
        || payload.complete !== true
        || payload.truncated !== false
        || payload.requestedGameCount !== gameHeads.length
        || payload.requestedPlayerCount !== normalizedPlayerIds.length
        || payload.expectedDocumentCount !== expectedDocumentCount
        || !Array.isArray(payload.documents)
        || !Array.isArray(payload.teamDocuments)
        || payload.documentCount !== payload.documents.length
        || payload.missingDocumentCount !== expectedDocumentCount - payload.documents.length
        || payload.absenceConfirmed !== (payload.documents.length === 0)
        || payload.expectedTeamDocumentCount !== gameHeads.length
        || payload.teamDocumentCount !== payload.teamDocuments.length
        || payload.missingTeamDocumentCount !== payload.expectedTeamDocumentCount - payload.teamDocumentCount
        || payload.teamDocuments.length > gameHeads.length
        || payload.documents.length > expectedDocumentCount
        || !Number.isSafeInteger(payload.responseByteCount)
        || payload.responseByteCount < 1
        || payload.responseByteCount > DIAMOND_MANAGER_STATS_MAX_RESPONSE_BYTES
        || payload.responseByteLimit !== DIAMOND_MANAGER_STATS_MAX_RESPONSE_BYTES
    ) return unavailable('private-read-incomplete', 'partial');

    const requestedGames = new Set(gameHeads.map(({ gameId }) => gameId));
    const headByGameId = new Map(gameHeads.map((head) => [head.gameId, head]));
    const requestedPlayers = new Set(normalizedPlayerIds);
    const seen = new Set();
    const documentsByGameId = new Map();
    for (const entry of payload.documents) {
        const gameId = normalizeId(entry?.gameId);
        const playerId = normalizeId(entry?.playerId);
        const data = isRecord(entry?.data) ? entry.data : null;
        const head = headByGameId.get(gameId);
        const key = `${gameId}:${playerId}`;
        if (
            !gameId || !playerId || !data || !head
            || !requestedGames.has(gameId) || !requestedPlayers.has(playerId) || seen.has(key)
            || data.trackingEngine !== 'diamond-v2'
            || data.teamId !== normalizedTeamId
            || data.diamondGameId !== gameId
            || data.playerId !== playerId
            || data.authoritative !== true
            || data.complete !== true
            || data.projectionSchemaVersion !== 1
            || !['home', 'away'].includes(data.side)
            || data.instanceId !== head.instanceId
            || data.diamondScorebookInstanceId !== head.instanceId
            || data.projectionGeneration !== head.instanceId
            || data.sourceRevision !== head.sourceRevision
            || data.checkpointHash !== head.checkpointHash
            || data.statConfigSnapshotHash !== head.statConfigSnapshotHash
            || data.projectionHash !== head.projectionHash
            || !isRecord(data.stats)
            || !isRecord(data.observedStats)
            || !isRecord(data.derivedStats)
            || !isRecord(data.observedDerivedStats)
            || !isRecord(data.statCoverage)
            || !isRecord(data.coverage)
        ) {
            return unavailable('private-response-mismatch', 'partial');
        }
        seen.add(key);
        const documents = documentsByGameId.get(gameId) || [];
        documents.push({ id: playerId, data });
        documentsByGameId.set(gameId, documents);
    }
    const teamDocumentsByGameId = new Map();
    for (const entry of payload.teamDocuments) {
        const gameId = normalizeId(entry?.gameId);
        const data = isRecord(entry?.data) ? entry.data : null;
        const head = headByGameId.get(gameId);
        if (
            !gameId || !data || !head || !requestedGames.has(gameId) || teamDocumentsByGameId.has(gameId)
            || data.trackingEngine !== 'diamond-v2'
            || data.teamId !== normalizedTeamId
            || data.diamondGameId !== gameId
            || data.complete !== true
            || data.projectionSchemaVersion !== 1
            || !['home', 'away'].includes(data.side)
            || data.instanceId !== head.instanceId
            || data.diamondScorebookInstanceId !== head.instanceId
            || data.projectionGeneration !== head.instanceId
            || data.sourceRevision !== head.sourceRevision
            || data.checkpointHash !== head.checkpointHash
            || data.statConfigSnapshotHash !== head.statConfigSnapshotHash
            || data.projectionHash !== head.projectionHash
            || !isRecord(data.stats)
            || !isRecord(data.observedStats)
            || !isRecord(data.statCoverage)
            || !isRecord(data.coverage)
            || !isRecord(data.inningLines)
        ) return unavailable('private-team-response-mismatch', 'partial');
        teamDocumentsByGameId.set(gameId, data);
    }
    return Object.freeze({
        status: 'complete',
        reason: null,
        absenceConfirmed: payload.absenceConfirmed,
        documentsByGameId: new Map([...documentsByGameId.entries()].map(([gameId, documents]) => [
            gameId,
            Object.freeze(documents.sort((left, right) => left.id.localeCompare(right.id)))
        ])),
        teamDocumentsByGameId
    });
}
