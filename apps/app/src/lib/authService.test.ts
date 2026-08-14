// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const authState = vi.hoisted(() => ({
  currentUser: null,
  app: {
    options: {
      apiKey: 'test-api-key',
      projectId: 'allplays-test'
    },
    name: '[DEFAULT]'
  }
}));

const legacyAuthMocks = vi.hoisted(() => ({
  getUserProfile: vi.fn(),
  listMyParentMembershipRequests: vi.fn(),
  updateUserProfile: vi.fn(),
  getUserTeams: vi.fn(),
  validateAccessCode: vi.fn(),
  redeemParentInvite: vi.fn(),
  redeemFriendInvite: vi.fn(),
  redeemHouseholdInvite: vi.fn(),
  redeemCoParentInvite: vi.fn(),
  markAccessCodeAsUsed: vi.fn(),
  rollbackParentInviteRedemption: vi.fn(),
  getTeam: vi.fn()
}));

const legacyAdminInviteMocks = vi.hoisted(() => ({
  redeemAdminInviteAcceptance: vi.fn()
}));

const legacySignupFlowMocks = vi.hoisted(() => ({
  executeEmailPasswordSignup: vi.fn()
}));

const legacyInviteFlowMocks = vi.hoisted(() => ({
  processInvite: vi.fn(),
  createInviteProcessor: vi.fn()
}));

const legacyAuthEmailMocks = vi.hoisted(() => ({
  queueCurrentUserVerificationEmail: vi.fn(),
  queueInviteSignInEmail: vi.fn(),
  queuePasswordResetEmail: vi.fn()
}));

const parentMembershipMocks = vi.hoisted(() => ({
  mergeApprovedParentMembershipRequests: vi.fn()
}));

const appDataCacheMocks = vi.hoisted(() => ({
  clearAppDataCache: vi.fn()
}));

const authObserverMocks = vi.hoisted(() => ({
  onAuthStateChanged: vi.fn()
}));

const webAuthRuntimeMocks = vi.hoisted(() => ({
  signInWithCustomToken: vi.fn(),
  signOut: vi.fn()
}));

const nativeCallableMocks = vi.hoisted(() => ({
  callNativeFirebaseFunctionWithAuth: vi.fn()
}));

const nativeAuthenticationMocks = vi.hoisted(() => ({
  addListener: vi.fn(),
  applyActionCode: vi.fn(),
  createUserWithEmailAndPassword: vi.fn(),
  getCurrentUser: vi.fn(),
  getIdToken: vi.fn(),
  reload: vi.fn(),
  revokeAccessToken: vi.fn(),
  sendEmailVerification: vi.fn(),
  signInWithApple: vi.fn(),
  signInWithEmailAndPassword: vi.fn(),
  signInWithEmailLink: vi.fn(),
  signOut: vi.fn(),
  updatePassword: vi.fn()
}));

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    getPlatform: vi.fn(() => 'ios'),
    isNativePlatform: vi.fn(() => true),
    isPluginAvailable: vi.fn(() => true)
  }
}));

vi.mock('@capacitor-firebase/authentication', () => ({
  FirebaseAuthentication: nativeAuthenticationMocks
}));

vi.mock('./firebaseAuthRuntime', () => ({
  auth: authState,
  applyActionCode: vi.fn(),
  confirmPasswordReset: vi.fn(),
  createUserWithEmailAndPassword: vi.fn(),
  getRedirectResult: vi.fn(),
  GoogleAuthProvider: class {},
  isSignInWithEmailLink: vi.fn(),
  onAuthStateChanged: authObserverMocks.onAuthStateChanged,
  signInWithEmailAndPassword: vi.fn(),
  signInWithCustomToken: webAuthRuntimeMocks.signInWithCustomToken,
  signInWithEmailLink: vi.fn(),
  signInWithPopup: vi.fn(),
  signInWithRedirect: vi.fn(),
  signOut: webAuthRuntimeMocks.signOut,
  updatePassword: vi.fn(),
  verifyPasswordResetCode: vi.fn()
}));

vi.mock('./adapters/legacyAuth', () => ({
  loadLegacyAdminInvite: vi.fn(async () => legacyAdminInviteMocks),
  loadLegacyAuthEmail: vi.fn(async () => legacyAuthEmailMocks),
  loadLegacyAuthDb: vi.fn(async () => legacyAuthMocks),
  loadLegacyInviteFlow: vi.fn(async () => legacyInviteFlowMocks),
  loadLegacyParentMembershipUtils: vi.fn(async () => parentMembershipMocks),
  loadLegacySignupFlow: vi.fn(async () => legacySignupFlowMocks)
}));

vi.mock('./appDataCache', () => ({
  clearAppDataCache: appDataCacheMocks.clearAppDataCache
}));

vi.mock('./nativeCallable', () => nativeCallableMocks);

vi.mock('./logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  })
}));

import { signInWithPopup, signInWithRedirect } from './firebaseAuthRuntime';
import { Capacitor } from '@capacitor/core';
import {
  classifyAuthConnectivity,
  describeAuthError,
  ensureNativeWebViewAuthSession,
  getNativeAuthIdToken,
  getNativeAuthUserId,
  getRouteForUser,
  hydrateFirebaseUser,
  isValidAuthEmail,
  observeFirebaseUser,
  reloadCurrentUser,
  redeemInviteForUser,
  revokeCurrentAppleAuthorizationForDeletion,
  resendVerificationEmail,
  sendResetEmail,
  signInWithEmail,
  signInWithAppleAccount,
  signInWithGoogleAccount,
  signOut,
  signUpWithEmail
} from './authService';

beforeEach(() => {
  nativeCallableMocks.callNativeFirebaseFunctionWithAuth.mockReset();
  nativeCallableMocks.callNativeFirebaseFunctionWithAuth.mockResolvedValue({
    customToken: 'native-web-custom-token'
  });
  webAuthRuntimeMocks.signInWithCustomToken.mockReset();
  webAuthRuntimeMocks.signInWithCustomToken.mockImplementation(async () => {
    const session = JSON.parse(window.localStorage?.getItem('allplays-native-auth-session') || 'null');
    const user = { uid: session?.uid || 'native-user', email: session?.email || null };
    authState.currentUser = user as never;
    return { user };
  });
  webAuthRuntimeMocks.signOut.mockReset();
  webAuthRuntimeMocks.signOut.mockImplementation(async () => {
    authState.currentUser = null;
  });
});

describe('getNativeAuthIdToken', () => {
  beforeEach(() => {
    nativeAuthenticationMocks.addListener.mockResolvedValue({ remove: vi.fn() });
    nativeAuthenticationMocks.getIdToken.mockReset();
    nativeAuthenticationMocks.getCurrentUser.mockReset();
    nativeAuthenticationMocks.getCurrentUser.mockImplementation(async () => {
      const session = JSON.parse(window.localStorage.getItem('allplays-native-auth-session') || 'null');
      return {
        user: session?.uid ? { uid: session.uid, email: session.email || null } : null
      };
    });
    nativeAuthenticationMocks.signOut.mockReset();
  });

  afterEach(async () => {
    await signOut();
    authState.currentUser = null;
    window.localStorage.clear();
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);
  });

  it('returns the Firebase SDK token for signed-in web users', async () => {
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(false);
    const getIdToken = vi.fn().mockResolvedValue('web-id-token');
    authState.currentUser = { getIdToken } as any;

    await expect(getNativeAuthIdToken(true)).resolves.toBe('web-id-token');

    expect(getIdToken).toHaveBeenCalledWith(true);
  });

  it('migrates a legacy native token into memory and scrubs persistent WebView storage', async () => {
    const getIdToken = vi.fn().mockResolvedValue('stale-web-token');
    authState.currentUser = { getIdToken } as any;
    window.localStorage.setItem(
      'allplays-native-auth-session',
      JSON.stringify({
        uid: 'native-user',
        email: 'native@example.com',
        idToken: 'native-id-token',
        refreshToken: 'native-refresh-token',
        expirationTime: Date.now() + 10 * 60 * 1000,
        provider: 'rest'
      })
    );

    await expect(getNativeAuthIdToken(false)).resolves.toBe('native-id-token');
    expect(getIdToken).not.toHaveBeenCalled();
    expect(JSON.parse(window.localStorage.getItem('allplays-native-auth-session') || '{}')).toEqual({
      uid: 'native-user',
      email: 'native@example.com',
      displayName: null,
      photoUrl: null,
      emailVerified: false,
      provider: 'rest'
    });
  });

  it('coalesces concurrent native plugin reads and reuses the short-lived in-memory token', async () => {
    window.localStorage.setItem('allplays-native-auth-session', JSON.stringify({
      uid: 'native-plugin-user',
      email: 'native@example.com',
      provider: 'native-plugin'
    }));
    let resolveToken!: (value: { token: string }) => void;
    nativeAuthenticationMocks.getIdToken.mockImplementationOnce(() => new Promise((resolve) => {
      resolveToken = resolve;
    }));

    const reads = Array.from({ length: 20 }, () => getNativeAuthIdToken(false));
    await vi.waitFor(() => {
      expect(nativeAuthenticationMocks.getIdToken).toHaveBeenCalledTimes(1);
    });
    expect(nativeAuthenticationMocks.getIdToken).toHaveBeenCalledWith({ forceRefresh: false });

    resolveToken({ token: 'shared-native-token' });
    await expect(Promise.all(reads)).resolves.toEqual(Array(20).fill('shared-native-token'));
    await expect(getNativeAuthIdToken(false)).resolves.toBe('shared-native-token');
    expect(nativeAuthenticationMocks.getIdToken).toHaveBeenCalledTimes(1);
    expect(nativeAuthenticationMocks.getCurrentUser).toHaveBeenCalledTimes(3);
  });

  it('does not reuse an in-memory native token for another uid', async () => {
    nativeAuthenticationMocks.getIdToken
      .mockResolvedValueOnce({ token: 'first-user-token' })
      .mockResolvedValueOnce({ token: 'second-user-token' });
    window.localStorage.setItem('allplays-native-auth-session', JSON.stringify({
      uid: 'first-user',
      email: 'first@example.com',
      provider: 'native-plugin'
    }));

    await expect(getNativeAuthIdToken(false)).resolves.toBe('first-user-token');
    window.localStorage.setItem('allplays-native-auth-session', JSON.stringify({
      uid: 'second-user',
      email: 'second@example.com',
      provider: 'native-plugin'
    }));

    await expect(getNativeAuthIdToken(false)).resolves.toBe('second-user-token');
    expect(nativeAuthenticationMocks.getIdToken).toHaveBeenCalledTimes(2);
  });

  it('rejects a token when the persisted uid does not match the native Firebase user', async () => {
    window.localStorage.setItem('allplays-native-auth-session', JSON.stringify({
      uid: 'persisted-user',
      email: 'persisted@example.com',
      provider: 'native-plugin'
    }));
    nativeAuthenticationMocks.getCurrentUser.mockResolvedValue({
      user: { uid: 'different-native-user', email: 'different@example.com' }
    });
    nativeAuthenticationMocks.getIdToken.mockResolvedValue({ token: 'wrong-user-token' });

    await expect(getNativeAuthIdToken(false)).rejects.toThrow(
      'Native Firebase auth session does not match the saved app session.'
    );
    expect(nativeAuthenticationMocks.getIdToken).not.toHaveBeenCalled();
  });

  it('does not return a cached token after the native user diverges without an auth event', async () => {
    window.localStorage.setItem('allplays-native-auth-session', JSON.stringify({
      uid: 'persisted-user',
      email: 'persisted@example.com',
      provider: 'native-plugin'
    }));
    nativeAuthenticationMocks.getIdToken.mockResolvedValue({ token: 'persisted-user-token' });

    await expect(getNativeAuthIdToken(false)).resolves.toBe('persisted-user-token');
    nativeAuthenticationMocks.getCurrentUser.mockResolvedValue({
      user: { uid: 'different-native-user', email: 'different@example.com' }
    });

    await expect(getNativeAuthIdToken(false)).rejects.toThrow(
      'Native Firebase auth session does not match the saved app session.'
    );
    expect(nativeAuthenticationMocks.getIdToken).toHaveBeenCalledTimes(1);
  });

  it('invalidates a reusable token when the native Firebase auth state changes', async () => {
    nativeAuthenticationMocks.getIdToken
      .mockResolvedValueOnce({ token: 'first-user-token' })
      .mockResolvedValueOnce({ token: 'second-user-token' });
    window.localStorage.setItem('allplays-native-auth-session', JSON.stringify({
      uid: 'first-user',
      email: 'first@example.com',
      provider: 'native-plugin'
    }));

    await expect(getNativeAuthIdToken(false)).resolves.toBe('first-user-token');
    const authStateListener = nativeAuthenticationMocks.addListener.mock.calls
      .find(([eventName]) => eventName === 'authStateChange')?.[1];
    expect(authStateListener).toBeTypeOf('function');

    window.localStorage.setItem('allplays-native-auth-session', JSON.stringify({
      uid: 'second-user',
      email: 'second@example.com',
      provider: 'native-plugin'
    }));
    authStateListener({ user: { uid: 'second-user' } });

    await expect(getNativeAuthIdToken(false)).resolves.toBe('second-user-token');
    expect(nativeAuthenticationMocks.getIdToken).toHaveBeenCalledTimes(2);
  });

  it('clears the reusable token at sign-out', async () => {
    nativeAuthenticationMocks.getIdToken
      .mockResolvedValueOnce({ token: 'before-sign-out' })
      .mockResolvedValueOnce({ token: 'after-sign-in' });
    const session = {
      uid: 'returning-user',
      email: 'returning@example.com',
      provider: 'native-plugin'
    };
    window.localStorage.setItem('allplays-native-auth-session', JSON.stringify(session));

    await expect(getNativeAuthIdToken(false)).resolves.toBe('before-sign-out');
    await signOut();
    window.localStorage.setItem('allplays-native-auth-session', JSON.stringify(session));

    await expect(getNativeAuthIdToken(false)).resolves.toBe('after-sign-in');
    expect(nativeAuthenticationMocks.getIdToken).toHaveBeenCalledTimes(2);
  });

  it('keeps a newer forced token when an older read resolves afterward', async () => {
    window.localStorage.setItem('allplays-native-auth-session', JSON.stringify({
      uid: 'native-plugin-user',
      email: 'native@example.com',
      provider: 'native-plugin'
    }));
    nativeAuthenticationMocks.getCurrentUser.mockResolvedValue({
      user: {
        uid: 'native-plugin-user',
        email: 'native@example.com'
      }
    });
    let resolveOlderToken!: (value: { token: string }) => void;
    nativeAuthenticationMocks.getIdToken
      .mockImplementationOnce(() => new Promise((resolve) => {
        resolveOlderToken = resolve;
      }))
      .mockResolvedValueOnce({ token: 'newer-forced-token' });

    const olderRead = getNativeAuthIdToken(false);
    await expect(getNativeAuthIdToken(true)).resolves.toBe('newer-forced-token');
    resolveOlderToken({ token: 'older-read-token' });
    await expect(olderRead).resolves.toBe('older-read-token');

    await expect(getNativeAuthIdToken(false)).resolves.toBe('newer-forced-token');
    expect(nativeAuthenticationMocks.getIdToken).toHaveBeenCalledTimes(2);
  });
});

describe('native WebView Firebase auth bridge', () => {
  beforeEach(() => {
    authState.currentUser = null;
    window.localStorage.clear();
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);
    nativeAuthenticationMocks.addListener.mockResolvedValue({ remove: vi.fn() });
    nativeAuthenticationMocks.getCurrentUser.mockResolvedValue({
      user: { uid: 'native-user', email: 'native@example.com' }
    });
    nativeAuthenticationMocks.getIdToken.mockResolvedValue({ token: 'verified-native-id-token' });
    window.localStorage.setItem('allplays-native-auth-session', JSON.stringify({
      uid: 'native-user',
      email: 'native@example.com',
      provider: 'native-plugin'
    }));
  });

  afterEach(async () => {
    await signOut();
    window.localStorage.clear();
  });

  it('coalesces startup and signs the WebView SDK into the exact native account', async () => {
    let resolveCallable!: (value: { customToken: string }) => void;
    nativeCallableMocks.callNativeFirebaseFunctionWithAuth.mockImplementationOnce(() => new Promise((resolve) => {
      resolveCallable = resolve;
    }));

    const first = ensureNativeWebViewAuthSession('native-user');
    const second = ensureNativeWebViewAuthSession('native-user');
    await vi.waitFor(() => {
      expect(nativeCallableMocks.callNativeFirebaseFunctionWithAuth).toHaveBeenCalledTimes(1);
    });
    resolveCallable({ customToken: 'caller-bound-custom-token' });

    await expect(Promise.all([first, second])).resolves.toEqual([
      expect.objectContaining({ uid: 'native-user' }),
      expect.objectContaining({ uid: 'native-user' })
    ]);
    expect(nativeCallableMocks.callNativeFirebaseFunctionWithAuth).toHaveBeenCalledWith(
      'createNativeWebAuthToken',
      {},
      {
        projectId: 'allplays-test',
        idToken: 'verified-native-id-token'
      },
      {
        timeoutMs: 15000,
        errorLabel: 'Native WebView authentication'
      }
    );
    expect(webAuthRuntimeMocks.signInWithCustomToken).toHaveBeenCalledWith(
      authState,
      'caller-bound-custom-token'
    );
  });

  it('allows a delayed custom-token response and retries one timed-out attempt', async () => {
    nativeCallableMocks.callNativeFirebaseFunctionWithAuth
      .mockRejectedValueOnce(new Error('Native WebView authentication timed out.'))
      .mockImplementationOnce(() => new Promise((resolve) => {
        window.setTimeout(() => resolve({ customToken: 'delayed-custom-token' }), 4000);
      }));
    vi.useFakeTimers();

    try {
      const bridge = ensureNativeWebViewAuthSession('native-user');
      await vi.advanceTimersByTimeAsync(4000);

      await expect(bridge).resolves.toEqual(expect.objectContaining({ uid: 'native-user' }));
      expect(nativeCallableMocks.callNativeFirebaseFunctionWithAuth).toHaveBeenCalledTimes(2);
      expect(nativeCallableMocks.callNativeFirebaseFunctionWithAuth).toHaveBeenLastCalledWith(
        'createNativeWebAuthToken',
        {},
        expect.any(Object),
        expect.objectContaining({ timeoutMs: 15000 })
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('fails closed and clears the WebView if the exchanged account does not match', async () => {
    webAuthRuntimeMocks.signInWithCustomToken.mockImplementationOnce(async () => {
      const user = { uid: 'different-user' };
      authState.currentUser = user as never;
      return { user };
    });

    await expect(ensureNativeWebViewAuthSession('native-user')).rejects.toThrow(
      'did not match the current account'
    );
    expect(webAuthRuntimeMocks.signOut).toHaveBeenCalledWith(authState);
    expect(authState.currentUser).toBeNull();
  });

  it('treats the native plugin identity as authoritative over a stale WebView user', () => {
    authState.currentUser = { uid: 'stale-web-user' } as never;
    expect(getNativeAuthUserId()).toBe('native-user');
  });
});

describe('reloadCurrentUser', () => {
  beforeEach(() => {
    authState.currentUser = null;
  });

  afterEach(() => {
    authState.currentUser = null;
  });

  it('forces a fresh ID token before returning a newly verified web user', async () => {
    const getIdToken = vi.fn().mockResolvedValue('fresh-verified-token');
    const user = {
      emailVerified: false,
      getIdToken,
      reload: vi.fn(async () => {
        user.emailVerified = true;
      })
    };
    authState.currentUser = user as any;

    await expect(reloadCurrentUser()).resolves.toBe(true);

    expect(user.reload).toHaveBeenCalledTimes(1);
    expect(getIdToken).toHaveBeenCalledWith(true);
    expect(user.reload.mock.invocationCallOrder[0]).toBeLessThan(getIdToken.mock.invocationCallOrder[0]);
  });

  it('does not report verification when the required token refresh fails', async () => {
    const tokenError = new Error('token refresh failed');
    authState.currentUser = {
      emailVerified: true,
      reload: vi.fn().mockResolvedValue(undefined),
      getIdToken: vi.fn().mockRejectedValue(tokenError)
    } as any;

    await expect(reloadCurrentUser()).rejects.toBe(tokenError);
  });
});

describe('auth email validation', () => {
  it('rejects Firebase-invalid emails before they reach the auth SDK', () => {
    expect(isValidAuthEmail('p@paulsnider')).toBe(false);
    expect(isValidAuthEmail('player@example.com')).toBe(true);
  });

  it('maps Firebase invalid-email errors to app copy', () => {
    expect(
      describeAuthError({
        code: 'auth/invalid-email',
        message: 'Firebase: Error (auth/invalid-email).'
      })
    ).toBe('Enter a valid email address.');
  });

  it('does not disclose whether a sign-in email belongs to an account', () => {
    expect(describeAuthError({ code: 'auth/user-not-found' })).toBe('Email or password is incorrect.');
  });

  it('maps REST too-many-attempts responses to the throttle message', () => {
    expect(describeAuthError({ restCode: 'TOO_MANY_ATTEMPTS_TRY_LATER' })).toBe('Too many attempts. Wait a few minutes and try again.');
    expect(describeAuthError({ code: 'auth/too-many-requests' })).toBe('Too many attempts. Wait a few minutes and try again.');
  });

  it('distinguishes offline, timeout, and reachable-network authentication failures', () => {
    expect(classifyAuthConnectivity({ code: 'auth/network-request-failed' }, false)).toBe('offline');
    expect(
      classifyAuthConnectivity(
        {
          code: 'auth/network-request-failed',
          message: 'Sign-in timed out.'
        },
        true
      )
    ).toBe('timeout');
    expect(classifyAuthConnectivity({ code: 'auth/network-request-failed' }, true)).toBe('service-unreachable');
  });

  it('gives network failures retryable guidance without exposing implementation details', () => {
    expect(
      describeAuthError({
        code: 'auth/network-request-failed',
        message: 'Sign-in timed out.'
      })
    ).toBe('Sign-in services took too long to respond. Try again.');
    expect(describeAuthError({ code: 'auth/network-request-failed' })).toBe(
      'ALL PLAYS could not reach sign-in services. Check your connection and try again.'
    );
  });
});

describe('resendVerificationEmail', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authState.currentUser = null;
  });

  afterEach(() => {
    authState.currentUser = null;
  });

  it('queues the verification email through the Resend-backed callable', async () => {
    const reload = vi.fn().mockResolvedValue(undefined);
    authState.currentUser = { reload, email: 'coach@allplays.ai' } as any;
    legacyAuthEmailMocks.queueCurrentUserVerificationEmail.mockResolvedValue({ queued: true });

    await resendVerificationEmail();

    expect(reload).toHaveBeenCalled();
    expect(legacyAuthEmailMocks.queueCurrentUserVerificationEmail).toHaveBeenCalledWith();
  });
});

describe('sendResetEmail', () => {
  beforeEach(() => {
    legacyAuthEmailMocks.queuePasswordResetEmail.mockReset();
  });

  it('normalizes the email and queues it through the Resend-backed callable', async () => {
    legacyAuthEmailMocks.queuePasswordResetEmail.mockResolvedValue({ queued: true });

    await sendResetEmail(' Player@Example.COM ');

    expect(legacyAuthEmailMocks.queuePasswordResetEmail).toHaveBeenCalledWith('player@example.com');
  });

  it('accepts the server-neutral response for a missing account', async () => {
    legacyAuthEmailMocks.queuePasswordResetEmail.mockResolvedValue({ queued: true });

    await expect(sendResetEmail('missing@example.com')).resolves.toBeUndefined();
  });

  it('preserves actionable reset failures', async () => {
    const error = { code: 'functions/resource-exhausted' };
    legacyAuthEmailMocks.queuePasswordResetEmail.mockRejectedValue(error);

    await expect(sendResetEmail('player@example.com')).rejects.toBe(error);
  });
});

describe('hydrateFirebaseUser', () => {
  beforeEach(() => {
    authState.currentUser = null;
    legacyAuthMocks.getUserProfile.mockReset();
    legacyAuthMocks.listMyParentMembershipRequests.mockReset();
    legacyAuthMocks.updateUserProfile.mockReset();
    legacyAuthMocks.getUserTeams.mockReset();
    parentMembershipMocks.mergeApprovedParentMembershipRequests.mockReset();
    legacyAuthMocks.getUserProfile.mockResolvedValue({
      email: 'coach@example.com',
      coachOf: ['team-1']
    });
    legacyAuthMocks.listMyParentMembershipRequests.mockResolvedValue([]);
    legacyAuthMocks.getUserTeams.mockResolvedValue([]);
    parentMembershipMocks.mergeApprovedParentMembershipRequests.mockReturnValue({
      changed: false
    });
  });

  it('loads stored profile roles for native REST fallback users before routing decisions', async () => {
    const hydrated = await hydrateFirebaseUser({
      uid: 'coach-1',
      email: 'coach@example.com',
      displayName: 'Coach Example',
      emailVerified: true,
      isNativeRestSession: true
    });

    expect(legacyAuthMocks.getUserProfile).toHaveBeenCalledWith('coach-1');
    expect(hydrated.user.roles).toContain('coach');
    expect(hydrated.user.roles).not.toEqual(['parent']);
    expect(hydrated.profileHydration).toBe('success');
  });

  it('does not restore an absent Auth email from a stale profile document', async () => {
    legacyAuthMocks.getUserProfile.mockResolvedValue({
      email: 'former-admin@example.com',
      coachOf: ['team-1']
    });

    const hydrated = await hydrateFirebaseUser({
      uid: 'former-admin',
      email: '',
      emailVerified: false
    });

    expect(hydrated.profile.email).toBe('former-admin@example.com');
    expect(hydrated.user.email).toBe('');
  });

  it('marks auth identity data as fallback when the profile document cannot be loaded', async () => {
    legacyAuthMocks.getUserProfile.mockRejectedValue(new Error('profile unavailable'));

    const hydrated = await hydrateFirebaseUser({
      uid: 'coach-1',
      email: 'coach@example.com'
    });

    expect(hydrated.profile).toEqual(expect.objectContaining({ email: 'coach@example.com' }));
    expect(hydrated.profileHydration).toBe('fallback');
  });

  it('queries owned teams and merges them when the stored coachOf list is already non-empty', async () => {
    legacyAuthMocks.getUserTeams.mockResolvedValue([
      { id: 'team-1', name: 'Current Team' },
      { id: 'team-2', name: 'Vipers' }
    ]);

    const hydrated = await hydrateFirebaseUser({
      uid: 'coach-1',
      email: 'coach@example.com'
    });

    expect(legacyAuthMocks.getUserTeams).toHaveBeenCalledWith('coach-1');
    expect(hydrated.profile.coachOf).toEqual(['team-1', 'team-2']);
    expect(hydrated.user.coachOf).toEqual(['team-1', 'team-2']);
  });

  it('starts independent account bootstrap reads before any one read resolves', async () => {
    let resolveProfile: ((value: Record<string, unknown>) => void) | undefined;
    let resolveMembershipRequests: ((value: unknown[]) => void) | undefined;
    let resolveOwnedTeams: ((value: Array<{ id: string; name: string }>) => void) | undefined;
    legacyAuthMocks.getUserProfile.mockImplementation(() => new Promise((resolve) => {
      resolveProfile = resolve;
    }));
    legacyAuthMocks.listMyParentMembershipRequests.mockImplementation(() => new Promise((resolve) => {
      resolveMembershipRequests = resolve;
    }));
    legacyAuthMocks.getUserTeams.mockImplementation(() => new Promise((resolve) => {
      resolveOwnedTeams = resolve;
    }));

    const hydration = hydrateFirebaseUser({
      uid: 'coach-1',
      email: 'coach@example.com'
    });

    await vi.waitFor(() => expect(legacyAuthMocks.getUserProfile).toHaveBeenCalledTimes(1));
    try {
      expect(legacyAuthMocks.listMyParentMembershipRequests).toHaveBeenCalledWith('coach-1');
      expect(legacyAuthMocks.getUserTeams).toHaveBeenCalledWith('coach-1');
    } finally {
      resolveProfile?.({ email: 'coach@example.com', coachOf: ['team-1'] });
      await vi.waitFor(() => expect(resolveMembershipRequests).toBeTypeOf('function'));
      resolveMembershipRequests?.([]);
      await vi.waitFor(() => expect(resolveOwnedTeams).toBeTypeOf('function'));
      resolveOwnedTeams?.([{ id: 'team-2', name: 'Vipers' }]);
      await hydration;
    }
  });
});

describe('signOut', () => {
  beforeEach(() => {
    appDataCacheMocks.clearAppDataCache.mockReset();
  });

  it('clears persisted app-data cache so the next user cannot read cached data', async () => {
    await signOut();
    expect(appDataCacheMocks.clearAppDataCache).toHaveBeenCalledTimes(1);
  });
});

describe('signUpWithEmail', () => {
  beforeEach(() => {
    legacySignupFlowMocks.executeEmailPasswordSignup.mockReset();
    legacySignupFlowMocks.executeEmailPasswordSignup.mockResolvedValue({
      user: { uid: 'new-user', email: 'player@example.com' }
    });
    nativeAuthenticationMocks.sendEmailVerification.mockResolvedValue(undefined);
    nativeAuthenticationMocks.reload.mockResolvedValue(undefined);
    legacyAuthEmailMocks.queueCurrentUserVerificationEmail.mockClear();
    window.localStorage.clear();
  });

  it('normalizes signup input and delegates to the shared access-code redemption flow', async () => {
    await signUpWithEmail(' Player@Example.COM ', 'secret1', ' 85nsbz7k ');

    expect(legacySignupFlowMocks.executeEmailPasswordSignup).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'player@example.com',
        password: 'secret1',
        activationCode: '85NSBZ7K',
        dependencies: expect.objectContaining({
          markAccessCodeAsUsed: legacyAuthMocks.markAccessCodeAsUsed,
          validateAccessCode: expect.any(Function)
        })
      })
    );
  });

  it('sends native signup verification through the Resend-backed callable', async () => {
    nativeAuthenticationMocks.getIdToken.mockResolvedValue({ token: 'native-signup-id-token' });
    nativeAuthenticationMocks.getCurrentUser.mockResolvedValue({
      user: { uid: 'new-user', email: 'player@example.com' }
    });
    legacySignupFlowMocks.executeEmailPasswordSignup.mockImplementation(async (options: any) => {
      window.localStorage.setItem(
        'allplays-native-auth-session',
        JSON.stringify({
          uid: 'new-user',
          email: 'player@example.com',
          emailVerified: false,
          provider: 'native-plugin'
        })
      );
      await options.auth.currentUser.reload();
      await options.dependencies.sendVerificationEmail();
      return { user: options.auth.currentUser };
    });

    await signUpWithEmail('player@example.com', 'secret1', '85NSBZ7K');

    expect(nativeAuthenticationMocks.reload).toHaveBeenCalledTimes(1);
    expect(legacyAuthEmailMocks.queueCurrentUserVerificationEmail).toHaveBeenCalledWith('native-signup-id-token');
    expect(nativeAuthenticationMocks.sendEmailVerification).not.toHaveBeenCalled();
  });

  it('stops invalid signup emails before loading Firebase signup work', async () => {
    await expect(signUpWithEmail('p@paulsnider', 'secret1', '85nsbz7k')).rejects.toThrow('Enter a valid email address.');
    expect(legacySignupFlowMocks.executeEmailPasswordSignup).not.toHaveBeenCalled();
  });
});

describe('signInWithGoogleAccount invite redemption', () => {
  const signInWithPopupMock = vi.mocked(signInWithPopup);
  const signInWithRedirectMock = vi.mocked(signInWithRedirect);
  const isNativePlatformMock = vi.mocked(Capacitor.isNativePlatform);

  beforeEach(() => {
    isNativePlatformMock.mockReturnValue(false);
    signInWithPopupMock.mockReset();
    signInWithRedirectMock.mockReset();
    legacyAuthMocks.validateAccessCode.mockReset();
    legacyAuthMocks.redeemHouseholdInvite.mockReset();
    legacyAuthMocks.redeemCoParentInvite.mockReset();
    legacyAuthMocks.redeemFriendInvite.mockReset();
    legacyAuthMocks.rollbackParentInviteRedemption.mockReset();
    legacyAuthMocks.rollbackParentInviteRedemption.mockResolvedValue(undefined);
    legacyAuthMocks.markAccessCodeAsUsed.mockReset();
    legacyAuthMocks.updateUserProfile.mockReset();
    legacyAuthMocks.updateUserProfile.mockResolvedValue(undefined);
    legacyAdminInviteMocks.redeemAdminInviteAcceptance.mockReset();
    legacyInviteFlowMocks.processInvite.mockReset();
    legacyInviteFlowMocks.processInvite.mockResolvedValue({ success: true, redirectUrl: 'dashboard.html' });
    legacyInviteFlowMocks.createInviteProcessor.mockReset();
    legacyInviteFlowMocks.createInviteProcessor.mockReturnValue(legacyInviteFlowMocks.processInvite);
  });

  afterEach(() => {
    isNativePlatformMock.mockReturnValue(true);
    window.sessionStorage.clear();
  });

  function mockNewGoogleUser(email: string) {
    signInWithPopupMock.mockResolvedValue({
      user: {
        uid: 'google-user',
        email,
        emailVerified: true,
        displayName: 'Google User',
        photoURL: 'https://example.com/photo.png',
        metadata: {
          creationTime: '2026-03-01T11:00:00.000Z',
          lastSignInTime: '2026-03-01T11:00:00.000Z'
        },
        delete: vi.fn()
      }
    } as any);
  }

  function mockExistingGoogleUser(email: string) {
    signInWithPopupMock.mockResolvedValue({
      user: {
        uid: 'existing-google-user',
        email,
        displayName: 'Existing Google User',
        photoURL: 'https://example.com/photo.png',
        metadata: {
          creationTime: '2026-02-01T11:00:00.000Z',
          lastSignInTime: '2026-03-01T11:00:00.000Z'
        }
      }
    } as any);
  }

  it('applies a join code when Google returns an existing authenticated account', async () => {
    mockExistingGoogleUser('member@example.com');

    const result = await signInWithGoogleAccount('site1234');

    expect(legacyInviteFlowMocks.processInvite).toHaveBeenCalledWith('existing-google-user', 'SITE1234', 'member@example.com');
    expect(result).toMatchObject({ activationCodeRedeemed: true, wasNewUser: false });
  });

  it('redeems household invites instead of claiming them as standard activation codes', async () => {
    mockNewGoogleUser('household@example.com');
    legacyAuthMocks.validateAccessCode.mockResolvedValue({
      valid: true,
      type: 'household_invite',
      codeId: 'household-code-id',
      data: { code: 'HOME1234' }
    });
    legacyAuthMocks.redeemHouseholdInvite.mockResolvedValue({ success: true });

    await signInWithGoogleAccount('home1234');

    expect(legacyAuthMocks.redeemHouseholdInvite).toHaveBeenCalledWith('google-user', 'HOME1234');
    expect(legacyAuthMocks.markAccessCodeAsUsed).not.toHaveBeenCalled();
  });

  it('redeems co-parent invites with the Google account email', async () => {
    mockNewGoogleUser('coparent@example.com');
    legacyAuthMocks.validateAccessCode.mockResolvedValue({
      valid: true,
      type: 'coparent_invite',
      codeId: 'coparent-code-id',
      data: { code: 'COPO1234' }
    });
    legacyAuthMocks.redeemCoParentInvite.mockResolvedValue({ success: true });

    await signInWithGoogleAccount('copo1234');

    expect(legacyAuthMocks.redeemCoParentInvite).toHaveBeenCalledWith('google-user', 'COPO1234', 'coparent@example.com');
    expect(legacyAuthMocks.markAccessCodeAsUsed).not.toHaveBeenCalled();
  });

  it('redeems friend invites with the Google account email for new users', async () => {
    mockNewGoogleUser('friend@example.com');
    legacyAuthMocks.validateAccessCode.mockResolvedValue({
      valid: true,
      type: 'friend_invite',
      codeId: 'friend-code-id',
      data: { code: 'FRIEND12' }
    });
    legacyAuthMocks.redeemFriendInvite.mockResolvedValue({ success: true });

    await signInWithGoogleAccount('friend12');

    expect(legacyAuthMocks.redeemFriendInvite).toHaveBeenCalledWith('google-user', 'FRIEND12', 'friend@example.com');
    expect(legacyAuthMocks.markAccessCodeAsUsed).not.toHaveBeenCalled();
  });

  it('redeems admin invites for a verified Google account across app runtimes', async () => {
    mockNewGoogleUser('admin@example.com');
    legacyAuthMocks.validateAccessCode.mockResolvedValue({
      valid: true,
      type: 'admin_invite',
      codeId: 'admin-code-id',
      data: { code: 'ADMIN001' }
    });
    legacyAdminInviteMocks.redeemAdminInviteAcceptance.mockResolvedValue({ id: 'team-1' });

    await signInWithGoogleAccount('admin001');

    expect(legacyAdminInviteMocks.redeemAdminInviteAcceptance).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'google-user',
      userEmail: 'admin@example.com',
      codeId: 'admin-code-id'
    }));
    expect(legacyAuthMocks.markAccessCodeAsUsed).not.toHaveBeenCalled();
  });

  it('releases a consumed parent invite before deleting a failed new Google signup', async () => {
    const deleteUser = vi.fn().mockResolvedValue(undefined);
    signInWithPopupMock.mockResolvedValue({
      user: {
        uid: 'google-user',
        email: 'parent@example.com',
        displayName: 'Google User',
        photoURL: 'https://example.com/photo.png',
        metadata: {
          creationTime: '2026-03-01T11:00:00.000Z',
          lastSignInTime: '2026-03-01T11:00:00.000Z'
        },
        delete: deleteUser
      }
    } as any);
    legacyAuthMocks.validateAccessCode.mockResolvedValue({
      valid: true,
      type: 'parent_invite',
      codeId: 'parent-code-id',
      data: { code: 'PARENT12' }
    });
    legacyAuthMocks.redeemParentInvite.mockResolvedValue({ success: true });
    legacyAuthMocks.updateUserProfile.mockRejectedValue(new Error('profile write failed'));

    await expect(signInWithGoogleAccount('parent12')).rejects.toThrow('profile write failed');

    expect(legacyAuthMocks.rollbackParentInviteRedemption).toHaveBeenCalledWith('google-user', 'PARENT12');
    expect(deleteUser).toHaveBeenCalledTimes(1);
    expect(legacyAuthMocks.rollbackParentInviteRedemption.mock.invocationCallOrder[0]).toBeLessThan(deleteUser.mock.invocationCallOrder[0]);
  });
});

function installTestLocalStorage() {
  const values = new Map<string, string>();
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: {
      getItem: vi.fn((key: string) => values.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => {
        values.set(key, String(value));
      }),
      removeItem: vi.fn((key: string) => {
        values.delete(key);
      }),
      clear: vi.fn(() => {
        values.clear();
      })
    }
  });
}

describe('native REST sign-in', () => {
  beforeEach(() => {
    authState.currentUser = null;
    appDataCacheMocks.clearAppDataCache.mockReset();
    legacyAuthMocks.validateAccessCode.mockReset();
    legacyAuthMocks.markAccessCodeAsUsed.mockReset();
    legacyAuthMocks.updateUserProfile.mockReset();
    legacyAuthMocks.updateUserProfile.mockResolvedValue(undefined);
    installTestLocalStorage();
    window.localStorage.clear();
    installIndexedDbMock();
    nativeAuthenticationMocks.getCurrentUser.mockReset();
    nativeAuthenticationMocks.getIdToken.mockReset();
    nativeAuthenticationMocks.getCurrentUser.mockResolvedValue({
      user: {
        uid: 'apple-user',
        email: 'apple@example.com',
        displayName: 'Apple User',
        emailVerified: true
      }
    });
    nativeAuthenticationMocks.getIdToken.mockResolvedValue({ token: 'native-plugin-id-token' });
    nativeAuthenticationMocks.signInWithEmailAndPassword.mockResolvedValue({
      user: {
        uid: 'new-user',
        email: 'new@example.com',
        displayName: 'New User',
        emailVerified: true
      }
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.includes('accounts:signInWithPassword')) {
          return createJsonResponse({
            localId: 'new-user',
            email: 'new@example.com',
            idToken: 'new-id-token',
            refreshToken: 'new-refresh-token',
            expiresIn: '3600'
          });
        }
        if (url.includes('accounts:signInWithIdp')) {
          return createJsonResponse({
            localId: 'apple-user',
            email: 'apple@example.com',
            idToken: 'apple-firebase-id-token',
            refreshToken: 'apple-refresh-token',
            expiresIn: '3600',
            isNewUser: true
          });
        }
        return createJsonResponse({
          users: [
            {
              email: url.includes('accounts:lookup') ? 'apple@example.com' : 'new@example.com',
              emailVerified: true,
              displayName: 'Apple User',
              createdAt: '1700000000000',
              lastLoginAt: '1700000000001'
            }
          ]
        });
      })
    );
  });

  it('clears cached user data before replacing a persisted native REST session with a different uid', async () => {
    nativeAuthenticationMocks.getCurrentUser.mockResolvedValue({
      user: {
        uid: 'new-user',
        email: 'new@example.com',
        displayName: 'New User',
        emailVerified: true
      }
    });
    window.localStorage.setItem(
      'allplays-native-auth-session',
      JSON.stringify({
        uid: 'previous-user',
        email: 'previous@example.com',
        idToken: 'previous-id-token',
        refreshToken: 'previous-refresh-token',
        expirationTime: Date.now() + 3600_000,
        apiKey: 'test-api-key',
        provider: 'rest'
      })
    );

    const result = await signInWithEmail('new@example.com', 'password123');

    expect(result.nativeRest).toBe(true);
    expect(result.user.uid).toBe('new-user');
    expect(appDataCacheMocks.clearAppDataCache).toHaveBeenCalledTimes(1);
    expect(nativeCallableMocks.callNativeFirebaseFunctionWithAuth).toHaveBeenCalledWith(
      'createNativeWebAuthToken',
      {},
      expect.objectContaining({ idToken: 'native-plugin-id-token' }),
      expect.any(Object)
    );
    expect(nativeCallableMocks.callNativeFirebaseFunctionWithAuth.mock.invocationCallOrder[0])
      .toBeLessThan(legacyAuthMocks.updateUserProfile.mock.invocationCallOrder[0]);
  });

  it('invalidates an in-flight plugin token when native sign-in switches accounts', async () => {
    nativeAuthenticationMocks.getCurrentUser.mockResolvedValue({
      user: { uid: 'previous-user', email: 'previous@example.com' }
    });
    window.localStorage.setItem(
      'allplays-native-auth-session',
      JSON.stringify({
        uid: 'previous-user',
        email: 'previous@example.com',
        provider: 'native-plugin'
      })
    );
    let resolvePreviousToken!: (value: { token: string }) => void;
    nativeAuthenticationMocks.getIdToken
      .mockImplementationOnce(() => new Promise((resolve) => {
        resolvePreviousToken = resolve;
      }))
      .mockResolvedValueOnce({ token: 'new-user-lookup-token' })
      .mockResolvedValueOnce({ token: 'new-user-bridge-token' });

    const previousToken = getNativeAuthIdToken(false);
    await vi.waitFor(() => {
      expect(nativeAuthenticationMocks.getIdToken).toHaveBeenCalledTimes(1);
    });
    nativeAuthenticationMocks.getCurrentUser.mockResolvedValue({
      user: { uid: 'new-user', email: 'new@example.com' }
    });
    const result = await signInWithEmail('new@example.com', 'password123');
    resolvePreviousToken({ token: 'stale-previous-token' });

    expect(result.user.uid).toBe('new-user');
    await expect(previousToken).rejects.toThrow('session changed');
    await expect(getNativeAuthIdToken(false)).resolves.toBe('new-user-bridge-token');
  });

  it('exposes the persisted native uid when the Firebase JS auth user is unavailable', () => {
    window.localStorage.setItem(
      'allplays-native-auth-session',
      JSON.stringify({
        uid: 'persisted-user',
        email: 'persisted@example.com',
        idToken: 'persisted-id-token',
        refreshToken: 'persisted-refresh-token',
        expirationTime: Date.now() + 3600_000,
        apiKey: 'test-api-key',
        provider: 'rest'
      })
    );

    expect(getNativeAuthUserId()).toBe('persisted-user');
  });

  it('authenticates phone-only friend invite validation for an already signed-in native user', async () => {
    nativeAuthenticationMocks.getCurrentUser.mockResolvedValue({
      user: { uid: 'phone-user', email: null }
    });
    window.localStorage.setItem(
      'allplays-native-auth-session',
      JSON.stringify({
        uid: 'phone-user',
        email: '',
        provider: 'native-plugin'
      })
    );
    nativeAuthenticationMocks.getIdToken.mockResolvedValue({ token: 'phone-user-id-token' });
    legacyAuthMocks.validateAccessCode.mockResolvedValue({
      valid: true,
      type: 'friend_invite',
      codeId: 'phone-friend-code-id',
      data: { code: 'FRIEND12' }
    });
    legacyInviteFlowMocks.createInviteProcessor.mockImplementation(({ validateAccessCode }) => async () => {
      await validateAccessCode('FRIEND12');
      return { success: true };
    });

    await redeemInviteForUser('phone-user', 'friend12', null);

    expect(legacyAuthMocks.validateAccessCode).toHaveBeenCalledWith('FRIEND12', {
      nativeAuthToken: 'phone-user-id-token'
    });
  });

  it('uses native Apple Firebase auth, persists metadata only, and redeems the join code', async () => {
    nativeAuthenticationMocks.signInWithApple.mockResolvedValue({
      user: {
        uid: 'apple-user',
        email: 'apple@example.com',
        displayName: 'Apple User',
        emailVerified: true
      },
      credential: {
        idToken: 'apple-provider-id-token',
        nonce: 'apple-raw-nonce'
      },
      additionalUserInfo: { isNewUser: true }
    });
    legacyAuthMocks.validateAccessCode.mockResolvedValue({
      valid: true,
      type: 'team_invite',
      codeId: 'apple-code-id',
      data: { code: 'APPLE123' }
    });
    legacyAuthMocks.markAccessCodeAsUsed.mockResolvedValue(undefined);

    const result = await signInWithAppleAccount('apple123');

    expect(nativeAuthenticationMocks.signInWithApple).toHaveBeenCalledWith({ skipNativeAuth: false });
    const fetchMock = vi.mocked(fetch);
    const idpCall = fetchMock.mock.calls.find(([url]) => String(url).includes('accounts:signInWithIdp'));
    expect(idpCall).toBeFalsy();
    expect(legacyAuthMocks.validateAccessCode).toHaveBeenCalledWith('APPLE123', undefined);
    expect(legacyAuthMocks.markAccessCodeAsUsed).toHaveBeenCalledWith('apple-code-id', 'apple-user');
    expect(result).toMatchObject({
      nativeRest: true,
      activationCodeRedeemed: true,
      wasNewUser: true,
      user: { uid: 'apple-user' }
    });
    expect(JSON.parse(window.localStorage.getItem('allplays-native-auth-session') || '{}')).toMatchObject({
      uid: 'apple-user',
      provider: 'native-plugin'
    });
    expect(window.localStorage.getItem('allplays-native-auth-session')).not.toContain('idToken');
    expect(window.localStorage.getItem('allplays-native-auth-session')).not.toContain('refreshToken');
  });

  it('preserves existing profile fields when Apple omits them on a later sign-in', async () => {
    nativeAuthenticationMocks.signInWithApple.mockResolvedValue({
      user: {
        uid: 'apple-user',
        email: 'apple@example.com',
        emailVerified: true
      },
      credential: {
        idToken: 'apple-provider-id-token',
        nonce: 'apple-raw-nonce'
      }
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.includes('accounts:signInWithIdp')) {
          return createJsonResponse({
            localId: 'apple-user',
            email: 'apple@example.com',
            idToken: 'apple-firebase-id-token',
            refreshToken: 'apple-refresh-token',
            expiresIn: '3600',
            isNewUser: false
          });
        }
        return createJsonResponse({
          users: [
            {
              email: 'apple@example.com',
              emailVerified: true,
              providerUserInfo: [{ providerId: 'apple.com' }]
            }
          ]
        });
      })
    );

    await signInWithAppleAccount();

    const profileCalls = legacyAuthMocks.updateUserProfile.mock.calls;
    const profileUpdate = profileCalls[profileCalls.length - 1]?.[1];
    expect(profileUpdate).toMatchObject({ email: 'apple@example.com' });
    expect(profileUpdate).not.toHaveProperty('fullName');
    expect(profileUpdate).not.toHaveProperty('photoUrl');
  });

  it('reauthenticates with Apple and revokes the fresh authorization code before deletion', async () => {
    nativeAuthenticationMocks.signInWithApple.mockResolvedValue({
      credential: {
        authorizationCode: 'fresh-apple-authorization-code',
        idToken: 'fresh-apple-id-token',
        nonce: 'fresh-apple-nonce'
      }
    });
    nativeAuthenticationMocks.revokeAccessToken.mockResolvedValue(undefined);

    await revokeCurrentAppleAuthorizationForDeletion();

    expect(nativeAuthenticationMocks.signInWithApple).toHaveBeenCalledWith({ skipNativeAuth: false });
    expect(nativeAuthenticationMocks.revokeAccessToken).toHaveBeenCalledWith({
      token: 'fresh-apple-authorization-code'
    });
    expect(JSON.parse(window.localStorage.getItem('allplays-native-auth-session') || '{}')).toMatchObject({
      uid: 'apple-user',
      provider: 'native-plugin'
    });
    expect(window.localStorage.getItem('allplays-native-auth-session')).not.toContain('idToken');
  });
});

describe('observeFirebaseUser', () => {
  beforeEach(() => {
    appDataCacheMocks.clearAppDataCache.mockReset();
    authObserverMocks.onAuthStateChanged.mockReset();
    authState.currentUser = null;
    window.localStorage.clear();
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(false);
  });

  afterEach(() => {
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
  });

  function wireObserver() {
    let handler: ((user: unknown) => void) | null = null;
    authObserverMocks.onAuthStateChanged.mockImplementation((_auth: unknown, cb: (user: unknown) => void) => {
      handler = cb;
      return () => {};
    });
    observeFirebaseUser(() => {});
    return (user: unknown) => handler?.(user);
  }

  it('does not clear the cache on the initial restored session', () => {
    const emit = wireObserver();
    emit({ uid: 'user-a' });
    expect(appDataCacheMocks.clearAppDataCache).not.toHaveBeenCalled();
  });

  it('clears cached data when the account switches to a different uid', () => {
    const emit = wireObserver();
    emit({ uid: 'user-a' });
    emit({ uid: 'user-b' });
    expect(appDataCacheMocks.clearAppDataCache).toHaveBeenCalledTimes(1);
  });

  it('clears cached data when the session transitions to signed-out', () => {
    const emit = wireObserver();
    emit({ uid: 'user-a' });
    emit(null);
    expect(appDataCacheMocks.clearAppDataCache).toHaveBeenCalledTimes(1);
  });

  it('does not clear the cache on repeated snapshots of the same uid', () => {
    const emit = wireObserver();
    emit({ uid: 'user-a' });
    emit({ uid: 'user-a' });
    expect(appDataCacheMocks.clearAppDataCache).not.toHaveBeenCalled();
  });

  it('authenticates the WebView SDK before exposing a restored native user', async () => {
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);
    window.localStorage.setItem('allplays-native-auth-session', JSON.stringify({
      uid: 'native-user',
      email: 'native@example.com',
      provider: 'native-plugin'
    }));
    nativeAuthenticationMocks.getCurrentUser.mockResolvedValue({
      user: { uid: 'native-user', email: 'native@example.com' }
    });
    nativeAuthenticationMocks.getIdToken.mockResolvedValue({ token: 'native-id-token' });
    const observer: { current?: (user: unknown) => void } = {};
    authObserverMocks.onAuthStateChanged.mockImplementation((_auth: unknown, cb: (user: unknown) => void) => {
      observer.current = cb;
      return () => {};
    });
    const callback = vi.fn();
    observeFirebaseUser(callback);

    observer.current?.(null);

    await vi.waitFor(() => {
      expect(callback).toHaveBeenCalledWith(expect.objectContaining({ uid: 'native-user' }));
    });
    expect(nativeCallableMocks.callNativeFirebaseFunctionWithAuth).toHaveBeenCalledTimes(1);
    expect(webAuthRuntimeMocks.signInWithCustomToken).toHaveBeenCalledTimes(1);
    expect(callback.mock.calls[0][0]).not.toHaveProperty('isNativeRestSession', true);

    observer.current?.(authState.currentUser);

    expect(callback).toHaveBeenCalledTimes(1);
  });

  it('does not expose the restored native identity while the online bridge is pending', async () => {
    vi.useFakeTimers();
    try {
      vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);
      window.localStorage.setItem('allplays-native-auth-session', JSON.stringify({
        uid: 'native-user',
        email: 'native@example.com',
        provider: 'native-plugin'
      }));
      nativeAuthenticationMocks.getCurrentUser.mockResolvedValue({
        user: { uid: 'native-user', email: 'native@example.com' }
      });
      nativeAuthenticationMocks.getIdToken.mockResolvedValue({ token: 'native-id-token' });
      nativeCallableMocks.callNativeFirebaseFunctionWithAuth.mockImplementationOnce(() => new Promise((resolve) => {
        window.setTimeout(() => resolve({ customToken: 'delayed-custom-token' }), 4500);
      }));
      const observer: { current?: (user: unknown) => void } = {};
      authObserverMocks.onAuthStateChanged.mockImplementation((_auth: unknown, cb: (user: unknown) => void) => {
        observer.current = cb;
        return () => {};
      });
      const callback = vi.fn();
      observeFirebaseUser(callback);

      observer.current?.(null);
      await vi.advanceTimersByTimeAsync(4000);
      expect(callback).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(500);
      expect(callback).toHaveBeenCalledTimes(1);
      expect(callback).toHaveBeenLastCalledWith(expect.objectContaining({
        uid: 'native-user'
      }));
      expect(callback.mock.calls[0][0]).not.toHaveProperty('isNativeRestSession', true);

      observer.current?.(authState.currentUser);

      expect(webAuthRuntimeMocks.signInWithCustomToken).toHaveBeenCalledTimes(1);
      expect(callback).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('preserves the existing offline native fallback without attempting a network bridge', () => {
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);
    const originalOnline = navigator.onLine;
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
    window.localStorage.setItem('allplays-native-auth-session', JSON.stringify({
      uid: 'offline-user',
      email: 'offline@example.com',
      provider: 'native-plugin'
    }));
    const observer: { current?: (user: unknown) => void } = {};
    authObserverMocks.onAuthStateChanged.mockImplementation((_auth: unknown, cb: (user: unknown) => void) => {
      observer.current = cb;
      return () => {};
    });
    const callback = vi.fn();
    observeFirebaseUser(callback);

    observer.current?.(null);

    expect(callback).toHaveBeenCalledWith(expect.objectContaining({
      uid: 'offline-user',
      isNativeRestSession: true
    }));
    expect(nativeCallableMocks.callNativeFirebaseFunctionWithAuth).not.toHaveBeenCalled();
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: originalOnline });
  });
});

describe('getRouteForUser', () => {
  it('routes signed-out users to auth', () => {
    expect(getRouteForUser(null)).toBe('/auth');
  });

  it('routes every signed-in user to home, including coaches and admins', () => {
    const baseUser = { uid: 'user-1', email: 'user@example.com', displayName: 'User', emailVerified: true };
    expect(getRouteForUser({ ...baseUser, isAdmin: false, roles: [] } as never)).toBe('/home');
    expect(getRouteForUser({ ...baseUser, isAdmin: false, roles: ['coach'] } as never)).toBe('/home');
    expect(getRouteForUser({ ...baseUser, isAdmin: true, roles: ['admin', 'platformAdmin'] } as never)).toBe('/home');
  });
});

function createJsonResponse(payload: unknown) {
  return {
    ok: true,
    json: vi.fn(async () => payload)
  } as unknown as Response;
}

function installIndexedDbMock() {
  const objectStore = {
    delete: vi.fn(),
    put: vi.fn()
  };
  const database = {
    close: vi.fn(),
    createObjectStore: vi.fn(),
    objectStoreNames: {
      contains: vi.fn(() => true)
    },
    transaction: vi.fn(() => {
      const transaction: {
        error: Error | null;
        objectStore: ReturnType<typeof vi.fn>;
        onabort: (() => void) | null;
        oncomplete: (() => void) | null;
        onerror: (() => void) | null;
      } = {
        error: null,
        objectStore: vi.fn(() => objectStore),
        onabort: null,
        oncomplete: null,
        onerror: null
      };
      window.setTimeout(() => transaction.oncomplete?.(), 0);
      return transaction;
    })
  };
  const indexedDB = {
    open: vi.fn(() => {
      const request: {
        error: Error | null;
        result: typeof database;
        onerror: (() => void) | null;
        onsuccess: (() => void) | null;
        onupgradeneeded: (() => void) | null;
      } = {
        error: null,
        result: database,
        onerror: null,
        onsuccess: null,
        onupgradeneeded: null
      };
      window.setTimeout(() => request.onsuccess?.(), 0);
      return request;
    })
  };

  Object.defineProperty(window, 'indexedDB', {
    configurable: true,
    value: indexedDB
  });
}
