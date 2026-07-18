import { functions, httpsCallable } from './adapters/legacyFriendMessage';
import type { AuthUser } from './types';

const friendshipLookupTimeoutMs = 5000;

function normalizeUserId(value: unknown) {
  const normalized = String(value || '').trim();
  const userId = normalized.toLowerCase().startsWith('user:') ? normalized.slice(5).trim() : normalized;
  return /^[A-Za-z0-9_-]{1,160}$/.test(userId) ? userId : '';
}

function withFriendshipLookupTimeout<T>(promise: Promise<T>, timeoutMs = friendshipLookupTimeoutMs) {
  let timeoutId: ReturnType<typeof globalThis.setTimeout> | undefined;
  const timeout = new Promise<T>((_, reject) => {
    timeoutId = globalThis.setTimeout(() => reject(new Error('Friend connection check timed out.')), timeoutMs);
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

export async function sendAuthorizedDirectMessage(input: {
  teamId: string;
  conversationId: string;
  clientMessageId?: string | null;
  text: string;
  attachments: Array<Record<string, unknown>>;
}) {
  const callable = httpsCallable(functions, 'sendAuthorizedDirectMessage');
  const response = await withFriendshipLookupTimeout(callable(input), 10000);
  return response?.data;
}
