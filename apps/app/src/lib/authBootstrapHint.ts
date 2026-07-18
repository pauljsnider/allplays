import type { AuthUser } from './types';

const authBootstrapHintKey = 'allplays:auth-bootstrap-hint:v2';
const legacyAuthBootstrapHintKey = 'allplays:auth-bootstrap-hint:v1';
const authBootstrapHintMaxAgeMs = 5 * 60 * 1000;

export type AuthBootstrapHint = {
  authenticatedRecently: true;
  updatedAt: number;
};

/**
 * This hint may suppress a route flash while Firebase restores its session. It
 * intentionally contains no uid, email, role, or privilege data and is never
 * sufficient to enter a protected route.
 */
export function readAuthBootstrapHint(): AuthBootstrapHint | null {
  if (typeof window === 'undefined') return null;
  try {
    const storage = window.localStorage;
    if (typeof storage === 'undefined') return null;
    storage.removeItem(legacyAuthBootstrapHintKey);
    const raw = storage.getItem(authBootstrapHintKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<AuthBootstrapHint>;
    if (
      parsed.authenticatedRecently !== true
      || typeof parsed.updatedAt !== 'number'
      || parsed.updatedAt + authBootstrapHintMaxAgeMs <= Date.now()
    ) {
      storage.removeItem(authBootstrapHintKey);
      return null;
    }
    return {
      authenticatedRecently: true,
      updatedAt: parsed.updatedAt
    };
  } catch {
    return null;
  }
}

export function writeAuthBootstrapHint(user: AuthUser | null) {
  if (typeof window === 'undefined') return;
  if (!user?.uid) {
    clearAuthBootstrapHint();
    return;
  }
  try {
    const storage = window.localStorage;
    if (typeof storage === 'undefined') return;
    storage.removeItem(legacyAuthBootstrapHintKey);
    storage.setItem(authBootstrapHintKey, JSON.stringify({
      authenticatedRecently: true,
      updatedAt: Date.now()
    } satisfies AuthBootstrapHint));
  } catch {
    // Storage is best-effort only; auth itself remains Firebase-backed.
  }
}

export function clearAuthBootstrapHint() {
  if (typeof window === 'undefined') return;
  try {
    const storage = window.localStorage;
    if (typeof storage === 'undefined') return;
    storage.removeItem(authBootstrapHintKey);
    storage.removeItem(legacyAuthBootstrapHintKey);
  } catch {
    // Ignore storage failures.
  }
}
