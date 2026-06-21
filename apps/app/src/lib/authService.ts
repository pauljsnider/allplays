import { Capacitor } from '@capacitor/core';
import { FirebaseAuthentication } from '@capacitor-firebase/authentication';
import {
  auth,
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
  signOut as firebaseSignOut,
  updatePassword,
  verifyPasswordResetCode
} from './firebaseAuthRuntime';
import type { AuthUser, UserRole } from './types';

export const firebaseAuth = auth;

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

type AuthDbModule = typeof import('../../../../js/db.js');
type AdminInviteModule = typeof import('../../../../js/admin-invite.js');
type InviteFlowModule = typeof import('../../../../js/accept-invite-flow.js');
type SignupFlowModule = typeof import('../../../../js/signup-flow.js');
type ParentMembershipUtilsModule = typeof import('../../../../js/parent-membership-utils.js');

let authDbPromise: Promise<AuthDbModule> | null = null;
let adminInvitePromise: Promise<AdminInviteModule> | null = null;
let inviteFlowPromise: Promise<InviteFlowModule> | null = null;
let signupFlowPromise: Promise<SignupFlowModule> | null = null;
let parentMembershipUtilsPromise: Promise<ParentMembershipUtilsModule> | null = null;

function loadAuthDb() {
  authDbPromise ||= import('../../../../js/db.js');
  return authDbPromise;
}

function loadAdminInvite() {
  adminInvitePromise ||= import('../../../../js/admin-invite.js');
  return adminInvitePromise;
}

function loadInviteFlow() {
  inviteFlowPromise ||= import('../../../../js/accept-invite-flow.js');
  return inviteFlowPromise;
}

function loadSignupFlow() {
  signupFlowPromise ||= import('../../../../js/signup-flow.js');
  return signupFlowPromise;
}

function loadParentMembershipUtils() {
  parentMembershipUtilsPromise ||= import('../../../../js/parent-membership-utils.js');
  return parentMembershipUtilsPromise;
}

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
};

type HydratedUser = {
  user: AuthUser;
  profile: Record<string, unknown>;
};

type NativeAuthSession = {
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

type NativeProviderInfo = {
  providerId?: string;
  rawId?: string;
  federatedId?: string;
  email?: string;
  displayName?: string;
  phoneNumber?: string;
  photoUrl?: string;
};

type NativeRestSignInPayload = {
  localId: string;
  email?: string;
  displayName?: string;
  profilePicture?: string;
  photoUrl?: string;
  idToken: string;
  refreshToken: string;
  expiresIn?: string;
  isNewUser?: boolean;
};

type NativeRestLookupUser = {
  email?: string;
  emailVerified?: boolean;
  displayName?: string;
  photoUrl?: string;
  phoneNumber?: string;
  providerUserInfo?: NativeProviderInfo[];
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
    serverAuthCode?: string;
  } | null;
  additionalUserInfo?: {
    isNewUser?: boolean;
  } | null;
};

function normalizeEmail(email: string) {
  return String(email || '').trim().toLowerCase();
}

function normalizeCode(code: string | null | undefined) {
  return String(code || '').trim().toUpperCase();
}

function isNativeRuntime() {
  return Capacitor.isNativePlatform() || window.location.protocol === 'capacitor:';
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
    await withTimeout(
      Promise.resolve().then(cleanup),
      `${label} timed out.`,
      signOutCleanupTimeoutMs
    );
  } catch (error) {
    console.warn(`[app-auth] ${label} failed during sign-out:`, error);
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

  if (code === 'auth/invalid-credential' || code === 'auth/wrong-password') {
    return 'Email or password is incorrect.';
  }

  if (code === 'auth/user-not-found') {
    return 'No ALL PLAYS account was found for that email.';
  }

  if (code === 'auth/too-many-requests') {
    return 'Too many attempts. Wait a bit and try again.';
  }

  if (code === 'auth/network-request-failed') {
    return 'Network request failed. Check the device connection.';
  }

  if (code === 'auth/account-exists-with-different-credential') {
    return 'An account already exists for that email with a different sign-in method.';
  }

  if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') {
    return 'Google sign-in was cancelled.';
  }

  return error?.message || 'Authentication failed.';
}

function getFirebaseAuthStorageKey() {
  const apiKey = auth.app?.options?.apiKey || '';
  const appName = auth.app?.name || '[DEFAULT]';
  return `firebase:authUser:${apiKey}:${appName}`;
}

function readNativeAuthSession(): NativeAuthSession | null {
  try {
    const rawSession = window.localStorage?.getItem(nativeAuthSessionStorageKey);
    return rawSession ? JSON.parse(rawSession) as NativeAuthSession : null;
  } catch (error) {
    console.warn('[app-auth] Unable to read native auth fallback session:', error);
    return null;
  }
}

function writeNativeAuthSession(session: NativeAuthSession) {
  try {
    window.localStorage?.setItem(nativeAuthSessionStorageKey, JSON.stringify(session));
  } catch (error) {
    console.warn('[app-auth] Unable to update native auth fallback session:', error);
  }
}

function clearNativeAuthSession() {
  try {
    window.localStorage?.removeItem(nativeAuthSessionStorageKey);
  } catch (error) {
    console.warn('[app-auth] Unable to clear native auth fallback session:', error);
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
    console.warn('[app-auth] Unable to clear Firebase auth storage session:', error);
  } finally {
    database?.close();
  }
}

function normalizeProviderData(providerUserInfo: NativeProviderInfo[] = [], email = '') {
  const providers = Array.isArray(providerUserInfo) ? providerUserInfo : [];
  const mappedProviders = providers.map((provider) => ({
    providerId: provider.providerId || 'password',
    uid: provider.rawId || provider.federatedId || provider.email || email,
    displayName: provider.displayName || null,
    email: provider.email || email || null,
    phoneNumber: provider.phoneNumber || null,
    photoURL: provider.photoUrl || null
  }));

  if (!mappedProviders.some((provider) => provider.providerId === 'password')) {
    mappedProviders.push({
      providerId: 'password',
      uid: email,
      displayName: null,
      email,
      phoneNumber: null,
      photoURL: null
    });
  }

  return mappedProviders;
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

async function refreshNativeAuthSession(session: NativeAuthSession) {
  const apiKey = session.apiKey || auth.app?.options?.apiKey || '';
  if (!apiKey || !session.refreshToken) {
    throw new Error('Native auth refresh is unavailable.');
  }

  const response = await withTimeout(fetch(`https://securetoken.googleapis.com/v1/token?key=${encodeURIComponent(apiKey)}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: session.refreshToken
    })
  }), 'Firebase Auth refresh timed out.');
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.error?.message || 'Unable to refresh native auth session.');
  }

  const expiresInSeconds = Number.parseInt(payload.expires_in || '3600', 10);
  const nextSession: NativeAuthSession = {
    ...session,
    uid: payload.user_id || session.uid,
    idToken: payload.id_token || session.idToken,
    refreshToken: payload.refresh_token || session.refreshToken,
    expirationTime: Date.now() + Math.max(expiresInSeconds - 30, 60) * 1000
  };
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

  const idToken = await getNativePluginToken(true);
  const nextSession: NativeAuthSession = {
    ...session,
    uid: currentUser.uid,
    email: currentUser.email || session.email || '',
    idToken,
    expirationTime: Date.now() + 55 * 60 * 1000,
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
  if (!session?.uid || !session?.idToken || (!session.refreshToken && session.provider !== 'native-plugin')) {
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
      let currentSession = readNativeAuthSession() || session;
      if (forceRefresh || Number(currentSession.expirationTime || 0) < Date.now() + 60000) {
        currentSession = currentSession.provider === 'native-plugin'
          ? await refreshNativePluginAuthSession(currentSession)
          : await refreshNativeAuthSession(currentSession);
      }
      return currentSession.idToken;
    },
    async delete() {
      await deleteNativeAuthUser();
    }
  };
}

export async function getNativeAuthIdToken(forceRefresh = false): Promise<string | null> {
  const fallbackUser = getNativeAuthFallbackUser();
  if (!fallbackUser?.getIdToken) {
    return null;
  }

  return fallbackUser.getIdToken(forceRefresh);
}

async function persistNativeRestAuthSession(signInPayload: NativeRestSignInPayload, lookupUser: NativeRestLookupUser = {}): Promise<FirebaseUser> {
  const email = signInPayload.email || lookupUser.email || '';
  const expiresInSeconds = Number.parseInt(signInPayload.expiresIn || '3600', 10);
  const expirationTime = Date.now() + Math.max(expiresInSeconds - 30, 60) * 1000;
  const now = `${Date.now()}`;
  const photoUrl = signInPayload.profilePicture || signInPayload.photoUrl || lookupUser.photoUrl || null;
  const authUser = {
    uid: signInPayload.localId,
    email,
    emailVerified: lookupUser.emailVerified === true,
    displayName: signInPayload.displayName || lookupUser.displayName || null,
    isAnonymous: false,
    photoURL: photoUrl,
    phoneNumber: lookupUser.phoneNumber || null,
    tenantId: null,
    providerData: normalizeProviderData(lookupUser.providerUserInfo, email),
    stsTokenManager: {
      refreshToken: signInPayload.refreshToken,
      accessToken: signInPayload.idToken,
      expirationTime
    },
    metadata: {
      creationTime: signInPayload.isNewUser ? now : lookupUser.createdAt,
      lastSignInTime: lookupUser.lastLoginAt || now
    },
    isNewUser: signInPayload.isNewUser === true,
    _redirectEventId: undefined,
    createdAt: lookupUser.createdAt || undefined,
    lastLoginAt: lookupUser.lastLoginAt || `${Date.now()}`,
    apiKey: auth.app?.options?.apiKey || '',
    appName: auth.app?.name || '[DEFAULT]'
  };

  writeNativeAuthSession({
    uid: authUser.uid,
    email: authUser.email,
    idToken: signInPayload.idToken,
    refreshToken: signInPayload.refreshToken,
    expirationTime,
    apiKey: auth.app?.options?.apiKey || '',
    displayName: authUser.displayName,
    photoUrl: authUser.photoURL,
    emailVerified: authUser.emailVerified,
    provider: 'rest'
  });

  const database = await openFirebaseAuthStorage();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(firebaseAuthStorageStore, 'readwrite');
      transaction.objectStore(firebaseAuthStorageStore).put({
        fbase_key: getFirebaseAuthStorageKey(),
        value: authUser
      });
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error || new Error('Unable to persist auth session.'));
      transaction.onabort = () => reject(transaction.error || new Error('Auth session persistence was aborted.'));
    });
  } finally {
    database.close();
  }

  return {
    uid: authUser.uid,
    email: authUser.email,
    emailVerified: authUser.emailVerified,
    displayName: authUser.displayName,
    photoURL: authUser.photoURL,
    metadata: authUser.metadata,
    isNativeRestSession: true,
    isNewUser: authUser.isNewUser,
    async getIdToken(forceRefresh = false) {
      let currentSession = readNativeAuthSession();
      if (!currentSession) {
        currentSession = {
          uid: authUser.uid,
          email: authUser.email,
          idToken: signInPayload.idToken,
          refreshToken: signInPayload.refreshToken,
          expirationTime,
          apiKey: auth.app?.options?.apiKey || '',
          provider: 'rest'
        };
      }
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
    throw new Error('Native Google sign-in did not return a Firebase user.');
  }

  const idToken = await getNativePluginToken(true);
  const lookupPayload = await callFirebaseAuthRest('accounts:lookup', {
    idToken
  }).catch((error) => {
    console.warn('[app-auth] Unable to load native Firebase auth profile:', error);
    return {};
  }) as { users?: NativeRestLookupUser[] };
  const lookupUser = Array.isArray(lookupPayload.users) ? lookupPayload.users[0] || {} : {};
  const email = pluginUser.email || lookupUser.email || '';
  const displayName = pluginUser.displayName || lookupUser.displayName || null;
  const photoUrl = pluginUser.photoUrl || lookupUser.photoUrl || null;
  const metadata = nativeMetadataToAuthMetadata(pluginUser.metadata);
  const expirationTime = Date.now() + 55 * 60 * 1000;
  const isNewUser = nativeResult.additionalUserInfo?.isNewUser === true;

  writeNativeAuthSession({
    uid: pluginUser.uid,
    email,
    idToken,
    expirationTime,
    apiKey: auth.app?.options?.apiKey || '',
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
      let currentSession = readNativeAuthSession();
      if (!currentSession) {
        currentSession = {
          uid: pluginUser.uid || '',
          email,
          idToken,
          expirationTime,
          apiKey: auth.app?.options?.apiKey || '',
          displayName,
          photoUrl,
          emailVerified: pluginUser.emailVerified === true || lookupUser.emailVerified === true,
          provider: 'native-plugin'
        };
      }
      if (forceRefresh || Number(currentSession.expirationTime || 0) < Date.now() + 60000) {
        currentSession = await refreshNativePluginAuthSession(currentSession);
      }
      return currentSession.idToken;
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
  if (
    restCode === 'EMAIL_NOT_FOUND' ||
    restCode === 'INVALID_PASSWORD' ||
    restCode === 'INVALID_LOGIN_CREDENTIALS'
  ) {
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

  const response = await withTimeout(fetch(`https://identitytoolkit.googleapis.com/v1/${endpoint}?key=${encodeURIComponent(apiKey)}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  }), 'Firebase Auth request timed out.');
  const responsePayload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw createRestAuthError(responsePayload);
  }
  return responsePayload;
}

async function deleteNativeAuthUser() {
  const session = readNativeAuthSession();
  if (!session?.idToken) {
    clearNativeAuthSession();
    await clearFirebaseAuthStorageSession();
    return;
  }

  try {
    if (session.provider === 'native-plugin' && (Capacitor as any).isPluginAvailable?.('FirebaseAuthentication')) {
      await FirebaseAuthentication.deleteUser();
    } else {
      await callFirebaseAuthRest('accounts:delete', {
        idToken: session.idToken
      });
    }
  } finally {
    clearNativeAuthSession();
    await clearFirebaseAuthStorageSession();
  }
}

async function signInWithNativeRestSession(email: string, password: string) {
  const signInPayload = await callFirebaseAuthRest('accounts:signInWithPassword', {
    email,
    password,
    returnSecureToken: true
  }) as NativeRestSignInPayload;
  const lookupPayload = await callFirebaseAuthRest('accounts:lookup', {
    idToken: signInPayload.idToken
  }).catch((error) => {
    console.warn('[app-auth] Unable to load native REST auth profile:', error);
    return {};
  }) as { users?: NativeRestLookupUser[] };
  const lookupUser = Array.isArray(lookupPayload.users) ? lookupPayload.users[0] || {} : {};
  return persistNativeRestAuthSession(signInPayload, lookupUser);
}

function getNativeGoogleRequestUri() {
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  return origin.startsWith('http://') || origin.startsWith('https://') ? origin : 'https://allplays.ai';
}

function getNativeGoogleSignInOptions() {
  const options: {
    skipNativeAuth: boolean;
    useCredentialManager?: boolean;
  } = {
    skipNativeAuth: true
  };

  if (Capacitor.getPlatform?.() === 'android') {
    options.useCredentialManager = false;
  }

  return options;
}

async function signInWithNativeGoogleRestSession(googleIdToken: string, googleAccessToken?: string | null) {
  const postBody = new URLSearchParams({
    providerId: 'google.com'
  });

  if (googleIdToken) {
    postBody.set('id_token', googleIdToken);
  }
  if (googleAccessToken) {
    postBody.set('access_token', googleAccessToken);
  }

  const signInPayload = await callFirebaseAuthRest('accounts:signInWithIdp', {
    postBody: postBody.toString(),
    requestUri: getNativeGoogleRequestUri(),
    returnIdpCredential: true,
    returnSecureToken: true
  }) as NativeRestSignInPayload;
  const lookupPayload = await callFirebaseAuthRest('accounts:lookup', {
    idToken: signInPayload.idToken
  }).catch((error) => {
    console.warn('[app-auth] Unable to load native Google REST auth profile:', error);
    return {};
  }) as { users?: NativeRestLookupUser[] };
  const lookupUser = Array.isArray(lookupPayload.users) ? lookupPayload.users[0] || {} : {};
  return persistNativeRestAuthSession(signInPayload, lookupUser);
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
    parentOf: Array.isArray(profile.parentOf) ? profile.parentOf as Array<Record<string, unknown>> : [],
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

async function cleanupFailedNewUser(user: FirebaseUser | null, context: string) {
  if (user?.delete) {
    try {
      await user.delete();
    } catch (deleteError) {
      console.error(`Error deleting user after ${context}:`, deleteError);
    }
  }

  try {
    await firebaseSignOut(auth);
  } catch (signOutError) {
    console.error(`Error signing out after ${context}:`, signOutError);
  }
}

export async function hydrateFirebaseUser(user: FirebaseUser): Promise<HydratedUser> {
  if (user.isNativeRestSession && !auth.currentUser) {
    const profile = {
      email: user.email || ''
    };
    return {
      user: toAuthUser(user, profile),
      profile
    };
  }

  let profile: Record<string, unknown> = {};
  const dbModule = await loadAuthDb();
  try {
    profile = await withTimeout(
      Promise.resolve(dbModule.getUserProfile(user.uid)),
      'Profile load timed out.',
      profileHydrationTimeoutMs
    ) || {};
  } catch (error) {
    console.warn('[app-auth] Failed to load profile; continuing with auth identity:', error);
    profile = {
      email: user.email || ''
    };
  }

  try {
    const { mergeApprovedParentMembershipRequests } = await loadParentMembershipUtils();
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
    console.warn('[app-auth] Failed to sync approved parent membership requests:', error);
  }

  if (!Array.isArray(profile.coachOf) || profile.coachOf.length === 0) {
    try {
      const teams = await withTimeout(
        Promise.resolve(dbModule.getUserTeams(user.uid)),
        'Team access load timed out.',
        profileHydrationTimeoutMs
      );
      if (Array.isArray(teams) && teams.length > 0) {
        profile = {
          ...profile,
          coachOf: teams.map((team: Record<string, unknown>) => team.id).filter(Boolean)
        };
      }
    } catch (error) {
      console.warn('[app-auth] Failed to load owned teams:', error);
    }
  }

  return {
    user: toAuthUser(user, profile),
    profile
  };
}

export function observeFirebaseUser(callback: (user: FirebaseUser | null) => void) {
  let timeoutId: number | undefined;

  if (isNativeRuntime()) {
    timeoutId = window.setTimeout(() => {
      const fallbackUser = getNativeAuthFallbackUser();
      if (fallbackUser) {
        callback(fallbackUser);
      }
    }, nativeAuthObserverTimeoutMs);
  }

  const unsubscribe = onAuthStateChanged(auth, (user: FirebaseUser | null) => {
    if (timeoutId) {
      window.clearTimeout(timeoutId);
      timeoutId = undefined;
    }
    if (user) {
      callback(user);
      return;
    }
    callback(isNativeRuntime() ? getNativeAuthFallbackUser() : null);
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
  const normalizedEmail = normalizeEmail(email);
  const { updateUserProfile } = await loadAuthDb();

  if (isNativeRuntime()) {
    const user = await signInWithNativeRestSession(normalizedEmail, password);
    updateUserProfile(user.uid, {
      email: normalizedEmail,
      lastLogin: new Date()
    }).catch((error: unknown) => {
      console.warn('[app-auth] Unable to update native lastLogin before session restore:', error);
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
  const [
    dbModule,
    { redeemAdminInviteAcceptance },
    { executeEmailPasswordSignup }
  ] = await Promise.all([
    loadAuthDb(),
    loadAdminInvite(),
    loadSignupFlow()
  ]);

  return executeEmailPasswordSignup({
    email: email.trim(),
    password,
    activationCode: normalizeCode(activationCode),
    auth,
    dependencies: {
      validateAccessCode: dbModule.validateAccessCode,
      createUserWithEmailAndPassword,
      redeemParentInvite: dbModule.redeemParentInvite,
      redeemAdminInviteAcceptance,
      updateUserProfile: dbModule.updateUserProfile,
      markAccessCodeAsUsed: dbModule.markAccessCodeAsUsed,
      getTeam: dbModule.getTeam,
      getUserProfile: dbModule.getUserProfile,
      sendEmailVerification,
      signOut: firebaseSignOut
    }
  }) as Promise<UserCredential>;
}

async function signInWithNativeGoogleCredential() {
  if (!(Capacitor as any).isPluginAvailable?.('FirebaseAuthentication')) {
    throw new Error('Native Google sign-in is only available in the iOS or Android app.');
  }

  console.info('[app-auth] Native Google: requesting Google ID token.');
  const result = await withTimeout(
    FirebaseAuthentication.signInWithGoogle(getNativeGoogleSignInOptions()) as Promise<NativePluginSignInResult>,
    'Native Google sign-in timed out.',
    authTimeoutMs
  );
  const idToken = result?.credential?.idToken;
  const accessToken = result?.credential?.accessToken;
  if (!idToken) {
    throw new Error('Google sign-in did not return an ID token.');
  }

  console.info('[app-auth] Native Google: exchanging token with Firebase Auth REST.');
  const user = await signInWithNativeGoogleRestSession(idToken, accessToken);
  return {
    user,
    nativeRest: true
  } as UserCredential;
}

async function processGoogleResult(result: UserCredential | null, activationCode?: string | null) {
  if (!result?.user) {
    return null;
  }
  const dbModule = await loadAuthDb();

  if (!isNewFirebaseUser(result.user)) {
    await dbModule.updateUserProfile(result.user.uid, {
      email: result.user.email || '',
      fullName: result.user.displayName || '',
      photoUrl: result.user.photoURL || '',
      lastLogin: new Date()
    }).catch((error: unknown) => {
      console.warn('[app-auth] Unable to update Google lastLogin; continuing sign-in:', error);
    });
    return result;
  }

  const code = normalizeCode(activationCode || window.sessionStorage.getItem(pendingActivationCodeKey));
  if (!code) {
    window.sessionStorage.removeItem(pendingActivationCodeKey);
    await cleanupFailedNewUser(result.user, 'missing activation code');
    throw new Error('Activation code is required for new Google accounts.');
  }

  const validation = await dbModule.validateAccessCode(code);
  if (!validation.valid) {
    window.sessionStorage.removeItem(pendingActivationCodeKey);
    await cleanupFailedNewUser(result.user, 'invalid activation code');
    throw new Error(validation.message || 'Invalid activation code.');
  }

  try {
    if (validation.type === 'parent_invite') {
      await dbModule.redeemParentInvite(result.user.uid, validation.data?.code || code, result.user.email);
    } else if (validation.type === 'admin_invite') {
      const { redeemAdminInviteAcceptance } = await loadAdminInvite();
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
    await cleanupFailedNewUser(result.user, 'Google activation');
    throw error;
  }

  window.sessionStorage.removeItem(pendingActivationCodeKey);
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

export async function completeGoogleRedirect() {
  if (isNativeRuntime()) {
    return null;
  }

  const result = await getRedirectResult(auth);
  return processGoogleResult(result as UserCredential | null);
}

export async function sendResetEmail(email: string) {
  await sendPasswordResetEmail(auth, email.trim(), {
    url: 'https://allplays.ai/reset-password.html',
    handleCodeInApp: true
  });
}

export async function resendVerificationEmail() {
  const user = getCurrentFirebaseUser();
  if (!user) {
    const idToken = await getNativeAuthIdToken();
    if (idToken) {
      await callFirebaseAuthRest('accounts:sendOobCode', {
        requestType: 'VERIFY_EMAIL',
        idToken
      });
      return;
    }
    throw new Error('No user is currently signed in.');
  }

  if (typeof user.reload === 'function') {
    await user.reload();
  }
  await sendEmailVerification(user);
}

async function refreshNativeFallbackVerification() {
  const session = readNativeAuthSession();
  const fallbackUser = getNativeAuthFallbackUser();
  if (!session || !fallbackUser?.getIdToken) {
    return false;
  }

  const idToken = await fallbackUser.getIdToken(true);
  const lookupPayload = await callFirebaseAuthRest('accounts:lookup', {
    idToken
  }) as { users?: NativeRestLookupUser[] };
  const lookupUser = Array.isArray(lookupPayload.users) ? lookupPayload.users[0] || {} : {};
  const verified = lookupUser.emailVerified === true;
  const refreshedSession = readNativeAuthSession() || session;

  writeNativeAuthSession({
    ...refreshedSession,
    idToken,
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
    return user.emailVerified === true;
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
  return applyActionCode(auth, oobCode);
}

export function isEmailLink(url: string) {
  return isSignInWithEmailLink(auth, url);
}

export async function completeEmailLink(email: string, url: string) {
  const result = await signInWithEmailLink(auth, email.trim(), url) as UserCredential;
  const { updateUserProfile } = await loadAuthDb();
  await updateUserProfile(result.user.uid, {
    email: email.trim(),
    lastLogin: new Date(),
    signInMethod: 'emailLink'
  });
  return result;
}

export async function setCurrentUserPassword(newPassword: string) {
  const { updateUserProfile } = await loadAuthDb();
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
  const idToken = await getNativeAuthIdToken();
  if (!fallbackUser || !idToken) {
    throw new Error('No user is currently signed in.');
  }

  const payload = await callFirebaseAuthRest('accounts:update', {
    idToken,
    password: newPassword,
    returnSecureToken: true
  }) as NativeRestSignInPayload;
  await persistNativeRestAuthSession({
    ...payload,
    localId: payload.localId || fallbackUser.uid,
    email: payload.email || fallbackUser.email || ''
  });
  await updateUserProfile(fallbackUser.uid, {
    hasPassword: true,
    passwordSetAt: new Date()
  }).catch((error: unknown) => console.warn('[app-auth] Unable to mark native password as set:', error));
}

export async function redeemInviteForUser(userId: string, code: string, authEmail?: string | null) {
  const normalizedCode = normalizeCode(code);
  if (!normalizedCode || normalizedCode.length !== 8) {
    throw new Error('Please enter a valid 8-character invite code.');
  }

  const [
    dbModule,
    { createInviteProcessor }
  ] = await Promise.all([
    loadAuthDb(),
    loadInviteFlow()
  ]);
  const processInvite = createInviteProcessor({
    validateAccessCode: dbModule.validateAccessCode,
    redeemParentInvite: dbModule.redeemParentInvite,
    redeemHouseholdInvite: dbModule.redeemHouseholdInvite,
    redeemAdminInviteAtomically: dbModule.redeemAdminInviteAtomically,
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

  if (user.isAdmin || user.roles.includes('coach') || user.roles.includes('admin') || user.roles.includes('platformAdmin')) {
    return '/teams';
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
  await runBestEffortAuthCleanup('Firebase auth storage cleanup', clearFirebaseAuthStorageSession);
  await runBestEffortAuthCleanup('Native Firebase sign-out', async () => {
    if ((Capacitor as any).isPluginAvailable?.('FirebaseAuthentication')) {
      await FirebaseAuthentication.signOut();
    }
  });
  await runBestEffortAuthCleanup('Web Firebase sign-out', () => firebaseSignOut(auth));
}
