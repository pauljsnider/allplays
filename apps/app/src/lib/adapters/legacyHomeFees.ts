import { listParentTeamFeeRecipients as legacyListParentTeamFeeRecipients } from '@legacy/db.js';
import { normalizeParentFeeRecord as legacyNormalizeParentFeeRecord } from '@legacy/parent-dashboard-fees.js';

/**
 * Typed adapter boundary for the legacy js/ parent-fee helpers used by
 * homeService (#2066). Bindings re-exported as-is so existing js/* test mocks
 * apply via the @legacy alias.
 */
export const listParentTeamFeeRecipients = legacyListParentTeamFeeRecipients as (...args: any[]) => any;
export const normalizeParentFeeRecord = legacyNormalizeParentFeeRecord as (...args: any[]) => any;
