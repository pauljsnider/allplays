// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const capacitorMocks = vi.hoisted(() => ({
  isNativePlatform: vi.fn(() => false),
  isPluginAvailable: vi.fn(() => false)
}));

const firebaseAuthRuntimeMocks = vi.hoisted(() => ({
  auth: { currentUser: null },
  applyActionCode: vi.fn(),
  confirmPasswordReset: vi.fn(),
  createUserWithEmailAndPassword: vi.fn(),
  getRedirectResult: vi.fn(),
  GoogleAuthProvider: vi.fn(function GoogleAuthProvider(this: Record<string, unknown>) {
    this.addScope = vi.fn();
  }),
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

const dbMocks = vi.hoisted(() => ({
  validateAccessCode: vi.fn(),
  redeemParentInvite: vi.fn(),
  redeemHouseholdInvite: vi.fn(),
  redeemAdminInviteAtomically: vi.fn(),
  markAccessCodeAsUsed: vi.fn(),
  updateUserProfile: vi.fn(),
  getTeam: vi.fn(),
  getUserProfile: vi.fn()
}));

const adminInviteMocks = vi.hoisted(() => ({
  redeemAdminInviteAcceptance: vi.fn()
}));

vi.mock('@capacitor/core', () => ({
  Capacitor: capacitorMocks
}));

vi.mock('@capacitor-firebase/authentication', () => ({
  FirebaseAuthentication: {
    signInWithGoogle: vi.fn()
  }
}));

vi.mock('./firebaseAuthRuntime', () => firebaseAuthRuntimeMocks);
vi.mock('../../../../js/db.js', () => dbMocks);
vi.mock('../../../../js/admin-invite.js', () => adminInviteMocks);
vi.mock('../../../../js/accept-invite-flow.js', () => ({
  createInviteProcessor: vi.fn()
}));
vi.mock('../../../../js/signup-flow.js', () => ({
  executeEmailPasswordSignup: vi.fn()
}));
vi.mock('../../../../js/parent-membership-utils.js', () => ({
  mergeApprovedParentMembershipRequests: vi.fn(() => ({ changed: false, userUpdate: {} }))
}));

const libDir = dirname(fileURLToPath(import.meta.url));
const authServicePath = resolve(libDir, 'authService.ts');
const appTsconfigPath = resolve(libDir, '../../tsconfig.json');

function createGoogleUser(overrides: Record<string, unknown> = {}) {
  return {
    uid: 'google-user-1',
    email: 'parent@example.com',
    displayName: 'Pat Parent',
    photoURL: '',
    isNewUser: true,
    delete: vi.fn().mockResolvedValue(undefined),
    ...overrides
  };
}

describe('app auth invite activation', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    window.sessionStorage.clear();
    capacitorMocks.isNativePlatform.mockReturnValue(false);
    firebaseAuthRuntimeMocks.signOut.mockResolvedValue(undefined);
    dbMocks.validateAccessCode.mockResolvedValue({
      valid: true,
      type: 'parent_invite',
      codeId: 'code-parent-1',
      data: {
        code: 'ABCDEFGH',
        type: 'parent_invite'
      }
    });
    dbMocks.redeemParentInvite.mockResolvedValue({ success: true, teamId: 'team-1' });
    dbMocks.markAccessCodeAsUsed.mockResolvedValue(undefined);
    dbMocks.updateUserProfile.mockResolvedValue(undefined);
    dbMocks.getTeam.mockResolvedValue({ id: 'team-1', name: 'Bears' });
    dbMocks.getUserProfile.mockResolvedValue({ email: 'parent@example.com' });
    adminInviteMocks.redeemAdminInviteAcceptance.mockResolvedValue({ id: 'team-1', name: 'Bears' });
  });

  it('keeps the legacy auth db graph lazy until an auth db flow is needed', () => {
    const authServiceSource = readFileSync(authServicePath, 'utf8');

    expect(authServiceSource).not.toContain("import * as authDb from '../../../../js/db.js';");
    expect(authServiceSource).toContain("authDbPromise ||= import('../../../../js/db.js');");
    expect(authServiceSource).not.toContain('return Promise.resolve(authDb);');
  });

  it('includes node types in the app tsconfig for source-inspection auth tests', () => {
    const tsconfig = JSON.parse(readFileSync(appTsconfigPath, 'utf8')) as {
      compilerOptions?: { types?: string[] };
    };

    expect(tsconfig.compilerOptions?.types).toContain('node');
  });

  it('redeems a Google parent invite using generic pre-auth validation state', async () => {
    const user = createGoogleUser();
    firebaseAuthRuntimeMocks.signInWithPopup.mockResolvedValue({ user });
    const { signInWithGoogleAccount } = await import('./authService');

    await signInWithGoogleAccount('ABCDEFGH');

    expect(dbMocks.validateAccessCode).toHaveBeenCalledWith('ABCDEFGH');
    expect(dbMocks.redeemParentInvite).toHaveBeenCalledWith('google-user-1', 'ABCDEFGH', 'parent@example.com');
    expect(dbMocks.redeemParentInvite.mock.calls[0][1]).toBe('ABCDEFGH');
    expect(dbMocks.updateUserProfile).toHaveBeenCalledWith('google-user-1', expect.objectContaining({
      email: 'parent@example.com',
      fullName: 'Pat Parent'
    }));
  });

  it('rejects a mismatched Google admin invite during authenticated redemption', async () => {
    const user = createGoogleUser({
      uid: 'google-admin-1',
      email: 'other@example.com'
    });
    const mismatchError = new Error('This invite was sent to coach@example.com. Sign in with that email to accept it.');
    firebaseAuthRuntimeMocks.signInWithPopup.mockResolvedValue({ user });
    dbMocks.validateAccessCode.mockResolvedValue({
      valid: true,
      type: 'admin_invite',
      codeId: 'code-admin-1',
      data: {
        code: 'ADMIN123',
        type: 'admin_invite'
      }
    });
    adminInviteMocks.redeemAdminInviteAcceptance.mockRejectedValue(mismatchError);
    const { signInWithGoogleAccount } = await import('./authService');

    await expect(signInWithGoogleAccount('ADMIN123')).rejects.toThrow(mismatchError.message);

    expect(adminInviteMocks.redeemAdminInviteAcceptance).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'google-admin-1',
      userEmail: 'other@example.com',
      codeId: 'code-admin-1'
    }));
    expect(adminInviteMocks.redeemAdminInviteAcceptance.mock.calls[0][0]).not.toHaveProperty('teamId');
    expect(user.delete).toHaveBeenCalledTimes(1);
    expect(firebaseAuthRuntimeMocks.signOut).toHaveBeenCalledWith(firebaseAuthRuntimeMocks.auth);
  });
});
