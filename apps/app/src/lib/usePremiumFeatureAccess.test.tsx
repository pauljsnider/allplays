// @vitest-environment jsdom
import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const serviceMocks = vi.hoisted(() => ({
  loadPremiumFeatureAccess: vi.fn()
}));

vi.mock('./premiumAccessService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./premiumAccessService')>();
  return { ...actual, loadPremiumFeatureAccess: serviceMocks.loadPremiumFeatureAccess };
});

import { PREMIUM_FEATURES, PREMIUM_SCOPES } from './premiumAccessService';
import type { AuthUser } from './types';
import { usePremiumFeatureAccess } from './usePremiumFeatureAccess';

describe('usePremiumFeatureAccess', () => {
  beforeEach(() => serviceMocks.loadPremiumFeatureAccess.mockReset());
  afterEach(cleanup);

  it('starts loading and publishes the shared access result', async () => {
    serviceMocks.loadPremiumFeatureAccess.mockResolvedValue({ state: 'unlocked', reason: 'default-open' });
    const user = { uid: 'user-1' } as any;
    const { result } = renderHook(() => usePremiumFeatureAccess({
      scope: PREMIUM_SCOPES.ACCOUNT,
      feature: PREMIUM_FEATURES.FAMILY_PLAN,
      user,
      normalAccess: true
    }));

    expect(result.current.state).toBe('loading');
    await waitFor(() => expect(result.current).toMatchObject({ state: 'unlocked', reason: 'default-open' }));
  });

  it('publishes an unavailable verification result', async () => {
    serviceMocks.loadPremiumFeatureAccess.mockResolvedValue({
      state: 'unavailable',
      reason: 'global-config-read-failed'
    });
    const { result } = renderHook(() => usePremiumFeatureAccess({
      scope: PREMIUM_SCOPES.TEAM,
      feature: PREMIUM_FEATURES.TEAM_ANALYTICS,
      user: { uid: 'user-1' } as any,
      normalAccess: true,
      teamId: 'team-1'
    }));

    await waitFor(() => expect(result.current).toMatchObject({ state: 'unavailable', reason: 'global-config-read-failed' }));
  });

  it('reloads access for a different authenticated user', async () => {
    serviceMocks.loadPremiumFeatureAccess
      .mockResolvedValueOnce({ state: 'unlocked', reason: 'valid-account-entitlement' })
      .mockResolvedValueOnce({ state: 'locked', reason: 'missing-valid-account-entitlement' });
    const { result, rerender } = renderHook(
      ({ userId }) => usePremiumFeatureAccess({
        scope: PREMIUM_SCOPES.ACCOUNT,
        feature: PREMIUM_FEATURES.FAMILY_PLAN,
        user: { uid: userId } as AuthUser,
        normalAccess: true
      }),
      { initialProps: { userId: 'user-1' } }
    );

    await waitFor(() => expect(result.current).toMatchObject({ state: 'unlocked' }));
    rerender({ userId: 'user-2' });
    await waitFor(() => expect(result.current).toMatchObject({ state: 'locked' }));
    expect(serviceMocks.loadPremiumFeatureAccess).toHaveBeenLastCalledWith(expect.objectContaining({
      user: { uid: 'user-2' }
    }));
  });

  it('reloads the same current-season entitlement when the refresh version changes', async () => {
    serviceMocks.loadPremiumFeatureAccess
      .mockResolvedValueOnce({ state: 'locked', reason: 'missing-valid-entitlement' })
      .mockResolvedValueOnce({ state: 'unlocked', reason: 'valid-team-entitlement' });
    const { result, rerender } = renderHook(
      ({ refreshVersion }) => usePremiumFeatureAccess({
        scope: PREMIUM_SCOPES.TEAM,
        feature: PREMIUM_FEATURES.TEAM_ANALYTICS,
        user: { uid: 'user-1' } as AuthUser,
        normalAccess: true,
        teamId: 'team-1',
        currentSeasonId: 'summer-2100',
        refreshVersion
      }),
      { initialProps: { refreshVersion: 0 } }
    );

    await waitFor(() => expect(result.current).toMatchObject({ state: 'locked' }));
    rerender({ refreshVersion: 1 });
    await waitFor(() => expect(result.current).toMatchObject({ state: 'unlocked' }));
    expect(serviceMocks.loadPremiumFeatureAccess).toHaveBeenCalledTimes(2);
    expect(serviceMocks.loadPremiumFeatureAccess).toHaveBeenLastCalledWith(expect.objectContaining({
      teamId: 'team-1',
      currentSeasonId: 'summer-2100'
    }));
  });
});
