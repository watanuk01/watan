/**
 * Notification Service — Firestore-backed notification system
 * Supports: CRUD, broadcast, FCM token storage, system alerts
 */

import {
    collection,
    doc,
    getDoc,
    getDocs,
    addDoc,
    deleteDoc,
    updateDoc,
    query,
    where,
    serverTimestamp,
    writeBatch,
} from 'firebase/firestore';
import { db } from '../firebase';

const NOTIFICATIONS = 'notifications';
const FCM_TOKENS = 'user_fcm_tokens';

// ═══════════════════════════════════════════
// NOTIFICATION TYPES
// ═══════════════════════════════════════════

export const NOTIFICATION_TYPES = {
    announcement: { icon: '📢', color: '#8b5cf6', label: 'Announcement' },
    low_stock: { icon: '📉', color: '#f97316', label: 'Low Stock Alert' },
    expiry_warning: { icon: '⏰', color: '#f59e0b', label: 'Expiry Warning' },
    order_update: { icon: '📦', color: '#3b82f6', label: 'Order Update' },
    delivery_update: { icon: '🚚', color: '#14b8a6', label: 'Delivery Update' },
    waste_updated: { icon: '✏️', color: '#f59e0b', label: 'Waste Updated' },
    waste_deleted: { icon: '🗑️', color: '#ef4444', label: 'Waste Deleted' },
    waste_submitted: { icon: '♻️', color: '#22c55e', label: 'Waste Submitted' },
    // epos_error: { icon: '⚠️', color: '#ef4444', label: 'EPOS Error' }, // EPOS on hold
    system: { icon: '🔔', color: '#6b7280', label: 'System' },
};

export const NOTIFICATION_PRIORITIES = ['normal', 'high', 'urgent'];
export const NOTIFICATION_RECURRING = ['none', 'daily', 'weekly', 'monthly'];

export const getNotificationType = (type) =>
    NOTIFICATION_TYPES[type] || NOTIFICATION_TYPES.system;

export const getPriorityColor = (priority) => {
    if (priority === 'urgent') return '#ef4444';
    if (priority === 'high') return '#f59e0b';
    return '#6b7280';
};

// ═══════════════════════════════════════════
// CREATE SINGLE NOTIFICATION
// ═══════════════════════════════════════════

/**
 * @param {Object} data
 * @param {string}  data.recipientId
 * @param {string}  data.type
 * @param {string}  data.title
 * @param {string}  data.message
 * @param {string}  [data.priority]     — 'normal'|'high'|'urgent'
 * @param {string}  [data.recurring]    — 'none'|'daily'|'weekly'|'monthly'
 * @param {Date}    [data.scheduledAt]  — future send date
 * @param {Object}  [data.metadata]
 * @param {Object}  [data.createdBy]    — { uid, name }
 */
export const createNotification = async (data) => {
    const notifDoc = {
        recipient_id: data.recipientId,
        type: data.type || 'system',
        title: data.title || '',
        message: data.message || '',
        priority: data.priority || 'normal',
        recurring: data.recurring || 'none',
        scheduled_at: data.scheduledAt || null,
        metadata: data.metadata || {},
        created_by: data.createdBy || null,
        is_read: false,
        created_at: serverTimestamp(),
    };

    const ref = await addDoc(collection(db, NOTIFICATIONS), notifDoc);
    return { id: ref.id, ...notifDoc };
};

// ═══════════════════════════════════════════
// CREATE BROADCAST (fan-out to many users)
// ═══════════════════════════════════════════

export const createBroadcastNotification = async (data, recipientIds) => {
    if (!recipientIds?.length) return [];
    const batch = writeBatch(db);
    const ids = [];

    for (const recipientId of recipientIds) {
        const ref = doc(collection(db, NOTIFICATIONS));
        batch.set(ref, {
            recipient_id: recipientId,
            type: data.type || 'announcement',
            title: data.title || '',
            message: data.message || '',
            priority: data.priority || 'normal',
            recurring: data.recurring || 'none',
            scheduled_at: data.scheduledAt || null,
            metadata: data.metadata || {},
            created_by: data.createdBy || null,
            is_read: false,
            created_at: serverTimestamp(),
        });
        ids.push(ref.id);
    }

    await batch.commit();
    return ids;
};

// ═══════════════════════════════════════════
// GET NOTIFICATIONS (for a user)
// ═══════════════════════════════════════════

export const getNotifications = async (userId) => {
    if (!userId) return [];
    const q = query(collection(db, NOTIFICATIONS), where('recipient_id', '==', userId));
    const snap = await getDocs(q);

    const notifs = snap.docs.map(d => ({
        id: d.id,
        ...d.data(),
        created_at: d.data().created_at?.toDate?.() || null,
    }));

    notifs.sort((a, b) => {
        if (a.is_read !== b.is_read) return a.is_read ? 1 : -1;
        return (b.created_at || 0) - (a.created_at || 0);
    });
    return notifs;
};

// ═══════════════════════════════════════════
// GET UNREAD COUNT
// ═══════════════════════════════════════════

export const getUnreadCount = async (userId) => {
    if (!userId) return 0;
    const q = query(
        collection(db, NOTIFICATIONS),
        where('recipient_id', '==', userId),
        where('is_read', '==', false)
    );
    const snap = await getDocs(q);
    return snap.size;
};

// ═══════════════════════════════════════════
// MARK AS READ / UNREAD
// ═══════════════════════════════════════════

export const markAsRead = async (notifId) =>
    updateDoc(doc(db, NOTIFICATIONS, notifId), { is_read: true });

export const markAsUnread = async (notifId) =>
    updateDoc(doc(db, NOTIFICATIONS, notifId), { is_read: false });

export const markAllAsRead = async (userId) => {
    const q = query(
        collection(db, NOTIFICATIONS),
        where('recipient_id', '==', userId),
        where('is_read', '==', false)
    );
    const snap = await getDocs(q);
    if (snap.empty) return;
    const batch = writeBatch(db);
    snap.docs.forEach(d => batch.update(d.ref, { is_read: true }));
    await batch.commit();
};

// ═══════════════════════════════════════════
// DELETE NOTIFICATION
// ═══════════════════════════════════════════

export const deleteNotification = async (notifId) =>
    deleteDoc(doc(db, NOTIFICATIONS, notifId));

// ═══════════════════════════════════════════
// FCM TOKEN MANAGEMENT
// ═══════════════════════════════════════════

export const saveFcmToken = async (userId, token) => {
    if (!userId || !token) return;
    // Check if token already exists for this user
    const q = query(
        collection(db, FCM_TOKENS),
        where('user_id', '==', userId),
        where('token', '==', token)
    );
    const snap = await getDocs(q);
    if (!snap.empty) return; // already saved

    await addDoc(collection(db, FCM_TOKENS), {
        user_id: userId,
        token,
        updated_at: serverTimestamp(),
    });
};

export const getFcmTokensForUsers = async (userIds) => {
    if (!userIds?.length) return [];
    // Firestore 'in' limit is 30
    const chunks = [];
    for (let i = 0; i < userIds.length; i += 30)
        chunks.push(userIds.slice(i, i + 30));

    const tokens = [];
    for (const chunk of chunks) {
        const q = query(collection(db, FCM_TOKENS), where('user_id', 'in', chunk));
        const snap = await getDocs(q);
        snap.docs.forEach(d => tokens.push(d.data().token));
    }
    return tokens;
};

// ═══════════════════════════════════════════
// SYSTEM-GENERATED NOTIFICATION HELPERS
// ═══════════════════════════════════════════

/** Notify when stock drops below minimum */
export const notifyLowStock = async (item, recipientIds) => {
    await createBroadcastNotification({
        type: 'low_stock',
        priority: 'high',
        title: `Low Stock Alert: ${item.name}`,
        message: `${item.name} is running low. Current stock: ${item.current_stock} ${item.unit} (threshold: ${item.min_stock_level || 0} ${item.unit}).`,
        metadata: { item_id: item.id, current_stock: item.current_stock },
    }, recipientIds);
};

/** Notify 24h before batch expiry */
export const notifyExpiryWarning = async (batch, recipientIds) => {
    await createBroadcastNotification({
        type: 'expiry_warning',
        priority: 'high',
        title: `Expiry Warning: ${batch.item_name}`,
        message: `Batch ${batch.batch_number} of "${batch.item_name}" (${batch.current_quantity} ${batch.unit}) expires on ${new Date(batch.expiry_date).toLocaleDateString('en-GB')}.`,
        metadata: { batch_id: batch.id, item_name: batch.item_name },
    }, recipientIds);
};

/** Notify restaurant when their order status changes */
export const notifyOrderUpdate = async (order, restaurantUserId, status) => {
    await createNotification({
        recipientId: restaurantUserId,
        type: 'order_update',
        priority: 'normal',
        title: `Order ${order.invoice_number || order.id} — ${status}`,
        message: `Your order has been ${status.toLowerCase()}.`,
        metadata: { order_id: order.id, status },
    });
};

/** Notify when waste is submitted by restaurant */
export const notifyWasteSubmitted = async (wasteEvent, adminRecipientIds) => {
    await createBroadcastNotification({
        type: 'waste_submitted',
        priority: 'normal',
        title: `New Waste Event from ${wasteEvent.location_name}`,
        message: `${wasteEvent.location_name} logged ${wasteEvent.quantity} ${wasteEvent.item_unit} of "${wasteEvent.item_name}" as ${wasteEvent.category}.`,
        metadata: { waste_event_id: wasteEvent.id },
    }, adminRecipientIds);
};

// ═══════════════════════════════════════════
// WASTE-SPECIFIC HELPERS (existing, unchanged)
// ═══════════════════════════════════════════

export const notifyWasteUpdated = async (wasteEvent, changes, reason, adminUser) => {
    if (!wasteEvent.location_id || wasteEvent.location_type !== 'restaurant') return;
    const changedFields = Object.keys(changes || {}).join(', ') || 'details';
    await createNotification({
        recipientId: wasteEvent.location_id,
        type: 'waste_updated',
        priority: 'normal',
        title: 'Waste Entry Updated by Admin',
        message: `Your waste entry for "${wasteEvent.item_name}" (${wasteEvent.quantity} ${wasteEvent.item_unit}) was updated. Changed: ${changedFields}. Reason: ${reason || 'Not specified'}.`,
        metadata: { waste_event_id: wasteEvent.id, action: 'edited', reason, changes },
        createdBy: adminUser ? { uid: adminUser.uid, name: adminUser.name || adminUser.email } : null,
    });
};

export const notifyWasteDeleted = async (wasteEvent, reason, adminUser) => {
    if (!wasteEvent.location_id || wasteEvent.location_type !== 'restaurant') return;
    await createNotification({
        recipientId: wasteEvent.location_id,
        type: 'waste_deleted',
        priority: 'normal',
        title: 'Waste Entry Deleted by Admin',
        message: `Your waste entry for "${wasteEvent.item_name}" (${wasteEvent.quantity} ${wasteEvent.item_unit}, category: ${wasteEvent.category}) was deleted by admin. Reason: ${reason || 'Not specified'}.`,
        metadata: { waste_event_id: wasteEvent.id, action: 'deleted', reason, item_name: wasteEvent.item_name },
        createdBy: adminUser ? { uid: adminUser.uid, name: adminUser.name || adminUser.email } : null,
    });
};
