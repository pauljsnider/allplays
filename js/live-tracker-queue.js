export function buildLiveTrackerQueueStorageKey(teamId, gameId) {
  if (!teamId || !gameId) return '';
  return `liveTrackerPendingQueue:${teamId}:${gameId}`;
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
