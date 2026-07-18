import { createLogger } from './logger';
import { isNativeRuntime } from './nativeRuntime';
import {
  getNativeSecureItem,
  removeNativeSecureItem,
  setNativeSecureItem
} from './nativeSecureStorage';

const legacyPlaintextStorageKey = 'allplays-native-auth-session';
const signedOutMarkerStorageKey = 'allplays-native-auth-signed-out-v2';
const secureSessionStorageKey = 'native-auth-session-v2';
const logger = createLogger('native-auth-session-store');

export type NativeAuthSession = {
  uid: string;
  email: string;
  idToken: string;
  refreshToken?: string;
  expirationTime: number;
  apiKey: string;
  displayName?: string | null;
  photoUrl?: string | null;
  emailVerified?: boolean;
  provider?: 'rest' | 'native-plugin';
};

let hydrated = false;
let cachedSession: NativeAuthSession | null = null;
let hydrationPromise: Promise<NativeAuthSession | null> | null = null;

function removeLegacyPlaintextSession() {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage?.removeItem(legacyPlaintextStorageKey);
  } catch {
    // Cleanup is best-effort when the WebView has storage disabled.
  }
}

function hasSignedOutMarker() {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage?.getItem(signedOutMarkerStorageKey) === '1';
  } catch {
    return true;
  }
}

function setSignedOutMarker() {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage?.setItem(signedOutMarkerStorageKey, '1');
  } catch {
    // If storage itself is disabled, secure deletion is still attempted below.
  }
}

function clearSignedOutMarker() {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage?.removeItem(signedOutMarkerStorageKey);
  } catch {
    // Cleanup is best-effort when the WebView has storage disabled.
  }
}

function takeLegacyPlaintextSession(): NativeAuthSession | null {
  if (typeof window === 'undefined') return null;
  let rawSession: string | null = null;
  try {
    rawSession = window.localStorage?.getItem(legacyPlaintextStorageKey) || null;
  } catch {
    return null;
  } finally {
    removeLegacyPlaintextSession();
  }
  return parseSession(rawSession);
}

function parseSession(rawSession: string | null): NativeAuthSession | null {
  if (!rawSession) return null;
  try {
    const session = JSON.parse(rawSession) as Partial<NativeAuthSession>;
    if (
      typeof session.uid !== 'string'
      || !session.uid
      || typeof session.email !== 'string'
      || typeof session.idToken !== 'string'
      || !session.idToken
      || typeof session.apiKey !== 'string'
      || !Number.isFinite(session.expirationTime)
      || (session.provider !== 'native-plugin' && typeof session.refreshToken !== 'string')
    ) {
      return null;
    }
    return session as NativeAuthSession;
  } catch {
    return null;
  }
}

async function hydrateSession(): Promise<NativeAuthSession | null> {
  const legacySession = takeLegacyPlaintextSession();
  if (!isNativeRuntime()) {
    cachedSession = null;
    hydrated = true;
    return null;
  }

  try {
    if (hasSignedOutMarker()) {
      await removeNativeSecureItem(secureSessionStorageKey);
      clearSignedOutMarker();
      cachedSession = null;
      return null;
    }
    const secureSession = parseSession(await getNativeSecureItem(secureSessionStorageKey));
    if (secureSession) {
      cachedSession = secureSession;
    } else if (legacySession) {
      await setNativeSecureItem(secureSessionStorageKey, JSON.stringify(legacySession));
      cachedSession = legacySession;
    } else {
      cachedSession = null;
    }
  } catch (error) {
    // Never restore a token from plaintext storage when Keychain/Keystore is
    // unavailable. A failed secure restore deliberately starts signed out.
    cachedSession = null;
    logger.warn('Unable to restore the encrypted native auth session.', { error });
  } finally {
    removeLegacyPlaintextSession();
    hydrated = true;
  }

  return cachedSession;
}

export function readNativeAuthSession(): Promise<NativeAuthSession | null> {
  if (hydrated) return Promise.resolve(cachedSession);
  hydrationPromise ||= hydrateSession();
  return hydrationPromise;
}

export function getCachedNativeAuthSession() {
  return hydrated ? cachedSession : null;
}

/**
 * Keeps a newly authenticated session usable in memory even if the OS secure
 * store temporarily fails. Returning false tells the caller that the user will
 * need to authenticate again after the process exits; no plaintext fallback is
 * ever written.
 */
export async function writeNativeAuthSession(session: NativeAuthSession): Promise<boolean> {
  cachedSession = session;
  hydrated = true;
  hydrationPromise = Promise.resolve(session);
  removeLegacyPlaintextSession();
  try {
    await setNativeSecureItem(secureSessionStorageKey, JSON.stringify(session));
    clearSignedOutMarker();
    return true;
  } catch (error) {
    logger.warn('Unable to persist the encrypted native auth session; using memory only.', { error });
    return false;
  }
}

export async function clearNativeAuthSession(): Promise<void> {
  cachedSession = null;
  hydrated = true;
  hydrationPromise = Promise.resolve(null);
  removeLegacyPlaintextSession();
  setSignedOutMarker();
  try {
    await removeNativeSecureItem(secureSessionStorageKey);
    clearSignedOutMarker();
  } catch (error) {
    logger.warn('Unable to clear the encrypted native auth session.', { error });
  }
}
