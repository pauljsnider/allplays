import {
  applyActionCode,
  confirmPasswordReset,
  createUserWithEmailAndPassword,
  getApps,
  getAuth,
  getRedirectResult,
  GoogleAuthProvider,
  inMemoryPersistence,
  initializeApp,
  initializePrimaryAppCheck,
  initializeAuth,
  isSignInWithEmailLink,
  onAuthStateChanged,
  resolvePrimaryFirebaseConfig,
  signInWithEmailAndPassword,
  signInWithEmailLink,
  signInWithPopup,
  signInWithRedirect,
  signOut,
  setPersistence,
  updatePassword,
  verifyPasswordResetCode
} from './adapters/legacyFirebaseAuthSdk';
import { createLogger } from './logger';

const logger = createLogger('firebase');

const firebaseConfig = await resolvePrimaryFirebaseConfig();
// Only reuse the primary '[DEFAULT]' app. Other named apps (e.g. the
// game-flow-img image-upload project) can register while the config fetch
// above is awaiting, and getApp() throws app/no-app when only they exist.
const existingDefaultApp = getApps().find((candidate) => candidate?.name === '[DEFAULT]');
const app = existingDefaultApp || initializeApp(firebaseConfig);
await initializePrimaryAppCheck(app);

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

async function initializeFirebaseAuth(appInstance: typeof app) {
  if (!isCapacitorNativeRuntime()) {
    return getAuth(appInstance);
  }

  try {
    return initializeAuth(appInstance, {
      // Native sessions are restored from OS-protected Keychain/Keystore by
      // authService. Firebase's WebView copy must never persist credentials in
      // IndexedDB/localStorage alongside that encrypted source of truth.
      persistence: inMemoryPersistence
    });
  } catch (error) {
    logger.warn('Native auth initialization reused an existing auth instance.', { error });
    const existingAuth = getAuth(appInstance);
    await setPersistence(existingAuth, inMemoryPersistence);
    return existingAuth;
  }
}

export const auth = await initializeFirebaseAuth(app);

export {
  applyActionCode,
  confirmPasswordReset,
  createUserWithEmailAndPassword,
  getRedirectResult,
  GoogleAuthProvider,
  isSignInWithEmailLink,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signInWithEmailLink,
  signInWithPopup,
  signInWithRedirect,
  signOut,
  updatePassword,
  verifyPasswordResetCode
};
