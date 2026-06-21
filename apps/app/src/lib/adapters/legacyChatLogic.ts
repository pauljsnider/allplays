import { DEFAULT_TEAM_CONVERSATION_ID as legacyDefaultTeamConversationId, buildDefaultTeamConversation as legacyBuildDefaultTeamConversation, getConversationDisplayName as legacyGetConversationDisplayName, isDefaultTeamConversation as legacyIsDefaultTeamConversation } from '@legacy/team-chat-conversations.js';
import { MAX_CHAT_MEDIA_SIZE as legacyMaxChatMediaSize, buildChatMediaShareDetails as legacyBuildChatMediaShareDetails, collectThreadMedia as legacyCollectThreadMedia, getChatMediaActionState as legacyGetChatMediaActionState, getChatMediaDownloadName as legacyGetChatMediaDownloadName, getMessageAttachments as legacyGetMessageAttachments, isSafeChatMediaUrl as legacyIsSafeChatMediaUrl } from '@legacy/team-chat-media.js';
import { shouldRetryChatLastReadOnViewReturn as legacyShouldRetryChatLastReadOnViewReturn, shouldUpdateChatLastRead as legacyShouldUpdateChatLastRead } from '@legacy/team-chat-last-read.js';

/**
 * Typed adapter boundary for the legacy js/ team-chat helpers (#2066). Bindings
 * re-exported as-is so existing js/* test mocks apply via the @legacy alias.
 */
export const DEFAULT_TEAM_CONVERSATION_ID = legacyDefaultTeamConversationId as string;
export const buildDefaultTeamConversation = legacyBuildDefaultTeamConversation as (...args: any[]) => any;
export const getConversationDisplayName = legacyGetConversationDisplayName as (...args: any[]) => string;
export const isDefaultTeamConversation = legacyIsDefaultTeamConversation as (...args: any[]) => boolean;
export const MAX_CHAT_MEDIA_SIZE = legacyMaxChatMediaSize as number;
export const buildChatMediaShareDetails = legacyBuildChatMediaShareDetails as (...args: any[]) => any;
export const collectThreadMedia = legacyCollectThreadMedia as (...args: any[]) => any;
export const getChatMediaActionState = legacyGetChatMediaActionState as (...args: any[]) => any;
export const getChatMediaDownloadName = legacyGetChatMediaDownloadName as (...args: any[]) => string;
export const getMessageAttachments = legacyGetMessageAttachments as (...args: any[]) => any;
export const isSafeChatMediaUrl = legacyIsSafeChatMediaUrl as (...args: any[]) => boolean;
export const shouldRetryChatLastReadOnViewReturn = legacyShouldRetryChatLastReadOnViewReturn as (...args: any[]) => boolean;
export const shouldUpdateChatLastRead = legacyShouldUpdateChatLastRead as (...args: any[]) => boolean;
