import { describe, expect, it, vi } from 'vitest';
import {
  buildLiveTrackerQueueStorageKey,
  readPersistedLiveTrackerQueue,
  writePersistedLiveTrackerQueue
} from '../../js/live-tracker-queue.js';

function createStorage() {
  const state = {};
  return {
    state,
    getItem: vi.fn((key) => state[key] ?? null),
    setItem: vi.fn((key, value) => {
      state[key] = String(value);
    }),
    removeItem: vi.fn((key) => {
      delete state[key];
    })
  };
}

describe('live tracker queue persistence', () => {
  it('builds a stable storage key per team and game', () => {
    expect(buildLiveTrackerQueueStorageKey('team-1', 'game-9')).toBe('liveTrackerPendingQueue:team-1:game-9');
    expect(buildLiveTrackerQueueStorageKey('', 'game-9')).toBe('');
  });

  it('round-trips persisted pending events and clears storage when empty', () => {
    const storage = createStorage();
    const queue = [
      { type: 'stat', statKey: 'pts', value: 2 },
      { type: 'lineup', onCourt: ['p1', 'p2', 'p3', 'p4', 'p5'] }
    ];

    writePersistedLiveTrackerQueue(storage, 'team-1', 'game-9', queue);
    expect(readPersistedLiveTrackerQueue(storage, 'team-1', 'game-9')).toEqual(queue);

    writePersistedLiveTrackerQueue(storage, 'team-1', 'game-9', []);
    expect(storage.removeItem).toHaveBeenCalledWith('liveTrackerPendingQueue:team-1:game-9');
    expect(readPersistedLiveTrackerQueue(storage, 'team-1', 'game-9')).toEqual([]);
  });

  it('ignores malformed persisted queue payloads', () => {
    const storage = createStorage();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    storage.state['liveTrackerPendingQueue:team-1:game-9'] = '{bad json';

    expect(readPersistedLiveTrackerQueue(storage, 'team-1', 'game-9')).toEqual([]);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});
