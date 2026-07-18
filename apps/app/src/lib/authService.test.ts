// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const firebaseProjectId = 'test-project';

function createFirebaseIdToken(uid: string, overrides: Record<string, unknown> = {}) {
  const encode = (value: Record<string, unknown>) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'none', typ: 'JWT' })}.${encode({
    aud: firebaseProjectId,
    iss: `https://securetoken.google.com/${firebaseProjectId}`,
    sub: uid,
    user_id: uid,
    exp: Math.floor(Date.now() / 1000) + 3600,
    iat: Math.floor(Date.now() / 1000),
    ...overrides
  })}.signature`;
}

const authState = vi.hoisted(() => ({
  currentUser: null,
  app: {
    options: {
      apiKey: 'test-api-key',
      projectId: 'test-project'
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
  clearAppDataCache: vi.fn(),
  flushAppDataCachePersistence: vi.fn()
}));

const nativeSessionStoreMocks = vi.hoisted(() => ({
  session: null as any,
  readNativeAuthSession: vi.fn(async () => nativeSessionStoreMocks.session),
  writeNativeAuthSession: vi.fn(async (session: any) => {
    nativeSessionStoreMocks.session = session;
    return true;
  }),
  clearNativeAuthSession: vi.fn(async () => {
    nativeSessionStoreMocks.session = null;
  })
}));

const nativeFirebasePersistenceMocks = vi.hoisted(() => ({
  persistNativeFirebaseAuthUser: vi.fn(async () => {}),
  clearNativeFirebaseAuthUser: vi.fn(async () => {})
}));

const imageUploadSessionMocks = vi.hoisted(() => ({
  clearImageUploadSession: vi.fn(async () => {})
}));

const authObserverMocks = vi.hoisted(() => ({
  onAuthStateChanged: vi.fn()
}));

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: vi.fn(() => true)
  }
}));

vi.mock('@capacitor-firebase/authentication', () => ({
  FirebaseAuthentication: {}
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
  signInWithEmailLink: vi.fn(),
  signInWithPopup: vi.fn(),
  signInWithRedirect: vi.fn(),
  signOut: vi.fn(),
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
  clearAppDataCache: appDataCacheMocks.clearAppDataCache,
  flushAppDataCachePersistence: appDataCacheMocks.flushAppDataCachePersistence
}));

vi.mock('./nativeAuthSessionStore', () => ({
  readNativeAuthSession: nativeSessionStoreMocks.readNativeAuthSession,
  writeNativeAuthSession: nativeSessionStoreMocks.writeNativeAuthSession,
  clearNativeAuthSession: nativeSessionStoreMocks.clearNativeAuthSession
}));

vi.mock('./nativeFirebaseAuthPersistence', () => nativeFirebasePersistenceMocks);
vi.mock('./imageUploadSessionStore', () => imageUploadSessionMocks);

vi.mock('./logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  })
}));

import {
  applyActionCode,
  confirmPasswordReset,
  createUserWithEmailAndPassword,
  isSignInWithEmailLink,
  signInWithEmailLink,
  signInWithPopup,
  signInWithRedirect,
  signOut as firebaseSignOutMock,
  verifyPasswordResetCode
} from './firebaseAuthRuntime';
import { Capacitor } from '@capacitor/core';
import {
  describeAuthError,
  getNativeAuthIdToken,
  getRouteForUser,
  hydrateFirebaseUser,
  isValidAuthEmail,
  observeFirebaseUser,
  readPendingInvite,
  rememberPendingInvite,
  clearPendingInvite,
  completeEmailLink,
  resendVerificationEmail,
  sendResetEmail,
  signInWithEmail,
  signInWithGoogleAccount,
  signOut,
  signUpWithEmail
} from './authService';

describe('pending invite storage', () => {
  beforeEach(() => {
    vi.useRealTimers();
    installTestLocalStorage();
    installTestSessionStorage();
  });

  it('keeps invite capabilities session-scoped and removes legacy durable copies', () => {
    window.localStorage.setItem('inviteCode', 'OLD12345');
    window.localStorage.setItem('inviteType', 'parent');

    expect(readPendingInvite()).toEqual({ code: 'OLD12345', type: 'parent' });
    expect(window.localStorage.getItem('inviteCode')).toBeNull();
    expect(window.localStorage.getItem('allplays-app-pending-invite-code')).toBeNull();
    expect(window.sessionStorage.getItem('allplays-app-pending-invite-code')).toBe('OLD12345');
  });

  it('expires pending invite hints without bypassing backend redemption', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-17T12:00:00Z'));
    rememberPendingInvite('abcd1234', 'coparent');
    vi.advanceTimersByTime(2 * 60 * 60 * 1000 + 1);

    expect(readPendingInvite()).toEqual({ code: '', type: 'parent' });
    expect(window.sessionStorage.getItem('allplays-app-pending-invite-code')).toBeNull();
  });

  it('clears both session-scoped and legacy invite hints', () => {
    rememberPendingInvite('abcd1234', 'parent');
    window.localStorage.setItem('inviteCode', 'ABCD1234');
    clearPendingInvite();

    expect(readPendingInvite()).toEqual({ code: '', type: 'parent' });
    expect(window.localStorage.getItem('inviteCode')).toBeNull();
  });
});

describe('auth email validation', () => {
  it('rejects Firebase-invalid emails before they reach the auth SDK', () => {
    expect(isValidAuthEmail('p@paulsnider')).toBe(false);
    expect(isValidAuthEmail('player@example.com')).toBe(true);
  });

  it('maps Firebase invalid-email errors to app copy', () => {
    expect(describeAuthError({
      code: 'auth/invalid-email',
      message: 'Firebase: Error (auth/invalid-email).'
    })).toBe('Enter a valid email address.');
  });

  it('does not disclose whether a sign-in email belongs to an account', () => {
    expect(describeAuthError({ code: 'auth/user-not-found' })).toBe('Email or password is incorrect.');
  });

  it('maps REST too-many-attempts responses to the throttle message', () => {
    expect(describeAuthError({ restCode: 'TOO_MANY_ATTEMPTS_TRY_LATER' }))
      .toBe('Too many attempts. Wait a few minutes and try again.');
    expect(describeAuthError({ code: 'auth/too-many-requests' }))
      .toBe('Too many attempts. Wait a few minutes and try again.');
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
  });
});

describe('signOut', () => {
  beforeEach(() => {
    appDataCacheMocks.clearAppDataCache.mockReset();
    appDataCacheMocks.flushAppDataCachePersistence.mockReset();
    appDataCacheMocks.flushAppDataCachePersistence.mockResolvedValue(undefined);
    nativeSessionStoreMocks.clearNativeAuthSession.mockClear();
    nativeFirebasePersistenceMocks.clearNativeFirebaseAuthUser.mockReset();
    nativeFirebasePersistenceMocks.clearNativeFirebaseAuthUser.mockResolvedValue(undefined);
    vi.mocked(firebaseSignOutMock).mockReset();
    vi.mocked(firebaseSignOutMock).mockResolvedValue(undefined);
    imageUploadSessionMocks.clearImageUploadSession.mockReset();
    imageUploadSessionMocks.clearImageUploadSession.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('continues all logout cleanup when secure Firebase persistence removal fails', async () => {
    nativeFirebasePersistenceMocks.clearNativeFirebaseAuthUser.mockRejectedValueOnce(new Error('keychain locked'));

    await expect(signOut()).resolves.toBeUndefined();

    expect(nativeSessionStoreMocks.clearNativeAuthSession).toHaveBeenCalledTimes(1);
    expect(imageUploadSessionMocks.clearImageUploadSession).toHaveBeenCalledTimes(1);
    expect(appDataCacheMocks.clearAppDataCache).toHaveBeenCalledTimes(1);
    expect(appDataCacheMocks.flushAppDataCachePersistence).toHaveBeenCalledTimes(1);
    expect(firebaseSignOutMock).toHaveBeenCalledWith(authState);
  });

  it('clears persisted app-data cache so the next user cannot read cached data', async () => {
    await signOut();
    expect(appDataCacheMocks.clearAppDataCache).toHaveBeenCalledTimes(1);
    expect(appDataCacheMocks.flushAppDataCachePersistence).toHaveBeenCalledTimes(1);
    expect(nativeSessionStoreMocks.clearNativeAuthSession).toHaveBeenCalledTimes(1);
    expect(imageUploadSessionMocks.clearImageUploadSession).toHaveBeenCalledTimes(1);
  });

  it('finishes user A logout before allowing a queued user B auth mutation to start', async () => {
    const fallbackRemoval = createDeferred<void>();
    nativeSessionStoreMocks.clearNativeAuthSession.mockImplementationOnce(() => fallbackRemoval.promise);
    legacySignupFlowMocks.executeEmailPasswordSignup.mockReset();
    legacySignupFlowMocks.executeEmailPasswordSignup.mockResolvedValue({
      user: { uid: 'user-b', email: 'user-b@example.com' }
    });

    const logout = signOut();
    await vi.waitFor(() => expect(nativeSessionStoreMocks.clearNativeAuthSession).toHaveBeenCalledTimes(1));
    const userBSignIn = signUpWithEmail('user-b@example.com', 'secret1', 'ABCD1234');
    await Promise.resolve();
    expect(legacySignupFlowMocks.executeEmailPasswordSignup).not.toHaveBeenCalled();

    fallbackRemoval.resolve();
    await expect(logout).resolves.toBeUndefined();
    await expect(userBSignIn).resolves.toMatchObject({ user: { uid: 'user-b' } });
    expect(vi.mocked(firebaseSignOutMock).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(legacySignupFlowMocks.executeEmailPasswordSignup).mock.invocationCallOrder[0]
    );
  });

  it('continues queued auth work after a best-effort logout cleanup failure', async () => {
    appDataCacheMocks.flushAppDataCachePersistence.mockRejectedValueOnce(new Error('cache store unavailable'));
    legacySignupFlowMocks.executeEmailPasswordSignup.mockReset();
    legacySignupFlowMocks.executeEmailPasswordSignup.mockResolvedValue({
      user: { uid: 'user-b', email: 'user-b@example.com' }
    });

    const logout = signOut();
    const userBSignIn = signUpWithEmail('user-b@example.com', 'secret1', 'ABCD1234');

    await expect(logout).resolves.toBeUndefined();
    await expect(userBSignIn).resolves.toMatchObject({ user: { uid: 'user-b' } });
    expect(firebaseSignOutMock).toHaveBeenCalledWith(authState);
  });

  it('fails a queued replacement closed when logout times out and finishes late', async () => {
    vi.useFakeTimers();
    const fallbackRemoval = createDeferred<void>();
    nativeSessionStoreMocks.clearNativeAuthSession.mockImplementationOnce(() => fallbackRemoval.promise);
    legacySignupFlowMocks.executeEmailPasswordSignup.mockReset();
    legacySignupFlowMocks.executeEmailPasswordSignup.mockResolvedValue({
      user: { uid: 'user-b', email: 'user-b@example.com' }
    });

    const logout = signOut();
    await Promise.resolve();
    const staleUserBSignIn = signUpWithEmail('user-b@example.com', 'secret1', 'ABCD1234');
    const staleSignInRejection = expect(staleUserBSignIn).rejects.toThrow(
      'still finishing prior account cleanup'
    );

    await vi.advanceTimersByTimeAsync(2_500);
    await expect(logout).resolves.toBeUndefined();
    expect(legacySignupFlowMocks.executeEmailPasswordSignup).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(12_500);
    await staleSignInRejection;
    fallbackRemoval.resolve();
    await vi.runAllTimersAsync();
    expect(legacySignupFlowMocks.executeEmailPasswordSignup).not.toHaveBeenCalled();

    await expect(signUpWithEmail('user-b@example.com', 'secret1', 'ABCD1234'))
      .resolves.toMatchObject({ user: { uid: 'user-b' } });
  });
});

describe('signUpWithEmail', () => {
  beforeEach(() => {
    legacySignupFlowMocks.executeEmailPasswordSignup.mockReset();
    legacySignupFlowMocks.executeEmailPasswordSignup.mockResolvedValue({
      user: { uid: 'new-user', email: 'player@example.com' }
    });
  });

  it('normalizes signup input and delegates to the shared access-code redemption flow', async () => {
    await signUpWithEmail(' Player@Example.COM ', 'secret1', ' 85nsbz7k ');

    expect(legacySignupFlowMocks.executeEmailPasswordSignup).toHaveBeenCalledWith(expect.objectContaining({
      email: 'player@example.com',
      password: 'secret1',
      activationCode: '85NSBZ7K',
      dependencies: expect.objectContaining({
        markAccessCodeAsUsed: legacyAuthMocks.markAccessCodeAsUsed,
        validateAccessCode: legacyAuthMocks.validateAccessCode
      })
    }));
  });

  it('bridges native Firebase signup credentials into the encrypted REST session', async () => {
    const createUserMock = vi.mocked(createUserWithEmailAndPassword);
    createUserMock.mockResolvedValueOnce({
      user: {
        uid: 'new-native-user',
        email: 'player@example.com',
        emailVerified: false,
        refreshToken: 'signup-refresh-token',
        getIdToken: vi.fn(async () => createFirebaseIdToken('new-native-user'))
      }
    });
    nativeSessionStoreMocks.session = null;
    nativeSessionStoreMocks.writeNativeAuthSession.mockClear();

    await signUpWithEmail('player@example.com', 'secret1', '85nsbz7k');
    const signupOptions = legacySignupFlowMocks.executeEmailPasswordSignup.mock.calls[0]?.[0];
    const credential = await signupOptions.dependencies.createUserWithEmailAndPassword(
      authState,
      'player@example.com',
      'secret1'
    );

    expect(credential.nativeRest).toBe(true);
    expect(credential.user).toMatchObject({ uid: 'new-native-user', isNativeRestSession: true });
    expect(nativeSessionStoreMocks.writeNativeAuthSession).toHaveBeenCalledWith(expect.objectContaining({
      uid: 'new-native-user',
      idToken: createFirebaseIdToken('new-native-user'),
      refreshToken: 'signup-refresh-token'
    }));
  });

  it('deletes a failed native signup inline without re-entering its active auth mutation', async () => {
    const createUserMock = vi.mocked(createUserWithEmailAndPassword);
    createUserMock.mockResolvedValueOnce({
      user: {
        uid: 'failed-native-user',
        email: 'player@example.com',
        emailVerified: false,
        refreshToken: 'signup-refresh-token',
        getIdToken: vi.fn(async () => createFirebaseIdToken('failed-native-user'))
      }
    });
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('accounts:delete')) return createJsonResponse({});
      throw new Error(`Unexpected Firebase endpoint: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    nativeSessionStoreMocks.session = null;
    legacySignupFlowMocks.executeEmailPasswordSignup.mockImplementationOnce(async (options: any) => {
      const credential = await options.dependencies.createUserWithEmailAndPassword(
        authState,
        options.email,
        options.password
      );
      await credential.user.delete();
      throw new Error('invite redemption failed');
    });

    await expect(signUpWithEmail('player@example.com', 'secret1', '85nsbz7k'))
      .rejects.toThrow('invite redemption failed');

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('accounts:delete'),
      expect.objectContaining({
        body: JSON.stringify({ idToken: createFirebaseIdToken('failed-native-user') })
      })
    );
    expect(nativeSessionStoreMocks.clearNativeAuthSession).toHaveBeenCalled();
  });

  it('stops invalid signup emails before loading Firebase signup work', async () => {
    await expect(signUpWithEmail('p@paulsnider', 'secret1', '85nsbz7k')).rejects.toThrow('Enter a valid email address.');
    expect(legacySignupFlowMocks.executeEmailPasswordSignup).not.toHaveBeenCalled();
  });
});

describe('native email-link completion', () => {
  beforeEach(() => {
    vi.mocked(isSignInWithEmailLink).mockReset();
    vi.mocked(signInWithEmailLink).mockReset();
  });

  it('moves the one-time Firebase credential into encrypted native persistence', async () => {
    vi.mocked(isSignInWithEmailLink).mockReturnValueOnce(true);
    vi.mocked(signInWithEmailLink).mockResolvedValueOnce({
      user: {
        uid: 'email-link-user',
        email: 'parent@example.com',
        emailVerified: true,
        refreshToken: 'email-link-refresh-token',
        getIdToken: vi.fn(async () => createFirebaseIdToken('email-link-user'))
      }
    });
    legacyAuthMocks.updateUserProfile.mockResolvedValueOnce(undefined);
    nativeSessionStoreMocks.session = null;
    nativeSessionStoreMocks.writeNativeAuthSession.mockClear();

    const credential = await completeEmailLink(
      'parent@example.com',
      'https://allplays.ai/app/#/accept-invite?mode=email-link'
    );

    expect(credential.nativeRest).toBe(true);
    expect(credential.user).toMatchObject({ uid: 'email-link-user', isNativeRestSession: true });
    expect(nativeSessionStoreMocks.writeNativeAuthSession).toHaveBeenCalledWith(expect.objectContaining({
      idToken: createFirebaseIdToken('email-link-user'),
      refreshToken: 'email-link-refresh-token'
    }));
  });

  it('rejects an invalid email-link URL before exchanging credentials', async () => {
    vi.mocked(isSignInWithEmailLink).mockReturnValueOnce(false);

    await expect(completeEmailLink(
      'parent@example.com',
      'https://allplays.ai/app/#/accept-invite?mode=email-link'
    )).rejects.toThrow('invalid or expired');

    expect(signInWithEmailLink).not.toHaveBeenCalled();
  });
});

describe('Firebase action-code validation', () => {
  beforeEach(() => {
    vi.mocked(verifyPasswordResetCode).mockReset();
    vi.mocked(confirmPasswordReset).mockReset();
    vi.mocked(applyActionCode).mockReset();
  });

  it('passes URL-safe Firebase action codes through unchanged', async () => {
    const { verifyResetCode, confirmReset, applyEmailActionCode } = await import('./authService');

    await verifyResetCode('Abc_123-def');
    await confirmReset('Abc_123-def', 'new-password');
    await applyEmailActionCode('Abc_123-def');

    expect(verifyPasswordResetCode).toHaveBeenCalledWith(authState, 'Abc_123-def');
    expect(confirmPasswordReset).toHaveBeenCalledWith(authState, 'Abc_123-def', 'new-password');
    expect(applyActionCode).toHaveBeenCalledWith(authState, 'Abc_123-def');
  });

  it('rejects malformed or oversized action codes before calling Firebase', async () => {
    const { verifyResetCode, confirmReset, applyEmailActionCode } = await import('./authService');

    await expect(verifyResetCode('bad code?')).rejects.toThrow('invalid or incomplete');
    await expect(confirmReset('x'.repeat(2049), 'new-password')).rejects.toThrow('invalid or incomplete');
    await expect(applyEmailActionCode('')).rejects.toThrow('invalid or incomplete');

    expect(verifyPasswordResetCode).not.toHaveBeenCalled();
    expect(confirmPasswordReset).not.toHaveBeenCalled();
    expect(applyActionCode).not.toHaveBeenCalled();
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
    imageUploadSessionMocks.clearImageUploadSession.mockReset();
    imageUploadSessionMocks.clearImageUploadSession.mockResolvedValue(undefined);
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

    expect(legacyInviteFlowMocks.processInvite).toHaveBeenCalledWith(
      'existing-google-user',
      'SITE1234',
      'member@example.com'
    );
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

function installTestSessionStorage() {
  const values = new Map<string, string>();
  Object.defineProperty(window, 'sessionStorage', {
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
    delete (authState as any).emulatorConfig;
    appDataCacheMocks.clearAppDataCache.mockReset();
    legacyAuthMocks.updateUserProfile.mockReset();
    legacyAuthMocks.updateUserProfile.mockResolvedValue(undefined);
    installTestLocalStorage();
    window.localStorage.clear();
    installIndexedDbMock();
    nativeSessionStoreMocks.session = null;
    nativeSessionStoreMocks.readNativeAuthSession.mockClear();
    nativeSessionStoreMocks.writeNativeAuthSession.mockClear();
    nativeSessionStoreMocks.clearNativeAuthSession.mockClear();
    nativeFirebasePersistenceMocks.persistNativeFirebaseAuthUser.mockReset();
    nativeFirebasePersistenceMocks.persistNativeFirebaseAuthUser.mockResolvedValue(undefined);
    imageUploadSessionMocks.clearImageUploadSession.mockReset();
    imageUploadSessionMocks.clearImageUploadSession.mockResolvedValue(undefined);
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('accounts:signInWithPassword')) {
        return createJsonResponse({
          localId: 'new-user',
          email: 'new@example.com',
          idToken: createFirebaseIdToken('new-user'),
          refreshToken: 'new-refresh-token',
          expiresIn: '3600'
        });
      }
      return createJsonResponse({
        users: [{
          localId: 'new-user',
          email: 'new@example.com',
          emailVerified: true,
          displayName: 'New User'
        }]
      });
    }));
  });

  it('clears cached user data before replacing a persisted native REST session with a different uid', async () => {
    nativeSessionStoreMocks.session = {
      uid: 'previous-user',
      email: 'previous@example.com',
      idToken: 'previous-id-token',
      refreshToken: 'previous-refresh-token',
      expirationTime: Date.now() + 3600_000,
      apiKey: 'test-api-key',
      provider: 'rest'
    };

    const result = await signInWithEmail('new@example.com', 'password123');

    expect(result.nativeRest).toBe(true);
    expect(result.user.uid).toBe('new-user');
    expect(appDataCacheMocks.clearAppDataCache).toHaveBeenCalledTimes(1);
    expect(imageUploadSessionMocks.clearImageUploadSession).toHaveBeenCalledTimes(1);
    expect(nativeSessionStoreMocks.writeNativeAuthSession).toHaveBeenCalledWith(expect.objectContaining({
      uid: 'new-user',
      idToken: createFirebaseIdToken('new-user'),
      refreshToken: 'new-refresh-token'
    }));
    expect(window.localStorage.getItem('allplays-native-auth-session')).toBeNull();
    const fetchMock = vi.mocked(fetch);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    fetchMock.mock.calls.forEach(([, options]) => {
      expect(options).toMatchObject({
        method: 'POST',
        cache: 'no-store',
        credentials: 'omit',
        redirect: 'error',
        referrerPolicy: 'no-referrer'
      });
    });
  });

  it('rejects token claims for another Firebase project before persisting the session', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('accounts:signInWithPassword')) {
        return createJsonResponse({
          localId: 'new-user',
          email: 'new@example.com',
          idToken: createFirebaseIdToken('new-user', { aud: 'foreign-project' }),
          refreshToken: 'new-refresh-token',
          expiresIn: '3600'
        });
      }
      return createJsonResponse({ users: [{ localId: 'new-user' }] });
    }));

    await expect(signInWithEmail('new@example.com', 'password123')).rejects.toThrow('unexpected identity');
    expect(nativeSessionStoreMocks.writeNativeAuthSession).not.toHaveBeenCalled();
    expect(nativeFirebasePersistenceMocks.persistNativeFirebaseAuthUser).not.toHaveBeenCalled();
  });

  it('rejects a profile lookup for a different uid before persisting the session', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('accounts:signInWithPassword')) {
        return createJsonResponse({
          localId: 'new-user',
          email: 'new@example.com',
          idToken: createFirebaseIdToken('new-user'),
          refreshToken: 'new-refresh-token',
          expiresIn: '3600'
        });
      }
      return createJsonResponse({ users: [{ localId: 'different-user' }] });
    }));

    await expect(signInWithEmail('new@example.com', 'password123')).rejects.toThrow('did not match');
    expect(nativeSessionStoreMocks.writeNativeAuthSession).not.toHaveBeenCalled();
  });

  it('fails closed and clears the fallback session when secure Firebase persistence fails', async () => {
    nativeFirebasePersistenceMocks.persistNativeFirebaseAuthUser.mockRejectedValueOnce(new Error('keychain locked'));

    await expect(signInWithEmail('new@example.com', 'password123')).rejects.toThrow('keychain locked');

    expect(nativeSessionStoreMocks.writeNativeAuthSession).toHaveBeenCalledTimes(1);
    expect(nativeSessionStoreMocks.clearNativeAuthSession).toHaveBeenCalledTimes(1);
  });

  it('blocks direct production REST calls when Firebase Auth is configured for an emulator', async () => {
    (authState as any).emulatorConfig = { host: '127.0.0.1', port: 9099 };

    await expect(signInWithEmail('new@example.com', 'password123')).rejects.toThrow('emulator is configured');

    expect(fetch).not.toHaveBeenCalled();
    expect(nativeSessionStoreMocks.writeNativeAuthSession).not.toHaveBeenCalled();
  });
});

describe('native restored-session identity checks', () => {
  beforeEach(() => {
    authState.currentUser = null;
    nativeSessionStoreMocks.session = null;
  });

  it('does not restore a cross-project token into authenticated state', async () => {
    nativeSessionStoreMocks.session = {
      uid: 'user-1',
      email: 'user@example.com',
      idToken: createFirebaseIdToken('user-1', { aud: 'foreign-project' }),
      refreshToken: 'refresh-token',
      expirationTime: Date.now() + 3600_000,
      apiKey: 'test-api-key',
      provider: 'rest'
    };

    await expect(getNativeAuthIdToken()).resolves.toBeNull();
  });

  it('restores the expected project and uid token without a forced refresh', async () => {
    const idToken = createFirebaseIdToken('user-1');
    nativeSessionStoreMocks.session = {
      uid: 'user-1',
      email: 'user@example.com',
      idToken,
      refreshToken: 'refresh-token',
      expirationTime: Date.now() + 3600_000,
      apiKey: 'test-api-key',
      provider: 'rest'
    };

    await expect(getNativeAuthIdToken()).resolves.toBe(idToken);
  });
});

describe('observeFirebaseUser', () => {
  beforeEach(() => {
    appDataCacheMocks.clearAppDataCache.mockReset();
    authObserverMocks.onAuthStateChanged.mockReset();
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

  it('clears cached data when the session transitions to signed-out', async () => {
    const emit = wireObserver();
    emit({ uid: 'user-a' });
    emit(null);
    await Promise.resolve();
    await Promise.resolve();
    expect(appDataCacheMocks.clearAppDataCache).toHaveBeenCalledTimes(1);
  });

  it('does not clear the cache on repeated snapshots of the same uid', () => {
    const emit = wireObserver();
    emit({ uid: 'user-a' });
    emit({ uid: 'user-a' });
    expect(appDataCacheMocks.clearAppDataCache).not.toHaveBeenCalled();
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

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
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
