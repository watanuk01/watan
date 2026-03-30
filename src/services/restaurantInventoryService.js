/**
 * Restaurant Inventory Service — Firestore CRUD for per-restaurant stock
 *
 * Collection: restaurant_inventory
 *
 * Stock flows IN from:
 *   - CK order delivery (auto via completeDelivery)
 *
 * Stock flows OUT from:
 *   - Waste events
 *   - EPOS sales deduction (Phase 4)
 *   - Manual adjustments (with admin notification)
 */

import {
    collection,
    doc,
    getDoc,
    getDocs,
    updateDoc,
    query,
    where,
    serverTimestamp,
    increment,
    writeBatch,
} from 'firebase/firestore';
import { db } from '../firebase';
import { createBroadcastNotification } from './notificationService';

// ─── COLLECTION ───
const REST_INVENTORY = 'restaurant_inventory';
const USERS = 'users';

// ═══════════════════════════════════════════
// GET RESTAURANT INVENTORY
// ═══════════════════════════════════════════

/**
 * Fetch all inventory items for a restaurant.
 * @param {string} restaurantId — user UID of the restaurant
 * @param {Object} [filters]
 * @param {string} [filters.item_type] — 'grocery' | 'raw_meat' | 'menu_item'
 * @param {string} [filters.search] — name search
 */
export const getRestaurantInventory = async (restaurantId, filters = {}) => {
    const constraints = [where('restaurant_id', '==', restaurantId)];

    if (filters.item_type) {
        constraints.push(where('item_type', '==', filters.item_type));
    }

    const q = query(collection(db, REST_INVENTORY), ...constraints);
    const snap = await getDocs(q);

    let items = snap.docs.map(d => ({
        id: d.id,
        ...d.data(),
        last_updated: d.data().last_updated?.toDate?.() || null,
        last_delivery_date: d.data().last_delivery_date?.toDate?.() || null,
    }));

    // Client-side search filter
    if (filters.search) {
        const q = filters.search.toLowerCase();
        items = items.filter(i =>
            i.item_name?.toLowerCase().includes(q) ||
            i.category_name?.toLowerCase().includes(q)
        );
    }

    // Sort alphabetically
    items.sort((a, b) => (a.item_name || '').localeCompare(b.item_name || ''));
    return items;
};

/**
 * Get a single restaurant inventory item.
 */
export const getRestaurantItem = async (restaurantId, itemId) => {
    const constraints = [
        where('restaurant_id', '==', restaurantId),
        where('item_id', '==', itemId),
    ];
    const q = query(collection(db, REST_INVENTORY), ...constraints);
    const snap = await getDocs(q);
    if (snap.empty) return null;
    const d = snap.docs[0];
    return { id: d.id, ...d.data() };
};

// ═══════════════════════════════════════════
// ADD STOCK FROM DELIVERY
// Called automatically when order status → delivered
// ═══════════════════════════════════════════

/**
 * Add delivered items to restaurant inventory.
 * If item already exists in restaurant's inventory, increment stock.
 * If new, create a new restaurant_inventory record.
 *
 * @param {string} restaurantId
 * @param {Array} orderItems — items array from the order document
 * @param {string} orderNumber — for audit reference
 */
export const addStockFromDelivery = async (restaurantId, orderItems, orderNumber = '') => {
    const batch = writeBatch(db);
    const results = [];

    for (const item of orderItems) {
        // Check if this item already exists in restaurant inventory
        const existing = await getRestaurantItem(restaurantId, item.item_id);

        if (existing) {
            // Increment existing stock
            const ref = doc(db, REST_INVENTORY, existing.id);
            batch.update(ref, {
                current_stock: increment(item.quantity),
                cost_price: item.cost_price || existing.cost_price || 0,
                selling_price: item.selling_price || existing.selling_price || 0,
                last_delivery_date: serverTimestamp(),
                last_delivery_order: orderNumber,
                last_updated: serverTimestamp(),
            });
            results.push({ item_id: item.item_id, action: 'incremented', quantity: item.quantity });
        } else {
            // Create new inventory record
            const ref = doc(collection(db, REST_INVENTORY));
            batch.set(ref, {
                restaurant_id: restaurantId,
                item_id: item.item_id,
                item_name: item.item_name || '',
                item_type: item.item_type || 'grocery',
                category_name: item.category_name || '',
                unit: item.unit || 'kg',
                base_unit: item.base_unit || item.unit || 'kg',
                unit_conversion: item.unit_conversion || { has_conversion: false, levels: [], base_factor: 1 },
                current_stock: item.quantity,
                cost_price: item.cost_price || 0,
                selling_price: item.selling_price || 0,
                vat_rate: item.vat_rate || 0,
                vat_exempt: item.vat_exempt || false,
                low_stock_threshold: 5,
                last_delivery_date: serverTimestamp(),
                last_delivery_order: orderNumber,
                last_updated: serverTimestamp(),
                created_at: serverTimestamp(),
            });
            results.push({ item_id: item.item_id, action: 'created', quantity: item.quantity });
        }
    }

    await batch.commit();
    return results;
};

// ═══════════════════════════════════════════
// ADJUST STOCK (Manual — with admin notification)
// ═══════════════════════════════════════════

/**
 * Manually adjust stock for a restaurant inventory item.
 * Sends a notification to CK admins.
 *
 * @param {string} restaurantId
 * @param {string} restInventoryDocId — restaurant_inventory doc ID
 * @param {number} adjustmentQty — positive to add, negative to subtract
 * @param {string} reason
 * @param {Object} adjustedBy — { uid, name, email }
 */
export const adjustRestaurantStock = async (restaurantId, restInventoryDocId, adjustmentQty, reason, adjustedBy) => {
    const ref = doc(db, REST_INVENTORY, restInventoryDocId);
    const snap = await getDoc(ref);
    if (!snap.exists()) throw new Error('Restaurant inventory item not found');

    const current = snap.data();
    const newStock = Math.max(0, (current.current_stock || 0) + adjustmentQty);

    await updateDoc(ref, {
        current_stock: newStock,
        last_updated: serverTimestamp(),
    });

    // Notify all admin users
    try {
        const adminIds = await getAdminUserIds();
        if (adminIds.length > 0) {
            const direction = adjustmentQty > 0 ? 'increased' : 'decreased';
            await createBroadcastNotification({
                type: 'system',
                priority: 'normal',
                title: `Stock Adjustment — ${current.item_name}`,
                message: `${adjustedBy?.name || 'Restaurant manager'} ${direction} "${current.item_name}" by ${Math.abs(adjustmentQty)} ${current.unit}. Reason: ${reason || 'Not specified'}. New stock: ${newStock} ${current.unit}.`,
                metadata: {
                    restaurant_id: restaurantId,
                    item_id: current.item_id,
                    item_name: current.item_name,
                    adjustment: adjustmentQty,
                    reason,
                },
            }, adminIds);
        }
    } catch (err) {
        console.error('Failed to notify admins of stock adjustment:', err);
    }

    return { newStock, item_name: current.item_name };
};

// ═══════════════════════════════════════════
// DEDUCT STOCK (for waste / EPOS)
// ═══════════════════════════════════════════

/**
 * Deduct stock from restaurant inventory (waste, EPOS sales).
 *
 * @param {string} restaurantId
 * @param {string} itemId — the master item_id
 * @param {number} quantity — amount to deduct (positive number)
 * @param {string} reason — audit reason
 */
export const deductRestaurantStock = async (restaurantId, itemId, quantity, reason = '') => {
    const existing = await getRestaurantItem(restaurantId, itemId);
    if (!existing) throw new Error(`Item not found in restaurant inventory`);

    const newStock = Math.max(0, (existing.current_stock || 0) - quantity);
    await updateDoc(doc(db, REST_INVENTORY, existing.id), {
        current_stock: newStock,
        last_updated: serverTimestamp(),
    });

    return { newStock, item_name: existing.item_name };
};

// ═══════════════════════════════════════════
// LOW STOCK ITEMS
// ═══════════════════════════════════════════

/**
 * Get items that are below their low_stock_threshold.
 */
export const getRestaurantLowStockItems = async (restaurantId) => {
    const allItems = await getRestaurantInventory(restaurantId);
    return allItems.filter(item =>
        (item.current_stock || 0) <= (item.low_stock_threshold || 5)
    );
};

// ═══════════════════════════════════════════
// UPDATE THRESHOLD / SETTINGS
// ═══════════════════════════════════════════

/**
 * Update low stock threshold for a restaurant inventory item.
 */
export const updateRestaurantItemSettings = async (restInventoryDocId, updates) => {
    const ref = doc(db, REST_INVENTORY, restInventoryDocId);
    await updateDoc(ref, {
        ...updates,
        last_updated: serverTimestamp(),
    });
};

// ═══════════════════════════════════════════
// STATS (for dashboard)
// ═══════════════════════════════════════════

/**
 * Get summary stats for a restaurant.
 */
export const getRestaurantInventoryStats = async (restaurantId) => {
    const items = await getRestaurantInventory(restaurantId);

    const totalItems = items.length;
    const totalValue = items.reduce((sum, i) => sum + ((i.current_stock || 0) * (i.cost_price || 0)), 0);
    const lowStockCount = items.filter(i => (i.current_stock || 0) <= (i.low_stock_threshold || 5)).length;
    const outOfStockCount = items.filter(i => (i.current_stock || 0) <= 0).length;

    // By type
    const byType = {};
    items.forEach(i => {
        const type = i.item_type || 'other';
        if (!byType[type]) byType[type] = { count: 0, value: 0 };
        byType[type].count++;
        byType[type].value += (i.current_stock || 0) * (i.cost_price || 0);
    });

    return {
        totalItems,
        totalValue: Math.round(totalValue * 100) / 100,
        lowStockCount,
        outOfStockCount,
        byType,
    };
};

// ═══════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════

/** Get all admin user IDs for notifications */
const getAdminUserIds = async () => {
    const q = query(collection(db, USERS), where('role', '==', 'admin'));
    const snap = await getDocs(q);
    return snap.docs.map(d => d.id);
};
