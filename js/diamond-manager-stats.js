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

function normalizeDisplayText(value, maxLength) {
    if (typeof value !== 'string') return '';
    const normalized = Array.from(value, (character) => {
        const codePoint = character.codePointAt(0) || 0;
        const unsafeControl = codePoint <= 31
            || (codePoint >= 127 && codePoint <= 159)
            || (codePoint >= 0x202a && codePoint <= 0x202e)
            || (codePoint >= 0x2066 && codePoint <= 0x2069);
        return unsafeControl ? ' ' : character;
    }).join('')
        .replace(/\s+/g, ' ')
        .trim();
    return Array.from(normalized).slice(0, maxLength).join('');
}

function compareExactId(left, right) {
    const leftId = normalizeId(left);
    const rightId = normalizeId(right);
    return leftId < rightId ? -1 : leftId > rightId ? 1 : 0;
}

function getSortableGameTime(value) {
    const rawDate = value?.date;
    const date = rawDate instanceof Date
        ? rawDate
        : typeof rawDate?.toDate === 'function'
            ? rawDate.toDate()
            : typeof rawDate?.seconds === 'number'
                ? new Date(rawDate.seconds * 1000)
                : new Date(rawDate || 0);
    return date instanceof Date && !Number.isNaN(date.getTime()) ? date.getTime() : 0;
}

function orderDiamondReportDocuments(documents, documentGroups) {
    if (!Array.isArray(documentGroups) || documentGroups.length === 0) {
        return [...(Array.isArray(documents) ? documents : [])]
            .sort((left, right) => compareExactId(left?.id, right?.id));
    }
    return [...documentGroups]
        .sort((left, right) => {
            const timeDifference = getSortableGameTime(left?.game) - getSortableGameTime(right?.game);
            if (timeDifference !== 0) return timeDifference;
            return compareExactId(
                left?.game?.id || left?.game?.gameId,
                right?.game?.id || right?.game?.gameId
            );
        })
        .flatMap((group) => [...(Array.isArray(group?.documents) ? group.documents : [])]
            .sort((left, right) => compareExactId(left?.id, right?.id)));
}

function stableDocumentFingerprint(value) {
    if (value === null) return 'null';
    if (Array.isArray(value)) return `[${value.map(stableDocumentFingerprint).join(',')}]`;
    if (isRecord(value)) {
        return `{${Object.keys(value).sort().map((key) => (
            `${JSON.stringify(key)}:${stableDocumentFingerprint(value[key])}`
        )).join(',')}}`;
    }
    if (typeof value === 'number' && !Number.isFinite(value)) return JSON.stringify(String(value));
    return JSON.stringify(value) || String(value);
}

export function buildDiamondReportPlayers({ rosterPlayers = [], documents = [], documentGroups = [] } = {}) {
    const rosterRows = [];
    const rosterIds = new Set();
    for (const player of Array.isArray(rosterPlayers) ? rosterPlayers : []) {
        const id = normalizeId(player?.id);
        if (!id || rosterIds.has(id)) continue;
        rosterIds.add(id);
        rosterRows.push({
            id,
            name: normalizeDisplayText(player?.name, 160) || 'Player',
            number: normalizeDisplayText(player?.number, 32) || '-',
            photoUrl: typeof player?.photoUrl === 'string' ? player.photoUrl.trim() : '',
            canOpenProfile: true
        });
    }

    const projectedIdentityById = new Map();
    for (const document of orderDiamondReportDocuments(documents, documentGroups)) {
        const id = normalizeId(document?.id);
        const data = isRecord(document?.data) ? document.data : null;
        if (!id || !data || data.playerId !== id) continue;
        const previous = projectedIdentityById.get(id) || { name: '', number: '' };
        const name = normalizeDisplayText(data.playerName, 160);
        const number = normalizeDisplayText(data.playerNumber, 32);
        projectedIdentityById.set(id, {
            name: name || previous.name,
            number: number || previous.number
        });
    }

    const rosterResult = rosterRows.map((player) => {
        const projectedIdentity = projectedIdentityById.get(player.id);
        return Object.freeze({
            ...player,
            name: projectedIdentity?.name || player.name,
            number: projectedIdentity?.number || player.number
        });
    });
    const projectedOnlyResult = [...projectedIdentityById.entries()]
        .filter(([id]) => !rosterIds.has(id))
        .sort(([leftId], [rightId]) => leftId.localeCompare(rightId))
        .map(([id, identity]) => Object.freeze({
            id,
            name: identity.name || 'Recorded player',
            number: identity.number || '-',
            photoUrl: '',
            canOpenProfile: false
        }));
    return Object.freeze([...rosterResult, ...projectedOnlyResult]);
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

async function loadCompleteDiamondManagerStatsAttempt({ teamId, games, playerIds, invoke }) {
    const documentsByGameId = new Map();
    const teamDocumentsByGameId = new Map();
    const teamEvidenceByGameId = new Map();
    const seenPlayerDocuments = new Set();
    let documentCount = 0;

    for (let gameOffset = 0; gameOffset < games.length; gameOffset += DIAMOND_MANAGER_STATS_MAX_GAMES) {
        const gameChunk = games.slice(gameOffset, gameOffset + DIAMOND_MANAGER_STATS_MAX_GAMES);
        const expectedGameIds = new Set(gameChunk.map((candidate) => normalizeId(candidate?.id || candidate?.gameId)));
        for (let playerOffset = 0; playerOffset < playerIds.length; playerOffset += DIAMOND_MANAGER_STATS_MAX_PLAYERS) {
            const playerChunk = playerIds.slice(playerOffset, playerOffset + DIAMOND_MANAGER_STATS_MAX_PLAYERS);
            const expectedPlayerIds = new Set(playerChunk);
            const chunkResult = await loadDiamondManagerStats({
                teamId,
                games: gameChunk,
                playerIds: playerChunk,
                invoke
            });
            if (chunkResult.status !== 'complete') {
                return unavailable(chunkResult.reason || 'private-read-incomplete', chunkResult.status);
            }
            if (
                !(chunkResult.documentsByGameId instanceof Map)
                || !(chunkResult.teamDocumentsByGameId instanceof Map)
                || [...chunkResult.documentsByGameId.keys()].some((gameId) => !expectedGameIds.has(gameId))
                || [...chunkResult.teamDocumentsByGameId.keys()].some((gameId) => !expectedGameIds.has(gameId))
            ) return unavailable('private-unexpected-game-document', 'partial');
            if (
                chunkResult.teamDocumentsByGameId.size !== expectedGameIds.size
                || [...expectedGameIds].some((gameId) => !chunkResult.teamDocumentsByGameId.has(gameId))
            ) return unavailable('private-team-document-missing', 'partial');

            for (const gameId of expectedGameIds) {
                const chunkDocuments = chunkResult.documentsByGameId.get(gameId) || [];
                if (!Array.isArray(chunkDocuments)) {
                    return unavailable('private-player-document-conflict', 'partial');
                }
                for (const document of chunkDocuments) {
                    const playerId = normalizeId(document?.id);
                    const key = `${gameId}:${playerId}`;
                    if (!playerId || !expectedPlayerIds.has(playerId) || seenPlayerDocuments.has(key)) {
                        return unavailable('private-player-document-conflict', 'partial');
                    }
                    seenPlayerDocuments.add(key);
                    const combinedDocuments = documentsByGameId.get(gameId) || [];
                    combinedDocuments.push(document);
                    documentsByGameId.set(gameId, combinedDocuments);
                    documentCount += 1;
                }

                const teamDocument = chunkResult.teamDocumentsByGameId.get(gameId);
                const fingerprint = stableDocumentFingerprint(teamDocument);
                if (teamEvidenceByGameId.has(gameId) && teamEvidenceByGameId.get(gameId) !== fingerprint) {
                    return unavailable('private-team-document-conflict', 'partial');
                }
                teamEvidenceByGameId.set(gameId, fingerprint);
                teamDocumentsByGameId.set(gameId, teamDocument);
            }
        }
    }

    if (teamDocumentsByGameId.size !== games.length) {
        return unavailable('private-team-document-missing', 'partial');
    }

    return Object.freeze({
        status: 'complete',
        reason: null,
        absenceConfirmed: documentCount === 0,
        documentsByGameId: new Map([...documentsByGameId.entries()].map(([gameId, documents]) => [
            gameId,
            Object.freeze(documents.sort((left, right) => left.id.localeCompare(right.id)))
        ])),
        teamDocumentsByGameId
    });
}

export async function loadCompleteDiamondManagerStats({
    teamId,
    games,
    playerIds,
    invoke,
    maxAttempts = 2
} = {}) {
    const normalizedTeamId = normalizeId(teamId);
    const normalizedPlayerIds = [...new Set((Array.isArray(playerIds) ? playerIds : [])
        .map(normalizeId)
        .filter(Boolean))].sort();
    const normalizedGames = [];
    const seenGameIds = new Set();
    for (const candidate of Array.isArray(games) ? games : []) {
        const gameHeads = buildDiamondManagerStatsGameHeads([candidate]);
        const gameId = gameHeads?.[0]?.gameId || '';
        if (!gameId || seenGameIds.has(gameId)) {
            return unavailable('invalid-or-incomplete-request', 'partial');
        }
        seenGameIds.add(gameId);
        normalizedGames.push(candidate);
    }
    if (
        !normalizedTeamId
        || !normalizedGames.length
        || !normalizedPlayerIds.length
        || typeof invoke !== 'function'
    ) return unavailable('invalid-or-incomplete-request', 'partial');

    const attemptLimit = Number.isSafeInteger(maxAttempts) && maxAttempts > 0
        ? Math.min(maxAttempts, 3)
        : 2;
    let lastResult = unavailable('private-read-unavailable');
    for (let attempt = 0; attempt < attemptLimit; attempt += 1) {
        try {
            lastResult = await loadCompleteDiamondManagerStatsAttempt({
                teamId: normalizedTeamId,
                games: normalizedGames,
                playerIds: normalizedPlayerIds,
                invoke
            });
        } catch {
            lastResult = unavailable('private-read-unavailable');
        }
        if (lastResult.status === 'complete') return lastResult;
    }
    return lastResult;
}
