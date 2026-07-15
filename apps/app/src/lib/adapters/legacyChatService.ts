/* Auto-generated typed adapter boundary for legacy js/ chat-service imports (#2066).
 * Bindings re-exported as-is so existing js/* test mocks apply via the @legacy alias. */
import * as legacyDb from '@legacy/db.js';
import { getApp as legacy_getApp } from '@legacy/vendor/firebase-app.js';
import { isTeamActive as legacy_isTeamActive } from '@legacy/team-visibility.js';

function callLegacyDb(name: string, args: any[]) {
  const fn = (legacyDb as Record<string, any>)[name];
  if (typeof fn !== 'function') {
    throw new TypeError(`Legacy db binding ${String(name)} is not available.`);
  }
  return fn(...args);
}

export const canAccessTeamChat = (...args: any[]) => callLegacyDb('canAccessTeamChat', args);
export const canModerateChat = (...args: any[]) => callLegacyDb('canModerateChat', args);
export const deleteChatMessage = (...args: any[]) => callLegacyDb('deleteChatMessage', args);
export const deleteUploadedChatAttachments = (...args: any[]) => callLegacyDb('deleteUploadedChatAttachments', args);
export const editChatMessage = (...args: any[]) => callLegacyDb('editChatMessage', args);
export const getAggregatedStatsForGames = (...args: any[]) => callLegacyDb('getAggregatedStatsForGames', args);
export const getChatConversations = (...args: any[]) => callLegacyDb('getChatConversations', args);
export const getChatMessages = (...args: any[]) => callLegacyDb('getChatMessages', args);
export const getGameEvents = (...args: any[]) => callLegacyDb('getGameEvents', args);
export const getGames = (...args: any[]) => callLegacyDb('getGames', args);
export const getParentTeams = (...args: any[]) => callLegacyDb('getParentTeams', args);
export const getPlayers = (...args: any[]) => callLegacyDb('getPlayers', args);
export const getSentTeamEmails = (...args: any[]) => callLegacyDb('getSentTeamEmails', args);
export const getStoredTeamEmailDrafts = (...args: any[]) => callLegacyDb('getTeamEmailDrafts', args);
export const getStoredTeamEmailTemplates = (...args: any[]) => callLegacyDb('getTeamEmailTemplates', args);
export const getTeam = (...args: any[]) => callLegacyDb('getTeam', args);
export const getUnreadChatCounts = (...args: any[]) => callLegacyDb('getUnreadChatCounts', args);
export const getUserByEmail = (...args: any[]) => callLegacyDb('getUserByEmail', args);
export const getUsersByParentPlayerKey = (...args: any[]) => callLegacyDb('getUsersByParentPlayerKey', args);
export const getUserProfile = (...args: any[]) => callLegacyDb('getUserProfile', args);
export const getUserTeamsWithAccess = (...args: any[]) => callLegacyDb('getUserTeamsWithAccess', args);
export const postChatMessage = (...args: any[]) => callLegacyDb('postChatMessage', args);
export const saveStoredTeamEmailDraft = (...args: any[]) => callLegacyDb('saveTeamEmailDraft', args);
export const saveStoredTeamEmailTemplate = (...args: any[]) => callLegacyDb('saveTeamEmailTemplate', args);
export const sendTeamEmail = (...args: any[]) => callLegacyDb('sendTeamEmail', args);
export const subscribeToChatMessages = (...args: any[]) => callLegacyDb('subscribeToChatMessages', args);
export const toggleChatReaction = (...args: any[]) => callLegacyDb('toggleChatReaction', args);
export const updateChatLastRead = (...args: any[]) => callLegacyDb('updateChatLastRead', args);
export const updateChatMuted = (...args: any[]) => callLegacyDb('updateChatMuted', args);
export const clearChatMuted = (...args: any[]) => callLegacyDb('clearChatMuted', args);
export const uploadChatImage = (...args: any[]) => callLegacyDb('uploadChatImage', args);
export const upsertChatConversation = (...args: any[]) => callLegacyDb('upsertChatConversation', args);
export const getApp = legacy_getApp as (...args: any[]) => any;
export const isTeamActive = legacy_isTeamActive as (...args: any[]) => any;
