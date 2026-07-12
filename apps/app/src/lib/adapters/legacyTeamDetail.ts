/* Auto-generated typed adapter boundary for legacy js/ team-detail imports (#2066).
 * Bindings re-exported as-is so existing js/* test mocks apply via the @legacy alias. */
import * as legacyDb from '@legacy/db.js';
import { sendInviteEmail as legacy_sendInviteEmail } from '@legacy/auth.js';
import { queueInviteEmail as legacy_queueInviteEmail } from '@legacy/invite-email.js';
import { inviteExistingTeamAdmin as legacy_inviteExistingTeamAdmin } from '@legacy/edit-team-admin-invites.js';
import * as legacyFirebase from '@legacy/firebase.js';
import { collectRosterParentContacts as legacy_collectRosterParentContacts, mergeStandardRosterFieldDefinitions as legacy_mergeStandardRosterFieldDefinitions, normalizeRosterFieldDefinitions as legacy_normalizeRosterFieldDefinitions, splitRosterProfileValuesByVisibility as legacy_splitRosterProfileValuesByVisibility, validateRosterProfileValues as legacy_validateRosterProfileValues } from '@legacy/roster-profile-fields.js';
import { describeScheduleReminderWindow as legacy_describeScheduleReminderWindow, normalizeScheduleNotificationSettings as legacy_normalizeScheduleNotificationSettings } from '@legacy/schedule-notifications.js';
import { calculateSeasonRecord as legacy_calculateSeasonRecord, listSeasonLabels as legacy_listSeasonLabels } from '@legacy/season-record.js';
import { computeNativeStandings as legacy_computeNativeStandings } from '@legacy/native-standings.js';
import { buildPlayerLeaderboardSnapshot as legacy_buildPlayerLeaderboardSnapshot, normalizeStatTrackerConfig as legacy_normalizeStatTrackerConfig, selectAnalyticsConfig as legacy_selectAnalyticsConfig } from '@legacy/stat-leaderboards.js';
import { getVisiblePlayerTrackingSummary as legacy_getVisiblePlayerTrackingSummary, normalizeTrackingStatus as legacy_normalizeTrackingStatus } from '@legacy/player-tracking-summary.js';
import { hasFullTeamAccess as legacy_hasFullTeamAccess, normalizeAdminEmailList as legacy_normalizeAdminEmailList } from '@legacy/team-access.js';
import { buildTeamStaffPermissionsViewModel as legacy_buildTeamStaffPermissionsViewModel } from '@legacy/team-staff-permissions.js';
import { buildTrackingStatusPayload as legacy_buildTrackingStatusPayload, summarizeTrackingStatus as legacy_summarizeTrackingStatus } from '@legacy/tracking-status-admin.js';

function callLegacyDb(name: string, args: any[]) {
  const fn = (legacyDb as Record<string, any>)[name];
  if (typeof fn !== 'function') {
    throw new TypeError(`Legacy db binding ${String(name)} is not available.`);
  }
  return fn(...args);
}

function callLegacyFirebase(name: string, args: any[]) {
  const fn = (legacyFirebase as Record<string, any>)[name];
  if (typeof fn !== 'function') {
    throw new TypeError(`Legacy firebase binding ${String(name)} is not available.`);
  }
  return fn(...args);
}

export const addPlayer = (...args: any[]) => callLegacyDb('addPlayer', args);
export const createConfig = (...args: any[]) => callLegacyDb('createConfig', args);
export const getAggregatedStatsForGames = (...args: any[]) => callLegacyDb('getAggregatedStatsForGames', args);
export const getAdSpaceSponsors = (...args: any[]) => callLegacyDb('getAdSpaceSponsors', args);
export const getConfigs = (...args: any[]) => callLegacyDb('getConfigs', args);
export const getGames = (...args: any[]) => callLegacyDb('getGames', args);
export const inviteParent = (...args: any[]) => callLegacyDb('inviteParent', args);
export const getLocalAttractionSponsors = (...args: any[]) => callLegacyDb('getLocalAttractionSponsors', args);
export const getPlayers = (...args: any[]) => callLegacyDb('getPlayers', args);
export const getPlayersWithPrivateRosterContacts = (...args: any[]) => callLegacyDb('getPlayersWithPrivateRosterContacts', args);
export const getPlayerTrackingStatuses = (...args: any[]) => callLegacyDb('getPlayerTrackingStatuses', args);
export const getPublicTrackingItems = (...args: any[]) => callLegacyDb('getPublicTrackingItems', args);
export const getRosterFieldDefinitions = (...args: any[]) => callLegacyDb('getRosterFieldDefinitions', args);
export const getTeam = (...args: any[]) => callLegacyDb('getTeam', args);
export const setTeamTrackingStatus = (...args: any[]) => callLegacyDb('setTeamTrackingStatus', args);
export const updateTeam = (...args: any[]) => callLegacyDb('updateTeam', args);
export const grantScorekeeperAccess = (...args: any[]) => callLegacyDb('grantScorekeeperAccess', args);
export const grantTeamMediaManagerAccess = (...args: any[]) => callLegacyDb('grantTeamMediaManagerAccess', args);
export const grantVideographerAccess = (...args: any[]) => callLegacyDb('grantVideographerAccess', args);
export const inviteAdmin = (...args: any[]) => callLegacyDb('inviteAdmin', args);
export const addTeamAdminEmail = (...args: any[]) => callLegacyDb('addTeamAdminEmail', args);
export const revokeScorekeeperAccess = (...args: any[]) => callLegacyDb('revokeScorekeeperAccess', args);
export const revokeTeamMediaManagerAccess = (...args: any[]) => callLegacyDb('revokeTeamMediaManagerAccess', args);
export const revokeVideographerAccess = (...args: any[]) => callLegacyDb('revokeVideographerAccess', args);
export const deactivatePlayer = (...args: any[]) => callLegacyDb('deactivatePlayer', args);
export const reactivatePlayer = (...args: any[]) => callLegacyDb('reactivatePlayer', args);
export const setPlayerPrivateRosterProfileFields = (...args: any[]) => callLegacyDb('setPlayerPrivateRosterProfileFields', args);
export const updateConfig = (...args: any[]) => callLegacyDb('updateConfig', args);
export const uploadPlayerPhoto = (...args: any[]) => callLegacyDb('uploadPlayerPhoto', args);
export const uploadTeamPhoto = (...args: any[]) => callLegacyDb('uploadTeamPhoto', args);
export const sendInviteEmail = legacy_sendInviteEmail as (...args: any[]) => any;
export const queueInviteEmail = legacy_queueInviteEmail as (...args: any[]) => any;
export const inviteExistingTeamAdmin = legacy_inviteExistingTeamAdmin as (...args: any[]) => any;
export const collection = (...args: any[]) => callLegacyFirebase('collection', args);
export const collectionGroup = (...args: any[]) => callLegacyFirebase('collectionGroup', args);
export const db: unknown = legacyFirebase.db;
export const doc = (...args: any[]) => callLegacyFirebase('doc', args);
export const getDoc = (...args: any[]) => callLegacyFirebase('getDoc', args);
export const getDocs = (...args: any[]) => callLegacyFirebase('getDocs', args);
export const query = (...args: any[]) => callLegacyFirebase('query', args);
export const serverTimestamp = (...args: any[]) => callLegacyFirebase('serverTimestamp', args);
export const setDoc = (...args: any[]) => callLegacyFirebase('setDoc', args);
export const updateDoc = (...args: any[]) => callLegacyFirebase('updateDoc', args);
export const where = (...args: any[]) => callLegacyFirebase('where', args);
export const normalizeRosterFieldDefinitions = legacy_normalizeRosterFieldDefinitions as (...args: any[]) => any;
export const mergeStandardRosterFieldDefinitions = legacy_mergeStandardRosterFieldDefinitions as (...args: any[]) => any;
export const collectRosterParentContacts = legacy_collectRosterParentContacts as (...args: any[]) => any;
export const splitRosterProfileValuesByVisibility = legacy_splitRosterProfileValuesByVisibility as (...args: any[]) => any;
export const validateRosterProfileValues = legacy_validateRosterProfileValues as (...args: any[]) => any;
export const describeScheduleReminderWindow = legacy_describeScheduleReminderWindow as (...args: any[]) => any;
export const normalizeScheduleNotificationSettings = legacy_normalizeScheduleNotificationSettings as (...args: any[]) => any;
export const calculateSeasonRecord = legacy_calculateSeasonRecord as (...args: any[]) => any;
export const listSeasonLabels = legacy_listSeasonLabels as (...args: any[]) => any;
export const computeNativeStandings = legacy_computeNativeStandings as (...args: any[]) => any;
export const buildPlayerLeaderboardSnapshot = legacy_buildPlayerLeaderboardSnapshot as (...args: any[]) => any;
export const normalizeStatTrackerConfig = legacy_normalizeStatTrackerConfig as (...args: any[]) => any;
export const selectAnalyticsConfig = legacy_selectAnalyticsConfig as (...args: any[]) => any;
export const getVisiblePlayerTrackingSummary = legacy_getVisiblePlayerTrackingSummary as (...args: any[]) => any;
export const normalizeTrackingStatus = legacy_normalizeTrackingStatus as (...args: any[]) => any;
export const hasFullTeamAccess = legacy_hasFullTeamAccess as (...args: any[]) => any;
export const normalizeAdminEmailList = legacy_normalizeAdminEmailList as (...args: any[]) => any;
export const buildTeamStaffPermissionsViewModel = legacy_buildTeamStaffPermissionsViewModel as (...args: any[]) => any;
export const buildTrackingStatusPayload = legacy_buildTrackingStatusPayload as (...args: any[]) => any;
export const summarizeTrackingStatus = legacy_summarizeTrackingStatus as (...args: any[]) => any;
