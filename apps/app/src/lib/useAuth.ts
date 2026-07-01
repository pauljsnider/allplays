import { useCallback, useEffect, useMemo, useState } from 'react';
import type { AuthState, AuthUser } from './types';
import { clearAuthBootstrapHint, writeAuthBootstrapHint } from './authBootstrapHint';
import { hydrateFirebaseUser, observeFirebaseUser, signOut } from './authService';
import { createLogger } from './logger';
import { resetChatAiModel } from './chatService';
import { resetGameWrapupAiModel } from './gameWrapupService';
import { resetLineupAiModel } from './gameDayLineupBuilder';
import { resetPrivateAiModel } from './privateAiService';
import { resetAppSearchCache } from './searchService';

const logger = createLogger('app-auth');

function clearPerUserCaches() {
  // These module-level caches key on the signed-in user (search results, help
  // roles) or hold generative-model handles tied to the session's Firebase
  // app. Without this, a second user signing in on the same tab/device could
  // briefly see the previous user's cached search results.
  resetAppSearchCache();
  resetChatAiModel();
  resetGameWrapupAiModel();
  resetPrivateAiModel();
  resetLineupAiModel();
}

export function useAuth(): AuthState {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [profile, setProfile] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);

    const currentUser = await new Promise<any>((resolve) => {
      let unsubscribe: () => void = () => undefined;
      unsubscribe = observeFirebaseUser((firebaseUser) => {
        unsubscribe();
        resolve(firebaseUser);
      });
    });

    if (!currentUser) {
      setUser(null);
      setProfile(null);
      clearAuthBootstrapHint();
      setLoading(false);
      return null;
    }

    try {
      const hydrated = await hydrateFirebaseUser(currentUser);
      setUser(hydrated.user);
      setProfile(hydrated.profile);
      writeAuthBootstrapHint(hydrated.user);
      return hydrated.user;
    } catch (hydrateError: any) {
      setError(hydrateError?.message || 'Unable to load account profile.');
      setUser(null);
      setProfile(null);
      clearAuthBootstrapHint();
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const unsubscribe = observeFirebaseUser(async (firebaseUser) => {
      setLoading(true);
      setError(null);

      if (!firebaseUser) {
        setUser(null);
        setProfile(null);
        clearAuthBootstrapHint();
        setLoading(false);
        return;
      }

      try {
        const hydrated = await hydrateFirebaseUser(firebaseUser);
        setUser(hydrated.user);
        setProfile(hydrated.profile);
        writeAuthBootstrapHint(hydrated.user);
      } catch (hydrateError: any) {
        setError(hydrateError?.message || 'Unable to load account profile.');
        setUser(null);
        setProfile(null);
        clearAuthBootstrapHint();
      } finally {
        setLoading(false);
      }
    });

    return unsubscribe;
  }, []);

  const signOutAndClear = useCallback(async () => {
    setError(null);
    const cleanup = signOut();
    setUser(null);
    setProfile(null);
    clearAuthBootstrapHint();
    clearPerUserCaches();
    setLoading(false);
    try {
      await cleanup;
    } catch (signOutError: any) {
      logger.warn('Sign-out cleanup did not complete cleanly.', { error: signOutError });
    } finally {
      setUser(null);
      setProfile(null);
      clearAuthBootstrapHint();
      setLoading(false);
    }
  }, []);

  return useMemo<AuthState>(() => {
    const roles = user?.roles || [];
    return {
      user,
      profile,
      loading,
      error,
      roles,
      isParent: roles.includes('parent'),
      isCoach: roles.includes('coach'),
      isAdmin: roles.includes('admin') || roles.includes('platformAdmin') || user?.isAdmin === true,
      isPlatformAdmin: roles.includes('platformAdmin'),
      refresh,
      signOut: signOutAndClear
    };
  }, [error, loading, profile, refresh, signOutAndClear, user]);
}
