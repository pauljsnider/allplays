import { isNativeRuntime } from './nativeRuntime';
import {
  canAccessTeamChat,
  canModerateChat,
  clearChatMuted,
  deleteChatMessage,
  deleteUploadedChatAttachments,
  editChatMessage,
  getChatConversations,
  getChatMessages,
  getParentTeams,
  getPlayers,
  getSentTeamEmails,
  getStoredTeamEmailDrafts,
  getStoredTeamEmailTemplates,
  getTeam,
  getUnreadChatCounts,
  getUserByEmail,
  getUsersByParentPlayerKey,
  getUserProfile,
  getUserTeamsWithAccess,
  isTeamActive,
  postChatMessage,
  resolveImageFirebaseConfig,
  saveStoredTeamEmailDraft,
  saveStoredTeamEmailTemplate,
  sendTeamEmail,
  subscribeToChatMessages,
  toggleChatReaction,
  updateChatLastRead,
  updateChatMuted,
  uploadChatImage,
  upsertChatConversation
} from './adapters/legacyChatService';
import { firebaseAuth, getNativeAuthIdToken } from './authService';
import { loadCachedAppData } from './appDataCache';
import { createLogger } from './logger';
import { getNativeRestDedupKey, loadDedupedNativeRestRequest, shouldDedupNativeRestRequest } from './nativeRestDedup';
import {
  DEFAULT_TEAM_CONVERSATION_ID,
  MAX_CHAT_MEDIA_SIZE,
  buildDefaultTeamConversation,
  buildChatAudienceMetadata,
  getChatMemberDisplayName,
  getMessagePreviewText,
  getRecipientOptionId,
  hasAllPlaysMention,
  isDefaultTeamConversation,
  isStaffConversation,
  type ChatAudienceMetadata,
  type ChatRecipientOption,
  type ChatTargetType
} from './chatLogic';
import { startInteractionTimer, UX_TIMING } from './uxTiming';
import {
  mapChatConversationRecords,
  mapChatMessageRecord,
  mapChatMessageRecords,
  mapFirestoreDocument
} from './firestore/mappers';
import type {
  ChatAttachmentFirestoreRecord,
  ChatConversationFirestoreRecord,
  ChatMessageFirestoreRecord,
  FirestoreDecodedDocument,
  FirestoreDocument as NativeFirestoreDocument
} from './firestore/types';
import type { AuthUser } from './types';

const primaryDataTimeoutMs = 5000;
const chatUploadTimeoutMs = 25000;
const chatAttachmentUploadConcurrency = 3;
const chatPreviewCacheTtlMs = 20 * 1000;
const deferredInboxPreviewConcurrency = 3;
export const CHAT_RECIPIENT_PROFILE_LOOKUP_CONCURRENCY = 8;
const imageUploadSessionKey = 'allplays-chat-image-upload-session';
const logger = createLogger('chat-service');

export type ChatTeam = {
  id: string;
  name: string;
  sport?: string | null;
  photoUrl?: string | null;
  active?: boolean;
  archived?: boolean;
  status?: string | null;
  role: 'Parent' | 'Coach' | 'Admin';
  canModerate: boolean;
  unreadCount: number;
  lastMessage: ChatMessage | null;
  preferredConversationId?: string | null;
  isMuted?: boolean;
};

export type ChatConversation = ChatConversationFirestoreRecord;

export type ChatAttachment = ChatAttachmentFirestoreRecord;

export type ChatMessage = ChatMessageFirestoreRecord;

export type SentTeamEmail = {
  id: string;
  subject?: string | null;
  senderName?: string | null;
  senderEmail?: string | null;
  sentAt?: unknown;
  recipientCount?: number | null;
  status?: string | null;
  delivery?: {
    status?: string | null;
    jobCount?: number | null;
  } | null;
};

export type TeamEmailTemplate = {
  id: string;
  name: string;
  subject: string;
  body: string;
  authorId?: string | null;
  authorEmail?: string | null;
  authorName?: string | null;
  createdAt?: unknown;
  updatedAt?: unknown;
};

export type TeamEmailDraftRecipient = {
  key: string;
  email: string;
  name: string;
  detail?: string | null;
};

export type TeamEmailDraft = {
  id: string;
  subject: string;
  body: string;
  recipientIds: string[];
  recipients: TeamEmailDraftRecipient[];
  authorId?: string | null;
  authorEmail?: string | null;
  authorName?: string | null;
  createdAt?: unknown;
  updatedAt?: unknown;
};

export type ChatInboxLoadResult = {
  teams: ChatTeam[];
};

export type ChatInboxPreviewUpdate = {
  teamId: string;
  lastMessage: ChatMessage | null;
  preferredConversationId: string | null;
  isMuted: boolean;
};

type TeamChatStateEntry = {
  lastReadAt?: unknown;
  lastReadByConversation?: Record<string, unknown>;
  mutedConversations?: Record<string, unknown>;
};

export type ChatInboxLoadOptions = {
  includeLastMessages?: boolean;
  onPreview?: (update: ChatInboxPreviewUpdate) => void;
};

export type ChatSubscribeResult = {
  unsubscribe: () => void;
};

type FirestoreDocument = FirestoreDecodedDocument;

type ImageUploadSession = {
  apiKey: string;
  idToken: string;
  refreshToken: string;
  expirationTime: number;
};

export const CHAT_AI_RESET_EVENT = 'allplays-chat-ai-reset';

export function resetChatAiModel() {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(CHAT_AI_RESET_EVENT));
  }
}

function withTimeout<T>(promise: Promise<T>, label: string, timeoutMs = primaryDataTimeoutMs): Promise<T> {
  let timeoutId: number | undefined;
  const timeout = new Promise<T>((_, reject) => {
    timeoutId = window.setTimeout(() => reject(new Error(`${label} timed out.`)), timeoutMs);
  });

  return Promise.race([promise, timeout]).finally(() => {
    if (timeoutId) window.clearTimeout(timeoutId);
  });
}

function normalizeTeamEmailTemplate(template: Record<string, any> | null | undefined): TeamEmailTemplate | null {
  if (!template?.id) return null;
  return {
    id: String(template.id),
    name: String(template.name || '').trim(),
    subject: String(template.subject || '').trim(),
    body: String(template.body || '').trim(),
    authorId: template.authorId || null,
    authorEmail: template.authorEmail || null,
    authorName: template.authorName || null,
    createdAt: template.createdAt,
    updatedAt: template.updatedAt
  };
}

function normalizeTeamEmailDraftRecipient(recipient: Record<string, any> | null | undefined): TeamEmailDraftRecipient | null {
  const key = compactString(recipient?.key);
  const email = compactString(recipient?.email).toLowerCase();
  if (!key || !email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  return {
    key,
    email,
    name: compactString(recipient?.name) || email,
    detail: compactString(recipient?.detail) || null
  };
}

function normalizeTeamEmailDraft(draft: Record<string, any> | null | undefined): TeamEmailDraft | null {
  if (!draft?.id) return null;
  const recipients = (Array.isArray(draft.recipients) ? draft.recipients : [])
    .map((recipient) => normalizeTeamEmailDraftRecipient(recipient))
    .filter((recipient): recipient is TeamEmailDraftRecipient => Boolean(recipient));
  const storedRecipientIds = Array.isArray(draft.recipientIds)
    ? draft.recipientIds.map((id: unknown) => compactString(id)).filter(Boolean)
    : [];
  return {
    id: String(draft.id),
    subject: compactString(draft.subject),
    body: compactString(draft.body),
    recipientIds: storedRecipientIds.length > 0 ? storedRecipientIds : recipients.map((recipient) => recipient.key),
    recipients,
    authorId: draft.authorId || null,
    authorEmail: draft.authorEmail || null,
    authorName: draft.authorName || null,
    createdAt: draft.createdAt,
    updatedAt: draft.updatedAt
  };
}

function compactString(value: unknown) {
  return String(value || '').trim();
}

function getProjectId() {
  const projectId = firebaseAuth.app?.options?.projectId;
  if (!projectId) {
    throw new Error('Firebase project ID is missing.');
  }
  return projectId;
}

function getFirestoreBaseUrl() {
  return `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(getProjectId())}/databases/(default)/documents`;
}

async function getNativeHeaders() {
  const token = await getNativeAuthIdToken(true);
  if (!token) {
    throw new Error('Native auth token is unavailable.');
  }

  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json'
  };
}

async function nativeFirestoreRequest(path: string, init: RequestInit = {}) {
  const url = `${getFirestoreBaseUrl()}${path}`;
  const runRequest = async () => {
    const response = await withTimeout(fetch(url, {
      ...init,
      headers: {
        ...(await getNativeHeaders()),
        ...(init.headers || {})
      }
    }), 'Firestore REST request');
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(payload?.error?.message || `Firestore request failed (${response.status}).`) as Error & { status?: number };
      error.status = response.status;
      throw error;
    }
    return payload;
  };
  return shouldDedupNativeRestRequest(path, init)
    ? loadDedupedNativeRestRequest(getNativeRestDedupKey(url, init), runRequest)
    : runRequest();
}

function encodeFirestoreValue(value: any): Record<string, unknown> {
  if (value === null || value === undefined) return { nullValue: 'NULL_VALUE' };
  if (typeof value === 'string') return { stringValue: value };
  if (typeof value === 'boolean') return { booleanValue: value };
  if (typeof value === 'number') return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  if (value instanceof Date) return { timestampValue: value.toISOString() };
  if (Array.isArray(value)) return { arrayValue: { values: value.map((entry) => encodeFirestoreValue(entry)) } };
  if (typeof value === 'object') {
    return {
      mapValue: {
        fields: Object.keys(value).reduce<Record<string, Record<string, unknown>>>((acc, key) => {
          acc[key] = encodeFirestoreValue(value[key]);
          return acc;
        }, {})
      }
    };
  }
  return { stringValue: String(value) };
}

async function nativeGetDocument(path: string) {
  try {
    return mapFirestoreDocument(await nativeFirestoreRequest(`/${path}`) as NativeFirestoreDocument);
  } catch (error: any) {
    const message = String(error?.message || '').toLowerCase();
    if (error?.status === 404 || message.includes('not_found') || message.includes('not found')) {
      return null;
    }
    throw error;
  }
}

async function nativeListCollection(path: string, params: Record<string, string | number> = {}) {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => query.set(key, String(value)));
  const suffix = query.toString() ? `?${query.toString()}` : '';
  const payload = await nativeFirestoreRequest(`/${path}${suffix}`);
  return (payload.documents || [])
    .map((document: NativeFirestoreDocument) => mapFirestoreDocument(document))
    .filter(Boolean) as FirestoreDocument[];
}

async function nativePatchDocument(path: string, data: Record<string, unknown>) {
  const fields = Object.keys(data).reduce<Record<string, Record<string, unknown>>>((acc, key) => {
    acc[key] = encodeFirestoreValue(data[key]);
    return acc;
  }, {});
  const params = new URLSearchParams();
  Object.keys(data).forEach((key) => params.append('updateMask.fieldPaths', key));
  const suffix = params.toString() ? `?${params.toString()}` : '';
  await nativeFirestoreRequest(`/${path}${suffix}`, {
    method: 'PATCH',
    body: JSON.stringify({ fields })
  });
}

async function nativeCreateDocument(path: string, data: Record<string, unknown>, options: { documentId?: string | null } = {}) {
  const fields = Object.keys(data).reduce<Record<string, Record<string, unknown>>>((acc, key) => {
    acc[key] = encodeFirestoreValue(data[key]);
    return acc;
  }, {});
  if (options.documentId) {
    return mapFirestoreDocument(await nativeFirestoreRequest(`/${path}/${encodeURIComponent(options.documentId)}`, {
      method: 'PATCH',
      body: JSON.stringify({ fields })
    }) as NativeFirestoreDocument);
  }
  return mapFirestoreDocument(await nativeFirestoreRequest(`/${path}`, {
    method: 'POST',
    body: JSON.stringify({ fields })
  }) as NativeFirestoreDocument);
}

async function nativeRunQuery(structuredQuery: Record<string, unknown>) {
  const payload = await nativeFirestoreRequest(':runQuery', {
    method: 'POST',
    body: JSON.stringify({ structuredQuery })
  });
  return (Array.isArray(payload) ? payload : [])
    .map((entry) => mapFirestoreDocument(entry.document as NativeFirestoreDocument))
    .filter(Boolean) as FirestoreDocument[];
}

async function nativeQueryTeamsByField(fieldPath: string, op: string, value: string) {
  if (!value) return [];
  return nativeRunQuery({
    from: [{ collectionId: 'teams' }],
    where: {
      fieldFilter: {
        field: { fieldPath },
        op,
        value: encodeFirestoreValue(value)
      }
    }
  });
}

async function nativeGetUsersByParentPlayerKey(parentPlayerKey: string) {
  if (!parentPlayerKey) return [];
  return nativeRunQuery({
    from: [{ collectionId: 'users' }],
    where: {
      fieldFilter: {
        field: { fieldPath: 'parentPlayerKeys' },
        op: 'ARRAY_CONTAINS',
        value: encodeFirestoreValue(parentPlayerKey)
      }
    },
    limit: 25
  }).catch(() => []);
}

async function nativeGetUserByEmail(email: string) {
  const [user] = await nativeRunQuery({
    from: [{ collectionId: 'users' }],
    where: {
      fieldFilter: {
        field: { fieldPath: 'email' },
        op: 'EQUAL',
        value: encodeFirestoreValue(email)
      }
    },
    limit: 1
  }).catch(() => []);
  return user || null;
}

function getMessageCollectionPath(teamId: string, conversationId = DEFAULT_TEAM_CONVERSATION_ID) {
  if (isDefaultTeamConversation(conversationId)) {
    return `teams/${encodeURIComponent(teamId)}/chatMessages`;
  }
  return `teams/${encodeURIComponent(teamId)}/chatConversations/${encodeURIComponent(conversationId)}/chatMessages`;
}

function getMessageDocumentPath(teamId: string, messageId: string, conversationId = DEFAULT_TEAM_CONVERSATION_ID) {
  return `${getMessageCollectionPath(teamId, conversationId)}/${encodeURIComponent(messageId)}`;
}

function mapUserWithProfile(user: AuthUser, profile: Record<string, any>) {
  return {
    ...user,
    parentOf: Array.isArray(profile.parentOf) ? profile.parentOf : Array.isArray(user.parentOf) ? user.parentOf : [],
    parentTeamIds: Array.isArray(profile.parentTeamIds) ? profile.parentTeamIds : Array.isArray(user.parentTeamIds) ? user.parentTeamIds : [],
    parentPlayerKeys: Array.isArray(profile.parentPlayerKeys) ? profile.parentPlayerKeys : Array.isArray(user.parentPlayerKeys) ? user.parentPlayerKeys : [],
    isAdmin: profile.isAdmin === true || user.isAdmin === true || user.roles?.includes('platformAdmin')
  };
}

function getGuardianParticipantIdsForPlayer(player: Record<string, any> = {}) {
  const parentEntries = Array.isArray(player.parents) ? player.parents : [];
  const participantIds = parentEntries.flatMap((parent: Record<string, any> = {}) => {
    const userId = compactString(parent.userId);
    const email = compactString(parent.email).toLowerCase();
    return [
      userId ? getRecipientOptionId('user', userId) : '',
      email ? getRecipientOptionId('email', email) : ''
    ].filter(Boolean);
  });
  const parentUserId = compactString(player.parentUserId);
  const parentEmail = compactString(player.parentEmail).toLowerCase();
  if (parentUserId) participantIds.push(getRecipientOptionId('user', parentUserId));
  if (parentEmail) participantIds.push(getRecipientOptionId('email', parentEmail));
  return Array.from(new Set(participantIds));
}

function getGuardianParticipantIdsForUsers(users: Record<string, any>[] = []) {
  return Array.from(new Set(users.flatMap((user) => {
    const userId = compactString(user?.id || user?.uid);
    const email = compactString(user?.email).toLowerCase();
    return [
      userId ? getRecipientOptionId('user', userId) : '',
      email ? getRecipientOptionId('email', email) : ''
    ].filter(Boolean);
  })));
}

async function resolveLinkedGuardianParticipantIds(teamId: string, playerId: string) {
  const parentPlayerKey = `${teamId}::${playerId}`;
  try {
    const users = await withTimeout(Promise.resolve(getUsersByParentPlayerKey(parentPlayerKey)), 'Chat linked guardian resolution', 2500)
      .catch(async (error) => {
        if (!isNativeRuntime()) throw error;
        logger.warn('Falling back to REST linked guardian resolution.', { error });
        return nativeGetUsersByParentPlayerKey(parentPlayerKey);
      });
    return getGuardianParticipantIdsForUsers(Array.isArray(users) ? users : []);
  } catch (error) {
    logger.warn('Failed to resolve linked player guardians.', { error });
    return [];
  }
}

async function resolveConversationParticipantIds(teamId: string, senderId: string, recipientIds: string[]) {
  const normalizedRecipientIds = (recipientIds || []).map((id) => compactString(id)).filter(Boolean);
  const playerIds = normalizedRecipientIds
    .filter((id) => id.toLowerCase().startsWith('player:'))
    .map((id) => id.slice(7).trim())
    .filter(Boolean);

  if (playerIds.length === 0) {
    return Array.from(new Set([senderId, ...normalizedRecipientIds].filter(Boolean)));
  }

  let playersById = new Map<string, Record<string, any>>();
  try {
    const players = await withTimeout(Promise.resolve(getPlayers(teamId)), 'Chat player recipient resolution', 2500);
    playersById = new Map((Array.isArray(players) ? players : [])
      .filter((player: any) => player?.id)
      .map((player: any) => [String(player.id), player]));
  } catch (error) {
    logger.warn('Failed to resolve player chat recipients to guardians.', { error });
  }

  const linkedGuardiansByPlayerId = new Map<string, string[]>();
  await Promise.all(playerIds.map(async (playerId) => {
    const rosterGuardianIds = getGuardianParticipantIdsForPlayer(playersById.get(playerId) || {});
    if (rosterGuardianIds.length) {
      linkedGuardiansByPlayerId.set(playerId, rosterGuardianIds);
      return;
    }
    linkedGuardiansByPlayerId.set(playerId, await resolveLinkedGuardianParticipantIds(teamId, playerId));
  }));

  const unresolvedPlayerIds: string[] = [];
  const resolvedRecipients = normalizedRecipientIds.flatMap((recipientId) => {
    if (!recipientId.toLowerCase().startsWith('player:')) return [recipientId];
    const playerId = recipientId.slice(7).trim();
    const guardianParticipantIds = linkedGuardiansByPlayerId.get(playerId) || [];
    if (!guardianParticipantIds.length) unresolvedPlayerIds.push(playerId);
    return guardianParticipantIds;
  });

  if (unresolvedPlayerIds.length) {
    throw new Error('Selected player recipients must have a linked guardian before starting a private chat.');
  }

  return Array.from(new Set([senderId, ...resolvedRecipients].filter(Boolean)));
}

function getTeamRole(user: AuthUser, team: Record<string, any>, profile: Record<string, any>): ChatTeam['role'] {
  if (canModerateChat(mapUserWithProfile(user, profile), team)) {
    return team.ownerId === user.uid || user.isAdmin ? 'Admin' : 'Coach';
  }
  return 'Parent';
}

async function nativeLoadUserTeams(user: AuthUser, profile: Record<string, any>) {
  const ownedTeams = await nativeQueryTeamsByField('ownerId', 'EQUAL', user.uid);
  const adminTeams = user.email ? await nativeQueryTeamsByField('adminEmails', 'ARRAY_CONTAINS', user.email.toLowerCase()) : [];
  const parentTeamIds = [
    ...(Array.isArray(profile.parentOf) ? profile.parentOf.map((entry: any) => entry?.teamId) : []),
    ...(Array.isArray(profile.parentTeamIds) ? profile.parentTeamIds : [])
  ].map(compactString).filter(Boolean);
  const parentTeams = await Promise.all([...new Set(parentTeamIds)].map((teamId) => nativeGetDocument(`teams/${encodeURIComponent(teamId)}`)));
  const map = new Map<string, FirestoreDocument>();
  [...ownedTeams, ...adminTeams, ...parentTeams].forEach((team) => {
    if (team?.id) map.set(team.id, team);
  });
  return [...map.values()]
    .filter(isTeamActive)
    .sort((a, b) => String(a.name || a.id).localeCompare(String(b.name || b.id)));
}

function getMessageTime(message: ChatMessage | null) {
  return toDate(message?.createdAt)?.getTime() || 0;
}

function getTeamChatStateEntry(profile: Record<string, any>, teamId: string): TeamChatStateEntry {
  const state = profile?.teamChatState;
  if (!state || typeof state !== 'object') return {};
  const teamState = state[teamId];
  return teamState && typeof teamState === 'object' ? teamState as TeamChatStateEntry : {};
}

function isConversationMuted(profile: Record<string, any>, teamId: string, conversationId = DEFAULT_TEAM_CONVERSATION_ID) {
  const mutedConversations = getTeamChatStateEntry(profile, teamId).mutedConversations;
  if (mutedConversations && typeof mutedConversations === 'object' && mutedConversations[conversationId]) {
    return true;
  }
  return isDefaultTeamConversation(conversationId)
    && Boolean(profile?.chatMuted && typeof profile.chatMuted === 'object' && profile.chatMuted[teamId]);
}

function getNewestChatMessage(messages: Array<ChatMessage | null>) {
  return messages.reduce<ChatMessage | null>((newest, message) => (
    getMessageTime(message) > getMessageTime(newest) ? message : newest
  ), null);
}

function getConversationActivityTime(conversation: ChatConversation | null | undefined) {
  const conversationTime = toDate(conversation?.lastMessageAt || conversation?.updatedAt);
  return conversationTime ? conversationTime.getTime() : null;
}

function getTeamLatestMessageTime(team: Record<string, any>) {
  return team?.lastMessageAt
    || team?.chatLastMessageAt
    || team?.lastChatMessageAt
    || null;
}

function getConversationIdFromMetadata(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, any>;
  const id = String(record.id || record.conversationId || record.key || '').trim();
  return id || null;
}

function getConversationLatestMessageTimeFromMetadata(value: unknown) {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, any>;
  return record.lastMessageAt || record.latestMessageAt || record.updatedAt || null;
}

function shouldRequestUnreadCount(
  profile: Record<string, any>,
  teamId: string,
  latestMessageAt: unknown,
  latestMessageAtByConversation: Record<string, unknown> = {}
) {
  const teamState = getTeamChatStateEntry(profile, teamId);
  const defaultLastReadAt = teamState.lastReadAt || profile?.chatLastRead?.[teamId] || null;
  const lastReadByConversation = teamState.lastReadByConversation || {};

  for (const [conversationId, conversationLatestMessageAt] of Object.entries(latestMessageAtByConversation)) {
    const conversationLatestTime = toDate(conversationLatestMessageAt)?.getTime() || 0;
    if (conversationLatestTime === 0) return true;

    const conversationLastReadAt = isDefaultTeamConversation(conversationId)
      ? defaultLastReadAt
      : lastReadByConversation[conversationId] || null;
    if (!conversationLastReadAt) return true;

    const conversationLastReadTime = toDate(conversationLastReadAt)?.getTime() || 0;
    if (conversationLastReadTime === 0 || conversationLatestTime > conversationLastReadTime) return true;
  }

  if (!latestMessageAt) return true;
  if (!defaultLastReadAt) return true;

  const latestTime = toDate(latestMessageAt)?.getTime() || 0;
  const lastReadTime = toDate(defaultLastReadAt)?.getTime() || 0;
  return latestTime === 0 || lastReadTime === 0 || latestTime > lastReadTime;
}

function getTeamConversationMetadata(team: Record<string, any>) {
  const ids = new Set<string>();
  const latestMessageAtByConversation: Record<string, unknown> = {};
  const addConversation = (conversation: unknown, fallbackId?: string) => {
    const id = getConversationIdFromMetadata(conversation) || String(fallbackId || '').trim();
    if (!id) return;
    ids.add(id);
    const latestMessageAt = getConversationLatestMessageTimeFromMetadata(conversation);
    if (latestMessageAt) {
      latestMessageAtByConversation[id] = latestMessageAt;
    }
  };

  [
    team?.chatConversations,
    team?.conversations,
    team?.conversationSummaries,
    team?.chatConversationSummaries,
    team?.conversationMetadata,
    team?.chatConversationMetadata
  ].forEach((metadata) => {
    if (Array.isArray(metadata)) {
      metadata.forEach((conversation) => addConversation(conversation));
    } else if (metadata && typeof metadata === 'object') {
      Object.entries(metadata as Record<string, unknown>).forEach(([id, conversation]) => addConversation(conversation, id));
    }
  });

  if (Array.isArray(team?.chatConversationIds)) {
    team.chatConversationIds.forEach((id: unknown) => {
      const conversationId = String(id || '').trim();
      if (conversationId) ids.add(conversationId);
    });
  }

  const defaultLatestMessageAt = getTeamLatestMessageTime(team);
  if (defaultLatestMessageAt) {
    latestMessageAtByConversation[DEFAULT_TEAM_CONVERSATION_ID] = defaultLatestMessageAt;
  }

  return {
    ids: Array.from(ids),
    latestMessageAtByConversation
  };
}

async function getLatestConversationMessage(teamId: string, conversationId: string): Promise<ChatMessage | null> {
  try {
    const [message] = await withTimeout(Promise.resolve(getChatMessages(teamId, { limit: 1, conversationId })), `latest chat ${teamId}/${conversationId}`, 2500);
    return mapChatMessageRecord(message, message?.id || '') || null;
  } catch (error) {
    if (!isNativeRuntime()) return null;
    const path = isDefaultTeamConversation(conversationId)
      ? `teams/${encodeURIComponent(teamId)}/chatMessages`
      : `teams/${encodeURIComponent(teamId)}/chatConversations/${encodeURIComponent(conversationId)}/chatMessages`;
    const [message] = await nativeListCollection(path, {
      orderBy: 'createdAt desc',
      pageSize: 1
    }).catch(() => []);
    return mapChatMessageRecord(message, message?.id || '') || null;
  }
}

async function getLatestMessagePreview(teamId: string, user: AuthUser, team: Record<string, any>, canModerate: boolean): Promise<{ message: ChatMessage | null; conversationId: string | null }> {
  let conversations: ChatConversation[] = [buildDefaultTeamConversation(team)];
  try {
    const loadedConversations = await withTimeout(
      Promise.resolve(getChatConversations(teamId, user, { team, canModerate })),
      `latest chat conversations ${teamId}`,
      2500
    ) as ChatConversation[];
    const mappedConversations = mapChatConversationRecords(loadedConversations);
    conversations = mappedConversations.length
      ? mappedConversations
      : [buildDefaultTeamConversation(team)];
  } catch (error) {
    if (!isNativeRuntime()) {
      conversations = [buildDefaultTeamConversation(team)];
    } else {
      logger.warn('Latest inbox preview limited to team chat.', { error });
    }
  }

  const rankedConversations = conversations
    .filter((conversation) => conversation?.id)
    .map((conversation) => ({
      conversation,
      activityTime: getConversationActivityTime(conversation)
    }))
    .sort((a, b) => (b.activityTime || 0) - (a.activityTime || 0));

  const metadataCandidate = rankedConversations.find(({ activityTime }) => activityTime !== null)?.conversation || null;
  const missingMetadataConversations = rankedConversations
    .filter(({ activityTime }) => activityTime === null)
    .map(({ conversation }) => conversation);

  const previewCandidates = metadataCandidate && missingMetadataConversations.length === 0
    ? [metadataCandidate]
    : Array.from(new Map(
      [metadataCandidate, ...missingMetadataConversations]
        .filter((conversation): conversation is ChatConversation => Boolean(conversation?.id))
        .map((conversation) => [conversation.id, conversation])
    ).values());

  const messages = await Promise.all(previewCandidates.map(async (conversation) => ({
    conversationId: conversation.id,
    message: await getLatestConversationMessage(teamId, conversation.id)
  })));
  const previewMessage = messages.reduce<{ message: ChatMessage | null; conversationId: string | null }>((newest, candidate) => (
    getMessageTime(candidate.message) > getMessageTime(newest.message)
      ? candidate
      : newest
  ), { message: null, conversationId: null });
  if (previewMessage.message) return previewMessage;

  const attemptedConversationIds = new Set(previewCandidates.map((conversation) => conversation.id));
  const fallbackMessages = await Promise.allSettled(
    rankedConversations
      .map(({ conversation }) => conversation)
      .filter((conversation): conversation is ChatConversation => Boolean(conversation?.id && !attemptedConversationIds.has(conversation.id)))
      .map(async (conversation) => ({
        conversationId: conversation.id,
        message: await getLatestConversationMessage(teamId, conversation.id)
      }))
  );
  const fallbackPreview = fallbackMessages.reduce<{ message: ChatMessage | null; conversationId: string | null }>((newest, result) => {
    if (result.status !== 'fulfilled') return newest;
    return getMessageTime(result.value.message) > getMessageTime(newest.message)
      ? result.value
      : newest;
  }, { message: null, conversationId: null });
  if (fallbackPreview.message) return fallbackPreview;

  return {
    message: null,
    conversationId: null
  };
}

function loadCachedMessagePreview(teamId: string, user: AuthUser, team: Record<string, any>, canModerate: boolean) {
  return loadCachedAppData(
    `chat-preview:${user.uid}:${teamId}:${canModerate ? 'moderator' : 'member'}`,
    () => getLatestMessagePreview(teamId, user, team, canModerate),
    {
      ttlMs: chatPreviewCacheTtlMs,
      persist: false
    }
  );
}

async function runDeferredInboxPreviewQueue<T>(items: T[], worker: (item: T) => Promise<void>, concurrency = deferredInboxPreviewConcurrency): Promise<void> {
  if (items.length === 0) return;
  const workerCount = Math.min(Math.max(1, concurrency), items.length);
  let nextIndex = 0;

  await Promise.allSettled(Array.from({ length: workerCount }, async () => {
    while (nextIndex < items.length) {
      const item = items[nextIndex];
      nextIndex += 1;
      await worker(item);
    }
  }));
}

export async function loadChatInbox(user: AuthUser | null, options: ChatInboxLoadOptions = {}): Promise<ChatInboxLoadResult> {
  if (!user?.uid) return { teams: [] };
  const includeLastMessages = options.includeLastMessages !== false;
  const onPreview = typeof options.onPreview === 'function' ? options.onPreview : null;

  const profile = await withTimeout(Promise.resolve(getUserProfile(user.uid)), 'Chat profile load').catch(async (error) => {
    if (!isNativeRuntime()) throw error;
    return nativeGetDocument(`users/${encodeURIComponent(user.uid)}`);
  }) as Record<string, any> || {};

  let teams: Record<string, any>[] = [];
  try {
    const [memberTeams, parentTeams] = await withTimeout(Promise.all([
      getUserTeamsWithAccess(user.uid, user.email || profile.email || ''),
      getParentTeams(user.uid)
    ]), 'Chat teams load');
    const map = new Map<string, Record<string, any>>();
    [...memberTeams, ...parentTeams].forEach((team: any) => {
      if (team?.id) map.set(team.id, team);
    });
    teams = [...map.values()];
  } catch (error) {
    if (!isNativeRuntime()) throw error;
    logger.warn('Falling back to REST team load.', { error });
    teams = await nativeLoadUserTeams(user, profile);
  }

  const userWithProfile = mapUserWithProfile(user, profile);
  const accessibleTeams = teams.filter((team) => isTeamActive(team) && canAccessTeamChat(userWithProfile, { ...team, id: team.id }));
  const latestMessageAtByTeam = accessibleTeams.reduce<Record<string, unknown>>((acc, team) => {
    const latestMessageAt = getTeamLatestMessageTime(team);
    if (latestMessageAt) {
      acc[team.id] = latestMessageAt;
    }
    return acc;
  }, {});
  const conversationMetadataByTeam = accessibleTeams.reduce<Record<string, ReturnType<typeof getTeamConversationMetadata>>>((acc, team) => {
    acc[team.id] = getTeamConversationMetadata(team);
    return acc;
  }, {});
  const conversationIdsByTeam = accessibleTeams.reduce<Record<string, string[]>>((acc, team) => {
    const metadata = conversationMetadataByTeam[team.id];
    if (!includeLastMessages) {
      acc[team.id] = Array.from(new Set([DEFAULT_TEAM_CONVERSATION_ID, ...metadata.ids]));
    } else if (metadata.ids.length > 0) {
      acc[team.id] = Array.from(new Set([DEFAULT_TEAM_CONVERSATION_ID, ...metadata.ids]));
    }
    return acc;
  }, {});
  const latestMessageAtByConversationByTeam = accessibleTeams.reduce<Record<string, Record<string, unknown>>>((acc, team) => {
    const latestMessageAtByConversation = conversationMetadataByTeam[team.id]?.latestMessageAtByConversation || {};
    if (Object.keys(latestMessageAtByConversation).length > 0) {
      acc[team.id] = latestMessageAtByConversation;
    }
    return acc;
  }, {});
  const previewInputs = accessibleTeams.map((team) => {
    const canModerate = canModerateChat(userWithProfile, { ...team, id: team.id });
    return {
      team,
      canModerate
    };
  });
  const conversationLookupByTeam = previewInputs.reduce<Record<string, { user: AuthUser; team: Record<string, any>; canModerate: boolean }>>((acc, entry) => {
    acc[entry.team.id] = {
      user: userWithProfile,
      team: entry.team,
      canModerate: entry.canModerate
    };
    return acc;
  }, {});
  const unreadCandidateTeamIds = accessibleTeams
    .filter((team) => shouldRequestUnreadCount(
      profile,
      team.id,
      latestMessageAtByTeam[team.id],
      latestMessageAtByConversationByTeam[team.id]
    ))
    .map((team) => team.id);
  const unreadCounts = await withTimeout(
    Promise.resolve(getUnreadChatCounts(user.uid, unreadCandidateTeamIds, {
      latestMessageAtByTeam,
      latestMessageAtByConversationByTeam,
      conversationIdsByTeam,
      conversationLookupByTeam,
      defaultConversationOnly: !includeLastMessages
    })),
    'Chat unread counts',
    3000
  ).catch(() => ({} as Record<string, number>));

  const previews = includeLastMessages
    ? await Promise.all(previewInputs.map(async ({ team, canModerate }) => ({
      team,
      canModerate,
      preview: await loadCachedMessagePreview(team.id, userWithProfile, team, canModerate)
    })))
    : previewInputs.map(({ team, canModerate }) => ({
      team,
      canModerate,
      preview: { message: null, conversationId: null }
    }));

  if (!includeLastMessages && onPreview && accessibleTeams.length > 0) {
    void runDeferredInboxPreviewQueue(previewInputs, async ({ team, canModerate }) => {
      try {
        const preview = await loadCachedMessagePreview(team.id, userWithProfile, team, canModerate);
        onPreview({
          teamId: team.id,
          lastMessage: preview.message,
          preferredConversationId: preview.conversationId && !isDefaultTeamConversation(preview.conversationId)
            ? preview.conversationId
            : null,
          isMuted: isConversationMuted(profile, team.id, preview.conversationId || DEFAULT_TEAM_CONVERSATION_ID)
        });
      } catch (error) {
        logger.warn('Deferred inbox preview failed.', { error });
      }
    });
  }

  return {
    teams: previews.map(({ team, canModerate, preview }) => ({
      id: team.id,
      name: team.name || 'Team',
      sport: team.sport || null,
      photoUrl: team.photoUrl || null,
      active: team.active,
      archived: team.archived,
      status: team.status,
      role: getTeamRole(user, team, profile),
      canModerate,
      unreadCount: Number(unreadCounts[team.id] || 0),
      lastMessage: preview.message,
      preferredConversationId: preview.conversationId && !isDefaultTeamConversation(preview.conversationId)
        ? preview.conversationId
        : null,
      isMuted: isConversationMuted(profile, team.id, preview.conversationId || DEFAULT_TEAM_CONVERSATION_ID)
    })).sort((a, b) => {
      const aTime = toDate(a.lastMessage?.createdAt)?.getTime() || 0;
      const bTime = toDate(b.lastMessage?.createdAt)?.getTime() || 0;
      if (aTime !== bTime) return bTime - aTime;
      return a.name.localeCompare(b.name);
    })
  };
}

export async function loadChatTeamContext(teamId: string, user: AuthUser | null) {
  if (!user?.uid || !teamId) {
    throw new Error('Team chat requires a signed-in user and team.');
  }

  const [team, profile] = await Promise.all([
    withTimeout(Promise.resolve(getTeam(teamId)), 'Chat team load').catch(async (error) => {
      if (!isNativeRuntime()) throw error;
      return nativeGetDocument(`teams/${encodeURIComponent(teamId)}`);
    }),
    withTimeout(Promise.resolve(getUserProfile(user.uid)), 'Chat profile load').catch(async (error) => {
      if (!isNativeRuntime()) throw error;
      return nativeGetDocument(`users/${encodeURIComponent(user.uid)}`);
    })
  ]);

  if (!team || !isTeamActive(team as Record<string, any>)) throw new Error('Team not found.');
  const currentTeam = { ...team, id: teamId };
  const profileData = profile || {};
  const userWithProfile = mapUserWithProfile(user, profileData as Record<string, any>);
  if (!canAccessTeamChat(userWithProfile, currentTeam)) {
    throw new Error('You do not have access to this team chat.');
  }

  return {
    team: currentTeam,
    profile: profileData as Record<string, any>,
    canModerate: canModerateChat(userWithProfile, currentTeam)
  };
}

export async function loadChatConversations(teamId: string, user: AuthUser, team: Record<string, any>, canModerate: boolean): Promise<ChatConversation[]> {
  try {
    const conversations = await withTimeout(Promise.resolve(getChatConversations(teamId, user, { team, canModerate })), 'Chat conversations load') as ChatConversation[];
    return mapChatConversationRecords(conversations);
  } catch (error) {
    logger.warn('Falling back to default chat conversation.', { error });
    return [buildDefaultTeamConversation(team) as ChatConversation];
  }
}

function canReuseStaffChatConversation(conversation: ChatConversation | null | undefined) {
  if (!isStaffConversation(conversation)) return false;
  return !Array.isArray(conversation?.participantIds) || conversation.participantIds.length === 0;
}

export async function ensureStaffChatConversation(teamId: string, user: AuthUser, conversations: ChatConversation[] = []): Promise<ChatConversation> {
  const existing = conversations.find((conversation) => canReuseStaffChatConversation(conversation));
  if (existing) return existing;

  return await withTimeout(Promise.resolve(upsertChatConversation(teamId, {
    type: 'group',
    participantIds: [],
    participantRoles: ['staff'],
    mutedBy: [],
    name: 'Staff only'
  })), 'Staff chat conversation create') as ChatConversation;
}

export function subscribeToTeamChatMessages(
  teamId: string,
  conversationId: string,
  onMessages: (messages: ChatMessage[], oldestDoc: unknown | null) => void,
  onError?: (error: Error) => void
): ChatSubscribeResult {
  let cancelled = false;
  let unsubscribe: (() => void) | null = null;
  let pollTimer: number | undefined;

  const startPollingFallback = async () => {
    const load = async () => {
      if (cancelled) return;
      try {
        const messages = await nativeListCollection(getMessageCollectionPath(teamId, conversationId), {
          orderBy: 'createdAt desc',
          pageSize: 50
        });
        const mappedMessages = mapChatMessageRecords(messages);
        onMessages(mappedMessages, mappedMessages[mappedMessages.length - 1]?._doc || null);
      } catch (error: any) {
        onError?.(error);
      }
    };
    await load();
    if (!cancelled) {
      pollTimer = window.setInterval(load, 8000);
    }
  };

  try {
    unsubscribe = subscribeToChatMessages(teamId, { limit: 50, conversationId }, (messages: ChatMessage[], oldestDoc: unknown | null) => {
      if (!cancelled) {
        const mappedMessages = mapChatMessageRecords(messages);
        onMessages(mappedMessages, oldestDoc);
      }
    }, onError);
  } catch (error: any) {
    if (!isNativeRuntime()) {
      onError?.(error);
    } else {
      void startPollingFallback();
    }
  }

  return {
    unsubscribe: () => {
      cancelled = true;
      if (pollTimer) window.clearInterval(pollTimer);
      unsubscribe?.();
    }
  };
}

export async function loadOlderTeamChatMessages(teamId: string, conversationId: string, startAfterDoc: unknown | null) {
  if (!startAfterDoc) return [];
  try {
    const messages = await withTimeout(Promise.resolve(getChatMessages(teamId, {
      limit: 50,
      startAfterDoc,
      conversationId
    })), 'Older chat messages load') as ChatMessage[];
    return mapChatMessageRecords(messages);
  } catch (error) {
    if (!isNativeRuntime()) throw error;
    logger.warn('Older chat history is limited in native REST fallback.', { error });
    return [];
  }
}

function readImageUploadSession(): ImageUploadSession | null {
  try {
    const raw = window.localStorage?.getItem(imageUploadSessionKey);
    return raw ? JSON.parse(raw) as ImageUploadSession : null;
  } catch {
    return null;
  }
}

function writeImageUploadSession(session: ImageUploadSession) {
  try {
    window.localStorage?.setItem(imageUploadSessionKey, JSON.stringify(session));
  } catch (error) {
    logger.warn('Unable to persist chat image upload session.', { error });
  }
}

async function refreshImageUploadSession(session: ImageUploadSession): Promise<ImageUploadSession> {
  const response = await withTimeout(fetch(`https://securetoken.googleapis.com/v1/token?key=${encodeURIComponent(session.apiKey)}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: session.refreshToken
    })
  }), 'Chat media upload auth refresh');
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.error?.message || 'Chat media upload auth refresh failed.');
  }
  const nextSession = {
    apiKey: session.apiKey,
    idToken: payload.id_token || session.idToken,
    refreshToken: payload.refresh_token || session.refreshToken,
    expirationTime: Date.now() + Math.max(Number.parseInt(payload.expires_in || '3600', 10) - 30, 60) * 1000
  };
  writeImageUploadSession(nextSession);
  return nextSession;
}

async function createImageUploadSession(apiKey: string): Promise<ImageUploadSession> {
  const response = await withTimeout(fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${encodeURIComponent(apiKey)}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ returnSecureToken: true })
  }), 'Chat media upload auth');
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.error?.message || 'Chat media upload auth failed.');
  }
  const session = {
    apiKey,
    idToken: payload.idToken,
    refreshToken: payload.refreshToken,
    expirationTime: Date.now() + Math.max(Number.parseInt(payload.expiresIn || '3600', 10) - 30, 60) * 1000
  };
  if (!session.idToken || !session.refreshToken) {
    throw new Error('Chat media upload auth did not return a usable token.');
  }
  writeImageUploadSession(session);
  return session;
}

async function getImageUploadSession(apiKey: string) {
  const existing = readImageUploadSession();
  if (existing?.apiKey === apiKey && existing.expirationTime > Date.now() + 60000) {
    return existing;
  }
  if (existing?.apiKey === apiKey && existing.refreshToken) {
    try {
      return await refreshImageUploadSession(existing);
    } catch (error) {
      logger.warn('Refreshing chat media upload auth failed.', { error });
    }
  }
  return createImageUploadSession(apiKey);
}

async function nativeUploadChatMedia(teamId: string, file: File, conversationId = DEFAULT_TEAM_CONVERSATION_ID): Promise<ChatAttachment> {
  const imageConfig = resolveImageFirebaseConfig();
  const bucket = imageConfig.storageBucket;
  if (!imageConfig.apiKey || !bucket) {
    throw new Error('Image upload Firebase config is missing.');
  }
  const session = await getImageUploadSession(imageConfig.apiKey);
  const safeName = String(file.name || 'media').replace(/[^\w.-]+/g, '_');
  const isVideo = String(file.type || '').toLowerCase().startsWith('video/');
  const mediaFolder = isVideo ? 'team-videos' : 'team-photos';
  const safeConversationId = String(conversationId || DEFAULT_TEAM_CONVERSATION_ID).replace(/[^\w.-]+/g, '_') || DEFAULT_TEAM_CONVERSATION_ID;
  const path = `${mediaFolder}/${Date.now()}_chat_${teamId}_${safeConversationId}_${safeName}`;
  const response = await withTimeout(fetch(`https://firebasestorage.googleapis.com/v0/b/${encodeURIComponent(bucket)}/o?uploadType=media&name=${encodeURIComponent(path)}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${session.idToken}`,
      'Content-Type': file.type || 'application/octet-stream'
    },
    body: file
  }), 'Chat media upload', chatUploadTimeoutMs);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.error?.message || `Chat media upload failed (${response.status}).`);
  }
  const token = payload.downloadTokens || payload.metadata?.firebaseStorageDownloadTokens;
  const url = token
    ? `https://firebasestorage.googleapis.com/v0/b/${encodeURIComponent(bucket)}/o/${encodeURIComponent(payload.name || path)}?alt=media&token=${encodeURIComponent(String(token).split(',')[0])}`
    : `https://firebasestorage.googleapis.com/v0/b/${encodeURIComponent(bucket)}/o/${encodeURIComponent(payload.name || path)}?alt=media`;

  return {
    type: isVideo ? 'video' : 'image',
    url,
    path,
    name: file.name || null,
    mimeType: file.type || null,
    size: Number.isFinite(file.size) ? file.size : null,
    thumbnailUrl: null
  };
}

export async function uploadTeamChatAttachment(teamId: string, file: File, conversationId = DEFAULT_TEAM_CONVERSATION_ID): Promise<ChatAttachment> {
  if (!file.type.startsWith('image/') && !file.type.startsWith('video/')) {
    throw new Error('Choose image or video files only.');
  }
  if (file.size > MAX_CHAT_MEDIA_SIZE) {
    throw new Error('Photos and videos must be 5MB or smaller each.');
  }
  if (isNativeRuntime()) {
    return nativeUploadChatMedia(teamId, file, conversationId);
  }
  try {
    return await withTimeout(Promise.resolve(uploadChatImage(teamId, file, { conversationId })), 'Chat media upload', chatUploadTimeoutMs) as ChatAttachment;
  } catch (error) {
    throw error;
  }
}

async function uploadTeamChatAttachments({
  teamId,
  files,
  conversationId,
  onUploadStart,
  uploadedAttachments
}: {
  teamId: string;
  files: File[];
  conversationId: string;
  onUploadStart?: () => void;
  uploadedAttachments: Array<ChatAttachment | undefined>;
}): Promise<ChatAttachment[]> {
  if (files.length === 0) return [];

  const orderedAttachments: Array<ChatAttachment | undefined> = new Array(files.length);
  const workerCount = Math.min(chatAttachmentUploadConcurrency, files.length);
  let nextFileIndex = 0;
  let firstError: unknown;
  let hasError = false;

  async function uploadNextAttachment() {
    while (nextFileIndex < files.length && !hasError) {
      const index = nextFileIndex;
      nextFileIndex += 1;
      const file = files[index];
      onUploadStart?.();
      try {
        const attachment = await uploadTeamChatAttachment(teamId, file, conversationId);
        orderedAttachments[index] = attachment;
        uploadedAttachments[index] = attachment;
      } catch (error) {
        if (!hasError) {
          hasError = true;
          firstError = error;
        }
      }
    }
  }

  await Promise.all(Array.from({ length: workerCount }, () => uploadNextAttachment()));

  if (hasError) {
    throw firstError;
  }

  return orderedAttachments.filter((attachment): attachment is ChatAttachment => Boolean(attachment));
}

async function nativePostChatMessage(teamId: string, input: {
  clientMessageId?: string | null;
  text: string;
  senderId: string;
  senderName?: string | null;
  senderEmail?: string | null;
  senderPhotoUrl?: string | null;
  attachments?: ChatAttachment[];
  ai?: boolean;
  aiName?: string | null;
  aiQuestion?: string | null;
  aiMeta?: Record<string, unknown> | null;
  conversationId?: string;
} & ChatAudienceMetadata) {
  const createdAt = new Date();
  const attachments = input.attachments || [];
  const firstImage = attachments.find((attachment) => attachment.type === 'image') || null;
  return nativeCreateDocument(getMessageCollectionPath(teamId, input.conversationId), {
    clientMessageId: input.clientMessageId || null,
    text: input.text || '',
    senderId: input.senderId,
    senderName: input.senderName || null,
    senderEmail: input.senderEmail || null,
    senderPhotoUrl: input.senderPhotoUrl || null,
    attachments: attachments.map((attachment) => ({ ...attachment, uploadedAt: createdAt })),
    imageUrl: firstImage?.url || null,
    imagePath: firstImage?.path || null,
    imageName: firstImage?.name || null,
    imageType: firstImage?.mimeType || null,
    imageSize: firstImage?.size ?? null,
    createdAt,
    editedAt: null,
    deleted: false,
    ai: input.ai === true,
    aiName: input.aiName || null,
    aiQuestion: input.aiQuestion || null,
    aiMeta: input.aiMeta || null,
    targetType: input.targetType,
    recipientIds: input.targetType === 'individuals' ? input.recipientIds : [],
    targetRole: input.targetType === 'staff' ? (input.targetRole || 'staff') : null,
    conversationId: isDefaultTeamConversation(input.conversationId) ? null : input.conversationId
  }, { documentId: input.clientMessageId || null });
}

export async function sendTeamChatMessage({
  teamId,
  clientMessageId,
  user,
  profile,
  text,
  files = [],
  attachments: sharedAttachments = [],
  selectedConversation,
  selectedConversationId,
  selectedRecipientTarget,
  selectedRecipientIds,
  onProgress,
  aiMeta,
  skipInteractionTiming = false
}: {
  teamId: string;
  clientMessageId?: string | null;
  user: AuthUser;
  profile: Record<string, any>;
  text: string;
  files?: File[];
  attachments?: ChatAttachment[];
  selectedConversation?: ChatConversation | null;
  selectedConversationId: string;
  selectedRecipientTarget: ChatTargetType;
  selectedRecipientIds: string[];
  onProgress?: (stage: 'uploading' | 'posting') => void;
  aiMeta?: Record<string, unknown> | null;
  skipInteractionTiming?: boolean;
}) {
  if (selectedRecipientTarget === 'individuals'
    && (selectedRecipientIds || []).map((id) => String(id || '').trim()).filter(Boolean).length === 0) {
    throw new Error('Choose at least one selected member before sending.');
  }

  let interactionHandle: ReturnType<typeof startInteractionTimer> | null = null;
  if (!skipInteractionTiming) {
    const interaction = startInteractionTimer(UX_TIMING.chatSend, {
      attachments: files.length,
      target: selectedRecipientTarget
    });
    interactionHandle = interaction;
  }
  const uploadedAttachments: Array<ChatAttachment | undefined> = [];
  try {
    const targetMetadata = buildChatAudienceMetadata({
      selectedConversation,
      selectedConversationId,
      selectedRecipientTarget,
      selectedRecipientIds
    });

    let conversationId = selectedConversationId || DEFAULT_TEAM_CONVERSATION_ID;
    let createdConversation: ChatConversation | null = null;
    if (isDefaultTeamConversation(conversationId) && targetMetadata.targetType !== 'full_team') {
      const participantIds = targetMetadata.targetType === 'staff'
        ? []
        : await resolveConversationParticipantIds(teamId, user.uid, targetMetadata.recipientIds);
      const participantRoles = targetMetadata.targetType === 'staff' ? ['staff'] : [];
      createdConversation = await withTimeout(Promise.resolve(upsertChatConversation(teamId, {
        type: participantIds.length === 2 ? 'direct' : 'group',
        participantIds,
        participantRoles,
        mutedBy: [],
        name: targetMetadata.targetType === 'staff' ? 'Staff only' : null
      })), 'Chat conversation create') as ChatConversation;
      conversationId = createdConversation.id;
    }

    const orderedUploadedAttachments = await uploadTeamChatAttachments({
      teamId,
      files,
      conversationId,
      onUploadStart: () => onProgress?.('uploading'),
      uploadedAttachments
    });
    onProgress?.('posting');

    const attachments = [...sharedAttachments, ...orderedUploadedAttachments];

    const payload = {
      clientMessageId: clientMessageId || null,
      text,
      senderId: user.uid,
      senderName: profile.fullName || user.displayName || null,
      senderEmail: user.email,
      senderPhotoUrl: profile.photoUrl || user.photoUrl || null,
      attachments,
      conversationId,
      aiMeta: aiMeta || null,
      ...targetMetadata
    };

    if (isNativeRuntime()) {
      await nativePostChatMessage(teamId, payload);
    } else {
      await withTimeout(Promise.resolve(postChatMessage(teamId, payload)), 'Chat message send');
    }

    if (interactionHandle) {
      const interaction = interactionHandle;
      interaction.end({ path: isNativeRuntime() ? 'native' : 'sdk' });
    }
    return {
      conversationId,
      createdConversation,
      wantsAi: hasAllPlaysMention(text)
    };
  } catch (error) {
    if (interactionHandle) {
      const interaction = interactionHandle;
      interaction.end({ error: (error as Error)?.message || 'Chat send failed' });
    }
    const cleanupAttachments = uploadedAttachments.filter((attachment): attachment is ChatAttachment => Boolean(attachment));
    if (cleanupAttachments.length > 0) {
      try {
        await deleteUploadedChatAttachments(cleanupAttachments);
      } catch (cleanupError) {
        logger.error('Failed to clean up uploaded chat attachments.', { error: cleanupError });
      }
    }
    throw error;
  }
}

export async function sendTeamEmailMessage({
  teamId,
  subject,
  body,
  targetType = 'full_team',
  recipientIds = []
}: {
  teamId: string;
  subject: string;
  body: string;
  targetType?: ChatTargetType;
  recipientIds?: string[];
}) {
  const trimmedSubject = String(subject || '').trim();
  const trimmedBody = String(body || '').trim();
  if (!trimmedSubject || !trimmedBody) {
    throw new Error('Subject and message are required.');
  }
  if (targetType === 'individuals' && recipientIds.map((id) => String(id || '').trim()).filter(Boolean).length === 0) {
    throw new Error('Choose at least one selected member before sending.');
  }

  return withTimeout(Promise.resolve(sendTeamEmail(teamId, {
    subject: trimmedSubject,
    body: trimmedBody,
    targetType,
    recipientIds: targetType === 'individuals' ? recipientIds : []
  })), 'Team email send');
}

export async function loadSentTeamEmails(teamId: string, { limit = 25 }: { limit?: number } = {}): Promise<SentTeamEmail[]> {
  return withTimeout(Promise.resolve(getSentTeamEmails(teamId, { limit })), 'Sent email history') as Promise<SentTeamEmail[]>;
}

export async function loadTeamEmailDrafts(teamId: string): Promise<TeamEmailDraft[]> {
  const drafts = await withTimeout(Promise.resolve(getStoredTeamEmailDrafts(teamId)), 'Team email drafts') as Record<string, any>[];
  return drafts
    .map((draft) => normalizeTeamEmailDraft(draft))
    .filter((draft): draft is TeamEmailDraft => Boolean(draft))
    .sort((a, b) => (toDate(b.updatedAt)?.getTime() || 0) - (toDate(a.updatedAt)?.getTime() || 0));
}

export async function loadTeamEmailTemplates(teamId: string): Promise<TeamEmailTemplate[]> {
  const templates = await withTimeout(Promise.resolve(getStoredTeamEmailTemplates(teamId)), 'Team email templates') as Record<string, any>[];
  return templates
    .map((template) => normalizeTeamEmailTemplate(template))
    .filter((template): template is TeamEmailTemplate => Boolean(template));
}

export async function saveTeamEmailDraft({
  teamId,
  draftId,
  subject,
  body,
  recipientIds,
  recipientOptions,
  authorId,
  authorEmail,
  authorName
}: {
  teamId: string;
  draftId?: string | null;
  subject: string;
  body: string;
  recipientIds: string[];
  recipientOptions: ChatRecipientOption[];
  authorId?: string | null;
  authorEmail?: string | null;
  authorName?: string | null;
}): Promise<TeamEmailDraft> {
  const trimmedSubject = compactString(subject);
  const trimmedBody = compactString(body);
  const normalizedRecipientIds = Array.from(new Set((Array.isArray(recipientIds) ? recipientIds : []).map((id) => compactString(id)).filter(Boolean)));

  if (normalizedRecipientIds.length === 0) throw new Error('Choose at least one selected member before saving.');
  if (!trimmedSubject) throw new Error('Enter a subject before saving.');
  if (!trimmedBody) throw new Error('Enter a body before saving.');

  const optionsById = new Map((Array.isArray(recipientOptions) ? recipientOptions : []).map((option) => [compactString(option.id), option]));
  const recipients = normalizedRecipientIds.flatMap((recipientId) => {
    const option = optionsById.get(recipientId);
    const derivedEmail = compactString(option?.email || (recipientId.toLowerCase().startsWith('email:') ? recipientId.slice(6) : '')).toLowerCase();
    if (!derivedEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(derivedEmail)) {
      return [];
    }
    return [{
      key: recipientId,
      email: derivedEmail,
      name: compactString(option?.name) || derivedEmail,
      detail: compactString(option?.detail) || null
    }];
  });

  const saved = await withTimeout(Promise.resolve(saveStoredTeamEmailDraft(teamId, {
    subject: trimmedSubject,
    body: trimmedBody,
    recipients,
    recipientIds: normalizedRecipientIds,
    authorId: authorId || null,
    authorEmail: authorEmail || null,
    authorName: authorName || null,
    status: 'draft'
  }, draftId ? { draftId } : {})), 'Team email draft save') as Record<string, any>;
  const normalized = normalizeTeamEmailDraft(saved);
  if (!normalized) {
    throw new Error('Saved draft is missing required fields.');
  }
  return normalized;
}

export async function saveTeamEmailTemplate({
  teamId,
  name,
  subject,
  body
}: {
  teamId: string;
  name: string;
  subject: string;
  body: string;
}): Promise<TeamEmailTemplate> {
  const trimmedName = String(name || '').trim();
  const trimmedSubject = String(subject || '').trim();
  const trimmedBody = String(body || '').trim();

  if (!trimmedName) throw new Error('Enter a template name before saving.');
  if (!trimmedSubject) throw new Error('Enter a subject before saving.');
  if (!trimmedBody) throw new Error('Enter a body before saving.');

  const saved = await withTimeout(Promise.resolve(saveStoredTeamEmailTemplate(teamId, {
    name: trimmedName,
    subject: trimmedSubject,
    body: trimmedBody
  })), 'Team email template save') as Record<string, any>;
  const normalized = normalizeTeamEmailTemplate(saved);
  if (!normalized) {
    throw new Error('Saved template is missing required fields.');
  }
  return normalized;
}

export async function editTeamChatMessage(teamId: string, messageId: string, text: string, conversationId: string) {
  try {
    return await withTimeout(Promise.resolve(editChatMessage(teamId, messageId, text, { conversationId })), 'Chat message edit');
  } catch (error) {
    if (!isNativeRuntime()) throw error;
    logger.warn('Falling back to REST chat message edit.', { error });
    return nativePatchDocument(getMessageDocumentPath(teamId, messageId, conversationId), {
      text,
      editedAt: new Date()
    });
  }
}

export async function deleteTeamChatMessage(teamId: string, messageId: string, conversationId: string) {
  try {
    return await withTimeout(Promise.resolve(deleteChatMessage(teamId, messageId, { conversationId })), 'Chat message delete');
  } catch (error) {
    if (!isNativeRuntime()) throw error;
    logger.warn('Falling back to REST chat message delete.', { error });
    return nativePatchDocument(getMessageDocumentPath(teamId, messageId, conversationId), {
      deleted: true
    });
  }
}

export async function toggleTeamChatReaction(teamId: string, messageId: string, reactionKey: string, userId: string, conversationId: string) {
  try {
    return await withTimeout(Promise.resolve(toggleChatReaction(teamId, messageId, reactionKey, userId, { conversationId })), 'Chat reaction update');
  } catch (error) {
    if (!isNativeRuntime()) throw error;
    logger.warn('Falling back to REST chat reaction update.', { error });
    const path = getMessageDocumentPath(teamId, messageId, conversationId);
    const message = await nativeGetDocument(path);
    if (!message) throw new Error('Message not found.');
    const reactions = message.reactions && typeof message.reactions === 'object'
      ? message.reactions as Record<string, unknown>
      : {} as Record<string, unknown>;
    const existing = Array.isArray(reactions[reactionKey]) ? reactions[reactionKey].map(String) : [];
    const next = existing.includes(userId)
      ? existing.filter((id: string) => id !== userId)
      : [...existing, userId];
    await nativePatchDocument(path, {
      reactions: {
        ...reactions,
        [reactionKey]: next
      }
    });
    return !existing.includes(userId);
  }
}

export async function markTeamChatRead(userId: string, teamId: string, conversationId = DEFAULT_TEAM_CONVERSATION_ID) {
  try {
    return await withTimeout(Promise.resolve(updateChatLastRead(userId, teamId, conversationId)), 'Chat last read update', 2500);
  } catch (error) {
    if (!isNativeRuntime()) {
      logger.warn('Failed to update chat last-read.', { error });
      return null;
    }
    logger.warn('Falling back to REST chat last-read update.', { error });
    const userPath = `users/${encodeURIComponent(userId)}`;
    const profile = (await nativeGetDocument(userPath) || {}) as Record<string, any>;
    const lastReadAt = new Date();
    const teamChatState = getTeamChatStateEntry(profile, teamId);
    if (isDefaultTeamConversation(conversationId)) {
      await nativePatchDocument(userPath, {
        chatLastRead: {
          ...(profile.chatLastRead || {}),
          [teamId]: lastReadAt
        },
        teamChatState: {
          ...(profile.teamChatState || {}),
          [teamId]: {
            ...teamChatState,
            lastReadAt
          }
        }
      });
      return null;
    }

    await nativePatchDocument(userPath, {
      teamChatState: {
        ...(profile.teamChatState || {}),
        [teamId]: {
          ...teamChatState,
          lastReadByConversation: {
            ...(teamChatState.lastReadByConversation || {}),
            [conversationId]: lastReadAt
          }
        }
      }
    });
    return null;
  }
}

export async function muteTeamChat(uid: string, teamId: string, conversationId = DEFAULT_TEAM_CONVERSATION_ID): Promise<void> {
  try {
    await withTimeout(Promise.resolve(updateChatMuted(uid, teamId, conversationId)), 'Chat mute update', 2500);
  } catch (error) {
    if (!isNativeRuntime()) {
      logger.warn('Failed to mute team chat.', { error });
      throw error;
    }
    logger.warn('Falling back to REST chat mute update.', { error });
    const userPath = `users/${encodeURIComponent(uid)}`;
    const profile = (await nativeGetDocument(userPath) || {}) as Record<string, any>;
    const mutedAt = new Date();
    const teamChatState = getTeamChatStateEntry(profile, teamId);
    const mutedConversations = {
      ...(teamChatState.mutedConversations || {}),
      [conversationId]: mutedAt
    };
    const updates: Record<string, unknown> = {
      teamChatState: {
        ...(profile.teamChatState || {}),
        [teamId]: {
          ...teamChatState,
          mutedConversations
        }
      }
    };
    if (isDefaultTeamConversation(conversationId)) {
      updates.chatMuted = {
        ...(profile.chatMuted || {}),
        [teamId]: mutedAt
      };
    }
    await nativePatchDocument(userPath, updates);
  }
}

export async function unmuteTeamChat(uid: string, teamId: string, conversationId = DEFAULT_TEAM_CONVERSATION_ID): Promise<void> {
  try {
    await withTimeout(Promise.resolve(clearChatMuted(uid, teamId, conversationId)), 'Chat unmute update', 2500);
  } catch (error) {
    if (!isNativeRuntime()) {
      logger.warn('Failed to unmute team chat.', { error });
      throw error;
    }
    logger.warn('Falling back to REST chat unmute update.', { error });
    const userPath = `users/${encodeURIComponent(uid)}`;
    const profile = (await nativeGetDocument(userPath) || {}) as Record<string, any>;
    const teamChatState = getTeamChatStateEntry(profile, teamId);
    const mutedConversations = { ...(teamChatState.mutedConversations || {}) };
    delete mutedConversations[conversationId];
    const updates: Record<string, unknown> = {
      teamChatState: {
        ...(profile.teamChatState || {}),
        [teamId]: {
          ...teamChatState,
          mutedConversations
        }
      }
    };
    if (isDefaultTeamConversation(conversationId)) {
      const chatMuted = { ...(profile.chatMuted || {}) };
      delete chatMuted[teamId];
      updates.chatMuted = chatMuted;
    }
    await nativePatchDocument(userPath, updates);
  }
}

export async function loadChatRecipientOptions(teamId: string): Promise<ChatRecipientOption[]> {
  const players = await withTimeout(Promise.resolve(getPlayers(teamId)), 'Chat recipient load').catch(() => []);
  const parentProfiles = await loadChatRecipientProfiles(players);
  const options: ChatRecipientOption[] = [];
  (Array.isArray(players) ? players : []).forEach((player: any) => {
    if (!player?.id) return;
    const number = player.number !== undefined && player.number !== null && String(player.number).trim() !== ''
      ? `#${player.number}`
      : 'Roster';
    options.push({
      id: getRecipientOptionId('player', player.id),
      name: player.name || `Player ${String(player.id).slice(0, 6)}`,
      detail: number
    });
    (Array.isArray(player.parents) ? player.parents : []).forEach((parent: any) => {
      const parentKey = parent?.userId || compactString(parent?.email).toLowerCase();
      if (!parentKey) return;
      const parentId = getRecipientOptionId(parent.userId ? 'user' : 'email', parentKey);
      const profile = parentProfiles.get(parentId) || {};
      options.push({
        id: parentId,
        name: getChatMemberDisplayName({
          name: parent.name,
          fullName: parent.fullName,
          displayName: parent.displayName,
          profileName: profile.name,
          profileFullName: profile.fullName,
          profileDisplayName: profile.displayName,
          email: parent.email || profile.email
        }, 'Guardian'),
        detail: player.name ? `Guardian for ${player.name}` : 'Guardian',
        email: compactString(parent.email || profile.email).toLowerCase() || undefined
      });
    });
  });

  const byId = new Map<string, ChatRecipientOption>();
  options.forEach((option) => byId.set(option.id, option));
  return [...byId.values()].sort((a, b) => `${a.name} ${a.detail || ''}`.localeCompare(`${b.name} ${b.detail || ''}`));
}

function needsChatRecipientProfile(parent: Record<string, any> = {}) {
  const label = getChatMemberDisplayName({
    name: parent.name,
    fullName: parent.fullName,
    displayName: parent.displayName,
    email: parent.email
  }, '');
  return !label || label === compactString(parent.email);
}

async function loadChatRecipientProfiles(players: any): Promise<Map<string, Record<string, any>>> {
  const parents = (Array.isArray(players) ? players : [])
    .flatMap((player: any) => (Array.isArray(player?.parents) ? player.parents : []));
  const uniqueParents = new Map<string, any>();
  parents.forEach((parent: any) => {
    const key = parent?.userId
      ? getRecipientOptionId('user', parent.userId)
      : parent?.email
        ? getRecipientOptionId('email', String(parent.email).trim().toLowerCase())
        : '';
    if (key && needsChatRecipientProfile(parent) && !uniqueParents.has(key)) {
      uniqueParents.set(key, parent);
    }
  });

  if (!uniqueParents.size) {
    return new Map();
  }

  const parentEntries = [...uniqueParents.entries()];
  const entries: (readonly [string, Record<string, any>])[] = new Array(parentEntries.length);
  let nextParentIndex = 0;

  async function hydrateNextParent() {
    while (nextParentIndex < parentEntries.length) {
      const entryIndex = nextParentIndex;
      nextParentIndex += 1;
      const [recipientId, parent] = parentEntries[entryIndex];
      const userId = compactString(parent?.userId);
      const email = compactString(parent?.email).toLowerCase();
      try {
        if (userId) {
          const profile = await withTimeout(Promise.resolve(getUserProfile(userId)), 'Chat recipient profile load', 2500)
            .catch(async (error) => {
              if (!isNativeRuntime()) throw error;
              return nativeGetDocument(`users/${encodeURIComponent(userId)}`);
            });
          entries[entryIndex] = [recipientId, profile || {}] as const;
          continue;
        }
        if (email) {
          const profile = await withTimeout(Promise.resolve(getUserByEmail(email)), 'Chat recipient profile load', 2500)
            .catch(async (error) => {
              if (!isNativeRuntime()) throw error;
              return nativeGetUserByEmail(email);
            });
          entries[entryIndex] = [recipientId, profile || {}] as const;
          continue;
        }
      } catch (error) {
        logger.warn('Failed to hydrate chat recipient profile.', { error });
      }
      entries[entryIndex] = [recipientId, {}] as const;
    }
  }

  const workerCount = Math.min(CHAT_RECIPIENT_PROFILE_LOOKUP_CONCURRENCY, parentEntries.length);
  await Promise.all(Array.from({ length: workerCount }, () => hydrateNextParent()));

  return new Map(entries);
}

function toDate(value: any) {
  if (!value) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (value?.toDate) return value.toDate();
  if (typeof value?.seconds === 'number') return new Date(value.seconds * 1000);
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function getChatInboxPreview(message: ChatMessage | null) {
  if (!message) return 'No messages yet';
  const sender = message.ai ? 'ALL PLAYS' : message.senderName || message.senderEmail || 'Unknown';
  return `${sender}: ${getMessagePreviewText(message)}`;
}
