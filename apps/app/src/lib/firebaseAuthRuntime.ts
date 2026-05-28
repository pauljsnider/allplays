import { getApp, getApps, initializeApp } from '../../../../js/vendor/firebase-app.js';
import {
  applyActionCode,
  confirmPasswordReset,
  createUserWithEmailAndPassword,
  getAuth,
  getRedirectResult,
  GoogleAuthProvider,
  indexedDBLocalPersistence,
  initializeAuth,
  isSignInWithEmailLink,
  onAuthStateChanged,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithEmailLink,
  signInWithPopup,
  signInWithRedirect,
  signOut,
  updatePassword,
  verifyPasswordResetCode
} from '../../../../js/vendor/firebase-auth.js';
import { resolvePrimaryFirebaseConfig } from '../../../../js/firebase-runtime-config.js';

const firebaseConfig = await resolvePrimaryFirebaseConfig();
const app = getApps().length ? getApp() : initializeApp(firebaseConfig);

function isCapacitorNativeRuntime() {
  const protocol = typeof window !== 'undefined' ? window.location?.protocol : '';
  if (protocol === 'capacitor:' || protocol === 'ionic:') {
    return true;
  }

  const capacitor = typeof window !== 'undefined' ? (window as any).Capacitor : null;
  if (!capacitor) {
    return false;
  }

  if (typeof capacitor.isNativePlatform === 'function') {
    return capacitor.isNativePlatform();
  }

  return capacitor.getPlatform?.() === 'ios' || capacitor.getPlatform?.() === 'android';
}

function initializeFirebaseAuth(appInstance: typeof app) {
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

export const auth = initializeFirebaseAuth(app);

export {
  applyActionCode,
  confirmPasswordReset,
  createUserWithEmailAndPassword,
  getRedirectResult,
  GoogleAuthProvider,
  isSignInWithEmailLink,
  onAuthStateChanged,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithEmailLink,
  signInWithPopup,
  signInWithRedirect,
  signOut,
  updatePassword,
  verifyPasswordResetCode
};
