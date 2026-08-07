import {
  DEFAULT_PREMIUM_OPEN_TO_ALL as legacyDefaultPremiumOpenToAll,
  PREMIUM_FEATURES as legacyPremiumFeatures,
  PREMIUM_SCOPES as legacyPremiumScopes,
  resolvePremiumAccess as legacyResolvePremiumAccess
} from '@legacy/premium-access-core.js';

export const DEFAULT_PREMIUM_OPEN_TO_ALL = legacyDefaultPremiumOpenToAll as boolean;
export const PREMIUM_FEATURES = legacyPremiumFeatures as {
  PLAYER_ANALYTICS: 'player-analytics';
  TEAM_ANALYTICS: 'team-analytics';
  RECORDED_REPLAY: 'recorded-replay';
  FAMILY_PLAN: 'family-plan';
};
export const PREMIUM_SCOPES = legacyPremiumScopes as {
  ACCOUNT: 'account';
  TEAM: 'team';
};
export const resolvePremiumAccess = legacyResolvePremiumAccess as (options?: Record<string, unknown>) => PremiumAccessResult;

export type PremiumAccessResult = {
  state: 'loading' | 'unlocked' | 'locked' | 'unavailable';
  reason: string;
  feature?: string;
};
