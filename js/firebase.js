import { getApps, initializeApp } from "./vendor/firebase-app.js";
import {
    getAuth,
    indexedDBLocalPersistence,
    initializeAuth,
    onAuthStateChanged,
    signInWithEmailAndPassword,
    createUserWithEmailAndPassword,
    signOut,
    GoogleAuthProvider,
    signInWithCredential,
    signInWithPopup,
    signInWithRedirect,
    getRedirectResult,
    isSignInWithEmailLink,
    signInWithEmailLink,
    updatePassword,
    verifyPasswordResetCode,
    confirmPasswordReset,
    applyActionCode
} from "./vendor/firebase-auth.js";
import {
    getFirestore,
    initializeFirestore,
    clearIndexedDbPersistence,
    memoryLocalCache,
    persistentLocalCache,
    persistentMultipleTabManager,
    collection,
    getDocs,
    getDoc,
    doc,
    addDoc,
    updateDoc,
    deleteDoc,
    setDoc,
    query,
    where,
    orderBy,
    Timestamp,
    increment,
    arrayUnion,
    arrayRemove,
    deleteField,
    limit,
    startAfter,
    getCountFromServer,
    onSnapshot,
    serverTimestamp,
    collectionGroup,
    documentId,
    writeBatch,
    runTransaction
} from "./vendor/firebase-firestore.js";
import { getStorage, ref, uploadBytes, getDownloadURL, deleteObject } from "./vendor/firebase-storage.js";
import { getFunctions, httpsCallable } from "./vendor/firebase-functions.js";
import { initializePrimaryAppCheck } from "./firebase-app-check.js?v=12";
import { resolvePrimaryFirebaseConfig } from "./firebase-runtime-config.js?v=23";

const firebaseConfig = await resolvePrimaryFirebaseConfig();

const existingDefaultApp = getApps().find((candidate) => candidate.name === '[DEFAULT]');
const app = existingDefaultApp || initializeApp(firebaseConfig);
export const appCheckReady = initializePrimaryAppCheck(app);
await appCheckReady;
const FIRESTORE_CACHE_PRIVACY_EPOCH_KEY = 'allplays.firestore-cache-schema';
const REPLAY_PRIVACY_CACHE_EPOCH = 'private-replay-v2';
const replayPrivacyFunctions = getFunctions(app);
function isCapacitorNativeRuntime() {
    const protocol = typeof window !== 'undefined' ? window.location?.protocol : '';
    if (protocol === 'capacitor:' || protocol === 'ionic:') {
        return true;
    }
    const capacitor = typeof window !== 'undefined' ? window.Capacitor : null;
    if (!capacitor) {
        return false;
    }
    if (typeof capacitor.isNativePlatform === 'function') {
        return capacitor.isNativePlatform();
    }
    return capacitor.getPlatform?.() === 'ios' || capacitor.getPlatform?.() === 'android';
}

function isCapacitorNativeFirestoreRuntime() {
    if (isCapacitorNativeRuntime()) {
        return true;
    }
    const protocol = typeof window !== 'undefined' ? window.location?.protocol : '';
    const hostname = typeof window !== 'undefined' ? window.location?.hostname : '';
    // Capacitor serves the Android bundle from https://localhost. The native
    // bridge may not be injected yet when this shared module initializes.
    return protocol === 'https:' && hostname === 'localhost';
}

function createFirestoreLocalCache(privacyState) {
    if (isCapacitorNativeFirestoreRuntime() && privacyState?.ready === true) {
        return persistentLocalCache({ tabManager: persistentMultipleTabManager() });
    }
    // Browser tabs always use memory. Native adoption builds also use memory
    // until the server proves the replay migration is complete, preventing a
    // pre-gate cache from being repopulated after it is cleared.
    return memoryLocalCache();
}

function initializeFirebaseAuth(appInstance) {
    if (!isCapacitorNativeRuntime()) {
        return getAuth(appInstance);
    }

    try {
        return initializeAuth(appInstance, {
            persistence: indexedDBLocalPersistence
        });
    } catch (error) {
        console.warn('[firebase] Native auth initialization fell back to getAuth:', error);
        return getAuth(appInstance);
    }
}

function getFirestoreCachePrivacyEpoch() {
    try {
        return globalThis?.localStorage?.getItem(FIRESTORE_CACHE_PRIVACY_EPOCH_KEY) || '';
    } catch {
        return '';
    }
}

function markFirestoreCachePrivacyEpoch(epoch) {
    try {
        globalThis?.localStorage?.setItem(
            FIRESTORE_CACHE_PRIVACY_EPOCH_KEY,
            epoch
        );
    } catch {
        // When durable marker storage is unavailable, the next cold start
        // clears again. Repeating a pre-use clear is safer than retaining a
        // cache that could contain a retired replay capability.
    }
}

function forgetFirestoreCachePrivacyEpoch() {
    try {
        globalThis?.localStorage?.removeItem(FIRESTORE_CACHE_PRIVACY_EPOCH_KEY);
    } catch {
        // A missing marker forces another safe clear on the next cold start.
    }
}

function normalizeReplayPrivacyMigrationStatus(value) {
    const data = value?.data;
    if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
    if (data.ready === false && data.cacheEpoch === null) {
        return { ready: false, cacheEpoch: null };
    }
    if (data.ready === true && data.cacheEpoch === REPLAY_PRIVACY_CACHE_EPOCH) {
        return { ready: true, cacheEpoch: REPLAY_PRIVACY_CACHE_EPOCH };
    }
    return null;
}

async function loadReplayPrivacyMigrationStatus() {
    try {
        const response = await httpsCallable(
            replayPrivacyFunctions,
            'getReplayPrivacyMigrationStatus'
        )({});
        const status = normalizeReplayPrivacyMigrationStatus(response);
        if (status) return status;
    } catch (error) {
        console.warn('[firebase] Replay privacy readiness is unavailable; using an uncached session.', error);
    }
    // An unreadable or malformed readiness result is never permission to
    // reuse persistent bytes. The caller clears the old database and runs in
    // memory without recording a durable success marker.
    return { ready: false, cacheEpoch: null };
}

async function clearRetiredFirestoreCache(firestore, privacyState) {
    const reusableEpoch = privacyState?.ready === true
        ? privacyState.cacheEpoch
        : null;
    if (reusableEpoch && getFirestoreCachePrivacyEpoch() === reusableEpoch) {
        return;
    }

    try {
        await clearIndexedDbPersistence(firestore);
        if (reusableEpoch) markFirestoreCachePrivacyEpoch(reusableEpoch);
        else forgetFirestoreCachePrivacyEpoch();
    } catch (error) {
        const privacyError = new Error(
            'The data cache could not be upgraded safely. Close other AllPlays windows and reopen the app.'
        );
        privacyError.code = 'firestore-cache-privacy-upgrade-failed';
        privacyError.cause = error;
        throw privacyError;
    }
}

async function initializeFirebaseDb(appInstance, privacyState) {
    const globalDbKey = '__allplaysFirebaseDb';
    const existingDb = globalThis?.[globalDbKey];
    if (existingDb) {
        await clearRetiredFirestoreCache(existingDb, privacyState);
        return existingDb;
    }

    try {
        const firestore = initializeFirestore(appInstance, {
            localCache: createFirestoreLocalCache(privacyState)
        });
        await clearRetiredFirestoreCache(firestore, privacyState);
        globalThis[globalDbKey] = firestore;
        return firestore;
    } catch (error) {
        const alreadyInitialized = error?.code === 'failed-precondition'
            && String(error?.message || '').includes('initializeFirestore() has already been called');
        if (alreadyInitialized) {
            const firestore = getFirestore(appInstance);
            await clearRetiredFirestoreCache(firestore, privacyState);
            globalThis[globalDbKey] = firestore;
            return firestore;
        }
        throw error;
    }
}

function initializeFirebaseDbOnce(appInstance) {
    const globalInitializationKey = '__allplaysFirebaseDbInitialization';
    const existingInitialization = globalThis?.[globalInitializationKey];
    if (existingInitialization) {
        return existingInitialization;
    }

    // Vite can load this legacy module through both plain and query-versioned
    // URLs. Publish the promise before its first await so every module identity
    // shares the same privacy check, cache clear, and Firestore initialization.
    const initialization = (async () => {
        const privacyState = await loadReplayPrivacyMigrationStatus();
        return initializeFirebaseDb(appInstance, privacyState);
    })();
    globalThis[globalInitializationKey] = initialization;
    return initialization;
}

export const auth = initializeFirebaseAuth(app);
export const db = await initializeFirebaseDbOnce(app);
export const storage = getStorage(app);
export const functions = replayPrivacyFunctions;

export {
    collection,
    getDocs,
    getDoc,
    doc,
    addDoc,
    updateDoc,
    deleteDoc,
    setDoc,
    query,
    where,
    orderBy,
    Timestamp,
    increment,
    arrayUnion,
    arrayRemove,
    deleteField,
    limit,
    startAfter,
    getCountFromServer,
    onSnapshot,
    serverTimestamp,
    collectionGroup,
    documentId,
    writeBatch,
    runTransaction
};

export {
    onAuthStateChanged,
    signInWithEmailAndPassword,
    createUserWithEmailAndPassword,
    signOut,
    GoogleAuthProvider,
    indexedDBLocalPersistence,
    initializeAuth,
    signInWithCredential,
    signInWithPopup,
    signInWithRedirect,
    getRedirectResult,
    isSignInWithEmailLink,
    signInWithEmailLink,
    updatePassword,
    verifyPasswordResetCode,
    confirmPasswordReset,
    applyActionCode
};

export { ref, uploadBytes, getDownloadURL, deleteObject };

export { getFunctions, httpsCallable };
