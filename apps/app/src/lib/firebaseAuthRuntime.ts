import {
  applyActionCode,
  confirmPasswordReset,
  createUserWithEmailAndPassword,
  getApps,
  getAuth,
  getRedirectResult,
  GoogleAuthProvider,
  indexedDBLocalPersistence,
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
import { NativeSecureFirebaseAuthPersistence, shouldBlockNativeFirebaseAuthMigration } from './nativeFirebaseAuthPersistence';

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

  const blockLegacyMigration = shouldBlockNativeFirebaseAuthMigration(
    String(firebaseConfig.apiKey || ''),
    String(appInstance.name || '[DEFAULT]')
  );
  try {
    return initializeAuth(appInstance, {
      // The secure persistence is first so Firebase migrates existing
      // IndexedDB sessions into Keychain/Keystore and removes the old copy.
      // IndexedDB is present only as a one-time migration source and is omitted
      // after logout until a fresh secure credential replaces the tombstone.
      persistence: blockLegacyMigration
        ? [NativeSecureFirebaseAuthPersistence]
        : [NativeSecureFirebaseAuthPersistence, indexedDBLocalPersistence]
    });
  } catch (error) {
    logger.warn('Native auth initialization reused an existing auth instance.', { error });
    const existingAuth = getAuth(appInstance);
    if (blockLegacyMigration) {
      // An auth instance initialized before this module may already have loaded
      // a stale IndexedDB user. Clear that instance before changing persistence;
      // otherwise setPersistence would migrate the signed-out user into secure
      // storage and defeat the same tombstone guard used above.
      await signOut(existingAuth);
    }
    await setPersistence(existingAuth, NativeSecureFirebaseAuthPersistence);
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
