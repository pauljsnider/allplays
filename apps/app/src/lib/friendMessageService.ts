import { db, doc, getDoc } from './adapters/legacySocialDb';
import { buildFriendshipId } from './socialLogic';
import type { AuthUser } from './types';

const friendshipLookupTimeoutMs = 5000;

function normalizeUserId(value: unknown) {
  const normalized = String(value || '').trim();
  const userId = normalized.toLowerCase().startsWith('user:') ? normalized.slice(5).trim() : normalized;
  return /^[A-Za-z0-9_-]{1,160}$/.test(userId) ? userId : '';
}

function withFriendshipLookupTimeout<T>(promise: Promise<T>) {
  let timeoutId: ReturnType<typeof globalThis.setTimeout> | undefined;
  const timeout = new Promise<T>((_, reject) => {
    timeoutId = globalThis.setTimeout(() => reject(new Error('Friend connection check timed out.')), friendshipLookupTimeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timeoutId !== undefined) globalThis.clearTimeout(timeoutId);
  });
}

function hasCurrentTeamMembership(userId: string, teamId: string, publicProfile: Record<string, any>, team: Record<string, any>) {
  const discoveryTeamIds = new Set((Array.isArray(publicProfile.discoveryTeamIds) ? publicProfile.discoveryTeamIds : [])
    .map((id: unknown) => String(id || '').trim())
    .filter(Boolean));
  const memberIds = new Set([
    ...(Array.isArray(team.chatMemberIds) ? team.chatMemberIds : []),
    ...(Array.isArray(team.adminUserIds) ? team.adminUserIds : [])
  ].map((id: unknown) => String(id || '').trim()).filter(Boolean));
  return discoveryTeamIds.has(teamId)
    || String(team.ownerId || '').trim() === userId
    || memberIds.has(userId)
    || memberIds.has(`user:${userId}`);
}

export async function canMessageAcceptedFriend(user: AuthUser, recipientId: string, teamId: string) {
  const currentUserId = normalizeUserId(user?.uid);
  const friendUserId = normalizeUserId(recipientId);
  const sharedTeamId = String(teamId || '').trim();
  if (!currentUserId || !friendUserId || currentUserId === friendUserId || !sharedTeamId) return false;

  const friendshipId = buildFriendshipId(currentUserId, friendUserId);
  if (!friendshipId) return false;
  const [snapshot, publicProfileSnapshot, teamSnapshot] = await withFriendshipLookupTimeout(Promise.all([
    getDoc(doc(db, 'friendships', friendshipId)),
    getDoc(doc(db, 'publicUserProfiles', friendUserId)).catch(() => null),
    getDoc(doc(db, 'teams', sharedTeamId)).catch(() => null)
  ]));
  if (!snapshot?.exists?.()) return false;

  const friendship = snapshot.data() || {};
  const publicProfile = publicProfileSnapshot?.exists?.() ? publicProfileSnapshot.data() || {} : {};
  const team = teamSnapshot?.exists?.() ? teamSnapshot.data() || {} : {};
  const memberIds = new Set((Array.isArray(friendship.memberIds) ? friendship.memberIds : [])
    .map(normalizeUserId)
    .filter(Boolean));
  const sharedTeamIds = new Set((Array.isArray(friendship.sharedTeamIds) ? friendship.sharedTeamIds : [])
    .map((id: unknown) => String(id || '').trim())
    .filter(Boolean));
  return friendship.status === 'accepted'
    && memberIds.size === 2
    && memberIds.has(currentUserId)
    && memberIds.has(friendUserId)
    && sharedTeamIds.has(sharedTeamId)
    && hasCurrentTeamMembership(friendUserId, sharedTeamId, publicProfile, team);
}
