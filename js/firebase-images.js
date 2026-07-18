import { initializeApp, getApps } from "./vendor/firebase-app.js";
import { getStorage } from "./vendor/firebase-storage.js";
import {
    getAuth,
    signInAnonymously,
    signOut,
    onAuthStateChanged,
    setPersistence,
    browserSessionPersistence,
    inMemoryPersistence
} from "./vendor/firebase-auth.js";
import { resolveImageFirebaseConfig } from "./firebase-runtime-config.js?v=11";

const imgConfig = resolveImageFirebaseConfig();

// Keep this isolated from the main app; use a named app to avoid clashes
const imgApp = getApps().find(app => app.name === "game-flow-img")
    || initializeApp(imgConfig, "game-flow-img");

const imgAuth = getAuth(imgApp);
export const imageStorage = getStorage(imgApp);

function isCapacitorNativeRuntime() {
    const protocol = typeof window !== 'undefined' ? window.location?.protocol : '';
    if (protocol === 'capacitor:' || protocol === 'ionic:') return true;
    const capacitor = typeof window !== 'undefined' ? window.Capacitor : null;
    if (!capacitor) return false;
    if (typeof capacitor.isNativePlatform === 'function') return capacitor.isNativePlatform();
    return capacitor.getPlatform?.() === 'ios' || capacitor.getPlatform?.() === 'android';
}

const nativeRuntime = isCapacitorNativeRuntime();
const imageAuthPersistence = nativeRuntime ? inMemoryPersistence : browserSessionPersistence;

async function configureImageAuthPersistence() {
    try {
        // setPersistence migrates any legacy browser-local Firebase Auth record
        // into the shorter-lived destination and removes the old IndexedDB copy.
        await setPersistence(imgAuth, imageAuthPersistence);
    } catch (error) {
        if (imageAuthPersistence === inMemoryPersistence) {
            console.warn('Image auth could not enable memory-only persistence.', error);
            return false;
        }
        try {
            await setPersistence(imgAuth, inMemoryPersistence);
        } catch (fallbackError) {
            console.warn('Image auth could not enable session or memory persistence.', fallbackError);
            return false;
        }
    }

    if (nativeRuntime && imgAuth.currentUser) {
        try {
            // Never restore the secondary anonymous image identity from legacy
            // WebView IndexedDB. A fresh anonymous user can be issued in memory.
            await signOut(imgAuth);
        } catch (error) {
            console.warn('Image auth could not discard a legacy native session.', error);
            return false;
        }
    }
    return true;
}

const persistenceReady = configureImageAuthPersistence();

let authReady = false;
let cachedUser = null;
let lastAuthError = null;
const AUTH_TIMEOUT_MS = 5000;
const authPromise = persistenceReady.then((configured) => {
    if (!configured) return null;
    return new Promise((resolve) => {
        onAuthStateChanged(imgAuth, async (user) => {
            if (user) {
                authReady = true;
                cachedUser = user;
                lastAuthError = null;
                resolve(user);
            } else {
                try {
                    const cred = await signInAnonymously(imgAuth);
                    authReady = true;
                    cachedUser = cred.user || null;
                    lastAuthError = null;
                    resolve(cred.user);
                } catch (e) {
                    console.warn('Image auth failed (anonymous). Storage may reject writes if rules require auth.', e);
                    cachedUser = null;
                    lastAuthError = e;
                    resolve(null);
                }
            }
        });
    });
});

export async function ensureImageAuth() {
    if (authReady) return cachedUser;
    if (!await persistenceReady) return null;
    const timeout = new Promise((resolve) => setTimeout(() => resolve(null), AUTH_TIMEOUT_MS));
    const user = await Promise.race([authPromise, timeout]);
    if (user) return user;
    if (authReady) return cachedUser;
    try {
        const cred = await signInAnonymously(imgAuth);
        authReady = true;
        cachedUser = cred.user || null;
        lastAuthError = null;
        return cachedUser;
    } catch (e) {
        console.warn('Image auth retry failed (anonymous).', e);
        lastAuthError = e;
        return null;
    }
}

export async function requireImageAuth() {
    const user = await ensureImageAuth();
    if (!user) {
        const message = lastAuthError?.message ? `Image auth failed: ${lastAuthError.message}` : 'Image auth failed. Anonymous sign-in is required for uploads.';
        throw new Error(message);
    }
    return user;
}

export function getImageAuthError() {
    return lastAuthError;
}
