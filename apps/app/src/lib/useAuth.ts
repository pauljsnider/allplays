import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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

function observeFirebaseUserOnce() {
  return new Promise<any>((resolve) => {
    let unsubscribe: (() => void) | null = null;
    let unsubscribeAfterRegistration = false;
    let settled = false;
    const registeredUnsubscribe = observeFirebaseUser((firebaseUser) => {
      if (settled) return;
      settled = true;
      if (unsubscribe) {
        unsubscribe();
      } else {
        // Firebase observers may invoke synchronously during registration.
        unsubscribeAfterRegistration = true;
      }
      resolve(firebaseUser);
    });
    unsubscribe = registeredUnsubscribe;
    if (unsubscribeAfterRegistration) {
      registeredUnsubscribe();
    }
  });
}

export function useAuth(): AuthState {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [profile, setProfile] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const authGenerationRef = useRef(0);
  const latestObservedUidRef = useRef<string | null | undefined>(undefined);
  const mountedRef = useRef(false);

  const beginAuthTransition = useCallback((uid: string | null | undefined) => {
    const generation = authGenerationRef.current + 1;
    authGenerationRef.current = generation;
    latestObservedUidRef.current = uid;
    return generation;
  }, []);

  const isCurrentAuthTransition = useCallback(
    (generation: number, uid: string | null) =>
      mountedRef.current && authGenerationRef.current === generation && latestObservedUidRef.current === uid,
    []
  );

  const applyFirebaseUser = useCallback(
    async (firebaseUser: any, generation: number) => {
      const expectedUid = firebaseUser?.uid ?? null;
      if (!isCurrentAuthTransition(generation, expectedUid)) return null;

      setLoading(true);
      setError(null);

      if (!firebaseUser) {
        setUser(null);
        setProfile(null);
        clearAuthBootstrapHint();
        setLoading(false);
        return null;
      }

      try {
        const hydrated = await hydrateFirebaseUser(firebaseUser);
        if (!isCurrentAuthTransition(generation, expectedUid)) return null;
        if (hydrated.user.uid !== expectedUid) {
          setError('Unable to load account profile.');
          setUser(null);
          setProfile(null);
          clearAuthBootstrapHint();
          return null;
        }
        setUser(hydrated.user);
        setProfile(hydrated.profile);
        writeAuthBootstrapHint(hydrated.user);
        return hydrated.user;
      } catch (hydrateError: any) {
        if (!isCurrentAuthTransition(generation, expectedUid)) return null;
        setError(hydrateError?.message || 'Unable to load account profile.');
        setUser(null);
        setProfile(null);
        clearAuthBootstrapHint();
        return null;
      } finally {
        if (isCurrentAuthTransition(generation, expectedUid)) {
          setLoading(false);
        }
      }
    },
    [isCurrentAuthTransition]
  );

  const refresh = useCallback(async () => {
    const generation = beginAuthTransition(undefined);
    if (!mountedRef.current) return null;
    setLoading(true);
    setError(null);

    const currentUser = await observeFirebaseUserOnce();
    if (!mountedRef.current || authGenerationRef.current !== generation) return null;
    latestObservedUidRef.current = currentUser?.uid ?? null;
    return applyFirebaseUser(currentUser, generation);
  }, [applyFirebaseUser, beginAuthTransition]);

  useEffect(() => {
    mountedRef.current = true;
    const unsubscribe = observeFirebaseUser((firebaseUser) => {
      const generation = beginAuthTransition(firebaseUser?.uid ?? null);
      void applyFirebaseUser(firebaseUser, generation);
    });

    return () => {
      mountedRef.current = false;
      authGenerationRef.current += 1;
      latestObservedUidRef.current = undefined;
      unsubscribe();
    };
  }, [applyFirebaseUser, beginAuthTransition]);

  const signOutAndClear = useCallback(async () => {
    const generation = beginAuthTransition(null);
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
      if (isCurrentAuthTransition(generation, null)) {
        setUser(null);
        setProfile(null);
        clearAuthBootstrapHint();
        setLoading(false);
      }
    }
  }, [beginAuthTransition, isCurrentAuthTransition]);

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
