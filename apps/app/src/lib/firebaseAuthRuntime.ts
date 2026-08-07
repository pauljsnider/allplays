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
  updatePassword,
  verifyPasswordResetCode
} from './adapters/legacyFirebaseAuthSdk';
import { createLogger } from './logger';
import { isNativeRuntime } from './nativeRuntime';

const logger = createLogger('firebase');

const firebaseConfig = await resolvePrimaryFirebaseConfig();
// Only reuse the primary '[DEFAULT]' app. Other named apps (e.g. the
// game-flow-img image-upload project) can register while the config fetch
// above is awaiting, and getApp() throws app/no-app when only they exist.
const existingDefaultApp = getApps().find((candidate) => candidate?.name === '[DEFAULT]');
const app = existingDefaultApp || initializeApp(firebaseConfig);
// Native attestation can outlive a cold start while Play Integrity and the
// Capacitor bridge initialize. App Check is deliberately fail-open during its
// rollout, so it must not keep the React entry module suspended indefinitely.
// Start it before auth, then let its own status/telemetry report completion.
void initializePrimaryAppCheck(app).catch((error) => {
  logger.warn('App Check initialization did not complete cleanly.', { error });
});

function initializeFirebaseAuth(appInstance: typeof app) {
  if (!isNativeRuntime()) {
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
  signInWithEmailAndPassword,
  signInWithEmailLink,
  signInWithPopup,
  signInWithRedirect,
  signOut,
  updatePassword,
  verifyPasswordResetCode
};
