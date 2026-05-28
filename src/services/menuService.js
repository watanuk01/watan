/**
 * Menu Service — Firestore CRUD for restaurant menu items
 *
 * Collection: menu_items
 *
 * Each menu item can have multiple portions, each with its own recipe.
 * Recipes can reference:
 *   - Restaurant inventory items (grocery, raw_meat, menu_item)
 *   - Other menu items as sub-components (for platters/combos)
 *
 * Auto-calculates cost from ingredient prices.
 */

import {
    collection,
    doc,
    getDoc,
    getDocs,
    setDoc,
    updateDoc,
    deleteDoc,
    query,
    where,
    serverTimestamp,
} from 'firebase/firestore';
import { db } from '../firebase';

// ─── COLLECTION ───
const MENU_ITEMS = 'menu_items';

// ═══════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════

export const MENU_CATEGORIES = [
    { value: 'starters',  label: 'Starters & Appetisers', icon: '🥘' },
    { value: 'seafood',   label: 'Seafood',               icon: '🐟' },
    { value: 'grill',     label: 'Grill & Kebabs',        icon: '🔥' },
    { value: 'platters',  label: 'Platters',              icon: '🍽️' },
    { value: 'karahi',    label: 'Karahi & Curries',      icon: '🍛' },
    { value: 'rice',      label: 'Rice',                  icon: '🍚' },
    { value: 'breads',    label: 'Breads & Sides',        icon: '🫓' },
    { value: 'desserts',  label: 'Desserts',              icon: '🍮' },
    { value: 'beverages', label: 'Beverages',             icon: '🥤' },
];

export const ALLERGEN_CODES = [
    { code: 'd', label: 'Dairy',      icon: '🥛' },
    { code: 'g', label: 'Gluten',     icon: '🌾' },
    { code: 'e', label: 'Egg',        icon: '🥚' },
    { code: 'n', label: 'Nuts',       icon: '🥜' },
    { code: 's', label: 'Sesame',     icon: '🫘' },
    { code: 'v', label: 'Vegetarian', icon: '🥬' },
];

export const MODEL_TYPES = [
    { value: 'bulk_curry', label: 'Model A: Bulk Curry Based',       desc: 'Standard curry portions (e.g., Chicken Karahi)' },
    { value: 'biryani',    label: 'Model B: Biryani Based',          desc: 'Rice with protein (e.g., Lamb Biryani)' },
    { value: 'combo',      label: 'Model C: Rice + Protein Combo',   desc: 'Combination plates' },
    { value: 'grill',      label: 'Model D: Grill / Marinated Raw',  desc: 'Grilled items from raw meat' },
    { value: 'platter',    label: 'Model E: Platter (Composite)',     desc: 'Multi-item platters (e.g., Mix Grill)' },
    { value: 'side',       label: 'Model F: Bread / Side / Beverage', desc: 'Simple single-item deductions' },
];

/**
 * Get category info by value
 */
export const getCategoryInfo = (value) =>
    MENU_CATEGORIES.find(c => c.value === value) || { value, label: value, icon: '📦' };

/**
 * Get allergen info by code
 */
export const getAllergenInfo = (code) =>
    ALLERGEN_CODES.find(a => a.code === code) || { code, label: code, icon: '⚠️' };

// ═══════════════════════════════════════════
// COST CALCULATION HELPERS
// ═══════════════════════════════════════════

/**
 * Calculate the cost for a recipe ingredient line.
 * Uses conversion_to_master to convert sub-unit quantity to master-unit quantity,
 * then multiplies by cost_price (which is per master-unit).
 *
 * @param {Object} ingredient — { quantity, conversion_to_master, cost_price }
 * @returns {number} cost in £
 */
export const calcIngredientCost = (ingredient) => {
    const qty = Number(ingredient.quantity) || 0;
    const conv = Number(ingredient.conversion_to_master) || 1;
    const costPerUnit = Number(ingredient.cost_price) || 0;
    return Number((qty * conv * costPerUnit).toFixed(4));
};

/**
 * Calculate total recipe cost for a portion.
 * Sums raw ingredient costs + sub-menu-item costs.
 *
 * @param {Object} portion — { recipe: [...], sub_items: [...] }
 * @returns {number} total cost in £
 */
export const calcPortionCost = (portion) => {
    let cost = 0;
    // Raw ingredients
    if (portion.recipe) {
        for (const ing of portion.recipe) {
            cost += calcIngredientCost(ing);
        }
    }
    // Sub-menu items (for platters/combos)
    if (portion.sub_items) {
        for (const sub of portion.sub_items) {
            cost += Number(sub.cost) || 0;
        }
    }
    return Number(cost.toFixed(2));
};

/**
 * Get available units for an ingredient from its inventory item data.
 * Returns array like [{ value: 'kg', label: 'kg', factor: 1 }, { value: 'g', label: 'g', factor: 0.001 }]
 *
 * @param {Object} inventoryItem — from restaurant_inventory with unit_conversion
 * @returns {Array} available units with conversion factors
 */
export const getAvailableUnits = (inventoryItem) => {
    if (!inventoryItem) return [{ value: 'unit', label: 'unit', factor: 1 }];

    const units = [];
    const masterUnit = inventoryItem.unit || inventoryItem.base_unit || 'unit';

    // Always add master unit first
    units.push({ value: masterUnit, label: masterUnit, factor: 1 });

    // If has unit conversion, add base unit and all intermediate units
    if (inventoryItem.unit_conversion?.has_conversion) {
        const conv = inventoryItem.unit_conversion;

        // Add base unit if different from master
        if (conv.base_unit || inventoryItem.base_unit) {
            const baseUnit = conv.base_unit || inventoryItem.base_unit;
            if (baseUnit !== masterUnit && !units.find(u => u.value === baseUnit)) {
                units.push({
                    value: baseUnit,
                    label: baseUnit,
                    factor: 1 / (conv.base_factor || 1),
                });
            }
        }

        // Add all levels
        if (conv.levels) {
            for (const level of conv.levels) {
                if (!units.find(u => u.value === level.to)) {
                    // Calculate factor: how much of master unit is 1 of this sub-unit
                    // For menu recipes, we want conversion_to_master
                    // e.g., 1 pack = 2 kg, so if master is "box" and base is "kg", 1 pack = 2 kg
                    units.push({
                        value: level.to,
                        label: level.to,
                        factor: level.factor || 1,
                    });
                }
                if (!units.find(u => u.value === level.from)) {
                    units.push({
                        value: level.from,
                        label: level.from,
                        factor: 1,
                    });
                }
            }
        }
    }

    // Add common sub-units that match ANY unit already in the list
    const commonSubs = {
        kg: [{ value: 'g', label: 'Grams (g)', factor: 0.001 }],
        g: [{ value: 'kg', label: 'Kilogram (kg)', factor: 1000 }],
        l: [{ value: 'ml', label: 'Millilitre (mL)', factor: 0.001 }],
        ml: [{ value: 'l', label: 'Litre (L)', factor: 1000 }],
    };

    // Normalise unit values to match commonSubs keys
    const normaliseUnit = (u) => {
        const low = (u || '').toLowerCase().trim();
        if (low === 'litre (l)' || low === 'litre' || low === 'liter' || low === 'litres') return 'l';
        if (low === 'millilitre (ml)' || low === 'millilitre' || low === 'milliliter') return 'ml';
        if (low === 'kilogram (kg)' || low === 'kilogram' || low === 'kilograms') return 'kg';
        if (low === 'gram (g)' || low === 'gram' || low === 'grams') return 'g';
        return low;
    };

    // Check ALL existing units (master, base, and levels) for metric counterparts
    const existingNorms = new Set(units.map(u => normaliseUnit(u.value)));
    for (const normKey of existingNorms) {
        if (commonSubs[normKey]) {
            for (const sub of commonSubs[normKey]) {
                if (!units.find(u => normaliseUnit(u.value) === normaliseUnit(sub.value))) {
                    units.push(sub);
                }
            }
        }
    }

    // Always include pcs if not present — useful for piece-based recipes
    if (!units.find(u => u.value === 'pcs')) {
        units.push({ value: 'pcs', label: 'Pieces', factor: 1 });
    }

    return units;
};

/**
 * Get the conversion factor from a selected sub-unit to the master unit.
 * This is stored as `conversion_to_master` per ingredient.
 *
 * @param {string} selectedUnit — the sub-unit selected
 * @param {Object} inventoryItem — the inventory item with unit_conversion
 * @returns {number} conversion factor (1 sub-unit = factor × master-unit)
 */
export const getConversionToMaster = (selectedUnit, inventoryItem) => {
    if (!inventoryItem) return 1;
    const masterUnit = (inventoryItem.unit || inventoryItem.base_unit || 'unit').toLowerCase();
    const selected = (selectedUnit || 'unit').toLowerCase();

    if (selected === masterUnit) return 1;

    // ── Known metric relationships ──
    // These let us bridge sub-units that aren't explicitly in the breakdown
    const metricPairs = {
        'ml': { parent: 'l', factor: 0.001 },     // 1 ml = 0.001 L
        'l': { parent: 'ml', factor: 1000 },       // 1 L = 1000 ml (reverse)
        'g': { parent: 'kg', factor: 0.001 },      // 1 g = 0.001 kg
        'kg': { parent: 'g', factor: 1000 },        // 1 kg = 1000 g
        'litre (l)': { parent: 'l', factor: 1 },    // alias
        'litre': { parent: 'l', factor: 1 },
        'liter': { parent: 'l', factor: 1 },
        'millilitre': { parent: 'ml', factor: 1 },
        'milliliter': { parent: 'ml', factor: 1 },
        'gram': { parent: 'g', factor: 1 },
        'grams': { parent: 'g', factor: 1 },
        'kilogram': { parent: 'kg', factor: 1 },
    };

    // Normalise a unit name to its canonical form
    const normalise = (u) => {
        const low = u.toLowerCase().trim();
        // Strip common suffixes like "Litre (L)" → "l"
        if (low === 'litre (l)' || low === 'litre' || low === 'liter' || low === 'litres') return 'l';
        if (low === 'millilitre (ml)' || low === 'millilitre' || low === 'milliliter' || low === 'ml') return 'ml';
        if (low === 'kilogram (kg)' || low === 'kilogram' || low === 'kilograms') return 'kg';
        if (low === 'gram (g)' || low === 'gram' || low === 'grams') return 'g';
        if (low === 'packs' || low === 'pack') return 'packs';
        if (low === 'units' || low === 'unit') return 'units';
        if (low === 'pieces' || low === 'piece' || low === 'pcs') return 'pcs';
        return low;
    };

    const normSelected = normalise(selected);
    const normMaster = normalise(masterUnit);

    if (normSelected === normMaster) return 1;

    // ── Build conversion graph from unit_conversion levels ──
    // Graph: edges[fromUnit][toUnit] = factor (1 fromUnit = factor × toUnit)
    const edges = {};
    const addEdge = (from, to, factor) => {
        const nf = normalise(from);
        const nt = normalise(to);
        if (!edges[nf]) edges[nf] = {};
        if (!edges[nt]) edges[nt] = {};
        edges[nf][nt] = factor;
        if (factor > 0) edges[nt][nf] = 1 / factor;
    };

    // Add breakdown levels
    if (inventoryItem.unit_conversion?.levels) {
        for (const level of inventoryItem.unit_conversion.levels) {
            // level: { from: "Packs", to: "Units", factor: 6 }
            // means 1 Packs = 6 Units → 1 Units = 1/6 Packs
            addEdge(level.to, level.from, 1 / level.factor);
        }
    }

    // Add base_factor if present
    if (inventoryItem.unit_conversion?.base_factor) {
        const baseUnit = normalise(inventoryItem.base_unit || inventoryItem.unit_conversion?.base_unit || 'unit');
        addEdge(baseUnit, normMaster, 1 / inventoryItem.unit_conversion.base_factor);
    }

    // Add metric sub-unit relationships
    const metricEntries = [
        ['ml', 'l', 0.001],
        ['g', 'kg', 0.001],
    ];
    for (const [sub, parent, factor] of metricEntries) {
        addEdge(sub, parent, factor);
    }

    // ── BFS to find conversion path from normSelected → normMaster ──
    const visited = new Set();
    const queue = [[normSelected, 1]]; // [currentUnit, cumulativeFactor]
    visited.add(normSelected);

    while (queue.length > 0) {
        const [current, factor] = queue.shift();

        if (current === normMaster) return factor;

        if (edges[current]) {
            for (const [neighbor, edgeFactor] of Object.entries(edges[current])) {
                if (!visited.has(neighbor)) {
                    visited.add(neighbor);
                    queue.push([neighbor, factor * edgeFactor]);
                }
            }
        }
    }

    // ── Fallback: direct metric if master itself is a metric unit ──
    if (metricPairs[normSelected] && metricPairs[normSelected].parent === normMaster) {
        return metricPairs[normSelected].factor;
    }

    console.warn(`[getConversionToMaster] No conversion path found: ${selectedUnit} → ${masterUnit}`);
    return 1;
};

// ═══════════════════════════════════════════
// CRUD OPERATIONS
// ═══════════════════════════════════════════

/**
 * Fetch all menu items for a restaurant.
 */
export const getMenuItems = async (restaurantId, filters = {}) => {
    const constraints = [where('restaurant_id', '==', restaurantId)];

    if (filters.category) {
        constraints.push(where('category', '==', filters.category));
    }
    if (typeof filters.is_active === 'boolean') {
        constraints.push(where('is_active', '==', filters.is_active));
    }

    const q = query(collection(db, MENU_ITEMS), ...constraints);
    const snap = await getDocs(q);

    let items = snap.docs.map(d => ({
        id: d.id,
        ...d.data(),
        created_at: d.data().created_at?.toDate?.() || null,
        updated_at: d.data().updated_at?.toDate?.() || null,
    }));

    // Client-side search
    if (filters.search) {
        const s = filters.search.toLowerCase();
        items = items.filter(i =>
            i.name?.toLowerCase().includes(s) ||
            i.description?.toLowerCase().includes(s)
        );
    }

    // Sort by name
    items.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    return items;
};

/**
 * Get a single menu item by ID.
 */
export const getMenuItem = async (menuItemId) => {
    const ref = doc(db, MENU_ITEMS, menuItemId);
    const snap = await getDoc(ref);
    if (!snap.exists()) return null;
    return { id: snap.id, ...snap.data() };
};

/**
 * Create a new menu item.
 */
export const createMenuItem = async (data) => {
    if (!data.name?.trim()) throw new Error('Menu item name is required');
    if (!data.category) throw new Error('Category is required');
    if (!data.restaurant_id) throw new Error('Restaurant ID is required');
    if (!data.portions || data.portions.length === 0) {
        throw new Error('At least one portion is required');
    }

    for (const portion of data.portions) {
        if (!portion.name?.trim()) throw new Error('Each portion needs a name');
        if (portion.selling_price == null && portion.price == null) throw new Error('Each portion needs a price');
    }

    const ref = doc(collection(db, MENU_ITEMS));

    const menuItem = {
        restaurant_id: data.restaurant_id,
        name: data.name.trim(),
        category: data.category,
        description: data.description?.trim() || '',
        allergens: data.allergens || [],
        model_type: data.model_type || '',
        is_active: data.is_active !== false,
        portions: data.portions.map(p => ({
            id: p.id || generatePortionId(),
            name: p.name.trim(),
            selling_price: Number(p.selling_price ?? p.price) || 0,
            cost_price: Number(p.cost_price) || 0,
            recipe: (p.recipe || []).map(r => ({
                item_id: r.item_id,
                item_name: r.item_name,
                item_type: r.item_type || '',
                unit: r.unit || '',              // sub-unit used in recipe (e.g., g, pcs)
                master_unit: r.master_unit || '', // master unit of inventory item (e.g., kg)
                quantity: Number(r.quantity) || 0,
                conversion_to_master: Number(r.conversion_to_master) || 1,
                cost_price: Number(r.cost_price) || 0,  // cost per master-unit
                line_cost: Number(r.line_cost) || 0,     // auto-calculated: qty × conv × cost
            })),
            sub_items: (p.sub_items || []).map(s => ({
                menu_item_id: s.menu_item_id,
                menu_item_name: s.menu_item_name,
                portion_id: s.portion_id || '',
                portion_name: s.portion_name || '',
                quantity: Number(s.quantity) || 1,
                cost: Number(s.cost) || 0,
            })),
        })),
        created_at: serverTimestamp(),
        updated_at: serverTimestamp(),
        created_by: data.created_by || '',
    };

    await setDoc(ref, menuItem);
    return { id: ref.id, ...menuItem };
};

/**
 * Update an existing menu item.
 */
export const updateMenuItem = async (menuItemId, updates) => {
    const ref = doc(db, MENU_ITEMS, menuItemId);

    if (updates.portions) {
        updates.portions = updates.portions.map(p => ({
            id: p.id || generatePortionId(),
            name: (p.name || '').trim(),
            selling_price: Number(p.selling_price ?? p.price) || 0,
            cost_price: Number(p.cost_price) || 0,
            recipe: (p.recipe || []).map(r => ({
                item_id: r.item_id,
                item_name: r.item_name,
                item_type: r.item_type || '',
                unit: r.unit || '',
                master_unit: r.master_unit || '',
                quantity: Number(r.quantity) || 0,
                conversion_to_master: Number(r.conversion_to_master) || 1,
                cost_price: Number(r.cost_price) || 0,
                line_cost: Number(r.line_cost) || 0,
            })),
            sub_items: (p.sub_items || []).map(s => ({
                menu_item_id: s.menu_item_id,
                menu_item_name: s.menu_item_name,
                portion_id: s.portion_id || '',
                portion_name: s.portion_name || '',
                quantity: Number(s.quantity) || 1,
                cost: Number(s.cost) || 0,
            })),
        }));
    }

    await updateDoc(ref, {
        ...updates,
        updated_at: serverTimestamp(),
    });
};

/**
 * Delete a menu item (hard delete).
 */
export const deleteMenuItem = async (menuItemId) => {
    await deleteDoc(doc(db, MENU_ITEMS, menuItemId));
};

/**
 * Toggle the active status of a menu item.
 */
export const toggleMenuItemActive = async (menuItemId) => {
    const ref = doc(db, MENU_ITEMS, menuItemId);
    const snap = await getDoc(ref);
    if (!snap.exists()) throw new Error('Menu item not found');

    const currentActive = snap.data().is_active !== false;
    await updateDoc(ref, {
        is_active: !currentActive,
        updated_at: serverTimestamp(),
    });

    return !currentActive;
};

/**
 * Get menu items count by category for a restaurant.
 */
export const getMenuStats = async (restaurantId) => {
    const items = await getMenuItems(restaurantId);

    const totalItems = items.length;
    const activeItems = items.filter(i => i.is_active !== false).length;
    const categoriesUsed = new Set(items.map(i => i.category)).size;
    const withoutRecipe = items.filter(i =>
        !i.portions?.length || i.portions.some(p => (!p.recipe?.length && !p.sub_items?.length))
    ).length;

    const byCategory = {};
    items.forEach(item => {
        const cat = item.category || 'other';
        if (!byCategory[cat]) byCategory[cat] = 0;
        byCategory[cat]++;
    });

    return { totalItems, activeItems, categoriesUsed, withoutRecipe, byCategory };
};

// ═══════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════

function generatePortionId() {
    return 'p_' + Date.now().toString(36) + '_' + Math.random().toString(36).substr(2, 6);
}
