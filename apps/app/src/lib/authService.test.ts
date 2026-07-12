// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const authState = vi.hoisted(() => ({
  currentUser: null,
  app: {
    options: {
      apiKey: 'test-api-key'
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
  redeemHouseholdInvite: vi.fn(),
  redeemCoParentInvite: vi.fn(),
  markAccessCodeAsUsed: vi.fn(),
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

const parentMembershipMocks = vi.hoisted(() => ({
  mergeApprovedParentMembershipRequests: vi.fn()
}));

const appDataCacheMocks = vi.hoisted(() => ({
  clearAppDataCache: vi.fn()
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
  sendEmailVerification: vi.fn(),
  sendPasswordResetEmail: vi.fn(),
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
  loadLegacyAuthDb: vi.fn(async () => legacyAuthMocks),
  loadLegacyInviteFlow: vi.fn(async () => legacyInviteFlowMocks),
  loadLegacyParentMembershipUtils: vi.fn(async () => parentMembershipMocks),
  loadLegacySignupFlow: vi.fn(async () => legacySignupFlowMocks)
}));

vi.mock('./appDataCache', () => ({
  clearAppDataCache: appDataCacheMocks.clearAppDataCache
}));

vi.mock('./logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  })
}));

import {
  sendPasswordResetEmail,
  signInWithPopup,
  signInWithRedirect
} from './firebaseAuthRuntime';
import { Capacitor } from '@capacitor/core';
import {
  describeAuthError,
  getRouteForUser,
  hydrateFirebaseUser,
  isValidAuthEmail,
  observeFirebaseUser,
  sendResetEmail,
  signInWithEmail,
  signInWithGoogleAccount,
  signOut,
  signUpWithEmail
} from './authService';

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
});

describe('sendResetEmail', () => {
  const sendPasswordResetEmailMock = vi.mocked(sendPasswordResetEmail);

  beforeEach(() => {
    sendPasswordResetEmailMock.mockReset();
  });

  it('normalizes the email and configures the app reset destination', async () => {
    sendPasswordResetEmailMock.mockResolvedValue(undefined);

    await sendResetEmail(' Player@Example.COM ');

    expect(sendPasswordResetEmailMock).toHaveBeenCalledWith(authState, 'player@example.com', {
      url: 'https://allplays.ai/reset-password.html',
      handleCodeInApp: true
    });
  });

  it('treats a missing account like a successful reset request', async () => {
    sendPasswordResetEmailMock.mockRejectedValue({ code: 'auth/user-not-found' });

    await expect(sendResetEmail('missing@example.com')).resolves.toBeUndefined();
  });

  it('preserves actionable reset failures', async () => {
    const error = { code: 'auth/too-many-requests' };
    sendPasswordResetEmailMock.mockRejectedValue(error);

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
    legacyAuthMocks.markAccessCodeAsUsed.mockReset();
    legacyAuthMocks.updateUserProfile.mockReset();
    legacyAuthMocks.updateUserProfile.mockResolvedValue(undefined);
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
    legacyAuthMocks.updateUserProfile.mockReset();
    legacyAuthMocks.updateUserProfile.mockResolvedValue(undefined);
    installTestLocalStorage();
    window.localStorage.clear();
    installIndexedDbMock();
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('accounts:signInWithPassword')) {
        return createJsonResponse({
          localId: 'new-user',
          email: 'new@example.com',
          idToken: 'new-id-token',
          refreshToken: 'new-refresh-token',
          expiresIn: '3600'
        });
      }
      return createJsonResponse({
        users: [{
          email: 'new@example.com',
          emailVerified: true,
          displayName: 'New User'
        }]
      });
    }));
  });

  it('clears cached user data before replacing a persisted native REST session with a different uid', async () => {
    window.localStorage.setItem('allplays-native-auth-session', JSON.stringify({
      uid: 'previous-user',
      email: 'previous@example.com',
      idToken: 'previous-id-token',
      refreshToken: 'previous-refresh-token',
      expirationTime: Date.now() + 3600_000,
      apiKey: 'test-api-key',
      provider: 'rest'
    }));

    const result = await signInWithEmail('new@example.com', 'password123');

    expect(result.nativeRest).toBe(true);
    expect(result.user.uid).toBe('new-user');
    expect(appDataCacheMocks.clearAppDataCache).toHaveBeenCalledTimes(1);
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
