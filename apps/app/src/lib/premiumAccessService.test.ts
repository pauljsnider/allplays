import { beforeEach, describe, expect, it, vi } from 'vitest';

const runtimeMocks = vi.hoisted(() => ({
  readAccountPremiumEntitlement: vi.fn(),
  readTeamPremiumEntitlement: vi.fn()
}));

vi.mock('./adapters/legacyPremiumAccessRuntime', () => runtimeMocks);

import { loadPremiumFeatureAccess, PREMIUM_FEATURES, PREMIUM_SCOPES } from './premiumAccessService';

describe('premiumAccessService', () => {
  beforeEach(() => {
    runtimeMocks.readAccountPremiumEntitlement.mockReset();
    runtimeMocks.readTeamPremiumEntitlement.mockReset();
  });

  it('routes account features through the shared legacy entitlement resolver', async () => {
    runtimeMocks.readAccountPremiumEntitlement.mockResolvedValue({ state: 'unlocked', reason: 'global-open' });
    const user = { uid: 'user-1' } as any;

    await expect(loadPremiumFeatureAccess({
      scope: PREMIUM_SCOPES.ACCOUNT,
      feature: PREMIUM_FEATURES.PLAYER_ANALYTICS,
      user
    })).resolves.toMatchObject({ state: 'unlocked', reason: 'global-open' });
    expect(runtimeMocks.readAccountPremiumEntitlement).toHaveBeenCalledWith({
      user,
      feature: PREMIUM_FEATURES.PLAYER_ANALYTICS
    });
  });

  it('routes team features with exact team and season scope', async () => {
    runtimeMocks.readTeamPremiumEntitlement.mockResolvedValue({ state: 'locked', reason: 'missing-valid-team-entitlement' });
    const user = { uid: 'user-1' } as any;

    await expect(loadPremiumFeatureAccess({
      scope: PREMIUM_SCOPES.TEAM,
      feature: PREMIUM_FEATURES.TEAM_ANALYTICS,
      user,
      teamId: 'team-1',
      currentSeasonId: '2026'
    })).resolves.toMatchObject({ state: 'locked' });
    expect(runtimeMocks.readTeamPremiumEntitlement).toHaveBeenCalledWith({
      teamId: 'team-1',
      user,
      teamAccessInfo: { hasAccess: true },
      currentSeasonId: '2026',
      feature: PREMIUM_FEATURES.TEAM_ANALYTICS
    });
  });
});
