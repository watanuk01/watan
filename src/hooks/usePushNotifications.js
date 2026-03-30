import { useEffect, useCallback } from 'react';
import { getToken, onMessage } from 'firebase/messaging';
import { getFirebaseMessaging } from '../firebase';
import { saveFcmToken } from '../services/notificationService';
import toast from 'react-hot-toast';

const VAPID_KEY = 'BNCF2WMvTuc1msxQtAppu7qSKWuo01YcKacqh0ZRW33FkjmLGTZWrx7-17TOJejPIERlV0HD23BLcLyDYF6Rtdo';

/**
 * Hook: Request push permission, get FCM token, handle foreground messages.
 * @param {string} userId  — Current user's UID (skip if null/undefined)
 * @param {Function} onNewNotification — Called when a foreground message arrives
 */
const usePushNotifications = (userId, onNewNotification) => {

    const setupPush = useCallback(async () => {
        if (!userId) return;

        try {
            const messaging = await getFirebaseMessaging();
            if (!messaging) return; // Browser doesn't support FCM

            // Request permission
            const permission = await Notification.requestPermission();
            if (permission !== 'granted') {
                console.log('Push notification permission denied');
                return;
            }

            // Get FCM token and save it
            const token = await getToken(messaging, { vapidKey: VAPID_KEY });
            if (token) {
                await saveFcmToken(userId, token);
                console.log('FCM token registered');
            }

            // Handle foreground messages with an in-app toast
            const unsubscribe = onMessage(messaging, (payload) => {
                console.log('[FCM] Foreground message:', payload);
                const { title, body } = payload.notification || {};

                toast.custom(
                    (t) => (
                        <div
                            onClick={() => { toast.dismiss(t.id); window.location.href = '/notifications'; }}
                            style={{
                                background: 'var(--color-surface)',
                                border: '1px solid var(--color-border)',
                                borderLeft: '4px solid var(--color-primary)',
                                borderRadius: 10,
                                padding: '12px 16px',
                                cursor: 'pointer',
                                maxWidth: 360,
                                boxShadow: '0 10px 25px rgba(0,0,0,0.3)',
                            }}
                        >
                            <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 4 }}>
                                🔔 {title || 'New Notification'}
                            </div>
                            <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
                                {body || ''}
                            </div>
                            <div style={{ fontSize: 10, color: 'var(--color-text-muted)', marginTop: 6 }}>
                                Tap to view
                            </div>
                        </div>
                    ),
                    { duration: 8000 }
                );

                // Also call the callback so TopBar can refresh its count
                if (onNewNotification) onNewNotification();
            });

            return unsubscribe;
        } catch (err) {
            // Don't throw — push is optional
            console.log('Push notification setup failed (non-fatal):', err.message);
        }
    }, [userId, onNewNotification]);

    useEffect(() => {
        let cleanup;
        setupPush().then(unsub => { cleanup = unsub; });
        return () => { if (typeof cleanup === 'function') cleanup(); };
    }, [setupPush]);
};

export default usePushNotifications;
