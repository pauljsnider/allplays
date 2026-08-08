import { useEffect, useState } from 'react';
import {
  PREMIUM_ACCESS_LOADING,
  loadPremiumFeatureAccess,
  type PremiumAccessResult
} from './premiumAccessService';
import type { AuthUser } from './types';

export function usePremiumFeatureAccess({
  scope,
  feature,
  user,
  normalAccess,
  teamId = '',
  currentSeasonId = ''
}: {
  scope: 'account' | 'team';
  feature: string;
  user: AuthUser | null;
  normalAccess: boolean;
  teamId?: string;
  currentSeasonId?: string;
}): PremiumAccessResult {
  const [access, setAccess] = useState<PremiumAccessResult>(PREMIUM_ACCESS_LOADING);
  const userId = user?.uid || '';

  useEffect(() => {
    let cancelled = false;
    setAccess(PREMIUM_ACCESS_LOADING);
    const loadAccess = async () => {
      try {
        const nextAccess = await loadPremiumFeatureAccess({
          scope,
          feature,
          user: userId ? { uid: userId } : null,
          normalAccess,
          teamId,
          currentSeasonId
        });
        if (!cancelled) setAccess(nextAccess);
      } catch {
        if (!cancelled) {
          setAccess({ state: 'unavailable', reason: 'premium-access-read-failed', feature });
        }
      }
    };
    void loadAccess();
    return () => {
      cancelled = true;
    };
  }, [currentSeasonId, feature, normalAccess, scope, teamId, userId]);

  return access;
}
