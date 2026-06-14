import { beforeEach, describe, expect, it, vi } from 'vitest';

const firestoreMocks = vi.hoisted(() => ({
    initializeFirestore: vi.fn(),
    getFirestore: vi.fn(),
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

vi.mock('../../js/firebase-runtime-config.js?v=8', () => ({
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
        delete globalThis.__allplaysFirebaseDb;
    });

    it('falls back to getFirestore when initializeFirestore was already called elsewhere', async () => {
        const existingDb = { kind: 'existing-db' };
        firestoreMocks.initializeFirestore.mockImplementation(() => {
            const error = new Error('initializeFirestore() has already been called with different options.');
            error.code = 'failed-precondition';
            throw error;
        });
        firestoreMocks.getFirestore.mockReturnValue(existingDb);

        const module = await import('../../js/firebase.js?v=18');

        expect(module.db).toBe(existingDb);
        expect(firestoreMocks.initializeFirestore).toHaveBeenCalledTimes(1);
        expect(firestoreMocks.getFirestore).toHaveBeenCalledTimes(1);
        expect(globalThis.__allplaysFirebaseDb).toBe(existingDb);
    });
});
