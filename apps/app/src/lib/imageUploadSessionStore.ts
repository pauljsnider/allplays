import { createLogger } from './logger';
import { isNativeRuntime } from './nativeRuntime';
import { getNativeSecureItem, removeNativeSecureItem, setNativeSecureItem } from './nativeSecureStorage';

const legacyPlaintextStorageKey = 'allplays-image-upload-session';
const nativeClearedMarkerStorageKey = 'allplays-image-upload-session-cleared-v2';
const secureSessionStorageKey = 'image-upload-auth-session-v2';
const logger = createLogger('image-upload-session-store');

export type ImageUploadSession = {
  apiKey: string;
  idToken: string;
  refreshToken: string;
  expirationTime: number;
};

let hydrated = false;
let cachedSession: ImageUploadSession | null = null;
let hydrationPromise: Promise<ImageUploadSession | null> | null = null;

function parseSession(rawSession: string | null): ImageUploadSession | null {
  if (!rawSession) return null;
  try {
    const session = JSON.parse(rawSession) as Partial<ImageUploadSession>;
    if (
      typeof session.apiKey !== 'string' ||
      !session.apiKey ||
      typeof session.idToken !== 'string' ||
      !session.idToken ||
      typeof session.refreshToken !== 'string' ||
      !session.refreshToken ||
      !Number.isFinite(session.expirationTime)
    ) {
      return null;
    }
    return session as ImageUploadSession;
  } catch {
    return null;
  }
}

function removeLegacyPlaintextSession() {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage?.removeItem(legacyPlaintextStorageKey);
  } catch {
    // Cleanup is best-effort when WebView storage is disabled.
  }
}

function takeLegacyPlaintextSession() {
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

function removeWebSession() {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage?.removeItem(legacyPlaintextStorageKey);
  } catch {
    // The in-memory copy remains authoritative when sessionStorage is disabled.
  }
}

function readWebSession() {
  if (typeof window === 'undefined') return null;
  try {
    const rawSession = window.sessionStorage?.getItem(legacyPlaintextStorageKey) || null;
    const session = parseSession(rawSession);
    if (rawSession && !session) removeWebSession();
    return session;
  } catch {
    return null;
  }
}

function writeWebSession(session: ImageUploadSession) {
  if (typeof window === 'undefined') return false;
  try {
    const storage = window.sessionStorage;
    if (!storage) return false;
    storage.setItem(legacyPlaintextStorageKey, JSON.stringify(session));
    return true;
  } catch (error) {
    logger.warn('Unable to persist the image upload session in browser session storage; using memory only.', { error });
    return false;
  }
}

function hasNativeClearedMarker() {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage?.getItem(nativeClearedMarkerStorageKey) === '1';
  } catch {
    return true;
  }
}

function setNativeClearedMarker() {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage?.setItem(nativeClearedMarkerStorageKey, '1');
  } catch {
    // Secure deletion is still attempted below.
  }
}

function clearNativeClearedMarker() {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage?.removeItem(nativeClearedMarkerStorageKey);
  } catch {
    // A stale non-secret marker fails closed on the next launch.
  }
}

async function replaceNativeSecureSession(session: ImageUploadSession) {
  setNativeClearedMarker();
  // Remove first so a failed overwrite cannot resurrect an older credential on
  // the next process launch. Losing this anonymous session is safe; restoring a
  // stale plaintext or partially replaced session is not.
  await removeNativeSecureItem(secureSessionStorageKey);
  await setNativeSecureItem(secureSessionStorageKey, JSON.stringify(session));
  clearNativeClearedMarker();
}

async function hydrateNativeSession(legacySession: ImageUploadSession | null) {
  removeWebSession();
  try {
    if (hasNativeClearedMarker()) {
      await removeNativeSecureItem(secureSessionStorageKey);
      clearNativeClearedMarker();
      return null;
    }

    const secureSession = parseSession(await getNativeSecureItem(secureSessionStorageKey));
    if (secureSession) return secureSession;
    if (!legacySession) return null;

    await replaceNativeSecureSession(legacySession);
    return legacySession;
  } catch (error) {
    // A plaintext legacy credential is never restored when Keychain/Keystore is
    // unavailable. The caller will create a fresh anonymous session instead.
    logger.warn('Unable to restore the encrypted image upload session.', { error });
    return null;
  }
}

async function hydrateSession() {
  const legacySession = takeLegacyPlaintextSession();
  const nativeRuntime = isNativeRuntime();
  if (nativeRuntime) {
    cachedSession = await hydrateNativeSession(legacySession);
  } else {
    const webSession = readWebSession();
    cachedSession = webSession || legacySession;
    if (!webSession && legacySession) writeWebSession(legacySession);
  }
  hydrated = true;
  return cachedSession;
}

export function readImageUploadSession(): Promise<ImageUploadSession | null> {
  if (hydrated) return Promise.resolve(cachedSession);
  hydrationPromise ||= hydrateSession();
  return hydrationPromise;
}

/**
 * Keeps a freshly issued anonymous image-project session usable in memory if
 * persistence fails. Native credentials never fall back to WebView storage.
 */
export async function writeImageUploadSession(session: ImageUploadSession): Promise<boolean> {
  cachedSession = session;
  hydrated = true;
  hydrationPromise = Promise.resolve(session);
  removeLegacyPlaintextSession();

  if (!isNativeRuntime()) {
    return writeWebSession(session);
  }

  removeWebSession();
  try {
    await replaceNativeSecureSession(session);
    return true;
  } catch (error) {
    logger.warn('Unable to persist the encrypted image upload session; using memory only.', { error });
    return false;
  }
}

export async function clearImageUploadSession(): Promise<void> {
  cachedSession = null;
  hydrated = true;
  hydrationPromise = Promise.resolve(null);
  removeLegacyPlaintextSession();
  removeWebSession();

  if (!isNativeRuntime()) return;

  setNativeClearedMarker();
  try {
    await removeNativeSecureItem(secureSessionStorageKey);
    clearNativeClearedMarker();
  } catch (error) {
    logger.warn('Unable to clear the encrypted image upload session.', { error });
  }
}
