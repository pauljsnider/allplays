import {
  readAccountPremiumEntitlement as legacyReadAccountPremiumEntitlement,
  readTeamPremiumEntitlement as legacyReadTeamPremiumEntitlement
} from '@legacy/premium-entitlements.js';

export const readAccountPremiumEntitlement = legacyReadAccountPremiumEntitlement as (options?: Record<string, unknown>) => Promise<any>;
export const readTeamPremiumEntitlement = legacyReadTeamPremiumEntitlement as (options?: Record<string, unknown>) => Promise<any>;
