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
  getPublicDiamondStatCatalog,
  isDiamondV2Game,
  readCoverageAwareOpponentStats,
  readCoverageAwareStatDocument,
  resolveDiamondProjectionState,
  type CoverageAwareStatPresentation
} from './adapters/legacyDiamondStatPresentation';

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
    documentCount: 0
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

async function loadAggregatedStats(teamId: string, gameId: string, game: GameReportGameFirestoreRecord): Promise<AggregatedStatsResult> {
  const snapshot = await getDocs(collection(db, `teams/${teamId}/games/${gameId}/aggregatedStats`));
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

  snapshot.forEach((docSnap: any) => {
    const playerId = String(docSnap.id || '');
    const rawData = docSnap.data() || {};
    const data = mapGameReportAggregatedStatsRecord(playerId, rawData);
    const presentation = readCoverageAwareStatDocument(rawData, game);
    documentCount += 1;
    recordedPlayerIds.add(playerId);
    statsMap[playerId] = (presentation.isDiamond ? presentation.values : data.stats) as GameReportStatsRecord;
    completeStatsMap[playerId] = (presentation.isDiamond ? presentation.completeValues : data.stats) as GameReportStatsRecord;
    presentationMap[playerId] = presentation;
    if (presentation.sourceRevision !== null) sourceRevisions.push(presentation.sourceRevision);
    timeMap[playerId] = data.timeMs;
    didNotPlayMap[playerId] = data.didNotPlay;
    participatedMap[playerId] = data.participated;
    participationStatusMap[playerId] = data.participationStatus;
    participationSourceMap[playerId] = data.participationSource;
  });

  return { statsMap, timeMap, didNotPlayMap, participatedMap, participationStatusMap, participationSourceMap, recordedPlayerIds, presentationMap, completeStatsMap, sourceRevisions, documentCount };
}

async function loadTeamStatView(teamId: string, gameId: string, game: GameReportGameFirestoreRecord): Promise<{ stats: GameReportTeamStatsFirestoreRecord; presentation: CoverageAwareStatPresentation; sourceRevision: number | null }> {
  if (!isDiamondV2Game(game)) {
    const stats = mapGameReportTeamStatsRecord(await getTeamStatsForGame(teamId, gameId).catch(() => ({})));
    return { stats, presentation: legacyStatPresentation, sourceRevision: null };
  }

  try {
    const snapshot = await getDocs(collection(db, `teams/${teamId}/games/${gameId}/teamStats`));
    let rawDocument: Record<string, unknown> | null = null;
    snapshot.forEach((docSnap: any) => {
      if (!rawDocument || String(docSnap.id || '') === 'team') rawDocument = docSnap.data() || {};
    });
    if (!rawDocument) return { stats: {}, presentation: { ...legacyStatPresentation, isDiamond: true }, sourceRevision: null };
    const view = readCoverageAwareStatDocument(rawDocument, game);
    return {
      stats: view.values as GameReportTeamStatsFirestoreRecord,
      presentation: view,
      sourceRevision: view.sourceRevision
    };
  } catch {
    // teamStats is manager-only on some legacy access paths. Player projection
    // integrity is reported independently; lack of team-stat access is not zero.
    return { stats: {}, presentation: { ...legacyStatPresentation, isDiamond: true }, sourceRevision: null };
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

export async function loadGameReportSections(teamId: string, gameId: string): Promise<GameReportData> {
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
  const [configs, aggregateResult, rawEvents, teamStatView] = await Promise.all([
    getConfigs(teamId).catch(() => []),
    diamondGame
      ? loadAggregatedStats(teamId, gameId, game)
      : loadAggregatedStats(teamId, gameId, game).catch(emptyAggregatedStatsResult),
    getGameEvents(teamId, gameId, { limit: 100 }).catch(() => []),
    loadTeamStatView(teamId, gameId, game)
  ]);
  const teamStats = teamStatView.stats;

  const resolvedConfig = resolveLiveStatConfig({
    configs,
    game,
    team
  });
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
  const { statKeys, statLabels, statDefinitions = {} } = resolveReportStatColumns({
    statsMap,
    resolvedConfig,
    trackingEngine: game.trackingEngine
  });
  const publicStatKeySet = new Set<string>((statKeys || []).map((key: unknown) => String(key)));
  const publicStatsMap = diamondGame ? filterStatsMapByIds(statsMap, publicStatKeySet) : statsMap;
  const publicCompleteStatsMap = diamondGame ? filterStatsMapByIds(completeStatsMap, publicStatKeySet) : completeStatsMap;
  const opponentStats = diamondGame ? getRawOpponentStats(rawGame) : (game.opponentStats || {});
  const { oppKeys, oppLabels, oppDefinitions = {} } = resolveOpponentReportStatColumns({
    opponentStats: normalizeOpponentStatsForColumns(opponentStats, game),
    resolvedConfig,
    trackingEngine: game.trackingEngine
  });
  const publicDiamondTeamStatCatalog = diamondGame
    ? getPublicDiamondStatCatalog(resolvedConfig, 'team')
    : DIAMOND_TEAM_STAT_CATALOG;
  const teamStatFields = diamondGame
    ? publicDiamondTeamStatCatalog.map((definition) => ({ fieldName: definition.id, label: definition.label }))
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
    documentsComplete: !diamondGame || documentCount > 0
  });

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
      teamStatDefinitions: Object.fromEntries(publicDiamondTeamStatCatalog.map((definition) => [definition.id, definition])),
      teamStatPresentation: teamStatView.presentation,
      diamond: {
        isDiamond: projection.isDiamond,
        readOnly: projection.isDiamond,
        status: projection.status,
        pending: projection.pending,
        authoritativeRevision: projection.authoritativeRevision,
        sourceRevisions: projection.sourceRevisions
      }
    } : {}),
    statSheetPhotoUrl: game.statSheetPhotoUrl ? String(game.statSheetPhotoUrl) : '',
    highlightClips: normalizeHighlightClips(teamId, gameId, game),
    plays,
    teamInsights: Array.isArray(insights.teamInsights) ? insights.teamInsights : [],
    playerInsightRows,
    emptyInsightsMessage: String(insights.emptyMessage || '')
  };
}
