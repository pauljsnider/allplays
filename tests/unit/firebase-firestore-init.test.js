import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const firestoreMocks = vi.hoisted(() => ({
    initializeFirestore: vi.fn(),
    getFirestore: vi.fn(),
    memoryLocalCache: vi.fn(() => ({ kind: 'memoryLocalCache' })),
    persistentLocalCache: vi.fn((options) => ({ kind: 'persistentLocalCache', options })),
    persistentMultipleTabManager: vi.fn(() => ({ kind: 'persistentMultipleTabManager' })),
    clearIndexedDbPersistence: vi.fn(async () => undefined)
}));

const functionsMocks = vi.hoisted(() => ({
    getFunctions: vi.fn(() => ({ kind: 'functions' })),
    httpsCallable: vi.fn()
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
    clearIndexedDbPersistence: firestoreMocks.clearIndexedDbPersistence,
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
    getFunctions: functionsMocks.getFunctions,
    httpsCallable: functionsMocks.httpsCallable
}));

vi.mock('../../js/firebase-app-check.js?v=12', () => ({
    initializePrimaryAppCheck: vi.fn(async () => ({ state: 'skipped' }))
}));

vi.mock('../../js/firebase-runtime-config.js?v=23', () => ({
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
        firestoreMocks.clearIndexedDbPersistence.mockResolvedValue(undefined);
        functionsMocks.getFunctions.mockReturnValue({ kind: 'functions' });
        functionsMocks.httpsCallable.mockImplementation((_instance, name) => {
            expect(name).toBe('getReplayPrivacyMigrationStatus');
            return vi.fn(async () => ({
                data: { ready: true, cacheEpoch: 'private-replay-v2' }
            }));
        });
        delete globalThis.__allplaysFirebaseDb;
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    async function loadFirebaseForWindow(windowValue, cacheSchema = '') {
        vi.stubGlobal('window', windowValue);
        vi.stubGlobal('localStorage', {
            getItem: vi.fn(() => cacheSchema),
            setItem: vi.fn(),
            removeItem: vi.fn()
        });
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
        expect(firestoreMocks.clearIndexedDbPersistence).toHaveBeenCalledWith(module.db);
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
        expect(firestoreMocks.clearIndexedDbPersistence).toHaveBeenCalledWith(module.db);
    });

    it('does not clear a native cache whose epoch matches authoritative ready status', async () => {
        await loadFirebaseForWindow({
            location: { protocol: 'capacitor:', hostname: 'localhost' }
        }, 'private-replay-v2');

        expect(firestoreMocks.clearIndexedDbPersistence).not.toHaveBeenCalled();
    });

    it('keeps adoption builds in memory and does not mark the cache before migration is ready', async () => {
        functionsMocks.httpsCallable.mockReturnValueOnce(vi.fn(async () => ({
            data: { ready: false, cacheEpoch: null }
        })));

        const module = await loadFirebaseForWindow({
            location: { protocol: 'capacitor:', hostname: 'localhost' }
        }, 'private-replay-v2');

        expect(module.db.options.localCache).toEqual({ kind: 'memoryLocalCache' });
        expect(firestoreMocks.persistentLocalCache).not.toHaveBeenCalled();
        expect(firestoreMocks.clearIndexedDbPersistence).toHaveBeenCalledWith(module.db);
        expect(globalThis.localStorage.setItem).not.toHaveBeenCalled();
        expect(globalThis.localStorage.removeItem).toHaveBeenCalledWith('allplays.firestore-cache-schema');
    });

    it('uses memory and clears stale bytes when readiness cannot be verified', async () => {
        functionsMocks.httpsCallable.mockReturnValueOnce(vi.fn(async () => {
            throw Object.assign(new Error('offline'), { code: 'functions/unavailable' });
        }));

        const module = await loadFirebaseForWindow({
            location: { protocol: 'capacitor:', hostname: 'localhost' }
        }, 'private-replay-v2');

        expect(module.db.options.localCache).toEqual({ kind: 'memoryLocalCache' });
        expect(firestoreMocks.clearIndexedDbPersistence).toHaveBeenCalledWith(module.db);
        expect(globalThis.localStorage.setItem).not.toHaveBeenCalled();
    });

    it('fails closed when a retired cache cannot be cleared before first use', async () => {
        firestoreMocks.clearIndexedDbPersistence.mockRejectedValueOnce(
            Object.assign(new Error('Firestore has already started.'), { code: 'failed-precondition' })
        );

        await expect(loadFirebaseForWindow({
            location: { protocol: 'capacitor:', hostname: 'localhost' }
        })).rejects.toMatchObject({
            code: 'firestore-cache-privacy-upgrade-failed'
        });
        expect(globalThis.__allplaysFirebaseDb).toBeUndefined();
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
