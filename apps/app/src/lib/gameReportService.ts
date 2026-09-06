import {
  buildHighlightShareUrl,
  collection,
  db,
  generateGameInsights,
  getConfigs,
  getDocs,
  getGame,
  getGameEvents,
  getPlayers,
  getTeam,
  getTeamStatsForGame,
  hasPlayerProfileParticipation,
  normalizeGameRecapHighlightClips,
  resolveLiveStatConfig,
  resolveOpponentReportStatColumns,
  resolvePostGameTeamStatFields,
  resolveReportStatColumns
} from './adapters/legacyGameReport';
import {
  mapGameReportAggregatedStatsRecord,
  mapGameReportEventRecords,
  mapGameReportGameRecord,
  mapGameReportPlayerRecords,
  mapGameReportTeamRecord,
  mapGameReportTeamStatsRecord
} from './firestore/mappers';
import type {
  GameReportGameFirestoreRecord,
  GameReportEventFirestoreRecord,
  GameReportPlayerFirestoreRecord,
  GameReportStatsRecord,
  GameReportTeamFirestoreRecord,
  GameReportTeamStatsFirestoreRecord
} from './firestore/types';
import {
  DIAMOND_TEAM_STAT_CATALOG,
  getManagerDiamondStatCatalog,
  getDiamondPublicPlayerStatsCollectionPath,
  getPublicDiamondStatCatalog,
  isDiamondV2Game,
  readCoverageAwareOpponentStats,
  readCoverageAwareStatDocument,
  resolveDiamondManagerStatDocuments,
  resolveDiamondManagerTeamStatDocument,
  resolveDiamondPublicTeamStatDocument,
  resolveDiamondProjectionState,
  resolveDiamondPublicStatDocuments,
  type CoverageAwareStatPresentation
} from './adapters/legacyDiamondStatPresentation';
import { loadDiamondManagerStats } from './diamondManagerStatsService';

export type GameReportInsight = {
  title: string;
  body: string;
  tone?: 'positive' | 'warning' | 'neutral' | string;
};

export type GameReportPlayerRow = {
  playerId: string;
  playerName: string;
  number: string;
  photoUrl?: string;
  stats: GameReportStatsRecord;
  timeMs: number;
  didNotPlay: boolean;
  participated: boolean;
  participationStatus: string;
  participationSource: string;
  statPresentation?: CoverageAwareStatPresentation;
};

export type GameReportOpponentRow = {
  id: string;
  name: string;
  number: string;
  photoUrl?: string;
  stats: GameReportStatsRecord;
  statPresentation?: CoverageAwareStatPresentation;
};

export type GameReportPlay = {
  id: string;
  text: string;
  period: string;
  clock: string;
  timestamp: Date | null;
};

export type GameReportPlaysRefresh = {
  game: GameReportGameFirestoreRecord;
  plays: GameReportPlay[];
  playsFresh: boolean;
};

export type GameReportHighlightClip = {
  title: string;
  description: string;
  period: string;
  gameTime: string;
  startMs: number | null;
  endMs: number | null;
  url: string;
};

export type GameReportAiCitation = {
  eventId: string;
  revision: number;
};

export type GameReportAiBlock = {
  text: string;
  citations: GameReportAiCitation[];
};

export type GameReportPublishedAiRecap = {
  current: boolean;
  sourceRevision: number;
  publishedAt: string;
  recap: GameReportAiBlock;
  insights: GameReportAiBlock[];
  coverage: Record<string, 'complete' | 'partial' | 'not_collected'>;
  dataQualityNotes: string[];
};

export type GameReportData = {
  team: GameReportTeamFirestoreRecord;
  game: GameReportGameFirestoreRecord;
  summary: string;
  statKeys: string[];
  statLabels: Record<string, string>;
  statDefinitions?: Record<string, Record<string, unknown>>;
  hasPlayingTime: boolean;
  playerRows: GameReportPlayerRow[];
  visiblePlayerRows: GameReportPlayerRow[];
  deferredPlayerRows: GameReportPlayerRow[];
  opponentStatKeys: string[];
  opponentStatLabels: Record<string, string>;
  opponentStatDefinitions?: Record<string, Record<string, unknown>>;
  opponentRows: GameReportOpponentRow[];
  teamStatKeys: string[];
  teamStatLabels: Record<string, string>;
  teamStats: GameReportTeamStatsFirestoreRecord;
  teamStatDefinitions?: Record<string, Record<string, unknown>>;
  teamStatPresentation?: CoverageAwareStatPresentation;
  diamond?: {
    isDiamond: boolean;
    readOnly: boolean;
    status: string;
    pending: boolean;
    authoritativeRevision: number | null;
    sourceRevisions: readonly number[];
    requestedStatVisibility: 'public' | 'manager-internal';
    statVisibility: 'public' | 'manager-internal';
    privateStatsStatus: 'not-requested' | 'complete' | 'partial' | 'unavailable';
    privateStatsReason?: string | null;
  };
  statSheetPhotoUrl: string;
  highlightClips: GameReportHighlightClip[];
  plays: GameReportPlay[];
  teamInsights: GameReportInsight[];
  playerInsightRows: Array<{
    playerId: string;
    playerName: string;
    insights: GameReportInsight[];
  }>;
  emptyInsightsMessage: string;
  publishedAiRecap: GameReportPublishedAiRecap | null;
};

type AggregatedStatsResult = {
  statsMap: Record<string, GameReportStatsRecord>;
  timeMap: Record<string, number>;
  didNotPlayMap: Record<string, boolean>;
  participatedMap: Record<string, boolean>;
  participationStatusMap: Record<string, string>;
  participationSourceMap: Record<string, string>;
  recordedPlayerIds: Set<string>;
  presentationMap: Record<string, CoverageAwareStatPresentation>;
  completeStatsMap: Record<string, GameReportStatsRecord>;
  sourceRevisions: number[];
  documentCount: number;
  rawDocuments: Array<{ id: string; data: Record<string, unknown> }>;
};

export type GameReportLoadOptions = {
  statVisibility?: 'public' | 'manager-internal';
};

function toNumber(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeDate(value: any): Date | null {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value.toDate === 'function') {
    const date = value.toDate();
    return Number.isNaN(date.getTime()) ? null : date;
  }
  if (typeof value.seconds === 'number') {
    const date = new Date(value.seconds * 1000);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function asRecord(value: unknown): Record<string, any> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {};
}

function normalizePublishedAiBlock(value: unknown): GameReportAiBlock | null {
  const source = asRecord(value);
  const text = String(source.text || '').trim().slice(0, 2_400);
  if (!text) return null;
  const seen = new Set<string>();
  const citations = (Array.isArray(source.citations) ? source.citations : []).flatMap((entry): GameReportAiCitation[] => {
    const citation = asRecord(entry);
    const eventId = String(citation.eventId || '').trim();
    const revision = Number(citation.revision);
    const key = `${eventId}:${revision}`;
    if (!eventId || eventId.length > 128 || eventId.includes('/') || !Number.isSafeInteger(revision) || revision < 1 || seen.has(key)) return [];
    seen.add(key);
    return [{ eventId, revision }];
  }).slice(0, 30);
  return citations.length ? { text, citations } : null;
}

export function normalizePublishedDiamondAiRecap(value: unknown): GameReportPublishedAiRecap | null {
  const source = asRecord(value);
  const recap = normalizePublishedAiBlock(source.recap);
  const sourceRevision = Number(source.sourceRevision);
  if (
    source.schemaVersion !== 1 ||
    source.trackingEngine !== 'diamond-v2' ||
    source.published !== true ||
    !recap ||
    !Number.isSafeInteger(sourceRevision) ||
    sourceRevision < 1
  ) return null;
  const insights = (Array.isArray(source.insights) ? source.insights : [])
    .map(normalizePublishedAiBlock)
    .filter((block): block is GameReportAiBlock => Boolean(block))
    .slice(0, 10);
  const coverage = Object.entries(asRecord(source.coverage)).reduce<GameReportPublishedAiRecap['coverage']>((result, [family, status]) => {
    if (status === 'complete' || status === 'partial' || status === 'not_collected') result[String(family).slice(0, 40)] = status;
    return result;
  }, {});
  return {
    current: source.status === 'current' && source.stale !== true,
    sourceRevision,
    publishedAt: String(source.publishedAt || '').trim().slice(0, 40),
    recap,
    insights,
    coverage,
    dataQualityNotes: (Array.isArray(source.dataQualityNotes) ? source.dataQualityNotes : [])
      .map((note) => String(note || '').trim().slice(0, 300))
      .filter(Boolean)
      .slice(0, 20)
  };
}

function getRawOpponentStats(value: unknown): GameReportGameFirestoreRecord['opponentStats'] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const opponentStats = (value as Record<string, unknown>).opponentStats;
  return opponentStats && typeof opponentStats === 'object' && !Array.isArray(opponentStats)
    ? opponentStats as GameReportGameFirestoreRecord['opponentStats']
    : {};
}

const legacyStatPresentation: CoverageAwareStatPresentation = Object.freeze({
  isDiamond: false,
  statCoverage: {},
  observedStatKeys: [],
  unavailableStatKeys: []
});

function emptyAggregatedStatsResult(): AggregatedStatsResult {
  return {
    statsMap: {},
    timeMap: {},
    didNotPlayMap: {},
    participatedMap: {},
    participationStatusMap: {},
    participationSourceMap: {},
    recordedPlayerIds: new Set<string>(),
    presentationMap: {},
    completeStatsMap: {},
    sourceRevisions: [],
    documentCount: 0,
    rawDocuments: []
  };
}

function filterStatsMapByIds(
  statsByPlayerId: Record<string, GameReportStatsRecord>,
  allowedIds: ReadonlySet<string>
) {
  return Object.fromEntries(Object.entries(statsByPlayerId || {}).map(([playerId, stats]) => [
    playerId,
    Object.fromEntries(Object.entries(stats || {}).filter(([key]) => allowedIds.has(key)))
  ]));
}

function mapStatsDocuments(
  documents: Array<{ id: string; data: Record<string, unknown> }>,
  game: GameReportGameFirestoreRecord,
  statVisibility: 'public' | 'manager-internal'
): AggregatedStatsResult {
  const statsMap: Record<string, GameReportStatsRecord> = {};
  const timeMap: Record<string, number> = {};
  const didNotPlayMap: Record<string, boolean> = {};
  const participatedMap: Record<string, boolean> = {};
  const participationStatusMap: Record<string, string> = {};
  const participationSourceMap: Record<string, string> = {};
  const recordedPlayerIds = new Set<string>();
  const presentationMap: Record<string, CoverageAwareStatPresentation> = {};
  const completeStatsMap: Record<string, GameReportStatsRecord> = {};
  const sourceRevisions: number[] = [];
  let documentCount = 0;

  documents.forEach(({ id, data: rawData }) => {
    const playerId = String(id || '');
    const data = mapGameReportAggregatedStatsRecord(playerId, rawData);
    const presentation = readCoverageAwareStatDocument(rawData, game);
    documentCount += 1;
    recordedPlayerIds.add(playerId);
    statsMap[playerId] = (presentation.isDiamond ? presentation.values : data.stats) as GameReportStatsRecord;
    completeStatsMap[playerId] = (presentation.isDiamond ? presentation.completeValues : data.stats) as GameReportStatsRecord;
    presentationMap[playerId] = { ...presentation, statVisibility };
    if (presentation.sourceRevision !== null) sourceRevisions.push(presentation.sourceRevision);
    timeMap[playerId] = data.timeMs;
    didNotPlayMap[playerId] = data.didNotPlay;
    participatedMap[playerId] = data.participated;
    participationStatusMap[playerId] = data.participationStatus;
    participationSourceMap[playerId] = data.participationSource;
  });

  return { statsMap, timeMap, didNotPlayMap, participatedMap, participationStatusMap, participationSourceMap, recordedPlayerIds, presentationMap, completeStatsMap, sourceRevisions, documentCount, rawDocuments: documents };
}

async function loadStatsDocuments(teamId: string, gameId: string, collectionName: 'aggregatedStats') {
  const snapshot = await getDocs(collection(db, `teams/${teamId}/games/${gameId}/${collectionName}`));
  const documents: Array<{ id: string; data: Record<string, unknown> }> = [];
  snapshot.forEach((docSnap: any) => {
    const id = String(docSnap.id || '').trim();
    if (id) documents.push({ id, data: asRecord(docSnap.data()) });
  });
  return documents;
}

async function loadAggregatedStats(teamId: string, gameId: string, game: GameReportGameFirestoreRecord): Promise<AggregatedStatsResult> {
  if (!isDiamondV2Game(game)) {
    const documents = await loadStatsDocuments(teamId, gameId, 'aggregatedStats');
    return mapStatsDocuments(documents, game, 'public');
  }
  const collectionPath = getDiamondPublicPlayerStatsCollectionPath({ teamId, gameId, game });
  if (!collectionPath) throw new Error('The Diamond public stat head is unavailable.');
  const snapshot = await getDocs(collection(db, collectionPath));
  const documents: Array<{ id: string; data: Record<string, unknown> }> = [];
  snapshot.forEach((docSnap: any) => {
    const id = String(docSnap.id || '').trim();
    if (id) documents.push({ id, data: asRecord(docSnap.data()) });
  });
  const resolution = resolveDiamondPublicStatDocuments({
    teamId,
    gameId,
    game,
    documents,
    loadStatus: 'complete'
  });
  if (resolution.status !== 'complete') {
    throw new Error('The Diamond public stat projection is incomplete.');
  }
  return mapStatsDocuments([...resolution.documents], game, 'public');
}

async function loadManagerPrivateStats(
  teamId: string,
  gameId: string,
  game: GameReportGameFirestoreRecord,
  publicResult: AggregatedStatsResult
) {
  const managerBatch = await loadDiamondManagerStats({
    teamId,
    games: [{ ...game, id: gameId }],
    playerIds: [...publicResult.recordedPlayerIds]
  });
  const resolution = resolveDiamondManagerStatDocuments({
    game,
    expectedPlayerIds: [...publicResult.recordedPlayerIds],
    privateDocuments: [...(managerBatch.documentsByGameId.get(gameId) || [])],
    loadStatus: managerBatch.status
  });
  return {
    managerBatch,
    resolution,
    result: resolution.status === 'complete'
      ? mapStatsDocuments([...resolution.documents], game, 'manager-internal')
      : publicResult
  };
}

async function loadTeamStatView(
  teamId: string,
  gameId: string,
  game: GameReportGameFirestoreRecord,
  statVisibility: 'public' | 'manager-internal',
  managerBatch: Awaited<ReturnType<typeof loadDiamondManagerStats>> | null,
  publicTeamStatIds: string[] = []
): Promise<{ stats: GameReportTeamStatsFirestoreRecord; presentation: CoverageAwareStatPresentation; sourceRevision: number | null; complete: boolean }> {
  if (!isDiamondV2Game(game)) {
    const stats = mapGameReportTeamStatsRecord(await getTeamStatsForGame(teamId, gameId).catch(() => ({})));
    return { stats, presentation: legacyStatPresentation, sourceRevision: null, complete: true };
  }

  if (statVisibility !== 'manager-internal') {
    const resolution = resolveDiamondPublicTeamStatDocument({ game, allowedStatIds: publicTeamStatIds });
    if (resolution.status !== 'complete' || !resolution.document) {
      return {
        stats: {},
        presentation: {
          ...legacyStatPresentation,
          isDiamond: true,
          projectionPending: true,
          statVisibility: 'public'
        },
        sourceRevision: null,
        complete: false
      };
    }
    const view = readCoverageAwareStatDocument(resolution.document, game);
    return {
      stats: view.values as GameReportTeamStatsFirestoreRecord,
      presentation: { ...view, statVisibility: 'public' },
      sourceRevision: view.sourceRevision,
      complete: !view.projection.pending
    };
  }
  try {
    const rawDocument = managerBatch?.teamDocumentsByGameId.get(gameId) || null;
    const resolution = resolveDiamondManagerTeamStatDocument({
      game,
      privateDocument: rawDocument,
      loadStatus: managerBatch?.status || 'partial'
    });
    if (resolution.status !== 'complete' || !resolution.document) {
      return {
        stats: {},
        presentation: { ...legacyStatPresentation, isDiamond: true, statVisibility: 'manager-internal' },
        sourceRevision: null,
        complete: false
      };
    }
    const view = readCoverageAwareStatDocument(resolution.document, game);
    return {
      stats: view.values as GameReportTeamStatsFirestoreRecord,
      presentation: { ...view, statVisibility: 'manager-internal' },
      sourceRevision: view.sourceRevision,
      complete: !view.projection.pending
    };
  } catch {
    // teamStats is manager-only on some legacy access paths. Player projection
    // integrity is reported independently; lack of team-stat access is not zero.
    return { stats: {}, presentation: { ...legacyStatPresentation, isDiamond: true }, sourceRevision: null, complete: false };
  }
}

function normalizePlay(entry: GameReportEventFirestoreRecord): GameReportPlay {
  return {
    id: String(entry?.id || ''),
    text: String(entry?.text || 'Event logged'),
    period: String(entry?.period || 'Q1'),
    clock: String(entry?.clock || ''),
    timestamp: normalizeDate(entry?.timestamp)
  };
}

export async function loadGameReportPlays(teamId: string, gameId: string): Promise<GameReportPlaysRefresh> {
  if (!teamId || !gameId) {
    throw new Error('Team and game are required.');
  }

  const [rawGame, eventsRefresh] = await Promise.all([
    getGame(teamId, gameId),
    getGameEvents(teamId, gameId, { limit: 100 })
      .then((rawEvents) => ({ rawEvents, playsFresh: true }))
      .catch(() => ({ rawEvents: [], playsFresh: false }))
  ]);
  return {
    game: mapGameReportGameRecord(rawGame, gameId),
    plays: mapGameReportEventRecords(eventsRefresh.rawEvents)
      .sort((a, b) => (normalizeDate(a.timestamp)?.getTime() || 0) - (normalizeDate(b.timestamp)?.getTime() || 0))
      .map(normalizePlay),
    playsFresh: eventsRefresh.playsFresh
  };
}

function normalizeOpponentRows(opponentStats: GameReportGameFirestoreRecord['opponentStats'] = {}, game: GameReportGameFirestoreRecord): GameReportOpponentRow[] {
  return Object.entries(opponentStats || {}).map(([id, rawStats]) => {
    const { name, number, notes, playerId, photoUrl, ...stats } = rawStats || {};
    void notes;
    void playerId;
    const presentation = readCoverageAwareOpponentStats(rawStats, game);
    return {
      id,
      name: String(name || 'Opponent Player'),
      number: String(number || '-'),
      photoUrl: photoUrl ? String(photoUrl) : undefined,
      stats: (presentation.isDiamond ? presentation.values : mapGameReportTeamStatsRecord(stats)) as GameReportStatsRecord,
      ...(presentation.isDiamond ? { statPresentation: presentation } : {})
    };
  });
}

function normalizeOpponentStatsForColumns(opponentStats: GameReportGameFirestoreRecord['opponentStats'] = {}, game: GameReportGameFirestoreRecord): Record<string, GameReportStatsRecord> {
  return Object.entries(opponentStats || {}).reduce<Record<string, GameReportStatsRecord>>((acc, [id, rawStats]) => {
    const { name, number, notes, playerId, photoUrl, ...stats } = rawStats || {};
    void name;
    void number;
    void notes;
    void playerId;
    void photoUrl;
    const presentation = readCoverageAwareOpponentStats(rawStats, game);
    acc[id] = (presentation.isDiamond ? presentation.values : mapGameReportTeamStatsRecord(stats)) as GameReportStatsRecord;
    return acc;
  }, {});
}

function normalizeHighlightClips(teamId: string, gameId: string, game: GameReportGameFirestoreRecord): GameReportHighlightClip[] {
  return (normalizeGameRecapHighlightClips(game) || []).slice(0, 8).map((clip: any) => {
    const startMs = Number.isFinite(Number(clip.startMs)) ? Number(clip.startMs) : null;
    const endMs = Number.isFinite(Number(clip.endMs)) ? Number(clip.endMs) : null;
    const fallbackUrl = startMs !== null && endMs !== null
      ? buildHighlightShareUrl({
          origin: 'https://share.allplays.ai',
          pathname: '/watch',
          teamId,
          gameId,
          startMs,
          endMs
        })
      : '';
    return {
      title: String(clip.title || 'Highlight'),
      description: String(clip.description || clip.title || 'Highlight'),
      period: String(clip.period || ''),
      gameTime: String(clip.gameTime || ''),
      startMs,
      endMs,
      url: String(clip.videoUrl || fallbackUrl || '')
    };
  }).filter((clip: GameReportHighlightClip) => clip.url);
}

export async function loadGameReportSections(
  teamId: string,
  gameId: string,
  options: GameReportLoadOptions = {}
): Promise<GameReportData> {
  if (!teamId || !gameId) {
    throw new Error('Team and game are required.');
  }

  const [rawTeam, rawGame, rawPlayers] = await Promise.all([
    getTeam(teamId, { includeInactive: true }),
    getGame(teamId, gameId),
    getPlayers(teamId, { includeInactive: true })
  ]);

  const team = mapGameReportTeamRecord(rawTeam, teamId);
  const game = mapGameReportGameRecord(rawGame, gameId);
  const players = mapGameReportPlayerRecords(rawPlayers);

  if (!rawGame) {
    throw new Error('Game not found.');
  }

  const diamondGame = isDiamondV2Game(game);
  const requestedStatVisibility = options.statVisibility === 'manager-internal' ? 'manager-internal' : 'public';
  const [configs, publicAggregateResult, rawEvents] = await Promise.all([
    getConfigs(teamId).catch(() => []),
    diamondGame
      ? loadAggregatedStats(teamId, gameId, game)
      : loadAggregatedStats(teamId, gameId, game).catch(emptyAggregatedStatsResult),
    getGameEvents(teamId, gameId, { limit: 100 }).catch(() => [])
  ]);
  const managerLoad = diamondGame && requestedStatVisibility === 'manager-internal'
    ? await loadManagerPrivateStats(teamId, gameId, game, publicAggregateResult)
    : null;
  const aggregateResult = managerLoad?.result || publicAggregateResult;
  const appliedStatVisibility = managerLoad?.resolution.status === 'complete' ? 'manager-internal' : 'public';
  const resolvedConfig = resolveLiveStatConfig({
    configs,
    game,
    team
  });
  const publicTeamStatIds = getPublicDiamondStatCatalog(resolvedConfig, 'team')
    .map((definition) => String(definition.id || '').trim())
    .filter(Boolean);
  const teamStatView = await loadTeamStatView(
    teamId,
    gameId,
    game,
    appliedStatVisibility,
    managerLoad?.managerBatch || null,
    publicTeamStatIds
  );
  const teamStats = teamStatView.stats;
  const {
    statsMap,
    timeMap,
    didNotPlayMap,
    participatedMap,
    participationStatusMap,
    participationSourceMap,
    recordedPlayerIds,
    presentationMap,
    completeStatsMap,
    sourceRevisions,
    documentCount
  } = aggregateResult;
  const managerPlayerCatalog = diamondGame && appliedStatVisibility === 'manager-internal'
    ? getManagerDiamondStatCatalog(resolvedConfig, 'player')
    : null;
  const resolvedColumns = managerPlayerCatalog
    ? {
        statKeys: managerPlayerCatalog.map((definition) => definition.id),
        statLabels: Object.fromEntries(managerPlayerCatalog.map((definition) => [definition.id, definition.label])),
        statDefinitions: Object.fromEntries(managerPlayerCatalog.map((definition) => [definition.id, definition]))
      }
    : resolveReportStatColumns({ statsMap, resolvedConfig, trackingEngine: game.trackingEngine });
  const { statKeys, statLabels, statDefinitions = {} } = resolvedColumns;
  const publicStatKeySet = new Set<string>((statKeys || []).map((key: unknown) => String(key)));
  const publicStatsMap = diamondGame ? filterStatsMapByIds(statsMap, publicStatKeySet) : statsMap;
  const publicCompleteStatsMap = diamondGame ? filterStatsMapByIds(completeStatsMap, publicStatKeySet) : completeStatsMap;
  const opponentStats = diamondGame ? getRawOpponentStats(rawGame) : (game.opponentStats || {});
  const { oppKeys, oppLabels, oppDefinitions = {} } = resolveOpponentReportStatColumns({
    opponentStats: normalizeOpponentStatsForColumns(opponentStats, game),
    resolvedConfig,
    trackingEngine: game.trackingEngine
  });
  const visibleDiamondTeamStatCatalog = diamondGame
    ? (appliedStatVisibility === 'manager-internal'
        ? getManagerDiamondStatCatalog(resolvedConfig, 'team')
        : getPublicDiamondStatCatalog(resolvedConfig, 'team'))
    : DIAMOND_TEAM_STAT_CATALOG;
  const teamStatFields = diamondGame
    ? visibleDiamondTeamStatCatalog.map((definition) => ({ fieldName: definition.id, label: definition.label }))
    : resolvePostGameTeamStatFields({ resolvedConfig, teamStats });
  const teamStatKeys = teamStatFields.map((field: any) => String(field.fieldName || '').trim()).filter(Boolean);
  const teamStatLabels = Object.fromEntries(teamStatFields.map((field: any) => [
    String(field.fieldName || '').trim(),
    String(field.label || field.fieldName || '').trim()
  ]));
  const insightEvents = mapGameReportEventRecords(rawEvents)
    .sort((a, b) => (normalizeDate(a.timestamp)?.getTime() || 0) - (normalizeDate(b.timestamp)?.getTime() || 0));
  const plays = insightEvents.map(normalizePlay);
  const insightStatsMap = diamondGame ? publicCompleteStatsMap : statsMap;
  const insights = generateGameInsights({
    team,
    game,
    players,
    statsMap: insightStatsMap,
    timeMap,
    events: insightEvents
  });

  const safePlayers: GameReportPlayerFirestoreRecord[] = Array.isArray(players) ? players : [];
  const playerRows = safePlayers.map((player: any) => ({
    playerId: String(player.id || ''),
    playerName: String(player.name || 'Player'),
    number: String(player.number || '-'),
    photoUrl: player.photoUrl ? String(player.photoUrl) : undefined,
    stats: publicStatsMap[player.id] || {},
    timeMs: timeMap[player.id] || 0,
    didNotPlay: didNotPlayMap[player.id] === true,
    participated: participatedMap[player.id] === true,
    participationStatus: participationStatusMap[player.id] || '',
    participationSource: participationSourceMap[player.id] || '',
    ...(diamondGame ? {
      statPresentation: presentationMap[player.id] || { ...legacyStatPresentation, isDiamond: true }
    } : {})
  }));
  const visiblePlayerRows = playerRows.filter((player) => (
    hasPlayerProfileParticipation(player)
    || player.didNotPlay
    || recordedPlayerIds.has(player.playerId)
  ));
  const deferredPlayerRows = playerRows.filter((player) => !visiblePlayerRows.includes(player));
  const playerLookup = new Map(playerRows.map((player) => [player.playerId, player]));
  const playerInsightRows = Object.entries(insights.playerInsightsById || {}).map(([playerId, playerInsights]) => ({
    playerId,
    playerName: playerLookup.get(playerId)?.playerName || 'Player',
    insights: Array.isArray(playerInsights) ? playerInsights as GameReportInsight[] : []
  })).filter((entry) => entry.insights.length > 0);

  const opponentRows = normalizeOpponentRows(opponentStats, game);
  const opponentSourceRevisions = opponentRows
    .map((row) => row.statPresentation?.sourceRevision)
    .filter((revision): revision is number => Number.isSafeInteger(revision));
  const allSourceRevisions = [
    ...sourceRevisions,
    ...(teamStatView.sourceRevision === null ? [] : [teamStatView.sourceRevision]),
    ...opponentSourceRevisions
  ];
  const projection = resolveDiamondProjectionState(game, allSourceRevisions, {
    expectDocuments: diamondGame && players.length > 0,
    documentsComplete: !diamondGame || (documentCount > 0 && teamStatView.complete)
  });
  const normalizedAiRecap = diamondGame ? normalizePublishedDiamondAiRecap(game.aiRecap) : null;
  const publishedAiRecap = normalizedAiRecap
    ? {
        ...normalizedAiRecap,
        current: normalizedAiRecap.current &&
          !projection.pending &&
          projection.authoritativeRevision === normalizedAiRecap.sourceRevision
      }
    : null;

  return {
    team,
    game,
    summary: String(game.summary || ''),
    statKeys,
    statLabels,
    ...(diamondGame ? { statDefinitions } : {}),
    hasPlayingTime: Object.values(timeMap).some((time) => time > 0),
    playerRows,
    visiblePlayerRows,
    deferredPlayerRows,
    opponentStatKeys: oppKeys,
    opponentStatLabels: oppLabels,
    ...(diamondGame ? { opponentStatDefinitions: oppDefinitions } : {}),
    opponentRows,
    teamStatKeys,
    teamStatLabels,
    teamStats,
    ...(diamondGame ? {
      teamStatDefinitions: Object.fromEntries(visibleDiamondTeamStatCatalog.map((definition) => [definition.id, definition])),
      teamStatPresentation: teamStatView.presentation,
      diamond: {
        isDiamond: projection.isDiamond,
        readOnly: projection.isDiamond,
        status: projection.status,
        pending: projection.pending,
        authoritativeRevision: projection.authoritativeRevision,
        sourceRevisions: projection.sourceRevisions,
        requestedStatVisibility,
        statVisibility: appliedStatVisibility,
        privateStatsStatus: managerLoad?.resolution.status || 'not-requested',
        privateStatsReason: managerLoad?.resolution.reason || null
      }
    } : {}),
    statSheetPhotoUrl: game.statSheetPhotoUrl ? String(game.statSheetPhotoUrl) : '',
    highlightClips: normalizeHighlightClips(teamId, gameId, game),
    plays,
    teamInsights: Array.isArray(insights.teamInsights) ? insights.teamInsights : [],
    playerInsightRows,
    emptyInsightsMessage: String(insights.emptyMessage || ''),
    publishedAiRecap
  };
}
