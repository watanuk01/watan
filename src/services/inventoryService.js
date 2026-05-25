/**
 * Inventory Service — Firestore CRUD for the Three-Pillar Inventory
 *
 * Item Types:  Grocery  |  Raw Meat  |  Cooked Meat
 *              ───────     ────────     ───────────
 *              Purchased   Purchased    Produced (never purchased)
 *              Optional    Always       Always batch-tracked
 *              expiry      batch+expiry Recipe required
 */

import {
    collection,
    doc,
    getDoc,
    getDocs,
    addDoc,
    updateDoc,
    deleteDoc,
    query,
    where,
    orderBy,
    limit,
    serverTimestamp,
    writeBatch,
    increment,
} from 'firebase/firestore';
import { db } from '../firebase';

// ─── COLLECTIONS ───
const CATEGORIES = 'inventory_categories';
const ITEMS = 'inventory_items';
const BATCHES = 'inventory_batches';

// ═══════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════

export const ITEM_TYPES = [
    {
        value: 'grocery',
        label: 'Grocery',
        icon: '🛒',
        color: '#22c55e',      // green
        description: 'Sauces, spices, drinks, dry goods — purchased from vendors',
    },
    {
        value: 'raw_meat',
        label: 'Raw Meat',
        icon: '🥩',
        color: '#ef4444',      // red
        description: 'Chicken, mutton, fish — always batch-tracked with expiry',
    },
    {
        value: 'cooked_meat',
        label: 'Cooked Meat',
        icon: '🍛',
        color: '#f59e0b',      // amber
        description: 'Produced in kitchen from recipes — never purchased',
    },
];

export const VAT_RATES = [
    { value: 20, label: '20% (Standard)' },
    { value: 5, label: '5% (Reduced)' },
    { value: 0, label: '0% (Zero-rated)' },
];

export const UNITS = [
    { value: 'kg', label: 'Kilogram (kg)' },
    { value: 'g', label: 'Gram (g)' },
    { value: 'l', label: 'Litre (L)' },
    { value: 'ml', label: 'Millilitre (mL)' },
    { value: 'pcs', label: 'Pieces' },
    { value: 'portions', label: 'Portions' },
    { value: 'pack', label: 'Packs' },
    { value: 'box', label: 'Boxes' },
    { value: 'bag', label: 'Bags' },
    { value: 'bottle', label: 'Bottles' },
    { value: 'tin', label: 'Tins' },
    { value: 'tray', label: 'Trays' },
    { value: 'roll', label: 'Rolls' },
    { value: 'dozen', label: 'Dozen' },
    { value: 'unit', label: 'Units' },
];

// ─── Unit Classification ───
export const BASE_UNITS = ['kg', 'g', 'l', 'ml'];
export const CONTAINER_UNITS = ['pack', 'box', 'bag', 'bottle', 'tin', 'tray', 'roll', 'dozen', 'unit', 'pcs', 'portions'];

/** Check if a unit is a measurable base unit */
export const isBaseUnit = (unit) => BASE_UNITS.includes(unit);

/** Get unit label */
export const getUnitLabel = (unit) => UNITS.find(u => u.value === unit)?.label || unit;

/**
 * Smart format: auto-convert g→kg when ≥1000, ml→l when ≥1000.
 * Keeps small quantities in their original unit for clarity.
 * @param {number} quantity
 * @param {string} unit — e.g. 'g', 'ml', 'kg', 'l'
 * @returns {{ quantity: number, unit: string }}
 */
export const smartFormatBaseUnit = (quantity, unit) => {
    const q = Number(quantity) || 0;
    if (unit === 'g' && Math.abs(q) >= 1000) {
        return { quantity: Math.round((q / 1000) * 100) / 100, unit: 'kg' };
    }
    if (unit === 'ml' && Math.abs(q) >= 1000) {
        return { quantity: Math.round((q / 1000) * 100) / 100, unit: 'l' };
    }
    return { quantity: Math.round(q * 100) / 100, unit };
};

/**
 * Resolve a quantity in the item's stocking unit to its base unit.
 * Automatically applies smart formatting (g→kg, ml→l when ≥1000).
 * Returns { baseQuantity, baseUnit } or original if no conversion.
 */
export const resolveToBaseUnit = (quantity, item) => {
    if (!item?.unit_conversion?.has_conversion || !item.base_unit) {
        return { baseQuantity: quantity, baseUnit: item?.unit || item?.base_unit || 'unit' };
    }
    const rawBase = Math.round((quantity * item.unit_conversion.base_factor) * 100) / 100;
    const smart = smartFormatBaseUnit(rawBase, item.base_unit);
    return {
        baseQuantity: smart.quantity,
        baseUnit: smart.unit,
    };
};

/**
 * Get a human-readable conversion summary for an item.
 * e.g. "1 box = 10 packs × 2 kg = 20 kg"
 */
export const getConversionSummary = (item) => {
    if (!item?.unit_conversion?.has_conversion || !item.unit_conversion.levels?.length) return null;
    const parts = item.unit_conversion.levels.map(lv => `1 ${lv.from} = ${lv.factor} ${lv.to}`);
    // Smart format the final total
    const rawTotal = item.unit_conversion.base_factor;
    const smart = smartFormatBaseUnit(rawTotal, item.base_unit);
    parts.push(`1 ${item.unit} = ${smart.quantity} ${smart.unit}`);
    return parts.join('  ·  ');
};

/**
 * Format a stock display string with base-unit equivalent.
 * e.g. "10 box (= 20 kg)" — auto-converts g→kg, ml→l when large
 */
export const formatStockWithBase = (quantity, item) => {
    const q = Math.round(quantity * 100) / 100;
    if (!item?.unit_conversion?.has_conversion) return `${q} ${item?.unit || ''}`;
    const { baseQuantity, baseUnit } = resolveToBaseUnit(quantity, item);
    return `${q} ${item.unit} (= ${baseQuantity} ${baseUnit})`;
};

export const STORAGE_TYPES = [
    { value: 'ambient', label: 'Ambient (Room Temp)' },
    { value: 'chilled', label: 'Chilled (0–5°C)' },
    { value: 'frozen', label: 'Frozen (-18°C)' },
];

// Helper to get type metadata
export const getItemTypeInfo = (type) => ITEM_TYPES.find(t => t.value === type) || ITEM_TYPES[0];

// ═══════════════════════════════════════════
// CATEGORIES  (scoped by item_type)
// ═══════════════════════════════════════════

export const getCategories = async (itemType = null) => {
    let q;
    if (itemType) {
        // Use only where() — no orderBy to avoid composite index requirement
        q = query(
            collection(db, CATEGORIES),
            where('item_type', '==', itemType)
        );
    } else {
        q = query(collection(db, CATEGORIES));
    }
    const snap = await getDocs(q);
    const all = snap.docs.map(d => ({ id: d.id, ...d.data() }));

    // Auto-deduplicate: keep first occurrence of each name per type, delete extras
    const seen = new Map();
    const duplicates = [];
    const unique = [];

    for (const cat of all) {
        const key = `${cat.item_type}:${cat.name}`;
        if (seen.has(key)) {
            duplicates.push(cat);
        } else {
            seen.set(key, cat);
            unique.push(cat);
        }
    }

    if (duplicates.length > 0) {
        console.log(`Cleaning up ${duplicates.length} duplicate categories...`);
        for (const dup of duplicates) {
            await deleteDoc(doc(db, CATEGORIES, dup.id));
        }
    }

    // Sort client-side by sort_order
    unique.sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
    return unique;
};

export const addCategory = async (data) => {
    if (!data.item_type) throw new Error('item_type is required for categories');
    const docRef = await addDoc(collection(db, CATEGORIES), {
        ...data,
        status: 'active',
        enabled: data.enabled !== undefined ? Boolean(data.enabled) : true,
        created_at: serverTimestamp(),
    });
    return { id: docRef.id, ...data };
};

export const updateCategory = async (id, data) => {
    const catRef = doc(db, CATEGORIES, id);

    // Read the old category to detect name change
    const oldSnap = await getDoc(catRef);
    const oldData = oldSnap.exists() ? oldSnap.data() : {};
    const nameChanged = data.name && data.name !== oldData.name;

    // Update the category itself
    await updateDoc(catRef, {
        ...data,
        updated_at: serverTimestamp(),
    });

    // If name changed, cascade to all items with this category_id
    if (nameChanged) {
        const itemsSnap = await getDocs(
            query(collection(db, ITEMS), where('category_id', '==', id))
        );
        if (!itemsSnap.empty) {
            const batch = writeBatch(db);
            itemsSnap.docs.forEach(d => {
                batch.update(doc(db, ITEMS, d.id), {
                    category_name: data.name,
                    updated_at: serverTimestamp(),
                });
            });
            await batch.commit();
            console.log(`✅ Updated category_name on ${itemsSnap.size} items to "${data.name}"`);
        }
    }
};

/**
 * One-time sync: ensures every item's category_name matches its category's current name.
 * Returns { updated: number, skipped: number, orphaned: number }
 */
export const syncCategoryNamesOnItems = async () => {
    // 1. Build category ID → name lookup
    const catSnap = await getDocs(collection(db, CATEGORIES));
    const catMap = {};
    catSnap.docs.forEach(d => { catMap[d.id] = d.data().name; });

    // 2. Read all items
    const itemSnap = await getDocs(collection(db, ITEMS));
    let updated = 0, skipped = 0, orphaned = 0;

    // Firestore batches support max 500 ops
    const batchOps = [];
    let currentBatch = writeBatch(db);
    let opsInBatch = 0;

    for (const d of itemSnap.docs) {
        const item = d.data();
        const catId = item.category_id;
        if (!catId) { skipped++; continue; }

        const correctName = catMap[catId];
        if (!correctName) {
            // Category no longer exists
            orphaned++;
            continue;
        }

        if (item.category_name !== correctName) {
            currentBatch.update(doc(db, ITEMS, d.id), {
                category_name: correctName,
                updated_at: serverTimestamp(),
            });
            opsInBatch++;
            updated++;

            if (opsInBatch >= 499) {
                batchOps.push(currentBatch);
                currentBatch = writeBatch(db);
                opsInBatch = 0;
            }
        } else {
            skipped++;
        }
    }

    if (opsInBatch > 0) batchOps.push(currentBatch);

    // Commit all batches
    for (const b of batchOps) {
        await b.commit();
    }

    console.log(`✅ Category name sync complete: ${updated} updated, ${skipped} already correct, ${orphaned} orphaned`);
    return { updated, skipped, orphaned };
};

export const deleteCategory = async (id) => {
    // Check if items exist in this category
    const q = query(collection(db, ITEMS), where('category_id', '==', id), limit(1));
    const snap = await getDocs(q);
    if (!snap.empty) {
        throw new Error('Cannot delete category that has items. Move or delete items first.');
    }
    await deleteDoc(doc(db, CATEGORIES, id));
};

// ═══════════════════════════════════════════
// ITEMS
// ═══════════════════════════════════════════

const generateSKU = (itemType, name) => {
    const prefix = {
        grocery: 'GR',
        raw_meat: 'RM',
        cooked_meat: 'CM',
    }[itemType] || 'GN';

    const nameCode = name
        .replace(/[^a-zA-Z0-9]/g, '')
        .substring(0, 4)
        .toUpperCase();

    const rand = Math.floor(1000 + Math.random() * 9000);
    return `${prefix}-${nameCode}-${rand}`;
};

export const getItems = async (filters = {}) => {
    let q = collection(db, ITEMS);
    // Build only where() constraints — no orderBy to avoid composite index requirement
    const constraints = [];

    if (filters.item_type) {
        constraints.push(where('item_type', '==', filters.item_type));
    }
    if (filters.category_id) {
        constraints.push(where('category_id', '==', filters.category_id));
    }
    if (filters.status) {
        constraints.push(where('status', '==', filters.status));
    }

    q = query(q, ...constraints);
    const snap = await getDocs(q);
    const items = snap.docs.map(d => ({
        id: d.id,
        ...d.data(),
        created_at: d.data().created_at?.toDate?.() || null,
        updated_at: d.data().updated_at?.toDate?.() || null,
    }));
    // Sort client-side by name
    items.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    return items;
};

export const getItemById = async (id) => {
    const snap = await getDoc(doc(db, ITEMS, id));
    if (!snap.exists()) return null;
    return { id: snap.id, ...snap.data() };
};

/**
 * Find an item by name and type
 */
export const findItemByNameAndType = async (name, itemType) => {
    const q = query(
        collection(db, ITEMS),
        where('item_type', '==', itemType),
        where('name', '==', name)
    );
    const snap = await getDocs(q);
    if (snap.empty) return null;
    return { id: snap.docs[0].id, ...snap.docs[0].data() };
};

/**
 * Add an inventory item.
 *
 * @param {Object} data — item fields (type-specific fields included)
 * @param {string} data.item_type — 'grocery' | 'raw_meat' | 'cooked_meat'
 */
export const addItem = async (data) => {
    const sku = data.sku || generateSKU(data.item_type, data.name);

    // Common base
    const itemData = {
        name: data.name,
        sku,
        item_type: data.item_type,
        category_id: data.category_id,
        category_name: data.category_name,
        unit: data.unit,
        current_stock: data.current_stock || 0,
        min_stock: Number(data.min_stock) || 0,
        cost_price: Number(data.cost_price) || 0,
        selling_price: Number(data.selling_price) || 0,
        vat_rate: data.vat_exempt ? 0 : (Number(data.vat_rate) || 20),
        vat_exempt: Boolean(data.vat_exempt),
        low_stock_threshold: Number(data.low_stock_threshold || data.min_stock) || 0,
        storage_type: data.storage_type || 'chilled',
        notes: data.notes || '',
        status: 'active',
        enabled: data.enabled !== undefined ? Boolean(data.enabled) : true,
        total_sold: 0,
        // Unit conversion fields
        base_unit: data.base_unit || data.unit,
        unit_conversion: data.unit_conversion || { has_conversion: false, levels: [], base_factor: 1 },
        created_at: serverTimestamp(),
        updated_at: serverTimestamp(),
    };

    // Type-specific fields
    if (data.item_type === 'grocery') {
        itemData.vendor = data.vendor || '';
        itemData.expiry_tracking = Boolean(data.expiry_tracking);
    }

    if (data.item_type === 'raw_meat') {
        itemData.vendor = data.vendor || '';
        itemData.batch_tracking = true; // always
        itemData.default_expiry_days = Number(data.default_expiry_days) || 3;
    }

    if (data.item_type === 'cooked_meat') {
        itemData.batch_tracking = true; // always
        itemData.default_expiry_days = Number(data.default_expiry_days) || 2;
        itemData.recipe = data.recipe || { base_batch_size: 0, base_batch_unit: 'kg', ingredients: [] };
        itemData.allowed_production_quantities = data.allowed_production_quantities || [];
    }

    const docRef = await addDoc(collection(db, ITEMS), itemData);
    return { id: docRef.id, ...itemData };
};

export const updateItem = async (id, data) => {
    const updateData = { ...data, updated_at: serverTimestamp() };
    // Ensure VAT consistency
    if (updateData.vat_exempt) {
        updateData.vat_rate = 0;
    }
    // Clean undefined values
    Object.keys(updateData).forEach(k => updateData[k] === undefined && delete updateData[k]);
    await updateDoc(doc(db, ITEMS, id), updateData);
};

/**
 * Check what depends on this item before deleting.
 * Returns: { batches: [...], usedInRecipes: [{ id, name }] }
 */
export const getItemDependencies = async (itemId) => {
    // 1. Check for batches (any status)
    const batchQ = query(
        collection(db, BATCHES),
        where('item_id', '==', itemId)
    );
    const batchSnap = await getDocs(batchQ);
    const batches = batchSnap.docs.map(d => ({ id: d.id, ...d.data() }));

    // 2. Check if this item is used as an ingredient in any cooked meat recipe
    const cookedQ = query(
        collection(db, ITEMS),
        where('item_type', '==', 'cooked_meat')
    );
    const cookedSnap = await getDocs(cookedQ);
    const usedInRecipes = [];
    cookedSnap.docs.forEach(d => {
        const data = d.data();
        const ingredients = data.recipe?.ingredients || [];
        if (ingredients.some(ing => ing.item_id === itemId)) {
            usedInRecipes.push({ id: d.id, name: data.name });
        }
    });

    return { batches, usedInRecipes };
};

/**
 * Delete an inventory item.
 * @param {string} id — item ID
 * @param {Object} options
 * @param {boolean} options.force — if true, also delete all batches
 */
export const deleteItem = async (id, options = {}) => {
    const { force = false } = options;

    // Get all batches for this item
    const batchQ = query(
        collection(db, BATCHES),
        where('item_id', '==', id)
    );
    const batchSnap = await getDocs(batchQ);

    if (!force && !batchSnap.empty) {
        const activeBatches = batchSnap.docs.filter(d => d.data().status === 'available');
        if (activeBatches.length > 0) {
            throw new Error('Cannot delete item with active batches. Use force delete to remove item and all batches.');
        }
    }

    // Delete all associated batches when force is true
    if (force && !batchSnap.empty) {
        const batchDeletePromises = batchSnap.docs.map(d => deleteDoc(doc(db, BATCHES, d.id)));
        await Promise.all(batchDeletePromises);
    }

    await deleteDoc(doc(db, ITEMS, id));
};

export const getLowStockItems = async (itemType = null) => {
    const filters = { status: 'active' };
    if (itemType) filters.item_type = itemType;
    const items = await getItems(filters);
    return items.filter(item => item.current_stock <= (item.low_stock_threshold || item.min_stock));
};

/**
 * Get items suitable as recipe ingredients (Grocery + Raw Meat only)
 */
export const getIngredientItems = async () => {
    const grocery = await getItems({ item_type: 'grocery', status: 'active' });
    const rawMeat = await getItems({ item_type: 'raw_meat', status: 'active' });
    return [...grocery, ...rawMeat];
};

// ═══════════════════════════════════════════
// BATCHES
// ═══════════════════════════════════════════

export const generateBatchNumber = (itemType) => {
    const prefix = {
        grocery: 'BT-GR',
        raw_meat: 'BT-RM',
        cooked_meat: 'CK-CM',
    }[itemType] || 'BT';

    const now = new Date();
    const dateStr = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
    const rand = Math.floor(100 + Math.random() * 900);
    return `${prefix}-${dateStr}-${rand}`;
};

export const getBatches = async (filters = {}) => {
    let q = collection(db, BATCHES);
    // Build only where() constraints — no orderBy to avoid composite index requirement
    const constraints = [];

    if (filters.item_id) {
        constraints.push(where('item_id', '==', filters.item_id));
    }
    if (filters.item_type) {
        constraints.push(where('item_type', '==', filters.item_type));
    }
    if (filters.status) {
        constraints.push(where('status', '==', filters.status));
    }

    q = query(q, ...constraints);
    const snap = await getDocs(q);
    const batches = snap.docs.map(d => ({
        id: d.id,
        ...d.data(),
        manufactured_date: d.data().manufactured_date?.toDate?.() || null,
        expiry_date: d.data().expiry_date?.toDate?.() || null,
        created_at: d.data().created_at?.toDate?.() || null,
    }));
    // Sort client-side by created_at descending
    batches.sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
    return batches;
};

export const addBatch = async (data) => {
    const batchNumber = data.batch_number || generateBatchNumber(data.item_type);
    const batchData = {
        ...data,
        batch_number: batchNumber,
        remaining_qty: data.quantity,
        status: 'available',
        source: data.source || 'unknown', // track batch origin
        created_at: serverTimestamp(),
    };

    // Convert date strings to Date objects for Firestore
    if (typeof batchData.manufactured_date === 'string') {
        batchData.manufactured_date = new Date(batchData.manufactured_date);
    }
    if (typeof batchData.expiry_date === 'string') {
        batchData.expiry_date = new Date(batchData.expiry_date);
    }

    const docRef = await addDoc(collection(db, BATCHES), batchData);

    // Update item current_stock
    if (data.item_id) {
        await updateDoc(doc(db, ITEMS, data.item_id), {
            current_stock: increment(data.quantity),
            updated_at: serverTimestamp(),
        });
    }

    return { id: docRef.id, ...batchData };
};

export const updateBatch = async (id, data) => {
    await updateDoc(doc(db, BATCHES, id), {
        ...data,
        updated_at: serverTimestamp(),
    });
};

export const consumeBatch = async (batchId, quantity, itemId) => {
    const batchRef = doc(db, BATCHES, batchId);
    const batchSnap = await getDoc(batchRef);
    if (!batchSnap.exists()) throw new Error('Batch not found');

    const batch = batchSnap.data();
    if (quantity > batch.remaining_qty) {
        throw new Error(`Insufficient batch quantity. Available: ${batch.remaining_qty}`);
    }

    const newRemaining = batch.remaining_qty - quantity;
    const updates = {
        remaining_qty: newRemaining,
        updated_at: serverTimestamp(),
    };
    if (newRemaining === 0) {
        updates.status = 'consumed';
    }

    await updateDoc(batchRef, updates);

    // Update item stock
    if (itemId) {
        await updateDoc(doc(db, ITEMS, itemId), {
            current_stock: increment(-quantity),
            updated_at: serverTimestamp(),
        });
    }
};

export const getNearExpiryBatches = async (daysThreshold = 7) => {
    const now = new Date();
    const thresholdDate = new Date(now.getTime() + daysThreshold * 24 * 60 * 60 * 1000);

    const q = query(
        collection(db, BATCHES),
        where('status', '==', 'available'),
        where('expiry_date', '<=', thresholdDate),
        orderBy('expiry_date', 'asc')
    );

    const snap = await getDocs(q);
    return snap.docs.map(d => ({
        id: d.id,
        ...d.data(),
        expiry_date: d.data().expiry_date?.toDate?.() || null,
        created_at: d.data().created_at?.toDate?.() || null,
    }));
};

// ═══════════════════════════════════════════
// STOCK ADJUSTMENT
// ═══════════════════════════════════════════

export const adjustStock = async (itemId, quantity, reason, batchId = null) => {
    // Positive quantity = add stock, negative = remove
    const updateFields = {
        current_stock: increment(quantity),
        updated_at: serverTimestamp(),
    };
    // Track sold stock when removing
    if (quantity < 0) {
        updateFields.total_sold = increment(Math.abs(quantity));
    }
    await updateDoc(doc(db, ITEMS, itemId), updateFields);

    // If removing from a specific batch
    if (batchId && quantity < 0) {
        await consumeBatch(batchId, Math.abs(quantity), null); // don't double-decrement item
    }
};

/**
 * Batch-aware stock adjustment for raw_meat and cooked_meat items.
 *
 * ADD STOCK: Creates a new batch (or adds to existing batch).
 * REMOVE STOCK: Deducts from specified batch or FIFO (oldest first).
 *
 * @param {Object} item  — full item object { id, name, item_type, unit, default_expiry_days, ... }
 * @param {number} quantity — positive = add, negative = remove
 * @param {Object} options
 * @param {string} options.reason — reason for adjustment
 * @param {string} options.source — 'manual_adjustment' | 'bulk_upload'
 * @param {string} options.mode — 'new_batch' | 'existing_batch' | 'fifo' | 'specific_batch'
 * @param {string} options.batchId — specific batch ID (for 'existing_batch' or 'specific_batch' mode)
 * @param {string} options.expiryDate — expiry date for new batch (ISO or Date)
 * @param {string} options.vendor — vendor name for new batch
 */
export const adjustStockBatchAware = async (item, quantity, options = {}) => {
    const {
        reason = '',
        source = 'manual_adjustment',
        mode = 'new_batch',
        batchId = null,
        expiryDate = null,
        vendor = '',
    } = options;

    const absQty = Math.abs(quantity);

    if (quantity > 0) {
        // ── ADDING STOCK ──
        if (mode === 'existing_batch' && batchId) {
            // Add to existing batch
            const batchRef = doc(db, BATCHES, batchId);
            await updateDoc(batchRef, {
                remaining_qty: increment(absQty),
                updated_at: serverTimestamp(),
            });
            await updateDoc(doc(db, ITEMS, item.id), {
                current_stock: increment(absQty),
                updated_at: serverTimestamp(),
            });
        } else {
            // Create new batch (default)
            const defaultExpiryDays = item.default_expiry_days || (item.item_type === 'raw_meat' ? 3 : 2);
            const now = new Date();
            const expiry = expiryDate
                ? new Date(expiryDate)
                : new Date(now.getTime() + defaultExpiryDays * 24 * 60 * 60 * 1000);

            await addBatch({
                item_id: item.id,
                item_name: item.name,
                item_type: item.item_type,
                quantity: absQty,
                unit: item.unit || 'kg',
                vendor: vendor || item.vendor || '',
                manufactured_date: now,
                expiry_date: expiry,
                cost_price: item.cost_price || 0,
                source,
                notes: reason || `Stock added via ${source.replace('_', ' ')}`,
            });
            // addBatch already increments current_stock
            return; // exit early since addBatch handles stock update
        }
    } else if (quantity < 0) {
        // ── REMOVING STOCK ──
        if (mode === 'specific_batch' && batchId) {
            // Remove from a specific batch
            await consumeBatch(batchId, absQty, item.id);
        } else {
            // FIFO deduction (default)
            await deductStockFIFO(item.id, absQty);
        }
    }
};

/**
 * Deduct stock using FIFO (oldest batch first).
 * Handles consuming from multiple batches if needed.
 *
 * @param {string} itemId
 * @param {number} quantity — positive number to deduct
 * @returns {Array} consumed batches info
 */
export const deductStockFIFO = async (itemId, quantity) => {
    const batches = await getBatches({ item_id: itemId, status: 'available' });
    // Sort ascending by created_at (oldest first = FIFO)
    batches.sort((a, b) => (a.created_at || 0) - (b.created_at || 0));

    let remaining = quantity;
    const consumed = [];

    for (const batch of batches) {
        if (remaining <= 0) break;
        const deductQty = Math.min(remaining, batch.remaining_qty);
        await consumeBatch(batch.id, deductQty, itemId);
        consumed.push({
            batch_id: batch.id,
            batch_number: batch.batch_number,
            quantity_deducted: deductQty,
        });
        remaining -= deductQty;
    }

    if (remaining > 0.001) {
        console.warn(`FIFO deduction short by ${remaining.toFixed(3)} for item ${itemId}`);
    }

    return consumed;
};

// ═══════════════════════════════════════════
// CLEANUP UTILITY — remove old default categories
// ═══════════════════════════════════════════

export const cleanupOldCategories = async () => {
    const oldNames = ['Raw Materials', 'Semi-Finished Goods', 'Finished Goods', 'Packaging Materials', 'Cleaning Supplies'];
    const q = query(collection(db, CATEGORIES));
    const snap = await getDocs(q);

    const toDelete = snap.docs.filter(d => {
        const data = d.data();
        return oldNames.includes(data.name) && !data.item_type;
    });

    if (toDelete.length > 0) {
        const batch = writeBatch(db);
        toDelete.forEach(d => batch.delete(d.ref));
        await batch.commit();
        console.log(`Cleaned up ${toDelete.length} legacy categories`);
    }

    return toDelete.length;
};

// ═══════════════════════════════════════════
//  ENABLE / DISABLE TOGGLES
// ═══════════════════════════════════════════

export const toggleItemEnabled = async (itemId, enabled) => {
    await updateDoc(doc(db, ITEMS, itemId), {
        enabled: Boolean(enabled),
        updated_at: serverTimestamp(),
    });
};

export const toggleCategoryEnabled = async (categoryId, enabled) => {
    await updateDoc(doc(db, CATEGORIES, categoryId), {
        enabled: Boolean(enabled),
    });
};
