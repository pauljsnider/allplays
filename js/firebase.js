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
    writeBatch
} from "./vendor/firebase-firestore.js";
import { getStorage, ref, uploadBytes, getDownloadURL } from "./vendor/firebase-storage.js";

const firebaseConfig = {
    apiKey: "AIzaSyDoixIoKJuUVWdmImwjYRTthjKOv2mU0Jc",
    authDomain: "game-flow-c6311.firebaseapp.com",
    projectId: "game-flow-c6311",
    storageBucket: "game-flow-c6311.firebasestorage.app",
    messagingSenderId: "1030107289033",
    appId: "1:1030107289033:web:7154238712942475143046",
    measurementId: "G-E48D0L8L40"
};

// SECURITY NOTE: This API key is public by design for Firebase web apps.
// To secure your app, you MUST restrict this key in the Google Cloud Console:
// 1. Go to https://console.cloud.google.com/apis/credentials
// 2. Click on the API key used here.
// 3. Under "Application restrictions", select "HTTP referrers (web sites)" and add your domain(s).
// 4. Under "API restrictions", select "Restrict key" and select only the Firebase APIs you use (Auth, Firestore, Storage, etc.).

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
    writeBatch
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

export { ref, uploadBytes, getDownloadURL };
