import { createTeamFeeBatch as legacyCreateTeamFeeBatch, getPlayers as legacyGetPlayers, getTeam as legacyGetTeam, listTeamFeeBatches as legacyListTeamFeeBatches, listTeamFeeRecipients as legacyListTeamFeeRecipients, updateTeamFeeRecipient as legacyUpdateTeamFeeRecipient } from '@legacy/db.js';
import { initiateTeamFeeCheckout as legacyInitiateTeamFeeCheckout } from '@legacy/stripe-service.js';
import { hasFullTeamAccess as legacyHasFullTeamAccess } from '@legacy/team-access.js';

/**
 * Typed adapter boundary for the legacy js/ team-fees helpers (#2066).
 * Bindings re-exported as-is so existing js/* test mocks apply via the @legacy alias.
 */
export const createTeamFeeBatch = legacyCreateTeamFeeBatch as (...args: any[]) => Promise<any>;
export const getPlayers = legacyGetPlayers as (...args: any[]) => Promise<any>;
export const getTeam = legacyGetTeam as (...args: any[]) => Promise<any>;
export const listTeamFeeBatches = legacyListTeamFeeBatches as (...args: any[]) => Promise<any>;
export const listTeamFeeRecipients = legacyListTeamFeeRecipients as (...args: any[]) => Promise<any>;
export const updateTeamFeeRecipient = legacyUpdateTeamFeeRecipient as (...args: any[]) => Promise<any>;
export const initiateTeamFeeCheckout = legacyInitiateTeamFeeCheckout as (...args: any[]) => Promise<any>;
export const hasFullTeamAccess = legacyHasFullTeamAccess as (...args: any[]) => boolean;
