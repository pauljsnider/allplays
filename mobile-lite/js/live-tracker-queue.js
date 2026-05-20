export function buildLiveTrackerQueueStorageKey(teamId, gameId) {
  if (!teamId || !gameId) return '';
  return `liveTrackerPendingQueue:${teamId}:${gameId}`;
}

export function buildLiveTrackerPendingFinishStorageKey(teamId, gameId) {
  if (!teamId || !gameId) return '';
  return `liveTrackerPendingFinish:${teamId}:${gameId}`;
}

export function buildLiveTrackerStateStorageKey(teamId, gameId) {
  if (!teamId || !gameId) return '';
  return `liveTrackerState:${teamId}:${gameId}`;
}

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function normalizeNumber(value, fallback = 0) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : fallback;
}

function normalizeNonNegativeNumber(value, fallback = 0) {
  return Math.max(0, normalizeNumber(value, fallback));
}

function normalizeArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeObject(value) {
  return isPlainObject(value) ? value : {};
}

function normalizeTrackerStatePayload(payload) {
  if (!isPlainObject(payload)) return null;

  const rawState = isPlainObject(payload.state) ? payload.state : payload;
  const period = typeof rawState.period === 'string' && rawState.period.trim()
    ? rawState.period
    : 'Q1';

  return {
    version: 1,
    savedAt: normalizeNumber(payload.savedAt, Date.now()),
    state: {
      period,
      clock: normalizeNonNegativeNumber(rawState.clock),
      running: Boolean(rawState.running),
      home: normalizeNonNegativeNumber(rawState.home),
      away: normalizeNonNegativeNumber(rawState.away),
      starters: normalizeArray(rawState.starters),
      bench: normalizeArray(rawState.bench),
      onCourt: normalizeArray(rawState.onCourt),
      stats: normalizeObject(rawState.stats),
      log: normalizeArray(rawState.log),
      subs: normalizeArray(rawState.subs),
      opp: normalizeArray(rawState.opp),
      pendingOut: rawState.pendingOut ?? null,
      pendingIn: rawState.pendingIn ?? null,
      subQueue: normalizeArray(rawState.subQueue),
      queueMode: Boolean(rawState.queueMode),
      history: normalizeArray(rawState.history),
      scoreLogIsComplete: rawState.scoreLogIsComplete !== false
    }
  };
}

export function readPersistedLiveTrackerQueue(storage, teamId, gameId) {
  const key = buildLiveTrackerQueueStorageKey(teamId, gameId);
  if (!key || !storage || typeof storage.getItem !== 'function') return [];

  try {
    const raw = storage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((entry) => entry && typeof entry === 'object')
      : [];
  } catch (error) {
    console.warn('Failed to restore live tracker queue:', error);
    return [];
  }
}

export function writePersistedLiveTrackerQueue(storage, teamId, gameId, queue) {
  const key = buildLiveTrackerQueueStorageKey(teamId, gameId);
  if (!key || !storage) return;

  try {
    if (Array.isArray(queue) && queue.length > 0 && typeof storage.setItem === 'function') {
      storage.setItem(key, JSON.stringify(queue));
      return;
    }
    if (typeof storage.removeItem === 'function') {
      storage.removeItem(key);
    }
  } catch (error) {
    console.warn('Failed to persist live tracker queue:', error);
  }
}

export function readPersistedLiveTrackerPendingFinish(storage, teamId, gameId) {
  const key = buildLiveTrackerPendingFinishStorageKey(teamId, gameId);
  if (!key || !storage || typeof storage.getItem !== 'function') return null;

  try {
    const raw = storage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    if (!parsed.finishPlan || typeof parsed.finishPlan !== 'object') return null;
    return parsed;
  } catch (error) {
    console.warn('Failed to restore pending live tracker finalization:', error);
    return null;
  }
}

export function writePersistedLiveTrackerPendingFinish(storage, teamId, gameId, pendingFinish) {
  const key = buildLiveTrackerPendingFinishStorageKey(teamId, gameId);
  if (!key || !storage) return;

  try {
    if (pendingFinish && typeof pendingFinish === 'object' && typeof storage.setItem === 'function') {
      storage.setItem(key, JSON.stringify(pendingFinish));
      return;
    }
    if (typeof storage.removeItem === 'function') {
      storage.removeItem(key);
    }
  } catch (error) {
    console.warn('Failed to persist pending live tracker finalization:', error);
  }
}

export function readPersistedLiveTrackerState(storage, teamId, gameId) {
  const key = buildLiveTrackerStateStorageKey(teamId, gameId);
  if (!key || !storage || typeof storage.getItem !== 'function') return null;

  try {
    const raw = storage.getItem(key);
    if (!raw) return null;
    return normalizeTrackerStatePayload(JSON.parse(raw));
  } catch (error) {
    console.warn('Failed to restore live tracker state:', error);
    return null;
  }
}

export function writePersistedLiveTrackerState(storage, teamId, gameId, trackerState) {
  const key = buildLiveTrackerStateStorageKey(teamId, gameId);
  if (!key || !storage) return;

  try {
    const normalized = normalizeTrackerStatePayload(trackerState);
    if (normalized && typeof storage.setItem === 'function') {
      storage.setItem(key, JSON.stringify(normalized));
      return;
    }
    if (typeof storage.removeItem === 'function') {
      storage.removeItem(key);
    }
  } catch (error) {
    console.warn('Failed to persist live tracker state:', error);
  }
}
