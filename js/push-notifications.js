import { getApp } from './vendor/firebase-app.js';
import {
    getMessaging,
    getToken,
    isSupported
} from 'https://www.gstatic.com/firebasejs/12.6.0/firebase-messaging.js';

export async function canUsePushNotifications() {
    try {
        return await isSupported();
    } catch {
        return false;
    }
}

export async function registerPushNotifications({
    serviceWorkerPath = '/firebase-messaging-sw.js',
    vapidKey = window.ALLPLAYS_FCM_VAPID_KEY || undefined
} = {}) {
    const supported = await canUsePushNotifications();
    if (!supported) {
        throw new Error('Push notifications are not supported on this browser/device.');
    }

    if (!('serviceWorker' in navigator)) {
        throw new Error('Service Worker support is required for push notifications.');
    }

    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
        throw new Error('Notification permission was not granted.');
    }

    const registration = await navigator.serviceWorker.register(serviceWorkerPath);
    const appConfig = getApp().options || {};
    const firebaseConfig = {
        apiKey: appConfig.apiKey,
        authDomain: appConfig.authDomain,
        projectId: appConfig.projectId,
        storageBucket: appConfig.storageBucket,
        messagingSenderId: appConfig.messagingSenderId,
        appId: appConfig.appId
    };
    const workerMessage = {
        type: 'ALLPLAYS_INIT_FIREBASE_CONFIG',
        firebaseConfig
    };

    [registration.active, registration.waiting, registration.installing]
        .filter(Boolean)
        .forEach((worker) => worker.postMessage(workerMessage));

    const readyRegistration = await navigator.serviceWorker.ready;
    if (readyRegistration?.active) {
        readyRegistration.active.postMessage(workerMessage);
    }

    const messaging = getMessaging(getApp());
    const token = await getToken(messaging, {
        vapidKey,
        serviceWorkerRegistration: registration
    });

    if (!token) {
        throw new Error('Unable to obtain a push token for this device.');
    }

    return {
        token,
        permission
    };
}
