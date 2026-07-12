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
    writeBatch,
    runTransaction
} from "./vendor/firebase-firestore.js";
import { getStorage, ref, uploadBytes, getDownloadURL, deleteObject } from "./vendor/firebase-storage.js";
import { getFunctions, httpsCallable } from "./vendor/firebase-functions.js";
import { resolvePrimaryFirebaseConfig } from "./firebase-runtime-config.js?v=10";

const firebaseConfig = await resolvePrimaryFirebaseConfig();

const existingDefaultApp = getApps().find((candidate) => candidate.name === '[DEFAULT]');
const app = existingDefaultApp || initializeApp(firebaseConfig);
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

function initializeFirebaseDb(appInstance) {
    const globalDbKey = '__allplaysFirebaseDb';
    const existingDb = globalThis?.[globalDbKey];
    if (existingDb) {
        return existingDb;
    }

    try {
        const firestore = initializeFirestore(appInstance, {
            localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() })
        });
        globalThis[globalDbKey] = firestore;
        return firestore;
    } catch (error) {
        if (error?.code === 'failed-precondition' || String(error?.message || '').includes('initializeFirestore() has already been called')) {
            const firestore = getFirestore(appInstance);
            globalThis[globalDbKey] = firestore;
            return firestore;
        }
        throw error;
    }
}

export const auth = initializeFirebaseAuth(app);
export const db = initializeFirebaseDb(app);
export const storage = getStorage(app);
export const functions = getFunctions(app);

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
