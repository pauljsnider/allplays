// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

const firebaseAppMocks = vi.hoisted(() => ({
    app: { name: 'game-flow-img' },
    getApps: vi.fn(),
    initializeApp: vi.fn()
}));

const authMocks = vi.hoisted(() => ({
    auth: { currentUser: null },
    browserSessionPersistence: { type: 'SESSION' },
    inMemoryPersistence: { type: 'NONE' },
    getAuth: vi.fn(),
    onAuthStateChanged: vi.fn(),
    setPersistence: vi.fn(),
    signInAnonymously: vi.fn(),
    signOut: vi.fn()
}));

vi.mock('../../js/vendor/firebase-app.js', () => ({
    getApps: firebaseAppMocks.getApps,
    initializeApp: firebaseAppMocks.initializeApp
}));

vi.mock('../../js/vendor/firebase-storage.js', () => ({
    getStorage: vi.fn(() => ({ bucket: 'secondary-image-project' }))
}));

vi.mock('../../js/vendor/firebase-auth.js', () => ({
    browserSessionPersistence: authMocks.browserSessionPersistence,
    getAuth: authMocks.getAuth,
    inMemoryPersistence: authMocks.inMemoryPersistence,
    onAuthStateChanged: authMocks.onAuthStateChanged,
    setPersistence: authMocks.setPersistence,
    signInAnonymously: authMocks.signInAnonymously,
    signOut: authMocks.signOut
}));

vi.mock('../../js/firebase-runtime-config.js?v=10', () => ({
    resolveImageFirebaseConfig: () => ({ apiKey: 'secondary-image-project-key' })
}));

async function loadImageAuth() {
    vi.resetModules();
    return import('../../js/firebase-images.js');
}

describe('secondary image Firebase Auth persistence', () => {
    beforeEach(() => {
        delete window.Capacitor;
        authMocks.auth.currentUser = null;
        firebaseAppMocks.getApps.mockReset().mockReturnValue([firebaseAppMocks.app]);
        firebaseAppMocks.initializeApp.mockReset().mockReturnValue(firebaseAppMocks.app);
        authMocks.getAuth.mockReset().mockReturnValue(authMocks.auth);
        authMocks.setPersistence.mockReset().mockResolvedValue(undefined);
        authMocks.signOut.mockReset().mockImplementation(async () => {
            authMocks.auth.currentUser = null;
        });
        authMocks.signInAnonymously.mockReset().mockResolvedValue({
            user: { uid: 'fresh-secondary-anonymous-user' }
        });
        authMocks.onAuthStateChanged.mockReset().mockImplementation((_auth, callback) => {
            queueMicrotask(() => callback(authMocks.auth.currentUser));
            return vi.fn();
        });
    });

    it('migrates legacy browser-local Firebase auth state to session persistence before anonymous sign-in', async () => {
        const imageAuth = await loadImageAuth();

        await expect(imageAuth.ensureImageAuth()).resolves.toMatchObject({
            uid: 'fresh-secondary-anonymous-user'
        });

        expect(authMocks.setPersistence).toHaveBeenCalledWith(
            authMocks.auth,
            authMocks.browserSessionPersistence
        );
        expect(authMocks.setPersistence.mock.invocationCallOrder[0]).toBeLessThan(
            authMocks.signInAnonymously.mock.invocationCallOrder[0]
        );
        expect(authMocks.signOut).not.toHaveBeenCalled();
    });

    it('falls back to memory when browser session persistence is unavailable', async () => {
        authMocks.setPersistence.mockImplementation(async (_auth, persistence) => {
            if (persistence === authMocks.browserSessionPersistence) {
                throw new Error('sessionStorage disabled');
            }
        });
        const imageAuth = await loadImageAuth();

        await expect(imageAuth.ensureImageAuth()).resolves.toBeTruthy();

        expect(authMocks.setPersistence).toHaveBeenNthCalledWith(
            1,
            authMocks.auth,
            authMocks.browserSessionPersistence
        );
        expect(authMocks.setPersistence).toHaveBeenNthCalledWith(
            2,
            authMocks.auth,
            authMocks.inMemoryPersistence
        );
    });

    it('uses memory only on native and discards a legacy WebView anonymous user before issuing a fresh one', async () => {
        window.Capacitor = { isNativePlatform: () => true };
        authMocks.auth.currentUser = { uid: 'legacy-indexeddb-user' };
        const imageAuth = await loadImageAuth();

        await expect(imageAuth.ensureImageAuth()).resolves.toMatchObject({
            uid: 'fresh-secondary-anonymous-user'
        });

        expect(authMocks.setPersistence).toHaveBeenCalledWith(authMocks.auth, authMocks.inMemoryPersistence);
        expect(authMocks.signOut).toHaveBeenCalledWith(authMocks.auth);
        expect(authMocks.setPersistence.mock.invocationCallOrder[0]).toBeLessThan(
            authMocks.signOut.mock.invocationCallOrder[0]
        );
        expect(authMocks.signOut.mock.invocationCallOrder[0]).toBeLessThan(
            authMocks.signInAnonymously.mock.invocationCallOrder[0]
        );
    });

    it('fails native image SDK auth closed if memory-only persistence cannot be enabled', async () => {
        window.Capacitor = { isNativePlatform: () => true };
        authMocks.setPersistence.mockRejectedValue(new Error('persistence unavailable'));
        const imageAuth = await loadImageAuth();

        await expect(imageAuth.ensureImageAuth()).resolves.toBeNull();

        expect(authMocks.signInAnonymously).not.toHaveBeenCalled();
        expect(authMocks.signOut).not.toHaveBeenCalled();
    });
});
