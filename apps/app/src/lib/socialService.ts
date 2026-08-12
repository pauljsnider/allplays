import {
  addDoc,
  collection,
  db,
  doc,
  documentId,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  startAfter,
  Timestamp,
  updateDoc,
  where
} from './adapters/legacySocialDb';
import { loadParentHome } from './homeService';
import { createLogger } from './logger';
import { toAppServiceError } from './appErrors';
import type { ParentHomeModel } from './homeLogic';
import { deleteTeamChatAttachments, uploadTeamChatAttachment } from './chatService';
import type { AuthUser } from './types';
import { getPublicTeamDetail } from './publicTeamsService';
import { loadProfileDocument } from './profileService';
import { getPrimaryAppCheckHeaders } from './adapters/legacyFirebaseAppCheck';
import { firebaseAuth, getNativeAuthIdToken } from './authService';
import { isNativeRuntime } from './nativeRuntime';
import { callNativeFirebaseFunction } from './nativeCallable';
import { buildAthleteProfileShareUrl } from './adapters/legacyPlayerProfile';
import { getPublicBaseUrl } from './inviteUrls';
import {
  getStoredSocialPostNavigation,
  normalizeSocialPostNavigationForCreate
} from './socialNavigation';
import {
  buildFriendshipId,
  buildSocialHomeModel,
  emptySocialHome,
  getFriendMessageRoute,
  normalizeSocialFriend,
  sortSocialFeedItems,
  toSocialDate,
  type SocialFeedItem,
  type SocialFriend,
  type SocialHomeModel,
  type SocialMedia,
  type SocialPostType,
  type SocialVisibility
} from './socialLogic';

const primaryDataTimeoutMs = 5000;
const socialPostLimit = 30;
// Firestore `in` queries historically support 10 values across every runtime
// this shared web/native service supports. Rules enforce the same request cap.
const hiddenSocialPostQueryLimit = 10;
// A surface may inspect at most four full 30-post candidate pages per load.
// The Home resolver is shared across its visible-user and team branches.
const socialPostCandidateBudget = 120;
const socialPostPageBudget = 4;
const teamSocialPostLimit = 12;
const teamSocialFeedTeamLimit = 8;
const friendSuggestionLimit = 8;
const publicUserProfileCollection = 'publicUserProfiles';
const logger = createLogger('social-service');

type FirestoreDoc = Record<string, any> & { id: string };

type HiddenSocialPostLookup = {
  hiddenPostIds: Set<string>;
  unresolvedPostIds: Set<string>;
  budgetExhausted: boolean;
};

type HiddenSocialPostResolver = {
  resolve: (postIds: string[]) => Promise<HiddenSocialPostLookup>;
};

export type CreateSocialPostInput = {
  type: SocialPostType;
  visibility: SocialVisibility;
  title: string;
  detail?: string;
  caption?: string;
  teamId?: string | null;
  teamName?: string | null;
  playerIds?: string[];
  playerNames?: string[];
  sourceType?: string | null;
  sourceId?: string | null;
  route?: string | null;
  href?: string | null;
  media?: SocialMedia[];
  visibleUserIds?: string[];
};

export type SocialMediaUpload = SocialMedia & {
  storagePath: string;
};

export type FriendProfileModel = {
  userId: string;
  name: string;
  photoUrl: string | null;
  sharedTeamNames: string[];
  publicTeams: Array<{ id: string; name: string; sport: string | null; photoUrl: string | null }>;
  publicChildren: Array<{ id: string; name: string; headline: string; photoUrl: string | null; shareUrl: string }>;
  messageRoute: string | null;
  isSelf: boolean;
  posts: SocialFeedItem[];
  postsError: string | null;
};

function withTimeout<T>(promise: Promise<T>, label: string, timeoutMs = primaryDataTimeoutMs): Promise<T> {
  let timeoutId: number | undefined;
  const timeout = new Promise<T>((_, reject) => {
    timeoutId = window.setTimeout(() => reject(new Error(`${label} timed out.`)), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timeoutId) window.clearTimeout(timeoutId);
  });
}

function snapshotToDocs(snapshot: any): FirestoreDoc[] {
  return snapshot.docs.map((entry: any) => ({
    id: entry.id,
    ...entry.data()
  }));
}

function decodeFirestoreValue(value: any): any {
  if (!value || typeof value !== 'object') return null;
  if ('stringValue' in value) return value.stringValue;
  if ('booleanValue' in value) return value.booleanValue;
  if ('integerValue' in value) return Number(value.integerValue || 0);
  if ('doubleValue' in value) return Number(value.doubleValue || 0);
  if ('timestampValue' in value) return new Date(value.timestampValue);
  if ('nullValue' in value) return null;
  if ('referenceValue' in value) return value.referenceValue;
  if ('arrayValue' in value) return (value.arrayValue?.values || []).map(decodeFirestoreValue);
  if ('mapValue' in value) return decodeFirestoreFields(value.mapValue?.fields || {});
  return null;
}

function decodeFirestoreFields(fields: Record<string, any> = {}) {
  return Object.keys(fields).reduce<Record<string, any>>((decoded, key) => {
    decoded[key] = decodeFirestoreValue(fields[key]);
    return decoded;
  }, {});
}

function decodeNativeFirestoreDocument(document: any): FirestoreDoc | null {
  const name = compactString(document?.name);
  if (!name) return null;
  return {
    id: name.split('/').pop() || '',
    ...decodeFirestoreFields(document.fields || {}),
    __documentName: name,
    __createdAtCursor: document.fields?.createdAt || null
  };
}

function getNativeFirestoreBaseUrl() {
  const projectId = compactString(firebaseAuth.app?.options?.projectId);
  if (!projectId) throw new Error('Firebase project ID is missing.');
  return `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/databases/(default)/documents`;
}

function getNativeFirestoreDocumentName(path: string) {
  const projectId = compactString(firebaseAuth.app?.options?.projectId);
  if (!projectId) throw new Error('Firebase project ID is missing.');
  return `projects/${projectId}/databases/(default)/documents/${path}`;
}

async function getNativeFirestoreHeaders(requestUrl: string) {
  const token = await getNativeAuthIdToken(true);
  if (!token) throw new Error('Native auth token is unavailable.');
  return getPrimaryAppCheckHeaders({
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json'
  }, requestUrl);
}

async function nativeFirestoreRequest(path: string, init: RequestInit = {}): Promise<any> {
  const requestUrl = `${getNativeFirestoreBaseUrl()}${path}`;
  const response = await withTimeout(fetch(requestUrl, {
    ...init,
    headers: {
      ...(await getNativeFirestoreHeaders(requestUrl)),
      ...(init.headers || {})
    }
  }), 'Social Firestore request');
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload?.error?.message || `Social Firestore request failed (${response.status}).`) as Error & {
      code?: string;
      status?: number;
    };
    error.status = response.status;
    if (response.status === 401) error.code = 'unauthenticated';
    if (response.status === 403) error.code = 'permission-denied';
    throw error;
  }
  return payload;
}

async function nativeGetFirestoreDocument(path: string) {
  try {
    return decodeNativeFirestoreDocument(await nativeFirestoreRequest(`/${path}`));
  } catch (error: any) {
    if (error?.status === 404) return null;
    throw error;
  }
}

async function loadPublicUserProfileDocument(userId: string) {
  if (isNativeRuntime()) {
    return nativeGetFirestoreDocument(`${publicUserProfileCollection}/${encodeURIComponent(userId)}`);
  }
  const profileSnap = await withTimeout(
    getDoc(doc(db, publicUserProfileCollection, userId)),
    'Public profile'
  );
  return profileSnap?.exists?.()
    ? { id: profileSnap.id || userId, ...profileSnap.data() }
    : null;
}

async function loadPublicAthleteProfileDocuments(userId: string) {
  if (isNativeRuntime()) {
    const payload = await nativeFirestoreRequest(':runQuery', {
      method: 'POST',
      body: JSON.stringify({
        structuredQuery: {
          from: [{ collectionId: 'athleteProfiles' }],
          where: {
            compositeFilter: {
              op: 'AND',
              filters: [
                {
                  fieldFilter: {
                    field: { fieldPath: 'parentUserId' },
                    op: 'EQUAL',
                    value: { stringValue: userId }
                  }
                },
                {
                  fieldFilter: {
                    field: { fieldPath: 'privacy' },
                    op: 'EQUAL',
                    value: { stringValue: 'public' }
                  }
                }
              ]
            }
          },
          limit: 12
        }
      })
    });
    return (Array.isArray(payload) ? payload : [])
      .map((entry: any) => decodeNativeFirestoreDocument(entry.document))
      .filter((entry): entry is FirestoreDoc => Boolean(entry));
  }
  const snapshot = await withTimeout(getDocs(query(
    collection(db, 'athleteProfiles'),
    where('parentUserId', '==', userId),
    where('privacy', '==', 'public'),
    limit(12)
  )), 'Public athlete profiles');
  return snapshotToDocs(snapshot);
}

function collectPrivateProfileTeamIds(profile: Record<string, any> = {}) {
  return uniqueStrings([
    ...(Array.isArray(profile.discoveryTeamIds) ? profile.discoveryTeamIds : []),
    ...(Array.isArray(profile.parentTeamIds) ? profile.parentTeamIds : []),
    ...(Array.isArray(profile.coachOf) ? profile.coachOf : []),
    ...(Array.isArray(profile.parentOf) ? profile.parentOf.map((link: any) => link?.teamId) : []),
    ...(Array.isArray(profile.players) ? profile.players.map((link: any) => link?.teamId) : [])
  ]);
}

async function loadNativeSocialPostQueryPages({
  filters,
  label,
  hiddenPostResolver,
  pageSize,
  visibleLimit
}: {
  filters: Array<{ fieldPath: string; op: 'EQUAL' | 'ARRAY_CONTAINS'; value: Record<string, unknown> }>;
  label: string;
  hiddenPostResolver: HiddenSocialPostResolver;
  pageSize: number;
  visibleLimit: number;
}) {
  const visiblePosts: FirestoreDoc[] = [];
  let cursor: { createdAt: Record<string, unknown>; documentName: string } | null = null;
  let previousCursorName = '';
  let loadedPages = 0;
  let isPartial = false;
  let hasMore = false;
  while (visiblePosts.length < visibleLimit && loadedPages < socialPostPageBudget) {
    loadedPages += 1;
    const payload: any = await withTimeout(nativeFirestoreRequest(':runQuery', {
      method: 'POST',
      body: JSON.stringify({
        structuredQuery: {
          from: [{ collectionId: 'socialPosts' }],
          where: {
            compositeFilter: {
              op: 'AND',
              filters: [
                ...filters.map((filter) => ({
                  fieldFilter: {
                    field: { fieldPath: filter.fieldPath },
                    op: filter.op,
                    value: filter.value
                  }
                })),
                {
                  fieldFilter: {
                    field: { fieldPath: 'hidden' },
                    op: 'EQUAL',
                    value: { booleanValue: false }
                  }
                }
              ]
            }
          },
          orderBy: [
            { field: { fieldPath: 'createdAt' }, direction: 'DESCENDING' },
            { field: { fieldPath: '__name__' }, direction: 'DESCENDING' }
          ],
          ...(cursor ? {
            startAt: {
              before: false,
              values: [cursor.createdAt, { referenceValue: cursor.documentName }]
            }
          } : {}),
          limit: pageSize
        }
      })
    }), label);
    const pageDocs: FirestoreDoc[] = (Array.isArray(payload) ? payload : [])
      .map((entry: any) => decodeNativeFirestoreDocument(entry.document))
      .filter((entry): entry is FirestoreDoc => Boolean(entry));
    const hideResult = await hiddenPostResolver.resolve(pageDocs.map((post) => post.id));
    pageDocs.forEach((post: FirestoreDoc) => {
      if (!post.hidden &&
          !hideResult.hiddenPostIds.has(post.id) &&
          !hideResult.unresolvedPostIds.has(post.id) &&
          visiblePosts.length < visibleLimit) {
        visiblePosts.push(post);
      }
    });
    if (hideResult.unresolvedPostIds.size > 0) isPartial = true;
    hasMore = pageDocs.length >= pageSize && visiblePosts.length < visibleLimit;
    if (hideResult.budgetExhausted) {
      isPartial = true;
      break;
    }
    if (!hasMore) break;
    const lastDoc: FirestoreDoc = pageDocs[pageDocs.length - 1];
    const documentName = compactString(lastDoc.__documentName);
    if (!documentName || documentName === previousCursorName || !lastDoc.__createdAtCursor) {
      isPartial = true;
      break;
    }
    cursor = { createdAt: lastDoc.__createdAtCursor, documentName };
    previousCursorName = documentName;
  }
  if (hasMore && loadedPages >= socialPostPageBudget) {
    isPartial = true;
  }
  return {
    docs: visiblePosts.map(({ __documentName, __createdAtCursor, ...post }) => post),
    isPartial
  };
}

function compactString(value: unknown) {
  return String(value || '').trim();
}

function normalizeEmail(value: unknown) {
  return compactString(value).toLowerCase();
}

async function hashSocialEmail(value: unknown) {
  const normalized = normalizeEmail(value);
  if (!normalized || !globalThis.crypto?.subtle) {
    return null;
  }
  const bytes = new TextEncoder().encode(normalized);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((entry) => entry.toString(16).padStart(2, '0'))
    .join('');
}

function uniqueStrings(values: unknown[] = []) {
  return Array.from(new Set(values.map((value) => compactString(value)).filter(Boolean)));
}

function getUserDisplayName(user: AuthUser | null, fallback = 'ALL PLAYS user') {
  return compactString(user?.displayName) || compactString(user?.email) || fallback;
}

function mapSocialPost(docData: FirestoreDoc): SocialFeedItem {
  const snapshot = docData.snapshot && typeof docData.snapshot === 'object' ? docData.snapshot : {};
  const navigation = getStoredSocialPostNavigation(docData, snapshot);
  const type = compactString(docData.type || snapshot.type || 'manual_post') as SocialPostType;
  const visibility = compactString(docData.visibility || 'team') as SocialVisibility;
  return {
    id: docData.id,
    type,
    visibility,
    authorId: compactString(docData.authorId),
    authorName: compactString(docData.authorName) || 'ALL PLAYS user',
    authorPhotoUrl: docData.authorPhotoUrl || null,
    teamId: docData.teamId || snapshot.teamId || null,
    teamName: docData.teamName || snapshot.teamName || null,
    playerIds: uniqueStrings(docData.playerIds || snapshot.playerIds || []),
    playerNames: uniqueStrings(docData.playerNames || snapshot.playerNames || []),
    sourceType: docData.sourceType || snapshot.sourceType || null,
    sourceId: docData.sourceId || snapshot.sourceId || null,
    title: compactString(docData.title || snapshot.title) || 'ALL PLAYS post',
    detail: compactString(docData.detail || snapshot.detail),
    caption: compactString(docData.caption) || null,
    media: Array.isArray(docData.media) ? docData.media.filter((entry: any) => entry?.url) : [],
    route: navigation.route,
    href: navigation.href,
    createdAt: toSocialDate(docData.createdAt),
    reactionCounts: docData.reactionCounts && typeof docData.reactionCounts === 'object' ? docData.reactionCounts : {},
    commentCount: Number(docData.commentCount || 0),
    viewerHasLiked: docData.viewerHasLiked === true,
    viewerReactionError: docData.viewerReactionError === true,
    hidden: docData.hidden === true,
    autoGenerated: docData.autoGenerated === true
  };
}

function isAcceptedFriendship(friendship: FirestoreDoc, viewerId: string, profileUserId: string) {
  const memberIds = uniqueStrings(friendship.memberIds || []);
  return friendship.status === 'accepted' &&
    memberIds.length === 2 &&
    memberIds.includes(viewerId) &&
    memberIds.includes(profileUserId);
}

function getHomeTeamIds(home: ParentHomeModel) {
  return uniqueStrings((home.teams || []).map((team) => team.teamId));
}

function getHomeTeamNames(home: ParentHomeModel) {
  return (home.teams || []).reduce<Record<string, string>>((acc, team) => {
    if (team.teamId) acc[team.teamId] = team.teamName || team.teamId;
    return acc;
  }, {});
}

export async function loadSocialHome(user: AuthUser | null, homeOverride?: ParentHomeModel): Promise<SocialHomeModel> {
  if (!user?.uid) return emptySocialHome();
  const home = homeOverride || await loadParentHome(user);
  let friendshipsError: string | null = null;
  let feedError: string | null = null;
  const [postResult, friendships, suggestions] = await Promise.all([
    loadVisibleSocialPostsWithState(user, home).catch((error) => {
      logger.warn('Unable to load social posts.', { error });
      feedError = 'Feed details could not load. Try again.';
      return { posts: [], isPartial: true };
    }),
    loadFriendships(user).catch((error) => {
      const appError = toAppServiceError(error, "Couldn't load friend requests.");
      logger.warn('Unable to load friendships.', { error: appError });
      // Surface this instead of silently rendering "no requests" — a swallowed
      // failure here hides incoming friend requests entirely (#3867).
      friendshipsError = appError.message;
      return [];
    }),
    loadFriendSuggestions(user, home).catch((error) => {
      logger.warn('Unable to load friend suggestions.', { error });
      return [];
    })
  ]);
  if (postResult.isPartial && !feedError) {
    feedError = 'Some feed details could not load. Retry before relying on the complete post or Like state.';
  }

  return buildSocialHomeModel({
    feedItems: postResult.posts,
    friendshipFriends: friendships,
    suggestions,
    currentUserId: user.uid,
    friendshipsError,
    feedError
  });
}

export async function loadVisibleSocialPosts(user: AuthUser, home: ParentHomeModel): Promise<SocialFeedItem[]> {
  return (await loadVisibleSocialPostsWithState(user, home)).posts;
}

async function loadVisibleSocialPostsWithState(user: AuthUser, home: ParentHomeModel): Promise<{
  posts: SocialFeedItem[];
  isPartial: boolean;
}> {
  const hiddenPostResolver = createHiddenSocialPostResolver(user.uid, socialPostCandidateBudget);
  const postDocs = new Map<string, FirestoreDoc>();
  const homeTeamIds = getHomeTeamIds(home);
  const queriedTeamIds = homeTeamIds.slice(0, teamSocialFeedTeamLimit);
  const loadVisiblePosts = isNativeRuntime()
    ? loadNativeSocialPostQueryPages({
      filters: [{ fieldPath: 'visibleUserIds', op: 'ARRAY_CONTAINS', value: { stringValue: user.uid } }],
      label: 'Social feed',
      hiddenPostResolver,
      pageSize: socialPostLimit,
      visibleLimit: socialPostLimit
    })
    : loadSocialPostQueryPages({
      buildQuery: (cursor) => query(
        collection(db, 'socialPosts'),
        where('visibleUserIds', 'array-contains', user.uid),
        where('hidden', '==', false),
        orderBy('createdAt', 'desc'),
        ...(cursor ? [startAfter(cursor)] : []),
        limit(socialPostLimit)
      ),
      label: 'Social feed',
      hiddenPostResolver,
      pageSize: socialPostLimit,
      visibleLimit: socialPostLimit
    });
  const [visiblePostResult, teamPostResults] = await Promise.all([
    loadVisiblePosts,
    Promise.allSettled(queriedTeamIds.map((teamId) => (
      isNativeRuntime()
        ? loadNativeSocialPostQueryPages({
          filters: [{ fieldPath: 'teamId', op: 'EQUAL', value: { stringValue: teamId } }],
          label: `Team social feed ${teamId}`,
          hiddenPostResolver,
          pageSize: teamSocialPostLimit,
          visibleLimit: teamSocialPostLimit
        })
        : loadSocialPostQueryPages({
          buildQuery: (cursor) => query(
            collection(db, 'socialPosts'),
            where('teamId', '==', teamId),
            where('hidden', '==', false),
            orderBy('createdAt', 'desc'),
            ...(cursor ? [startAfter(cursor)] : []),
            limit(teamSocialPostLimit)
          ),
          label: `Team social feed ${teamId}`,
          hiddenPostResolver,
          pageSize: teamSocialPostLimit,
          visibleLimit: teamSocialPostLimit
        })
    )))
  ]);
  const failedTeamPostResults = teamPostResults.filter((result) => result.status === 'rejected');
  if (failedTeamPostResults.length > 0) {
    logger.warn('One or more team social feeds are incomplete.', {
      failedTeamCount: failedTeamPostResults.length
    });
  }
  const successfulTeamPostResults = teamPostResults
    .filter((result): result is PromiseFulfilledResult<{ docs: FirestoreDoc[]; isPartial: boolean }> => result.status === 'fulfilled')
    .map((result) => result.value);
  visiblePostResult.docs.forEach((post) => postDocs.set(post.id, post));
  successfulTeamPostResults.flatMap((result) => result.docs).forEach((post) => postDocs.set(post.id, post));

  const posts = sortSocialFeedItems([...postDocs.values()]
    .map(mapSocialPost)
    .filter((post) => !post.hidden))
    .slice(0, socialPostLimit);
  const viewerReactions = await loadViewerSocialPostReactions(posts, user.uid);
  return {
    posts: posts.map((post) => ({
      ...post,
      viewerHasLiked: viewerReactions.failedPostIds.has(post.id)
        ? undefined
        : viewerReactions.likedPostIds.has(post.id),
      viewerReactionError: viewerReactions.failedPostIds.has(post.id)
    })),
    isPartial: homeTeamIds.length > queriedTeamIds.length ||
      visiblePostResult.isPartial ||
      successfulTeamPostResults.some((result) => result.isPartial) ||
      failedTeamPostResults.length > 0 ||
      viewerReactions.failedPostIds.size > 0
  };
}

async function loadSocialPostQueryPages({
  buildQuery,
  label,
  hiddenPostResolver,
  pageSize,
  visibleLimit
}: {
  buildQuery: (cursor: any | null) => any;
  label: string;
  hiddenPostResolver: HiddenSocialPostResolver;
  pageSize: number;
  visibleLimit: number;
}) {
  const visiblePosts: FirestoreDoc[] = [];
  let cursor: any | null = null;
  let previousCursorId = '';
  let loadedPages = 0;
  let isPartial = false;
  let hasMore = false;
  while (visiblePosts.length < visibleLimit && loadedPages < socialPostPageBudget) {
    loadedPages += 1;
    const snapshot = await withTimeout(getDocs(buildQuery(cursor)), label);
    const snapshotDocs = Array.isArray(snapshot?.docs) ? snapshot.docs : [];
    const pageDocs = snapshotToDocs(snapshot);
    const hideResult = await hiddenPostResolver.resolve(pageDocs.map((post) => post.id));
    pageDocs.forEach((post) => {
      if (!post.hidden &&
          !hideResult.hiddenPostIds.has(post.id) &&
          !hideResult.unresolvedPostIds.has(post.id) &&
          visiblePosts.length < visibleLimit) {
        visiblePosts.push(post);
      }
    });
    if (hideResult.unresolvedPostIds.size > 0) isPartial = true;
    hasMore = snapshotDocs.length >= pageSize && visiblePosts.length < visibleLimit;
    if (hideResult.budgetExhausted) {
      isPartial = true;
      break;
    }
    if (!hasMore) break;
    const nextCursor = snapshotDocs[snapshotDocs.length - 1];
    if (!nextCursor?.id || nextCursor.id === previousCursorId) {
      isPartial = true;
      break;
    }
    cursor = nextCursor;
    previousCursorId = nextCursor.id;
  }
  if (hasMore && loadedPages >= socialPostPageBudget) {
    isPartial = true;
  }
  return { docs: visiblePosts, isPartial };
}

function createHiddenSocialPostResolver(userId: string, candidateBudget: number): HiddenSocialPostResolver {
  type HideState = boolean | null;
  type CacheEntry = {
    promise: Promise<HideState>;
    resolve: (state: HideState) => void;
  };
  const cache = new Map<string, CacheEntry>();
  let admittedCandidateCount = 0;

  function reserve(postId: string) {
    let resolveState: (state: HideState) => void = () => undefined;
    const promise = new Promise<HideState>((resolve) => {
      resolveState = resolve;
    });
    const entry = { promise, resolve: resolveState };
    cache.set(postId, entry);
    admittedCandidateCount += 1;
    return entry;
  }

  async function queryChunk(postIds: string[]) {
    try {
      let hiddenIds: Set<string>;
      if (isNativeRuntime()) {
        const values = postIds.map((postId) => ({
          referenceValue: getNativeFirestoreDocumentName(
            `users/${userId}/hiddenSocialPosts/${postId}`
          )
        }));
        const payload = await nativeFirestoreRequest(`/users/${encodeURIComponent(userId)}:runQuery`, {
          method: 'POST',
          body: JSON.stringify({
            structuredQuery: {
              from: [{ collectionId: 'hiddenSocialPosts' }],
              where: {
                fieldFilter: {
                  field: { fieldPath: '__name__' },
                  op: 'IN',
                  value: { arrayValue: { values } }
                }
              },
              limit: hiddenSocialPostQueryLimit
            }
          })
        });
        hiddenIds = new Set((Array.isArray(payload) ? payload : [])
          .map((entry: any) => decodeNativeFirestoreDocument(entry.document)?.id)
          .filter((postId): postId is string => Boolean(postId)));
      } else {
        const snapshot = await withTimeout(getDocs(query(
          collection(db, 'users', userId, 'hiddenSocialPosts'),
          where(documentId(), 'in', postIds),
          limit(hiddenSocialPostQueryLimit)
        )), 'Hidden social post candidates');
        hiddenIds = new Set(snapshotToDocs(snapshot).map((entry) => entry.id));
      }
      postIds.forEach((postId) => cache.get(postId)?.resolve(hiddenIds.has(postId)));
    } catch (error) {
      logger.warn('Unable to verify hidden social post candidates.', { error });
      postIds.forEach((postId) => cache.get(postId)?.resolve(null));
    }
  }

  return {
    async resolve(postIds: string[]) {
      const requestedIds = uniqueStrings(postIds);
      const newlyReservedIds: string[] = [];
      const budgetRejectedIds = new Set<string>();
      requestedIds.forEach((postId) => {
        if (cache.has(postId)) return;
        if (admittedCandidateCount >= candidateBudget) {
          budgetRejectedIds.add(postId);
          return;
        }
        reserve(postId);
        newlyReservedIds.push(postId);
      });
      const chunkQueries: Promise<void>[] = [];
      for (let index = 0; index < newlyReservedIds.length; index += hiddenSocialPostQueryLimit) {
        chunkQueries.push(queryChunk(newlyReservedIds.slice(index, index + hiddenSocialPostQueryLimit)));
      }
      await Promise.all(chunkQueries);
      const hiddenPostIds = new Set<string>();
      const unresolvedPostIds = new Set(budgetRejectedIds);
      await Promise.all(requestedIds.map(async (postId) => {
        const entry = cache.get(postId);
        if (!entry) return;
        const state = await entry.promise;
        if (state === true) hiddenPostIds.add(postId);
        if (state === null) unresolvedPostIds.add(postId);
      }));
      return {
        hiddenPostIds,
        unresolvedPostIds,
        budgetExhausted: budgetRejectedIds.size > 0
      };
    }
  };
}

async function loadViewerSocialPostReactions(posts: SocialFeedItem[], userId: string) {
  const reactionStates = await Promise.all(posts.map(async (post) => {
    try {
      if (isNativeRuntime()) {
        const reaction = await nativeGetFirestoreDocument(
          `socialPosts/${encodeURIComponent(post.id)}/reactions/${encodeURIComponent(userId)}`
        );
        return { postId: post.id, liked: Boolean(reaction), failed: false };
      }
      const reactionSnap = await getDoc(doc(db, 'socialPosts', post.id, 'reactions', userId));
      return { postId: post.id, liked: reactionSnap?.exists?.() === true, failed: false };
    } catch (error) {
      logger.warn('Unable to verify social post reaction state.', { postId: post.id, error });
      return { postId: post.id, liked: false, failed: true };
    }
  }));
  return {
    likedPostIds: new Set(reactionStates.filter((state) => state.liked).map((state) => state.postId)),
    failedPostIds: new Set(reactionStates.filter((state) => state.failed).map((state) => state.postId))
  };
}

export async function loadFriendProfile(user: AuthUser, profileUserId: string): Promise<FriendProfileModel> {
  const viewerId = compactString(user?.uid);
  const targetUserId = compactString(profileUserId);
  if (!viewerId || !targetUserId) {
    throw new Error('This profile is unavailable.');
  }

  const isSelf = viewerId === targetUserId;
  let friendship: FirestoreDoc | null = null;
  if (!isSelf) {
    const friendshipId = buildFriendshipId(viewerId, targetUserId);
    if (isNativeRuntime()) {
      friendship = await nativeGetFirestoreDocument(`friendships/${encodeURIComponent(friendshipId)}`);
    } else {
      const friendshipSnap = await withTimeout(
        getDoc(doc(db, 'friendships', friendshipId)),
        'Friend profile access'
      );
      friendship = friendshipSnap?.exists?.()
        ? { id: friendshipSnap.id || friendshipId, ...friendshipSnap.data() }
        : null;
    }
    if (!friendship || !isAcceptedFriendship(friendship, viewerId, targetUserId)) {
      throw new Error('This profile is available to accepted friends only.');
    }
  }

  const hiddenPostResolver = createHiddenSocialPostResolver(viewerId, socialPostCandidateBudget);
  const [privateProfile, publicProfile, publicChildrenDocs] = await Promise.all([
    isSelf ? loadProfileDocument(targetUserId) : Promise.resolve(null),
    loadPublicUserProfileDocument(targetUserId),
    loadPublicAthleteProfileDocuments(targetUserId).catch((error) => {
      logger.warn('Unable to load public athlete profiles.', { error, isSelf });
      return [];
    })
  ]);
  const profile = isSelf
    ? {
        ...(publicProfile || {}),
        ...(privateProfile || {}),
        discoveryTeamIds: uniqueStrings([
          ...uniqueStrings(publicProfile?.discoveryTeamIds || []),
          ...collectPrivateProfileTeamIds(privateProfile || {})
        ])
      }
    : (publicProfile || {});
  const publicTeamsPromise = Promise.all(
    uniqueStrings(profile.discoveryTeamIds || []).slice(0, 12).map((teamId) => getPublicTeamDetail(teamId).catch(() => null))
  ).then((teams) => teams.filter((team): team is NonNullable<typeof team> => Boolean(team)).map((team) => ({
    id: team.id,
    name: team.name,
    sport: team.sport,
    photoUrl: team.photoUrl
  })));
  let postsError: string | null = null;
  let postResult = { docs: [] as FirestoreDoc[], isPartial: false };
  postResult = await (isNativeRuntime()
    ? loadNativeSocialPostQueryPages({
      filters: [
        { fieldPath: 'visibleUserIds', op: 'ARRAY_CONTAINS', value: { stringValue: viewerId } },
        { fieldPath: 'authorId', op: 'EQUAL', value: { stringValue: targetUserId } }
      ],
      label: 'Friend profile posts',
      hiddenPostResolver,
      pageSize: socialPostLimit,
      visibleLimit: socialPostLimit
    })
    : loadSocialPostQueryPages({
      buildQuery: (cursor) => query(
        collection(db, 'socialPosts'),
        where('visibleUserIds', 'array-contains', viewerId),
        where('authorId', '==', targetUserId),
        where('hidden', '==', false),
        orderBy('createdAt', 'desc'),
        ...(cursor ? [startAfter(cursor)] : []),
        limit(socialPostLimit)
      ),
      label: 'Friend profile posts',
      hiddenPostResolver,
      pageSize: socialPostLimit,
      visibleLimit: socialPostLimit
    })).catch((error) => {
      logger.warn('Unable to load profile posts.', { error, isSelf });
      postsError = 'Recent posts could not load. Try again.';
      return { docs: [], isPartial: true };
    });
  if (postResult.isPartial && !postsError) {
    postsError = 'Recent posts could not load completely. Try again.';
  }
  const sharedTeamIds = isSelf ? [] : uniqueStrings(friendship?.sharedTeamIds || []);
  const publicChildren = publicChildrenDocs.map((child) => ({
    id: child.id,
    name: compactString(child.athlete?.name) || 'Athlete profile',
    headline: compactString(child.athlete?.headline),
    photoUrl: compactString(child.profilePhoto?.url || child.profilePhotoUrl) || null,
    shareUrl: buildAthleteProfileShareUrl(getPublicBaseUrl(), child.id)
  }));
  const posts = sortSocialFeedItems(postResult.docs
    .map(mapSocialPost)
    .filter((post) => !post.hidden));
  const [publicTeams, viewerReactions] = await Promise.all([
    publicTeamsPromise,
    loadViewerSocialPostReactions(posts, viewerId)
  ]);
  if (viewerReactions.failedPostIds.size > 0 && !postsError) {
    postsError = 'Recent post Like status could not load. Try again.';
  }
  const hydratedPosts = posts.map((post) => ({
    ...post,
    viewerHasLiked: viewerReactions.failedPostIds.has(post.id)
      ? undefined
      : viewerReactions.likedPostIds.has(post.id),
    viewerReactionError: viewerReactions.failedPostIds.has(post.id)
  }));

  return {
    userId: targetUserId,
    name: compactString(profile.displayName || profile.fullName) || (isSelf ? getUserDisplayName(user) : '') || hydratedPosts[0]?.authorName || 'ALL PLAYS member',
    photoUrl: compactString(profile.photoUrl) || null,
    sharedTeamNames: isSelf ? [] : uniqueStrings(friendship?.sharedTeamNames || []),
    publicTeams,
    publicChildren,
    messageRoute: isSelf ? null : getFriendMessageRoute({
      status: 'accepted',
      userId: targetUserId,
      name: compactString(profile.displayName || profile.fullName) || hydratedPosts[0]?.authorName || 'Friend',
      sharedTeamIds
    }),
    isSelf,
    posts: hydratedPosts,
    postsError
  };
}

export async function loadFriendships(user: AuthUser): Promise<SocialFriend[]> {
  if (!user?.uid) return [];
  const requestedFriendshipsQuery = query(
    collection(db, 'friendships'),
    where('requesterId', '==', user.uid),
    limit(50)
  );
  const receivedFriendshipsQuery = query(
    collection(db, 'friendships'),
    where('recipientId', '==', user.uid),
    limit(50)
  );
  const snapshots = await withTimeout(Promise.all([
    getDocs(requestedFriendshipsQuery),
    getDocs(receivedFriendshipsQuery)
  ]), 'Friendships');
  const friendshipDocs = new Map<string, FirestoreDoc>();
  snapshots.forEach((snapshot) => {
    snapshotToDocs(snapshot).forEach((friendship) => friendshipDocs.set(friendship.id, friendship));
  });
  // Keep both bounded result sets. Applying a second global limit here could
  // hide incoming requests whenever a user already has 50 outgoing records.
  const friendships = [...friendshipDocs.values()];
  const friendDocs = await Promise.all(friendships.map(async (friendship) => {
    const otherUserId = (friendship.memberIds || []).find((id: string) => id !== user.uid);
    if (!otherUserId) return null;
    const userSnap = await getDoc(doc(db, publicUserProfileCollection, otherUserId)).catch(() => null);
    const userData = userSnap?.exists?.() ? { id: userSnap.id, ...userSnap.data() } : { id: otherUserId };
    return normalizeSocialFriend({
      ...userData,
      sharedTeamIds: friendship.sharedTeamIds || [],
      sharedTeamNames: friendship.sharedTeamNames || []
    }, user.uid, friendship);
  }));
  return friendDocs.filter(Boolean) as SocialFriend[];
}

export async function loadFriendSuggestions(user: AuthUser, home: ParentHomeModel): Promise<SocialFriend[]> {
  const teamIds = getHomeTeamIds(home);
  const teamNames = getHomeTeamNames(home);
  const suggestionsById = new Map<string, SocialFriend>();
  for (const teamId of teamIds.slice(0, 5)) {
    const teamUserQuery = query(
      collection(db, publicUserProfileCollection),
      where('discoveryTeamIds', 'array-contains', teamId),
      limit(12)
    );
    const snapshot = await withTimeout(getDocs(teamUserQuery), `Friend suggestions ${teamId}`).catch(() => null);
    if (!snapshot) continue;
    snapshotToDocs(snapshot).forEach((candidate) => {
      const friend = normalizeSocialFriend({
        ...candidate,
        sharedTeamIds: [teamId],
        sharedTeamNames: [teamNames[teamId] || teamId]
      }, user.uid);
      if (friend && friend.status === 'none') suggestionsById.set(friend.userId, friend);
    });
  }
  return [...suggestionsById.values()].slice(0, friendSuggestionLimit);
}

export async function searchSocialUsers(user: AuthUser | null, queryText: string, home: ParentHomeModel): Promise<SocialFriend[]> {
  if (!user?.uid) return [];
  const normalized = compactString(queryText);
  if (normalized.length < 2) return [];
  const lower = normalizeEmail(normalized);
  const resultsById = new Map<string, SocialFriend>();
  const teamNames = getHomeTeamNames(home);

  if (lower.includes('@')) {
    const emailHash = await hashSocialEmail(lower);
    if (emailHash) {
      const teamIds = getHomeTeamIds(home).slice(0, 10);
      for (const teamId of teamIds) {
        const emailSnapshot = await withTimeout(getDocs(query(
          collection(db, publicUserProfileCollection),
          where('emailHash', '==', emailHash),
          where('discoveryTeamIds', 'array-contains', teamId),
          limit(5)
        )), `Friend email search ${teamId}`).catch(() => null);
        if (emailSnapshot) {
          snapshotToDocs(emailSnapshot).forEach((candidate) => {
            const sharedTeamIds = uniqueStrings((candidate.discoveryTeamIds || []).filter((candidateTeamId: string) => teamNames[candidateTeamId]));
            const friend = normalizeSocialFriend({
              ...candidate,
              sharedTeamIds,
              sharedTeamNames: sharedTeamIds.map((sharedTeamId) => teamNames[sharedTeamId] || sharedTeamId)
            }, user.uid);
            if (friend) resultsById.set(friend.userId, friend);
          });
        }
      }
    }
  }

  const suggestions = await loadFriendSuggestions(user, home).catch(() => []);
  suggestions
    .filter((friend) => `${friend.name} ${friend.email || ''} ${friend.sharedTeamNames.join(' ')}`.toLowerCase().includes(lower))
    .forEach((friend) => resultsById.set(friend.userId, friend));

  return [...resultsById.values()].slice(0, 20);
}

export async function sendFriendRequest(user: AuthUser, friend: SocialFriend) {
  const friendshipId = buildFriendshipId(user.uid, friend.userId);
  if (!friendshipId) throw new Error('Friend request is missing a user.');
  await setDoc(doc(db, 'friendships', friendshipId), {
    requesterId: user.uid,
    recipientId: friend.userId,
    memberIds: [user.uid, friend.userId].sort(),
    status: 'pending',
    sharedTeamIds: friend.sharedTeamIds || [],
    sharedTeamNames: friend.sharedTeamNames || [],
    blockedBy: [],
    // Re-requesting after a prior decline/remove: reset the response so the
    // recipient sees a fresh pending request rather than stale state (#3867).
    respondedAt: null,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  }, { merge: true });
  return friendshipId;
}

export async function respondToFriendRequest(friendshipId: string, status: 'accepted' | 'declined') {
  await updateDoc(doc(db, 'friendships', friendshipId), {
    status,
    respondedAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });
}

export async function removeFriend(friendshipId: string) {
  await updateDoc(doc(db, 'friendships', friendshipId), {
    status: 'removed',
    updatedAt: serverTimestamp()
  });
}

export async function blockFriend(friendshipId: string, userId: string) {
  await updateDoc(doc(db, 'friendships', friendshipId), {
    status: 'blocked',
    blockedBy: [userId],
    updatedAt: serverTimestamp()
  });
}

export async function createSocialPost(user: AuthUser, input: CreateSocialPostInput) {
  const title = compactString(input.title);
  if (!title) throw new Error('Add a title before posting.');
  const visibility = input.visibility || 'team';
  const teamIds = uniqueStrings([input.teamId || '']);
  const visibleUserIds = uniqueStrings([user.uid, ...(input.visibleUserIds || [])]);
  const playerIds = uniqueStrings(input.playerIds || []);
  const playerNames = uniqueStrings(input.playerNames || []);
  const createdAt = Timestamp.now();
  const navigation = normalizeSocialPostNavigationForCreate(input.route, input.href);
  const snapshot = {
    type: input.type,
    title,
    detail: input.detail || '',
    teamId: input.teamId || null,
    teamName: input.teamName || null,
    playerIds,
    playerNames,
    sourceType: input.sourceType || null,
    sourceId: input.sourceId || null,
    route: navigation.route,
    href: navigation.href
  };

  const postData = {
    type: input.type,
    visibility,
    authorId: user.uid,
    authorName: getUserDisplayName(user),
    authorEmail: user.email || null,
    authorPhotoUrl: user.photoUrl || null,
    teamId: input.teamId || null,
    teamName: input.teamName || null,
    teamIds,
    playerIds,
    playerNames,
    sourceType: input.sourceType || null,
    sourceId: input.sourceId || null,
    title,
    detail: input.detail || '',
    caption: input.caption || '',
    media: input.media || [],
    route: navigation.route,
    href: navigation.href,
    visibleUserIds,
    snapshot,
    hidden: false,
    reportCount: 0,
    reactionCounts: {},
    commentCount: 0,
    createdAt,
    updatedAt: createdAt
  };
  const postRef = await addDoc(collection(db, 'socialPosts'), postData);
  return mapSocialPost({ id: postRef.id, ...postData });
}

export async function uploadSocialPostMedia(teamId: string, file: File): Promise<SocialMediaUpload> {
  if (!teamId) {
    throw new Error('Choose a team before adding media.');
  }
  const attachment = await uploadTeamChatAttachment(teamId, file);
  if (!attachment.url) {
    throw new Error('Media upload did not return a usable URL.');
  }
  return {
    type: attachment.type,
    url: attachment.url,
    name: attachment.name || file.name || null,
    thumbnailUrl: attachment.thumbnailUrl || null,
    storagePath: String(attachment.path || '')
  };
}

export async function discardSocialPostMediaUpload(media: SocialMediaUpload | null | undefined) {
  if (!media?.storagePath) return;
  await deleteTeamChatAttachments([{
    type: media.type,
    url: media.url,
    path: media.storagePath,
    name: media.name || null,
    mimeType: null,
    size: null,
    thumbnailUrl: media.thumbnailUrl || null
  }]);
}

export async function reactToSocialPost(postId: string, user: AuthUser, reactionKey = 'like') {
  if (reactionKey !== 'like') {
    throw new Error('This reaction is not supported yet.');
  }
  if (isNativeRuntime()) {
    const result = await callNativeFirebaseFunction<{ liked?: unknown; count?: unknown }>(
      'toggleSocialPostReaction',
      { postId, reactionKey },
      { errorLabel: 'Social reaction' }
    );
    const count = Number(result?.count);
    if (typeof result?.liked !== 'boolean' || !Number.isInteger(count) || count < 0) {
      throw new Error('Social reaction response is invalid.');
    }
    return { liked: result.liked, count };
  }
  const postRef = doc(db, 'socialPosts', postId);
  const reactionRef = doc(db, 'socialPosts', postId, 'reactions', user.uid);
  return runTransaction(db, async (transaction: any) => {
    const [postSnap, reactionSnap] = await Promise.all([
      transaction.get(postRef),
      transaction.get(reactionRef)
    ]);
    if (!postSnap.exists()) {
      throw new Error('This post is no longer available.');
    }
    const post = postSnap.data() || {};
    const currentCount = Math.max(0, Number(post.reactionCounts?.like || 0));
    const liked = !reactionSnap.exists();
    const count = liked ? currentCount + 1 : Math.max(0, currentCount - 1);

    if (liked) {
      transaction.set(reactionRef, {
        userId: user.uid,
        reactionKey,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });
    } else {
      transaction.delete(reactionRef);
    }
    transaction.update(postRef, {
      'reactionCounts.like': count,
      updatedAt: serverTimestamp()
    });
    return { liked, count };
  });
}

export async function commentOnSocialPost(postId: string, user: AuthUser, text: string) {
  const trimmed = compactString(text);
  if (!trimmed) throw new Error('Write a comment first.');
  if (isNativeRuntime()) {
    const result = await callNativeFirebaseFunction<{ commented?: unknown; commentId?: unknown }>(
      'commentOnSocialPostForCaller',
      { postId, text: trimmed },
      { errorLabel: 'Social comment' }
    );
    if (result?.commented !== true || typeof result?.commentId !== 'string' || !result.commentId) {
      throw new Error('Social comment response is invalid.');
    }
    return;
  }
  await addDoc(collection(db, 'socialPosts', postId, 'comments'), {
    text: trimmed,
    authorId: user.uid,
    authorName: getUserDisplayName(user),
    authorPhotoUrl: user.photoUrl || null,
    hidden: false,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });
}

export async function reportSocialPost(postId: string, user: AuthUser, reason = 'Reported from app') {
  if (isNativeRuntime()) {
    const result = await callNativeFirebaseFunction<{ reported?: unknown; reportId?: unknown }>(
      'reportSocialPostForCaller',
      { postId, reason },
      { errorLabel: 'Social report' }
    );
    if (result?.reported !== true || typeof result?.reportId !== 'string' || !result.reportId) {
      throw new Error('Social report response is invalid.');
    }
    return;
  }
  await addDoc(collection(db, 'socialReports'), {
    postId,
    reporterId: user.uid,
    reason,
    status: 'open',
    createdAt: serverTimestamp()
  });
}

export async function hideSocialPost(postId: string, user: AuthUser) {
  if (isNativeRuntime()) {
    const result = await callNativeFirebaseFunction<{ hidden?: unknown }>(
      'hideSocialPostForCaller',
      { postId },
      { errorLabel: 'Hide social post' }
    );
    if (result?.hidden !== true) throw new Error('Hide social post response is invalid.');
    return;
  }
  await setDoc(doc(db, 'users', user.uid, 'hiddenSocialPosts', postId), {
    postId,
    hiddenAt: serverTimestamp()
  });
}
