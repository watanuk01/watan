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
    writeBatch,
} from 'firebase/firestore';
import { db } from '../firebase';
import { createBroadcastNotification } from './notificationService';

// ─── COLLECTION ───
const REST_INVENTORY = 'restaurant_inventory';
const ITEMS = 'inventory_items';
const CATEGORIES = 'inventory_categories';
const USERS = 'users';

// ─── Cache for user directory resolution (60 second TTL) ───
let userDirectoryCache = { data: null, timestamp: 0 };

/**
 * Resolve all candidate identifiers for a restaurant (UID, slug, name).
 * Ensures queries match regardless of whether restaurant_inventory uses
 * user UID, restaurant_id slug (e.g. 'mehman_khana'), or restaurant_name.
 */
export const resolveRestaurantIds = async (restaurantId, restaurantName = '') => {
    if (!restaurantId && !restaurantName) return [];
    const ids = new Set();
    if (restaurantId) ids.add(String(restaurantId));
    if (restaurantName) ids.add(String(restaurantName));

    try {
        const now = Date.now();
        let usersDocs = userDirectoryCache.data;
        if (!usersDocs || now - userDirectoryCache.timestamp > 60000) {
            const usersSnap = await getDocs(collection(db, USERS));
            usersDocs = usersSnap.docs.map(d => ({ id: d.id, ...d.data() }));
            userDirectoryCache = { data: usersDocs, timestamp: now };
        }

        usersDocs.forEach(u => {
            const matches =
                u.id === restaurantId ||
                u.restaurant_id === restaurantId ||
                (restaurantName && (u.restaurant_name === restaurantName || u.name === restaurantName)) ||
                (u.restaurant_name && (u.restaurant_name === restaurantId || u.restaurant_name?.toLowerCase() === String(restaurantId).toLowerCase())) ||
                (u.name && (u.name === restaurantId || u.name?.toLowerCase() === String(restaurantId).toLowerCase()));
            if (matches) {
                ids.add(u.id);
                if (u.restaurant_id) ids.add(String(u.restaurant_id));
                if (u.restaurant_name) ids.add(String(u.restaurant_name));
                if (u.name) ids.add(String(u.name));
            }
        });
    } catch (err) {
        console.warn('resolveRestaurantIds error:', err);
    }

    return Array.from(ids);
};

// ═══════════════════════════════════════════
// GET RESTAURANT INVENTORY
// ═══════════════════════════════════════════

/**
 * Fetch all inventory items for a restaurant.
 * @param {string} restaurantId — user UID of the restaurant or restaurant_id slug
 * @param {Object} [filters]
 * @param {string} [filters.item_type] — 'grocery' | 'raw_meat' | 'menu_item'
 * @param {string} [filters.search] — name search
 */
export const getRestaurantInventory = async (restaurantId, filters = {}) => {
    const candidateIds = await resolveRestaurantIds(restaurantId);
    const queryIds = candidateIds.length > 0 ? candidateIds : [restaurantId];
    let docs = [];

    for (const rId of queryIds) {
        try {
            const constraints = [where('restaurant_id', '==', rId)];
            if (filters.item_type) {
                constraints.push(where('item_type', '==', filters.item_type));
            }
            const q = query(collection(db, REST_INVENTORY), ...constraints);
            const snap = await getDocs(q);
            snap.docs.forEach(d => {
                if (!docs.some(x => x.id === d.id)) {
                    docs.push(d);
                }
            });
        } catch (e) {
            console.warn('Error querying restaurant_inventory for rId:', rId, e);
        }
    }

    let items = docs.map(d => ({
        id: d.id,
        ...d.data(),
        last_updated: d.data().last_updated?.toDate?.() || null,
        last_delivery_date: d.data().last_delivery_date?.toDate?.() || null,
    }));

    // Enrich items missing category_name from CK items + categories collections
    const missingCategoryItems = items.filter(i => !i.category_name);
    if (missingCategoryItems.length > 0) {
        try {
            // Load categories lookup (category_id → category name)
            const catSnap = await getDocs(collection(db, CATEGORIES));
            const catMap = {};
            catSnap.docs.forEach(d => { catMap[d.id] = d.data().name || ''; });

            // Load CK items and resolve category_name via category_id if needed
            const ckSnap = await getDocs(collection(db, ITEMS));
            const ckMapById = {};   // CK item doc ID → resolved category name
            const ckMapByName = {}; // CK item name (lowercase) → resolved category name
            ckSnap.docs.forEach(d => {
                const data = d.data();
                const resolvedCat = data.category_name || catMap[data.category_id] || '';
                if (resolvedCat) {
                    ckMapById[d.id] = resolvedCat;
                    if (data.name) {
                        ckMapByName[data.name.toLowerCase()] = resolvedCat;
                    }
                }
            });

            const batch = writeBatch(db);
            let batchCount = 0;
            items = items.map(item => {
                if (!item.category_name) {
                    const resolved = (item.item_id && ckMapById[item.item_id])
                        || (item.item_name && ckMapByName[item.item_name.toLowerCase()])
                        || '';
                    if (resolved) {
                        batch.update(doc(db, REST_INVENTORY, item.id), { category_name: resolved });
                        batchCount++;
                        return { ...item, category_name: resolved };
                    }
                }
                return item;
            });
            if (batchCount > 0) {
                await batch.commit();
                console.log(`Enriched ${batchCount} restaurant inventory items with category_name`);
            }
        } catch (err) {
            console.error('Failed to enrich category_name from CK items:', err);
        }
    }

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
 * Searches by doc ID, item_id field, and item_name across all candidate restaurant IDs.
 * Highly optimized for fast execution without heavy category enrichments.
 *
 * @param {string} restaurantId
 * @param {string|Object} itemOrId — itemId string or item object { id, item_id, item_name, name }
 * @param {string} [itemNameHint] — optional item name fallback
 */
export const getRestaurantItem = async (restaurantId, itemOrId, itemNameHint = '') => {
    if (!restaurantId || !itemOrId) return null;

    const targetId = typeof itemOrId === 'string' ? itemOrId : (itemOrId?.item_id || itemOrId?.id || '');
    const targetDocId = typeof itemOrId === 'object' ? (itemOrId?.id || '') : (typeof itemOrId === 'string' ? itemOrId : '');
    const targetName = (
        typeof itemOrId === 'object'
            ? (itemOrId?.item_name || itemOrId?.name || itemNameHint)
            : itemNameHint
    ).trim().toLowerCase();

    // 1. Direct doc lookup if targetDocId exists
    if (targetDocId) {
        try {
            const directDoc = await getDoc(doc(db, REST_INVENTORY, targetDocId));
            if (directDoc.exists()) {
                const data = directDoc.data();
                const candidateIds = await resolveRestaurantIds(restaurantId);
                if (!data.restaurant_id || candidateIds.includes(data.restaurant_id)) {
                    return { id: directDoc.id, ...data };
                }
            }
        } catch (e) { /* ignore */ }
    }

    // 2. Fetch inventory for this restaurant directly without heavy category enrichment
    const candidateRestIds = await resolveRestaurantIds(restaurantId);
    const queryIds = candidateRestIds.length > 0 ? candidateRestIds : [restaurantId];
    let restItems = [];
    for (const rId of queryIds) {
        try {
            const snap = await getDocs(query(collection(db, REST_INVENTORY), where('restaurant_id', '==', rId)));
            snap.docs.forEach(d => {
                if (!restItems.some(x => x.id === d.id)) {
                    restItems.push({ id: d.id, ...d.data() });
                }
            });
        } catch (e) { /* ignore */ }
    }

    if (!restItems || restItems.length === 0) return null;

    // Priority A: doc id match
    if (targetDocId) {
        const found = restItems.find(i => i.id === targetDocId);
        if (found) return found;
    }

    // Priority B: item_id field match
    if (targetId) {
        const found = restItems.find(i => i.item_id === targetId || i.id === targetId);
        if (found) return found;
    }

    // Priority C: exact item_name match (case-insensitive, trimmed)
    if (targetName) {
        const found = restItems.find(i =>
            (i.item_name || i.name || '').trim().toLowerCase() === targetName
        );
        if (found) return found;
    }

    // Priority D: normalized item_name match (alphanumeric only)
    if (targetName) {
        const cleanTarget = targetName.replace(/[^a-z0-9]/g, '');
        if (cleanTarget) {
            const found = restItems.find(i => {
                const cleanName = (i.item_name || i.name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
                return cleanName && (cleanName === cleanTarget || cleanName.includes(cleanTarget) || cleanTarget.includes(cleanName));
            });
            if (found) return found;
        }
    }

    return null;
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
    const candidateRestIds = await resolveRestaurantIds(restaurantId);
    const primaryRestId = candidateRestIds[0] || restaurantId;

    for (const item of orderItems) {
        // Check if this item already exists in restaurant inventory
        const existing = await getRestaurantItem(restaurantId, item, item.item_name);
        const itemQty = Math.round(Number(item.quantity || 0) * 100) / 100;

        if (existing) {
            // Increment existing stock with 2-decimal precision
            const currentStock = Number(existing.current_stock || 0);
            const newStock = Math.round((currentStock + itemQty) * 100) / 100;
            const ref = doc(db, REST_INVENTORY, existing.id);
            batch.update(ref, {
                current_stock: newStock,
                cost_price: item.cost_price || existing.cost_price || 0,
                selling_price: item.selling_price || existing.selling_price || 0,
                category_name: item.category_name || existing.category_name || '',
                last_delivery_date: serverTimestamp(),
                last_delivery_order: orderNumber,
                last_updated: serverTimestamp(),
            });
            results.push({ item_id: item.item_id, action: 'incremented', quantity: itemQty, newStock });
        } else {
            // Create new inventory record
            const ref = doc(collection(db, REST_INVENTORY));
            batch.set(ref, {
                restaurant_id: primaryRestId,
                item_id: item.item_id || ref.id,
                item_name: item.item_name || '',
                item_type: item.item_type || 'grocery',
                category_name: item.category_name || '',
                unit: item.unit || 'kg',
                base_unit: item.base_unit || item.unit || 'kg',
                unit_conversion: item.unit_conversion || { has_conversion: false, levels: [], base_factor: 1 },
                current_stock: itemQty,
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
            results.push({ item_id: item.item_id, action: 'created', quantity: itemQty });
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

export const deductRestaurantStock = async (restaurantId, itemOrId, quantity, reason = '', itemNameHint = '') => {
    const existing = await getRestaurantItem(restaurantId, itemOrId, itemNameHint);
    if (!existing) throw new Error(`Item not found in restaurant inventory`);

    const currentStock = Number(existing.current_stock || 0);
    const deductQty = Math.round(Number(quantity || 0) * 100) / 100;
    const newStock = Math.round(Math.max(0, currentStock - deductQty) * 100) / 100;
    await updateDoc(doc(db, REST_INVENTORY, existing.id), {
        current_stock: newStock,
        last_updated: serverTimestamp(),
    });

    return { id: existing.id, newStock, item_name: existing.item_name || itemNameHint };
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
// SEED / FIX CATEGORY NAMES (Admin one-time)
// ═══════════════════════════════════════════

/**
 * Force-update category_name on ALL restaurant_inventory docs
 * by looking up the CK items collection.
 * Matches by item_id (doc ID) first, then by item_name.
 * Returns count of updated documents.
 */
export const seedRestaurantInventoryCategories = async () => {
    // 1. Load categories lookup (category_id → category name)
    const catSnap = await getDocs(collection(db, CATEGORIES));
    const catMap = {};
    catSnap.docs.forEach(d => { catMap[d.id] = d.data().name || ''; });
    console.log(`📂 Categories loaded: ${catSnap.size}`, catMap);

    // 2. Load all CK items and resolve category via category_id
    const ckSnap = await getDocs(collection(db, ITEMS));
    const ckMapById = {};   // CK item doc ID → resolved category name
    const ckMapByName = {}; // CK item name (lowercase) → resolved category name
    let ckWithCat = 0;
    let ckWithoutCat = 0;
    ckSnap.docs.forEach(d => {
        const data = d.data();
        const resolvedCat = data.category_name || catMap[data.category_id] || '';
        if (resolvedCat) {
            ckWithCat++;
            ckMapById[d.id] = resolvedCat;
            if (data.name) {
                ckMapByName[data.name.toLowerCase()] = resolvedCat;
            }
        } else {
            ckWithoutCat++;
            console.log(`  ⚠️ CK item "${data.name}" (${d.id}) has NO category. category_id="${data.category_id}", category_name="${data.category_name}"`);
        }
    });
    console.log(`📦 CK items loaded: ${ckSnap.size} total, ${ckWithCat} with category, ${ckWithoutCat} without`);

    // 3. Load ALL restaurant inventory docs
    const allSnap = await getDocs(collection(db, REST_INVENTORY));
    let updatedCount = 0;
    let alreadyHadCount = 0;
    let noMatchCount = 0;
    const noMatchItems = [];

    // Firestore batches have a 500-write limit
    let batch = writeBatch(db);
    let batchSize = 0;

    for (const d of allSnap.docs) {
        const data = d.data();
        const currentCat = data.category_name || '';

        // Resolve the correct category
        const byId = data.item_id ? ckMapById[data.item_id] : null;
        const byName = data.item_name ? ckMapByName[data.item_name.toLowerCase()] : null;
        const resolved = byId || byName || '';

        if (resolved && resolved !== currentCat) {
            batch.update(doc(db, REST_INVENTORY, d.id), { category_name: resolved });
            batchSize++;
            updatedCount++;

            // Commit every 499 writes
            if (batchSize >= 499) {
                await batch.commit();
                batch = writeBatch(db);
                batchSize = 0;
            }
        } else if (currentCat) {
            alreadyHadCount++;
        } else {
            noMatchCount++;
            noMatchItems.push({
                doc_id: d.id,
                item_name: data.item_name || '(no name)',
                item_id: data.item_id || '(no item_id)',
                byId_result: byId || 'NO MATCH',
                byName_result: byName || 'NO MATCH',
            });
        }
    }

    // Commit remaining
    if (batchSize > 0) {
        await batch.commit();
    }

    const summary = {
        categories: catSnap.size,
        ckItems: ckSnap.size,
        ckWithCategory: ckWithCat,
        ckWithoutCategory: ckWithoutCat,
        restaurantItems: allSnap.size,
        updated: updatedCount,
        alreadyHad: alreadyHadCount,
        noMatch: noMatchCount,
        noMatchSamples: noMatchItems.slice(0, 10),
    };
    console.log(`✅ Seed complete:`, summary);
    if (noMatchItems.length > 0) {
        console.table(noMatchItems.slice(0, 20));
    }

    return summary;
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
