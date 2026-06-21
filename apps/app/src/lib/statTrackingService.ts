import { db, deleteDoc, doc, increment, setDoc, splitPlayerStatsByVisibility } from './adapters/legacyStatTrackingDb';

export type TrackerScoreState = {
  homeScore: number;
  awayScore: number;
};

export type TrackerUser = {
  uid: string;
  displayName?: string | null;
  email?: string | null;
};

export type TrackerStatConfig = {
  columns?: string[];
  statDefinitions?: Array<{ id?: string; scope?: string; visibility?: string }>;
};

export type TrackerUndoData = {
  type?: string | null;
  playerId?: string | null;
  statKey?: string | null;
  value?: number | null;
  isOpponent?: boolean;
};

export type TrackerEventInput = {
  text: string;
  clock?: string | null;
  gameTime?: string | null;
  period?: string | null;
  timestamp?: number | Date | null;
  undoData?: TrackerUndoData | null;
  playerName?: string | null;
  playerNumber?: string | null;
  teamSide?: 'home' | 'away';
};

export type TrackerEventDocument = {
  text: string;
  gameTime: string;
  period: string;
  timestamp: number;
  type: string;
  playerId: string | null;
  statKey: string | null;
  value: number | null;
  isOpponent: boolean;
  createdBy: string;
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

const DEFAULT_SCORE: TrackerScoreState = { homeScore: 0, awayScore: 0 };
const BASE_TRACKER_PERIOD = 'Q1';
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

function normalizeTimestamp(value: unknown) {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? Date.now() : value.getTime();
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : Date.now();
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

function buildTrackerEventDocument(input: TrackerEventInput, user: TrackerUser): TrackerEventDocument {
  const undoData = input.undoData || {};
  const statKey = normalizeStatKey(undoData.statKey);
  const value = Number(undoData.value);

  return {
    text: String(input.text || ''),
    gameTime: String(input.gameTime || input.clock || ''),
    period: String(input.period || BASE_TRACKER_PERIOD),
    timestamp: normalizeTimestamp(input.timestamp),
    type: String(undoData.type || 'game_log'),
    playerId: normalizeText(undoData.playerId) || null,
    statKey: statKey || null,
    value: Number.isFinite(value) ? value : null,
    isOpponent: undoData.isOpponent === true,
    createdBy: String(user.uid || '')
  };
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

export function createStatTrackingService({
  statConfig = {},
  initialScore = DEFAULT_SCORE,
  dependencies
}: {
  statConfig?: TrackerStatConfig;
  initialScore?: Partial<TrackerScoreState>;
  dependencies: StatTrackingDependencies;
}) {
  const eventLog: TrackerLogEntry[] = [];
  const allowedStatKeys = collectAllowedStatKeys(statConfig);
  const nextEventId = createEventIdFactory();
  let currentScore = normalizeScoreState(initialScore);

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
      if (event.isOpponent) {
        scoreAfter.awayScore = normalizeScoreValue(scoreAfter.awayScore + delta);
      } else {
        const teamSide = input.teamSide === 'away' ? 'away' : 'home';
        if (teamSide === 'away') {
          scoreAfter.awayScore = normalizeScoreValue(scoreAfter.awayScore + delta);
        } else {
          scoreAfter.homeScore = normalizeScoreValue(scoreAfter.homeScore + delta);
        }
      }
    }

    const eventId = nextEventId();
    const eventRef = dependencies.doc(dependencies.db, `teams/${teamId}/games/${gameId}/events`, eventId);
    let aggregateApplied = false;
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
