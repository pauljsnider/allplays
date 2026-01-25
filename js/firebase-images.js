import { initializeApp, getApps } from "./vendor/firebase-app.js";
import { getStorage } from "./vendor/firebase-storage.js";
import { getAuth, signInAnonymously, onAuthStateChanged, setPersistence, browserLocalPersistence } from "./vendor/firebase-auth.js";

const imgConfig = {
    apiKey: "AIzaSyCxeLIe1ZcbX_GH5TEg1MBo8vmxGs6cttE",
    authDomain: "game-flow-img.firebaseapp.com",
    projectId: "game-flow-img",
    storageBucket: "game-flow-img.firebasestorage.app",
    messagingSenderId: "340859680438",
    appId: "1:340859680438:web:4d00f571e8531907a11817",
    measurementId: "G-FRVND6NT3C"
};

// Keep this isolated from the main app; use a named app to avoid clashes
const imgApp = getApps().find(app => app.name === "game-flow-img")
    || initializeApp(imgConfig, "game-flow-img");

const imgAuth = getAuth(imgApp);
export const imageStorage = getStorage(imgApp);

let authReady = false;
let cachedUser = null;
let lastAuthError = null;
const AUTH_TIMEOUT_MS = 5000;
const authPromise = new Promise((resolve) => {
    onAuthStateChanged(imgAuth, async (user) => {
        if (user) {
            authReady = true;
            cachedUser = user;
            lastAuthError = null;
            resolve(user);
        } else {
            try {
                await setPersistence(imgAuth, browserLocalPersistence);
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

export async function ensureImageAuth() {
    if (authReady) return cachedUser;
    const timeout = new Promise((resolve) => setTimeout(() => resolve(null), AUTH_TIMEOUT_MS));
    const user = await Promise.race([authPromise, timeout]);
    if (user) return user;
    if (authReady) return cachedUser;
    try {
        await setPersistence(imgAuth, browserLocalPersistence);
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
