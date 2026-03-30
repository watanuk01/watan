/**
 * Production Service — Cooked Meat Production Management
 *
 * Handles: start → in-progress → complete production batches
 * FIFO ingredient deduction ON START, cooked-meat batch creation ON COMPLETE, invoicing.
 */
import {
    collection,
    addDoc,
    getDocs,
    getDoc,
    updateDoc,
    doc,
    query,
    where,
    serverTimestamp,
    increment,
    Timestamp,
} from 'firebase/firestore';
import { db } from '../firebase';
import {
    getItems,
    getBatches,
    consumeBatch,
    addBatch,
} from './inventoryService';

const PRODUCTIONS = 'productions';
const PROD_INVOICES = 'production_invoices';
const ITEMS_COLLECTION = 'inventory_items';

// ── Status definitions ──
export const PROD_STATUSES = [
    { value: 'in_progress', label: 'In Progress', icon: '🔥', color: '#f59e0b' },
    { value: 'completed', label: 'Completed', icon: '✅', color: '#22c55e' },
    { value: 'cancelled', label: 'Cancelled', icon: '❌', color: '#ef4444' },
];

export const getStatusInfo = (status) =>
    PROD_STATUSES.find(s => s.value === status) || { label: status, icon: '❓', color: 'gray' };

// ── Generate production number ──
const generateProductionNumber = () => {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    const rand = Math.floor(100 + Math.random() * 900);
    return `PROD-${y}${m}${d}-${rand}`;
};

// ── Generate invoice number ──
const generateInvoiceNumber = () => {
    const now = new Date();
    const y = now.getFullYear();
    const counter = Math.floor(1000 + Math.random() * 9000);
    return `PROD-INV-${y}-${counter}`;
};

// ═══════════════════════════════════════════════════════
//  GET COOKED MEAT ITEMS (with recipes)
// ═══════════════════════════════════════════════════════
export const getCookedMeatItems = async () => {
    const items = await getItems({ item_type: 'cooked_meat', status: 'active' });
    return items.filter(i => i.recipe && i.recipe.ingredients && i.recipe.ingredients.length > 0);
};

// ═══════════════════════════════════════════════════════
//  SCALE RECIPE
// ═══════════════════════════════════════════════════════
export const scaleRecipe = (recipe, productionQty) => {
    const baseBatchSize = Number(recipe.base_batch_size) || 1;
    const scaleFactor = productionQty / baseBatchSize;

    return recipe.ingredients.map(ing => {
        const conv = ing.conversion_to_master || 1;
        return {
            ...ing,
            base_quantity: ing.quantity,
            scaled_sub_quantity: Number((ing.quantity * scaleFactor).toFixed(4)),
            scaled_quantity: Number((ing.quantity * conv * scaleFactor).toFixed(4)),
            scale_factor: scaleFactor,
        };
    });
};

// ═══════════════════════════════════════════════════════
//  CHECK INGREDIENT AVAILABILITY
//  Handles both batch-tracked items (raw_meat) and
//  non-batch items (grocery) which use current_stock.
// ═══════════════════════════════════════════════════════
export const checkIngredientAvailability = async (scaledIngredients) => {
    const results = [];

    for (const ing of scaledIngredients) {
        // Always check if the master item exists first
        const itemDoc = await getDoc(doc(db, ITEMS_COLLECTION, ing.item_id));
        const itemExists = itemDoc.exists();
        const itemData = itemExists ? itemDoc.data() : {};

        if (ing.item_type === 'raw_meat') {
            // ── Batch-tracked: sum remaining_qty from available batches ──
            const batches = await getBatches({
                item_id: ing.item_id,
                status: 'available',
            });
            // Sort by created_at ascending (FIFO)
            batches.sort((a, b) => (a.created_at || 0) - (b.created_at || 0));

            const totalAvailable = batches.reduce((sum, b) => sum + (b.remaining_qty || 0), 0);
            const sufficient = totalAvailable >= ing.scaled_quantity;

            results.push({
                ...ing,
                master_unit: itemExists ? itemData.unit : '',
                available_stock: totalAvailable,
                sufficient: sufficient && itemExists,
                missing: !itemExists,
                cost_price_per_unit: itemExists ? (Number(itemData.cost_price) || 0) : 0,
                selling_price_per_unit: itemExists ? (Number(itemData.selling_price) || 0) : 0,
                batches: batches.map(b => ({
                    id: b.id,
                    batch_number: b.batch_number,
                    remaining_qty: b.remaining_qty,
                    expiry_date: b.expiry_date,
                    cost_price: b.cost_price || b.unit_price || 0,
                })),
            });
        } else {
            // ── Grocery (non-batch): read current_stock from item document ──
            const currentStock = Number(itemData.current_stock) || 0;
            const sufficient = currentStock >= ing.scaled_quantity;

            results.push({
                ...ing,
                master_unit: itemExists ? itemData.unit : '',
                available_stock: currentStock,
                sufficient: sufficient && itemExists,
                missing: !itemExists,
                cost_price_per_unit: Number(itemData.cost_price) || 0,
                selling_price_per_unit: Number(itemData.selling_price) || 0,
                batches: [],
            });
        }
    }

    return results;
};

// ═══════════════════════════════════════════════════════
//  DEDUCT INGREDIENTS (called at Start Production)
//  - Raw Meat:  FIFO batch deduction via consumeBatch
//  - Grocery:   Direct current_stock decrement
//  Returns updated ingredients array with cost info
// ═══════════════════════════════════════════════════════
const deductIngredients = async (ingredientChecks) => {
    let totalIngredientCost = 0;
    let totalSellingPrice = 0;
    const updatedIngredients = [];

    for (const ing of ingredientChecks) {
        const requiredQty = ing.scaled_quantity;

        if (ing.item_type === 'raw_meat') {
            // ── Batch-tracked (FIFO) ──
            let remaining = requiredQty;
            const consumedBatches = [];
            let ingredientCost = 0;

            // Re-fetch fresh batches right before deduction
            const batches = await getBatches({
                item_id: ing.item_id,
                status: 'available',
            });
            batches.sort((a, b) => (a.created_at || 0) - (b.created_at || 0));

            for (const batch of batches) {
                if (remaining <= 0) break;
                const deductQty = Math.min(remaining, batch.remaining_qty);

                await consumeBatch(batch.id, deductQty, ing.item_id);

                const batchCostPerUnit = batch.cost_price || batch.unit_price || 0;
                const portionCost = deductQty * batchCostPerUnit;
                ingredientCost += portionCost;

                consumedBatches.push({
                    batch_id: batch.id,
                    batch_number: batch.batch_number,
                    quantity_used: deductQty,
                    cost_per_unit: batchCostPerUnit,
                    portion_cost: portionCost,
                });

                remaining -= deductQty;
            }

            totalIngredientCost += ingredientCost;
            // For raw meat selling price, use the item-level selling_price
            const sellingCost = requiredQty * (ing.selling_price_per_unit || 0);
            totalSellingPrice += sellingCost;

            updatedIngredients.push({
                item_id: ing.item_id,
                item_name: ing.item_name,
                item_type: ing.item_type,
                unit: ing.unit,
                master_unit: ing.master_unit || '',
                required_sub_quantity: ing.scaled_sub_quantity || ing.scaled_quantity,
                base_quantity: ing.base_quantity || ing.quantity,
                required_quantity: requiredQty,
                consumed_quantity: requiredQty - remaining,
                consumed_batches: consumedBatches,
                cost: ingredientCost,
                selling_cost: sellingCost,
            });
        } else {
            // ── Grocery (non-batch): decrement current_stock directly ──
            const unitCost = ing.cost_price_per_unit || 0;
            const unitSell = ing.selling_price_per_unit || 0;
            const ingredientCost = requiredQty * unitCost;
            const sellingCost = requiredQty * unitSell;
            totalIngredientCost += ingredientCost;
            totalSellingPrice += sellingCost;

            await updateDoc(doc(db, ITEMS_COLLECTION, ing.item_id), {
                current_stock: increment(-requiredQty),
                total_sold: increment(requiredQty),
                updated_at: serverTimestamp(),
            });

            updatedIngredients.push({
                item_id: ing.item_id,
                item_name: ing.item_name,
                item_type: ing.item_type,
                unit: ing.unit,
                master_unit: ing.master_unit || '',
                required_sub_quantity: ing.scaled_sub_quantity || ing.scaled_quantity,
                base_quantity: ing.base_quantity || ing.quantity,
                required_quantity: requiredQty,
                consumed_quantity: requiredQty,
                consumed_batches: [],
                cost: ingredientCost,
                selling_cost: sellingCost,
            });
        }
    }

    return { updatedIngredients, totalIngredientCost, totalSellingPrice };
};

// ═══════════════════════════════════════════════════════
//  RESTORE INGREDIENTS (called on Cancel)
//  Reverses the deductions made at startProduction.
// ═══════════════════════════════════════════════════════
const restoreIngredients = async (ingredients) => {
    for (const ing of ingredients) {
        if (ing.item_type === 'raw_meat' && ing.consumed_batches?.length > 0) {
            // Restore each batch's remaining_qty
            for (const cb of ing.consumed_batches) {
                const batchRef = doc(db, 'inventory_batches', cb.batch_id);
                const batchSnap = await getDoc(batchRef);
                if (batchSnap.exists()) {
                    const currentRemaining = batchSnap.data().remaining_qty || 0;
                    const newRemaining = currentRemaining + cb.quantity_used;
                    await updateDoc(batchRef, {
                        remaining_qty: newRemaining,
                        status: 'available',
                        updated_at: serverTimestamp(),
                    });
                }
                // Restore item stock
                await updateDoc(doc(db, ITEMS_COLLECTION, ing.item_id), {
                    current_stock: increment(cb.quantity_used),
                    updated_at: serverTimestamp(),
                });
            }
        } else if (ing.consumed_quantity > 0) {
            // Grocery: restore current_stock
            await updateDoc(doc(db, ITEMS_COLLECTION, ing.item_id), {
                current_stock: increment(ing.consumed_quantity),
                updated_at: serverTimestamp(),
            });
        }
    }
};

// ═══════════════════════════════════════════════════════
//  START PRODUCTION
//  ★ Now deducts ingredients immediately on start ★
// ═══════════════════════════════════════════════════════
export const startProduction = async ({
    item_id,
    item_name,
    item_unit,
    production_quantity,
    recipe,
    scaled_ingredients,
    chef_name,
    chef_id,
    notes,
}) => {
    // ── Verify ALL ingredients are sufficient before proceeding ──
    const allSufficient = scaled_ingredients.every(i => i.sufficient);
    if (!allSufficient) {
        throw new Error('Cannot start production: one or more ingredients have insufficient stock.');
    }

    // ── Deduct ingredients NOW ──
    const { updatedIngredients, totalIngredientCost, totalSellingPrice } = await deductIngredients(scaled_ingredients);

    const productionNumber = generateProductionNumber();

    const productionData = {
        production_number: productionNumber,
        item_id,
        item_name,
        item_unit: item_unit || 'kg',
        production_quantity: Number(production_quantity),
        recipe_base_batch_size: recipe.base_batch_size,
        recipe_base_batch_unit: recipe.base_batch_unit || 'kg',
        scale_factor: production_quantity / recipe.base_batch_size,
        ingredients: updatedIngredients,
        total_ingredient_cost: totalIngredientCost,
        total_selling_price: totalSellingPrice,
        status: 'in_progress',
        chef_name: chef_name || '',
        chef_id: chef_id || '',
        notes: notes || '',
        started_at: serverTimestamp(),
        completed_at: null,
        actual_output: null,
        output_batch_id: null,
        output_batch_number: null,
        invoice_id: null,
        created_at: serverTimestamp(),
        updated_at: serverTimestamp(),
    };

    const docRef = await addDoc(collection(db, PRODUCTIONS), productionData);
    return { id: docRef.id, production_number: productionNumber, ...productionData };
};

// ═══════════════════════════════════════════════════════
//  COMPLETE PRODUCTION
//  - Ingredients already deducted at start
//  - Create cooked meat batch
//  - Generate production invoice
// ═══════════════════════════════════════════════════════
export const completeProduction = async (productionId, { actual_output, completed_by }) => {
    const prodRef = doc(db, PRODUCTIONS, productionId);
    const prodSnap = await getDoc(prodRef);
    if (!prodSnap.exists()) throw new Error('Production not found');

    const production = { id: prodSnap.id, ...prodSnap.data() };
    if (production.status !== 'in_progress') throw new Error('Production is not in progress');

    const actualOutput = actual_output || production.production_quantity;
    const totalIngredientCost = production.total_ingredient_cost || 0;
    const updatedIngredients = production.ingredients || [];

    // ── Create cooked meat batch ──
    const itemDoc = await getDoc(doc(db, ITEMS_COLLECTION, production.item_id));
    const itemData = itemDoc.exists() ? itemDoc.data() : {};
    const expiryDays = itemData.default_expiry_days || 2;
    const now = new Date();
    const expiryDate = new Date(now.getTime() + expiryDays * 24 * 60 * 60 * 1000);

    const totalSellingPrice = production.total_selling_price || 0;

    const newBatch = await addBatch({
        item_id: production.item_id,
        item_name: production.item_name,
        item_type: 'cooked_meat',
        quantity: actualOutput,
        batch_number: null, // auto-generated
        manufactured_date: now,
        expiry_date: expiryDate,
        cost_price: totalIngredientCost > 0 ? Number((totalIngredientCost / actualOutput).toFixed(2)) : 0,
        selling_price: totalSellingPrice > 0 ? Number((totalSellingPrice / actualOutput).toFixed(2)) : 0,
        vendor: 'Central Kitchen',
        notes: `Produced from ${production.production_number}`,
        production_id: productionId,
        source: 'production',
        source_ingredients: updatedIngredients.map(i => ({
            item_id: i.item_id,
            item_name: i.item_name,
            consumed_quantity: i.consumed_quantity,
            unit: i.master_unit || i.unit,
            consumed_batches: i.consumed_batches,
        })),
    });

    // ── Generate invoice ──
    const invoiceNumber = generateInvoiceNumber();
    const vatRate = itemData.vat_rate || 0;
    const vatExempt = itemData.vat_exempt || false;
    const vatAmount = vatExempt ? 0 : Number((totalIngredientCost * (vatRate / 100)).toFixed(2));

    const invoiceData = {
        invoice_number: invoiceNumber,
        type: 'single_batch',
        production_id: productionId,
        production_number: production.production_number,
        production_date: now,
        item_id: production.item_id,
        item_name: production.item_name,
        quantity_produced: actualOutput,
        item_unit: production.item_unit || 'kg',
        batch_id: newBatch.id,
        batch_number: newBatch.batch_number,
        expiry_date: expiryDate,
        chef_name: production.chef_name || completed_by || '',
        ingredients: updatedIngredients.map(i => ({
            item_name: i.item_name,
            item_type: i.item_type,
            unit: i.unit,
            master_unit: i.master_unit || '',
            required_sub_quantity: i.required_sub_quantity || null,
            required_quantity: i.required_quantity,
            consumed_quantity: i.consumed_quantity,
            cost: i.cost,
            consumed_batches: i.consumed_batches,
        })),
        total_ingredient_cost: totalIngredientCost,
        vat_rate: vatRate,
        vat_exempt: vatExempt,
        vat_amount: vatAmount,
        total_with_vat: totalIngredientCost + vatAmount,
        cost_per_unit: actualOutput > 0 ? Number((totalIngredientCost / actualOutput).toFixed(2)) : 0,
        cost_per_unit_with_vat: actualOutput > 0 ? Number(((totalIngredientCost + vatAmount) / actualOutput).toFixed(2)) : 0,
        created_at: serverTimestamp(),
    };

    const invoiceRef = await addDoc(collection(db, PROD_INVOICES), invoiceData);

    // ── Update production record ──
    await updateDoc(prodRef, {
        status: 'completed',
        actual_output: actualOutput,
        output_batch_id: newBatch.id,
        output_batch_number: newBatch.batch_number,
        cost_per_unit: actualOutput > 0 ? Number((totalIngredientCost / actualOutput).toFixed(2)) : 0,
        invoice_id: invoiceRef.id,
        invoice_number: invoiceNumber,
        completed_at: serverTimestamp(),
        completed_by: completed_by || '',
        updated_at: serverTimestamp(),
    });

    return {
        production_number: production.production_number,
        batch_number: newBatch.batch_number,
        invoice_number: invoiceNumber,
        total_cost: totalIngredientCost,
        actual_output: actualOutput,
    };
};

// ═══════════════════════════════════════════════════════
//  CANCEL PRODUCTION
//  ★ Now restores deducted ingredients on cancel ★
// ═══════════════════════════════════════════════════════
export const cancelProduction = async (productionId, reason) => {
    const prodRef = doc(db, PRODUCTIONS, productionId);
    const prodSnap = await getDoc(prodRef);
    if (!prodSnap.exists()) throw new Error('Production not found');

    const production = prodSnap.data();
    if (production.status !== 'in_progress') throw new Error('Production is not in progress');

    // ── Restore ingredients that were deducted at start ──
    if (production.ingredients && production.ingredients.length > 0) {
        await restoreIngredients(production.ingredients);
    }

    await updateDoc(prodRef, {
        status: 'cancelled',
        cancel_reason: reason || '',
        cancelled_at: serverTimestamp(),
        updated_at: serverTimestamp(),
    });
};

// ═══════════════════════════════════════════════════════
//  GET PRODUCTIONS (with filters)
// ═══════════════════════════════════════════════════════
export const getProductions = async (filters = {}) => {
    let q = collection(db, PRODUCTIONS);
    const constraints = [];

    if (filters.status) constraints.push(where('status', '==', filters.status));
    if (filters.item_id) constraints.push(where('item_id', '==', filters.item_id));
    if (filters.chef_id) constraints.push(where('chef_id', '==', filters.chef_id));

    q = query(q, ...constraints);
    const snap = await getDocs(q);

    let productions = snap.docs.map(d => {
        const data = d.data();
        return {
            id: d.id,
            ...data,
            started_at: data.started_at?.toDate?.() || null,
            completed_at: data.completed_at?.toDate?.() || null,
            cancelled_at: data.cancelled_at?.toDate?.() || null,
            created_at: data.created_at?.toDate?.() || null,
        };
    });

    // Client-side date range filter
    if (filters.dateFrom) {
        const from = new Date(filters.dateFrom);
        from.setHours(0, 0, 0, 0);
        productions = productions.filter(p => p.created_at && p.created_at >= from);
    }
    if (filters.dateTo) {
        const to = new Date(filters.dateTo);
        to.setHours(23, 59, 59, 999);
        productions = productions.filter(p => p.created_at && p.created_at <= to);
    }

    // Sort by created_at descending
    productions.sort((a, b) => (b.created_at || 0) - (a.created_at || 0));

    return productions;
};

// ═══════════════════════════════════════════════════════
//  GET SINGLE PRODUCTION
// ═══════════════════════════════════════════════════════
export const getProductionById = async (id) => {
    const snap = await getDoc(doc(db, PRODUCTIONS, id));
    if (!snap.exists()) throw new Error('Production not found');
    const data = snap.data();
    return {
        id: snap.id,
        ...data,
        started_at: data.started_at?.toDate?.() || null,
        completed_at: data.completed_at?.toDate?.() || null,
        created_at: data.created_at?.toDate?.() || null,
    };
};

// ═══════════════════════════════════════════════════════
//  GET PRODUCTION INVOICES
// ═══════════════════════════════════════════════════════
export const getProductionInvoices = async (filters = {}) => {
    let q = collection(db, PROD_INVOICES);
    const constraints = [];

    if (filters.type) constraints.push(where('type', '==', filters.type));
    if (filters.item_id) constraints.push(where('item_id', '==', filters.item_id));

    q = query(q, ...constraints);
    const snap = await getDocs(q);

    let invoices = snap.docs.map(d => {
        const data = d.data();
        return {
            id: d.id,
            ...data,
            production_date: data.production_date instanceof Timestamp
                ? data.production_date.toDate()
                : data.production_date instanceof Date
                    ? data.production_date
                    : data.production_date ? new Date(data.production_date) : null,
            expiry_date: data.expiry_date instanceof Timestamp
                ? data.expiry_date.toDate()
                : data.expiry_date instanceof Date
                    ? data.expiry_date
                    : data.expiry_date ? new Date(data.expiry_date) : null,
            created_at: data.created_at?.toDate?.() || null,
        };
    });

    // Date range filter
    if (filters.dateFrom) {
        const from = new Date(filters.dateFrom);
        from.setHours(0, 0, 0, 0);
        invoices = invoices.filter(inv => inv.production_date && inv.production_date >= from);
    }
    if (filters.dateTo) {
        const to = new Date(filters.dateTo);
        to.setHours(23, 59, 59, 999);
        invoices = invoices.filter(inv => inv.production_date && inv.production_date <= to);
    }

    // Sort newest first
    invoices.sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
    return invoices;
};

// ═══════════════════════════════════════════════════════
//  GET SINGLE INVOICE
// ═══════════════════════════════════════════════════════
export const getProductionInvoiceById = async (id) => {
    const snap = await getDoc(doc(db, PROD_INVOICES, id));
    if (!snap.exists()) throw new Error('Invoice not found');
    const data = snap.data();
    return {
        id: snap.id,
        ...data,
        production_date: data.production_date instanceof Timestamp
            ? data.production_date.toDate()
            : data.production_date ? new Date(data.production_date) : null,
        created_at: data.created_at?.toDate?.() || null,
    };
};
