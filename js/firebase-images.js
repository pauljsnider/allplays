import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/12.6.0/firebase-app.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/12.6.0/firebase-storage.js";
import { getAuth, signInAnonymously, onAuthStateChanged, setPersistence, browserLocalPersistence } from "https://www.gstatic.com/firebasejs/12.6.0/firebase-auth.js";

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
const authPromise = new Promise((resolve) => {
    onAuthStateChanged(imgAuth, async (user) => {
        if (user) {
            authReady = true;
            resolve(user);
        } else {
            try {
                await setPersistence(imgAuth, browserLocalPersistence);
                const cred = await signInAnonymously(imgAuth);
                authReady = true;
                resolve(cred.user);
            } catch (e) {
                console.warn('Image auth failed (anonymous). Storage may reject writes if rules require auth.', e);
                resolve(null);
            }
        }
    });
});

export async function ensureImageAuth() {
    if (authReady) return;
    await authPromise;
}
