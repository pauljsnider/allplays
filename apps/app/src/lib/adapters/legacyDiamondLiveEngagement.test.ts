import { beforeEach, describe, expect, it, vi } from 'vitest';

const firebaseMocks = vi.hoisted(() => ({
  collection: vi.fn(() => ({ type: 'collection' })),
  db: { type: 'db' },
  functions: { type: 'functions' },
  httpsCallable: vi.fn(),
  limit: vi.fn((maximum: number) => ({ type: 'limit', maximum })),
  onSnapshot: vi.fn(),
  orderBy: vi.fn((field: string, direction: string) => ({ type: 'orderBy', field, direction })),
  query: vi.fn((...parts: unknown[]) => ({ type: 'query', parts })),
}));

vi.mock('@legacy/firebase.js', () => firebaseMocks);

import { subscribeDiamondLiveReactions } from './legacyDiamondLiveEngagement';

type SnapshotCallback = (snapshot: ReturnType<typeof reactionSnapshot>) => void;

describe('legacyDiamondLiveEngagement reaction subscriptions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('baselines cache hydration and emits later added reactions once in order', () => {
    const snapshots: unknown[][] = [];
    const unsubscribe = vi.fn();
    firebaseMocks.onSnapshot.mockImplementation((...args) => {
      snapshots.push(args);
      return unsubscribe;
    });
    const callback = vi.fn();
    const onError = vi.fn();

    expect(subscribeDiamondLiveReactions(
      'team-1',
      'game-1',
      '00000000-0000-4000-8000-000000000001',
      callback,
      onError,
    )).toBe(unsubscribe);
    expect(snapshots[0][1]).toEqual({ includeMetadataChanges: true });
    const onNext = snapshots[0][2] as SnapshotCallback;
    const onSnapshotError = snapshots[0][3] as (error: unknown) => void;

    onSnapshotError(new Error('offline before bootstrap'));
    onNext(reactionSnapshot([], { fromCache: true }));
    const cachedExisting = reactionChange('added', 'existing-1', 'heart');
    onNext(reactionSnapshot([cachedExisting], { fromCache: true }));
    onNext(reactionSnapshot([], { fromCache: false }, [cachedExisting]));
    expect(onError).toHaveBeenCalledTimes(1);
    expect(callback).not.toHaveBeenCalled();

    onNext(reactionSnapshot([], { fromCache: true }));
    onNext(reactionSnapshot([
      reactionChange('modified', 'existing-1', 'wow'),
      reactionChange('added', 'new-1', 'clap'),
      reactionChange('removed', 'existing-1', 'heart'),
      reactionChange('added', 'new-2', 'hundred'),
    ], { fromCache: false }));
    onNext(reactionSnapshot([
      reactionChange('added', 'new-1', 'clap'),
    ], { fromCache: true }));

    expect(callback.mock.calls.map(([reaction]) => reaction)).toEqual([
      { id: 'new-1', type: 'clap' },
      { id: 'new-2', type: 'hundred' },
    ]);
  });

  it('suppresses a server bootstrap that expands an empty cached snapshot', () => {
    let onNext: SnapshotCallback = () => {};
    firebaseMocks.onSnapshot.mockImplementation((_query, _options, next) => {
      onNext = next;
      return vi.fn();
    });
    const callback = vi.fn();

    subscribeDiamondLiveReactions(
      'team-1',
      'game-1',
      '00000000-0000-4000-8000-000000000001',
      callback,
    );
    onNext(reactionSnapshot([], { fromCache: true }));
    onNext(reactionSnapshot([
      reactionChange('added', 'existing-1', 'heart'),
      reactionChange('added', 'existing-2', 'fire'),
    ], { fromCache: false }));
    expect(callback).not.toHaveBeenCalled();
  });

  it('starts a new baseline after unsubscribe and resubscribe', () => {
    const snapshots: SnapshotCallback[] = [];
    const unsubscribers: Array<() => void> = [];
    firebaseMocks.onSnapshot.mockImplementation((_query, _options, onNext) => {
      snapshots.push(onNext);
      const unsubscribe = vi.fn();
      unsubscribers.push(unsubscribe);
      return unsubscribe;
    });
    const firstCallback = vi.fn();
    const secondCallback = vi.fn();
    const instanceId = '00000000-0000-4000-8000-000000000001';

    subscribeDiamondLiveReactions('team-1', 'game-1', instanceId, firstCallback);
    snapshots[0](reactionSnapshot([], {}));
    snapshots[0](reactionSnapshot([
      reactionChange('added', 'first-live', 'heart'),
    ], {}));
    expect(firstCallback).toHaveBeenCalledWith({ id: 'first-live', type: 'heart' });

    unsubscribers[0]();
    subscribeDiamondLiveReactions('team-1', 'game-1', instanceId, secondCallback);
    expect(unsubscribers[0]).toHaveBeenCalledTimes(1);
    snapshots[1](reactionSnapshot([
      reactionChange('added', 'first-live', 'heart'),
      reactionChange('added', 'while-disconnected', 'fire'),
    ], {}));
    expect(secondCallback).not.toHaveBeenCalled();
    snapshots[1](reactionSnapshot([
      reactionChange('added', 'second-live', 'wow'),
    ], {}));
    expect(secondCallback).toHaveBeenCalledWith({ id: 'second-live', type: 'wow' });
  });
});

function reactionChange(type: string, id: string, reactionType: string) {
  return {
    type,
    doc: {
      id,
      data: () => ({ type: reactionType }),
    },
  };
}

function reactionSnapshot(
  changes: ReturnType<typeof reactionChange>[],
  metadata: { fromCache?: boolean },
  currentChanges: ReturnType<typeof reactionChange>[] = changes,
) {
  return {
    docs: currentChanges
      .filter((change) => change.type !== 'removed')
      .map((change) => change.doc),
    metadata,
    docChanges: () => changes,
  };
}
