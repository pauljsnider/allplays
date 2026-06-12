import { Capacitor } from '@capacitor/core';
import {
  canAccessTeamChat,
  canModerateChat,
  deleteChatMessage,
  deleteUploadedChatAttachments,
  editChatMessage,
  getAggregatedStatsForGames,
  getChatConversations,
  getChatMessages,
  getGameEvents,
  getGames,
  getParentTeams,
  getPlayers,
  getSentTeamEmails,
  getTeamEmailDrafts as getStoredTeamEmailDrafts,
  getTeamEmailTemplates as getStoredTeamEmailTemplates,
  getTeam,
  getUnreadChatCounts,
  getUserByEmail,
  getUserProfile,
  getUserTeamsWithAccess,
  postChatMessage,
  saveTeamEmailDraft as saveStoredTeamEmailDraft,
  saveTeamEmailTemplate as saveStoredTeamEmailTemplate,
  sendTeamEmail,
  subscribeToChatMessages,
  toggleChatReaction,
  updateChatLastRead,
  uploadChatImage,
  upsertChatConversation
} from '../../../../js/db.js';
import { getApp } from '../../../../js/vendor/firebase-app.js';
import { getAI, getGenerativeModel, GoogleAIBackend } from '../../../../js/vendor/firebase-ai.js';
import { resolveImageFirebaseConfig } from '../../../../js/firebase-runtime-config.js';
import { isTeamActive } from '../../../../js/team-visibility.js';
import { firebaseAuth, getNativeAuthIdToken } from './authService';
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
import { sanitizeErrorForLogging } from './nativeRestLogging';
import type { AuthUser } from './types';

const primaryDataTimeoutMs = 5000;
const chatUploadTimeoutMs = 25000;
const imageUploadSessionKey = 'allplays-chat-image-upload-session';
const aiStatsGamesLimit = 10;
const aiGamesContextLimit = 20;
const aiEventsGamesLimit = 3;
const aiEventsPerGameLimit = 25;

export type ChatTeam = {
  id: string;
  name: string;
  sport?: string | null;
  photoUrl?: string | null;
  active?: boolean;
  role: 'Parent' | 'Coach' | 'Admin';
  canModerate: boolean;
  unreadCount: number;
  lastMessage: ChatMessage | null;
  preferredConversationId?: string | null;
};

export type ChatConversation = {
  id: string;
  type: 'team' | 'group' | 'direct';
  name?: string | null;
  participantIds?: string[];
  participantRoles?: string[];
  mutedBy?: string[];
  isDefault?: boolean;
  isLegacy?: boolean;
  updatedAt?: unknown;
  lastMessageAt?: unknown;
};

export type ChatAttachment = {
  type: 'image' | 'video';
  url: string | null;
  path?: string | null;
  thumbnailUrl?: string | null;
  name?: string | null;
  mimeType?: string | null;
  size?: number | null;
  uploadedAt?: unknown;
};

export type ChatMessage = {
  id: string;
  text?: string | null;
  senderId?: string | null;
  senderName?: string | null;
  senderEmail?: string | null;
  senderPhotoUrl?: string | null;
  attachments?: ChatAttachment[];
  imageUrl?: string | null;
  imagePath?: string | null;
  imageName?: string | null;
  imageType?: string | null;
  imageSize?: number | null;
  createdAt?: unknown;
  editedAt?: unknown;
  deleted?: boolean;
  ai?: boolean;
  aiName?: string | null;
  aiQuestion?: string | null;
  aiMeta?: Record<string, unknown> | null;
  reactions?: Record<string, string[]>;
  targetType?: ChatTargetType;
  recipientIds?: string[];
  targetRole?: string | null;
  conversationId?: string | null;
  _doc?: unknown;
};

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

export type ChatInboxLoadOptions = {
  includeLastMessages?: boolean;
};

export type ChatSubscribeResult = {
  unsubscribe: () => void;
};

type FirestoreDocument = Record<string, any> & { id: string };

type ImageUploadSession = {
  apiKey: string;
  idToken: string;
  refreshToken: string;
  expirationTime: number;
};

let aiModelCache: any = null;

function isNativeRuntime() {
  return Capacitor.isNativePlatform() || window.location.protocol === 'capacitor:';
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
  const response = await withTimeout(fetch(`${getFirestoreBaseUrl()}${path}`, {
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

function decodeFirestoreValue(value: any): any {
  if (!value || typeof value !== 'object') return null;
  if ('stringValue' in value) return value.stringValue;
  if ('booleanValue' in value) return value.booleanValue;
  if ('integerValue' in value) return Number(value.integerValue || 0);
  if ('doubleValue' in value) return Number(value.doubleValue || 0);
  if ('timestampValue' in value) return new Date(value.timestampValue);
  if ('nullValue' in value) return null;
  if ('arrayValue' in value) return (value.arrayValue?.values || []).map((entry: any) => decodeFirestoreValue(entry));
  if ('mapValue' in value) return decodeFirestoreFields(value.mapValue?.fields || {});
  return null;
}

function decodeFirestoreFields(fields: Record<string, any> = {}) {
  return Object.keys(fields).reduce<Record<string, any>>((acc, key) => {
    acc[key] = decodeFirestoreValue(fields[key]);
    return acc;
  }, {});
}

function decodeFirestoreDocument(document: any): FirestoreDocument | null {
  if (!document?.name) return null;
  return {
    id: String(document.name).split('/').pop() || '',
    ...decodeFirestoreFields(document.fields || {})
  };
}

async function nativeGetDocument(path: string) {
  try {
    return decodeFirestoreDocument(await nativeFirestoreRequest(`/${path}`));
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
    .map((document: any) => decodeFirestoreDocument(document))
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

async function nativeCreateDocument(path: string, data: Record<string, unknown>) {
  const fields = Object.keys(data).reduce<Record<string, Record<string, unknown>>>((acc, key) => {
    acc[key] = encodeFirestoreValue(data[key]);
    return acc;
  }, {});
  return decodeFirestoreDocument(await nativeFirestoreRequest(`/${path}`, {
    method: 'POST',
    body: JSON.stringify({ fields })
  }));
}

async function nativeRunQuery(structuredQuery: Record<string, unknown>) {
  const payload = await nativeFirestoreRequest(':runQuery', {
    method: 'POST',
    body: JSON.stringify({ structuredQuery })
  });
  return (Array.isArray(payload) ? payload : [])
    .map((entry) => decodeFirestoreDocument(entry.document))
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
    isAdmin: profile.isAdmin === true || user.isAdmin === true || user.roles?.includes('platformAdmin')
  };
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

function getNewestChatMessage(messages: Array<ChatMessage | null>) {
  return messages.reduce<ChatMessage | null>((newest, message) => (
    getMessageTime(message) > getMessageTime(newest) ? message : newest
  ), null);
}

function getConversationActivityTime(conversation: ChatConversation | null | undefined) {
  const conversationTime = toDate(conversation?.lastMessageAt || conversation?.updatedAt);
  return conversationTime ? conversationTime.getTime() : null;
}

async function getLatestConversationMessage(teamId: string, conversationId: string): Promise<ChatMessage | null> {
  try {
    const [message] = await withTimeout(Promise.resolve(getChatMessages(teamId, { limit: 1, conversationId })), `latest chat ${teamId}/${conversationId}`, 2500);
    return message || null;
  } catch (error) {
    if (!isNativeRuntime()) return null;
    const path = isDefaultTeamConversation(conversationId)
      ? `teams/${encodeURIComponent(teamId)}/chatMessages`
      : `teams/${encodeURIComponent(teamId)}/chatConversations/${encodeURIComponent(conversationId)}/chatMessages`;
    const [message] = await nativeListCollection(path, {
      orderBy: 'createdAt desc',
      pageSize: 1
    }).catch(() => []);
    return message as ChatMessage || null;
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
    conversations = Array.isArray(loadedConversations) && loadedConversations.length
      ? loadedConversations
      : [buildDefaultTeamConversation(team)];
  } catch (error) {
    if (!isNativeRuntime()) {
      conversations = [buildDefaultTeamConversation(team)];
    } else {
      console.warn('[chat-service] Latest inbox preview limited to team chat:', sanitizeErrorForLogging(error));
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
  for (const { conversation } of rankedConversations) {
    if (!conversation?.id || attemptedConversationIds.has(conversation.id)) continue;
    const fallbackMessage = await getLatestConversationMessage(teamId, conversation.id);
    if (fallbackMessage) {
      return {
        message: fallbackMessage,
        conversationId: conversation.id
      };
    }
  }

  return {
    message: null,
    conversationId: null
  };
}

export async function loadChatInbox(user: AuthUser | null, options: ChatInboxLoadOptions = {}): Promise<ChatInboxLoadResult> {
  if (!user?.uid) return { teams: [] };
  const includeLastMessages = options.includeLastMessages !== false;

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
    console.warn('[chat-service] Falling back to REST team load:', sanitizeErrorForLogging(error));
    teams = await nativeLoadUserTeams(user, profile);
  }

  const userWithProfile = mapUserWithProfile(user, profile);
  const accessibleTeams = teams.filter((team) => isTeamActive(team) && canAccessTeamChat(userWithProfile, { ...team, id: team.id }));
  const unreadCounts = await withTimeout(
    Promise.resolve(getUnreadChatCounts(user.uid, accessibleTeams.map((team) => team.id))),
    'Chat unread counts',
    3000
  ).catch(() => ({} as Record<string, number>));

  const previews = await Promise.all(accessibleTeams.map(async (team) => {
    const canModerate = canModerateChat(userWithProfile, { ...team, id: team.id });
    return {
      team,
      canModerate,
      preview: includeLastMessages
        ? await getLatestMessagePreview(team.id, userWithProfile, team, canModerate)
        : { message: null, conversationId: null }
    };
  }));

  return {
    teams: previews.map(({ team, canModerate, preview }) => ({
      id: team.id,
      name: team.name || 'Team',
      sport: team.sport || null,
      photoUrl: team.photoUrl || null,
      active: team.active,
      role: getTeamRole(user, team, profile),
      canModerate,
      unreadCount: Number(unreadCounts[team.id] || 0),
      lastMessage: preview.message,
      preferredConversationId: preview.conversationId && !isDefaultTeamConversation(preview.conversationId)
        ? preview.conversationId
        : null
    })).sort((a, b) => {
      const activityDiff = getMessageTime(b.lastMessage) - getMessageTime(a.lastMessage);
      if (activityDiff) return activityDiff;
      const unreadDiff = Number(b.unreadCount > 0) - Number(a.unreadCount > 0);
      if (unreadDiff) return unreadDiff;
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
    return await withTimeout(Promise.resolve(getChatConversations(teamId, user, { team, canModerate })), 'Chat conversations load') as ChatConversation[];
  } catch (error) {
    console.warn('[chat-service] Falling back to default chat conversation:', sanitizeErrorForLogging(error));
    return [buildDefaultTeamConversation(team) as ChatConversation];
  }
}

export async function ensureStaffChatConversation(teamId: string, user: AuthUser, conversations: ChatConversation[] = []): Promise<ChatConversation> {
  const existing = conversations.find((conversation) => isStaffConversation(conversation));
  if (existing) return existing;

  return await withTimeout(Promise.resolve(upsertChatConversation(teamId, {
    type: 'group',
    participantIds: [user.uid],
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
        onMessages(messages as ChatMessage[], messages[messages.length - 1]?._doc || null);
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
      if (!cancelled) onMessages(messages, oldestDoc);
    });
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
    return await withTimeout(Promise.resolve(getChatMessages(teamId, {
      limit: 50,
      startAfterDoc,
      conversationId
    })), 'Older chat messages load') as ChatMessage[];
  } catch (error) {
    if (!isNativeRuntime()) throw error;
    console.warn('[chat-service] Older chat history is limited in native REST fallback:', sanitizeErrorForLogging(error));
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
    console.warn('[chat-service] Unable to persist chat image upload session:', sanitizeErrorForLogging(error));
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
      console.warn('[chat-service] Refreshing chat media upload auth failed:', sanitizeErrorForLogging(error));
    }
  }
  return createImageUploadSession(apiKey);
}

async function nativeUploadChatMedia(teamId: string, file: File): Promise<ChatAttachment> {
  const imageConfig = resolveImageFirebaseConfig();
  const bucket = imageConfig.storageBucket;
  if (!imageConfig.apiKey || !bucket) {
    throw new Error('Image upload Firebase config is missing.');
  }
  const session = await getImageUploadSession(imageConfig.apiKey);
  const safeName = String(file.name || 'media').replace(/[^\w.-]+/g, '_');
  const isVideo = String(file.type || '').toLowerCase().startsWith('video/');
  const mediaFolder = isVideo ? 'team-videos' : 'team-photos';
  const path = `${mediaFolder}/${Date.now()}_chat_${teamId}_${safeName}`;
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

export async function uploadTeamChatAttachment(teamId: string, file: File): Promise<ChatAttachment> {
  if (!file.type.startsWith('image/') && !file.type.startsWith('video/')) {
    throw new Error('Choose image or video files only.');
  }
  if (file.size > MAX_CHAT_MEDIA_SIZE) {
    throw new Error('Photos and videos must be 5MB or smaller each.');
  }
  if (isNativeRuntime()) {
    return nativeUploadChatMedia(teamId, file);
  }
  try {
    return await withTimeout(Promise.resolve(uploadChatImage(teamId, file)), 'Chat media upload', chatUploadTimeoutMs) as ChatAttachment;
  } catch (error) {
    throw error;
  }
}

async function nativePostChatMessage(teamId: string, input: {
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
  });
}

export async function sendTeamChatMessage({
  teamId,
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
  aiMeta
}: {
  teamId: string;
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
}) {
  if (selectedRecipientTarget === 'individuals'
    && (selectedRecipientIds || []).map((id) => String(id || '').trim()).filter(Boolean).length === 0) {
    throw new Error('Choose at least one selected member before sending.');
  }

  const uploadedAttachments: ChatAttachment[] = [];
  try {
    for (const file of files) {
      onProgress?.('uploading');
      uploadedAttachments.push(await uploadTeamChatAttachment(teamId, file));
    }
    onProgress?.('posting');

    const attachments = [...sharedAttachments, ...uploadedAttachments];

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
        ? [user.uid]
        : Array.from(new Set([user.uid, ...targetMetadata.recipientIds]));
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

    const payload = {
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

    return {
      conversationId,
      createdConversation,
      wantsAi: hasAllPlaysMention(text)
    };
  } catch (error) {
    if (uploadedAttachments.length > 0) {
      try {
        await deleteUploadedChatAttachments(uploadedAttachments);
      } catch (cleanupError) {
        console.error('Failed to clean up uploaded chat attachments:', cleanupError);
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
    console.warn('[chat-service] Falling back to REST chat message edit:', sanitizeErrorForLogging(error));
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
    console.warn('[chat-service] Falling back to REST chat message delete:', sanitizeErrorForLogging(error));
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
    console.warn('[chat-service] Falling back to REST chat reaction update:', sanitizeErrorForLogging(error));
    const path = getMessageDocumentPath(teamId, messageId, conversationId);
    const message = await nativeGetDocument(path);
    if (!message) throw new Error('Message not found.');
    const reactions = message.reactions && typeof message.reactions === 'object' ? message.reactions : {};
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

export async function markTeamChatRead(userId: string, teamId: string) {
  try {
    return await withTimeout(Promise.resolve(updateChatLastRead(userId, teamId)), 'Chat last read update', 2500);
  } catch (error) {
    if (!isNativeRuntime()) {
      console.warn('[chat-service] Failed to update chat last-read:', sanitizeErrorForLogging(error));
      return null;
    }
    console.warn('[chat-service] Falling back to REST chat last-read update:', sanitizeErrorForLogging(error));
    const userPath = `users/${encodeURIComponent(userId)}`;
    const profile = (await nativeGetDocument(userPath) || {}) as Record<string, any>;
    await nativePatchDocument(userPath, {
      chatLastRead: {
        ...(profile.chatLastRead || {}),
        [teamId]: new Date()
      }
    });
    return null;
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
    if (key && !uniqueParents.has(key)) {
      uniqueParents.set(key, parent);
    }
  });

  const entries = await Promise.all([...uniqueParents.entries()].map(async ([recipientId, parent]) => {
    const userId = compactString(parent?.userId);
    const email = compactString(parent?.email).toLowerCase();
    try {
      if (userId) {
        const profile = await withTimeout(Promise.resolve(getUserProfile(userId)), 'Chat recipient profile load', 2500)
          .catch(async (error) => {
            if (!isNativeRuntime()) throw error;
            return nativeGetDocument(`users/${encodeURIComponent(userId)}`);
          });
        return [recipientId, profile || {}] as const;
      }
      if (email) {
        const profile = await withTimeout(Promise.resolve(getUserByEmail(email)), 'Chat recipient profile load', 2500)
          .catch(async (error) => {
            if (!isNativeRuntime()) throw error;
            return nativeGetUserByEmail(email);
          });
        return [recipientId, profile || {}] as const;
      }
    } catch (error) {
      console.warn('[chat-service] Failed to hydrate chat recipient profile:', sanitizeErrorForLogging(error));
    }
    return [recipientId, {}] as const;
  }));

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

function truncateText(text: unknown, maxLen: number) {
  const clean = String(text || '').trim();
  if (clean.length <= maxLen) return clean || null;
  return `${clean.slice(0, maxLen).trim()}...`;
}

function isCompletedGame(game: any) {
  const status = String(game?.status || '').toLowerCase();
  if (status === 'final' || status === 'completed') return true;
  const homeScore = Number(game?.homeScore || 0);
  const awayScore = Number(game?.awayScore || 0);
  return homeScore > 0 || awayScore > 0;
}

function shouldFetchStats(question: string) {
  return /(stats|scorer|score|points|rebounds|assists|goals|saves|leader|leading|top|better|improv|improve|development|progress|player\s*#?\s*\d+)/i.test(question);
}

function shouldFetchEvents(question: string) {
  return /(play\s*by\s*play|play-by-play|timeline|game\s*log|event\s*log|events|possessions|highlights|what happened|sequence)/i.test(question);
}

function serializeGame(game: any) {
  const date = toDate(game?.date);
  return {
    id: game?.id || null,
    date: date ? date.toISOString() : null,
    opponent: game?.opponent || null,
    location: game?.location || null,
    status: game?.status || null,
    homeScore: game?.homeScore ?? null,
    awayScore: game?.awayScore ?? null,
    summary: truncateText(game?.summary, 700)
  };
}

function findMatchedPlayer(question: string, players: any[]) {
  const match = question.match(/player\s*#?\s*(\d{1,3})/i);
  if (!match) return null;
  const target = String(Number(match[1]));
  return players.find((player) => String(player.number ?? '') === target) || null;
}

async function buildAiContext(teamId: string, team: Record<string, any>, question: string, { fetchStats, fetchEvents }: { fetchStats: boolean; fetchEvents: boolean }) {
  const [players, games] = await Promise.all([
    getPlayers(teamId, { includeInactive: true }),
    getGames(teamId)
  ]);
  const playersById = new Map((players || []).map((player: any) => [player.id, player]));
  const now = new Date();
  const cutoff = new Date(now.getTime() - 3 * 60 * 60 * 1000);
  const gamesWithDates = (games || [])
    .map((game: any) => ({ ...game, _date: toDate(game.date) }))
    .filter((game: any) => game._date);

  const upcomingGames = gamesWithDates
    .filter((game: any) => game._date >= cutoff)
    .sort((a: any, b: any) => a._date.getTime() - b._date.getTime())
    .slice(0, 10)
    .map(serializeGame);

  const recentGames = gamesWithDates
    .filter((game: any) => game._date < cutoff)
    .sort((a: any, b: any) => b._date.getTime() - a._date.getTime())
    .slice(0, aiGamesContextLimit)
    .map(serializeGame);

  let statsSummary = null;
  if (fetchStats) {
    const completedGames = gamesWithDates
      .filter(isCompletedGame)
      .sort((a: any, b: any) => b._date.getTime() - a._date.getTime())
      .slice(0, aiStatsGamesLimit);
    const totals = await getAggregatedStatsForGames(teamId, completedGames.map((game: any) => game.id));
    statsSummary = {
      gamesUsed: completedGames.map(serializeGame),
      totalsByPlayer: Object.entries(totals || {}).map(([playerId, stats]) => ({
        id: playerId,
        name: (playersById.get(playerId) as any)?.name || 'Unknown',
        number: (playersById.get(playerId) as any)?.number || null,
        stats
      }))
    };
  }

  let eventsSummary = null;
  if (fetchEvents) {
    const recentCompleted = gamesWithDates
      .filter(isCompletedGame)
      .sort((a: any, b: any) => b._date.getTime() - a._date.getTime())
      .slice(0, aiEventsGamesLimit);
    const eventsByGame = await Promise.all(recentCompleted.map(async (game: any) => {
      const events = await getGameEvents(teamId, game.id, { limit: aiEventsPerGameLimit });
      return {
        game: serializeGame(game),
        events: (events || []).slice().reverse().map((event: any) => {
          const player = event.playerId ? playersById.get(event.playerId) as any : null;
          return {
            id: event.id,
            timestamp: event.timestamp ?? null,
            period: event.period ?? null,
            gameTime: event.gameTime ?? null,
            text: event.text || null,
            type: event.type || null,
            playerId: event.playerId || null,
            playerName: player?.name || null,
            playerNumber: player?.number ?? null,
            statKey: event.statKey || null,
            value: event.value ?? null,
            isOpponent: event.isOpponent === true
          };
        })
      };
    }));
    eventsSummary = {
      gamesUsed: recentCompleted.map(serializeGame),
      eventsByGame
    };
  }

  const matchedPlayer = findMatchedPlayer(question, players || []);
  return {
    team: {
      id: teamId,
      name: team?.name || null,
      sport: team?.sport || null
    },
    players: (players || []).map((player: any) => ({
      id: player.id,
      name: player.name || null,
      number: player.number || null
    })),
    matchedPlayer: matchedPlayer ? {
      id: matchedPlayer.id,
      name: matchedPlayer.name || null,
      number: matchedPlayer.number ?? null
    } : null,
    gamesUpcoming: upcomingGames,
    gamesRecent: recentGames,
    stats: statsSummary,
    playByPlay: eventsSummary
  };
}

async function getAiModel() {
  if (aiModelCache) return aiModelCache;
  const firebaseApp = getApp();
  const ai = getAI(firebaseApp, { backend: new GoogleAIBackend() });
  aiModelCache = getGenerativeModel(ai, { model: 'gemini-2.5-flash' });
  return aiModelCache;
}

export async function sendAllPlaysChatAnswer({
  teamId,
  team,
  user,
  question,
  selectedConversation,
  selectedConversationId,
  selectedRecipientTarget,
  selectedRecipientIds
}: {
  teamId: string;
  team: Record<string, any>;
  user: AuthUser;
  question: string;
  selectedConversation?: ChatConversation | null;
  selectedConversationId: string;
  selectedRecipientTarget: ChatTargetType;
  selectedRecipientIds: string[];
}) {
  const fetchStats = shouldFetchStats(question);
  const fetchEvents = shouldFetchEvents(question);
  const context = await buildAiContext(teamId, team, question, { fetchStats, fetchEvents });
  const prompt = `You are ALL PLAYS, a sports management expert for youth teams.\n` +
    `You are speaking to coaches, admins, and parents.\n` +
    `Use ONLY the provided DATA to answer. If the data is insufficient, say so.\n` +
    `Respond in a clear, readable format with short paragraphs or bullet points.\n` +
    `Limit to at most 6 bullets total. Use *bold* only for short labels.\n\n` +
    `QUESTION:\n${question}\n\nDATA (JSON):\n${JSON.stringify(context)}\n`;
  const model = await getAiModel();
  const result = await model.generateContent(prompt);
  const responseText = result.response.text();
  const targetMetadata = buildChatAudienceMetadata({
    selectedConversation,
    selectedConversationId,
    selectedRecipientTarget,
    selectedRecipientIds
  });
  await postChatMessage(teamId, {
    text: responseText,
    senderId: user.uid,
    senderName: null,
    senderEmail: null,
    senderPhotoUrl: null,
    ai: true,
    aiName: 'ALL PLAYS',
    aiQuestion: question,
    conversationId: selectedConversationId,
    ...targetMetadata,
    aiMeta: {
      statsGameLimit: aiStatsGamesLimit,
      gamesContextLimit: aiGamesContextLimit,
      statsRequested: fetchStats,
      eventsGameLimit: aiEventsGamesLimit,
      eventsPerGameLimit: aiEventsPerGameLimit,
      eventsRequested: fetchEvents,
      statsRequestSource: 'heuristic'
    }
  });
}

export function getChatInboxPreview(message: ChatMessage | null) {
  if (!message) return 'No messages yet';
  const sender = message.ai ? 'ALL PLAYS' : message.senderName || message.senderEmail || 'Unknown';
  return `${sender}: ${getMessagePreviewText(message)}`;
}
