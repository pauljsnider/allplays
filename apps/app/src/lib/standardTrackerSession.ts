import type { TrackerLogEntry, TrackerScoreState } from './statTrackingService';
import type { StandardTrackerTallies } from './standardTrackerViewModel';

const SESSION_VERSION = 1;
const SESSION_PREFIX = 'allplays:standard-tracker';

export type StandardTrackerSessionState = {
  version: typeof SESSION_VERSION;
  teamId: string;
  gameId: string;
  statTrackerConfigId: string | null;
  score: TrackerScoreState;
  tallies: StandardTrackerTallies;
  opponentTallies: StandardTrackerTallies;
  eventLog: TrackerLogEntry[];
  updatedAt: number;
};

function normalizeText(value: unknown) {
  return String(value || '').trim();
}

function normalizeScoreValue(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function normalizeScore(score: Partial<TrackerScoreState> | null | undefined): TrackerScoreState {
  return {
    homeScore: normalizeScoreValue(score?.homeScore),
    awayScore: normalizeScoreValue(score?.awayScore)
  };
}

function normalizeTallies(input: unknown): StandardTrackerTallies {
  const source = input && typeof input === 'object' ? input as Record<string, unknown> : {};
  return Object.entries(source).reduce<StandardTrackerTallies>((tallies, [playerId, stats]) => {
    const normalizedPlayerId = normalizeText(playerId);
    if (!normalizedPlayerId || !stats || typeof stats !== 'object') return tallies;
    tallies[normalizedPlayerId] = Object.entries(stats as Record<string, unknown>).reduce<Record<string, number>>((playerTallies, [statKey, value]) => {
      const normalizedStatKey = normalizeText(statKey).toLowerCase();
      if (!normalizedStatKey) return playerTallies;
      playerTallies[normalizedStatKey] = normalizeScoreValue(value);
      return playerTallies;
    }, {});
    return tallies;
  }, {});
}

function getStorage() {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function getStandardTrackerSessionKey(teamId: string, gameId: string) {
  return `${SESSION_PREFIX}:${encodeURIComponent(teamId)}:${encodeURIComponent(gameId)}`;
}

export function readStandardTrackerSession(teamId: string, gameId: string, statTrackerConfigId: string | null = null): StandardTrackerSessionState | null {
  const storage = getStorage();
  const normalizedTeamId = normalizeText(teamId);
  const normalizedGameId = normalizeText(gameId);
  if (!storage || !normalizedTeamId || !normalizedGameId) return null;

  try {
    const parsed = JSON.parse(storage.getItem(getStandardTrackerSessionKey(normalizedTeamId, normalizedGameId)) || 'null') as Partial<StandardTrackerSessionState> | null;
    if (!parsed || parsed.version !== SESSION_VERSION) return null;
    if (parsed.teamId !== normalizedTeamId || parsed.gameId !== normalizedGameId) return null;
    const normalizedConfigId = normalizeText(statTrackerConfigId);
    const parsedConfigId = normalizeText(parsed.statTrackerConfigId);
    if (normalizedConfigId && parsedConfigId && normalizedConfigId !== parsedConfigId) return null;
    return {
      version: SESSION_VERSION,
      teamId: normalizedTeamId,
      gameId: normalizedGameId,
      statTrackerConfigId: parsedConfigId || null,
      score: normalizeScore(parsed.score),
      tallies: normalizeTallies(parsed.tallies),
      opponentTallies: normalizeTallies(parsed.opponentTallies),
      eventLog: Array.isArray(parsed.eventLog) ? parsed.eventLog as TrackerLogEntry[] : [],
      updatedAt: normalizeScoreValue(parsed.updatedAt)
    };
  } catch {
    return null;
  }
}

export function writeStandardTrackerSession(state: Omit<StandardTrackerSessionState, 'version' | 'updatedAt'>) {
  const storage = getStorage();
  const normalizedTeamId = normalizeText(state.teamId);
  const normalizedGameId = normalizeText(state.gameId);
  if (!storage || !normalizedTeamId || !normalizedGameId) return;

  const payload: StandardTrackerSessionState = {
    version: SESSION_VERSION,
    teamId: normalizedTeamId,
    gameId: normalizedGameId,
    statTrackerConfigId: normalizeText(state.statTrackerConfigId) || null,
    score: normalizeScore(state.score),
    tallies: normalizeTallies(state.tallies),
    opponentTallies: normalizeTallies(state.opponentTallies),
    eventLog: Array.isArray(state.eventLog) ? state.eventLog : [],
    updatedAt: Date.now()
  };

  try {
    storage.setItem(getStandardTrackerSessionKey(normalizedTeamId, normalizedGameId), JSON.stringify(payload));
  } catch {
    // Local restore is best effort; Firestore writes remain the source of truth.
  }
}
