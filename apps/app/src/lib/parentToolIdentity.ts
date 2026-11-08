import type { AuthState } from './types';

// Keep retained tool state inside the current Auth principal's lifetime.
export function getParentToolIdentity(auth: AuthState): string {
    return JSON.stringify([auth.user?.uid ?? null, auth.user?.email ?? null, auth.user?.emailVerified === true]);
}
