import {
  applyActionCode,
  confirmPasswordReset,
  createUserWithEmailAndPassword,
  getApp,
  getApps,
  getAuth,
  getRedirectResult,
  GoogleAuthProvider,
  indexedDBLocalPersistence,
  initializeApp,
  initializeAuth,
  isSignInWithEmailLink,
  onAuthStateChanged,
  resolvePrimaryFirebaseConfig,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithEmailLink,
  signInWithPopup,
  signInWithRedirect,
  signOut,
  updatePassword,
  verifyPasswordResetCode
} from './adapters/legacyFirebaseAuthSdk';
import { createLogger } from './logger';

const logger = createLogger('firebase');

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
  if (typeof window !== 'undefined' && typeof window.indexedDB?.deleteDatabase !== 'function') {
    return getAuth(appInstance);
  }

  try {
    return initializeAuth(appInstance, {
      persistence: indexedDBLocalPersistence
    });
  } catch (error) {
    logger.warn('Native auth initialization fell back to getAuth.', { error });
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
