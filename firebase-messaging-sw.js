/* global importScripts, firebase */

importScripts('https://www.gstatic.com/firebasejs/12.6.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/12.6.0/firebase-messaging-compat.js');

firebase.initializeApp({
    apiKey: 'AIzaSyDoixIoKJuUVWdmImwjYRTthjKOv2mU0Jc',
    authDomain: 'game-flow-c6311.firebaseapp.com',
    projectId: 'game-flow-c6311',
    storageBucket: 'game-flow-c6311.firebasestorage.app',
    messagingSenderId: '1030107289033',
    appId: '1:1030107289033:web:7154238712942475143046'
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
    const title = payload?.notification?.title || 'ALL PLAYS Update';
    const body = payload?.notification?.body || '';
    const link = payload?.fcmOptions?.link || payload?.data?.link || '/';

    self.registration.showNotification(title, {
        body,
        data: { link }
    });
});

self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    const link = event.notification?.data?.link || '/';
    event.waitUntil(clients.openWindow(link));
});
