import { Capacitor } from '@capacitor/core';
import { FirebaseAuthentication } from '@capacitor-firebase/authentication';
import { isNativeRuntime } from './nativeRuntime';
import {
  auth,
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
  signOut as firebaseSignOut,
  updatePassword,
  verifyPasswordResetCode
} from './firebaseAuthRuntime';
import {
  loadLegacyAdminInvite,
  loadLegacyAuthEmail,
  loadLegacyAuthDb,
  loadLegacyInviteFlow,
  loadLegacyParentMembershipUtils,
  loadLegacySignupFlow
} from './adapters/legacyAuth';
import { createLogger } from './logger';
import { getPrimaryAppCheckHeaders } from './adapters/legacyFirebaseAppCheck';
import { clearAppDataCache } from './appDataCache';
import { buildFirebaseSdkActionHref } from './appLinks';
import { mergeOwnedTeamIds } from './teamAccess';
import type { AuthUser, UserRole } from './types';

export const firebaseAuth = auth;
export const passwordResetConfirmationMessage = 'If an account exists for that email, a reset email has been queued.';

const pendingActivationCodeKey = 'pendingActivationCode';
const pendingInviteCodeKey = 'allplays-app-pending-invite-code';
const pendingInviteTypeKey = 'allplays-app-pending-invite-type';
const authTimeoutMs = 15000;
const nativeAuthObserverTimeoutMs = 4000;
const profileHydrationTimeoutMs = 8000;
const signOutCleanupTimeoutMs = 2500;
const firebaseAuthStorageDb = 'firebaseLocalStorageDb';
const firebaseAuthStorageStore = 'firebaseLocalStorage';
const nativeAuthSessionStorageKey = 'allplays-native-auth-session';
const logger = createLogger('app-auth');

type FirebaseUser = {
  uid: string;
  email?: string | null;
  displayName?: string | null;
  photoURL?: string | null;
  emailVerified?: boolean;
  metadata?: {
    creationTime?: string;
    lastSignInTime?: string;
  };
  reload?: () => Promise<void>;
  delete?: () => Promise<void>;
  getIdToken?: (forceRefresh?: boolean) => Promise<string>;
  isNativeRestSession?: boolean;
  isNewUser?: boolean;
};

type UserCredential = {
  user: FirebaseUser;
  nativeRest?: boolean;
  activationCodeRedeemed?: boolean;
  wasNewUser?: boolean;
};

type HydratedUser = {
  user: AuthUser;
  profile: Record<string, unknown>;
};

type NativeAuthSession = {
  uid: string;
  email: string;
  displayName?: string | null;
  photoUrl?: string | null;
  emailVerified?: boolean;
  provider?: 'rest' | 'native-plugin';
};

type VolatileNativeRestSession = NativeAuthSession & {
  idToken: string;
  refreshToken: string;
  expirationTime: number;
  apiKey: string;
};

let volatileNativeRestSession: VolatileNativeRestSession | null = null;

type NativeRestLookupUser = {
  email?: string;
  emailVerified?: boolean;
  displayName?: string;
  photoUrl?: string;
  phoneNumber?: string;
  createdAt?: string;
  lastLoginAt?: string;
};

type NativePluginUser = {
  uid?: string;
  email?: string | null;
  displayName?: string | null;
  photoUrl?: string | null;
  emailVerified?: boolean;
  metadata?: {
    creationTime?: number;
    lastSignInTime?: number;
  };
};

type NativePluginSignInResult = {
  user?: NativePluginUser | null;
  credential?: {
    idToken?: string;
    accessToken?: string;
    authorizationCode?: string;
    nonce?: string;
    serverAuthCode?: string;
  } | null;
  additionalUserInfo?: {
    isNewUser?: boolean;
  } | null;
};

export function normalizeAuthEmail(email: string | null | undefined) {
  return String(email || '')
    .trim()
    .toLowerCase();
}

export function isValidAuthEmail(email: string | null | undefined) {
  const normalizedEmail = normalizeAuthEmail(email);
  const parts = normalizedEmail.split('@');
  if (parts.length !== 2) {
    return false;
  }

  const [localPart, domain] = parts;
  return Boolean(localPart && domain && domain.includes('.') && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail));
}

function requireValidAuthEmail(email: string | null | undefined) {
  const normalizedEmail = normalizeAuthEmail(email);
  if (!isValidAuthEmail(normalizedEmail)) {
    throw new Error('Enter a valid email address.');
  }
  return normalizedEmail;
}

function normalizeCode(code: string | null | undefined) {
  return String(code || '')
    .trim()
    .toUpperCase();
}

function withTimeout<T>(promise: Promise<T>, message: string, timeoutMs = authTimeoutMs): Promise<T> {
  let timeoutId: number | undefined;
  const timeout = new Promise<T>((_, reject) => {
    timeoutId = window.setTimeout(() => {
      const error = new Error(message) as Error & { code?: string };
      error.code = 'auth/network-request-failed';
      reject(error);
    }, timeoutMs);
  });

  return Promise.race([promise, timeout]).finally(() => {
    if (timeoutId) {
      window.clearTimeout(timeoutId);
    }
  });
}

async function runBestEffortAuthCleanup(label: string, cleanup: () => Promise<unknown>) {
  try {
    await withTimeout(Promise.resolve().then(cleanup), `${label} timed out.`, signOutCleanupTimeoutMs);
  } catch (error) {
    logger.warn('Operation failed during sign-out.', { label, error });
  }
}

export function describeAuthError(error: any) {
  const code = error?.code || '';
  const message = `${code} ${error?.message || ''} ${error?.restCode || ''}`;

  if (
    (message.includes('requests-from-referer-') && message.includes('are-blocked')) ||
    message.includes('HTTP_REFERRER_BLOCKED') ||
    message.includes('API_KEY_HTTP_REFERRER_BLOCKED')
  ) {
    const origin = window.location.origin || window.location.href;
    if (origin.startsWith('capacitor://')) {
      return 'Firebase is blocking this app origin. Add capacitor://localhost to the web API key restrictions.';
    }
    return `Firebase is blocking this local origin (${origin}). Add it to the Firebase web API key restrictions.`;
  }

  if (code === 'auth/invalid-credential' || code === 'auth/wrong-password' || code === 'auth/user-not-found') {
    return 'Email or password is incorrect.';
  }

  if (code === 'auth/invalid-email' || message.includes('auth/invalid-email') || message.includes('INVALID_EMAIL')) {
    return 'Enter a valid email address.';
  }

  if (code === 'auth/too-many-requests' || message.includes('TOO_MANY_ATTEMPTS_TRY_LATER')) {
    return 'Too many attempts. Wait a few minutes and try again.';
  }

  if (code === 'auth/network-request-failed') {
    const connectivity = classifyAuthConnectivity(error);
    if (connectivity === 'offline') {
      return 'This device is offline. Reconnect to the internet, then try again.';
    }
    if (connectivity === 'timeout') {
      return 'Sign-in services took too long to respond. Try again.';
    }
    return 'ALL PLAYS could not reach sign-in services. Check your connection and try again.';
  }

  if (code === 'auth/account-exists-with-different-credential') {
    return 'An account already exists for that email with a different sign-in method.';
  }

  if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') {
    return 'Google sign-in was cancelled.';
  }

  return error?.message || 'Authentication failed.';
}

export function classifyAuthConnectivity(error: any, online = typeof navigator === 'undefined' ? undefined : navigator.onLine) {
  if (online === false) return 'offline';

  const diagnosticText = `${error?.code || ''} ${error?.message || ''} ${error?.name || ''}`.toLowerCase();
  if (diagnosticText.includes('timed out') || diagnosticText.includes('timeout') || diagnosticText.includes('aborterror')) {
    return 'timeout';
  }
  if (
    diagnosticText.includes('auth/network-request-failed') ||
    diagnosticText.includes('networkerror') ||
    diagnosticText.includes('failed to fetch')
  ) {
    return 'service-unreachable';
  }
  return 'unknown';
}

function getFirebaseAuthStorageKey() {
  const apiKey = auth.app?.options?.apiKey || '';
  const appName = auth.app?.name || '[DEFAULT]';
  return `firebase:authUser:${apiKey}:${appName}`;
}

function readNativeAuthSession(): NativeAuthSession | null {
  try {
    const rawSession = window.localStorage?.getItem(nativeAuthSessionStorageKey);
    if (!rawSession) return null;
    const parsed = JSON.parse(rawSession) as Partial<VolatileNativeRestSession>;
    if (!parsed?.uid) return null;
    if (parsed.idToken && parsed.refreshToken) {
      volatileNativeRestSession = parsed as VolatileNativeRestSession;
      window.localStorage?.setItem(nativeAuthSessionStorageKey, JSON.stringify(sanitizeNativeAuthSession(parsed)));
      void clearFirebaseAuthStorageSession();
    }
    return sanitizeNativeAuthSession(parsed);
  } catch (error) {
    logger.warn('Unable to read native auth fallback session.', { error });
    return null;
  }
}

function sanitizeNativeAuthSession(session: Partial<VolatileNativeRestSession>): NativeAuthSession {
  return {
    uid: String(session.uid || ''),
    email: String(session.email || ''),
    displayName: session.displayName || null,
    photoUrl: session.photoUrl || null,
    emailVerified: session.emailVerified === true,
    provider: session.provider === 'rest' ? 'rest' : 'native-plugin'
  };
}

function writeNativeAuthSession(session: NativeAuthSession | VolatileNativeRestSession) {
  try {
    window.localStorage?.setItem(nativeAuthSessionStorageKey, JSON.stringify(sanitizeNativeAuthSession(session)));
  } catch (error) {
    logger.warn('Unable to update native auth fallback session.', { error });
  }
}

function clearNativeAuthSession() {
  try {
    volatileNativeRestSession = null;
    window.localStorage?.removeItem(nativeAuthSessionStorageKey);
  } catch (error) {
    logger.warn('Unable to clear native auth fallback session.', { error });
  }
}

/**
 * Drop every persisted app-data cache entry (schedule summary, home dashboard,
 * fees, event details, etc.). Sign-out and account switches must call this so a
 * previous user's data is never served from localStorage on a shared device.
 */
function clearCachedUserData() {
  try {
    clearAppDataCache();
  } catch (error) {
    logger.warn('Unable to clear cached app data during auth change.', { error });
  }
}

async function clearFirebaseAuthStorageSession() {
  if (!window.indexedDB) {
    return;
  }

  let database: IDBDatabase | null = null;
  try {
    database = await openFirebaseAuthStorage();
    await new Promise<void>((resolve, reject) => {
      const transaction = database?.transaction(firebaseAuthStorageStore, 'readwrite');
      if (!transaction) {
        resolve();
        return;
      }
      transaction.objectStore(firebaseAuthStorageStore).delete(getFirebaseAuthStorageKey());
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error || new Error('Unable to clear auth storage.'));
      transaction.onabort = () => reject(transaction.error || new Error('Auth storage clear was aborted.'));
    });
  } catch (error) {
    logger.warn('Unable to clear Firebase auth storage session.', { error });
  } finally {
    database?.close();
  }
}

function openFirebaseAuthStorage(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!window.indexedDB) {
      reject(new Error('Auth storage is unavailable in this WebView.'));
      return;
    }

    const request = window.indexedDB.open(firebaseAuthStorageDb, 1);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(firebaseAuthStorageStore)) {
        database.createObjectStore(firebaseAuthStorageStore, { keyPath: 'fbase_key' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Unable to open auth storage.'));
  });
}

async function refreshNativeAuthSession(session: VolatileNativeRestSession) {
  const apiKey = session.apiKey || auth.app?.options?.apiKey || '';
  if (!apiKey || !session.refreshToken) {
    throw new Error('Native auth refresh is unavailable.');
  }

  const requestUrl = `https://securetoken.googleapis.com/v1/token?key=${encodeURIComponent(apiKey)}`;
  const response = await withTimeout(
    fetch(requestUrl, {
      method: 'POST',
      headers: await getPrimaryAppCheckHeaders(
        {
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        requestUrl
      ),
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: session.refreshToken
      })
    }),
    'Firebase Auth refresh timed out.'
  );
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.error?.message || 'Unable to refresh native auth session.');
  }

  const expiresInSeconds = Number.parseInt(payload.expires_in || '3600', 10);
  const nextSession: VolatileNativeRestSession = {
    ...session,
    uid: payload.user_id || session.uid,
    idToken: payload.id_token || session.idToken,
    refreshToken: payload.refresh_token || session.refreshToken,
    expirationTime: Date.now() + Math.max(expiresInSeconds - 30, 60) * 1000
  };
  volatileNativeRestSession = nextSession;
  writeNativeAuthSession(nextSession);
  return nextSession;
}

async function getNativePluginToken(forceRefresh = false) {
  if (!(Capacitor as any).isPluginAvailable?.('FirebaseAuthentication')) {
    throw new Error('Native Firebase auth is unavailable.');
  }

  const result = await FirebaseAuthentication.getIdToken({ forceRefresh });
  if (!result?.token) {
    throw new Error('Native Firebase auth did not return an ID token.');
  }
  return result.token;
}

async function refreshNativePluginAuthSession(session: NativeAuthSession) {
  const currentUserResult = await FirebaseAuthentication.getCurrentUser().catch(() => ({ user: null }));
  const currentUser = currentUserResult?.user as NativePluginUser | null;
  if (!currentUser?.uid) {
    throw new Error('Native Firebase auth has no signed-in user.');
  }
  if (session.uid && currentUser.uid !== session.uid) {
    throw new Error('Native Firebase auth session does not match the saved app session.');
  }

  const nextSession: NativeAuthSession = {
    ...session,
    uid: currentUser.uid,
    email: currentUser.email || session.email || '',
    displayName: currentUser.displayName || session.displayName || null,
    photoUrl: currentUser.photoUrl || session.photoUrl || null,
    emailVerified: currentUser.emailVerified === true || session.emailVerified === true,
    provider: 'native-plugin'
  };
  writeNativeAuthSession(nextSession);
  return nextSession;
}

function getNativeAuthFallbackUser(): FirebaseUser | null {
  const session = readNativeAuthSession();
  if (!session?.uid || (session.provider !== 'native-plugin' && volatileNativeRestSession?.uid !== session.uid)) {
    return null;
  }

  return {
    uid: session.uid,
    email: session.email || '',
    emailVerified: session.emailVerified === true,
    displayName: session.displayName || session.email || '',
    photoURL: session.photoUrl || null,
    isNativeRestSession: true,
    async getIdToken(forceRefresh = false) {
      if (session.provider === 'native-plugin') {
        if (forceRefresh) await refreshNativePluginAuthSession(session);
        return getNativePluginToken(forceRefresh);
      }
      let currentSession = volatileNativeRestSession;
      if (!currentSession) throw new Error('Legacy native auth session must be signed in again.');
      if (forceRefresh || Number(currentSession.expirationTime || 0) < Date.now() + 60000) {
        currentSession = await refreshNativeAuthSession(currentSession);
      }
      return currentSession.idToken;
    },
    async delete() {
      await deleteNativeAuthUser();
    }
  };
}

export async function getNativeAuthIdToken(forceRefresh = false): Promise<string | null> {
  const webUser = auth.currentUser;
  if (!isNativeRuntime() && webUser?.getIdToken) {
    return webUser.getIdToken(forceRefresh);
  }

  const fallbackUser = getNativeAuthFallbackUser();
  if (fallbackUser?.getIdToken) {
    return fallbackUser.getIdToken(forceRefresh);
  }

  return webUser?.getIdToken ? webUser.getIdToken(forceRefresh) : null;
}

export function getNativeAuthUserId(): string | null {
  return auth.currentUser?.uid || getNativeAuthFallbackUser()?.uid || null;
}

async function getNativeAccessCodeValidationOptions(result: UserCredential) {
  if (!result.nativeRest || auth.currentUser) {
    return undefined;
  }

  const nativeAuthToken = await getNativeAuthIdToken().catch((error: unknown) => {
    logger.warn('Unable to attach native auth token for access code validation.', { error });
    return null;
  });
  return nativeAuthToken ? { nativeAuthToken } : undefined;
}

function nativeMetadataToAuthMetadata(metadata: NativePluginUser['metadata'] = {}) {
  const creationTime = metadata.creationTime ? new Date(metadata.creationTime).toISOString() : undefined;
  const lastSignInTime = metadata.lastSignInTime ? new Date(metadata.lastSignInTime).toISOString() : undefined;
  return {
    creationTime,
    lastSignInTime
  };
}

async function persistNativePluginAuthSession(nativeResult: NativePluginSignInResult): Promise<FirebaseUser> {
  const currentUserResult = await FirebaseAuthentication.getCurrentUser().catch(() => ({ user: null }));
  const pluginUser = nativeResult.user || (currentUserResult?.user as NativePluginUser | null);
  if (!pluginUser?.uid) {
    throw new Error('Native Firebase sign-in did not return a user.');
  }
  const previousUid = auth.currentUser?.uid || readNativeAuthSession()?.uid || null;
  if (previousUid && previousUid !== pluginUser.uid) {
    clearCachedUserData();
  }

  const idToken = await getNativePluginToken(true);
  const lookupPayload = (await callFirebaseAuthRest('accounts:lookup', {
    idToken
  }).catch((error) => {
    logger.warn('Unable to load native Firebase auth profile.', { error });
    return {};
  })) as { users?: NativeRestLookupUser[] };
  const lookupUser = Array.isArray(lookupPayload.users) ? lookupPayload.users[0] || {} : {};
  const email = pluginUser.email || lookupUser.email || '';
  const displayName = pluginUser.displayName || lookupUser.displayName || null;
  const photoUrl = pluginUser.photoUrl || lookupUser.photoUrl || null;
  const metadata = nativeMetadataToAuthMetadata(pluginUser.metadata);
  const isNewUser = nativeResult.additionalUserInfo?.isNewUser === true;

  writeNativeAuthSession({
    uid: pluginUser.uid,
    email,
    displayName,
    photoUrl,
    emailVerified: pluginUser.emailVerified === true || lookupUser.emailVerified === true,
    provider: 'native-plugin'
  });
  await clearFirebaseAuthStorageSession();

  return {
    uid: pluginUser.uid,
    email,
    emailVerified: pluginUser.emailVerified === true || lookupUser.emailVerified === true,
    displayName,
    photoURL: photoUrl,
    metadata: {
      creationTime: isNewUser ? `${Date.now()}` : metadata.creationTime || lookupUser.createdAt,
      lastSignInTime: metadata.lastSignInTime || lookupUser.lastLoginAt || `${Date.now()}`
    },
    isNativeRestSession: true,
    isNewUser,
    async getIdToken(forceRefresh = false) {
      if (forceRefresh) {
        await refreshNativePluginAuthSession(
          readNativeAuthSession() || {
            uid: pluginUser.uid || '',
            email,
            provider: 'native-plugin'
          }
        );
      }
      return getNativePluginToken(forceRefresh);
    },
    async delete() {
      await deleteNativeAuthUser();
    }
  };
}

function createRestAuthError(payload: any, fallbackMessage = 'Authentication failed.') {
  const restCode = payload?.error?.message || '';
  const error = new Error(fallbackMessage || restCode || 'Authentication failed.') as Error & { code?: string; restCode?: string };
  error.restCode = restCode;
  if (restCode === 'EMAIL_NOT_FOUND' || restCode === 'INVALID_PASSWORD' || restCode === 'INVALID_LOGIN_CREDENTIALS') {
    error.code = 'auth/invalid-credential';
  } else if (restCode === 'TOO_MANY_ATTEMPTS_TRY_LATER') {
    error.code = 'auth/too-many-requests';
  } else if (restCode.includes('REFERER') || restCode.includes('REFERRER')) {
    error.code = 'auth/requests-from-referer-are-blocked';
  } else {
    error.code = 'auth/network-request-failed';
  }
  return error;
}

async function callFirebaseAuthRest(endpoint: string, payload: Record<string, unknown>) {
  const apiKey = auth.app?.options?.apiKey;
  if (!apiKey) {
    throw new Error('Firebase API key is missing.');
  }

  const requestUrl = `https://identitytoolkit.googleapis.com/v1/${endpoint}?key=${encodeURIComponent(apiKey)}`;
  const response = await withTimeout(
    fetch(requestUrl, {
      method: 'POST',
      headers: await getPrimaryAppCheckHeaders(
        {
          'Content-Type': 'application/json'
        },
        requestUrl
      ),
      body: JSON.stringify(payload)
    }),
    'Firebase Auth request timed out.'
  );
  const responsePayload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw createRestAuthError(responsePayload);
  }
  return responsePayload;
}

async function deleteNativeAuthUser() {
  const session = readNativeAuthSession();
  if (!session?.uid) {
    clearNativeAuthSession();
    await clearFirebaseAuthStorageSession();
    return;
  }

  try {
    if (session.provider === 'native-plugin' && (Capacitor as any).isPluginAvailable?.('FirebaseAuthentication')) {
      await FirebaseAuthentication.deleteUser();
    } else if (volatileNativeRestSession?.idToken) {
      await callFirebaseAuthRest('accounts:delete', {
        idToken: volatileNativeRestSession.idToken
      });
    } else {
      throw new Error('Legacy native auth session must be signed in again.');
    }
  } finally {
    clearNativeAuthSession();
    await clearFirebaseAuthStorageSession();
  }
}

function getNativeGoogleSignInOptions() {
  const options: {
    skipNativeAuth: boolean;
    useCredentialManager?: boolean;
  } = {
    skipNativeAuth: false
  };

  if (Capacitor.getPlatform?.() === 'android') {
    options.useCredentialManager = false;
  }

  return options;
}

function isNewFirebaseUser(user: FirebaseUser) {
  if (typeof user.isNewUser === 'boolean') {
    return user.isNewUser;
  }
  return Boolean(user.metadata?.creationTime && user.metadata.creationTime === user.metadata.lastSignInTime);
}

function rolesFromProfile(profile: Record<string, unknown> = {}): UserRole[] {
  const roleSet = new Set<UserRole>();
  const storedRoles = Array.isArray(profile.roles) ? profile.roles : [];

  storedRoles.forEach((role) => {
    if (role === 'parent' || role === 'coach' || role === 'admin' || role === 'platformAdmin') {
      roleSet.add(role);
    }
  });

  if (
    (Array.isArray(profile.parentOf) && profile.parentOf.length > 0) ||
    (Array.isArray(profile.parentTeamIds) && profile.parentTeamIds.length > 0) ||
    (Array.isArray(profile.parentPlayerKeys) && profile.parentPlayerKeys.length > 0)
  ) {
    roleSet.add('parent');
  }

  if (Array.isArray(profile.coachOf) && profile.coachOf.length > 0) {
    roleSet.add('coach');
  }

  if (profile.isAdmin === true) {
    roleSet.add('admin');
  }

  if (profile.isPlatformAdmin === true || profile.platformAdmin === true) {
    roleSet.add('platformAdmin');
  }

  if (!roleSet.size) {
    roleSet.add('parent');
  }

  return [...roleSet];
}

function toAuthUser(user: FirebaseUser, profile: Record<string, unknown>): AuthUser {
  const email = String(user.email || profile.email || '');
  const displayName = String(user.displayName || profile.fullName || profile.displayName || email || 'ALL PLAYS User');
  const coachOf = Array.isArray(profile.coachOf) ? profile.coachOf.filter((teamId): teamId is string => typeof teamId === 'string') : [];

  return {
    uid: user.uid,
    email,
    displayName,
    photoUrl: typeof user.photoURL === 'string' ? user.photoURL : typeof profile.photoUrl === 'string' ? profile.photoUrl : undefined,
    emailVerified: user.emailVerified === true,
    roles: rolesFromProfile(profile),
    parentOf: Array.isArray(profile.parentOf) ? (profile.parentOf as Array<Record<string, unknown>>) : [],
    parentTeamIds: Array.isArray(profile.parentTeamIds)
      ? profile.parentTeamIds.filter((teamId): teamId is string => typeof teamId === 'string')
      : [],
    parentPlayerKeys: Array.isArray(profile.parentPlayerKeys)
      ? profile.parentPlayerKeys.filter((playerKey): playerKey is string => typeof playerKey === 'string')
      : [],
    coachOf,
    isAdmin: profile.isAdmin === true,
    teamMediaUploadTeamIds: Array.isArray(profile.teamMediaUploadTeamIds)
      ? profile.teamMediaUploadTeamIds.filter((teamId): teamId is string => typeof teamId === 'string')
      : undefined,
    mediaUploadTeamIds: Array.isArray(profile.mediaUploadTeamIds)
      ? profile.mediaUploadTeamIds.filter((teamId): teamId is string => typeof teamId === 'string')
      : undefined
  };
}

async function cleanupFailedNewUser(user: FirebaseUser | null, context: string, options: { activationCode?: string | null } = {}) {
  const activationCode = normalizeCode(options.activationCode);
  if (user?.uid && activationCode) {
    try {
      const dbModule = await loadLegacyAuthDb();
      if (typeof dbModule.rollbackParentInviteRedemption === 'function') {
        await dbModule.rollbackParentInviteRedemption(user.uid, activationCode);
      }
    } catch (rollbackError) {
      logger.error('Error rolling back invite redemption after auth operation.', { context, error: rollbackError });
    }
  }

  if (user?.delete) {
    try {
      await user.delete();
    } catch (deleteError) {
      logger.error('Error deleting user after auth operation.', { context, error: deleteError });
    }
  }

  try {
    await firebaseSignOut(auth);
  } catch (signOutError) {
    logger.error('Error signing out after auth operation.', { context, error: signOutError });
  }
}

export async function hydrateFirebaseUser(user: FirebaseUser): Promise<HydratedUser> {
  let profile: Record<string, unknown> = {};
  const dbModule = await loadLegacyAuthDb();
  try {
    profile =
      (await withTimeout(Promise.resolve(dbModule.getUserProfile(user.uid)), 'Profile load timed out.', profileHydrationTimeoutMs)) || {};
  } catch (error) {
    logger.warn('Failed to load profile; continuing with auth identity.', { error });
    profile = {
      email: user.email || ''
    };
  }

  try {
    const { mergeApprovedParentMembershipRequests } = await loadLegacyParentMembershipUtils();
    const approvedRequests = await withTimeout(
      Promise.resolve(dbModule.listMyParentMembershipRequests(user.uid)),
      'Parent membership sync timed out.',
      profileHydrationTimeoutMs
    );
    const parentRequestSync = mergeApprovedParentMembershipRequests(profile, approvedRequests);
    if (parentRequestSync.changed) {
      await dbModule.updateUserProfile(user.uid, parentRequestSync.userUpdate);
      profile = {
        ...profile,
        ...parentRequestSync.userUpdate
      };
    }
  } catch (error) {
    logger.warn('Failed to sync approved parent membership requests.', { error });
  }

  try {
    const teams = await withTimeout(
      Promise.resolve(dbModule.getUserTeams(user.uid)),
      'Team access load timed out.',
      profileHydrationTimeoutMs
    );
    const coachOf = mergeOwnedTeamIds(profile.coachOf, teams);
    if (coachOf.length > 0) {
      profile = {
        ...profile,
        coachOf
      };
    }
  } catch (error) {
    logger.warn('Failed to load owned teams.', { error });
  }

  return {
    user: toAuthUser(user, profile),
    profile
  };
}

export function observeFirebaseUser(callback: (user: FirebaseUser | null) => void) {
  let timeoutId: number | undefined;
  let lastObservedUid: string | null | undefined;

  const emit = (user: FirebaseUser | null) => {
    const nextUid = user?.uid ?? null;
    // When the signed-in account changes (including sign-out), purge any cached
    // app data so the incoming user can never read the previous user's data.
    if (lastObservedUid !== undefined && lastObservedUid !== nextUid) {
      clearCachedUserData();
    }
    lastObservedUid = nextUid;
    callback(user);
  };

  if (isNativeRuntime()) {
    timeoutId = window.setTimeout(() => {
      const fallbackUser = getNativeAuthFallbackUser();
      if (fallbackUser) {
        emit(fallbackUser);
      }
    }, nativeAuthObserverTimeoutMs);
  }

  const unsubscribe = onAuthStateChanged(auth, (user: FirebaseUser | null) => {
    if (timeoutId) {
      window.clearTimeout(timeoutId);
      timeoutId = undefined;
    }
    if (user) {
      emit(user);
      return;
    }
    emit(isNativeRuntime() ? getNativeAuthFallbackUser() : null);
  });

  return () => {
    if (timeoutId) {
      window.clearTimeout(timeoutId);
    }
    unsubscribe();
  };
}

export function getCurrentFirebaseUser(): FirebaseUser | null {
  return auth.currentUser || null;
}

export async function signInWithEmail(email: string, password: string) {
  const normalizedEmail = requireValidAuthEmail(email);
  const { updateUserProfile } = await loadLegacyAuthDb();

  if (isNativeRuntime()) {
    if (!(Capacitor as any).isPluginAvailable?.('FirebaseAuthentication')) {
      throw new Error('Native Firebase auth is unavailable.');
    }
    const nativeResult = await withTimeout(
      FirebaseAuthentication.signInWithEmailAndPassword({
        email: normalizedEmail,
        password
      }) as Promise<NativePluginSignInResult>,
      'Firebase sign-in timed out.'
    );
    const user = await persistNativePluginAuthSession(nativeResult);
    updateUserProfile(user.uid, {
      email: normalizedEmail,
      lastLogin: new Date()
    }).catch((error: unknown) => {
      logger.warn('Unable to update native lastLogin before session restore.', { error });
    });
    return {
      user,
      nativeRest: true
    } as UserCredential;
  }

  const credential = await withTimeout<UserCredential>(
    signInWithEmailAndPassword(auth, normalizedEmail, password) as Promise<UserCredential>,
    'Firebase sign-in timed out.'
  );
  await updateUserProfile(credential.user.uid, {
    email: normalizedEmail,
    lastLogin: new Date()
  });
  return credential as UserCredential;
}

export async function signUpWithEmail(email: string, password: string, activationCode: string) {
  const normalizedEmail = requireValidAuthEmail(email);
  const [dbModule, { redeemAdminInviteAcceptance }, { executeEmailPasswordSignup }, { queueCurrentUserVerificationEmail }] =
    await Promise.all([loadLegacyAuthDb(), loadLegacyAdminInvite(), loadLegacySignupFlow(), loadLegacyAuthEmail()]);

  const nativeSignup = isNativeRuntime();
  const signupAuth = nativeSignup
    ? {
        get currentUser() {
          const user = getNativeAuthFallbackUser();
          return user
            ? {
                ...user,
                reload: () => FirebaseAuthentication.reload()
              }
            : null;
        }
      }
    : auth;
  return executeEmailPasswordSignup({
    email: normalizedEmail,
    password,
    activationCode: normalizeCode(activationCode),
    auth: signupAuth,
    dependencies: {
      validateAccessCode: async (code: string) => {
        const nativeAuthToken = nativeSignup ? await getNativeAuthIdToken().catch(() => null) : null;
        return dbModule.validateAccessCode(code, nativeAuthToken ? { nativeAuthToken } : undefined);
      },
      createUserWithEmailAndPassword: nativeSignup
        ? async (_auth: unknown, signupEmail: string, signupPassword: string) => {
            if (!(Capacitor as any).isPluginAvailable?.('FirebaseAuthentication')) {
              throw new Error('Native Firebase auth is unavailable.');
            }
            const nativeResult = (await FirebaseAuthentication.createUserWithEmailAndPassword({
              email: signupEmail,
              password: signupPassword
            })) as NativePluginSignInResult;
            return {
              user: await persistNativePluginAuthSession(nativeResult),
              nativeRest: true
            };
          }
        : createUserWithEmailAndPassword,
      redeemParentInvite: dbModule.redeemParentInvite,
      redeemFriendInvite: dbModule.redeemFriendInvite,
      redeemHouseholdInvite: dbModule.redeemHouseholdInvite,
      redeemCoParentInvite: dbModule.redeemCoParentInvite,
      rollbackParentInviteRedemption: dbModule.rollbackParentInviteRedemption,
      redeemAdminInviteAcceptance,
      updateUserProfile: dbModule.updateUserProfile,
      markAccessCodeAsUsed: dbModule.markAccessCodeAsUsed,
      getTeam: dbModule.getTeam,
      getUserProfile: dbModule.getUserProfile,
      sendVerificationEmail: nativeSignup
        ? async () => {
            const idToken = await getNativeAuthIdToken();
            if (!idToken) {
              throw new Error('Native Firebase auth did not return an ID token.');
            }
            await queueCurrentUserVerificationEmail(idToken);
          }
        : queueCurrentUserVerificationEmail,
      signOut: nativeSignup
        ? async () => {
            clearNativeAuthSession();
            await clearFirebaseAuthStorageSession();
            await FirebaseAuthentication.signOut();
          }
        : firebaseSignOut
    }
  }) as Promise<UserCredential>;
}

async function signInWithNativeGoogleCredential() {
  if (!(Capacitor as any).isPluginAvailable?.('FirebaseAuthentication')) {
    throw new Error('Native Google sign-in is only available in the iOS or Android app.');
  }

  logger.info('Native Google: requesting Google ID token.');
  const result = await withTimeout(
    FirebaseAuthentication.signInWithGoogle(getNativeGoogleSignInOptions()) as Promise<NativePluginSignInResult>,
    'Native Google sign-in timed out.',
    authTimeoutMs
  );
  const user = await persistNativePluginAuthSession(result);
  return {
    user,
    nativeRest: true
  } as UserCredential;
}

async function signInWithNativeAppleCredential() {
  if (!(Capacitor as any).isPluginAvailable?.('FirebaseAuthentication') || Capacitor.getPlatform?.() !== 'ios') {
    throw new Error('Sign in with Apple is available in the iOS app.');
  }

  const result = await withTimeout(
    FirebaseAuthentication.signInWithApple({ skipNativeAuth: false } as any) as Promise<NativePluginSignInResult>,
    'Sign in with Apple timed out.',
    authTimeoutMs
  );
  const user = await persistNativePluginAuthSession(result);
  return {
    user,
    nativeRest: true
  } as UserCredential;
}

export async function revokeCurrentAppleAuthorizationForDeletion() {
  if (!(Capacitor as any).isPluginAvailable?.('FirebaseAuthentication') || Capacitor.getPlatform?.() !== 'ios') {
    throw new Error('Sign in with Apple account deletion is only available in the iOS app.');
  }

  const result = await withTimeout(
    FirebaseAuthentication.signInWithApple({ skipNativeAuth: false } as any) as Promise<NativePluginSignInResult>,
    'Sign in with Apple timed out.',
    authTimeoutMs
  );
  const authorizationCode = String(result?.credential?.authorizationCode || '').trim();
  if (!authorizationCode) {
    throw new Error('Sign in with Apple did not return an authorization code for account deletion.');
  }
  await persistNativePluginAuthSession(result);
  await withTimeout(
    FirebaseAuthentication.revokeAccessToken({ token: authorizationCode }),
    'Apple authorization revocation timed out.',
    authTimeoutMs
  );
}

async function processGoogleResult(
  result: UserCredential | null,
  activationCode?: string | null,
  options: { preserveMissingProfileFields?: boolean } = {}
) {
  if (!result?.user) {
    return null;
  }
  const dbModule = await loadLegacyAuthDb();

  const code = normalizeCode(activationCode || window.sessionStorage.getItem(pendingActivationCodeKey));
  if (!isNewFirebaseUser(result.user)) {
    if (code) {
      await redeemInviteForUser(result.user.uid, code, result.user.email);
      result.activationCodeRedeemed = true;
    }
    const profileUpdate: Record<string, unknown> = {
      email: result.user.email || '',
      lastLogin: new Date()
    };
    if (!options.preserveMissingProfileFields || result.user.displayName) {
      profileUpdate.fullName = result.user.displayName || '';
    }
    if (!options.preserveMissingProfileFields || result.user.photoURL) {
      profileUpdate.photoUrl = result.user.photoURL || '';
    }
    await dbModule.updateUserProfile(result.user.uid, profileUpdate).catch((error: unknown) => {
      logger.warn('Unable to update provider lastLogin; continuing sign-in.', { error });
    });
    window.sessionStorage.removeItem(pendingActivationCodeKey);
    result.wasNewUser = false;
    return result;
  }

  if (!code) {
    window.sessionStorage.removeItem(pendingActivationCodeKey);
    await cleanupFailedNewUser(result.user, 'missing activation code');
    throw new Error('Activation code is required for new Google accounts.');
  }

  const validation = await dbModule.validateAccessCode(code, await getNativeAccessCodeValidationOptions(result));
  if (!validation.valid) {
    window.sessionStorage.removeItem(pendingActivationCodeKey);
    await cleanupFailedNewUser(result.user, 'invalid activation code');
    throw new Error(validation.message || 'Invalid activation code.');
  }

  try {
    if (validation.type === 'parent_invite') {
      await dbModule.redeemParentInvite(result.user.uid, validation.data?.code || code, result.user.email);
    } else if (validation.type === 'household_invite') {
      await dbModule.redeemHouseholdInvite(result.user.uid, validation.data?.code || code);
    } else if (validation.type === 'coparent_invite') {
      await dbModule.redeemCoParentInvite(result.user.uid, validation.data?.code || code, result.user.email);
    } else if (validation.type === 'friend_invite') {
      await dbModule.redeemFriendInvite(result.user.uid, validation.data?.code || code, result.user.email);
    } else if (validation.type === 'admin_invite') {
      const { redeemAdminInviteAcceptance } = await loadLegacyAdminInvite();
      await redeemAdminInviteAcceptance({
        userId: result.user.uid,
        userEmail: result.user.email,
        codeId: validation.codeId,
        getTeam: dbModule.getTeam,
        getUserProfile: dbModule.getUserProfile
      });
    } else {
      await dbModule.markAccessCodeAsUsed(validation.codeId, result.user.uid);
    }

    await dbModule.updateUserProfile(result.user.uid, {
      email: result.user.email || '',
      fullName: result.user.displayName || '',
      photoUrl: result.user.photoURL || '',
      createdAt: new Date(),
      lastLogin: new Date()
    });
  } catch (error) {
    window.sessionStorage.removeItem(pendingActivationCodeKey);
    await cleanupFailedNewUser(result.user, 'Google activation', { activationCode: validation.data?.code || code });
    throw error;
  }

  window.sessionStorage.removeItem(pendingActivationCodeKey);
  result.activationCodeRedeemed = true;
  result.wasNewUser = true;
  return result;
}

export async function signInWithGoogleAccount(activationCode?: string | null) {
  const code = normalizeCode(activationCode);
  if (code) {
    window.sessionStorage.setItem(pendingActivationCodeKey, code);
  }

  try {
    if (Capacitor.isNativePlatform()) {
      return await processGoogleResult(await signInWithNativeGoogleCredential(), code);
    }

    return await processGoogleResult(
      await withTimeout(signInWithPopup(auth, new GoogleAuthProvider()) as Promise<UserCredential>, 'Google sign-in timed out.'),
      code
    );
  } catch (error: any) {
    if (
      error?.code === 'auth/popup-blocked' ||
      error?.code === 'auth/popup-closed-by-user' ||
      error?.code === 'auth/cancelled-popup-request' ||
      error?.code === 'auth/operation-not-supported-in-this-environment'
    ) {
      await signInWithRedirect(auth, new GoogleAuthProvider());
      return null;
    }

    if (!code) {
      window.sessionStorage.removeItem(pendingActivationCodeKey);
    }
    throw error;
  }
}

export async function signInWithAppleAccount(activationCode?: string | null) {
  const code = normalizeCode(activationCode);
  if (code) {
    window.sessionStorage.setItem(pendingActivationCodeKey, code);
  }

  try {
    return await processGoogleResult(await signInWithNativeAppleCredential(), code, {
      preserveMissingProfileFields: true
    });
  } catch (error) {
    if (!code) {
      window.sessionStorage.removeItem(pendingActivationCodeKey);
    }
    throw error;
  }
}

export async function reauthenticateCurrentUserForDeletion(
  provider: 'apple' | 'google' | 'password' | 'unknown',
  password = ''
): Promise<{ appleAuthorizationRevoked: boolean }> {
  if (provider === 'apple') {
    await revokeCurrentAppleAuthorizationForDeletion();
    return { appleAuthorizationRevoked: true };
  }
  if (provider === 'google') {
    await signInWithGoogleAccount();
    return { appleAuthorizationRevoked: false };
  }
  if (provider === 'password') {
    const currentUser = auth.currentUser || getNativeAuthFallbackUser();
    const email = String(currentUser?.email || '').trim();
    if (!password) {
      const error = new Error('Enter your account password to confirm deletion.') as Error & { code?: string };
      error.code = 'account-deletion/password-required';
      throw error;
    }
    if (!email) {
      throw new Error('The signed-in account email is unavailable.');
    }
    await signInWithEmail(email, password);
    return { appleAuthorizationRevoked: false };
  }
  throw new Error('Sign out, sign in again, and retry account deletion.');
}

export async function completeGoogleRedirect() {
  if (isNativeRuntime()) {
    return null;
  }

  const result = await getRedirectResult(auth);
  return processGoogleResult(result as UserCredential | null);
}

export async function sendResetEmail(email: string) {
  const { queuePasswordResetEmail } = await loadLegacyAuthEmail();
  await queuePasswordResetEmail(requireValidAuthEmail(email));
}

export async function resendVerificationEmail() {
  const { queueCurrentUserVerificationEmail } = await loadLegacyAuthEmail();
  const user = getCurrentFirebaseUser();
  if (!user) {
    const idToken = await getNativeAuthIdToken();
    if (idToken) {
      await queueCurrentUserVerificationEmail(idToken);
      return;
    }
    throw new Error('No user is currently signed in.');
  }

  if (typeof user.reload === 'function') {
    await user.reload();
  }
  await queueCurrentUserVerificationEmail();
}

async function refreshNativeFallbackVerification() {
  const session = readNativeAuthSession();
  const fallbackUser = getNativeAuthFallbackUser();
  if (!session || !fallbackUser?.getIdToken) {
    return false;
  }

  const idToken = await fallbackUser.getIdToken(true);
  const lookupPayload = (await callFirebaseAuthRest('accounts:lookup', {
    idToken
  })) as { users?: NativeRestLookupUser[] };
  const lookupUser = Array.isArray(lookupPayload.users) ? lookupPayload.users[0] || {} : {};
  const verified = lookupUser.emailVerified === true;
  const refreshedSession = readNativeAuthSession() || session;

  writeNativeAuthSession({
    ...refreshedSession,
    email: lookupUser.email || refreshedSession.email,
    displayName: lookupUser.displayName || refreshedSession.displayName || null,
    photoUrl: lookupUser.photoUrl || refreshedSession.photoUrl || null,
    emailVerified: verified
  });

  return verified;
}

export async function reloadCurrentUser() {
  const user = getCurrentFirebaseUser();
  if (user?.reload) {
    await user.reload();
    const verified = user.emailVerified === true;
    if (verified) {
      if (typeof user.getIdToken !== 'function') {
        throw new Error('Unable to refresh the verified authentication session.');
      }
      // reload() refreshes the account profile with the current cached token;
      // force a new token before the UI exposes verified-only write paths.
      await user.getIdToken(true);
    }
    return verified;
  }

  return refreshNativeFallbackVerification();
}

export async function verifyResetCode(oobCode: string) {
  return verifyPasswordResetCode(auth, oobCode);
}

export async function confirmReset(oobCode: string, newPassword: string) {
  return confirmPasswordReset(auth, oobCode, newPassword);
}

export async function applyEmailActionCode(oobCode: string) {
  if (isNativeRuntime() && (Capacitor as any).isPluginAvailable?.('FirebaseAuthentication')) {
    return FirebaseAuthentication.applyActionCode({ oobCode });
  }
  return applyActionCode(auth, oobCode);
}

export function isEmailLink(url: string) {
  return isSignInWithEmailLink(auth, buildFirebaseSdkActionHref(url));
}

export async function completeEmailLink(email: string, url: string) {
  const normalizedEmail = requireValidAuthEmail(email);
  const emailLink = buildFirebaseSdkActionHref(url);
  const result =
    isNativeRuntime() && (Capacitor as any).isPluginAvailable?.('FirebaseAuthentication')
      ? ({
          user: await persistNativePluginAuthSession(
            (await FirebaseAuthentication.signInWithEmailLink({
              email: normalizedEmail,
              emailLink
            })) as NativePluginSignInResult
          ),
          nativeRest: true
        } as UserCredential)
      : ((await signInWithEmailLink(auth, normalizedEmail, emailLink)) as UserCredential);
  const { updateUserProfile } = await loadLegacyAuthDb();
  await updateUserProfile(result.user.uid, {
    email: normalizedEmail,
    lastLogin: new Date(),
    signInMethod: 'emailLink'
  });
  return result;
}

export async function setCurrentUserPassword(newPassword: string) {
  const { updateUserProfile } = await loadLegacyAuthDb();
  const user = auth.currentUser;
  if (user) {
    await updatePassword(user, newPassword);
    await updateUserProfile(user.uid, {
      hasPassword: true,
      passwordSetAt: new Date()
    });
    return;
  }

  const fallbackUser = getNativeAuthFallbackUser();
  if (!fallbackUser) {
    throw new Error('No user is currently signed in.');
  }
  if (!(Capacitor as any).isPluginAvailable?.('FirebaseAuthentication')) {
    throw new Error('Native Firebase auth is unavailable.');
  }
  await FirebaseAuthentication.updatePassword({ newPassword });
  await updateUserProfile(fallbackUser.uid, {
    hasPassword: true,
    passwordSetAt: new Date()
  }).catch((error: unknown) => logger.warn('Unable to mark native password as set.', { error }));
}

export async function redeemInviteForUser(userId: string, code: string, authEmail?: string | null) {
  const normalizedCode = normalizeCode(code);
  if (!normalizedCode || normalizedCode.length !== 8) {
    throw new Error('Please enter a valid 8-character invite code.');
  }

  const [dbModule, { redeemAdminInviteAtomically }, { createInviteProcessor }] = await Promise.all([
    loadLegacyAuthDb(),
    loadLegacyAdminInvite(),
    loadLegacyInviteFlow()
  ]);
  const processInvite = createInviteProcessor({
    validateAccessCode: dbModule.validateAccessCode,
    redeemParentInvite: dbModule.redeemParentInvite,
    redeemFriendInvite: dbModule.redeemFriendInvite,
    redeemHouseholdInvite: dbModule.redeemHouseholdInvite,
    redeemCoParentInvite: dbModule.redeemCoParentInvite,
    redeemAdminInviteAtomically,
    updateUserProfile: dbModule.updateUserProfile,
    updateTeam: dbModule.updateTeam,
    getTeam: dbModule.getTeam,
    getUserProfile: dbModule.getUserProfile,
    markAccessCodeAsUsed: dbModule.markAccessCodeAsUsed
  });
  return processInvite(userId, normalizedCode, authEmail || null);
}

export function rememberPendingInvite(code: string, type = 'parent') {
  const normalizedCode = normalizeCode(code);
  if (normalizedCode) {
    window.localStorage.setItem(pendingInviteCodeKey, normalizedCode);
    window.localStorage.setItem(pendingInviteTypeKey, type);
  }
}

export function readPendingInvite() {
  return {
    code: window.localStorage.getItem(pendingInviteCodeKey) || window.localStorage.getItem('inviteCode') || '',
    type: window.localStorage.getItem(pendingInviteTypeKey) || window.localStorage.getItem('inviteType') || 'parent'
  };
}

export function clearPendingInvite() {
  window.localStorage.removeItem(pendingInviteCodeKey);
  window.localStorage.removeItem(pendingInviteTypeKey);
  window.localStorage.removeItem('inviteCode');
  window.localStorage.removeItem('inviteType');
}

export function getRouteForUser(user: AuthUser | null) {
  if (!user) {
    return '/auth';
  }

  return '/home';
}

export function mapLegacyRedirectToAppRoute(redirectUrl?: string) {
  const normalized = String(redirectUrl || '').toLowerCase();
  if (normalized.includes('parent-dashboard') || normalized.includes('calendar')) {
    return '/home';
  }
  if (normalized.includes('dashboard')) {
    return '/teams';
  }
  if (normalized.includes('messages') || normalized.includes('team-chat')) {
    return '/messages';
  }
  return '/home';
}

export async function signOut() {
  clearNativeAuthSession();
  clearCachedUserData();
  await runBestEffortAuthCleanup('Firebase auth storage cleanup', clearFirebaseAuthStorageSession);
  await runBestEffortAuthCleanup('Native Firebase sign-out', async () => {
    if ((Capacitor as any).isPluginAvailable?.('FirebaseAuthentication')) {
      await FirebaseAuthentication.signOut();
    }
  });
  await runBestEffortAuthCleanup('Web Firebase sign-out', () => firebaseSignOut(auth));
}
