import {
  PREMIUM_FEATURES,
  PREMIUM_SCOPES,
  resolvePremiumAccess,
  type PremiumAccessResult
} from './adapters/legacyPremiumAccessCore';
import type { AuthUser } from './types';

type PremiumAccessUser = Pick<AuthUser, 'uid'>;

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
  normalAccess,
  teamId = '',
  currentSeasonId = ''
}: {
  scope: 'account' | 'team';
  feature: string;
  user: PremiumAccessUser | null;
  normalAccess: boolean;
  teamId?: string;
  currentSeasonId?: string;
}): Promise<PremiumAccessResult> {
  const authorized = normalAccess === true && Boolean(user?.uid);
  if (!authorized) return resolvePremiumAccess({ feature, normalAccess: false });

  const runtime = await import('./adapters/legacyPremiumAccessRuntime');
  if (scope === PREMIUM_SCOPES.TEAM) {
    return runtime.readTeamPremiumEntitlement({
      teamId,
      user,
      teamAccessInfo: { hasAccess: authorized },
      normalAccess: authorized,
      currentSeasonId,
      feature
    });
  }
  return runtime.readAccountPremiumEntitlement({ user, normalAccess: authorized, feature });
}
