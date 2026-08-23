import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const firestoreMocks = vi.hoisted(() => ({
    initializeFirestore: vi.fn(),
    getFirestore: vi.fn(),
    memoryLocalCache: vi.fn(() => ({ kind: 'memoryLocalCache' })),
    persistentLocalCache: vi.fn((options) => ({ kind: 'persistentLocalCache', options })),
    persistentMultipleTabManager: vi.fn(() => ({ kind: 'persistentMultipleTabManager' }))
}));

vi.mock('../../js/vendor/firebase-app.js', () => ({
    getApps: vi.fn(() => []),
    initializeApp: vi.fn((config) => ({ name: '[DEFAULT]', options: config }))
}));

vi.mock('../../js/vendor/firebase-auth.js', () => ({
    getAuth: vi.fn(() => ({ currentUser: null })),
    indexedDBLocalPersistence: { kind: 'indexedDBLocalPersistence' },
    initializeAuth: vi.fn(() => ({ currentUser: null })),
    onAuthStateChanged: vi.fn(),
    signInWithEmailAndPassword: vi.fn(),
    createUserWithEmailAndPassword: vi.fn(),
    signOut: vi.fn(),
    GoogleAuthProvider: class GoogleAuthProvider {},
    signInWithCredential: vi.fn(),
    signInWithPopup: vi.fn(),
    signInWithRedirect: vi.fn(),
    getRedirectResult: vi.fn(),
    sendPasswordResetEmail: vi.fn(),
    sendEmailVerification: vi.fn(),
    sendSignInLinkToEmail: vi.fn(),
    isSignInWithEmailLink: vi.fn(),
    signInWithEmailLink: vi.fn(),
    updatePassword: vi.fn(),
    verifyPasswordResetCode: vi.fn(),
    confirmPasswordReset: vi.fn(),
    applyActionCode: vi.fn()
}));

vi.mock('../../js/vendor/firebase-firestore.js', () => ({
    initializeFirestore: firestoreMocks.initializeFirestore,
    getFirestore: firestoreMocks.getFirestore,
    memoryLocalCache: firestoreMocks.memoryLocalCache,
    persistentLocalCache: firestoreMocks.persistentLocalCache,
    persistentMultipleTabManager: firestoreMocks.persistentMultipleTabManager,
    collection: vi.fn(),
    getDocs: vi.fn(),
    getDoc: vi.fn(),
    doc: vi.fn(),
    addDoc: vi.fn(),
    updateDoc: vi.fn(),
    deleteDoc: vi.fn(),
    setDoc: vi.fn(),
    query: vi.fn(),
    where: vi.fn(),
    orderBy: vi.fn(),
    Timestamp: { now: vi.fn() },
    increment: vi.fn(),
    arrayUnion: vi.fn(),
    arrayRemove: vi.fn(),
    deleteField: vi.fn(),
    limit: vi.fn(),
    startAfter: vi.fn(),
    getCountFromServer: vi.fn(),
    onSnapshot: vi.fn(),
    serverTimestamp: vi.fn(),
    collectionGroup: vi.fn(),
    documentId: vi.fn(),
    writeBatch: vi.fn(),
    runTransaction: vi.fn()
}));

vi.mock('../../js/vendor/firebase-storage.js', () => ({
    getStorage: vi.fn(() => ({ kind: 'storage' })),
    ref: vi.fn(),
    uploadBytes: vi.fn(),
    getDownloadURL: vi.fn(),
    deleteObject: vi.fn()
}));

vi.mock('../../js/vendor/firebase-functions.js', () => ({
    getFunctions: vi.fn(() => ({ kind: 'functions' })),
    httpsCallable: vi.fn()
}));

vi.mock('../../js/firebase-app-check.js?v=6', () => ({
    initializePrimaryAppCheck: vi.fn(async () => ({ state: 'skipped' }))
}));

vi.mock('../../js/firebase-runtime-config.js?v=17', () => ({
    resolvePrimaryFirebaseConfig: vi.fn(async () => ({
        apiKey: 'test-key',
        authDomain: 'example.test',
        projectId: 'test-project',
        messagingSenderId: '123',
        appId: 'app-123'
    }))
}));

describe('firebase firestore initialization', () => {
    beforeEach(() => {
        vi.resetModules();
        vi.clearAllMocks();
        firestoreMocks.initializeFirestore.mockImplementation((_app, options) => ({
            kind: 'initialized-firestore',
            options
        }));
        firestoreMocks.getFirestore.mockReturnValue({ kind: 'default-firestore' });
        firestoreMocks.memoryLocalCache.mockImplementation(() => ({ kind: 'memoryLocalCache' }));
        firestoreMocks.persistentLocalCache.mockImplementation((options) => ({
            kind: 'persistentLocalCache',
            options
        }));
        firestoreMocks.persistentMultipleTabManager.mockImplementation(() => ({
            kind: 'persistentMultipleTabManager'
        }));
        delete globalThis.__allplaysFirebaseDb;
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    async function loadFirebaseForWindow(windowValue) {
        vi.stubGlobal('window', windowValue);
        return import('../../js/firebase.js?v=27');
    }

    it.each([
        ['canonical web', { location: { protocol: 'https:', hostname: 'allplays.ai' } }],
        ['local web development', { location: { protocol: 'http:', hostname: 'localhost' } }]
    ])('uses memory-only Firestore caching for %s', async (_label, windowValue) => {
        const module = await loadFirebaseForWindow(windowValue);

        expect(module.db).toEqual({
            kind: 'initialized-firestore',
            options: { localCache: { kind: 'memoryLocalCache' } }
        });
        expect(firestoreMocks.memoryLocalCache).toHaveBeenCalledTimes(1);
        expect(firestoreMocks.persistentLocalCache).not.toHaveBeenCalled();
        expect(firestoreMocks.persistentMultipleTabManager).not.toHaveBeenCalled();
    });

    it.each([
        ['Capacitor protocol', { location: { protocol: 'capacitor:', hostname: 'localhost' } }],
        ['Ionic protocol', { location: { protocol: 'ionic:', hostname: 'localhost' } }],
        ['Android cold start before bridge injection', { location: { protocol: 'https:', hostname: 'localhost' } }],
        ['Capacitor native bridge', {
            location: { protocol: 'https:', hostname: 'allplays.ai' },
            Capacitor: { isNativePlatform: () => true }
        }],
        ['Capacitor iOS platform fallback', {
            location: { protocol: 'https:', hostname: 'allplays.ai' },
            Capacitor: { getPlatform: () => 'ios' }
        }],
        ['Capacitor Android platform fallback', {
            location: { protocol: 'https:', hostname: 'allplays.ai' },
            Capacitor: { getPlatform: () => 'android' }
        }]
    ])('preserves persistent Firestore caching for %s', async (_label, windowValue) => {
        const module = await loadFirebaseForWindow(windowValue);

        expect(module.db).toEqual({
            kind: 'initialized-firestore',
            options: {
                localCache: {
                    kind: 'persistentLocalCache',
                    options: {
                        tabManager: { kind: 'persistentMultipleTabManager' }
                    }
                }
            }
        });
        expect(firestoreMocks.memoryLocalCache).not.toHaveBeenCalled();
        expect(firestoreMocks.persistentMultipleTabManager).toHaveBeenCalledTimes(1);
        expect(firestoreMocks.persistentLocalCache).toHaveBeenCalledWith({
            tabManager: { kind: 'persistentMultipleTabManager' }
        });
    });

    it('reuses the existing global Firestore instance without constructing another cache', async () => {
        const existingDb = { kind: 'shared-db' };
        globalThis.__allplaysFirebaseDb = existingDb;

        const module = await loadFirebaseForWindow({
            location: { protocol: 'https:', hostname: 'allplays.ai' }
        });

        expect(module.db).toBe(existingDb);
        expect(firestoreMocks.initializeFirestore).not.toHaveBeenCalled();
        expect(firestoreMocks.memoryLocalCache).not.toHaveBeenCalled();
        expect(firestoreMocks.persistentLocalCache).not.toHaveBeenCalled();
    });

    it('falls back to getFirestore when initializeFirestore was already called elsewhere', async () => {
        const existingDb = { kind: 'existing-db' };
        firestoreMocks.initializeFirestore.mockImplementation(() => {
            const error = new Error('initializeFirestore() has already been called with different options.');
            error.code = 'failed-precondition';
            throw error;
        });
        firestoreMocks.getFirestore.mockReturnValue(existingDb);

        const module = await loadFirebaseForWindow({
            location: { protocol: 'https:', hostname: 'allplays.ai' }
        });

        expect(module.db).toBe(existingDb);
        expect(firestoreMocks.initializeFirestore).toHaveBeenCalledTimes(1);
        expect(firestoreMocks.getFirestore).toHaveBeenCalledTimes(1);
        expect(globalThis.__allplaysFirebaseDb).toBe(existingDb);
    });

    it('does not mask an unrelated failed-precondition initialization error', async () => {
        const initializationError = Object.assign(
            new Error('Persistent cache could not obtain exclusive access.'),
            { code: 'failed-precondition' }
        );
        firestoreMocks.initializeFirestore.mockImplementation(() => {
            throw initializationError;
        });

        await expect(loadFirebaseForWindow({
            location: { protocol: 'https:', hostname: 'allplays.ai' }
        })).rejects.toBe(initializationError);
        expect(firestoreMocks.getFirestore).not.toHaveBeenCalled();
    });

    it('propagates unexpected Firestore initialization failures', async () => {
        const initializationError = new Error('IndexedDB is unavailable.');
        firestoreMocks.initializeFirestore.mockImplementation(() => {
            throw initializationError;
        });

        await expect(loadFirebaseForWindow({
            location: { protocol: 'https:', hostname: 'allplays.ai' }
        })).rejects.toBe(initializationError);
        expect(firestoreMocks.getFirestore).not.toHaveBeenCalled();
    });
});
