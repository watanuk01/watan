/* eslint-disable no-undef */
// Firebase Cloud Messaging Service Worker
// Place this file in /public so it's accessible at /firebase-messaging-sw.js

importScripts('https://www.gstatic.com/firebasejs/10.7.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.7.0/firebase-messaging-compat.js');

firebase.initializeApp({
    apiKey: "AIzaSyC9jzSpsomTnfU5nJXx3hynQ94-wc924fE",
    authDomain: "watan-e8290.firebaseapp.com",
    projectId: "watan-e8290",
    storageBucket: "watan-e8290.firebasestorage.app",
    messagingSenderId: "759777665562",
    appId: "1:759777665562:web:c4a7827bd5223002bae7a3",
});

const messaging = firebase.messaging();

// Handle background messages (app not in focus)
messaging.onBackgroundMessage((payload) => {
    console.log('[FCM] Background message received:', payload);

    const { title, body, icon } = payload.notification || {};
    const notificationTitle = title || 'Watan Notification';
    const notificationOptions = {
        body: body || '',
        icon: icon || '/favicon.ico',
        badge: '/favicon.ico',
        data: payload.data || {},
        tag: payload.data?.notif_id || 'watan-notif',
        renotify: true,
    };

    self.registration.showNotification(notificationTitle, notificationOptions);
});

// Handle notification click → open app
self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
            for (const client of clientList) {
                if (client.url && 'focus' in client) {
                    client.navigate('/notifications');
                    return client.focus();
                }
            }
            if (clients.openWindow) {
                return clients.openWindow('/notifications');
            }
        })
    );
});
