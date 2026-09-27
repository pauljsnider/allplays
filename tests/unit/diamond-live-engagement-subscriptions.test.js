import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const firebaseMocks = vi.hoisted(() => ({
  collection: vi.fn(() => ({ type: "collection" })),
  db: { type: "db" },
  functions: { type: "functions" },
  getDocs: vi.fn(),
  httpsCallable: vi.fn(),
  limit: vi.fn((maximum) => ({ type: "limit", maximum })),
  onSnapshot: vi.fn(),
  orderBy: vi.fn((field, direction) => ({ type: "orderBy", field, direction })),
  query: vi.fn((...parts) => ({ type: "query", parts })),
}));

vi.mock("../../js/firebase.js?v=4433195", () => firebaseMocks);

import { subscribeReactions } from "../../js/diamond-live-engagement-subscriptions.js";

const source = readFileSync(
  new URL("../../js/diamond-live-engagement-subscriptions.js", import.meta.url),
  "utf8",
);

describe("Diamond live engagement subscriptions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("pins every live query to the exact Diamond generation", () => {
    expect(source).toContain('/diamondLiveGenerations/${instanceId.toLowerCase()}/${collectionId}');
    expect(source).toContain('orderBy("createdAt", "desc")');
    expect(source).toContain('"chat"');
    expect(source).toContain('"reactions"');
    expect(source).toContain('httpsCallable(functions, functionName)(request)');
    expect(source).toContain("pendingChatRequests.get(pendingKey) || secureRequestId()");
    expect(source).toContain("pendingReactionRequests.get(pendingKey) || secureRequestId()");
  });

  it("fails closed for malformed paths and generation identities", () => {
    expect(source).toContain('value.includes("/")');
    expect(source).toContain("UUID_V4_PATTERN.test(instanceId)");
    expect(source).not.toContain("Math.random");
  });

  it("baselines cached and authoritative snapshots before streaming new reactions", () => {
    const snapshots = [];
    const unsubscribe = vi.fn();
    firebaseMocks.onSnapshot.mockImplementation((...args) => {
      snapshots.push(args);
      return unsubscribe;
    });
    const callback = vi.fn();
    const onError = vi.fn();

    expect(subscribeReactions(
      "team-1",
      "game-1",
      { instanceId: "00000000-0000-4000-8000-000000000001" },
      callback,
      onError,
    )).toBe(unsubscribe);
    expect(snapshots[0][1]).toEqual({ includeMetadataChanges: true });
    const onNext = snapshots[0][2];
    const onSnapshotError = snapshots[0][3];

    onSnapshotError(new Error("offline before bootstrap"));
    onNext(reactionSnapshot([], { fromCache: true }));
    const cachedExisting = reactionChange("added", "existing-1", "heart");
    onNext(reactionSnapshot([cachedExisting], { fromCache: true }));
    onNext(reactionSnapshot([], { fromCache: false }, [cachedExisting]));
    expect(onError).toHaveBeenCalledTimes(1);
    expect(callback).not.toHaveBeenCalled();

    onNext(reactionSnapshot([], { fromCache: true }));
    onNext(reactionSnapshot([
      reactionChange("modified", "existing-1", "wow"),
      reactionChange("added", "new-1", "clap"),
      reactionChange("removed", "existing-1", "heart"),
      reactionChange("added", "new-2", "hundred"),
    ], { fromCache: false }));
    onNext(reactionSnapshot([
      reactionChange("added", "new-1", "clap"),
    ], { fromCache: true }));

    expect(callback.mock.calls.map(([reaction]) => reaction)).toEqual([
      { id: "new-1", type: "clap" },
      { id: "new-2", type: "hundred" },
    ]);
  });

  it("suppresses a server bootstrap that expands an empty cached snapshot", () => {
    let onNext;
    firebaseMocks.onSnapshot.mockImplementation((_query, _options, next) => {
      onNext = next;
      return vi.fn();
    });
    const callback = vi.fn();

    subscribeReactions(
      "team-1",
      "game-1",
      { instanceId: "00000000-0000-4000-8000-000000000001" },
      callback,
    );
    onNext(reactionSnapshot([], { fromCache: true }));
    onNext(reactionSnapshot([
      reactionChange("added", "existing-1", "heart"),
      reactionChange("added", "existing-2", "fire"),
    ], { fromCache: false }));
    expect(callback).not.toHaveBeenCalled();
  });

  it("creates a fresh baseline for every explicit subscription lifecycle", () => {
    const snapshots = [];
    const unsubscribers = [];
    firebaseMocks.onSnapshot.mockImplementation((_query, _options, onNext) => {
      snapshots.push(onNext);
      const unsubscribe = vi.fn();
      unsubscribers.push(unsubscribe);
      return unsubscribe;
    });
    const firstCallback = vi.fn();
    const secondCallback = vi.fn();
    const options = { instanceId: "00000000-0000-4000-8000-000000000001" };

    subscribeReactions("team-1", "game-1", options, firstCallback);
    snapshots[0](reactionSnapshot([], {}));
    snapshots[0](reactionSnapshot([
      reactionChange("added", "first-live", "heart"),
    ], {}));
    expect(firstCallback).toHaveBeenCalledWith({ id: "first-live", type: "heart" });

    unsubscribers[0]();
    subscribeReactions("team-1", "game-1", options, secondCallback);
    expect(unsubscribers[0]).toHaveBeenCalledTimes(1);
    snapshots[1](reactionSnapshot([
      reactionChange("added", "first-live", "heart"),
      reactionChange("added", "while-disconnected", "fire"),
    ], {}));
    expect(secondCallback).not.toHaveBeenCalled();
    snapshots[1](reactionSnapshot([
      reactionChange("added", "second-live", "wow"),
    ], {}));
    expect(secondCallback).toHaveBeenCalledWith({ id: "second-live", type: "wow" });
  });
});

function reactionChange(type, id, reactionType) {
  return {
    type,
    doc: {
      id,
      data: () => ({ type: reactionType }),
    },
  };
}

function reactionSnapshot(changes, metadata, currentChanges = changes) {
  return {
    docs: currentChanges
      .filter((change) => change.type !== "removed")
      .map((change) => change.doc),
    metadata,
    docChanges: () => changes,
  };
}
