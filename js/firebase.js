import { initializeApp } from "https://www.gstatic.com/firebasejs/12.6.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/12.6.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/12.6.0/firebase-firestore.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/12.6.0/firebase-storage.js";

const firebaseConfig = {
    apiKey: "AIzaSyDoixIoKJuUVWdmImwjYRTthjKOv2mU0Jc",
    authDomain: "game-flow-c6311.firebaseapp.com",
    projectId: "game-flow-c6311",
    storageBucket: "game-flow-c6311.firebasestorage.app",
    messagingSenderId: "1030107289033",
    appId: "1:1030107289033:web:7154238712942475143046",
    measurementId: "G-E48D0L8L40"
};

// SECURITY NOTE: This API key is public by design for Firebase web apps.
// To secure your app, you MUST restrict this key in the Google Cloud Console:
// 1. Go to https://console.cloud.google.com/apis/credentials
// 2. Click on the API key used here.
// 3. Under "Application restrictions", select "HTTP referrers (web sites)" and add your domain(s).
// 4. Under "API restrictions", select "Restrict key" and select only the Firebase APIs you use (Auth, Firestore, Storage, etc.).

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);
