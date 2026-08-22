// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const authServiceMocks = vi.hoisted(() => ({
  observeFirebaseUser: vi.fn((callback: (user: unknown) => void) => {
    callback(null);
    return () => undefined;
  }),
  hydrateFirebaseUser: vi.fn(),
  signOut: vi.fn(() => Promise.resolve())
}));

const cacheResetMocks = vi.hoisted(() => ({
  resetAppSearchCache: vi.fn(),
  resetChatAiModel: vi.fn(),
  resetGameWrapupAiModel: vi.fn(),
  resetPrivateAiModel: vi.fn(),
  resetLineupAiModel: vi.fn()
}));

vi.mock('./authService', () => authServiceMocks);
vi.mock('./searchService', () => ({ resetAppSearchCache: cacheResetMocks.resetAppSearchCache }));
vi.mock('./chatService', () => ({ resetChatAiModel: cacheResetMocks.resetChatAiModel }));
vi.mock('./gameWrapupService', () => ({ resetGameWrapupAiModel: cacheResetMocks.resetGameWrapupAiModel }));
vi.mock('./privateAiService', () => ({ resetPrivateAiModel: cacheResetMocks.resetPrivateAiModel }));
vi.mock('./gameDayLineupBuilder', () => ({ resetLineupAiModel: cacheResetMocks.resetLineupAiModel }));

import { clearPerUserCaches, useAuth } from './useAuth';

afterEach(() => {
  vi.clearAllMocks();
});

describe('useAuth signOut', () => {
  it('clears every per-user module cache so a second user signing in on the same tab never sees stale cached data', async () => {
    const { result } = renderHook(() => useAuth());

    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.signOut();
    });

    expect(cacheResetMocks.resetAppSearchCache).toHaveBeenCalledTimes(1);
    expect(cacheResetMocks.resetChatAiModel).toHaveBeenCalledTimes(1);
    expect(cacheResetMocks.resetGameWrapupAiModel).toHaveBeenCalledTimes(1);
    expect(cacheResetMocks.resetPrivateAiModel).toHaveBeenCalledTimes(1);
    expect(cacheResetMocks.resetLineupAiModel).toHaveBeenCalledTimes(1);
  });

  it('continues clearing independently loaded caches when one module import fails', async () => {
    const firstReset = vi.fn();
    const lastReset = vi.fn();

    await expect(clearPerUserCaches([
      async () => firstReset,
      async () => {
        throw new Error('stale offline chunk');
      },
      async () => lastReset
    ])).rejects.toThrow('One or more per-user caches could not be reset.');

    expect(firstReset).toHaveBeenCalledTimes(1);
    expect(lastReset).toHaveBeenCalledTimes(1);
  });
});

describe('useAuth profile hydration', () => {
  it.each(['success', 'fallback'] as const)('exposes %s profile hydration metadata', async (profileHydration) => {
    authServiceMocks.observeFirebaseUser.mockImplementation((callback: (user: unknown) => void) => {
      callback({ uid: 'user-1' });
      return () => undefined;
    });
    authServiceMocks.hydrateFirebaseUser.mockResolvedValue({
      user: {
        uid: 'user-1',
        email: 'parent@example.com',
        displayName: 'Pat Parent',
        roles: ['parent']
      },
      profile: { fullName: 'Pat Parent' },
      profileHydration
    });

    const { result } = renderHook(() => useAuth());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.profileHydration).toBe(profileHydration);
  });

  it('publishes post-timeout access enrichment to an already-rendered consumer', async () => {
    authServiceMocks.observeFirebaseUser.mockImplementation((callback: (user: unknown) => void) => {
      callback({ uid: 'user-1' });
      return () => undefined;
    });
    authServiceMocks.hydrateFirebaseUser.mockResolvedValue({
      user: {
        uid: 'user-1',
        email: 'parent@example.com',
        displayName: 'Pat Parent',
        roles: ['member'],
        parentOf: []
      },
      profile: { roles: ['member'], parentOf: [] },
      profileHydration: 'success'
    });

    const { result } = renderHook(() => useAuth());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.user?.parentOf).toEqual([]);

    const options = authServiceMocks.hydrateFirebaseUser.mock.calls[0]?.[1];
    act(() => {
      options.onAccessEnriched({
        user: {
          uid: 'user-1',
          email: 'parent@example.com',
          displayName: 'Pat Parent',
          roles: ['member', 'parent'],
          parentOf: [{ teamId: 'team-late', playerId: 'player-late' }]
        },
        profile: {
          roles: ['member', 'parent'],
          parentOf: [{ teamId: 'team-late', playerId: 'player-late' }]
        },
        profileHydration: 'success'
      });
    });

    expect(result.current.user?.parentOf).toEqual([
      { teamId: 'team-late', playerId: 'player-late' }
    ]);
    expect(result.current.isParent).toBe(true);
  });

  it('does not overwrite access enrichment published before initial hydration resolves', async () => {
    let resolveHydration: ((value: any) => void) | undefined;
    const initialHydration = {
      user: {
        uid: 'user-1',
        email: 'coach@example.com',
        displayName: 'Casey Coach',
        roles: ['member'],
        coachOf: []
      },
      profile: { roles: ['member'], coachOf: [] },
      profileHydration: 'success' as const
    };
    const enrichedHydration = {
      user: {
        ...initialHydration.user,
        roles: ['member', 'coach'],
        coachOf: ['team-late']
      },
      profile: { roles: ['member', 'coach'], coachOf: ['team-late'] },
      profileHydration: 'success' as const
    };
    authServiceMocks.observeFirebaseUser.mockImplementation((callback: (user: unknown) => void) => {
      callback({ uid: 'user-1' });
      return () => undefined;
    });
    authServiceMocks.hydrateFirebaseUser.mockImplementation((_user, options) => {
      options.onAccessEnriched(enrichedHydration);
      return new Promise((resolve) => {
        resolveHydration = resolve;
      });
    });

    const { result } = renderHook(() => useAuth());
    await waitFor(() => expect(result.current.user?.coachOf).toEqual(['team-late']));

    await act(async () => {
      resolveHydration?.(initialHydration);
    });

    expect(result.current.loading).toBe(false);
    expect(result.current.user?.coachOf).toEqual(['team-late']);
    expect(result.current.isCoach).toBe(true);
  });

  it('returns and preserves access enrichment published before refresh hydration resolves', async () => {
    let observation = 0;
    let resolveHydration: ((value: any) => void) | undefined;
    const initialHydration = {
      user: { uid: 'user-1', email: 'coach@example.com', roles: ['member'], coachOf: [] },
      profile: { roles: ['member'], coachOf: [] },
      profileHydration: 'success' as const
    };
    const enrichedHydration = {
      user: { ...initialHydration.user, roles: ['member', 'coach'], coachOf: ['team-late'] },
      profile: { roles: ['member', 'coach'], coachOf: ['team-late'] },
      profileHydration: 'success' as const
    };
    authServiceMocks.observeFirebaseUser.mockImplementation((callback: (user: unknown) => void) => {
      callback(observation++ === 0 ? null : { uid: 'user-1' });
      return () => undefined;
    });
    authServiceMocks.hydrateFirebaseUser.mockImplementation((_user, options) => {
      options.onAccessEnriched(enrichedHydration);
      return new Promise((resolve) => {
        resolveHydration = resolve;
      });
    });

    const { result } = renderHook(() => useAuth());
    await waitFor(() => expect(result.current.loading).toBe(false));
    let refreshResult: unknown;
    let refreshPromise: Promise<unknown> | undefined;
    act(() => {
      refreshPromise = result.current.refresh();
    });
    await waitFor(() => expect(result.current.user?.coachOf).toEqual(['team-late']));

    await act(async () => {
      resolveHydration?.(initialHydration);
      refreshResult = await refreshPromise;
    });

    expect(refreshResult).toEqual(enrichedHydration.user);
    expect(result.current.user?.coachOf).toEqual(['team-late']);
    expect(result.current.isCoach).toBe(true);
  });

  it('ignores post-timeout enrichment after the consumer signs out', async () => {
    authServiceMocks.observeFirebaseUser.mockImplementation((callback: (user: unknown) => void) => {
      callback({ uid: 'user-1' });
      return () => undefined;
    });
    authServiceMocks.hydrateFirebaseUser.mockResolvedValue({
      user: {
        uid: 'user-1',
        email: 'coach@example.com',
        displayName: 'Casey Coach',
        roles: ['parent'],
        coachOf: []
      },
      profile: { coachOf: [] },
      profileHydration: 'success'
    });

    const { result } = renderHook(() => useAuth());
    await waitFor(() => expect(result.current.loading).toBe(false));
    const options = authServiceMocks.hydrateFirebaseUser.mock.calls[0]?.[1];

    await act(async () => {
      await result.current.signOut();
    });
    act(() => {
      options.onAccessEnriched({
        user: {
          uid: 'user-1',
          email: 'coach@example.com',
          displayName: 'Casey Coach',
          roles: ['coach'],
          coachOf: ['team-late']
        },
        profile: { coachOf: ['team-late'] },
        profileHydration: 'success'
      });
    });

    expect(result.current.user).toBeNull();
  });
});
