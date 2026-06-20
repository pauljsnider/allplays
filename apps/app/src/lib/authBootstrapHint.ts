import type { AuthUser } from './types';

const authBootstrapHintKey = 'allplays:auth-bootstrap-hint:v1';

export type AuthBootstrapHint = {
  uid: string;
  email?: string | null;
  roles: string[];
  updatedAt: number;
};

function canUseStorage() {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

export function readAuthBootstrapHint(): AuthBootstrapHint | null {
  if (!canUseStorage()) return null;
  try {
    const raw = window.localStorage.getItem(authBootstrapHintKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<AuthBootstrapHint>;
    if (!parsed.uid || typeof parsed.uid !== 'string') return null;
    return {
      uid: parsed.uid,
      email: typeof parsed.email === 'string' ? parsed.email : null,
      roles: Array.isArray(parsed.roles) ? parsed.roles.filter((role): role is string => typeof role === 'string') : [],
      updatedAt: typeof parsed.updatedAt === 'number' ? parsed.updatedAt : 0
    };
  } catch {
    return null;
  }
}

export function writeAuthBootstrapHint(user: AuthUser | null) {
  if (!canUseStorage()) return;
  if (!user?.uid) {
    clearAuthBootstrapHint();
    return;
  }
  try {
    window.localStorage.setItem(authBootstrapHintKey, JSON.stringify({
      uid: user.uid,
      email: user.email || null,
      roles: Array.isArray(user.roles) ? user.roles : [],
      updatedAt: Date.now()
    }));
  } catch {
    // Storage is best-effort only; auth itself remains Firebase-backed.
  }
}

export function clearAuthBootstrapHint() {
  if (!canUseStorage()) return;
  try {
    window.localStorage.removeItem(authBootstrapHintKey);
  } catch {
    // Ignore storage failures.
  }
}
