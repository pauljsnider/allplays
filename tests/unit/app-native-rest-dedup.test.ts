import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearNativeRestDedup,
  getNativeRestDedupKey,
  loadDedupedNativeRestRequest,
  shouldDedupNativeRestRequest
} from '../../apps/app/src/lib/nativeRestDedup';

describe('native REST read dedup', () => {
  beforeEach(() => {
    vi.useRealTimers();
    clearNativeRestDedup();
  });

  it('only dedups in-flight native reads and refetches after the first read settles', async () => {
    vi.useFakeTimers();
    const loader = vi.fn(async () => ({ documents: [{ name: 'teams/team-1' }] }));
    const key = getNativeRestDedupKey('https://firestore.test/teams/team-1');

    const first = loadDedupedNativeRestRequest(key, loader);
    const second = loadDedupedNativeRestRequest(key, loader);

    await expect(first).resolves.toEqual({ documents: [{ name: 'teams/team-1' }] });
    await expect(second).resolves.toEqual({ documents: [{ name: 'teams/team-1' }] });
    expect(loader).toHaveBeenCalledTimes(1);

    await expect(loadDedupedNativeRestRequest(key, loader)).resolves.toEqual({ documents: [{ name: 'teams/team-1' }] });
    expect(loader).toHaveBeenCalledTimes(2);

    vi.advanceTimersByTime(5001);
    await expect(loadDedupedNativeRestRequest(key, loader)).resolves.toEqual({ documents: [{ name: 'teams/team-1' }] });
    expect(loader).toHaveBeenCalledTimes(3);
  });

  it('retries failed reads instead of caching the rejection', async () => {
    const loader = vi.fn()
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce({ ok: true });
    const key = getNativeRestDedupKey('https://firestore.test/teams/team-1');

    await expect(loadDedupedNativeRestRequest(key, loader)).rejects.toThrow('network');
    await expect(loadDedupedNativeRestRequest(key, loader)).resolves.toEqual({ ok: true });
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it('includes the request method in the dedup cache key', () => {
    expect(getNativeRestDedupKey('https://firestore.test/teams/team-1', { method: 'GET' }))
      .not.toEqual(getNativeRestDedupKey('https://firestore.test/teams/team-1', { method: 'POST' }));
  });

  it('limits dedup candidates to native read requests', () => {
    expect(shouldDedupNativeRestRequest('/teams/team-1')).toBe(true);
    expect(shouldDedupNativeRestRequest(':runQuery', { method: 'POST', body: '{}' })).toBe(true);
    expect(shouldDedupNativeRestRequest('/teams/team-1', { method: 'PATCH', body: '{}' })).toBe(false);
    expect(shouldDedupNativeRestRequest(':commit', { method: 'POST', body: '{}' })).toBe(false);
    expect(shouldDedupNativeRestRequest('/teams/team-1/games', { method: 'POST', body: '{}' })).toBe(false);
  });
});
