import { describe, expect, it, vi } from 'vitest';
import {
  buildLiveTrackerPendingFinishStorageKey,
  buildLiveTrackerQueueStorageKey,
  buildLiveTrackerStateStorageKey,
  readPersistedLiveTrackerPendingFinish,
  readPersistedLiveTrackerQueue,
  readPersistedLiveTrackerState,
  writePersistedLiveTrackerPendingFinish,
  writePersistedLiveTrackerQueue,
  writePersistedLiveTrackerState
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
    expect(buildLiveTrackerPendingFinishStorageKey('team-1', 'game-9')).toBe('liveTrackerPendingFinish:team-1:game-9');
    expect(buildLiveTrackerStateStorageKey('team-1', 'game-9')).toBe('liveTrackerState:team-1:game-9');
    expect(buildLiveTrackerQueueStorageKey('', 'game-9')).toBe('');
    expect(buildLiveTrackerPendingFinishStorageKey('', 'game-9')).toBe('');
    expect(buildLiveTrackerStateStorageKey('', 'game-9')).toBe('');
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

  it('round-trips and clears a pending finalization intent', () => {
    const storage = createStorage();
    const pendingFinish = {
      version: 1,
      queuedAt: 123,
      finishPlan: {
        finalHome: 10,
        finalAway: 8,
        eventWrites: [{ data: { text: 'Bucket' } }],
        aggregatedStatsWrites: [],
        gameUpdate: { homeScore: 10, awayScore: 8, status: 'completed' }
      }
    };

    writePersistedLiveTrackerPendingFinish(storage, 'team-1', 'game-9', pendingFinish);
    expect(readPersistedLiveTrackerPendingFinish(storage, 'team-1', 'game-9')).toEqual(pendingFinish);

    writePersistedLiveTrackerPendingFinish(storage, 'team-1', 'game-9', null);
    expect(storage.removeItem).toHaveBeenCalledWith('liveTrackerPendingFinish:team-1:game-9');
    expect(readPersistedLiveTrackerPendingFinish(storage, 'team-1', 'game-9')).toBeNull();
  });

  it('ignores malformed pending finalization payloads', () => {
    const storage = createStorage();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    storage.state['liveTrackerPendingFinish:team-1:game-9'] = '{bad json';

    expect(readPersistedLiveTrackerPendingFinish(storage, 'team-1', 'game-9')).toBeNull();
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('round-trips local tracker UI state needed to resume after refresh', () => {
    const storage = createStorage();
    const trackerState = {
      version: 1,
      savedAt: 456,
      state: {
        period: 'Q3',
        clock: 185000,
        running: true,
        home: 21,
        away: 19,
        starters: ['p1'],
        bench: ['p2'],
        onCourt: ['p1'],
        stats: { p1: { pts: 8, fouls: 1, time: 120000 } },
        log: [{ text: '#1 PTS +2', period: 'Q3', clock: '03:05' }],
        subs: [],
        opp: [{ id: 'opp1', name: 'Opponent', stats: { pts: 19 } }],
        pendingOut: null,
        pendingIn: null,
        subQueue: [],
        queueMode: false,
        history: [{ action: '#1 PTS +2', home: 19, away: 19 }],
        scoreLogIsComplete: true
      }
    };

    writePersistedLiveTrackerState(storage, 'team-1', 'game-9', trackerState);

    expect(readPersistedLiveTrackerState(storage, 'team-1', 'game-9')).toEqual(trackerState);

    writePersistedLiveTrackerState(storage, 'team-1', 'game-9', null);
    expect(storage.removeItem).toHaveBeenCalledWith('liveTrackerState:team-1:game-9');
    expect(readPersistedLiveTrackerState(storage, 'team-1', 'game-9')).toBeNull();
  });

  it('ignores malformed persisted tracker state payloads', () => {
    const storage = createStorage();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    storage.state['liveTrackerState:team-1:game-9'] = '{bad json';

    expect(readPersistedLiveTrackerState(storage, 'team-1', 'game-9')).toBeNull();
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});
