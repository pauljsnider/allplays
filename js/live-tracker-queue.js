export function buildLiveTrackerQueueStorageKey(teamId, gameId) {
  if (!teamId || !gameId) return '';
  return `liveTrackerPendingQueue:${teamId}:${gameId}`;
}

export function buildLiveTrackerPendingFinishStorageKey(teamId, gameId) {
  if (!teamId || !gameId) return '';
  return `liveTrackerPendingFinish:${teamId}:${gameId}`;
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
