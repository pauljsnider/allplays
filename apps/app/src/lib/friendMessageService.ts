import { functions, httpsCallable } from './adapters/legacyFriendMessage';
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

export async function canMessageAcceptedFriend(user: AuthUser, recipientId: string, teamId: string) {
  const currentUserId = normalizeUserId(user?.uid);
  const friendUserId = normalizeUserId(recipientId);
  const sharedTeamId = String(teamId || '').trim();
  if (!currentUserId || !friendUserId || currentUserId === friendUserId || !sharedTeamId) return false;
  const callable = httpsCallable(functions, 'checkAcceptedFriendMessageAccess');
  const response = await withFriendshipLookupTimeout(callable({
    recipientId: friendUserId,
    teamId: sharedTeamId
  }));
  return response?.data?.allowed === true;
}
