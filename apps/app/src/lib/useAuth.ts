import { useCallback, useEffect, useMemo, useState } from 'react';
import type { AuthState, AuthUser, ProfileHydrationStatus } from './types';
import { clearAuthBootstrapHint, writeAuthBootstrapHint } from './authBootstrapHint';
import { hydrateFirebaseUser, observeFirebaseUser, signOut } from './authService';
import { createLogger } from './logger';

const logger = createLogger('app-auth');

type PerUserCacheResetLoader = () => Promise<() => void>;

const perUserCacheResetLoaders: PerUserCacheResetLoader[] = [
  async () => (await import('./searchService')).resetAppSearchCache,
  async () => (await import('./chatService')).resetChatAiModel,
  async () => (await import('./gameWrapupService')).resetGameWrapupAiModel,
  async () => (await import('./privateAiService')).resetPrivateAiModel,
  async () => (await import('./gameDayLineupBuilder')).resetLineupAiModel
];

export async function clearPerUserCaches(
  loaders: PerUserCacheResetLoader[] = perUserCacheResetLoaders
) {
  // These module-level caches key on the signed-in user (search results, help
  // roles) or hold generative-model handles tied to the session's Firebase
  // app. Without this, a second user signing in on the same tab/device could
  // briefly see the previous user's cached search results.
  const results = await Promise.allSettled(loaders.map(async (loadReset) => {
    const reset = await loadReset();
    reset();
  }));
  const failures = results
    .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
    .map((result) => result.reason);
  if (failures.length > 0) {
    const cleanupError = new Error('One or more per-user caches could not be reset.');
    Object.assign(cleanupError, { failures });
    throw cleanupError;
  }
}

export function useAuth(): AuthState {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [profile, setProfile] = useState<Record<string, unknown> | null>(null);
  const [profileHydration, setProfileHydration] = useState<ProfileHydrationStatus | null>(null);
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
      setProfileHydration(null);
      clearAuthBootstrapHint();
      setLoading(false);
      return null;
    }

    try {
      const hydrated = await hydrateFirebaseUser(currentUser);
      setUser(hydrated.user);
      setProfile(hydrated.profile);
      setProfileHydration(hydrated.profileHydration);
      writeAuthBootstrapHint(hydrated.user);
      return hydrated.user;
    } catch (hydrateError: any) {
      setError(hydrateError?.message || 'Unable to load account profile.');
      setUser(null);
      setProfile(null);
      setProfileHydration(null);
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
        setProfileHydration(null);
        clearAuthBootstrapHint();
        setLoading(false);
        return;
      }

      try {
        const hydrated = await hydrateFirebaseUser(firebaseUser);
        setUser(hydrated.user);
        setProfile(hydrated.profile);
        setProfileHydration(hydrated.profileHydration);
        writeAuthBootstrapHint(hydrated.user);
      } catch (hydrateError: any) {
        setError(hydrateError?.message || 'Unable to load account profile.');
        setUser(null);
        setProfile(null);
        setProfileHydration(null);
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
    const cacheCleanup = clearPerUserCaches();
    setUser(null);
    setProfile(null);
    setProfileHydration(null);
    clearAuthBootstrapHint();
    setLoading(false);
    try {
      const [signOutResult, cacheCleanupResult] = await Promise.allSettled([
        cleanup,
        cacheCleanup
      ]);
      if (cacheCleanupResult.status === 'rejected') {
        logger.warn('Per-user cache cleanup did not complete cleanly.', {
          error: cacheCleanupResult.reason
        });
      }
      if (signOutResult.status === 'rejected') {
        logger.warn('Sign-out cleanup did not complete cleanly.', {
          error: signOutResult.reason
        });
      }
    } catch (signOutError: any) {
      logger.warn('Sign-out cleanup did not complete cleanly.', { error: signOutError });
    } finally {
      setUser(null);
      setProfile(null);
      setProfileHydration(null);
      clearAuthBootstrapHint();
      setLoading(false);
    }
  }, []);

  return useMemo<AuthState>(() => {
    const roles = user?.roles || [];
    return {
      user,
      profile,
      profileHydration,
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
  }, [error, loading, profile, profileHydration, refresh, signOutAndClear, user]);
}
