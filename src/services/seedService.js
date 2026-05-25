/**
 * Seed Service — Clear Firestore data & import inventory from Excel
 *
 * Uses the client-side Firestore SDK (runs in browser as logged-in admin).
 * Parses Excel via the 'xlsx' package.
 */

import {
    collection,
    getDocs,
    addDoc,
    writeBatch,
    doc,
    updateDoc,
    serverTimestamp,
} from 'firebase/firestore';
import { db } from '../firebase';
import * as XLSX from 'xlsx';

// ─── Collections to clear (everything except 'users') ───
const COLLECTIONS_TO_CLEAR = [
    'inventory_items',
    'inventory_categories',
    'inventory_batches',
    'orders',
    'invoices',
    'productions',
    'production_invoices',
    'waste_events',
    'restaurant_inventory',
    'purchase_orders',
    'notifications',
    'menu_items',
    'settings',
    'user_fcm_tokens',
];

// ─── Unit normalisation map ───
const UNIT_MAP = {
    'kg': 'kg',
    'kgs': 'kg',
    'g': 'g',
    'l': 'l',
    'ltr': 'l',
    'litre': 'l',
    'litres': 'l',
    'ml': 'ml',
    'pcs': 'pcs',
    'pieces': 'pcs',
    'piece': 'pcs',
    'pack': 'pack',
    'packs': 'pack',
    'box': 'box',
    'boxes': 'box',
    'bag': 'bag',
    'bags': 'bag',
    'bottle': 'bottle',
    'bottles': 'bottle',
    'tin': 'tin',
    'tins': 'tin',
    'tray': 'tray',
    'trays': 'tray',
    'roll': 'roll',
    'rolls': 'roll',
    'dozen': 'dozen',
    'unit': 'unit',
    'units': 'unit',
    'portions': 'portions',
};

const normaliseUnit = (raw) => {
    if (!raw) return 'unit';
    const cleaned = raw.toString().trim().toLowerCase().replace(/\s+/g, '');
    return UNIT_MAP[cleaned] || cleaned;
};

// ─── SKU generator ───
const generateSKU = (itemType, name) => {
    const prefix = { grocery: 'GR', raw_meat: 'RM', cooked_meat: 'CM' }[itemType] || 'GN';
    const nameCode = (name || '').replace(/[^a-zA-Z0-9]/g, '').substring(0, 4).toUpperCase();
    const rand = Math.floor(1000 + Math.random() * 9000);
    return `${prefix}-${nameCode}-${rand}`;
};

// ─── Parse price string ───
const parsePrice = (raw) => {
    if (raw === undefined || raw === null || raw === '') return 0;
    if (typeof raw === 'number') return raw;
    const cleaned = raw.toString().replace(/[£$,\s]/g, '');
    const val = parseFloat(cleaned);
    return isNaN(val) ? 0 : val;
};

// ═══════════════════════════════════════════
// STEP 1: Clear all collections
// ═══════════════════════════════════════════

export const clearAllCollections = async (onProgress) => {
    let total = 0;
    for (const colName of COLLECTIONS_TO_CLEAR) {
        onProgress?.(`Clearing ${colName}...`);
        try {
            const snap = await getDocs(collection(db, colName));
            if (snap.empty) continue;

            // Batch-delete in chunks of 500
            const docs = snap.docs;
            for (let i = 0; i < docs.length; i += 500) {
                const batch = writeBatch(db);
                const chunk = docs.slice(i, i + 500);
                chunk.forEach(d => batch.delete(d.ref));
                await batch.commit();
                total += chunk.length;
            }
            onProgress?.(`  ✓ Cleared ${docs.length} docs from ${colName}`);
        } catch (err) {
            console.error(`Failed to clear ${colName}:`, err);
            onProgress?.(`  ⚠ Error clearing ${colName}: ${err.message}`);
        }
    }
    return total;
};

// ═══════════════════════════════════════════
// STEP 2: Parse Excel file
// ═══════════════════════════════════════════

export const parseExcelFile = (file) => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const wb = XLSX.read(e.target.result, { type: 'array' });
                const sheets = {};
                wb.SheetNames.forEach(name => {
                    sheets[name] = XLSX.utils.sheet_to_json(wb.Sheets[name], { defval: '' });
                });
                resolve(sheets);
            } catch (err) {
                reject(err);
            }
        };
        reader.onerror = reject;
        reader.readAsArrayBuffer(file);
    });
};

// ═══════════════════════════════════════════
// STEP 3: Seed categories
// ═══════════════════════════════════════════

const seedCategories = async (categoriesByType, onProgress) => {
    const categoryMap = {}; // "type:name" → doc ID
    let count = 0;

    for (const [itemType, names] of Object.entries(categoriesByType)) {
        for (const name of names) {
            if (!name || !name.trim()) continue;
            const key = `${itemType}:${name.trim()}`;
            if (categoryMap[key]) continue; // already created

            const docRef = await addDoc(collection(db, 'inventory_categories'), {
                name: name.trim(),
                item_type: itemType,
                status: 'active',
                enabled: true,
                sort_order: count,
                created_at: serverTimestamp(),
            });
            categoryMap[key] = docRef.id;
            count++;
        }
    }

    onProgress?.(`  ✓ Created ${count} categories`);
    return categoryMap;
};

// ═══════════════════════════════════════════
// STEP 4: Seed Raw Meat items
// ═══════════════════════════════════════════

const seedRawMeat = async (rows, categoryMap, onProgress) => {
    let count = 0;
    const itemIds = {}; // name → doc id

    for (const row of rows) {
        const name = (row['Item Name'] || '').trim();
        if (!name) continue;

        const category = (row['Category'] || 'other').trim();
        const catKey = `raw_meat:${category}`;
        const catId = categoryMap[catKey] || null;
        const unit = normaliseUnit(row['Units']);
        const costPrice = parsePrice(row['Actual Price']);

        const itemData = {
            name,
            sku: generateSKU('raw_meat', name),
            item_type: 'raw_meat',
            category_id: catId,
            category_name: category,
            unit,
            base_unit: unit,
            unit_conversion: { has_conversion: false, levels: [], base_factor: 1 },
            current_stock: 0,
            min_stock: 0,
            cost_price: costPrice,
            selling_price: 0,
            vat_rate: 0,
            vat_exempt: true,
            low_stock_threshold: 0,
            storage_type: 'chilled',
            vendor: (row['Vendor'] || '').trim(),
            batch_tracking: true,
            default_expiry_days: 3,
            notes: '',
            status: 'active',
            enabled: true,
            total_sold: 0,
            created_at: serverTimestamp(),
            updated_at: serverTimestamp(),
        };

        const docRef = await addDoc(collection(db, 'inventory_items'), itemData);
        itemIds[name.toLowerCase()] = docRef.id;
        count++;
    }

    onProgress?.(`  ✓ Created ${count} raw meat items`);
    return itemIds;
};

// ═══════════════════════════════════════════
// STEP 5: Seed Cooked Food items
// ═══════════════════════════════════════════

const seedCookedFood = async (rows, categoryMap, onProgress) => {
    let count = 0;
    const itemIds = {}; // name → doc id

    for (const row of rows) {
        const name = (row['Item Name'] || '').trim();
        if (!name) continue;

        const category = (row['Category'] || 'other').trim();
        const catKey = `cooked_meat:${category}`;
        const catId = categoryMap[catKey] || null;
        const unit = normaliseUnit(row['Units']);
        const sellingPrice = parsePrice(row['Selling Price']);
        const costPrice = parsePrice(row['Actual Price']);
        const batchSize = parseFloat(row['Qty kg']) || 0;

        const itemData = {
            name,
            sku: generateSKU('cooked_meat', name),
            item_type: 'cooked_meat',
            category_id: catId,
            category_name: category,
            unit,
            base_unit: unit,
            unit_conversion: { has_conversion: false, levels: [], base_factor: 1 },
            current_stock: 0,
            min_stock: 0,
            cost_price: costPrice,
            selling_price: sellingPrice,
            vat_rate: 0,
            vat_exempt: true,
            low_stock_threshold: 0,
            storage_type: 'chilled',
            batch_tracking: true,
            default_expiry_days: 2,
            recipe: {
                base_batch_size: batchSize,
                base_batch_unit: unit,
                ingredients: [],
            },
            allowed_production_quantities: [],
            notes: '',
            status: 'active',
            enabled: true,
            total_sold: 0,
            created_at: serverTimestamp(),
            updated_at: serverTimestamp(),
        };

        const docRef = await addDoc(collection(db, 'inventory_items'), itemData);
        itemIds[name.toLowerCase()] = docRef.id;
        count++;
    }

    onProgress?.(`  ✓ Created ${count} cooked food items`);
    return itemIds;
};

// ═══════════════════════════════════════════
// STEP 6: Seed Grocery items
// ═══════════════════════════════════════════

const seedGroceries = async (rows, categoryMap, onProgress) => {
    let count = 0;

    for (const row of rows) {
        const name = (row['Item Name'] || '').trim();
        if (!name) continue;

        const category = (row['Category'] || '').trim();
        const catKey = `grocery:${category}`;
        const catId = categoryMap[catKey] || null;
        const unit = normaliseUnit(row['Units']);
        const costPrice = parsePrice(row['Actual Unit Price']);
        const vatRate = parseInt(row['VAT%']) || 0;

        const itemData = {
            name,
            sku: generateSKU('grocery', name),
            item_type: 'grocery',
            category_id: catId,
            category_name: category,
            unit,
            base_unit: unit,
            unit_conversion: { has_conversion: false, levels: [], base_factor: 1 },
            current_stock: 0,
            min_stock: 0,
            cost_price: costPrice,
            selling_price: 0,
            vat_rate: vatRate,
            vat_exempt: vatRate === 0,
            low_stock_threshold: 0,
            storage_type: 'ambient',
            vendor: (row['Vendor'] || '').trim(),
            expiry_tracking: false,
            notes: '',
            status: 'active',
            enabled: true,
            total_sold: 0,
            created_at: serverTimestamp(),
            updated_at: serverTimestamp(),
        };

        await addDoc(collection(db, 'inventory_items'), itemData);
        count++;
    }

    onProgress?.(`  ✓ Created ${count} grocery items`);
};

/**
 * Parse the "Cooked Food Batch" sheet.
 *
 * Layout: recipes are in 3 column-pairs side by side:
 *   Cols 0-1  (name, qty),  col 2 = empty separator
 *   Cols 3-4  (name, qty),  col 5 = empty separator
 *   Cols 6-7  (name, qty)
 *
 * Within each column pair, rows alternate between:
 *   - A recipe header row: name="Chicken curry", qty="Batch 70kg"
 *   - Ingredient rows: name="tomato plum", qty="15kg"
 *
 * We scan each column pair independently from top to bottom.
 */
const parseBatchRecipes = (workbook) => {
    const ws = workbook.Sheets['Cooked Food Batch'];
    if (!ws) return [];

    const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
    if (!aoa || aoa.length < 2) return [];

    const allRecipes = [];
    const COL_PAIRS = [[0, 1], [3, 4], [6, 7]];

    const parseIngQty = (raw) => {
        const s = raw.toString().trim();
        // Match a leading number (possibly decimal)
        const m = s.match(/^([\d.]+)\s*(.*)/);
        if (!m) return null;
        const qty = parseFloat(m[1]);
        if (!qty || qty <= 0) return null;
        const unitRaw = (m[2] || '').trim().toLowerCase().replace(/\s+/g, '');
        const unit = UNIT_MAP[unitRaw] || (unitRaw || 'unit');
        return { qty, unit };
    };

    for (const [nameCol, qtyCol] of COL_PAIRS) {
        let currentRecipe = null;

        for (let r = 0; r < aoa.length; r++) {
            const cellName = (aoa[r][nameCol] || '').toString().trim();
            const cellQty  = (aoa[r][qtyCol]  || '').toString().trim();
            const qtyLower = cellQty.toLowerCase();

            // Recipe header: qty cell contains "batch"
            if (qtyLower.includes('batch') && cellName && !cellName.toLowerCase().includes('total')) {
                // Save previous recipe
                if (currentRecipe && currentRecipe.ingredients.length > 0) {
                    allRecipes.push(currentRecipe);
                }
                // Parse batch size — e.g. "Batch 70kg", "Batch 10kg, 20, 30"
                const bm = cellQty.match(/Batch\s+([\d.]+)\s*(kg|g|l|ltr|ml|pcs|pieces)?/i);
                currentRecipe = {
                    recipe_name: cellName,
                    batch_size: bm ? parseFloat(bm[1]) : 0,
                    batch_unit: bm ? normaliseUnit(bm[2] || 'kg') : 'kg',
                    ingredients: [],
                };
                continue;
            }

            if (!currentRecipe) continue;

            // Skip totals / empty rows
            if (!cellName || qtyLower.includes('total output')) continue;

            // Skip obvious non-ingredient info rows
            if (!cellQty) continue;

            // Parse quantity
            const parsed = parseIngQty(cellQty);
            if (parsed) {
                currentRecipe.ingredients.push({
                    ingredient_name: cellName,
                    quantity: parsed.qty,
                    unit: parsed.unit,
                    item_id: null,
                });
            }
        }

        // Flush last recipe in this column pair
        if (currentRecipe && currentRecipe.ingredients.length > 0) {
            allRecipes.push(currentRecipe);
        }
    }

    return allRecipes;
};

const attachRecipesToItems = async (recipes, cookedItemIds, onProgress) => {
    let matched = 0;
    const unmatched = [];

    // Build a normalised lookup — strip extra spaces and compare lowercased
    const normKey = (s) => s.toLowerCase().replace(/\s+/g, ' ').trim();
    const cookedNorm = {};
    for (const [name, id] of Object.entries(cookedItemIds)) {
        cookedNorm[normKey(name)] = id;
    }

    for (const recipe of recipes) {
        const rNorm = normKey(recipe.recipe_name);

        // 1. Exact normalised match
        let itemId = cookedNorm[rNorm];

        // 2. Partial contains match
        if (!itemId) {
            for (const [name, id] of Object.entries(cookedNorm)) {
                if (rNorm.includes(name) || name.includes(rNorm)) {
                    itemId = id;
                    break;
                }
            }
        }

        if (itemId) {
            try {
                await updateDoc(doc(db, 'inventory_items', itemId), {
                    'recipe.base_batch_size': recipe.batch_size,
                    'recipe.base_batch_unit': recipe.batch_unit,
                    'recipe.ingredients': recipe.ingredients.map(ing => ({
                        item_id: ing.item_id || null,
                        item_name: ing.ingredient_name,
                        quantity: ing.quantity,
                        unit: ing.unit,
                    })),
                    updated_at: serverTimestamp(),
                });
                onProgress?.(`    ✓ ${recipe.recipe_name} (${recipe.ingredients.length} ingredients)`);
                matched++;
            } catch (err) {
                console.error(`Failed to attach recipe for ${recipe.recipe_name}:`, err);
                onProgress?.(`    ⚠ Failed: ${recipe.recipe_name}: ${err.message}`);
            }
        } else {
            unmatched.push(recipe.recipe_name);
        }
    }

    onProgress?.(`  ✓ Attached ${matched}/${recipes.length} recipes to cooked food items`);
    if (unmatched.length > 0) {
        onProgress?.(`  ⚠ ${unmatched.length} unmatched: ${unmatched.join(', ')}`);
    }
};

// ═══════════════════════════════════════════
// MAIN ORCHESTRATOR
// ═══════════════════════════════════════════

/**
 * Full seed pipeline:
 * 1. Clear all collections (except users)
 * 2. Parse Excel
 * 3. Create categories
 * 4. Seed Raw Meat
 * 5. Seed Cooked Food
 * 6. Seed Groceries
 * 7. Parse & attach batch recipes
 *
 * @param {File} file — uploaded .xlsx file
 * @param {Function} onProgress — callback for progress messages
 * @returns {{ totalCleared, rawMeatCount, cookedFoodCount, groceryCount, recipesAttached }}
 */
export const runFullSeed = async (file, onProgress) => {
    const log = (msg) => {
        console.log(`[SEED] ${msg}`);
        onProgress?.(msg);
    };

    // Step 1: Clear
    log('═══ STEP 1: Clearing all data ═══');
    const totalCleared = await clearAllCollections(log);
    log(`Total documents cleared: ${totalCleared}`);

    // Step 2: Parse Excel
    log('═══ STEP 2: Parsing Excel file ═══');
    const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array' });
    const sheets = {};
    workbook.SheetNames.forEach(name => {
        sheets[name] = XLSX.utils.sheet_to_json(workbook.Sheets[name], { defval: '' });
    });

    const rawMeatRows = (sheets['Raw Meet'] || []).filter(r => (r['Item Name'] || '').trim());
    const cookedFoodRows = (sheets['Coocked Food'] || []).filter(r => (r['Item Name'] || '').trim());
    const groceryRows = (sheets['Groceries'] || []).filter(r => (r['Item Name'] || '').trim());

    log(`  Parsed: ${rawMeatRows.length} raw meat, ${cookedFoodRows.length} cooked food, ${groceryRows.length} groceries`);

    // Step 3: Create categories
    log('═══ STEP 3: Creating categories ═══');
    const categoriesByType = {
        raw_meat: [...new Set(rawMeatRows.map(r => (r['Category'] || 'other').trim()))],
        cooked_meat: [...new Set(cookedFoodRows.map(r => (r['Category'] || 'other').trim()))],
        grocery: [...new Set(groceryRows.map(r => (r['Category'] || '').trim()).filter(Boolean))],
    };
    const categoryMap = await seedCategories(categoriesByType, log);

    // Step 4: Seed Raw Meat
    log('═══ STEP 4: Seeding Raw Meat items ═══');
    await seedRawMeat(rawMeatRows, categoryMap, log);

    // Step 5: Seed Cooked Food
    log('═══ STEP 5: Seeding Cooked Food items ═══');
    const cookedItemIds = await seedCookedFood(cookedFoodRows, categoryMap, log);

    // Step 6: Seed Groceries
    log('═══ STEP 6: Seeding Grocery items ═══');
    await seedGroceries(groceryRows, categoryMap, log);

    // Step 7: Parse and attach batch recipes
    log('═══ STEP 7: Parsing batch recipes ═══');
    const recipes = parseBatchRecipes(workbook);
    log(`  Found ${recipes.length} recipe blocks`);
    await attachRecipesToItems(recipes, cookedItemIds, log);

    log('═══ SEED COMPLETE ═══');

    return {
        totalCleared,
        rawMeatCount: rawMeatRows.length,
        cookedFoodCount: cookedFoodRows.length,
        groceryCount: groceryRows.length,
        recipesFound: recipes.length,
    };
};
