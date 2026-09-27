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
  signInWithCustomToken,
  signInWithEmailLink,
  signInWithPopup,
  signInWithRedirect,
  signOut,
  setPersistence,
  updatePassword,
  verifyPasswordResetCode
} from './adapters/legacyFirebaseAuthSdk';
import { createLogger } from './logger';
import { isNativeRuntime } from './nativeRuntime';
import { nativeFirebaseConfig } from '../config/firebaseRuntimeConfig';

const logger = createLogger('firebase');

// Capacitor serves bundled assets from https://localhost on Android. That
// origin has no Firebase Hosting endpoints, so native builds must use the
// same checked-in production config that is packaged with the application.
const firebaseConfig = isNativeRuntime()
  ? nativeFirebaseConfig
  : await resolvePrimaryFirebaseConfig();
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

async function initializeFirebaseAuth(appInstance: typeof app) {
  if (!isNativeRuntime()) {
    return getAuth(appInstance);
  }

  try {
    return initializeAuth(appInstance, {
      // The native plugin owns durable credentials in Keychain/Keystore. The
      // WebView SDK receives only a process-local bridge session for Firestore.
      persistence: inMemoryPersistence
    });
  } catch (error) {
    logger.warn('Native auth initialization reused an existing auth instance.', { error });
    const existingAuth = getAuth(appInstance);
    await signOut(existingAuth);
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
  signInWithCustomToken,
  signInWithEmailLink,
  signInWithPopup,
  signInWithRedirect,
  signOut,
  updatePassword,
  verifyPasswordResetCode
};
