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
import {
  DIAMOND_MANAGER_STATS_MAX_PLAYERS,
  loadDiamondManagerStats,
  type DiamondManagerStatsReadResult
} from './diamondManagerStatsService';
import { functions, httpsCallable } from './adapters/legacyDiamondScorebookFirebase';
import {
  getDiamondPrivateHistoryWindow,
  getDiamondState,
  type DiamondPrivateEvent
} from './diamondScorebookService';
import { getEffectiveDiamondEvents } from './diamondScorebook/ledger';
import type { DiamondEffectiveEvent, DiamondEvent } from './diamondScorebook/contracts';
import {
  buildActivationPinnedDiamondPresentationConfig,
  currentDiamondStatConfigMatchesActivation
} from './diamondStatConfigSnapshot';

export type GameReportInsight = {
  title: string;
  body: string;
  tone?: 'positive' | 'warning' | 'neutral' | string;
};

export type GameReportPlayerRow = {
  playerId: string;
  playerName: string;
  number: string;
  canOpenProfile?: boolean;
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
  replay?: GameReportReplayProvenance;
  replayError?: string;
};

export type GameReportReplayProvenance = {
  requestedVisibility: 'public' | 'manager-internal';
  visibility: 'public' | 'manager-internal';
  source: 'public-sanitized' | 'manager-private-sanitized';
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
    requestedReplayVisibility: 'public' | 'manager-internal';
    replayVisibility: 'public' | 'manager-internal';
    replaySource: 'public-sanitized' | 'manager-private-sanitized';
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
  recordedPlayerIdentityMap: ReadonlyMap<string, { playerName: string; playerNumber: string }>;
  presentationMap: Record<string, CoverageAwareStatPresentation>;
  completeStatsMap: Record<string, GameReportStatsRecord>;
  sourceRevisions: number[];
  documentCount: number;
  rawDocuments: Array<{ id: string; data: Record<string, unknown> }>;
};

export type GameReportLoadOptions = {
  statVisibility?: 'public' | 'manager-internal';
};

const diamondPublicEventPageSize = 200;
const diamondPublicEventPageLimit = 100;
const diamondManagerEventWindowSize = 200;
const diamondManagerEventWindowLimit = 100;
const diamondStatConfigUnavailableMessage = 'Diamond statistic definitions are temporarily unavailable. Retry the report.';
const diamondPublicReplayTokenPattern = /^(current|bootstrap):(0|[1-9][0-9]{0,7}):(sha256:[0-9a-f]{64})$/;

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

async function loadReportStatConfig(
  teamId: string,
  game: GameReportGameFirestoreRecord,
  team: GameReportTeamFirestoreRecord
): Promise<Record<string, any> | null> {
  if (!isDiamondV2Game(game)) {
    const configs = await getConfigs(teamId).catch(() => []);
    const safeConfigs = Array.isArray(configs) ? configs : [];
    const resolvedConfig = resolveLiveStatConfig({ configs: safeConfigs, game, team });
    return resolvedConfig && typeof resolvedConfig === 'object' && !Array.isArray(resolvedConfig)
      ? resolvedConfig
      : null;
  }

  const requiredConfigId = String(game.statTrackerConfigId || '').trim();
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const configs = await getConfigs(teamId);
      if (!Array.isArray(configs)) continue;
      const matchingConfigs = requiredConfigId
        ? configs.filter((config) => String(config?.id || '').trim() === requiredConfigId)
        : [];
      const exactConfig = matchingConfigs.length === 1 ? matchingConfigs[0] : null;
      if (requiredConfigId && !exactConfig) continue;
      if (!exactConfig || !currentDiamondStatConfigMatchesActivation({ teamId, game, config: exactConfig })) continue;
      const pinnedConfig = buildActivationPinnedDiamondPresentationConfig(exactConfig);
      if (!pinnedConfig) continue;
      const resolutionConfigs = [pinnedConfig];
      const resolvedConfig = resolveLiveStatConfig({ configs: resolutionConfigs, game, team });
      if (resolvedConfig && typeof resolvedConfig === 'object' && !Array.isArray(resolvedConfig)) {
        if (requiredConfigId && String(resolvedConfig.id || '').trim() !== requiredConfigId) continue;
        return resolvedConfig;
      }
    } catch {
      // A Diamond config read is completeness evidence. Retry once before
      // failing closed instead of converting an unreadable catalog to empty.
    }
  }
  throw new Error(diamondStatConfigUnavailableMessage);
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
    recordedPlayerIdentityMap: new Map(),
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

function normalizeProjectedPlayerIdentityText(value: unknown, maxLength: number) {
  if (typeof value !== 'string') return '';
  const normalized = Array.from(value, (character) => {
    const codePoint = character.codePointAt(0) ?? 0;
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
  const recordedPlayerIdentityMap = new Map<string, { playerName: string; playerNumber: string }>();
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
    recordedPlayerIdentityMap.set(playerId, {
      playerName: normalizeProjectedPlayerIdentityText(rawData.playerName, 160),
      playerNumber: normalizeProjectedPlayerIdentityText(rawData.playerNumber, 32)
    });
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

  return { statsMap, timeMap, didNotPlayMap, participatedMap, participationStatusMap, participationSourceMap, recordedPlayerIds, recordedPlayerIdentityMap, presentationMap, completeStatsMap, sourceRevisions, documentCount, rawDocuments: documents };
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

function emptyManagerStatsResult(
  status: 'partial' | 'unavailable',
  reason: string
): DiamondManagerStatsReadResult {
  return {
    status,
    reason,
    documentsByGameId: new Map(),
    teamDocumentsByGameId: new Map()
  };
}

function stableManagerDocumentFingerprint(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? String(value);
  if (Array.isArray(value)) return `[${value.map(stableManagerDocumentFingerprint).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => (
    `${JSON.stringify(key)}:${stableManagerDocumentFingerprint(record[key])}`
  )).join(',')}}`;
}

async function loadChunkedManagerStats(
  teamId: string,
  gameId: string,
  game: GameReportGameFirestoreRecord,
  playerIds: string[]
): Promise<DiamondManagerStatsReadResult> {
  const normalizedPlayerIds = [...new Set(playerIds.map((playerId) => String(playerId || '').trim()).filter(Boolean))].sort();
  if (!normalizedPlayerIds.length) return emptyManagerStatsResult('partial', 'manager-report-player-set-empty');

  const documents: Array<{ id: string; data: Record<string, unknown> }> = [];
  const seenPlayerIds = new Set<string>();
  let teamDocument: Record<string, unknown> | null = null;
  let teamDocumentFingerprint: string | undefined;
  for (let offset = 0; offset < normalizedPlayerIds.length; offset += DIAMOND_MANAGER_STATS_MAX_PLAYERS) {
    const chunkNumber = Math.floor(offset / DIAMOND_MANAGER_STATS_MAX_PLAYERS) + 1;
    const chunkPlayerIds = normalizedPlayerIds.slice(offset, offset + DIAMOND_MANAGER_STATS_MAX_PLAYERS);
    let chunkResult: DiamondManagerStatsReadResult;
    try {
      chunkResult = await loadDiamondManagerStats({
        teamId,
        games: [{ ...game, id: gameId }],
        playerIds: chunkPlayerIds
      });
    } catch {
      return emptyManagerStatsResult('unavailable', `manager-report-chunk-${String(chunkNumber)}:private-read-unavailable`);
    }
    if (chunkResult.status !== 'complete') {
      return emptyManagerStatsResult(
        chunkResult.status,
        `manager-report-chunk-${String(chunkNumber)}:${chunkResult.reason || 'incomplete'}`
      );
    }
    if (
      [...chunkResult.documentsByGameId.keys()].some((returnedGameId) => returnedGameId !== gameId)
      || [...chunkResult.teamDocumentsByGameId.keys()].some((returnedGameId) => returnedGameId !== gameId)
    ) {
      return emptyManagerStatsResult('partial', 'manager-report-unexpected-game-result');
    }
    const nextTeamDocument = chunkResult.teamDocumentsByGameId.get(gameId) || null;
    const teamResolution = resolveDiamondManagerTeamStatDocument({
      game,
      privateDocument: nextTeamDocument,
      loadStatus: chunkResult.status
    });
    if (teamResolution.status !== 'complete' || !teamResolution.document) {
      return emptyManagerStatsResult(
        teamResolution.status === 'unavailable' ? 'unavailable' : 'partial',
        `manager-report-chunk-${String(chunkNumber)}:${teamResolution.reason || 'private-team-read-incomplete'}`
      );
    }

    const chunkDocuments = [...(chunkResult.documentsByGameId.get(gameId) || [])];
    if (chunkDocuments.some(({ id }) => seenPlayerIds.has(id))) {
      return emptyManagerStatsResult('partial', 'manager-report-duplicate-player-result');
    }
    chunkDocuments.forEach(({ id }) => seenPlayerIds.add(id));
    documents.push(...chunkDocuments);

    const nextTeamDocumentFingerprint = stableManagerDocumentFingerprint(teamResolution.document);
    if (teamDocumentFingerprint !== undefined && teamDocumentFingerprint !== nextTeamDocumentFingerprint) {
      return emptyManagerStatsResult('partial', 'manager-report-incoherent-team-result');
    }
    teamDocumentFingerprint = nextTeamDocumentFingerprint;
    teamDocument = teamResolution.document;
  }
  if (!teamDocument) return emptyManagerStatsResult('partial', 'manager-report-team-document-missing');

  return {
    status: 'complete',
    reason: null,
    documentsByGameId: new Map([[gameId, Object.freeze(documents.sort((left, right) => left.id.localeCompare(right.id)))]]),
    teamDocumentsByGameId: new Map([[gameId, teamDocument]])
  };
}

async function loadManagerPrivateStats(
  teamId: string,
  gameId: string,
  game: GameReportGameFirestoreRecord,
  publicResult: AggregatedStatsResult
) {
  const expectedPlayerIds = [...publicResult.recordedPlayerIds].sort();
  let latestResult: {
    managerBatch: DiamondManagerStatsReadResult;
    resolution: ReturnType<typeof resolveDiamondManagerStatDocuments>;
  } | null = null;
  const attemptLimit = expectedPlayerIds.length ? 2 : 1;
  for (let attempt = 0; attempt < attemptLimit; attempt += 1) {
    const managerBatch = await loadChunkedManagerStats(teamId, gameId, game, expectedPlayerIds);
    const rawPlayerResolution = resolveDiamondManagerStatDocuments({
      game,
      expectedPlayerIds,
      privateDocuments: [...(managerBatch.documentsByGameId.get(gameId) || [])],
      loadStatus: managerBatch.status
    });
    const teamResolution = resolveDiamondManagerTeamStatDocument({
      game,
      privateDocument: managerBatch.teamDocumentsByGameId.get(gameId) || null,
      loadStatus: managerBatch.status
    });
    let resolution: ReturnType<typeof resolveDiamondManagerStatDocuments> = rawPlayerResolution;
    if (rawPlayerResolution.status !== 'complete' && managerBatch.reason) {
      resolution = { ...rawPlayerResolution, reason: managerBatch.reason };
    } else if (rawPlayerResolution.status === 'complete' && (teamResolution.status !== 'complete' || !teamResolution.document)) {
      resolution = {
        ...rawPlayerResolution,
        appliedVisibility: 'public',
        status: teamResolution.status === 'unavailable' ? 'unavailable' : 'partial',
        reason: teamResolution.reason || 'private-team-read-incomplete',
        documents: Object.freeze([])
      };
    }
    latestResult = { managerBatch, resolution };
    if (resolution.status === 'complete') {
      return {
        managerBatch,
        resolution,
        result: mapStatsDocuments([...resolution.documents], game, 'manager-internal')
      };
    }
  }
  return {
    ...latestResult!,
    result: publicResult
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

function mapDiamondPublicEvent(value: unknown, sourceRevision: number): GameReportEventFirestoreRecord {
  const event = asRecord(value);
  const id = String(event.id || '').trim();
  const revision = Number(event.revision);
  const inning = Number(event.inning);
  const half = String(event.half || '').trim().toLowerCase();
  const description = String(event.description || '').trim();
  const createdAt = String(event.createdAt || '').trim();
  if (
    !id ||
    id.length > 128 ||
    id.includes('/') ||
    !Number.isSafeInteger(revision) ||
    revision < 1 ||
    revision > sourceRevision ||
    !Number.isSafeInteger(inning) ||
    inning < 1 ||
    inning > 99 ||
    !['top', 'bottom'].includes(half) ||
    !description ||
    description.length > 500 ||
    (createdAt && !normalizeDate(createdAt))
  ) {
    throw new Error('The Diamond public replay contains malformed play evidence.');
  }
  return {
    id,
    text: description,
    period: `${half === 'bottom' ? 'Bottom' : 'Top'} ${inning}`,
    clock: '',
    timestamp: createdAt || null,
    revision
  };
}

function assertCurrentDiamondPublicReplayToken(
  projectionToken: string,
  sourceRevision: number,
  game: GameReportGameFirestoreRecord
) {
  const match = diamondPublicReplayTokenPattern.exec(projectionToken);
  if (!match || Number(match[2]) !== sourceRevision) {
    throw new Error('The Diamond public replay is incomplete or changed while loading.');
  }
  if (match[1] !== 'current') {
    throw new Error('The Diamond public replay is not projection-current. Retry the report.');
  }
  const projectionHash = String(game.diamondProjectionHash || '').trim();
  if (
    String(game.diamondProjectionStatus || '').trim().toLowerCase() !== 'current' ||
    game.diamondProjectionComplete !== true ||
    projectionHash !== match[3]
  ) {
    throw new Error('The Diamond public replay is incomplete or changed while loading.');
  }
}

async function loadCompleteDiamondPublicEvents(
  teamId: string,
  gameId: string,
  game: GameReportGameFirestoreRecord
): Promise<GameReportEventFirestoreRecord[]> {
  const callable = httpsCallable(functions, 'getPublicDiamondGame');
  const expectedInstanceId = String(game.diamondScorebookInstanceId || '').trim();
  const expectedSourceRevision = Number(game.diamondProjectionRevision);
  if (!expectedInstanceId || !Number.isSafeInteger(expectedSourceRevision) || expectedSourceRevision < 1) {
    throw new Error('The Diamond public replay identity is unavailable.');
  }

  const events: GameReportEventFirestoreRecord[] = [];
  const eventIds = new Set<string>();
  let cursor: string | null = null;
  let projectionToken = '';
  for (let pageNumber = 0; pageNumber < diamondPublicEventPageLimit; pageNumber += 1) {
    const response = await callable({
      teamId,
      gameId,
      limit: diamondPublicEventPageSize,
      cursor
    });
    const page = asRecord(response?.data);
    const instanceId = String(page.instanceId || '').trim();
    const sourceRevision = Number(page.sourceRevision);
    const nextCursor = page.nextCursor == null ? null : String(page.nextCursor || '').trim();
    const nextProjectionToken = String(page.projectionToken || '').trim();
    const pageEvents = Array.isArray(page.events) ? page.events : null;
    if (
      instanceId !== expectedInstanceId ||
      sourceRevision !== expectedSourceRevision ||
      !nextProjectionToken ||
      (projectionToken && nextProjectionToken !== projectionToken) ||
      !pageEvents ||
      (page.complete === true && (page.truncated === true || nextCursor)) ||
      (page.complete !== true && (page.truncated !== true || !nextCursor))
    ) {
      throw new Error('The Diamond public replay is incomplete or changed while loading.');
    }
    assertCurrentDiamondPublicReplayToken(nextProjectionToken, sourceRevision, game);
    projectionToken = nextProjectionToken;
    pageEvents.forEach((value) => {
      const event = mapDiamondPublicEvent(value, sourceRevision);
      if (eventIds.has(event.id)) {
        throw new Error('The Diamond public replay contains duplicate play evidence.');
      }
      eventIds.add(event.id);
      events.push(event);
    });
    if (page.complete === true) {
      return events.sort((left, right) => Number(left.revision) - Number(right.revision));
    }
    cursor = nextCursor;
  }
  throw new Error('The Diamond public replay exceeds the supported report limit.');
}

function isNotFoundCallableError(error: unknown) {
  const code = String(asRecord(error).code || '').trim().toLowerCase();
  return code === 'not-found' || code.endsWith('/not-found');
}

function describeDiamondManagerEvent(event: Pick<DiamondEffectiveEvent, 'type' | 'payload'>) {
  const payload = asRecord(event.payload);
  const result = String(payload.result || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '')
    .replace(/_/g, ' ')
    .slice(0, 80);
  const side = payload.side === 'away' ? 'Away' : payload.side === 'home' ? 'Home' : '';
  const labels: Partial<Record<DiamondPrivateEvent['type'], string>> = {
    activate: 'Scorebook ready',
    set_lineup: `${side || 'Team'} lineup set`,
    set_defensive_alignment: `${side || 'Team'} defense set`,
    set_dp_flex: `${side || 'Team'} DP/FLEX set`,
    start: 'Game started',
    record_pitch: result ? `Pitch: ${result}` : 'Pitch recorded',
    record_plate_appearance: result ? `Plate appearance: ${result}` : 'Plate appearance recorded',
    advance_runner: 'Runner advance recorded',
    record_fielding: 'Fielding details recorded',
    record_scoring_judgment: 'Official scoring updated',
    advance_half_inning: 'Half inning advanced',
    place_tiebreaker_runner: 'Tiebreaker runner placed',
    substitute: 'Substitution recorded',
    re_enter: 'Re-entry recorded',
    add_courtesy_runner: 'Courtesy runner recorded',
    scorer_handoff: 'Official scorer changed',
    suspend: 'Game suspended',
    resume: 'Game resumed',
    cancel: 'Game cancelled',
    finalize: 'Game final',
    reopen_for_correction: 'Scorebook reopened for correction',
    rules_decision: 'Rules decision recorded',
    void_event: 'Scoring correction recorded',
    supersede_event: 'Scoring correction replaced a prior play'
  };
  return labels[event.type] || 'Game update';
}

function mapDiamondManagerEvent(
  event: DiamondEffectiveEvent,
  createdAt: string | null,
  sourceRevision: number
): GameReportEventFirestoreRecord {
  if (event.revision > sourceRevision) {
    throw new Error('The Diamond manager replay contains invalid play evidence.');
  }
  return {
    id: event.eventId,
    text: describeDiamondManagerEvent(event),
    period: `Revision ${String(event.revision)}`,
    clock: '',
    timestamp: createdAt,
    revision: event.revision
  };
}

function resolveEffectiveDiamondManagerEvents(events: readonly DiamondPrivateEvent[]) {
  const orderedEvents = [...events].sort((left, right) => left.revision - right.revision);
  try {
    return getEffectiveDiamondEvents(orderedEvents as unknown as readonly DiamondEvent[]);
  } catch {
    throw new Error('The Diamond manager replay contains invalid correction evidence.');
  }
}

async function loadCompleteDiamondManagerEvents(
  teamId: string,
  gameId: string,
  game: GameReportGameFirestoreRecord
): Promise<GameReportEventFirestoreRecord[]> {
  const expectedInstanceId = String(game.diamondScorebookInstanceId || '').trim();
  const expectedSourceRevision = Number(game.diamondProjectionRevision ?? game.diamondRevision);
  if (!expectedInstanceId || !Number.isSafeInteger(expectedSourceRevision) || expectedSourceRevision < 1) {
    throw new Error('The Diamond manager replay identity is unavailable.');
  }

  const openingState = await getDiamondState(teamId, gameId);
  if (openingState.instanceId !== expectedInstanceId || openingState.revision !== expectedSourceRevision) {
    throw new Error('The Diamond manager replay changed before loading.');
  }

  const events: DiamondPrivateEvent[] = [];
  const eventIds = new Set<string>();
  let beforeSequence: number | null = null;
  let expectedWindowEnd = expectedSourceRevision;
  for (let windowNumber = 0; windowNumber < diamondManagerEventWindowLimit; windowNumber += 1) {
    const window = await getDiamondPrivateHistoryWindow({
      teamId,
      gameId,
      expectedRevision: expectedSourceRevision,
      beforeSequence,
      windowSize: diamondManagerEventWindowSize
    });
    if (
      window.sourceRevision !== expectedSourceRevision ||
      window.newestSequence !== expectedWindowEnd ||
      (beforeSequence === null && !window.headComplete)
    ) {
      throw new Error('The Diamond manager replay is incomplete or changed while loading.');
    }
    window.items.forEach((value) => {
      if (value.revision > expectedSourceRevision) {
        throw new Error('The Diamond manager replay contains invalid play evidence.');
      }
      if (eventIds.has(value.eventId)) {
        throw new Error('The Diamond manager replay contains duplicate play evidence.');
      }
      eventIds.add(value.eventId);
      events.push(value);
    });
    if (!window.hasOlder) {
      if (window.oldestSequence !== 1) {
        throw new Error('The Diamond manager replay is incomplete or changed while loading.');
      }
      const closingState = await getDiamondState(teamId, gameId);
      if (closingState.instanceId !== expectedInstanceId || closingState.revision !== expectedSourceRevision) {
        throw new Error('The Diamond manager replay changed while loading.');
      }
      const createdAtByEventId = new Map(events.map((event) => [event.eventId, event.createdAt]));
      return resolveEffectiveDiamondManagerEvents(events)
        .filter((event) => event.type !== 'private_note')
        .map((event) => mapDiamondManagerEvent(
          event,
          createdAtByEventId.get(event.eventId) ?? createdAtByEventId.get(event.sourceEventId) ?? null,
          expectedSourceRevision
        ));
    }
    if (window.oldestSequence === null || window.oldestSequence < 2) {
      throw new Error('The Diamond manager replay is incomplete or changed while loading.');
    }
    expectedWindowEnd = window.oldestSequence - 1;
    beforeSequence = window.oldestSequence;
  }
  throw new Error('The Diamond manager replay exceeds the supported report limit.');
}

async function loadCompleteDiamondReportEvents(
  teamId: string,
  gameId: string,
  game: GameReportGameFirestoreRecord,
  requestedVisibility: 'public' | 'manager-internal'
): Promise<{ events: GameReportEventFirestoreRecord[]; replay: GameReportReplayProvenance }> {
  try {
    return {
      events: await loadCompleteDiamondPublicEvents(teamId, gameId, game),
      replay: {
        requestedVisibility,
        visibility: 'public',
        source: 'public-sanitized'
      }
    };
  } catch (error) {
    if (requestedVisibility !== 'manager-internal' || !isNotFoundCallableError(error)) throw error;
    return {
      events: await loadCompleteDiamondManagerEvents(teamId, gameId, game),
      replay: {
        requestedVisibility,
        visibility: 'manager-internal',
        source: 'manager-private-sanitized'
      }
    };
  }
}

export async function loadGameReportPlays(
  teamId: string,
  gameId: string,
  options: GameReportLoadOptions = {}
): Promise<GameReportPlaysRefresh> {
  if (!teamId || !gameId) {
    throw new Error('Team and game are required.');
  }

  const rawGame = await getGame(teamId, gameId);
  const game = mapGameReportGameRecord(rawGame, gameId);
  const requestedStatVisibility = options.statVisibility === 'manager-internal' ? 'manager-internal' : 'public';
  const diamondGame = isDiamondV2Game(game);
  if (diamondGame) {
    try {
      const result = await loadCompleteDiamondReportEvents(teamId, gameId, game, requestedStatVisibility);
      return {
        game,
        plays: [...result.events]
          .sort((left, right) => Number(left.revision) - Number(right.revision))
          .map(normalizePlay),
        playsFresh: true,
        replay: result.replay
      };
    } catch {
      return {
        game,
        plays: [],
        playsFresh: false,
        replayError: 'Diamond play-by-play could not be refreshed completely. Retry the report.'
      };
    }
  }

  const eventsRefresh = await getGameEvents(teamId, gameId, { limit: 100 })
    .then((rawEvents) => ({ rawEvents: mapGameReportEventRecords(rawEvents), playsFresh: true }))
    .catch(() => ({ rawEvents: [], playsFresh: false }));
  return {
    game,
    plays: eventsRefresh.rawEvents
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
  const [resolvedConfig, publicAggregateResult, eventLoad] = await Promise.all([
    loadReportStatConfig(teamId, game, team),
    diamondGame
      ? loadAggregatedStats(teamId, gameId, game)
      : loadAggregatedStats(teamId, gameId, game).catch(emptyAggregatedStatsResult),
    diamondGame
      ? loadCompleteDiamondReportEvents(teamId, gameId, game, requestedStatVisibility)
      : getGameEvents(teamId, gameId, { limit: 100 })
        .then((rawEvents) => ({ events: mapGameReportEventRecords(rawEvents), replay: null }))
        .catch(() => ({ events: [] as GameReportEventFirestoreRecord[], replay: null }))
  ]);
  if (diamondGame && !eventLoad.replay) {
    throw new Error('The Diamond replay provenance is unavailable.');
  }
  const managerLoad = diamondGame && requestedStatVisibility === 'manager-internal'
    ? await loadManagerPrivateStats(teamId, gameId, game, publicAggregateResult)
    : null;
  const aggregateResult = managerLoad?.result || publicAggregateResult;
  const appliedStatVisibility = managerLoad?.resolution.status === 'complete' ? 'manager-internal' : 'public';
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
  const insightEvents = [...eventLoad.events].sort(
    diamondGame
      ? (left, right) => Number(left.revision) - Number(right.revision)
      : (left, right) => (normalizeDate(left.timestamp)?.getTime() || 0) - (normalizeDate(right.timestamp)?.getTime() || 0)
  );
  const plays = insightEvents.map(normalizePlay);
  const insightStatsMap = diamondGame ? publicCompleteStatsMap : statsMap;
  const safePlayers: GameReportPlayerFirestoreRecord[] = Array.isArray(players) ? players : [];
  const rosterPlayerIds = new Set(safePlayers.map((player) => String(player.id || '')));
  const projectedOnlyPlayers: GameReportPlayerFirestoreRecord[] = diamondGame
    ? [...publicAggregateResult.recordedPlayerIds]
        .filter((playerId) => !rosterPlayerIds.has(playerId))
        .sort()
        .map((playerId) => {
          const identity = publicAggregateResult.recordedPlayerIdentityMap.get(playerId);
          return {
            id: playerId,
            name: identity?.playerName || 'Recorded player',
            number: identity?.playerNumber || '-'
          };
        })
    : [];
  const reportPlayers = [...safePlayers, ...projectedOnlyPlayers];
  const insights = generateGameInsights({
    team,
    game,
    players: reportPlayers,
    statsMap: insightStatsMap,
    timeMap,
    events: insightEvents
  });

  const playerRows = reportPlayers.map((player: any) => {
    const playerId = String(player.id || '');
    const recordedIdentity = diamondGame
      ? publicAggregateResult.recordedPlayerIdentityMap.get(playerId)
      : null;
    return {
      playerId,
      playerName: recordedIdentity?.playerName || String(player.name || 'Player'),
      number: recordedIdentity?.playerNumber || String(player.number || '-'),
      canOpenProfile: rosterPlayerIds.has(playerId),
      photoUrl: player.photoUrl ? String(player.photoUrl) : undefined,
      stats: publicStatsMap[playerId] || {},
      timeMs: timeMap[playerId] || 0,
      didNotPlay: didNotPlayMap[playerId] === true,
      participated: participatedMap[playerId] === true,
      participationStatus: participationStatusMap[playerId] || '',
      participationSource: participationSourceMap[playerId] || '',
      ...(diamondGame ? {
        statPresentation: presentationMap[playerId] || { ...legacyStatPresentation, isDiamond: true }
      } : {})
    };
  });
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
    expectDocuments: diamondGame && reportPlayers.length > 0,
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
        requestedReplayVisibility: eventLoad.replay!.requestedVisibility,
        replayVisibility: eventLoad.replay!.visibility,
        replaySource: eventLoad.replay!.source,
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
