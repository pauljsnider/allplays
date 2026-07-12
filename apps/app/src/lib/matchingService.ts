import {
  addDoc,
  collection,
  db,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where
} from './adapters/legacySocialDb';
import { createLogger } from './logger';
import type { ParentHomeModel } from './homeLogic';
import type { AuthUser } from './types';
import type { SocialFeedItem } from './socialLogic';
import {
  buildMatchingDetails,
  buildMatchingSummary,
  buildMatchingTitle,
  containsContactInfo,
  getMatchingExpiryDate,
  getMatchingKindLabel,
  isMatchingPostOpen,
  matchingPostToFeedItem,
  MATCHING_RESPONSE_MAX_LENGTH,
  normalizeMatchingPost,
  selectRelevantMatchingPosts,
  sortMatchingPosts,
  type MatchingPost,
  type MatchingPostDraft,
  type MatchingPostStatus,
  type MatchingResponse
} from './matchingLogic';
import { toSocialDate } from './socialLogic';

const logger = createLogger('matching-service');
const openMatchingPostLimit = 100;
const myMatchingPostLimit = 50;
const matchingTimeoutMs = 5000;

type FirestoreDoc = Record<string, any> & { id: string };

function withTimeout<T>(promise: Promise<T>, label: string, timeoutMs = matchingTimeoutMs): Promise<T> {
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

function compact(value: unknown): string {
  return String(value ?? '').trim();
}

function getUserDisplayName(user: AuthUser | null, fallback = 'ALL PLAYS user') {
  return compact(user?.displayName) || fallback;
}

function sanitizeProfilePhotoUrl(value: unknown): string | null {
  const url = compact(value);
  if (!url) return null;
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.toLowerCase();
    const allowedHosts = [
      'allplays.ai',
      'firebasestorage.googleapis.com',
      'storage.googleapis.com',
      'lh3.googleusercontent.com',
      'lh4.googleusercontent.com',
      'lh5.googleusercontent.com',
      'lh6.googleusercontent.com'
    ];
    if (parsed.protocol !== 'https:' || !allowedHosts.includes(hostname)) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

export async function createMatchingPost(user: AuthUser, draft: MatchingPostDraft): Promise<string> {
  if (!user?.uid) throw new Error('Sign in to create a post.');
  const details = buildMatchingDetails(draft);
  const teamId = details.kind === 'team_seeking_players' ? compact(draft.teamId) : '';
  const teamName = details.kind === 'team_seeking_players' ? compact(draft.teamName) : '';
  const title = buildMatchingTitle(details, teamName);
  const now = new Date();
  const createdAt = Timestamp.now();

  // Community docs deliberately omit authorEmail and roster/player IDs (requirements 1.3.3, 1.5, 5.1).
  const postRef = await addDoc(collection(db, 'socialPosts'), {
    type: details.kind,
    visibility: 'community',
    status: 'open',
    authorId: user.uid,
    authorName: getUserDisplayName(user),
    authorPhotoUrl: sanitizeProfilePhotoUrl(user.photoUrl),
    teamId: teamId || null,
    teamName: teamName || null,
    teamIds: teamId ? [teamId] : [],
    playerIds: [],
    playerNames: details.playerFirstName ? [details.playerFirstName] : [],
    title,
    detail: buildMatchingSummary(details),
    caption: compact(draft.description),
    media: [],
    matching: details,
    visibleUserIds: [user.uid],
    expiresAt: Timestamp.fromDate(getMatchingExpiryDate(now)),
    hidden: false,
    reportCount: 0,
    reactionCounts: {},
    commentCount: 0,
    createdAt,
    updatedAt: createdAt
  });
  return postRef.id;
}

export async function loadOpenMatchingPosts(): Promise<MatchingPost[]> {
  const openQuery = query(
    collection(db, 'socialPosts'),
    where('visibility', '==', 'community'),
    where('status', '==', 'open'),
    where('hidden', '==', false),
    limit(openMatchingPostLimit)
  );
  const snapshot = await withTimeout(getDocs(openQuery), 'Opportunities feed');
  const now = new Date();
  return sortMatchingPosts(
    snapshotToDocs(snapshot)
      .map(normalizeMatchingPost)
      .filter((post): post is MatchingPost => Boolean(post))
      .filter((post) => isMatchingPostOpen(post, now))
  );
}

export async function loadMyMatchingPosts(user: AuthUser): Promise<MatchingPost[]> {
  if (!user?.uid) return [];
  const mineQuery = query(
    collection(db, 'socialPosts'),
    where('authorId', '==', user.uid),
    where('visibility', '==', 'community'),
    where('hidden', '==', false),
    limit(myMatchingPostLimit)
  );
  const snapshot = await withTimeout(getDocs(mineQuery), 'My opportunities');
  return sortMatchingPosts(
    snapshotToDocs(snapshot)
      .map(normalizeMatchingPost)
      .filter((post): post is MatchingPost => Boolean(post))
  );
}

/**
 * Home-feed integration (requirement 2.1): best-effort, bounded, never throws.
 */
export async function loadRelevantMatchingFeedItems(user: AuthUser, home: ParentHomeModel): Promise<SocialFeedItem[]> {
  try {
    const posts = await loadOpenMatchingPosts();
    return selectRelevantMatchingPosts(posts, home, user.uid).map(matchingPostToFeedItem);
  } catch (error) {
    logger.warn('Unable to load matching posts for the home feed.', { error });
    return [];
  }
}

export async function setMatchingPostStatus(postId: string, status: MatchingPostStatus): Promise<void> {
  await updateDoc(doc(db, 'socialPosts', postId), {
    status,
    updatedAt: serverTimestamp()
  });
}

export type RespondToMatchingPostInput = {
  message: string;
  teamId?: string | null;
  teamName?: string | null;
};

export async function respondToMatchingPost(user: AuthUser, post: MatchingPost, input: RespondToMatchingPostInput): Promise<void> {
  if (!user?.uid) throw new Error('Sign in to respond.');
  if (post.authorId === user.uid) throw new Error('This is your own post.');
  if (!isMatchingPostOpen(post)) throw new Error('This post is no longer open.');
  const message = compact(input.message);
  if (!message) throw new Error('Write a short message first.');
  if (message.length > MATCHING_RESPONSE_MAX_LENGTH) {
    throw new Error(`Keep your message under ${MATCHING_RESPONSE_MAX_LENGTH} characters.`);
  }
  if (containsContactInfo(message)) {
    throw new Error('Remove emails and phone numbers — the poster can follow up in the app.');
  }
  if (post.kind === 'player_seeking_team' && (!compact(input.teamId) || !compact(input.teamName))) {
    throw new Error('Choose the team you manage before responding.');
  }

  // One response per user per post (requirement 3.6): the doc id is the responder uid.
  await setDoc(doc(db, 'socialPosts', post.id, 'responses', user.uid), {
    responderId: user.uid,
    responderName: getUserDisplayName(user),
    responderPhotoUrl: sanitizeProfilePhotoUrl(user.photoUrl),
    teamId: compact(input.teamId) || null,
    teamName: compact(input.teamName) || null,
    message,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  }, { merge: true });

  try {
    await addDoc(collection(db, `users/${post.authorId}/notificationInbox`), {
      category: 'matching_response',
      title: `New response: ${getMatchingKindLabel(post.kind)}`,
      body: `${getUserDisplayName(user)} responded to "${post.title}".`,
      appRoute: '/opportunities?view=mine',
      postId: post.id,
      fromUserId: user.uid,
      createdAt: serverTimestamp(),
      readAt: null
    });
  } catch (error) {
    // The response itself succeeded; the inbox item is best-effort.
    logger.warn('Unable to create the matching response notification.', { error });
  }
}

export async function loadMyMatchingResponse(user: AuthUser, postId: string): Promise<MatchingResponse | null> {
  if (!user?.uid) return null;
  const snapshot = await getDoc(doc(db, 'socialPosts', postId, 'responses', user.uid)).catch(() => null);
  if (!snapshot?.exists?.()) return null;
  return mapMatchingResponse({ id: snapshot.id, ...snapshot.data() });
}

export async function loadMatchingResponses(postId: string): Promise<MatchingResponse[]> {
  const snapshot = await withTimeout(getDocs(collection(db, 'socialPosts', postId, 'responses')), 'Post responses');
  return snapshotToDocs(snapshot)
    .map(mapMatchingResponse)
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}

export async function dismissMatchingResponse(postId: string, responderId: string): Promise<void> {
  await deleteDoc(doc(db, 'socialPosts', postId, 'responses', responderId));
}

function mapMatchingResponse(docData: FirestoreDoc): MatchingResponse {
  return {
    id: docData.id,
    responderId: compact(docData.responderId) || docData.id,
    responderName: compact(docData.responderName) || 'ALL PLAYS user',
    responderPhotoUrl: docData.responderPhotoUrl || null,
    teamId: docData.teamId || null,
    teamName: docData.teamName || null,
    message: compact(docData.message),
    createdAt: toSocialDate(docData.createdAt)
  };
}
