import {
    GoogleAuthProvider,
    auth,
    db,
    doc,
    onAuthStateChanged,
    sendPasswordResetEmail,
    serverTimestamp,
    setDoc,
    signInWithCredential,
    signInWithEmailAndPassword
} from './js/firebase.js?v=13';
import { getAppHomeUrl, isNativeApp, markAppMode, signInWithNativeGoogle } from './js/native-app.js?v=4';

markAppMode();

const AUTH_TIMEOUT_MS = 15000;
const FIREBASE_AUTH_STORAGE_DB = 'firebaseLocalStorageDb';
const FIREBASE_AUTH_STORAGE_STORE = 'firebaseLocalStorage';
const NATIVE_AUTH_SESSION_STORAGE_KEY = 'allplays-native-auth-session';

const els = {
    signedOutView: document.getElementById('signed-out-view'),
    signedInView: document.getElementById('signed-in-view'),
    loginForm: document.getElementById('login-form'),
    email: document.getElementById('email'),
    password: document.getElementById('password'),
    loginButton: document.getElementById('login-button'),
    googleButton: document.getElementById('google-button'),
    resetButton: document.getElementById('reset-button'),
    authMessage: document.getElementById('auth-message'),
    launchMessage: document.getElementById('launch-message')
};

function setMessage(message, tone = 'neutral') {
    els.authMessage.textContent = message || '';
    els.authMessage.className = `message${tone === 'error' ? ' error' : ''}${tone === 'success' ? ' success' : ''}`;
}

function setBusy(isBusy) {
    els.loginButton.disabled = isBusy;
    els.googleButton.disabled = isBusy;
    els.resetButton.disabled = isBusy;
}

function getEmail() {
    return els.email.value.trim().toLowerCase();
}

function withTimeout(promise, message, timeoutMs = AUTH_TIMEOUT_MS) {
    let timeoutId;
    const timeout = new Promise((_, reject) => {
        timeoutId = window.setTimeout(() => {
            const error = new Error(message);
            error.code = 'auth/network-request-failed';
            reject(error);
        }, timeoutMs);
    });

    return Promise.race([promise, timeout]).finally(() => {
        window.clearTimeout(timeoutId);
    });
}

function describeAuthError(error) {
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
        return `Firebase is blocking this local origin (${origin}). Run the app from the configured mobile dev URL or add this origin to the web API key restrictions.`;
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

function persistNativeAuthFallbackSession(session) {
    const sessionPayload = {
        uid: session.uid || '',
        email: session.email || '',
        idToken: session.idToken || '',
        refreshToken: session.refreshToken || '',
        expirationTime: session.expirationTime || 0,
        apiKey: auth.app?.options?.apiKey || ''
    };

    try {
        window.localStorage?.setItem(NATIVE_AUTH_SESSION_STORAGE_KEY, JSON.stringify(sessionPayload));
    } catch (error) {
        console.warn('[mobile] Unable to persist native auth fallback session:', error);
    }
}

function readNativeAuthFallbackSession() {
    try {
        const rawSession = window.localStorage?.getItem(NATIVE_AUTH_SESSION_STORAGE_KEY);
        return rawSession ? JSON.parse(rawSession) : null;
    } catch (error) {
        console.warn('[mobile] Unable to read native auth fallback session:', error);
        return null;
    }
}

function hasNativeAuthFallbackSession() {
    const session = readNativeAuthFallbackSession();
    return !!(session?.uid && session?.idToken && session?.refreshToken);
}

function normalizeProviderData(providerUserInfo = [], email = '') {
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

function openFirebaseAuthStorage() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(FIREBASE_AUTH_STORAGE_DB, 1);
        request.onupgradeneeded = () => {
            const database = request.result;
            if (!database.objectStoreNames.contains(FIREBASE_AUTH_STORAGE_STORE)) {
                database.createObjectStore(FIREBASE_AUTH_STORAGE_STORE, { keyPath: 'fbase_key' });
            }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error || new Error('Unable to open auth storage.'));
    });
}

async function persistNativeRestAuthSession(signInPayload, lookupUser = {}) {
    const email = signInPayload.email || lookupUser.email || '';
    const expiresInSeconds = Number.parseInt(signInPayload.expiresIn || '3600', 10);
    const authUser = {
        uid: signInPayload.localId,
        email,
        emailVerified: lookupUser.emailVerified === true,
        displayName: signInPayload.displayName || lookupUser.displayName || null,
        isAnonymous: false,
        photoURL: signInPayload.profilePicture || lookupUser.photoUrl || null,
        phoneNumber: lookupUser.phoneNumber || null,
        tenantId: null,
        providerData: normalizeProviderData(lookupUser.providerUserInfo, email),
        stsTokenManager: {
            refreshToken: signInPayload.refreshToken,
            accessToken: signInPayload.idToken,
            expirationTime: Date.now() + Math.max(expiresInSeconds - 30, 60) * 1000
        },
        _redirectEventId: undefined,
        createdAt: lookupUser.createdAt || undefined,
        lastLoginAt: lookupUser.lastLoginAt || `${Date.now()}`,
        apiKey: auth.app?.options?.apiKey || '',
        appName: auth.app?.name || '[DEFAULT]'
    };

    persistNativeAuthFallbackSession({
        uid: authUser.uid,
        email: authUser.email,
        idToken: signInPayload.idToken,
        refreshToken: signInPayload.refreshToken,
        expirationTime: authUser.stsTokenManager.expirationTime
    });

    const database = await openFirebaseAuthStorage();
    try {
        await new Promise((resolve, reject) => {
            const transaction = database.transaction(FIREBASE_AUTH_STORAGE_STORE, 'readwrite');
            transaction.objectStore(FIREBASE_AUTH_STORAGE_STORE).put({
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
        email: authUser.email
    };
}

function createRestAuthError(payload, fallbackMessage) {
    const restCode = payload?.error?.message || '';
    const error = new Error(fallbackMessage || restCode || 'Authentication failed.');
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

async function callFirebaseAuthRest(endpoint, payload) {
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

async function signInWithNativeRestSession(email, password) {
    const signInPayload = await callFirebaseAuthRest('accounts:signInWithPassword', {
        email,
        password,
        returnSecureToken: true
    });
    const lookupPayload = await callFirebaseAuthRest('accounts:lookup', {
        idToken: signInPayload.idToken
    }).catch((error) => {
        console.warn('[mobile] Unable to load native REST auth profile:', error);
        return {};
    });
    const lookupUser = Array.isArray(lookupPayload.users) ? lookupPayload.users[0] || {} : {};
    return persistNativeRestAuthSession(signInPayload, lookupUser);
}

function showSignedOut() {
    els.signedOutView.classList.remove('hidden');
    els.signedInView.classList.add('hidden');
}

function showLaunching() {
    els.signedOutView.classList.add('hidden');
    els.signedInView.classList.remove('hidden');
}

function openDashboard() {
    showLaunching();
    if (els.launchMessage) {
        els.launchMessage.textContent = 'Loading your dashboard...';
    }
    window.location.replace(getAppHomeUrl());
}

async function updateLastLogin(user) {
    try {
        await setDoc(doc(db, 'users', user.uid), {
            email: user.email || '',
            lastLogin: serverTimestamp()
        }, { merge: true });
    } catch (error) {
        console.warn('[mobile] Unable to update lastLogin:', error);
    }
}

async function handleEmailSignIn(event) {
    event.preventDefault();
    setBusy(true);
    setMessage('');

    try {
        setMessage('Signing in...');
        const email = getEmail();
        const user = isNativeApp()
            ? await signInWithNativeRestSession(email, els.password.value)
            : (await withTimeout(signInWithEmailAndPassword(auth, email, els.password.value), 'Firebase sign-in timed out.')).user;
        setMessage('Opening dashboard...', 'success');
        updateLastLogin(user);
        openDashboard();
    } catch (error) {
        console.error('[mobile] Email sign-in failed:', error);
        setMessage(describeAuthError(error), 'error');
    } finally {
        setBusy(false);
    }
}

async function handleGoogleSignIn() {
    setBusy(true);
    setMessage('');

    try {
        const userCredential = await signInWithNativeGoogle({
            auth,
            GoogleAuthProvider,
            signInWithCredential
        });
        updateLastLogin(userCredential.user);
        openDashboard();
    } catch (error) {
        console.error('[mobile] Google sign-in failed:', error);
        setMessage(describeAuthError(error), 'error');
    } finally {
        setBusy(false);
    }
}

async function handlePasswordReset() {
    const email = getEmail();
    if (!email) {
        setMessage('Enter your email first.', 'error');
        els.email.focus();
        return;
    }

    setBusy(true);
    setMessage('');

    try {
        await sendPasswordResetEmail(auth, email, {
            url: 'https://allplays.ai/reset-password.html',
            handleCodeInApp: true
        });
        setMessage('Password reset email sent.', 'success');
    } catch (error) {
        console.error('[mobile] Password reset failed:', error);
        setMessage(describeAuthError(error), 'error');
    } finally {
        setBusy(false);
    }
}

els.loginForm.addEventListener('submit', handleEmailSignIn);
els.googleButton.addEventListener('click', handleGoogleSignIn);
els.resetButton.addEventListener('click', handlePasswordReset);

let authObserverSettled = false;
const authObserverTimeout = window.setTimeout(() => {
    if (authObserverSettled) return;
    authObserverSettled = true;
    if (isNativeApp() && hasNativeAuthFallbackSession()) {
        openDashboard();
        return;
    }
    showSignedOut();
}, 4000);

onAuthStateChanged(auth, (user) => {
    if (authObserverSettled) return;
    authObserverSettled = true;
    window.clearTimeout(authObserverTimeout);
    if (user) {
        openDashboard();
        return;
    }
    if (isNativeApp() && hasNativeAuthFallbackSession()) {
        openDashboard();
        return;
    }
    showSignedOut();
});
