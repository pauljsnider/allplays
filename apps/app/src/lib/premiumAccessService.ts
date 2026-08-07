import {
  PREMIUM_FEATURES,
  PREMIUM_SCOPES,
  type PremiumAccessResult
} from './adapters/legacyPremiumAccessCore';
import type { AuthUser } from './types';

export { PREMIUM_FEATURES, PREMIUM_SCOPES };
export type { PremiumAccessResult };

export const PREMIUM_ACCESS_LOADING: PremiumAccessResult = {
  state: 'loading',
  reason: 'premium-access-loading'
};

export async function loadPremiumFeatureAccess({
  scope,
  feature,
  user,
  teamId = '',
  currentSeasonId = ''
}: {
  scope: 'account' | 'team';
  feature: string;
  user: AuthUser | null;
  teamId?: string;
  currentSeasonId?: string;
}): Promise<PremiumAccessResult> {
  const runtime = await import('./adapters/legacyPremiumAccessRuntime');
  if (scope === PREMIUM_SCOPES.TEAM) {
    return runtime.readTeamPremiumEntitlement({
      teamId,
      user,
      teamAccessInfo: { hasAccess: true },
      currentSeasonId,
      feature
    });
  }
  return runtime.readAccountPremiumEntitlement({ user, feature });
}
