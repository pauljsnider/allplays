import { buildTrackerEventDocument, type TrackerEventDocument, type TrackerEventInput, type TrackerOpponentStatsEntry, type TrackerUndoData, type TrackerUser } from './statTrackingEvent';
import { db, deleteDoc, doc, increment, setDoc, splitPlayerStatsByVisibility } from './adapters/legacyStatTrackingDb';

export type TrackerScoreState = {
  homeScore: number;
  awayScore: number;
};

export type TrackerStatConfig = {
  columns?: string[];
  statDefinitions?: Array<{ id?: string; scope?: string; visibility?: string }>;
};

export type TrackerLogEntry = {
  eventId: string;
  event: TrackerEventDocument;
  scoreBefore: TrackerScoreState;
  scoreAfter: TrackerScoreState;
  aggregateStatKey: string | null;
  aggregateDelta: number;
  aggregatePlayerId: string | null;
  isOpponent: boolean;
  opponentStatsEntryId: string | null;
  opponentStatsEntryBefore: TrackerOpponentStatsEntry | null;
  opponentStatsEntryAfter: TrackerOpponentStatsEntry | null;
  playerName: string;
  playerNumber: string;
};

type StatTrackingDependencies = {
  doc: typeof doc;
  setDoc: typeof setDoc;
  deleteDoc: typeof deleteDoc;
  increment: typeof increment;
  db: typeof db;
  updateGameScore: (teamId: string, gameId: string, score: TrackerScoreState, user: TrackerUser) => Promise<unknown>;
};

type OpponentStatsEntryFallback = {
  name?: unknown;
  number?: unknown;
  playerId?: unknown;
  photoUrl?: unknown;
  statKeys: string[];
};

const DEFAULT_SCORE: TrackerScoreState = { homeScore: 0, awayScore: 0 };
const BASE_PARTICIPATION_SOURCE = 'app-stat-tracker';

function normalizeScoreValue(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function normalizeScoreState(score: Partial<TrackerScoreState> | null | undefined): TrackerScoreState {
  return {
    homeScore: normalizeScoreValue(score?.homeScore),
    awayScore: normalizeScoreValue(score?.awayScore)
  };
}

function normalizeText(value: unknown) {
  return String(value || '').trim();
}

function normalizeStatKey(value: unknown) {
  return normalizeText(value).toLowerCase();
}

function normalizeStatsNumber(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function isScoringStatKey(statKey: string) {
  return statKey === 'pts' || statKey === 'points' || statKey === 'goals' || statKey === 'goal';
}

function collectAllowedStatKeys(config: TrackerStatConfig = {}) {
  const keys = new Set<string>(['fouls', 'time']);

  (Array.isArray(config.columns) ? config.columns : []).forEach((column) => {
    const normalized = normalizeStatKey(column);
    if (!normalized) return;
    keys.add(normalized);
    if (normalized.endsWith('s')) {
      keys.add(normalized.slice(0, -1));
    } else {
      keys.add(`${normalized}s`);
    }
  });

  (Array.isArray(config.statDefinitions) ? config.statDefinitions : []).forEach((definition) => {
    const normalized = normalizeStatKey(definition?.id);
    if (normalized) keys.add(normalized);
  });

  return keys;
}

function getConfiguredOpponentStatKeys(config: TrackerStatConfig = {}) {
  const keys = new Set<string>();
  (Array.isArray(config.columns) ? config.columns : []).forEach((column) => {
    const normalized = normalizeStatKey(column);
    if (normalized) keys.add(normalized);
  });
  keys.add('fouls');
  return Array.from(keys);
}

function normalizeOpponentStatsEntry(
  input: Partial<TrackerOpponentStatsEntry> | null | undefined,
  fallback: OpponentStatsEntryFallback
): TrackerOpponentStatsEntry {
  const source = input && typeof input === 'object' ? input as Record<string, unknown> : {};
  const entry: TrackerOpponentStatsEntry = {
    name: normalizeText(source.name) || normalizeText(fallback.name),
    number: normalizeText(source.number) || normalizeText(fallback.number),
    playerId: normalizeText(source.playerId) || normalizeText(fallback.playerId) || null,
    photoUrl: normalizeText(source.photoUrl) || normalizeText(fallback.photoUrl)
  };
  const statKeys = new Set(fallback.statKeys.map(normalizeStatKey).filter(Boolean));

  Object.entries(source).forEach(([key, value]) => {
    const normalizedKey = normalizeStatKey(key);
    if (!normalizedKey || ['name', 'number', 'playerid', 'photourl'].includes(normalizedKey)) return;
    statKeys.add(normalizedKey);
    entry[normalizedKey] = normalizeStatsNumber(value);
  });

  statKeys.forEach((statKey) => {
    if (entry[statKey] === undefined) entry[statKey] = 0;
  });

  return entry;
}

function buildFallbackOpponentStatsEntry({
  input,
  event,
  statConfig,
  statKey,
  delta,
  mode
}: {
  input: TrackerEventInput;
  event: TrackerEventDocument;
  statConfig: TrackerStatConfig;
  statKey: string | null;
  delta: number;
  mode: 'before' | 'after';
}) {
  const statKeys = getConfiguredOpponentStatKeys(statConfig);
  const seed: Partial<TrackerOpponentStatsEntry> = {
    name: normalizeText(input.opponentPlayerName || input.playerName) || 'Opponent',
    number: normalizeText(input.opponentPlayerNumber ?? input.playerNumber),
    playerId: null,
    photoUrl: normalizeText(input.opponentPlayerPhoto)
  };
  const entry = normalizeOpponentStatsEntry(null, { ...seed, statKeys });
  if (statKey) {
    entry[statKey] = mode === 'after' ? normalizeStatsNumber(delta) : 0;
  }
  return entry;
}

function buildParticipationPayload(playerName: string, playerNumber: string) {
  return {
    playerName,
    playerNumber,
    participated: true,
    participationStatus: 'appeared',
    participationSource: BASE_PARTICIPATION_SOURCE,
    didNotPlay: false
  };
}

function createEventIdFactory() {
  const sessionPrefix = `app-track-${Date.now().toString(36)}`;
  let index = 0;

  return () => {
    index += 1;
    return `${sessionPrefix}-${String(index).padStart(6, '0')}`;
  };
}

function normalizeLogEntry(input: unknown): TrackerLogEntry | null {
  const entry = input as Partial<TrackerLogEntry> | null | undefined;
  if (!entry || !entry.eventId || !entry.event) return null;
  const event = entry.event as TrackerEventDocument;
  return {
    eventId: normalizeText(entry.eventId),
    event: { ...event },
    scoreBefore: normalizeScoreState(entry.scoreBefore),
    scoreAfter: normalizeScoreState(entry.scoreAfter),
    aggregateStatKey: entry.aggregateStatKey ? normalizeStatKey(entry.aggregateStatKey) : null,
    aggregateDelta: Number.isFinite(Number(entry.aggregateDelta)) ? Number(entry.aggregateDelta) : 0,
    aggregatePlayerId: entry.aggregatePlayerId ? normalizeText(entry.aggregatePlayerId) : null,
    isOpponent: entry.isOpponent === true,
    opponentStatsEntryId: entry.opponentStatsEntryId ? normalizeText(entry.opponentStatsEntryId) : null,
    opponentStatsEntryBefore: entry.opponentStatsEntryBefore ? { ...entry.opponentStatsEntryBefore } : null,
    opponentStatsEntryAfter: entry.opponentStatsEntryAfter ? { ...entry.opponentStatsEntryAfter } : null,
    playerName: normalizeText(entry.playerName) || 'Player',
    playerNumber: normalizeText(entry.playerNumber)
  };
}

async function applyAggregateWrite({
  dependencies,
  teamId,
  gameId,
  playerId,
  playerName,
  playerNumber,
  statKey,
  delta,
  statConfig
}: {
  dependencies: StatTrackingDependencies;
  teamId: string;
  gameId: string;
  playerId: string;
  playerName: string;
  playerNumber: string;
  statKey: string;
  delta: number;
  statConfig: TrackerStatConfig;
}) {
  const { publicStats, privateStats } = splitPlayerStatsByVisibility(statConfig || {}, {
    [statKey]: dependencies.increment(delta)
  });
  const basePayload = buildParticipationPayload(playerName, playerNumber);
  const publicRef = dependencies.doc(dependencies.db, `teams/${teamId}/games/${gameId}/aggregatedStats`, playerId);

  if (Object.keys(publicStats).length > 0) {
    await dependencies.setDoc(publicRef, {
      ...basePayload,
      stats: publicStats
    }, { merge: true });
  } else {
    await dependencies.setDoc(publicRef, basePayload, { merge: true });
  }

  if (Object.keys(privateStats).length > 0) {
    const privateRef = dependencies.doc(dependencies.db, `teams/${teamId}/games/${gameId}/privatePlayerStats`, playerId);
    await dependencies.setDoc(privateRef, {
      ...basePayload,
      stats: privateStats
    }, { merge: true });
  }
}

async function applyOpponentStatsWrite({
  dependencies,
  teamId,
  gameId,
  entryId,
  entry
}: {
  dependencies: StatTrackingDependencies;
  teamId: string;
  gameId: string;
  entryId: string;
  entry: TrackerOpponentStatsEntry;
}) {
  const gameRef = dependencies.doc(dependencies.db, `teams/${teamId}/games`, gameId);
  await dependencies.setDoc(gameRef, {
    opponentStats: {
      [entryId]: entry
    }
  }, { merge: true });
}

export function createStatTrackingService({
  statConfig = {},
  initialScore,
  initialEventLog = [],
  dependencies
}: {
  statConfig?: TrackerStatConfig;
  initialScore?: Partial<TrackerScoreState>;
  initialEventLog?: TrackerLogEntry[];
  dependencies: StatTrackingDependencies;
}) {
  const eventLog: TrackerLogEntry[] = (Array.isArray(initialEventLog) ? initialEventLog : [])
    .map(normalizeLogEntry)
    .filter(Boolean) as TrackerLogEntry[];
  const allowedStatKeys = collectAllowedStatKeys(statConfig);
  const nextEventId = createEventIdFactory();
  let currentScore = normalizeScoreState(initialScore || eventLog[eventLog.length - 1]?.scoreAfter || DEFAULT_SCORE);

  async function recordEvent(teamId: string, gameId: string, input: TrackerEventInput, user: TrackerUser) {
    if (!teamId || !gameId) {
      throw new Error('A scheduled game is required before recording a stat event.');
    }
    if (!user?.uid) {
      throw new Error('Sign in before recording a stat event.');
    }

    const event = buildTrackerEventDocument(input, user);
    const statKey = event.statKey;
    const delta = Number(event.value || 0);

    if (event.type === 'stat' && statKey && !allowedStatKeys.has(statKey)) {
      throw new Error(`Unknown stat column key: ${statKey}`);
    }

    const scoreBefore = { ...currentScore };
    const scoreAfter = { ...scoreBefore };
    if (event.type === 'stat' && statKey && isScoringStatKey(statKey) && delta !== 0) {
      const scoreSide = input.teamSide === 'away' ? 'away' : 'home';
      if (scoreSide === 'away') {
        scoreAfter.awayScore = normalizeScoreValue(scoreAfter.awayScore + delta);
      } else {
        scoreAfter.homeScore = normalizeScoreValue(scoreAfter.homeScore + delta);
      }
    }

    const eventId = nextEventId();
    const eventRef = dependencies.doc(dependencies.db, `teams/${teamId}/games/${gameId}/events`, eventId);
    const opponentStatsEntryId = event.type === 'stat' && event.isOpponent
      ? normalizeText(input.opponentStatsEntryId || event.playerId)
      : '';
    const opponentStatsEntryBefore = opponentStatsEntryId
      ? normalizeOpponentStatsEntry(input.opponentStatsEntryBefore || buildFallbackOpponentStatsEntry({
        input,
        event,
        statConfig,
        statKey,
        delta,
        mode: 'before'
      }), {
        ...buildFallbackOpponentStatsEntry({ input, event, statConfig, statKey, delta, mode: 'before' }),
        statKeys: getConfiguredOpponentStatKeys(statConfig)
      })
      : null;
    const opponentStatsEntryAfter = opponentStatsEntryId
      ? normalizeOpponentStatsEntry(input.opponentStatsEntryAfter || buildFallbackOpponentStatsEntry({
        input,
        event,
        statConfig,
        statKey,
        delta,
        mode: 'after'
      }), {
        ...buildFallbackOpponentStatsEntry({ input, event, statConfig, statKey, delta, mode: 'after' }),
        statKeys: getConfiguredOpponentStatKeys(statConfig)
      })
      : null;
    let aggregateApplied = false;
    let opponentStatsApplied = false;
    let scoreApplied = false;

    await dependencies.setDoc(eventRef, event);

    try {
      if (event.type === 'stat' && !event.isOpponent && event.playerId && statKey && delta !== 0) {
        await applyAggregateWrite({
          dependencies,
          teamId,
          gameId,
          playerId: event.playerId,
          playerName: normalizeText(input.playerName) || 'Player',
          playerNumber: normalizeText(input.playerNumber),
          statKey,
          delta,
          statConfig
        });
        aggregateApplied = true;
      }

      if (opponentStatsEntryId && opponentStatsEntryAfter) {
        await applyOpponentStatsWrite({
          dependencies,
          teamId,
          gameId,
          entryId: opponentStatsEntryId,
          entry: opponentStatsEntryAfter
        });
        opponentStatsApplied = true;
      }

      if (scoreAfter.homeScore !== scoreBefore.homeScore || scoreAfter.awayScore !== scoreBefore.awayScore) {
        await dependencies.updateGameScore(teamId, gameId, scoreAfter, user);
        scoreApplied = true;
      }
    } catch (error) {
      if (scoreApplied) {
        await dependencies.updateGameScore(teamId, gameId, scoreBefore, user);
      }
      if (aggregateApplied && event.playerId && statKey && delta !== 0 && event.type === 'stat' && !event.isOpponent) {
        await applyAggregateWrite({
          dependencies,
          teamId,
          gameId,
          playerId: event.playerId,
          playerName: normalizeText(input.playerName) || 'Player',
          playerNumber: normalizeText(input.playerNumber),
          statKey,
          delta: -delta,
          statConfig
        });
      }
      if (opponentStatsApplied && opponentStatsEntryId && opponentStatsEntryBefore) {
        await applyOpponentStatsWrite({
          dependencies,
          teamId,
          gameId,
          entryId: opponentStatsEntryId,
          entry: opponentStatsEntryBefore
        });
      }
      await dependencies.deleteDoc(eventRef);
      throw error;
    }

    currentScore = scoreAfter;
    const entry: TrackerLogEntry = {
      eventId,
      event,
      scoreBefore,
      scoreAfter,
      aggregateStatKey: event.type === 'stat' ? statKey : null,
      aggregateDelta: event.type === 'stat' ? delta : 0,
      aggregatePlayerId: event.type === 'stat' ? event.playerId : null,
      isOpponent: event.isOpponent,
      opponentStatsEntryId: opponentStatsEntryId || null,
      opponentStatsEntryBefore,
      opponentStatsEntryAfter,
      playerName: normalizeText(input.playerName) || 'Player',
      playerNumber: normalizeText(input.playerNumber)
    };
    eventLog.push(entry);
    return entry;
  }

  async function undoLastEvent(teamId: string, gameId: string, user: TrackerUser) {
    const entry = eventLog[eventLog.length - 1];
    if (!entry) {
      return null;
    }

    const eventRef = dependencies.doc(dependencies.db, `teams/${teamId}/games/${gameId}/events`, entry.eventId);
    let aggregateReverted = false;
    let opponentStatsReverted = false;
    let scoreReverted = false;

    try {
      if (
        entry.event.type === 'stat'
        && !entry.isOpponent
        && entry.aggregatePlayerId
        && entry.aggregateStatKey
        && entry.aggregateDelta !== 0
      ) {
        await applyAggregateWrite({
          dependencies,
          teamId,
          gameId,
          playerId: entry.aggregatePlayerId,
          playerName: entry.playerName,
          playerNumber: entry.playerNumber,
          statKey: entry.aggregateStatKey,
          delta: -entry.aggregateDelta,
          statConfig
        });
        aggregateReverted = true;
      }

      if (
        entry.event.type === 'stat'
        && entry.isOpponent
        && entry.opponentStatsEntryId
        && entry.opponentStatsEntryBefore
      ) {
        await applyOpponentStatsWrite({
          dependencies,
          teamId,
          gameId,
          entryId: entry.opponentStatsEntryId,
          entry: entry.opponentStatsEntryBefore
        });
        opponentStatsReverted = true;
      }

      if (
        entry.scoreAfter.homeScore !== entry.scoreBefore.homeScore
        || entry.scoreAfter.awayScore !== entry.scoreBefore.awayScore
      ) {
        await dependencies.updateGameScore(teamId, gameId, entry.scoreBefore, user);
        scoreReverted = true;
      }

      await dependencies.deleteDoc(eventRef);
    } catch (error) {
      if (aggregateReverted && entry.aggregatePlayerId && entry.aggregateStatKey && entry.aggregateDelta !== 0) {
        await applyAggregateWrite({
          dependencies,
          teamId,
          gameId,
          playerId: entry.aggregatePlayerId,
          playerName: entry.playerName,
          playerNumber: entry.playerNumber,
          statKey: entry.aggregateStatKey,
          delta: entry.aggregateDelta,
          statConfig
        });
      }
      if (opponentStatsReverted && entry.opponentStatsEntryId && entry.opponentStatsEntryAfter) {
        await applyOpponentStatsWrite({
          dependencies,
          teamId,
          gameId,
          entryId: entry.opponentStatsEntryId,
          entry: entry.opponentStatsEntryAfter
        });
      }
      if (scoreReverted) {
        await dependencies.updateGameScore(teamId, gameId, entry.scoreAfter, user);
      }
      throw error;
    }

    currentScore = entry.scoreBefore;
    eventLog.pop();
    return entry;
  }

  function getEventLog() {
    return eventLog.map((entry) => ({
      ...entry,
      scoreBefore: { ...entry.scoreBefore },
      scoreAfter: { ...entry.scoreAfter },
      event: { ...entry.event }
    }));
  }

  function getCurrentScore() {
    return { ...currentScore };
  }

  return {
    recordEvent,
    undoLastEvent,
    getEventLog,
    getCurrentScore
  };
}

export function createDefaultStatTrackingService(options: {
  statConfig?: TrackerStatConfig;
  initialScore?: Partial<TrackerScoreState>;
  initialEventLog?: TrackerLogEntry[];
  updateGameScore: StatTrackingDependencies['updateGameScore'];
}) {
  return createStatTrackingService({
    ...options,
    dependencies: {
      db,
      doc,
      setDoc,
      deleteDoc,
      increment,
      updateGameScore: options.updateGameScore
    }
  });
}

export { buildTrackerEventDocument };
export type { TrackerEventDocument, TrackerEventInput, TrackerUndoData, TrackerUser };
