// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const observerState = vi.hoisted(() => ({
  callbacks: [] as Array<(user: any) => void>,
  unsubscribes: [] as Array<() => void>
}));

const authServiceMocks = vi.hoisted(() => ({
  observeFirebaseUser: vi.fn((callback: (user: unknown) => void) => {
    const unsubscribe = vi.fn(() => undefined);
    observerState.callbacks.push(callback);
    observerState.unsubscribes.push(unsubscribe);
    return unsubscribe;
  }),
  hydrateFirebaseUser: vi.fn(),
  signOut: vi.fn(() => Promise.resolve())
}));

const authBootstrapMocks = vi.hoisted(() => ({
  clearAuthBootstrapHint: vi.fn(),
  writeAuthBootstrapHint: vi.fn()
}));

const cacheResetMocks = vi.hoisted(() => ({
  resetAppSearchCache: vi.fn(),
  resetChatAiModel: vi.fn(),
  resetGameWrapupAiModel: vi.fn(),
  resetPrivateAiModel: vi.fn(),
  resetLineupAiModel: vi.fn()
}));

vi.mock('./authService', () => authServiceMocks);
vi.mock('./authBootstrapHint', () => authBootstrapMocks);
vi.mock('./searchService', () => ({ resetAppSearchCache: cacheResetMocks.resetAppSearchCache }));
vi.mock('./chatService', () => ({ resetChatAiModel: cacheResetMocks.resetChatAiModel }));
vi.mock('./gameWrapupService', () => ({ resetGameWrapupAiModel: cacheResetMocks.resetGameWrapupAiModel }));
vi.mock('./privateAiService', () => ({ resetPrivateAiModel: cacheResetMocks.resetPrivateAiModel }));
vi.mock('./gameDayLineupBuilder', () => ({ resetLineupAiModel: cacheResetMocks.resetLineupAiModel }));

import { useAuth } from './useAuth';

beforeEach(() => {
  vi.clearAllMocks();
  observerState.callbacks = [];
  observerState.unsubscribes = [];
  authServiceMocks.observeFirebaseUser.mockImplementation((callback: (user: unknown) => void) => {
    const unsubscribe = vi.fn(() => undefined);
    observerState.callbacks.push(callback);
    observerState.unsubscribes.push(unsubscribe);
    return unsubscribe;
  });
  authServiceMocks.hydrateFirebaseUser.mockImplementation(async (firebaseUser: { uid: string }) => hydrated(firebaseUser.uid));
  authServiceMocks.signOut.mockResolvedValue(undefined);
});

describe('useAuth transition invalidation', () => {
  it('keeps A signed out when A hydration resolves after an A-to-null observer transition', async () => {
    const userA = createDeferred<ReturnType<typeof hydrated>>();
    authServiceMocks.hydrateFirebaseUser.mockReturnValueOnce(userA.promise);
    const { result } = renderHook(() => useAuth());

    await emitObserver(0, { uid: 'user-a' });
    await emitObserver(0, null);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.user).toBeNull();

    userA.resolve(hydrated('user-a'));
    await act(async () => userA.promise);
    expect(result.current.user).toBeNull();
    expect(authBootstrapMocks.writeAuthBootstrapHint).not.toHaveBeenCalled();
  });

  it('keeps B authoritative when A hydration finishes after an A-to-B switch', async () => {
    const userA = createDeferred<ReturnType<typeof hydrated>>();
    const userB = createDeferred<ReturnType<typeof hydrated>>();
    authServiceMocks.hydrateFirebaseUser.mockImplementation((firebaseUser: { uid: string }) =>
      firebaseUser.uid === 'user-a' ? userA.promise : userB.promise
    );
    const { result } = renderHook(() => useAuth());

    await emitObserver(0, { uid: 'user-a' });
    await emitObserver(0, { uid: 'user-b' });
    userB.resolve(hydrated('user-b'));
    await act(async () => userB.promise);
    await waitFor(() => expect(result.current.user?.uid).toBe('user-b'));

    userA.resolve(hydrated('user-a'));
    await act(async () => userA.promise);
    expect(result.current.user?.uid).toBe('user-b');
    expect(authBootstrapMocks.writeAuthBootstrapHint).toHaveBeenCalledTimes(1);
    expect(authBootstrapMocks.writeAuthBootstrapHint).toHaveBeenCalledWith(expect.objectContaining({ uid: 'user-b' }));
  });

  it('ignores a stale A hydration rejection after B has committed', async () => {
    const userA = createDeferred<ReturnType<typeof hydrated>>();
    authServiceMocks.hydrateFirebaseUser.mockImplementation((firebaseUser: { uid: string }) =>
      firebaseUser.uid === 'user-a' ? userA.promise : Promise.resolve(hydrated('user-b'))
    );
    const { result } = renderHook(() => useAuth());

    await emitObserver(0, { uid: 'user-a' });
    await emitObserver(0, { uid: 'user-b' });
    await waitFor(() => expect(result.current.user?.uid).toBe('user-b'));

    userA.reject(new Error('late A profile failure'));
    await act(async () => userA.promise.catch(() => undefined));
    expect(result.current.user?.uid).toBe('user-b');
    expect(result.current.error).toBeNull();
  });

  it('lets a long-lived B observer invalidate an in-flight refresh of A', async () => {
    const refreshA = createDeferred<ReturnType<typeof hydrated>>();
    authServiceMocks.hydrateFirebaseUser.mockImplementation((firebaseUser: { uid: string }) =>
      firebaseUser.uid === 'user-a' ? refreshA.promise : Promise.resolve(hydrated('user-b'))
    );
    const { result } = renderHook(() => useAuth());

    let refreshPromise!: Promise<unknown>;
    act(() => {
      refreshPromise = result.current.refresh();
    });
    await waitFor(() => expect(observerState.callbacks).toHaveLength(2));
    await emitObserver(1, { uid: 'user-a' });
    await emitObserver(0, { uid: 'user-b' });
    await waitFor(() => expect(result.current.user?.uid).toBe('user-b'));

    refreshA.resolve(hydrated('user-a'));
    await act(async () => refreshPromise);
    expect(result.current.user?.uid).toBe('user-b');
  });

  it('lets sign-out invalidate a pending hydration and never restores that user', async () => {
    const userA = createDeferred<ReturnType<typeof hydrated>>();
    authServiceMocks.hydrateFirebaseUser.mockReturnValueOnce(userA.promise);
    const { result } = renderHook(() => useAuth());

    await emitObserver(0, { uid: 'user-a' });
    await act(async () => result.current.signOut());
    expect(result.current.user).toBeNull();

    userA.resolve(hydrated('user-a'));
    await act(async () => userA.promise);
    expect(result.current.user).toBeNull();
    expect(authBootstrapMocks.writeAuthBootstrapHint).not.toHaveBeenCalled();
  });

  it('does not commit a hydration that resolves after unmount', async () => {
    const userA = createDeferred<ReturnType<typeof hydrated>>();
    authServiceMocks.hydrateFirebaseUser.mockReturnValueOnce(userA.promise);
    const { unmount } = renderHook(() => useAuth());

    await emitObserver(0, { uid: 'user-a' });
    unmount();
    userA.resolve(hydrated('user-a'));
    await act(async () => userA.promise);

    expect(authBootstrapMocks.writeAuthBootstrapHint).not.toHaveBeenCalled();
    expect(observerState.unsubscribes[0]).toHaveBeenCalledTimes(1);
  });

  it('unsubscribes a refresh observer even when it emits synchronously during registration', async () => {
    const longLivedUnsubscribe = vi.fn(() => undefined);
    const synchronousUnsubscribe = vi.fn(() => undefined);
    authServiceMocks.observeFirebaseUser
      .mockImplementationOnce((callback: (user: unknown) => void) => {
        observerState.callbacks.push(callback);
        observerState.unsubscribes.push(longLivedUnsubscribe);
        return longLivedUnsubscribe;
      })
      .mockImplementationOnce((callback: (user: unknown) => void) => {
        callback({ uid: 'user-a' });
        return synchronousUnsubscribe;
      });
    const { result } = renderHook(() => useAuth());

    await act(async () => result.current.refresh());

    expect(synchronousUnsubscribe).toHaveBeenCalledTimes(1);
    expect(result.current.user?.uid).toBe('user-a');
  });
});

describe('useAuth signOut', () => {
  it('clears every per-user module cache so a second user never sees stale cached data', async () => {
    const { result } = renderHook(() => useAuth());

    await emitObserver(0, null);
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => result.current.signOut());

    expect(cacheResetMocks.resetAppSearchCache).toHaveBeenCalledTimes(1);
    expect(cacheResetMocks.resetChatAiModel).toHaveBeenCalledTimes(1);
    expect(cacheResetMocks.resetGameWrapupAiModel).toHaveBeenCalledTimes(1);
    expect(cacheResetMocks.resetPrivateAiModel).toHaveBeenCalledTimes(1);
    expect(cacheResetMocks.resetLineupAiModel).toHaveBeenCalledTimes(1);
  });
});

async function emitObserver(index: number, user: any) {
  await act(async () => {
    observerState.callbacks[index]?.(user);
    await Promise.resolve();
  });
}

function hydrated(uid: string) {
  return {
    user: {
      uid,
      email: `${uid}@example.com`,
      displayName: uid,
      roles: []
    },
    profile: { uid }
  };
}

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}
