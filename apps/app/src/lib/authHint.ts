/**
 * Lightweight, persisted hint that the user was signed in on the last session
 * (#2038). On boot, protected routes can optimistically render the app shell +
 * skeleton for a returning user instead of holding a blocking spinner while
 * Firebase auth resolves from IndexedDB — and only redirect to /auth once auth
 * actually resolves signed-out. The hint stores no sensitive data, just a uid.
 */
const storageKey = 'allplays:auth-hint';

export type AuthHint = { uid: string };

function getStorage(): Storage | null {
  if (typeof window === 'undefined') return null;
  try {
    const storage = window.localStorage;
    if (!storage || typeof storage.getItem !== 'function') return null;
    return storage;
  } catch {
    return null;
  }
}

export function readAuthHint(): AuthHint | null {
  const storage = getStorage();
  if (!storage) return null;
  try {
    const raw = storage.getItem(storageKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<AuthHint> | null;
    const uid = parsed && typeof parsed.uid === 'string' ? parsed.uid.trim() : '';
    return uid ? { uid } : null;
  } catch {
    return null;
  }
}

export function hasAuthHint(): boolean {
  return readAuthHint() !== null;
}

export function writeAuthHint(uid: string) {
  const storage = getStorage();
  if (!storage || !uid) return;
  try {
    storage.setItem(storageKey, JSON.stringify({ uid }));
  } catch {
    // Best-effort: a full/disabled storage just means no optimistic boot.
  }
}

export function clearAuthHint() {
  const storage = getStorage();
  if (!storage) return;
  try {
    storage.removeItem(storageKey);
  } catch {
    // ignore
  }
}
