import { functions, httpsCallable } from './adapters/legacyDiamondScorebookFirebase';
import { getDiamondProjectionIdentity, isDiamondV2Game } from './adapters/legacyDiamondStatPresentation';

export const DIAMOND_MANAGER_STATS_MAX_GAMES = 40;
export const DIAMOND_MANAGER_STATS_MAX_PLAYERS = 25;
export const DIAMOND_MANAGER_STATS_MAX_RESPONSE_BYTES = 7_000_000;

export type DiamondManagerStatsGameHead = {
  gameId: string;
  instanceId: string;
  sourceRevision: number;
  checkpointHash: string;
  statConfigSnapshotHash: string;
  projectionHash: string;
};

export type DiamondManagerStatsReadResult = {
  status: 'complete' | 'partial' | 'unavailable';
  reason: string | null;
  documentsByGameId: ReadonlyMap<string, ReadonlyArray<{ id: string; data: Record<string, unknown> }>>;
  teamDocumentsByGameId: ReadonlyMap<string, Record<string, unknown>>;
};

function normalizeId(value: unknown) {
  const id = String(value || '').trim();
  return id && id.length <= 128 && !id.includes('/') ? id : '';
}

function isRecord(value: unknown): value is Record<string, any> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

export function buildDiamondManagerStatsGameHeads(games: unknown[]): DiamondManagerStatsGameHead[] | null {
  const normalizedGames = Array.isArray(games) ? games : [];
  if (!normalizedGames.length || normalizedGames.length > DIAMOND_MANAGER_STATS_MAX_GAMES) return null;
  const seen = new Set<string>();
  const heads: DiamondManagerStatsGameHead[] = [];
  for (const candidate of normalizedGames) {
    if (!isDiamondV2Game(candidate)) continue;
    const game = candidate as Record<string, unknown>;
    const gameId = normalizeId(game.id || game.gameId);
    const identity = getDiamondProjectionIdentity(game);
    if (!gameId || !identity || seen.has(gameId)) return null;
    seen.add(gameId);
    heads.push({ gameId, ...identity });
  }
  return heads.length ? heads : null;
}

function unavailable(reason: string, status: 'partial' | 'unavailable' = 'unavailable'): DiamondManagerStatsReadResult {
  return { status, reason, documentsByGameId: new Map(), teamDocumentsByGameId: new Map() };
}

export async function loadDiamondManagerStats({
  teamId,
  games,
  playerIds
}: {
  teamId: string;
  games: unknown[];
  playerIds: string[];
}): Promise<DiamondManagerStatsReadResult> {
  const normalizedTeamId = normalizeId(teamId);
  const normalizedPlayerIds = [...new Set((Array.isArray(playerIds) ? playerIds : []).map(normalizeId).filter(Boolean))].sort();
  const gameHeads = buildDiamondManagerStatsGameHeads(games);
  if (!normalizedTeamId || !gameHeads || !normalizedPlayerIds.length) return unavailable('invalid-or-incomplete-request', 'partial');
  if (normalizedPlayerIds.length > DIAMOND_MANAGER_STATS_MAX_PLAYERS) return unavailable('player-bound-exceeded', 'partial');

  let payload: Record<string, any>;
  try {
    const callable = httpsCallable(functions, 'getDiamondManagerStats');
    const response = await callable({ teamId: normalizedTeamId, gameHeads, playerIds: normalizedPlayerIds });
    payload = response?.data && typeof response.data === 'object' ? response.data as Record<string, any> : {};
  } catch {
    return unavailable('private-read-unavailable');
  }
  if (
    payload.schemaVersion !== 1
    || payload.trackingEngine !== 'diamond-v2'
    || payload.visibility !== 'manager-internal'
    || payload.status !== 'complete'
    || payload.complete !== true
    || payload.truncated !== false
    || !Array.isArray(payload.documents)
    || !Array.isArray(payload.teamDocuments)
    || payload.documents.length > gameHeads.length * normalizedPlayerIds.length
    || payload.teamDocuments.length > gameHeads.length
    || payload.requestedGameCount !== gameHeads.length
    || payload.requestedPlayerCount !== normalizedPlayerIds.length
    || payload.expectedDocumentCount !== gameHeads.length * normalizedPlayerIds.length
    || payload.documentCount !== payload.documents.length
    || payload.missingDocumentCount !== payload.expectedDocumentCount - payload.documentCount
    || payload.absenceConfirmed !== (payload.documentCount === 0)
    || payload.expectedTeamDocumentCount !== gameHeads.length
    || payload.teamDocumentCount !== payload.teamDocuments.length
    || payload.missingTeamDocumentCount !== payload.expectedTeamDocumentCount - payload.teamDocumentCount
    || !Number.isSafeInteger(payload.responseByteCount)
    || payload.responseByteCount < 1
    || payload.responseByteCount > DIAMOND_MANAGER_STATS_MAX_RESPONSE_BYTES
    || payload.responseByteLimit !== DIAMOND_MANAGER_STATS_MAX_RESPONSE_BYTES
  ) return unavailable('private-read-incomplete', 'partial');

  const requestedGames = new Set(gameHeads.map(({ gameId }) => gameId));
  const headByGameId = new Map(gameHeads.map((head) => [head.gameId, head]));
  const requestedPlayers = new Set(normalizedPlayerIds);
  const seen = new Set<string>();
  const mutableByGame = new Map<string, Array<{ id: string; data: Record<string, unknown> }>>();
  for (const entry of payload.documents) {
    const gameId = normalizeId(entry?.gameId);
    const playerId = normalizeId(entry?.playerId);
    const data = isRecord(entry?.data) ? entry.data as Record<string, any> : null;
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
    const documents = mutableByGame.get(gameId) || [];
    documents.push({ id: playerId, data });
    mutableByGame.set(gameId, documents);
  }
  const teamDocumentsByGameId = new Map<string, Record<string, unknown>>();
  for (const entry of payload.teamDocuments) {
    const gameId = normalizeId(entry?.gameId);
    const data = isRecord(entry?.data) ? entry.data as Record<string, any> : null;
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
  return {
    status: 'complete',
    reason: null,
    documentsByGameId: new Map([...mutableByGame.entries()].map(([gameId, documents]) => [
      gameId,
      Object.freeze(documents.sort((left, right) => left.id.localeCompare(right.id)))
    ])),
    teamDocumentsByGameId
  };
}
