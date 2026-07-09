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
};

export type GameReportOpponentRow = {
  id: string;
  name: string;
  number: string;
  photoUrl?: string;
  stats: GameReportStatsRecord;
};

export type GameReportPlay = {
  id: string;
  text: string;
  period: string;
  clock: string;
  timestamp: Date | null;
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
  hasPlayingTime: boolean;
  playerRows: GameReportPlayerRow[];
  visiblePlayerRows: GameReportPlayerRow[];
  deferredPlayerRows: GameReportPlayerRow[];
  opponentStatKeys: string[];
  opponentStatLabels: Record<string, string>;
  opponentRows: GameReportOpponentRow[];
  teamStatKeys: string[];
  teamStatLabels: Record<string, string>;
  teamStats: GameReportTeamStatsFirestoreRecord;
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

async function loadAggregatedStats(teamId: string, gameId: string): Promise<AggregatedStatsResult> {
  const snapshot = await getDocs(collection(db, `teams/${teamId}/games/${gameId}/aggregatedStats`));
  const statsMap: Record<string, GameReportStatsRecord> = {};
  const timeMap: Record<string, number> = {};
  const didNotPlayMap: Record<string, boolean> = {};
  const participatedMap: Record<string, boolean> = {};
  const participationStatusMap: Record<string, string> = {};
  const participationSourceMap: Record<string, string> = {};
  const recordedPlayerIds = new Set<string>();

  snapshot.forEach((docSnap: any) => {
    const playerId = String(docSnap.id || '');
    const data = mapGameReportAggregatedStatsRecord(playerId, docSnap.data());
    recordedPlayerIds.add(playerId);
    statsMap[playerId] = data.stats;
    timeMap[playerId] = data.timeMs;
    didNotPlayMap[playerId] = data.didNotPlay;
    participatedMap[playerId] = data.participated;
    participationStatusMap[playerId] = data.participationStatus;
    participationSourceMap[playerId] = data.participationSource;
  });

  return { statsMap, timeMap, didNotPlayMap, participatedMap, participationStatusMap, participationSourceMap, recordedPlayerIds };
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

export async function loadGameReportPlays(teamId: string, gameId: string): Promise<GameReportPlay[]> {
  if (!teamId || !gameId) {
    throw new Error('Team and game are required.');
  }

  const rawEvents = await getGameEvents(teamId, gameId, { limit: 100 });
  return mapGameReportEventRecords(rawEvents)
    .sort((a, b) => (normalizeDate(a.timestamp)?.getTime() || 0) - (normalizeDate(b.timestamp)?.getTime() || 0))
    .map(normalizePlay);
}

function normalizeOpponentRows(opponentStats: GameReportGameFirestoreRecord['opponentStats'] = {}): GameReportOpponentRow[] {
  return Object.entries(opponentStats || {}).map(([id, rawStats]) => {
    const { name, number, notes, playerId, photoUrl, ...stats } = rawStats || {};
    void notes;
    void playerId;
    return {
      id,
      name: String(name || 'Opponent Player'),
      number: String(number || '-'),
      photoUrl: photoUrl ? String(photoUrl) : undefined,
      stats: mapGameReportTeamStatsRecord(stats)
    };
  });
}

function normalizeOpponentStatsForColumns(opponentStats: GameReportGameFirestoreRecord['opponentStats'] = {}): Record<string, GameReportStatsRecord> {
  return Object.entries(opponentStats || {}).reduce<Record<string, GameReportStatsRecord>>((acc, [id, rawStats]) => {
    const { name, number, notes, playerId, photoUrl, ...stats } = rawStats || {};
    void name;
    void number;
    void notes;
    void playerId;
    void photoUrl;
    acc[id] = mapGameReportTeamStatsRecord(stats);
    return acc;
  }, {});
}

function normalizeHighlightClips(teamId: string, gameId: string, game: GameReportGameFirestoreRecord): GameReportHighlightClip[] {
  return (normalizeGameRecapHighlightClips(game) || []).slice(0, 8).map((clip: any) => {
    const startMs = Number.isFinite(Number(clip.startMs)) ? Number(clip.startMs) : null;
    const endMs = Number.isFinite(Number(clip.endMs)) ? Number(clip.endMs) : null;
    const fallbackUrl = startMs !== null && endMs !== null
      ? buildHighlightShareUrl({ origin: 'https://allplays.ai', teamId, gameId, startMs, endMs })
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

  const [configs, aggregateResult, rawEvents, rawTeamStats] = await Promise.all([
    getConfigs(teamId).catch(() => []),
    loadAggregatedStats(teamId, gameId).catch((): AggregatedStatsResult => ({
      statsMap: {},
      timeMap: {},
      didNotPlayMap: {},
      participatedMap: {},
      participationStatusMap: {},
      participationSourceMap: {},
      recordedPlayerIds: new Set<string>()
    })),
    getGameEvents(teamId, gameId, { limit: 100 }).catch(() => []),
    getTeamStatsForGame(teamId, gameId).catch(() => ({}))
  ]);
  const teamStats = mapGameReportTeamStatsRecord(rawTeamStats);

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
    recordedPlayerIds
  } = aggregateResult;
  const { statKeys, statLabels } = resolveReportStatColumns({
    statsMap,
    resolvedConfig
  });
  const opponentStats = game.opponentStats || {};
  const { oppKeys, oppLabels } = resolveOpponentReportStatColumns({
    opponentStats: normalizeOpponentStatsForColumns(opponentStats),
    resolvedConfig
  });
  const teamStatFields = resolvePostGameTeamStatFields({ resolvedConfig, teamStats });
  const teamStatKeys = teamStatFields.map((field: any) => String(field.fieldName || '').trim()).filter(Boolean);
  const teamStatLabels = Object.fromEntries(teamStatFields.map((field: any) => [
    String(field.fieldName || '').trim(),
    String(field.label || field.fieldName || '').trim()
  ]));
  const insightEvents = mapGameReportEventRecords(rawEvents)
    .sort((a, b) => (normalizeDate(a.timestamp)?.getTime() || 0) - (normalizeDate(b.timestamp)?.getTime() || 0));
  const plays = insightEvents.map(normalizePlay);
  const insights = generateGameInsights({
    team,
    game,
    players,
    statsMap,
    timeMap,
    events: insightEvents
  });

  const safePlayers: GameReportPlayerFirestoreRecord[] = Array.isArray(players) ? players : [];
  const playerRows = safePlayers.map((player: any) => ({
    playerId: String(player.id || ''),
    playerName: String(player.name || 'Player'),
    number: String(player.number || '-'),
    photoUrl: player.photoUrl ? String(player.photoUrl) : undefined,
    stats: statsMap[player.id] || {},
    timeMs: timeMap[player.id] || 0,
    didNotPlay: didNotPlayMap[player.id] === true,
    participated: participatedMap[player.id] === true,
    participationStatus: participationStatusMap[player.id] || '',
    participationSource: participationSourceMap[player.id] || ''
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

  return {
    team,
    game,
    summary: String(game.summary || ''),
    statKeys,
    statLabels,
    hasPlayingTime: Object.values(timeMap).some((time) => time > 0),
    playerRows,
    visiblePlayerRows,
    deferredPlayerRows,
    opponentStatKeys: oppKeys,
    opponentStatLabels: oppLabels,
    opponentRows: normalizeOpponentRows(opponentStats),
    teamStatKeys,
    teamStatLabels,
    teamStats,
    statSheetPhotoUrl: game.statSheetPhotoUrl ? String(game.statSheetPhotoUrl) : '',
    highlightClips: normalizeHighlightClips(teamId, gameId, game),
    plays,
    teamInsights: Array.isArray(insights.teamInsights) ? insights.teamInsights : [],
    playerInsightRows,
    emptyInsightsMessage: String(insights.emptyMessage || '')
  };
}
