/**
 * Waste Management Service — Firestore CRUD for Waste Tracking
 *
 * Features:
 *   - Manual waste logging (any role)
 *   - Auto-expiry detection (scans expired batches)
 *   - Edit / soft-delete with audit trail (admin only)
 *   - Aggregated stats for dashboard
 */

import {
    collection,
    doc,
    getDoc,
    getDocs,
    addDoc,
    updateDoc,
    query,
    where,
    orderBy,
    serverTimestamp,
    Timestamp,
    increment,
} from 'firebase/firestore';
import { db } from '../firebase';
import { adjustStock, consumeBatch } from './inventoryService';
import { getRestaurantItem, adjustRestaurantStock } from './restaurantInventoryService';
import { notifyWasteUpdated, notifyWasteDeleted } from './notificationService';

// ─── COLLECTIONS ───
const WASTE_EVENTS = 'waste_events';
const BATCHES = 'inventory_batches';
const ITEMS = 'inventory_items';

// ═══════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════

export const WASTE_CATEGORIES = [
    { value: 'expired', label: 'Expired', icon: '⏰', color: '#ef4444' },
    { value: 'damaged', label: 'Damaged', icon: '💥', color: '#f59e0b' },
    { value: 'overcooked', label: 'Overcooked / Burnt', icon: '🔥', color: '#f97316' },
    { value: 'returned', label: 'Returned / Customer Rejection', icon: '↩️', color: '#8b5cf6' },
    { value: 'spillage', label: 'Spillage', icon: '💧', color: '#3b82f6' },
    { value: 'other', label: 'Other', icon: '📝', color: '#6b7280' },
];

export const getCategoryInfo = (value) =>
    WASTE_CATEGORIES.find(c => c.value === value) || WASTE_CATEGORIES[5];

// ═══════════════════════════════════════════
// LOG WASTE EVENT (Manual)
// ═══════════════════════════════════════════

/**
 * @param {Object} data
 * @param {string} data.item_id
 * @param {string} data.item_name
 * @param {string} data.item_type
 * @param {string} data.item_unit
 * @param {number} data.quantity
 * @param {number} data.unit_cost      — estimated cost per unit
 * @param {string} data.category       — one of WASTE_CATEGORIES values
 * @param {string} data.location_type  — 'central_kitchen' | 'restaurant'
 * @param {string} data.location_id    — null for CK, uid for restaurant
 * @param {string} data.location_name
 * @param {string} [data.batch_id]
 * @param {string} [data.batch_number]
 * @param {string} [data.notes]
 * @param {Object} data.submitted_by   — { uid, name, email }
 * @param {string} [data.source]       — 'manual' (default) or 'auto_expiry'
 */
export const logWasteEvent = async (data) => {
    const totalValue = (data.quantity || 0) * (data.unit_cost || 0);

    const wasteDoc = {
        item_id: data.item_id,
        item_name: data.item_name || '',
        item_type: data.item_type || '',
        item_unit: data.item_unit || '',
        base_unit: data.base_unit || data.item_unit || '',
        quantity: Number(data.quantity) || 0,
        base_quantity: data.unit_conversion?.has_conversion
            ? Math.round((Number(data.quantity) || 0) * (data.unit_conversion.base_factor || 1) * 100) / 100
            : Number(data.quantity) || 0,
        unit_cost: Number(data.unit_cost) || 0,
        total_value: totalValue,

        category: data.category || 'other',
        source: data.source || 'manual',

        location_type: data.location_type || 'central_kitchen',
        location_id: data.location_id || null,
        location_name: data.location_name || 'Central Kitchen',

        batch_id: data.batch_id || null,
        batch_number: data.batch_number || null,

        image_data: data.image_data || null,

        submitted_by: data.submitted_by || {},
        notes: data.notes || '',

        status: 'active',
        created_at: serverTimestamp(),
        updated_at: serverTimestamp(),
        audit_trail: [
            {
                action: 'created',
                by: data.submitted_by || {},
                at: new Date().toISOString(),
                changes: null,
            },
        ],
    };

    const ref = await addDoc(collection(db, WASTE_EVENTS), wasteDoc);

    // Deduct stock from inventory
    if (data.quantity > 0 && data.item_id) {
        try {
            if (data.location_type === 'restaurant' && data.location_id) {
                const restItem = await getRestaurantItem(data.location_id, data.item_id);
                if (restItem) {
                    await adjustRestaurantStock(data.location_id, restItem.id, -data.quantity, `Waste: ${data.category}`, data.submitted_by);
                } else {
                    console.warn(`Restaurant item not found for waste deduction (ID: ${data.item_id})`);
                }
            } else if (data.batch_id) {
                // Deduct from specific batch
                await consumeBatch(data.batch_id, data.quantity, data.item_id);
            } else {
                // General stock deduction
                await adjustStock(data.item_id, -data.quantity, `Waste: ${data.category}`, null);
            }
        } catch (err) {
            console.error('Stock deduction failed (waste still logged):', err);
        }
    }

    return { id: ref.id, ...wasteDoc };
};

// ═══════════════════════════════════════════
// GET WASTE EVENTS
// ═══════════════════════════════════════════

/**
 * @param {Object} filters
 * @param {string}  [filters.location_type]
 * @param {string}  [filters.location_id]
 * @param {string}  [filters.category]
 * @param {string}  [filters.item_type]
 * @param {Date}    [filters.dateFrom]
 * @param {Date}    [filters.dateTo]
 * @param {boolean} [filters.includeDeleted] — false by default
 */
export const getWasteEvents = async (filters = {}) => {
    const constraints = [];

    if (!filters.includeDeleted) {
        constraints.push(where('status', '==', 'active'));
    }
    if (filters.location_type) {
        constraints.push(where('location_type', '==', filters.location_type));
    }
    if (filters.location_id) {
        constraints.push(where('location_id', '==', filters.location_id));
    }
    if (filters.category) {
        constraints.push(where('category', '==', filters.category));
    }
    if (filters.item_type) {
        constraints.push(where('item_type', '==', filters.item_type));
    }

    const q = query(collection(db, WASTE_EVENTS), ...constraints);
    const snap = await getDocs(q);

    let events = snap.docs.map(d => ({
        id: d.id,
        ...d.data(),
        created_at: d.data().created_at?.toDate?.() || null,
        updated_at: d.data().updated_at?.toDate?.() || null,
    }));

    // Client-side date filtering
    if (filters.dateFrom) {
        const from = new Date(filters.dateFrom);
        from.setHours(0, 0, 0, 0);
        events = events.filter(e => e.created_at && e.created_at >= from);
    }
    if (filters.dateTo) {
        const to = new Date(filters.dateTo);
        to.setHours(23, 59, 59, 999);
        events = events.filter(e => e.created_at && e.created_at <= to);
    }

    // Sort by created_at descending
    events.sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
    return events;
};

// ═══════════════════════════════════════════
// UPDATE WASTE EVENT (Admin — with audit)
// ═══════════════════════════════════════════

/**
 * @param {string} id       — waste event doc ID
 * @param {Object} updates  — { quantity?, category?, notes? }
 * @param {string} reason   — reason for edit
 * @param {Object} adminUser — { uid, name, email }
 */
export const updateWasteEvent = async (id, updates, reason, adminUser) => {
    const ref = doc(db, WASTE_EVENTS, id);
    const snap = await getDoc(ref);
    if (!snap.exists()) throw new Error('Waste event not found');

    const current = snap.data();
    const changes = {};

    // Track what changed
    if (updates.quantity !== undefined && updates.quantity !== current.quantity) {
        changes.quantity = { from: current.quantity, to: Number(updates.quantity) };
    }
    if (updates.category && updates.category !== current.category) {
        changes.category = { from: current.category, to: updates.category };
    }
    if (updates.notes !== undefined && updates.notes !== current.notes) {
        changes.notes = { from: current.notes, to: updates.notes };
    }

    const auditEntry = {
        action: 'edited',
        by: { uid: adminUser.uid, name: adminUser.name || adminUser.email },
        at: new Date().toISOString(),
        reason: reason || '',
        changes,
    };

    const updateFields = {
        ...updates,
        updated_at: serverTimestamp(),
        audit_trail: [...(current.audit_trail || []), auditEntry],
    };

    // Recalculate total_value if quantity or unit_cost changed
    const newQty = updates.quantity !== undefined ? Number(updates.quantity) : current.quantity;
    const newCost = updates.unit_cost !== undefined ? Number(updates.unit_cost) : current.unit_cost;
    updateFields.total_value = newQty * newCost;
    updateFields.quantity = newQty;

    await updateDoc(ref, updateFields);

    // Restore or deduct stock difference if quantity changed
    if (updates.quantity !== undefined && current.quantity !== newQty && current.item_id) {
        const qtyDifference = current.quantity - newQty; // Positive = wasted less (add to stock), Negative = wasted more (remove from stock)
        try {
            if (current.location_type === 'restaurant' && current.location_id) {
                const restItem = await getRestaurantItem(current.location_id, current.item_id);
                if (restItem) {
                    await adjustRestaurantStock(current.location_id, restItem.id, qtyDifference, `Waste edit: ${reason}`, adminUser);
                }
            } else if (!current.batch_id && current.location_type === 'central_kitchen') {
                // General stock update for CK (if it's tied to a batch, we skip batch un-consumption as batch restoration is complicated, 
                // but at least standard tracking is maintained if not batch tracked)
                // We add qtyDifference back.
                await adjustStock(current.item_id, qtyDifference, `Waste edit: ${reason}`, null);
            }
        } catch (err) {
            console.error('Stock adjustment for waste edit failed:', err);
        }
    }

    // Notify restaurant if admin edited their waste
    const fullEvent = { id, ...current, ...updateFields };
    try {
        await notifyWasteUpdated(fullEvent, changes, reason, adminUser);
    } catch (err) {
        console.error('Failed to send waste update notification:', err);
    }

    return fullEvent;
};

// ═══════════════════════════════════════════
// DELETE WASTE EVENT (Soft delete — Admin)
// ═══════════════════════════════════════════

export const deleteWasteEvent = async (id, reason, adminUser) => {
    const ref = doc(db, WASTE_EVENTS, id);
    const snap = await getDoc(ref);
    if (!snap.exists()) throw new Error('Waste event not found');

    const current = snap.data();
    const auditEntry = {
        action: 'deleted',
        by: { uid: adminUser.uid, name: adminUser.name || adminUser.email },
        at: new Date().toISOString(),
        reason: reason || 'No reason provided',
        changes: null,
    };

    await updateDoc(ref, {
        status: 'deleted',
        updated_at: serverTimestamp(),
        audit_trail: [...(current.audit_trail || []), auditEntry],
    });

    // Restore stock if waste was active
    if (current.status === 'active' && current.quantity > 0 && current.item_id) {
        try {
            if (current.location_type === 'restaurant' && current.location_id) {
                const restItem = await getRestaurantItem(current.location_id, current.item_id);
                if (restItem) {
                    await adjustRestaurantStock(current.location_id, restItem.id, current.quantity, `Waste delete: ${reason}`, adminUser);
                }
            } else if (!current.batch_id && current.location_type === 'central_kitchen') {
                await adjustStock(current.item_id, current.quantity, `Waste delete: ${reason}`, null);
            }
        } catch (err) {
            console.error('Stock restore for waste delete failed:', err);
        }
    }

    // Notify restaurant if admin deleted their waste
    const fullEvent = { id, ...current };
    try {
        await notifyWasteDeleted(fullEvent, reason, adminUser);
    } catch (err) {
        console.error('Failed to send waste delete notification:', err);
    }
};

// ═══════════════════════════════════════════
// WASTE TREND (Daily aggregation for line chart)
// ═══════════════════════════════════════════

export const getWasteTrend = (events) => {
    const active = events.filter(e => e.status === 'active' && e.created_at);
    const byDate = {};

    active.forEach(e => {
        const dateKey = e.created_at.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
        const isoKey = e.created_at.toISOString().split('T')[0];
        if (!byDate[isoKey]) byDate[isoKey] = { date: isoKey, label: dateKey, value: 0, count: 0 };
        byDate[isoKey].value += e.total_value || 0;
        byDate[isoKey].count++;
    });

    return Object.values(byDate).sort((a, b) => a.date.localeCompare(b.date));
};

// ═══════════════════════════════════════════
// WASTE STATS (Aggregated)
// ═══════════════════════════════════════════

export const getWasteStats = (events) => {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const weekStart = new Date(todayStart);
    weekStart.setDate(weekStart.getDate() - weekStart.getDay()); // Sunday
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const active = events.filter(e => e.status === 'active');

    const todayEvents = active.filter(e => e.created_at && e.created_at >= todayStart);
    const weekEvents = active.filter(e => e.created_at && e.created_at >= weekStart);
    const monthEvents = active.filter(e => e.created_at && e.created_at >= monthStart);

    const sumValue = (arr) => arr.reduce((s, e) => s + (e.total_value || 0), 0);

    // By category
    const byCategory = {};
    active.forEach(e => {
        const cat = e.category || 'other';
        byCategory[cat] = (byCategory[cat] || 0) + (e.total_value || 0);
    });

    // By location
    const byLocation = {};
    active.forEach(e => {
        const loc = e.location_name || 'Unknown';
        byLocation[loc] = (byLocation[loc] || 0) + (e.total_value || 0);
    });

    // Top wasted items
    const byItem = {};
    active.forEach(e => {
        const name = e.item_name || 'Unknown';
        if (!byItem[name]) byItem[name] = { name, qty: 0, value: 0, count: 0 };
        byItem[name].qty += e.quantity || 0;
        byItem[name].value += e.total_value || 0;
        byItem[name].count++;
    });
    const topItems = Object.values(byItem).sort((a, b) => b.value - a.value).slice(0, 5);

    return {
        today: { count: todayEvents.length, value: sumValue(todayEvents) },
        week: { count: weekEvents.length, value: sumValue(weekEvents) },
        month: { count: monthEvents.length, value: sumValue(monthEvents) },
        total: { count: active.length, value: sumValue(active) },
        byCategory,
        byLocation,
        topItems,
    };
};

// ═══════════════════════════════════════════
// AUTO-EXPIRY DETECTION
// ═══════════════════════════════════════════

/**
 * Scans for expired batches (status='available', expiry_date < now)
 * that haven't been logged as waste yet. Creates waste events for each.
 *
 * @param {Object} adminUser — { uid, name, email }
 * @returns {number} count of newly detected expired batches
 */
export const detectExpiredBatches = async (adminUser) => {
    const now = new Date();

    // 1. Get all available batches with past expiry
    const batchQuery = query(
        collection(db, BATCHES),
        where('status', '==', 'available'),
        where('expiry_date', '<=', Timestamp.fromDate(now))
    );
    const batchSnap = await getDocs(batchQuery);
    const expiredBatches = batchSnap.docs.map(d => ({
        id: d.id,
        ...d.data(),
        expiry_date: d.data().expiry_date?.toDate?.() || null,
    }));

    if (expiredBatches.length === 0) return 0;

    // 2. Check which haven't been logged yet
    const existingWasteQuery = query(
        collection(db, WASTE_EVENTS),
        where('source', '==', 'auto_expiry'),
        where('status', '==', 'active')
    );
    const existingSnap = await getDocs(existingWasteQuery);
    const loggedBatchIds = new Set(existingSnap.docs.map(d => d.data().batch_id).filter(Boolean));

    const unloggedBatches = expiredBatches.filter(b => !loggedBatchIds.has(b.id));
    if (unloggedBatches.length === 0) return 0;

    // 3. Fetch item details for cost estimation
    let count = 0;
    for (const batch of unloggedBatches) {
        try {
            const itemRef = doc(db, ITEMS, batch.item_id);
            const itemSnap = await getDoc(itemRef);
            const itemData = itemSnap.exists() ? itemSnap.data() : {};

            const qty = batch.current_quantity || batch.quantity || 0;
            if (qty <= 0) {
                // Batch already consumed, just mark as expired
                await updateDoc(doc(db, BATCHES, batch.id), { status: 'expired' });
                continue;
            }

            // Create waste event (source = auto_expiry)
            await logWasteEvent({
                item_id: batch.item_id,
                item_name: batch.item_name || itemData.name || 'Unknown',
                item_type: batch.item_type || itemData.item_type || '',
                item_unit: batch.unit || itemData.unit || '',
                quantity: qty,
                unit_cost: itemData.selling_price || itemData.cost_price || batch.unit_cost || 0,
                category: 'expired',
                source: 'auto_expiry',
                location_type: 'central_kitchen',
                location_id: null,
                location_name: 'Central Kitchen',
                batch_id: batch.id,
                batch_number: batch.batch_number || '',
                notes: `Auto-detected: Batch ${batch.batch_number || batch.id} expired on ${batch.expiry_date?.toLocaleDateString?.() || '—'}`,
                submitted_by: adminUser || { uid: 'system', name: 'System', email: 'system@watan.com' },
            });

            // Mark batch as expired
            await updateDoc(doc(db, BATCHES, batch.id), { status: 'expired' });
            count++;
        } catch (err) {
            console.error(`Failed to process expired batch ${batch.id}:`, err);
        }
    }

    return count;
};

// ═══════════════════════════════════════════
// GET ITEMS FOR WASTE LOG (dropdown)
// ═══════════════════════════════════════════

export const getItemsForWasteLog = async () => {
    // Load categories for name resolution
    const catSnap = await getDocs(collection(db, 'inventory_categories'));
    const catMap = {};
    catSnap.docs.forEach(d => { catMap[d.id] = d.data().name || ''; });

    const snap = await getDocs(collection(db, ITEMS));
    return snap.docs
        .map(d => {
            const data = d.data();
            return {
                id: d.id,
                name: data.name,
                item_type: data.item_type,
                unit: data.unit,
                current_stock: data.current_stock || 0,
                cost_price: data.cost_price || 0,
                selling_price: data.selling_price || 0,
                category_name: data.category_name || catMap[data.category_id] || '',
            };
        })
        .sort((a, b) => a.name.localeCompare(b.name));
};

/**
 * Get batches for a specific item (for optional batch linking)
 */
export const getBatchesForItem = async (itemId) => {
    const q = query(
        collection(db, BATCHES),
        where('item_id', '==', itemId),
        where('status', '==', 'available')
    );
    const snap = await getDocs(q);
    return snap.docs
        .map(d => ({
            id: d.id,
            batch_number: d.data().batch_number,
            current_quantity: d.data().current_quantity || d.data().quantity || 0,
            expiry_date: d.data().expiry_date?.toDate?.() || null,
            unit: d.data().unit || '',
        }))
        .sort((a, b) => (a.expiry_date || 0) - (b.expiry_date || 0));
};
