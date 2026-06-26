// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

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
  getUserTeams: vi.fn()
}));

const parentMembershipMocks = vi.hoisted(() => ({
  mergeApprovedParentMembershipRequests: vi.fn()
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
  onAuthStateChanged: vi.fn(),
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
  loadLegacyAdminInvite: vi.fn(),
  loadLegacyAuthDb: vi.fn(async () => legacyAuthMocks),
  loadLegacyInviteFlow: vi.fn(),
  loadLegacyParentMembershipUtils: vi.fn(async () => parentMembershipMocks),
  loadLegacySignupFlow: vi.fn()
}));

vi.mock('./logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  })
}));

import { hydrateFirebaseUser } from './authService';

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
