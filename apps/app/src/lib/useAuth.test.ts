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

import { useAuth } from './useAuth';

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
});
