// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

const legacySdkMock = vi.hoisted(() => {
  const resolvedConfig = { projectId: 'primary-project' };
  return {
    resolvedConfig,
    applyActionCode: vi.fn(),
    confirmPasswordReset: vi.fn(),
    createUserWithEmailAndPassword: vi.fn(),
    getApps: vi.fn<() => Array<{ name: string }>>(() => []),
    getAuth: vi.fn((app: unknown) => ({ app })),
    getRedirectResult: vi.fn(),
    GoogleAuthProvider: class {},
    indexedDBLocalPersistence: {},
    initializeApp: vi.fn(() => ({ name: '[DEFAULT]', initialized: true })),
    initializeAuth: vi.fn(),
    isSignInWithEmailLink: vi.fn(),
    onAuthStateChanged: vi.fn(),
    resolvePrimaryFirebaseConfig: vi.fn(() => Promise.resolve(resolvedConfig)),
    sendEmailVerification: vi.fn(),
    sendPasswordResetEmail: vi.fn(),
    signInWithEmailAndPassword: vi.fn(),
    signInWithEmailLink: vi.fn(),
    signInWithPopup: vi.fn(),
    signInWithRedirect: vi.fn(),
    signOut: vi.fn(),
    updatePassword: vi.fn(),
    verifyPasswordResetCode: vi.fn()
  };
});

vi.mock('./adapters/legacyFirebaseAuthSdk', () => legacySdkMock);

describe('firebaseAuthRuntime', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('initializes the default app when only named apps are registered', async () => {
    // The image-upload project registers a named app while the primary config
    // fetch is still awaiting. getApp() on a registry with no '[DEFAULT]' app
    // throws app/no-app and killed the whole module graph (blank screen).
    legacySdkMock.getApps.mockReturnValue([{ name: 'game-flow-img' }]);

    await import('./firebaseAuthRuntime');

    expect(legacySdkMock.initializeApp).toHaveBeenCalledWith(legacySdkMock.resolvedConfig);
    expect(legacySdkMock.getAuth).toHaveBeenCalledWith({ name: '[DEFAULT]', initialized: true });
  });

  it('reuses an existing default app', async () => {
    const defaultApp = { name: '[DEFAULT]' };
    legacySdkMock.getApps.mockReturnValue([{ name: 'game-flow-img' }, defaultApp]);

    await import('./firebaseAuthRuntime');

    expect(legacySdkMock.initializeApp).not.toHaveBeenCalled();
    expect(legacySdkMock.getAuth).toHaveBeenCalledWith(defaultApp);
  });
});
