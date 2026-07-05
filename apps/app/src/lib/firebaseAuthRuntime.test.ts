// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

const firebaseAuthSdk = vi.hoisted(() => {
  const resolvedConfig = {
    apiKey: 'api-key',
    authDomain: 'example.firebaseapp.com',
    projectId: 'example',
    messagingSenderId: 'sender',
    appId: 'app-id'
  };

  return {
    resolvedConfig,
    applyActionCode: vi.fn(),
    confirmPasswordReset: vi.fn(),
    createUserWithEmailAndPassword: vi.fn(),
    getApps: vi.fn<() => Array<{ name?: string }>>(() => []),
    getAuth: vi.fn((app: unknown) => ({ app, auth: true })),
    getRedirectResult: vi.fn(),
    GoogleAuthProvider: class {},
    indexedDBLocalPersistence: { type: 'indexedDBLocalPersistence' },
    initializeApp: vi.fn(() => ({ name: '[DEFAULT]', created: true })),
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

vi.mock('./adapters/legacyFirebaseAuthSdk', () => firebaseAuthSdk);

vi.mock('./logger', () => ({
  createLogger: vi.fn(() => ({
    warn: vi.fn()
  }))
}));

describe('firebaseAuthRuntime', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    firebaseAuthSdk.getApps.mockReturnValue([]);
    firebaseAuthSdk.initializeApp.mockReturnValue({ name: '[DEFAULT]', created: true });
    firebaseAuthSdk.getAuth.mockImplementation((app: unknown) => ({ app, auth: true }));
    firebaseAuthSdk.resolvePrimaryFirebaseConfig.mockResolvedValue(firebaseAuthSdk.resolvedConfig);
  });

  it('initializes the default app when only named apps are registered', async () => {
    // The image-upload project registers a named app while the primary config
    // fetch is still awaiting. Only reuse '[DEFAULT]' so named apps cannot
    // break the auth runtime during startup.
    firebaseAuthSdk.getApps.mockReturnValue([{ name: 'game-flow-img' }]);

    const runtime = await import('./firebaseAuthRuntime');

    expect(firebaseAuthSdk.initializeApp).toHaveBeenCalledWith(firebaseAuthSdk.resolvedConfig);
    expect(firebaseAuthSdk.getAuth).toHaveBeenCalledWith({ name: '[DEFAULT]', created: true });
    expect(runtime.auth).toEqual({ app: { name: '[DEFAULT]', created: true }, auth: true });
  });

  it('reuses an existing default app', async () => {
    const existingDefaultApp = { name: '[DEFAULT]' };
    firebaseAuthSdk.getApps.mockReturnValue([{ name: 'game-flow-img' }, existingDefaultApp]);

    await import('./firebaseAuthRuntime');

    expect(firebaseAuthSdk.initializeApp).not.toHaveBeenCalled();
    expect(firebaseAuthSdk.getAuth).toHaveBeenCalledWith(existingDefaultApp);
  });
});
