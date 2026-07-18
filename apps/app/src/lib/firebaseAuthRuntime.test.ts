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
    indexedDBLocalPersistence: class IndexedDbLocalPersistence {},
    initializeApp: vi.fn(() => ({ name: '[DEFAULT]', created: true })),
    initializePrimaryAppCheck: vi.fn(() => Promise.resolve({ state: 'ready' })),
    initializeAuth: vi.fn(),
    isSignInWithEmailLink: vi.fn(),
    onAuthStateChanged: vi.fn(),
    resolvePrimaryFirebaseConfig: vi.fn(() => Promise.resolve(resolvedConfig)),
    signInWithEmailAndPassword: vi.fn(),
    signInWithEmailLink: vi.fn(),
    signInWithPopup: vi.fn(),
    signInWithRedirect: vi.fn(),
    signOut: vi.fn(),
    setPersistence: vi.fn(),
    updatePassword: vi.fn(),
    verifyPasswordResetCode: vi.fn()
  };
});

const nativePersistenceMock = vi.hoisted(() => ({
  NativeSecureFirebaseAuthPersistence: class NativeSecureFirebaseAuthPersistence {},
  shouldBlockNativeFirebaseAuthMigration: vi.fn(() => false)
}));

vi.mock('./adapters/legacyFirebaseAuthSdk', () => firebaseAuthSdk);
vi.mock('./nativeFirebaseAuthPersistence', () => nativePersistenceMock);

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
    firebaseAuthSdk.initializePrimaryAppCheck.mockResolvedValue({ state: 'ready' });
    firebaseAuthSdk.getAuth.mockImplementation((app: unknown) => ({ app, auth: true }));
    firebaseAuthSdk.initializeAuth.mockImplementation((app: unknown) => ({ app, nativeAuth: true }));
    firebaseAuthSdk.setPersistence.mockResolvedValue(undefined);
    firebaseAuthSdk.signOut.mockResolvedValue(undefined);
    firebaseAuthSdk.resolvePrimaryFirebaseConfig.mockResolvedValue(firebaseAuthSdk.resolvedConfig);
    nativePersistenceMock.shouldBlockNativeFirebaseAuthMigration.mockReset();
    nativePersistenceMock.shouldBlockNativeFirebaseAuthMigration.mockReturnValue(false);
    Object.defineProperty(window, 'Capacitor', {
      configurable: true,
      value: undefined
    });
  });

  it('initializes the default app when only named apps are registered', async () => {
    // The image-upload project registers a named app while the primary config
    // fetch is still awaiting. Only reuse '[DEFAULT]' so named apps cannot
    // break the auth runtime during startup.
    firebaseAuthSdk.getApps.mockReturnValue([{ name: 'game-flow-img' }]);

    const runtime = await import('./firebaseAuthRuntime');

    expect(firebaseAuthSdk.initializeApp).toHaveBeenCalledWith(firebaseAuthSdk.resolvedConfig);
    expect(firebaseAuthSdk.initializePrimaryAppCheck).toHaveBeenCalledWith({ name: '[DEFAULT]', created: true });
    expect(firebaseAuthSdk.getAuth).toHaveBeenCalledWith({ name: '[DEFAULT]', created: true });
    expect(runtime.auth).toEqual({ app: { name: '[DEFAULT]', created: true }, auth: true });
  });

  it('reuses an existing default app', async () => {
    const existingDefaultApp = { name: '[DEFAULT]' };
    firebaseAuthSdk.getApps.mockReturnValue([{ name: 'game-flow-img' }, existingDefaultApp]);

    await import('./firebaseAuthRuntime');

    expect(firebaseAuthSdk.initializeApp).not.toHaveBeenCalled();
    expect(firebaseAuthSdk.initializePrimaryAppCheck).toHaveBeenCalledWith(existingDefaultApp);
    expect(firebaseAuthSdk.getAuth).toHaveBeenCalledWith(existingDefaultApp);
  });

  it('uses encrypted native persistence with IndexedDB available only as a migration source', async () => {
    Object.defineProperty(window, 'Capacitor', {
      configurable: true,
      value: { isNativePlatform: () => true }
    });

    const runtime = await import('./firebaseAuthRuntime');

    expect(firebaseAuthSdk.initializeAuth).toHaveBeenCalledWith(
      { name: '[DEFAULT]', created: true },
      {
        persistence: [
          nativePersistenceMock.NativeSecureFirebaseAuthPersistence,
          firebaseAuthSdk.indexedDBLocalPersistence
        ]
      }
    );
    expect(runtime.auth).toEqual({ app: { name: '[DEFAULT]', created: true }, nativeAuth: true });
  });

  it('omits IndexedDB from the native hierarchy while a signed-out tombstone is active', async () => {
    Object.defineProperty(window, 'Capacitor', {
      configurable: true,
      value: { isNativePlatform: () => true }
    });
    nativePersistenceMock.shouldBlockNativeFirebaseAuthMigration.mockReturnValue(true);

    await import('./firebaseAuthRuntime');

    expect(nativePersistenceMock.shouldBlockNativeFirebaseAuthMigration)
      .toHaveBeenCalledWith('api-key', '[DEFAULT]');
    expect(firebaseAuthSdk.initializeAuth).toHaveBeenCalledWith(
      { name: '[DEFAULT]', created: true },
      { persistence: [nativePersistenceMock.NativeSecureFirebaseAuthPersistence] }
    );
  });

  it('forces an already initialized native auth instance onto encrypted native persistence', async () => {
    Object.defineProperty(window, 'Capacitor', {
      configurable: true,
      value: { isNativePlatform: () => true }
    });
    firebaseAuthSdk.initializeAuth.mockImplementation(() => {
      throw new Error('already initialized');
    });
    const existingAuth = { app: null, auth: true, existing: true };
    firebaseAuthSdk.getAuth.mockReturnValue(existingAuth);

    const runtime = await import('./firebaseAuthRuntime');

    expect(firebaseAuthSdk.setPersistence).toHaveBeenCalledWith(
      existingAuth,
      nativePersistenceMock.NativeSecureFirebaseAuthPersistence
    );
    expect(runtime.auth).toBe(existingAuth);
  });

  it('clears an already initialized IndexedDB user before applying secure persistence when tombstoned', async () => {
    Object.defineProperty(window, 'Capacitor', {
      configurable: true,
      value: { isNativePlatform: () => true }
    });
    nativePersistenceMock.shouldBlockNativeFirebaseAuthMigration.mockReturnValue(true);
    firebaseAuthSdk.initializeAuth.mockImplementation(() => {
      throw new Error('already initialized');
    });
    const existingAuth = { app: null, auth: true, currentUser: { uid: 'user-a' } };
    firebaseAuthSdk.getAuth.mockReturnValue(existingAuth);

    await import('./firebaseAuthRuntime');

    expect(firebaseAuthSdk.signOut).toHaveBeenCalledWith(existingAuth);
    expect(firebaseAuthSdk.setPersistence).toHaveBeenCalledWith(
      existingAuth,
      nativePersistenceMock.NativeSecureFirebaseAuthPersistence
    );
    expect(firebaseAuthSdk.signOut.mock.invocationCallOrder[0])
      .toBeLessThan(firebaseAuthSdk.setPersistence.mock.invocationCallOrder[0]);
  });
});
