import type { AuthUser } from './types';

const authBootstrapHintKey = 'allplays:auth-bootstrap-hint:v1';

export type AuthBootstrapHint = {
  uid: string;
  email?: string | null;
  roles: string[];
  updatedAt: number;
};

export function readAuthBootstrapHint(): AuthBootstrapHint | null {
  if (typeof window === 'undefined') return null;
  try {
    const storage = window.localStorage;
    if (typeof storage === 'undefined') return null;
    const raw = storage.getItem(authBootstrapHintKey);
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
  if (typeof window === 'undefined') return;
  if (!user?.uid) {
    clearAuthBootstrapHint();
    return;
  }
  try {
    const storage = window.localStorage;
    if (typeof storage === 'undefined') return;
    storage.setItem(authBootstrapHintKey, JSON.stringify({
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
  if (typeof window === 'undefined') return;
  try {
    const storage = window.localStorage;
    if (typeof storage === 'undefined') return;
    storage.removeItem(authBootstrapHintKey);
  } catch {
    // Ignore storage failures.
  }
}
