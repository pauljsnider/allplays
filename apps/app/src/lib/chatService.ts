import { isNativeRuntime } from './nativeRuntime';
import { createSecureUploadToken } from './secureUploadToken';
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
  repairLegacyDirectConversation,
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
import { firebaseAuth, getNativeAuthIdToken, getNativeAuthUserId } from './authService';
import { loadCachedAppData } from './appDataCache';
import { createLogger } from './logger';
import { getPrimaryAppCheckHeaders } from './adapters/legacyFirebaseAppCheck';
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
import { canMessageAcceptedFriend, sendAuthorizedDirectMessage } from './friendMessageService';
import { callNativeFirebaseFunction } from './nativeCallable';
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
  FirestoreDocument as NativeFirestoreDocument,
  NativeChatPageCursor
} from './firestore/types';
import { isNativeChatPageCursor } from './firestore/types';
import type { AuthUser } from './types';

const primaryDataTimeoutMs = 5000;
const chatUploadTimeoutMs = 25000;
const chatAttachmentUploadConcurrency = 3;
const chatPreviewCacheTtlMs = 20 * 1000;
const deferredInboxPreviewConcurrency = 3;
const chatUnreadCountTimeoutMs = 3000;
const nativeChatUnreadCountConcurrency = 6;
const nativeChatUnreadConversationLimit = 26;
const nativeChatUnreadAggregationRequestLimit = 240;
const nativeChatUnreadJobLimit = nativeChatUnreadAggregationRequestLimit / 2;
const nativeChatPageOrder = 'createdAt desc' as const;
const nativeChatPageSize = 50 as const;
export const CHAT_RECIPIENT_PROFILE_LOOKUP_CONCURRENCY = 8;
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

export const TEAM_EMAIL_SAVED_PAGE_SIZE = 25;

export type TeamEmailSavedCursor = {
  updatedAt: unknown;
  id: string;
};

export type TeamEmailSavedPage<T> = {
  items: T[];
  nextCursor: TeamEmailSavedCursor | null;
};

export type ChatInboxLoadResult = {
  teams: ChatTeam[];
  isPartial?: boolean;
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
  onPreviewError?: (teamId: string) => void;
  nativeProfileLoader?: () => Promise<Record<string, any>>;
  nativeManagedTeamsLoader?: () => Promise<{ teams: Record<string, any>[]; isPartial: boolean }>;
};

export type ChatConversationLoadOptions = {
  activeConversationId?: string | null;
};

export type ChatSubscribeResult = {
  unsubscribe: () => void;
};

type FirestoreDocument = FirestoreDecodedDocument;

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

function normalizeChatMessageRevisionValue(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(normalizeChatMessageRevisionValue);
  if (!value || typeof value !== 'object') return value;

  return Object.keys(value as Record<string, unknown>)
    .filter((key) => key !== '_doc' && (value as Record<string, unknown>)[key] !== undefined)
    .sort()
    .reduce<Record<string, unknown>>((normalized, key) => {
      normalized[key] = normalizeChatMessageRevisionValue((value as Record<string, unknown>)[key]);
      return normalized;
    }, {});
}

function getChatMessageListRevision(messages: ChatMessage[]) {
  return JSON.stringify(normalizeChatMessageRevisionValue(messages));
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

async function getNativeHeaders(requestUrl: string, forceRefresh = false) {
  // Firebase Authentication refreshes an expired token even when forceRefresh
  // is false. Forcing a refresh for every parallel Home read crosses the native
  // bridge twice per request and can exhaust the three-second unread-count
  // budget before Firestore is contacted.
  const token = await getNativeAuthIdToken(forceRefresh);
  if (!token) {
    throw new Error('Native auth token is unavailable.');
  }

  return getPrimaryAppCheckHeaders({
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json'
  }, requestUrl);
}

async function nativeFirestoreRequest(path: string, init: RequestInit = {}) {
  const url = `${getFirestoreBaseUrl()}${path}`;
  const runRequest = async () => {
    const method = String(init.method || 'GET').toUpperCase();
    const isReadOnly = method === 'GET' || path.includes(':runQuery') || path.includes(':runAggregationQuery');
    const execute = async (forceRefresh: boolean) => withTimeout(fetch(url, {
      ...init,
      headers: {
        ...(await getNativeHeaders(url, forceRefresh)),
        ...(init.headers || {})
      }
    }), 'Firestore REST request');
    let response = await execute(!isReadOnly);
    if (response.status === 401) {
      response = await execute(true);
    }
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
  return (await nativeListCollectionPage(path, params)).documents;
}

async function nativeListCollectionPage(path: string, params: Record<string, string | number> = {}) {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => query.set(key, String(value)));
  const suffix = query.toString() ? `?${query.toString()}` : '';
  const payload = await nativeFirestoreRequest(`/${path}${suffix}`) as {
    documents?: NativeFirestoreDocument[];
    nextPageToken?: unknown;
  };
  if (payload.nextPageToken != null && typeof payload.nextPageToken !== 'string') {
    throw new Error('Native Firestore pagination returned an invalid nextPageToken.');
  }
  const nextPageToken = typeof payload.nextPageToken === 'string' && payload.nextPageToken.trim()
    ? payload.nextPageToken
    : null;
  return {
    documents: (payload.documents || [])
      .map((document: NativeFirestoreDocument) => mapFirestoreDocument(document))
      .filter(Boolean) as FirestoreDocument[],
    nextPageToken
  };
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

function getNativeDocumentResourceName(path: string) {
  const decodedPath = path
    .split('/')
    .map((segment) => decodeURIComponent(segment))
    .join('/');
  return `projects/${getProjectId()}/databases/(default)/documents/${decodedPath}`;
}

async function nativeCommitDocument(
  path: string,
  data: Record<string, unknown>,
  { serverTimestampFields = [] }: { serverTimestampFields?: string[] } = {}
) {
  const transformFields = new Set(serverTimestampFields);
  const storedFieldNames = Object.keys(data).filter((key) => !transformFields.has(key));
  const fields = storedFieldNames.reduce<Record<string, Record<string, unknown>>>((acc, key) => {
    acc[key] = encodeFirestoreValue(data[key]);
    return acc;
  }, {});
  await nativeFirestoreRequest(':commit', {
    method: 'POST',
    body: JSON.stringify({
      writes: [{
        update: {
          name: getNativeDocumentResourceName(path),
          fields
        },
        updateMask: {
          fieldPaths: storedFieldNames
        },
        updateTransforms: serverTimestampFields.map((fieldPath) => ({
          fieldPath,
          setToServerValue: 'REQUEST_TIME'
        }))
      }]
    })
  });
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

function buildNativeUnreadWhere(
  conversationId: string,
  userId: string,
  lastReadAt: unknown,
  ownMessagesOnly: boolean
) {
  const filters: Record<string, unknown>[] = [];
  if (isDefaultTeamConversation(conversationId)) {
    filters.push(
      {
        fieldFilter: {
          field: { fieldPath: 'targetType' },
          op: 'EQUAL',
          value: encodeFirestoreValue('full_team')
        }
      },
      {
        fieldFilter: {
          field: { fieldPath: 'recipientIds' },
          op: 'EQUAL',
          value: encodeFirestoreValue([])
        }
      }
    );
  }
  const lastReadDate = toDate(lastReadAt);
  if (lastReadDate) {
    filters.push({
      fieldFilter: {
        field: { fieldPath: 'createdAt' },
        op: 'GREATER_THAN',
        value: encodeFirestoreValue(lastReadDate)
      }
    });
  }
  if (ownMessagesOnly) {
    filters.push({
      fieldFilter: {
        field: { fieldPath: 'senderId' },
        op: 'EQUAL',
        value: encodeFirestoreValue(userId)
      }
    });
  }
  if (filters.length === 0) return undefined;
  if (filters.length === 1) return filters[0];
  return { compositeFilter: { op: 'AND', filters } };
}

async function nativeAggregateUnreadMessageCount({
  teamId,
  conversationId,
  userId,
  lastReadAt,
  ownMessagesOnly,
  signal
}: {
  teamId: string;
  conversationId: string;
  userId: string;
  lastReadAt: unknown;
  ownMessagesOnly: boolean;
  signal: AbortSignal;
}) {
  const parentPath = isDefaultTeamConversation(conversationId)
    ? `teams/${encodeURIComponent(teamId)}`
    : `teams/${encodeURIComponent(teamId)}/chatConversations/${encodeURIComponent(conversationId)}`;
  const where = buildNativeUnreadWhere(conversationId, userId, lastReadAt, ownMessagesOnly);
  const structuredQuery: Record<string, unknown> = {
    from: [{ collectionId: 'chatMessages' }],
    ...(where ? { where } : {})
  };
  const payload = await nativeFirestoreRequest(`/${parentPath}:runAggregationQuery`, {
    method: 'POST',
    signal,
    body: JSON.stringify({
      structuredAggregationQuery: {
        structuredQuery,
        aggregations: [{ alias: 'messageCount', count: {} }]
      }
    })
  });
  const rows = Array.isArray(payload) ? payload : [payload];
  const countValue = rows.find((row) => row?.result?.aggregateFields?.messageCount)
    ?.result?.aggregateFields?.messageCount;
  const rawCount = countValue?.integerValue ?? countValue?.doubleValue;
  const count = Number(rawCount);
  if (rawCount === undefined || !Number.isFinite(count) || count < 0) {
    throw new Error('Native chat unread count response was invalid.');
  }
  return count;
}

async function nativeLoadUnreadChatCounts(
  userId: string,
  teamIds: string[],
  profile: Record<string, any>,
  conversationIdsByTeam: Record<string, string[]>,
  timeoutMs = chatUnreadCountTimeoutMs
) {
  const uniqueTeamIds = Array.from(new Set(teamIds));
  const counts = Object.fromEntries(uniqueTeamIds.map((teamId) => [teamId, 0])) as Record<string, number>;
  let conversationOverflow = false;
  let timedOut = false;
  const abortController = new AbortController();
  const timeoutId = window.setTimeout(() => {
    timedOut = true;
    abortController.abort();
  }, timeoutMs);
  const jobs = uniqueTeamIds.flatMap((teamId) => {
    const storedConversationIds = Array.isArray(conversationIdsByTeam[teamId])
      ? conversationIdsByTeam[teamId]
      : [];
    const allConversationIds = Array.from(new Set([DEFAULT_TEAM_CONVERSATION_ID, ...storedConversationIds]));
    if (allConversationIds.length > nativeChatUnreadConversationLimit) conversationOverflow = true;
    const conversationIds = allConversationIds.slice(0, nativeChatUnreadConversationLimit);
    return conversationIds.map((conversationId) => async () => {
      const teamState = getTeamChatStateEntry(profile, teamId);
      const lastReadAt = isDefaultTeamConversation(conversationId)
        ? teamState.lastReadAt || profile?.chatLastRead?.[teamId] || null
        : teamState.lastReadByConversation?.[conversationId] || null;
      const [totalUnread, ownUnread] = await Promise.all([
        nativeAggregateUnreadMessageCount({
          teamId,
          conversationId,
          userId,
          lastReadAt,
          ownMessagesOnly: false,
          signal: abortController.signal
        }),
        nativeAggregateUnreadMessageCount({
          teamId,
          conversationId,
          userId,
          lastReadAt,
          ownMessagesOnly: true,
          signal: abortController.signal
        })
      ]);
      return { teamId, count: Math.max(0, totalUnread - ownUnread) };
    });
  });
  const workloadOverflow = jobs.length > nativeChatUnreadJobLimit;
  const boundedJobs = jobs.slice(0, nativeChatUnreadJobLimit);
  const results = new Array<PromiseSettledResult<{ teamId: string; count: number }>>(boundedJobs.length);
  let nextJobIndex = 0;
  try {
    await Promise.all(Array.from(
      { length: Math.min(nativeChatUnreadCountConcurrency, boundedJobs.length) },
      async () => {
        while (nextJobIndex < boundedJobs.length && !abortController.signal.aborted) {
          const jobIndex = nextJobIndex;
          nextJobIndex += 1;
          try {
            results[jobIndex] = { status: 'fulfilled', value: await boundedJobs[jobIndex]() };
          } catch (error) {
            results[jobIndex] = { status: 'rejected', reason: error };
          }
        }
      }
    ));
  } finally {
    window.clearTimeout(timeoutId);
  }
  results.forEach((result) => {
    if (result.status === 'fulfilled') {
      counts[result.value.teamId] = Number(counts[result.value.teamId] || 0) + result.value.count;
    } else {
      logger.warn('Native chat unread count failed.', { error: result.reason });
    }
  });
  return {
    counts,
    isPartial: conversationOverflow
      || workloadOverflow
      || timedOut
      || results.filter(Boolean).length < boundedJobs.length
      || results.some((result) => result.status === 'rejected')
  };
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

function createNativeChatPageCursor(collectionPath: string, nextPageToken: string | null): NativeChatPageCursor {
  return {
    kind: 'native-chat-rest',
    collectionPath,
    orderBy: nativeChatPageOrder,
    pageSize: nativeChatPageSize,
    nextPageToken
  };
}

function validateNativeChatPageCursor(cursor: NativeChatPageCursor, expectedCollectionPath: string) {
  if (
    cursor.collectionPath !== expectedCollectionPath
    || cursor.orderBy !== nativeChatPageOrder
    || cursor.pageSize !== nativeChatPageSize
  ) {
    throw new Error('Native chat pagination cursor does not match the active conversation.');
  }
  if (cursor.nextPageToken !== null && typeof cursor.nextPageToken !== 'string') {
    throw new Error('Native chat pagination cursor has an invalid nextPageToken.');
  }
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

function normalizeDirectUserId(value: unknown) {
  const normalized = compactString(value);
  const userId = normalized.toLowerCase().startsWith('user:') ? normalized.slice(5).trim() : normalized;
  return userId && !userId.includes(':') && /^[A-Za-z0-9_-]{1,160}$/.test(userId) ? userId : '';
}

function getDirectUserIds(senderId: string, participantIds: string[]) {
  const directUserIds = Array.from(new Set((participantIds || []).map(normalizeDirectUserId).filter(Boolean))).sort();
  const normalizedSenderId = normalizeDirectUserId(senderId);
  return directUserIds.length === 2 && directUserIds.includes(normalizedSenderId) ? directUserIds : [];
}

async function resolveDirectConversationMetadata({
  teamId,
  user,
  participantIds,
  canModerate,
  existingConversation
}: {
  teamId: string;
  user: AuthUser;
  participantIds: string[];
  canModerate: boolean;
  existingConversation?: ChatConversation | null;
}) {
  const directUserIds = getDirectUserIds(user.uid, participantIds);
  if (directUserIds.length !== 2) {
    throw new Error('Direct messages require exactly two current team members.');
  }
  if (existingConversation?.directAccess === 'team_admin'
    && existingConversation.directUserIds?.length === 2) {
    return {
      directAccess: 'team_admin' as const,
      directUserIds,
      friendshipId: null,
      initiatedBy: existingConversation.initiatedBy || null
    };
  }
  if (canModerate) {
    return {
      directAccess: 'team_admin' as const,
      directUserIds,
      friendshipId: null,
      initiatedBy: user.uid
    };
  }
  const recipientId = directUserIds.find((userId) => userId !== user.uid) || '';
  if (!recipientId || !await canMessageAcceptedFriend(user, recipientId, teamId)) {
    throw new Error('You can only send a direct message to an accepted friend who still shares this team.');
  }
  return {
    directAccess: 'accepted_friend' as const,
    directUserIds,
    friendshipId: directUserIds.join('__'),
    initiatedBy: null
  };
}

function getTeamRole(user: AuthUser, team: Record<string, any>, profile: Record<string, any>): ChatTeam['role'] {
  if (canModerateChat(mapUserWithProfile(user, profile), team)) {
    return team.ownerId === user.uid || user.isAdmin ? 'Admin' : 'Coach';
  }
  return 'Parent';
}

async function nativeLoadLinkedTeams(profile: Record<string, any>) {
  const linkedTeamIds = [
    ...(Array.isArray(profile.parentOf) ? profile.parentOf.map((entry: any) => entry?.teamId) : []),
    ...(Array.isArray(profile.parentTeamIds) ? profile.parentTeamIds : []),
    ...(Array.isArray(profile.coachOf) ? profile.coachOf.map((entry: any) => entry?.teamId || entry) : [])
  ].map(compactString).filter(Boolean);
  const linkedTeamResults = await Promise.allSettled(
    [...new Set(linkedTeamIds)].map((teamId) => nativeGetDocument(`teams/${encodeURIComponent(teamId)}`))
  );
  const linkedTeams = linkedTeamResults.flatMap((result) => {
    if (result.status === 'fulfilled') return result.value ? [result.value] : [];
    logger.warn('Native linked team read failed.', { error: result.reason });
    return [];
  });
  return {
    teams: linkedTeams,
    isPartial: linkedTeamResults.some((result) => result.status === 'rejected')
  };
}

async function nativeLoadUserTeams(user: AuthUser, profile: Record<string, any>) {
  const ownedTeams = await nativeQueryTeamsByField('ownerId', 'EQUAL', user.uid).catch((error) => {
    logger.warn('Native owner team query failed.', { error });
    return [] as FirestoreDocument[];
  });
  const linkedTeamsResult = await nativeLoadLinkedTeams(profile);
  const map = new Map<string, FirestoreDocument>();
  [...ownedTeams, ...linkedTeamsResult.teams].forEach((team) => {
    if (team?.id) map.set(team.id, team);
  });
  return {
    teams: [...map.values()]
      .filter(isTeamActive)
      .sort((a, b) => String(a.name || a.id).localeCompare(String(b.name || b.id))),
    // The denied adminEmails collection query cannot be made provable under
    // Firestore rules. Owner/direct linked reads preserve verified records,
    // but only the server callable can prove the result is complete.
    isPartial: true
  };
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
  const timestamp = record.lastMessageAt || record.latestMessageAt || record.updatedAt || null;
  return toDate(timestamp);
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
  if (isNativeRuntime()) {
    const path = isDefaultTeamConversation(conversationId)
      ? `teams/${encodeURIComponent(teamId)}/chatMessages`
      : `teams/${encodeURIComponent(teamId)}/chatConversations/${encodeURIComponent(conversationId)}/chatMessages`;
    const [message] = await nativeListCollection(path, {
      orderBy: 'createdAt desc',
      pageSize: 1
    });
    return mapChatMessageRecord(message, message?.id || '') || null;
  }
  try {
    const [message] = await withTimeout(Promise.resolve(getChatMessages(teamId, { limit: 1, conversationId })), `latest chat ${teamId}/${conversationId}`, 2500);
    return mapChatMessageRecord(message, message?.id || '') || null;
  } catch {
    return null;
  }
}

async function getLatestMessagePreview(teamId: string, user: AuthUser, team: Record<string, any>, canModerate: boolean): Promise<{ message: ChatMessage | null; conversationId: string | null }> {
  let conversations: ChatConversation[] = [buildDefaultTeamConversation(team)];
  try {
    if (isNativeRuntime()) {
      const metadata = getTeamConversationMetadata(team);
      conversations = [
        buildDefaultTeamConversation(team),
        ...metadata.ids
          .filter((conversationId) => !isDefaultTeamConversation(conversationId))
          .map((conversationId) => ({
            id: conversationId,
            type: 'group',
            updatedAt: metadata.latestMessageAtByConversation[conversationId] || null,
            lastMessageAt: metadata.latestMessageAtByConversation[conversationId] || null
          } as ChatConversation))
      ];
    } else {
      const loadedConversations = await withTimeout(
        Promise.resolve(getChatConversations(teamId, user, { team, canModerate })),
        `latest chat conversations ${teamId}`,
        2500
      ) as ChatConversation[];
      const mappedConversations = mapChatConversationRecords(loadedConversations);
      conversations = mappedConversations.length
        ? mappedConversations
        : [buildDefaultTeamConversation(team)];
    }
  } catch (error) {
    conversations = [buildDefaultTeamConversation(team)];
    logger.warn('Latest inbox preview limited to team chat.', { error });
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
  if (fallbackMessages.some((result) => result.status === 'rejected')) {
    throw new Error(`Latest chat preview could not be completely loaded for team ${teamId}.`);
  }
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

function isPermissionDeniedError(error: unknown): boolean {
  const code = typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code?: unknown }).code || '')
    : '';
  return code === 'permission-denied' || code === 'unauthenticated' || code.endsWith('/permission-denied');
}

export async function loadChatInbox(user: AuthUser | null, options: ChatInboxLoadOptions = {}): Promise<ChatInboxLoadResult> {
  if (!user?.uid) return { teams: [] };
  const includeLastMessages = options.includeLastMessages !== false;
  const onPreview = typeof options.onPreview === 'function' ? options.onPreview : null;
  const onPreviewError = typeof options.onPreviewError === 'function' ? options.onPreviewError : null;

  const nativeRuntime = isNativeRuntime();
  const profile = (nativeRuntime
    ? await (options.nativeProfileLoader
      ? options.nativeProfileLoader()
      : nativeGetDocument(`users/${encodeURIComponent(user.uid)}`))
    : await withTimeout(Promise.resolve(getUserProfile(user.uid)), 'Chat profile load')) as Record<string, any> || {};

  let teams: Record<string, any>[] = [];
  let teamDiscoveryPartial = false;
  const serverAuthorizedChatTeamIds = new Set<string>();
  if (nativeRuntime) {
    try {
      const managedResult = options.nativeManagedTeamsLoader
        ? await options.nativeManagedTeamsLoader()
        : await import('./profileService').then(({ loadManagedTeamsFromNativeCallable }) => (
          loadManagedTeamsFromNativeCallable({ includeChatMetadata: true })
        ));
      const map = new Map<string, Record<string, any>>();
      managedResult.teams.forEach((team: any) => {
        if (!team?.id) return;
        map.set(team.id, team);
        if (team.chatAccessVerified === true) serverAuthorizedChatTeamIds.add(team.id);
      });
      teams = [...map.values()];
      teamDiscoveryPartial = managedResult.isPartial;
    } catch (error) {
      logger.warn('Native managed team discovery failed; using verified direct reads.', { error });
      const fallback = await nativeLoadUserTeams(user, profile);
      teams = fallback.teams;
      teamDiscoveryPartial = true;
    }
  } else {
    const [memberTeamsResult, parentTeamsResult] = await withTimeout(Promise.allSettled([
      getUserTeamsWithAccess(user.uid, user.email || ''),
      getParentTeams(user.uid)
    ]), 'Chat teams load');
    if (memberTeamsResult.status === 'rejected' && parentTeamsResult.status === 'rejected') {
      throw memberTeamsResult.reason || parentTeamsResult.reason;
    }
    if (memberTeamsResult.status === 'rejected') {
      teamDiscoveryPartial = true;
      if (!isPermissionDeniedError(memberTeamsResult.reason)) {
        throw memberTeamsResult.reason;
      }
      logger.warn('Chat member team load failed; using parent teams only.', { error: memberTeamsResult.reason });
    }
    if (parentTeamsResult.status === 'rejected') {
      teamDiscoveryPartial = true;
      if (!isPermissionDeniedError(parentTeamsResult.reason)) {
        throw parentTeamsResult.reason;
      }
      logger.warn('Chat parent team load failed; using member teams only.', { error: parentTeamsResult.reason });
    }
    const memberTeams = memberTeamsResult.status === 'fulfilled' && Array.isArray(memberTeamsResult.value)
      ? memberTeamsResult.value
      : [];
    const parentTeams = parentTeamsResult.status === 'fulfilled' && Array.isArray(parentTeamsResult.value)
      ? parentTeamsResult.value
      : [];
    const map = new Map<string, Record<string, any>>();
    [...memberTeams, ...parentTeams].forEach((team: any) => {
      if (team?.id) map.set(team.id, team);
    });
    teams = [...map.values()];
  }

  const userWithProfile = mapUserWithProfile(user, profile);
  const accessibleTeams = teams.filter((team) => isTeamActive(team) && (
    serverAuthorizedChatTeamIds.has(team.id)
    || canAccessTeamChat(userWithProfile, { ...team, id: team.id })
  ));
  if (teamDiscoveryPartial && accessibleTeams.length === 0) {
    throw new Error('Chat team access could not be completely verified. Try again.');
  }
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
  const unreadDeadlineAt = Date.now() + chatUnreadCountTimeoutMs;
  const nativeUnreadResult = nativeRuntime
    ? await nativeLoadUnreadChatCounts(
      user.uid,
      unreadCandidateTeamIds,
      profile,
      conversationIdsByTeam,
      chatUnreadCountTimeoutMs
    ).catch((error) => {
      logger.warn('Native chat unread counts failed.', { error });
      return {
        counts: {} as Record<string, number>,
        isPartial: unreadCandidateTeamIds.length > 0
      };
    })
    : null;
  const unreadCountsPartial = nativeUnreadResult?.isPartial === true;
  const unreadCounts = nativeUnreadResult?.counts || await withTimeout(
      Promise.resolve(getUnreadChatCounts(user.uid, unreadCandidateTeamIds, {
        latestMessageAtByTeam,
        latestMessageAtByConversationByTeam,
        conversationIdsByTeam,
        conversationLookupByTeam,
        defaultConversationOnly: !includeLastMessages,
        deadlineAt: unreadDeadlineAt
      })),
      'Chat unread counts',
      chatUnreadCountTimeoutMs
    ).catch(() => ({} as Record<string, number>));

  let previewReadsPartial = false;
  const previews = includeLastMessages
    ? (await Promise.allSettled(previewInputs.map(async ({ team, canModerate }) => ({
      team,
      canModerate,
      preview: await loadCachedMessagePreview(team.id, userWithProfile, team, canModerate)
    })))).map((result, index) => {
      if (result.status === 'fulfilled') return result.value;
      previewReadsPartial = true;
      const { team, canModerate } = previewInputs[index];
      logger.warn('Inbox preview failed; preserving the verified team as partial.', {
        error: result.reason,
        teamId: team.id
      });
      return {
        team,
        canModerate,
        preview: { message: null, conversationId: null }
      };
    })
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
        onPreviewError?.(team.id);
      }
    });
  }

  return {
    isPartial: teamDiscoveryPartial || unreadCountsPartial || previewReadsPartial,
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

export async function loadChatConversations(
  teamId: string,
  user: AuthUser,
  team: Record<string, any>,
  canModerate: boolean,
  options: ChatConversationLoadOptions = {}
): Promise<ChatConversation[]> {
  if (isNativeRuntime()) {
    const result = await callNativeFirebaseFunction<{
      items?: unknown[];
      isPartial?: boolean;
    }>('listAuthorizedChatConversations', {
      teamId,
      activeConversationId: options.activeConversationId || null
    }, { errorLabel: 'Chat conversations' });
    if (!result || result.isPartial !== false || !Array.isArray(result.items)) {
      throw new Error('Chat conversations could not be completely verified. Try again.');
    }
    const projectedConversations = mapChatConversationRecords(result.items as ChatConversation[]);
    const conversationsById = new Map<string, ChatConversation>([
      [DEFAULT_TEAM_CONVERSATION_ID, buildDefaultTeamConversation(team) as ChatConversation]
    ]);
    projectedConversations.forEach((conversation) => {
      if (conversation.id && !isDefaultTeamConversation(conversation.id)) {
        conversationsById.set(conversation.id, conversation);
      }
    });
    const activeConversationId = compactString(options.activeConversationId);
    if (
      activeConversationId &&
      !isDefaultTeamConversation(activeConversationId) &&
      !conversationsById.has(activeConversationId)
    ) {
      throw new Error('The requested conversation is no longer available to this account.');
    }
    return [...conversationsById.values()];
  }
  try {
    const conversations = await withTimeout(Promise.resolve(getChatConversations(teamId, user, {
      team,
      canModerate,
      includeConversationId: options.activeConversationId || undefined
    })), 'Chat conversations load') as ChatConversation[];
    return mapChatConversationRecords(conversations);
  } catch (error) {
    logger.warn('Falling back to default chat conversation.', { error });
    return [buildDefaultTeamConversation(team) as ChatConversation];
  }
}

export async function loadChatConversationById(
  teamId: string,
  user: AuthUser,
  team: Record<string, any>,
  canModerate: boolean,
  conversationId: string
): Promise<ChatConversation | null> {
  const requestedConversationId = compactString(conversationId);
  if (!requestedConversationId || isDefaultTeamConversation(requestedConversationId) || requestedConversationId.includes('/')) {
    return null;
  }
  if (isNativeRuntime()) {
    const conversations = await loadChatConversations(teamId, user, team, canModerate);
    return conversations.find((conversation) => conversation.id === requestedConversationId) || null;
  }
  let conversations: ChatConversation[];
  try {
    conversations = await withTimeout(Promise.resolve(getChatConversations(teamId, user, {
      team,
      canModerate,
      includeConversationId: requestedConversationId,
      strictIncludeConversationId: true
    })), 'Direct chat conversation lookup') as ChatConversation[];
  } catch (error) {
    const code = compactString((error as { code?: unknown } | null)?.code).toLowerCase().replace(/^firestore\//, '');
    // Rules that inspect resource data deny missing-document reads for non-moderators.
    // For this participant-scoped probe, denied and missing both mean no readable thread.
    if (code === 'permission-denied' || code === 'not-found') return null;
    throw error;
  }
  return mapChatConversationRecords(conversations)
    .find((conversation) => conversation.id === requestedConversationId) || null;
}

function canReuseStaffChatConversation(conversation: ChatConversation | null | undefined) {
  const participantRoles = Array.isArray(conversation?.participantRoles)
    ? conversation.participantRoles.map(compactString).filter(Boolean)
    : [];
  return conversation?.id === 'group_role%3Astaff'
    && participantRoles.length === 1
    && participantRoles[0].toLowerCase() === 'staff'
    && (!Array.isArray(conversation.participantIds) || conversation.participantIds.length === 0);
}

export async function ensureStaffChatConversation(teamId: string, user: AuthUser, conversations: ChatConversation[] = []): Promise<ChatConversation> {
  const existing = conversations.find((conversation) => canReuseStaffChatConversation(conversation));
  if (existing) return existing;

  return await withTimeout(Promise.resolve(upsertChatConversation(teamId, {
    type: 'group',
    participantIds: [],
    participantRoles: ['staff'],
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
  let lastNativeMessageRevision: string | null = null;
  let pollingStarted = false;

  const startPollingFallback = async () => {
    if (cancelled || pollingStarted) return;
    pollingStarted = true;
    unsubscribe?.();
    unsubscribe = null;
    const load = async () => {
      if (cancelled) return;
      try {
        const collectionPath = getMessageCollectionPath(teamId, conversationId);
        const page = await nativeListCollectionPage(collectionPath, {
          orderBy: nativeChatPageOrder,
          pageSize: nativeChatPageSize
        });
        if (cancelled) return;
        const mappedMessages = mapChatMessageRecords(page.documents);
        const cursor = createNativeChatPageCursor(collectionPath, page.nextPageToken);
        const messageRevision = JSON.stringify({
          messages: getChatMessageListRevision(mappedMessages),
          nextPageToken: cursor.nextPageToken
        });
        if (messageRevision === lastNativeMessageRevision) return;
        lastNativeMessageRevision = messageRevision;
        onMessages(mappedMessages, cursor);
      } catch (error: any) {
        if (!cancelled) onError?.(error);
      }
    };
    await load();
    if (!cancelled) {
      pollTimer = window.setInterval(load, 8000);
    }
  };

  const handleListenerError = (error: Error) => {
    if (isNativeRuntime()) {
      // Listener authorization failures arrive asynchronously. Keep realtime
      // delivery when the in-memory bridge is healthy, and reuse the existing
      // authenticated REST poller if the WebView listener cannot start.
      void startPollingFallback();
    } else {
      onError?.(error);
    }
  };

  try {
    unsubscribe = subscribeToChatMessages(teamId, { limit: 50, conversationId }, (messages: ChatMessage[], oldestDoc: unknown | null) => {
      if (!cancelled) {
        const mappedMessages = mapChatMessageRecords(messages);
        onMessages(mappedMessages, oldestDoc);
      }
    }, handleListenerError);
  } catch (error: any) {
    handleListenerError(error);
  }

  return {
    unsubscribe: () => {
      cancelled = true;
      if (pollTimer !== undefined) window.clearInterval(pollTimer);
      unsubscribe?.();
    }
  };
}

export async function loadOlderTeamChatMessages(teamId: string, conversationId: string, startAfterDoc: unknown | null): Promise<{
  messages: ChatMessage[];
  cursor: unknown | null;
}> {
  if (!startAfterDoc) return { messages: [], cursor: null };
  if (isNativeChatPageCursor(startAfterDoc)) {
    const collectionPath = getMessageCollectionPath(teamId, conversationId);
    validateNativeChatPageCursor(startAfterDoc, collectionPath);
    if (!startAfterDoc.nextPageToken?.trim()) {
      return { messages: [], cursor: createNativeChatPageCursor(collectionPath, null) };
    }
    const page = await nativeListCollectionPage(collectionPath, {
      orderBy: nativeChatPageOrder,
      pageSize: nativeChatPageSize,
      pageToken: startAfterDoc.nextPageToken
    });
    return {
      messages: mapChatMessageRecords(page.documents),
      cursor: createNativeChatPageCursor(collectionPath, page.nextPageToken)
    };
  }

  const messages = await withTimeout(Promise.resolve(getChatMessages(teamId, {
    limit: 50,
    startAfterDoc,
    conversationId
  })), 'Older chat messages load') as ChatMessage[];
  const mappedMessages = mapChatMessageRecords(messages);
  return {
    messages: mappedMessages,
    cursor: mappedMessages.length >= nativeChatPageSize
      ? mappedMessages[mappedMessages.length - 1]?._doc || null
      : null
  };
}

async function nativeUploadChatMedia(teamId: string, file: File, conversationId = DEFAULT_TEAM_CONVERSATION_ID): Promise<ChatAttachment> {
  const bucket = firebaseAuth.app?.options?.storageBucket;
  if (!bucket) {
    throw new Error('Primary Firebase Storage configuration is missing.');
  }
  const userId = getNativeAuthUserId();
  if (!userId) {
    throw new Error('Sign in before uploading team chat media.');
  }
  const idToken = await getNativeAuthIdToken(true);
  if (!idToken) {
    throw new Error('Native auth token is unavailable.');
  }
  const safeName = String(file.name || 'media').replace(/[^\w.-]+/g, '_');
  const safeTeamId = String(teamId || 'unknown-team').replace(/[^\w.-]+/g, '_');
  const safeConversationId = String(conversationId || DEFAULT_TEAM_CONVERSATION_ID).replace(/[^%\w.-]+/g, '_') || DEFAULT_TEAM_CONVERSATION_ID;
  const safeUserId = String(userId).replace(/[^\w.-]+/g, '_');
  const isVideo = String(file.type || '').toLowerCase().startsWith('video/');
  const path = `stat-sheets/team-chat/${safeTeamId}/${safeConversationId}/${safeUserId}/${Date.now()}_${createSecureUploadToken()}_${safeName}`;
  const requestUrl = `https://firebasestorage.googleapis.com/v0/b/${encodeURIComponent(bucket)}/o?uploadType=media&name=${encodeURIComponent(path)}`;
  const abortController = new AbortController();
  let uploadTimeoutId: number | undefined;
  const uploadTimeout = new Promise<Response>((_, reject) => {
    uploadTimeoutId = window.setTimeout(() => {
      abortController.abort();
      reject(new Error('Chat media upload timed out. Check your connection and try again.'));
    }, chatUploadTimeoutMs);
  });
  try {
    const uploadRequest = fetch(requestUrl, {
      method: 'POST',
      headers: await getPrimaryAppCheckHeaders({
        Authorization: `Bearer ${idToken}`,
        'Content-Type': file.type || 'application/octet-stream'
      }, requestUrl),
      body: file,
      signal: abortController.signal
    });
    const response = await Promise.race([uploadRequest, uploadTimeout]).finally(() => {
      if (uploadTimeoutId) window.clearTimeout(uploadTimeoutId);
    });
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
  } catch (error) {
    if (uploadTimeoutId) window.clearTimeout(uploadTimeoutId);
    const { deleteNativePrimaryStorageFile } = await import('./nativeStorageUpload');
    await deleteNativePrimaryStorageFile(path).catch(() => undefined);
    throw error;
  }
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

export async function deleteTeamChatAttachments(attachments: ChatAttachment[]) {
  const cleanupAttachments = (Array.isArray(attachments) ? attachments : [])
    .filter((attachment) => Boolean(attachment?.path));
  if (!cleanupAttachments.length) return;
  if (isNativeRuntime()) {
    const { deleteNativePrimaryStorageFile } = await import('./nativeStorageUpload');
    const results = await Promise.allSettled(cleanupAttachments.map((attachment) => (
      deleteNativePrimaryStorageFile(String(attachment.path))
    )));
    const failure = results.find((result) => result.status === 'rejected');
    if (failure?.status === 'rejected') throw failure.reason;
    return;
  }
  await deleteUploadedChatAttachments(cleanupAttachments);
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
  const attachmentUploadedAt = new Date();
  const attachments = input.attachments || [];
  const documentId = input.clientMessageId || `native_${input.senderId}_${Date.now()}_${Math.random().toString(36).slice(2)}`
    .replace(/[^A-Za-z0-9_-]/g, '_')
    .slice(0, 120);
  const collectionPath = getMessageCollectionPath(teamId, input.conversationId);
  return nativeCommitDocument(`${collectionPath}/${encodeURIComponent(documentId)}`, {
    clientMessageId: input.clientMessageId || null,
    text: input.text || '',
    senderId: input.senderId,
    senderName: input.senderName || null,
    senderEmail: input.senderEmail || null,
    senderPhotoUrl: input.senderPhotoUrl || null,
    attachments: attachments.map((attachment) => ({ ...attachment, uploadedAt: attachmentUploadedAt })),
    imageUrl: null,
    imagePath: null,
    imageName: null,
    imageType: null,
    imageSize: null,
    createdAt: null,
    editedAt: null,
    deleted: false,
    ai: false,
    aiName: null,
    aiQuestion: null,
    aiMeta: null,
    targetType: input.targetType,
    recipientIds: input.targetType === 'individuals' ? input.recipientIds : [],
    targetRole: input.targetType === 'staff' ? (input.targetRole || 'staff') : null,
    conversationId: isDefaultTeamConversation(input.conversationId) ? null : input.conversationId
  }, { serverTimestampFields: ['createdAt'] });
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
  canModerate = false,
  onProgress,
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
  canModerate?: boolean;
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
    let targetMetadata = buildChatAudienceMetadata({
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
      const conversationType = participantIds.length === 2
        && getDirectUserIds(user.uid, participantIds).length === 2
        ? 'direct'
        : 'group';
      const directMetadata = conversationType === 'direct'
        ? await resolveDirectConversationMetadata({ teamId, user, participantIds, canModerate })
        : {};
      createdConversation = await withTimeout(Promise.resolve(upsertChatConversation(teamId, {
        type: conversationType,
        participantIds,
        participantRoles,
        mutedBy: [],
        name: targetMetadata.targetType === 'staff' ? 'Staff only' : null,
        ...(conversationType === 'direct' ? { createOnly: true } : {}),
        ...directMetadata
      })), 'Chat conversation create') as ChatConversation;
      conversationId = createdConversation.id;
      if (targetMetadata.targetType === 'individuals') {
        targetMetadata = {
          targetType: 'individuals',
          recipientIds: Array.isArray(createdConversation.participantIds) ? createdConversation.participantIds : participantIds,
          targetRole: null
        };
      }
    } else if (selectedConversation?.type === 'direct') {
      const participantIds = selectedConversation.participantIds || targetMetadata.recipientIds;
      const directUserIds = getDirectUserIds(user.uid, participantIds);
      if (!selectedConversation.directAccess && (!canModerate || directUserIds.length !== 2)) {
        selectedConversation = await withTimeout(Promise.resolve(
          repairLegacyDirectConversation(teamId, selectedConversation.id)
        ), 'Legacy chat repair') as ChatConversation;
        createdConversation = selectedConversation;
      } else {
        const directMetadata = await resolveDirectConversationMetadata({
          teamId,
          user,
          participantIds,
          canModerate,
          existingConversation: selectedConversation
        });
        if (!selectedConversation.directAccess) {
          selectedConversation = await withTimeout(Promise.resolve(upsertChatConversation(teamId, {
            type: 'direct',
            participantIds,
            participantRoles: selectedConversation.participantRoles || [],
            ...directMetadata
          })), 'Direct chat authorization upgrade') as ChatConversation;
        }
      }
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
      aiMeta: null,
      ...targetMetadata
    };

    const effectiveConversation = createdConversation || selectedConversation;
    if (effectiveConversation?.type === 'direct') {
      await sendAuthorizedDirectMessage({
        teamId,
        conversationId,
        clientMessageId: payload.clientMessageId,
        text: payload.text,
        attachments: payload.attachments
      });
    } else if (isNativeRuntime()) {
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
        await deleteTeamChatAttachments(cleanupAttachments);
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
  recipientIds = [],
  postToTeamChat
}: {
  teamId: string;
  subject: string;
  body: string;
  targetType?: ChatTargetType;
  recipientIds?: string[];
  postToTeamChat?: boolean;
}) {
  const trimmedSubject = String(subject || '').trim();
  const trimmedBody = String(body || '').trim();
  if (!trimmedSubject || !trimmedBody) {
    throw new Error('Subject and message are required.');
  }
  if (targetType === 'individuals' && recipientIds.map((id) => String(id || '').trim()).filter(Boolean).length === 0) {
    throw new Error('Choose at least one selected member before sending.');
  }

  const payload: {
    subject: string;
    body: string;
    targetType: ChatTargetType;
    recipientIds: string[];
    postToTeamChat?: boolean;
  } = {
    subject: trimmedSubject,
    body: trimmedBody,
    targetType,
    recipientIds: targetType === 'individuals' ? recipientIds : []
  };
  if (typeof postToTeamChat === 'boolean') {
    payload.postToTeamChat = targetType === 'full_team' && postToTeamChat;
  }

  return withTimeout(Promise.resolve(sendTeamEmail(teamId, payload)), 'Team email send');
}

export async function loadSentTeamEmails(teamId: string, { limit = 25 }: { limit?: number } = {}): Promise<SentTeamEmail[]> {
  return withTimeout(Promise.resolve(getSentTeamEmails(teamId, { limit })), 'Sent email history') as Promise<SentTeamEmail[]>;
}

export function mergeTeamEmailSavedItems<T extends { id: string }>(current: T[], next: T[]): T[] {
  const merged = new Map(current.map((item) => [item.id, item]));
  next.forEach((item) => merged.set(item.id, item));
  return Array.from(merged.values());
}

export async function loadTeamEmailDrafts(
  teamId: string,
  { pageSize = TEAM_EMAIL_SAVED_PAGE_SIZE, cursor = null }: { pageSize?: number; cursor?: TeamEmailSavedCursor | null } = {}
): Promise<TeamEmailSavedPage<TeamEmailDraft>> {
  const page = await withTimeout(
    Promise.resolve(getStoredTeamEmailDrafts(teamId, { pageSize, cursor })),
    'Team email drafts'
  ) as { items?: Record<string, any>[]; nextCursor?: TeamEmailSavedCursor | null };
  const items = (Array.isArray(page?.items) ? page.items : [])
    .map((draft) => normalizeTeamEmailDraft(draft))
    .filter((draft): draft is TeamEmailDraft => Boolean(draft))
    .sort((a, b) => (toDate(b.updatedAt)?.getTime() || 0) - (toDate(a.updatedAt)?.getTime() || 0));
  return { items, nextCursor: page?.nextCursor || null };
}

export async function loadTeamEmailTemplates(
  teamId: string,
  { pageSize = TEAM_EMAIL_SAVED_PAGE_SIZE, cursor = null }: { pageSize?: number; cursor?: TeamEmailSavedCursor | null } = {}
): Promise<TeamEmailSavedPage<TeamEmailTemplate>> {
  const page = await withTimeout(
    Promise.resolve(getStoredTeamEmailTemplates(teamId, { pageSize, cursor })),
    'Team email templates'
  ) as { items?: Record<string, any>[]; nextCursor?: TeamEmailSavedCursor | null };
  const items = (Array.isArray(page?.items) ? page.items : [])
    .map((template) => normalizeTeamEmailTemplate(template))
    .filter((template): template is TeamEmailTemplate => Boolean(template));
  return { items, nextCursor: page?.nextCursor || null };
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
    return nativeCommitDocument(getMessageDocumentPath(teamId, messageId, conversationId), {
      text,
      editedAt: null
    }, { serverTimestampFields: ['editedAt'] });
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

  async function hydrateChatRecipientProfile<T>(lookupPromise: Promise<T>, fallbackLookup: () => Promise<T>): Promise<T> {
    return withTimeout(lookupPromise, 'Chat recipient profile load', 2500)
      .catch(async (error) => {
        if (!isNativeRuntime()) throw error;
        return fallbackLookup();
      });
  }

  async function hydrateNextParent() {
    while (nextParentIndex < parentEntries.length) {
      const entryIndex = nextParentIndex;
      nextParentIndex += 1;
      const [recipientId, parent] = parentEntries[entryIndex];
      const userId = compactString(parent?.userId);
      const email = compactString(parent?.email).toLowerCase();
      try {
        if (userId) {
          const profile = await hydrateChatRecipientProfile(
            Promise.resolve(getUserProfile(userId)),
            () => nativeGetDocument(`users/${encodeURIComponent(userId)}`)
          );
          entries[entryIndex] = [recipientId, profile || {}] as const;
          continue;
        }
        if (email) {
          const profile = await hydrateChatRecipientProfile(
            Promise.resolve(getUserByEmail(email)),
            () => nativeGetUserByEmail(email)
          );
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
  const seconds = typeof value?.seconds === 'number'
    ? value.seconds
    : typeof value?._seconds === 'number'
      ? value._seconds
      : null;
  if (seconds !== null) {
    const nanoseconds = typeof value?.nanoseconds === 'number'
      ? value.nanoseconds
      : typeof value?._nanoseconds === 'number'
        ? value._nanoseconds
        : 0;
    const date = new Date((seconds * 1000) + Math.floor(nanoseconds / 1_000_000));
    return Number.isNaN(date.getTime()) ? null : date;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function getChatInboxPreview(message: ChatMessage | null) {
  if (!message) return 'No messages yet';
  const sender = message.ai ? 'ALL PLAYS' : message.senderName || message.senderEmail || 'Unknown';
  return `${sender}: ${getMessagePreviewText(message)}`;
}
