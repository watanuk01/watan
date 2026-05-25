/**
 * EPOS Service — Firestore CRUD for EPOS integration
 *
 * Collections:
 *   epos_api_keys          — one API key per restaurant for webhook auth
 *   epos_events            — raw webhook events stored for audit/replay
 *   epos_item_mappings     — EPOS item → our menu item mapping
 *   epos_unmapped_items    — items received from EPOS with no mapping yet
 */

import {
    collection,
    doc,
    getDoc,
    getDocs,
    setDoc,
    addDoc,
    updateDoc,
    deleteDoc,
    query,
    where,
    orderBy,
    limit,
    serverTimestamp,
} from 'firebase/firestore';
import { db } from '../firebase';
import { getFunctions, httpsCallable } from 'firebase/functions';

// ─── COLLECTIONS ───
const API_KEYS = 'epos_api_keys';
const EVENTS = 'epos_events';
const MAPPINGS = 'epos_item_mappings';
const UNMAPPED = 'epos_unmapped_items';

// ═══════════════════════════════════════════
// API KEY MANAGEMENT
// ═══════════════════════════════════════════

/**
 * Generate a random API key string.
 */
const generateKey = () => {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    const segments = [];
    for (let s = 0; s < 4; s++) {
        let seg = '';
        for (let i = 0; i < 8; i++) {
            seg += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        segments.push(seg);
    }
    return `wtn_epos_${segments.join('_')}`;
};

/**
 * Get the API key for a restaurant (if it exists).
 */
export const getApiKey = async (restaurantId) => {
    const q = query(
        collection(db, API_KEYS),
        where('restaurant_id', '==', restaurantId),
        limit(1)
    );
    const snap = await getDocs(q);
    if (snap.empty) return null;
    return { id: snap.docs[0].id, ...snap.docs[0].data() };
};

/**
 * Generate a new API key for a restaurant.
 * Revokes any existing key first.
 */
export const generateApiKey = async (restaurantId, restaurantName = '') => {
    // Deactivate existing keys
    const existing = await getApiKey(restaurantId);
    if (existing) {
        await updateDoc(doc(db, API_KEYS, existing.id), {
            is_active: false,
            revoked_at: serverTimestamp(),
        });
    }

    const apiKey = generateKey();
    const ref = doc(collection(db, API_KEYS));
    const data = {
        restaurant_id: restaurantId,
        restaurant_name: restaurantName,
        api_key: apiKey,
        is_active: true,
        created_at: serverTimestamp(),
    };
    await setDoc(ref, data);
    return { id: ref.id, ...data, api_key: apiKey };
};

/**
 * Revoke (deactivate) an API key.
 */
export const revokeApiKey = async (restaurantId) => {
    const existing = await getApiKey(restaurantId);
    if (!existing) return;
    await updateDoc(doc(db, API_KEYS, existing.id), {
        is_active: false,
        revoked_at: serverTimestamp(),
    });
};

/**
 * Get all API keys (admin view).
 */
export const getAllApiKeys = async () => {
    const snap = await getDocs(collection(db, API_KEYS));
    return snap.docs.map(d => ({
        id: d.id,
        ...d.data(),
        created_at: d.data().created_at?.toDate?.() || null,
        revoked_at: d.data().revoked_at?.toDate?.() || null,
    }));
};

// ═══════════════════════════════════════════
// EPOS EVENTS (Webhook Log)
// ═══════════════════════════════════════════

/**
 * Fetch EPOS events for a restaurant (or all if no restaurantId).
 */
export const getEposEvents = async (restaurantId = null, filters = {}) => {
    const constraints = [];
    if (restaurantId) {
        constraints.push(where('restaurant_id', '==', restaurantId));
    }
    if (filters.status) {
        constraints.push(where('processing_status', '==', filters.status));
    }

    const q = query(collection(db, EVENTS), ...constraints);
    const snap = await getDocs(q);

    let events = snap.docs.map(d => ({
        id: d.id,
        ...d.data(),
        received_at: d.data().received_at?.toDate?.() || null,
        processed_at: d.data().processed_at?.toDate?.() || null,
    }));

    // Client-side date filter
    if (filters.from) {
        const fromDate = new Date(filters.from);
        events = events.filter(e => e.received_at && e.received_at >= fromDate);
    }
    if (filters.to) {
        const toDate = new Date(filters.to);
        toDate.setHours(23, 59, 59, 999);
        events = events.filter(e => e.received_at && e.received_at <= toDate);
    }

    // Sort newest first
    events.sort((a, b) => (b.received_at || 0) - (a.received_at || 0));

    return events;
};

/**
 * Get a single EPOS event by ID.
 */
export const getEposEvent = async (eventId) => {
    const snap = await getDoc(doc(db, EVENTS, eventId));
    if (!snap.exists()) return null;
    return {
        id: snap.id,
        ...snap.data(),
        received_at: snap.data().received_at?.toDate?.() || null,
        processed_at: snap.data().processed_at?.toDate?.() || null,
    };
};

/**
 * Get event stats for a restaurant.
 */
export const getEposEventStats = async (restaurantId) => {
    const events = await getEposEvents(restaurantId);
    const total = events.length;
    const processed = events.filter(e => e.processing_status === 'processed').length;
    const failed = events.filter(e => e.processing_status === 'partial_failure').length;
    const unmapped = events.filter(e => e.processing_status === 'has_unmapped').length;
    const pending = events.filter(e => e.processing_status === 'pending').length;
    const lastEvent = events.length > 0 ? events[0] : null;

    return { total, processed, failed, unmapped, pending, lastEvent };
};

// ═══════════════════════════════════════════
// ITEM MAPPINGS
// ═══════════════════════════════════════════

/**
 * Get all EPOS → Menu Item mappings for a restaurant.
 */
export const getEposItemMappings = async (restaurantId) => {
    const q = query(
        collection(db, MAPPINGS),
        where('restaurant_id', '==', restaurantId)
    );
    const snap = await getDocs(q);
    return snap.docs.map(d => ({
        id: d.id,
        ...d.data(),
        created_at: d.data().created_at?.toDate?.() || null,
        updated_at: d.data().updated_at?.toDate?.() || null,
    }));
};

/**
 * Save (create or update) an EPOS item mapping.
 */
export const saveEposItemMapping = async (data) => {
    if (!data.restaurant_id || !data.epos_item_id) {
        throw new Error('restaurant_id and epos_item_id are required');
    }

    // Check if mapping already exists for this EPOS item
    const q = query(
        collection(db, MAPPINGS),
        where('restaurant_id', '==', data.restaurant_id),
        where('epos_item_id', '==', data.epos_item_id),
        limit(1)
    );
    const snap = await getDocs(q);

    const mappingData = {
        restaurant_id: data.restaurant_id,
        epos_item_id: data.epos_item_id,
        epos_item_name: data.epos_item_name || '',
        mapped_menu_item_id: data.mapped_menu_item_id || '',
        mapped_menu_item_name: data.mapped_menu_item_name || '',
        mapped_portion_id: data.mapped_portion_id || '',
        mapped_portion_name: data.mapped_portion_name || '',
        is_active: data.is_active !== false,
        updated_at: serverTimestamp(),
    };

    if (!snap.empty) {
        // Update existing
        const ref = doc(db, MAPPINGS, snap.docs[0].id);
        await updateDoc(ref, mappingData);
        return { id: snap.docs[0].id, ...mappingData };
    } else {
        // Create new
        mappingData.created_at = serverTimestamp();
        const ref = await addDoc(collection(db, MAPPINGS), mappingData);
        return { id: ref.id, ...mappingData };
    }
};

/**
 * Delete an EPOS item mapping.
 */
export const deleteEposItemMapping = async (mappingId) => {
    await deleteDoc(doc(db, MAPPINGS, mappingId));
};

/**
 * Toggle mapping active/inactive.
 */
export const toggleEposItemMapping = async (mappingId) => {
    const ref = doc(db, MAPPINGS, mappingId);
    const snap = await getDoc(ref);
    if (!snap.exists()) throw new Error('Mapping not found');
    const current = snap.data().is_active !== false;
    await updateDoc(ref, { is_active: !current, updated_at: serverTimestamp() });
    return !current;
};

// ═══════════════════════════════════════════
// UNMAPPED ITEMS
// ═══════════════════════════════════════════

/**
 * Get all unmapped EPOS items for a restaurant.
 * These are items received from EPOS webhooks that haven't been mapped yet.
 */
export const getUnmappedEposItems = async (restaurantId) => {
    const q = query(
        collection(db, UNMAPPED),
        where('restaurant_id', '==', restaurantId)
    );
    const snap = await getDocs(q);

    return snap.docs.map(d => ({
        id: d.id,
        ...d.data(),
        last_seen_at: d.data().last_seen_at?.toDate?.() || null,
    })).sort((a, b) => (b.occurrence_count || 0) - (a.occurrence_count || 0));
};

/**
 * Remove an unmapped item (after it's been mapped).
 */
export const removeUnmappedItem = async (docId) => {
    await deleteDoc(doc(db, UNMAPPED, docId));
};

// ═══════════════════════════════════════════
// WEBHOOK URL HELPER
// ═══════════════════════════════════════════

/**
 * Get the webhook URL for the EPOS endpoint.
 */
export const getWebhookUrl = () => {
    return 'https://us-central1-watan-e8290.cloudfunctions.net/eposWebhook';
};

/**
 * Trigger reprocessing of old unmapped events after a new mapping is created.
 * This calls a Cloud Function that finds past events with unmapped items
 * for the given epos_item_id, processes them with the new mapping, and deducts stock.
 */
export const reprocessAfterMapping = async (restaurantId, eposItemId) => {
    try {
        const functions = getFunctions();
        const fn = httpsCallable(functions, 'reprocessAfterMapping');
        const result = await fn({ restaurant_id: restaurantId, epos_item_id: eposItemId });
        return result.data;
    } catch (err) {
        console.warn('Reprocess after mapping failed:', err.message);
        return { success: false, message: err.message };
    }
};
