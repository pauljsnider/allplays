import { initializeApp } from "./vendor/firebase-app.js";
import {
    getAuth,
    onAuthStateChanged,
    signInWithEmailAndPassword,
    createUserWithEmailAndPassword,
    signOut,
    GoogleAuthProvider,
    signInWithPopup,
    signInWithRedirect,
    getRedirectResult,
    sendPasswordResetEmail,
    sendEmailVerification,
    sendSignInLinkToEmail,
    isSignInWithEmailLink,
    signInWithEmailLink,
    updatePassword,
    verifyPasswordResetCode,
    confirmPasswordReset,
    applyActionCode
} from "./vendor/firebase-auth.js";
import {
    getFirestore,
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
import { resolvePrimaryFirebaseConfig } from "./firebase-runtime-config.js?v=2";

const firebaseConfig = await resolvePrimaryFirebaseConfig();

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);

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
    signInWithPopup,
    signInWithRedirect,
    getRedirectResult,
    sendPasswordResetEmail,
    sendEmailVerification,
    sendSignInLinkToEmail,
    isSignInWithEmailLink,
    signInWithEmailLink,
    updatePassword,
    verifyPasswordResetCode,
    confirmPasswordReset,
    applyActionCode
};

export { ref, uploadBytes, getDownloadURL, deleteObject };
