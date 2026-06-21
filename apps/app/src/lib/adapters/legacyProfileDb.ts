import {
  createAccessCode as legacyCreateAccessCode,
  createAccountMergeRequest as legacyCreateAccountMergeRequest,
  generateAccessCode as legacyGenerateAccessCode,
  getNotificationPreferencesForTeam as legacyGetNotificationPreferencesForTeam,
  getParentTeams as legacyGetParentTeams,
  getUserAccessCodes as legacyGetUserAccessCodes,
  getUserAccessCodesPage as legacyGetUserAccessCodesPage,
  getUserProfile as legacyGetUserProfile,
  getUserTeamsWithAccess as legacyGetUserTeamsWithAccess,
  saveNotificationPreferencesForTeam as legacySaveNotificationPreferencesForTeam,
  updateUserProfile as legacyUpdateUserProfile,
  upsertNotificationDeviceToken as legacyUpsertNotificationDeviceToken
} from '@legacy/db.js';
import { normalizeTeamNotificationPreferences as legacyNormalizeTeamNotificationPreferences } from '@legacy/notification-preferences.js';
import { isTeamActive as legacyIsTeamActive } from '@legacy/team-visibility.js';

/**
 * Typed adapter boundary for the legacy js/ profile helpers (#2066). Bindings
 * re-exported as-is so existing js/* test mocks apply via the @legacy alias.
 */
export const createAccessCode = legacyCreateAccessCode as (...args: any[]) => Promise<any>;
export const createAccountMergeRequest = legacyCreateAccountMergeRequest as (...args: any[]) => Promise<any>;
export const generateAccessCode = legacyGenerateAccessCode as (...args: any[]) => any;
export const getNotificationPreferencesForTeam = legacyGetNotificationPreferencesForTeam as (...args: any[]) => Promise<any>;
export const getParentTeams = legacyGetParentTeams as (...args: any[]) => Promise<any>;
export const getUserAccessCodes = legacyGetUserAccessCodes as (...args: any[]) => Promise<any>;
export const getUserAccessCodesPage = legacyGetUserAccessCodesPage as (...args: any[]) => Promise<any>;
export const getUserProfile = legacyGetUserProfile as (...args: any[]) => Promise<any>;
export const getUserTeamsWithAccess = legacyGetUserTeamsWithAccess as (...args: any[]) => Promise<any>;
export const saveNotificationPreferencesForTeam = legacySaveNotificationPreferencesForTeam as (...args: any[]) => Promise<any>;
export const updateUserProfile = legacyUpdateUserProfile as (...args: any[]) => Promise<any>;
export const upsertNotificationDeviceToken = legacyUpsertNotificationDeviceToken as (...args: any[]) => Promise<any>;
export const normalizeTeamNotificationPreferences = legacyNormalizeTeamNotificationPreferences as (...args: any[]) => any;
export const isTeamActive = legacyIsTeamActive as (team: unknown) => boolean;
