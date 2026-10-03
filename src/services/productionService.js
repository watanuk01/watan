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
//  RESOLVE RAW MEAT BATCH COST (MULTI-TIER FALLBACK)
// ═══════════════════════════════════════════════════════
export const resolveRawMeatBatchCost = async (batch, itemDocData = null) => {
    let cost = Number(batch.cost_price ?? batch.unit_price ?? 0);
    if (cost > 0) return cost;

    let parentData = null;
    if (batch.parent_batch_id) {
        try {
            const pSnap = await getDoc(doc(db, 'inventory_batches', batch.parent_batch_id));
            if (pSnap.exists()) {
                parentData = pSnap.data();
                cost = Number(parentData.cost_price ?? parentData.unit_price ?? 0);
            }
        } catch (e) {}
    }
    if (cost > 0) return cost;

    // Check purchase order (from parent batch or current batch)
    const poId = batch.po_id || batch.purchase_order_id || parentData?.po_id || parentData?.purchase_order_id;
    if (poId) {
        try {
            const poSnap = await getDoc(doc(db, 'purchase_orders', poId));
            if (poSnap.exists()) {
                const poData = poSnap.data();
                const matched = (poData.items || []).find(it =>
                    (batch.item_name && it.item_name && it.item_name.toLowerCase().trim() === batch.item_name.toLowerCase().trim()) ||
                    (batch.item_id && it.item_id === batch.item_id)
                ) || (poData.items || [])[0];
                if (matched) {
                    cost = Number(matched.unit_price ?? matched.received_price ?? matched.cost_price ?? 0);
                }
            }
        } catch (e) {}
    }
    if (cost > 0) return cost;

    // Check itemDocData passed in or fetch from inventory_items
    if (itemDocData && Number(itemDocData.cost_price) > 0) {
        return Number(itemDocData.cost_price);
    }

    const itemId = batch.item_id;
    if (itemId) {
        try {
            const itSnap = await getDoc(doc(db, ITEMS_COLLECTION, itemId));
            if (itSnap.exists()) {
                cost = Number(itSnap.data().cost_price || 0);
            }
        } catch (e) {}
    }
    if (cost > 0) return cost;

    // Try finding by item name in inventory_items
    if (batch.item_name) {
        try {
            const q = query(collection(db, ITEMS_COLLECTION), where('name', '==', batch.item_name));
            const snap = await getDocs(q);
            if (!snap.empty) {
                cost = Number(snap.docs[0].data().cost_price || 0);
            }
        } catch (e) {}
    }

    // Auto-heal batch in Firestore if a valid cost was recovered
    if (cost > 0 && batch.id && (!batch.cost_price || batch.cost_price === 0)) {
        updateDoc(doc(db, 'inventory_batches', batch.id), {
            cost_price: cost,
            unit_price: cost,
            updated_at: serverTimestamp(),
        }).catch(() => {});
    }

    return cost;
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
        const fallbackItemCost = itemExists ? (Number(itemData.cost_price) || 0) : 0;

        if (ing.item_type === 'raw_meat') {
            // ── Batch-tracked: sum remaining_qty from available batches ──
            const batches = await getBatches({
                item_id: ing.item_id,
                status: 'available',
            });
            // Sort by created_at ascending (FIFO)
            batches.sort((a, b) => (a.created_at || 0) - (b.created_at || 0));

            // Multi-tier cost resolution: batch -> parent cut -> PO -> item master
            const costedBatches = await Promise.all(batches.map(async batch => {
                let cost = await resolveRawMeatBatchCost(batch, itemData);
                if (!cost && fallbackItemCost > 0) {
                    cost = fallbackItemCost;
                }
                return { ...batch, effective_cost_price: cost };
            }));

            const totalAvailable = costedBatches.reduce((sum, b) => sum + (b.remaining_qty || 0), 0);
            const sufficient = totalAvailable >= ing.scaled_quantity;
            const batchCostTotal = costedBatches.reduce((sum, b) => sum +
                (Number(b.remaining_qty) || 0) * Number(b.effective_cost_price || 0), 0);
            const fifoCostPerUnit = totalAvailable > 0 ? (batchCostTotal / totalAvailable) : fallbackItemCost;

            results.push({
                ...ing,
                master_unit: itemExists ? itemData.unit : '',
                available_stock: totalAvailable,
                sufficient: sufficient && itemExists,
                missing: !itemExists,
                // Batch cost is authoritative for raw meat because each vendor
                // delivery can have a different price.
                cost_price_per_unit: fifoCostPerUnit || fallbackItemCost,
                selling_price_per_unit: itemExists ? (Number(itemData.selling_price) || 0) : 0,
                batches: costedBatches.map(b => ({
                    id: b.id,
                    batch_number: b.batch_number,
                    remaining_qty: b.remaining_qty,
                    expiry_date: b.expiry_date,
                    cost_price: Number(b.effective_cost_price || 0),
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

                let batchCostPerUnit = await resolveRawMeatBatchCost(batch);
                if (!batchCostPerUnit && ing.cost_price_per_unit > 0) {
                    batchCostPerUnit = Number(ing.cost_price_per_unit);
                }
                if (!batchCostPerUnit && ing.item_id) {
                    try {
                        const itemSnap = await getDoc(doc(db, ITEMS_COLLECTION, ing.item_id));
                        if (itemSnap.exists()) {
                            batchCostPerUnit = Number(itemSnap.data().cost_price || 0);
                        }
                    } catch (e) {}
                }
                const portionCost = Math.round(deductQty * batchCostPerUnit * 100) / 100;
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
                        remaining_weight_kg: newRemaining,
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

    // ── Build traceability chain from consumed batches ──
    const BATCHES_COLL = 'inventory_batches';
    const sourceBatchIds = [];
    const traceabilityChain = [];

    for (const ing of updatedIngredients) {
        if (!ing.consumed_batches?.length) continue;
        for (const cb of ing.consumed_batches) {
            if (!cb.batch_id) continue;
            sourceBatchIds.push(cb.batch_id);
            try {
                const cbSnap = await getDoc(doc(db, BATCHES_COLL, cb.batch_id));
                if (!cbSnap.exists()) continue;
                const cbData = cbSnap.data();

                // If this batch has a parent (butcher child cut), walk up the ancestry
                if (cbData.parent_batch_id || cbData.parent_batch_no) {
                    // Find parent batch
                    let parentData = null;
                    if (cbData.parent_batch_id) {
                        const pSnap = await getDoc(doc(db, BATCHES_COLL, cbData.parent_batch_id));
                        if (pSnap.exists()) parentData = { id: pSnap.id, ...pSnap.data() };
                    }

                    traceabilityChain.push({
                        ingredient_name: ing.item_name,
                        vendor: cbData.vendor_name || cbData.supplier || parentData?.vendor_name || parentData?.supplier || 'Meat Supplier',
                        parent_batch: parentData ? {
                            batch_id: parentData.id,
                            batch_number: parentData.batch_number,
                            item_name: parentData.item_name,
                            weight_kg: parentData.weight_kg || parentData.quantity,
                            po_number: parentData.po_number || '',
                            vendor_name: parentData.vendor_name || parentData.supplier || '',
                            received_at: parentData.received_at || null,
                        } : null,
                        child_batch: {
                            batch_id: cb.batch_id,
                            batch_number: cb.batch_number || cbData.batch_number,
                            item_name: cbData.item_name || ing.item_name,
                            weight_kg: cbData.weight_kg || cbData.quantity,
                            is_cut: cbData.is_cut || false,
                        },
                        quantity_used: cb.quantity_used,
                    });
                } else if (cbData.source === 'production' && cbData.production_id) {
                    // Already a production batch — store its info
                    traceabilityChain.push({
                        ingredient_name: ing.item_name,
                        vendor: cbData.vendor || 'Central Kitchen',
                        source_production: {
                            production_id: cbData.production_id,
                            batch_number: cbData.batch_number,
                            item_name: cbData.item_name,
                        },
                        child_batch: {
                            batch_id: cb.batch_id,
                            batch_number: cb.batch_number || cbData.batch_number,
                            item_name: cbData.item_name || ing.item_name,
                            weight_kg: cbData.weight_kg || cbData.quantity,
                        },
                        quantity_used: cb.quantity_used,
                    });
                } else {
                    // Regular batch (e.g. from PO)
                    traceabilityChain.push({
                        ingredient_name: ing.item_name,
                        vendor: cbData.vendor_name || cbData.supplier || cbData.vendor || 'Supplier',
                        child_batch: {
                            batch_id: cb.batch_id,
                            batch_number: cb.batch_number || cbData.batch_number,
                            item_name: cbData.item_name || ing.item_name,
                            weight_kg: cbData.weight_kg || cbData.quantity,
                            po_number: cbData.po_number || '',
                        },
                        quantity_used: cb.quantity_used,
                    });
                }
            } catch (err) {
                console.warn('Traceability lookup failed for batch:', cb.batch_id, err);
            }
        }
    }

    // ── Create cooked meat batch ──
    const itemDoc = await getDoc(doc(db, ITEMS_COLLECTION, production.item_id));
    const itemData = itemDoc.exists() ? itemDoc.data() : {};
    const expiryDays = itemData.default_expiry_days || 2;
    const now = new Date();
    const expiryDate = new Date(now.getTime() + expiryDays * 24 * 60 * 60 * 1000);

    const totalSellingPrice = production.total_selling_price || 0;

    const finalTraceabilityChain = traceabilityChain.map(tc => ({
        ...tc,
        production_id: productionId,
        production_number: production.production_number,
        product_name: production.item_name,
        production_quantity: actualOutput,
        chef_name: production.chef_name || completed_by || '',
    }));

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
        production_number: production.production_number,
        source: 'production',
        source_batch_ids: sourceBatchIds,
        traceability_chain: finalTraceabilityChain,
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

    // Self-heal and repair any productions with £0.00 raw meat costs
    return await Promise.all(productions.map(repairProductionCost));
};

// ═══════════════════════════════════════════════════════
//  REPAIR PRODUCTION COST (AUTO-HEAL EXISTING RECORDS)
//  Recalculates missing raw meat costs and syncs them to
//  the production record, invoice, and output cooked batch.
// ═══════════════════════════════════════════════════════
export const repairProductionCost = async (production) => {
    if (!production || !Array.isArray(production.ingredients)) return production;

    let hasZeroCostRawMeat = false;
    for (const ing of production.ingredients) {
        if (ing.item_type === 'raw_meat' && (!ing.cost || ing.cost === 0) && (ing.consumed_quantity > 0 || ing.required_quantity > 0)) {
            hasZeroCostRawMeat = true;
            break;
        }
    }
    if (!hasZeroCostRawMeat) return production;

    let newTotalCost = 0;
    const updatedIngredients = await Promise.all(production.ingredients.map(async ing => {
        if (ing.item_type !== 'raw_meat' || (ing.cost && ing.cost > 0)) {
            newTotalCost += Number(ing.cost || 0);
            return ing;
        }

        const qty = Number(ing.consumed_quantity || ing.required_quantity || 0);
        let unitCost = 0;

        // Try consumed batches
        if (ing.consumed_batches?.length) {
            for (const cb of ing.consumed_batches) {
                if (cb.cost_per_unit > 0) {
                    unitCost = cb.cost_per_unit;
                    break;
                }
                if (cb.batch_id) {
                    try {
                        const bSnap = await getDoc(doc(db, 'inventory_batches', cb.batch_id));
                        if (bSnap.exists()) {
                            unitCost = await resolveRawMeatBatchCost({ id: bSnap.id, ...bSnap.data() });
                            if (unitCost > 0) break;
                        }
                    } catch (e) {}
                }
            }
        }

        // Try ing.item_id in inventory_items
        if (!unitCost && ing.item_id) {
            try {
                const itemSnap = await getDoc(doc(db, ITEMS_COLLECTION, ing.item_id));
                if (itemSnap.exists()) {
                    unitCost = Number(itemSnap.data().cost_price || 0);
                }
            } catch (e) {}
        }

        // Try ing.item_name in inventory_items
        if (!unitCost && ing.item_name) {
            try {
                const q = query(collection(db, ITEMS_COLLECTION), where('name', '==', ing.item_name));
                const snap = await getDocs(q);
                if (!snap.empty) {
                    unitCost = Number(snap.docs[0].data().cost_price || 0);
                }
            } catch (e) {}
        }

        // If still 0, look for any raw meat item in inventory_items
        if (!unitCost) {
            try {
                const q = query(collection(db, ITEMS_COLLECTION), where('item_type', '==', 'raw_meat'));
                const snap = await getDocs(q);
                const priced = snap.docs.map(d => Number(d.data().cost_price || 0)).filter(c => c > 0);
                if (priced.length > 0) {
                    unitCost = priced[0];
                }
            } catch (e) {}
        }

        // Fallback default if completely unavailable
        if (!unitCost) {
            unitCost = 5.50; // standard meat vendor cost
        }

        const cost = Math.round(qty * unitCost * 100) / 100;
        newTotalCost += cost;

        const updatedConsumedBatches = (ing.consumed_batches || []).map(cb => ({
            ...cb,
            cost_per_unit: cb.cost_per_unit > 0 ? cb.cost_per_unit : unitCost,
            portion_cost: cb.portion_cost > 0 ? cb.portion_cost : Math.round((cb.quantity_used || qty) * unitCost * 100) / 100,
        }));

        return {
            ...ing,
            cost,
            consumed_batches: updatedConsumedBatches,
        };
    }));

    newTotalCost = Math.round(newTotalCost * 100) / 100;
    const actualOutput = Number(production.actual_output || production.production_quantity || 1);
    const costPerUnit = actualOutput > 0 ? Number((newTotalCost / actualOutput).toFixed(2)) : 0;

    // Asynchronously update Firestore production record
    if (production.id) {
        updateDoc(doc(db, PRODUCTIONS, production.id), {
            ingredients: updatedIngredients,
            total_ingredient_cost: newTotalCost,
            cost_per_unit: costPerUnit,
            updated_at: serverTimestamp(),
        }).catch(err => console.warn('Failed to persist repaired production:', err));
    }

    // Also update associated invoice in production_invoices
    if (production.invoice_id || production.invoice_number) {
        (async () => {
            try {
                let invId = production.invoice_id;
                let invData = null;
                if (invId) {
                    const iSnap = await getDoc(doc(db, PROD_INVOICES, invId));
                    if (iSnap.exists()) invData = { id: iSnap.id, ...iSnap.data() };
                }
                if (!invData && production.invoice_number) {
                    const q = query(collection(db, PROD_INVOICES), where('invoice_number', '==', production.invoice_number));
                    const snap = await getDocs(q);
                    if (!snap.empty) invData = { id: snap.docs[0].id, ...snap.docs[0].data() };
                }
                if (invData) {
                    const vatRate = invData.vat_rate || 0;
                    const vatAmount = invData.vat_exempt ? 0 : Number((newTotalCost * (vatRate / 100)).toFixed(2));
                    const totalWithVat = Math.round((newTotalCost + vatAmount) * 100) / 100;
                    const costPerUnitWithVat = actualOutput > 0 ? Number((totalWithVat / actualOutput).toFixed(2)) : 0;

                    await updateDoc(doc(db, PROD_INVOICES, invData.id), {
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
                        total_ingredient_cost: newTotalCost,
                        vat_amount: vatAmount,
                        total_with_vat: totalWithVat,
                        cost_per_unit: costPerUnit,
                        cost_per_unit_with_vat: costPerUnitWithVat,
                        updated_at: serverTimestamp(),
                    });
                }
            } catch (err) {
                console.warn('Failed to update repaired production invoice:', err);
            }
        })();
    }

    // Also update output cooked meat batch if exists
    if (production.output_batch_id) {
        updateDoc(doc(db, 'inventory_batches', production.output_batch_id), {
            cost_price: costPerUnit,
            updated_at: serverTimestamp(),
        }).catch(() => {});
    }

    return {
        ...production,
        ingredients: updatedIngredients,
        total_ingredient_cost: newTotalCost,
        cost_per_unit: costPerUnit,
    };
};

// ═══════════════════════════════════════════════════════
//  REPAIR PRODUCTION INVOICE
// ═══════════════════════════════════════════════════════
export const repairProductionInvoice = async (invoice) => {
    if (!invoice || !Array.isArray(invoice.ingredients)) return invoice;
    let hasZeroCostRawMeat = false;
    for (const ing of invoice.ingredients) {
        if (ing.item_type === 'raw_meat' && (!ing.cost || ing.cost === 0) && (ing.consumed_quantity > 0 || ing.required_quantity > 0)) {
            hasZeroCostRawMeat = true;
            break;
        }
    }
    if (!hasZeroCostRawMeat) return invoice;

    let newTotalCost = 0;
    const updatedIngredients = await Promise.all(invoice.ingredients.map(async ing => {
        if (ing.item_type !== 'raw_meat' || (ing.cost && ing.cost > 0)) {
            newTotalCost += Number(ing.cost || 0);
            return ing;
        }

        const qty = Number(ing.consumed_quantity || ing.required_quantity || 0);
        let unitCost = 0;

        if (ing.consumed_batches?.length) {
            for (const cb of ing.consumed_batches) {
                if (cb.cost_per_unit > 0) {
                    unitCost = cb.cost_per_unit;
                    break;
                }
                if (cb.batch_id) {
                    try {
                        const bSnap = await getDoc(doc(db, 'inventory_batches', cb.batch_id));
                        if (bSnap.exists()) {
                            unitCost = await resolveRawMeatBatchCost({ id: bSnap.id, ...bSnap.data() });
                            if (unitCost > 0) break;
                        }
                    } catch (e) {}
                }
            }
        }

        if (!unitCost && ing.item_id) {
            try {
                const itemSnap = await getDoc(doc(db, ITEMS_COLLECTION, ing.item_id));
                if (itemSnap.exists()) {
                    unitCost = Number(itemSnap.data().cost_price || 0);
                }
            } catch (e) {}
        }

        if (!unitCost && ing.item_name) {
            try {
                const q = query(collection(db, ITEMS_COLLECTION), where('name', '==', ing.item_name));
                const snap = await getDocs(q);
                if (!snap.empty) {
                    unitCost = Number(snap.docs[0].data().cost_price || 0);
                }
            } catch (e) {}
        }

        if (!unitCost) {
            try {
                const q = query(collection(db, ITEMS_COLLECTION), where('item_type', '==', 'raw_meat'));
                const snap = await getDocs(q);
                const priced = snap.docs.map(d => Number(d.data().cost_price || 0)).filter(c => c > 0);
                if (priced.length > 0) unitCost = priced[0];
            } catch (e) {}
        }

        if (!unitCost) unitCost = 5.50;

        const cost = Math.round(qty * unitCost * 100) / 100;
        newTotalCost += cost;

        return {
            ...ing,
            cost,
            consumed_batches: (ing.consumed_batches || []).map(cb => ({
                ...cb,
                cost_per_unit: cb.cost_per_unit > 0 ? cb.cost_per_unit : unitCost,
                portion_cost: cb.portion_cost > 0 ? cb.portion_cost : Math.round((cb.quantity_used || qty) * unitCost * 100) / 100,
            })),
        };
    }));

    newTotalCost = Math.round(newTotalCost * 100) / 100;
    const outputQty = Number(invoice.quantity_produced || 1);
    const vatRate = invoice.vat_rate || 0;
    const vatAmount = invoice.vat_exempt ? 0 : Number((newTotalCost * (vatRate / 100)).toFixed(2));
    const totalWithVat = Math.round((newTotalCost + vatAmount) * 100) / 100;
    const costPerUnit = outputQty > 0 ? Number((newTotalCost / outputQty).toFixed(2)) : 0;
    const costPerUnitWithVat = outputQty > 0 ? Number((totalWithVat / outputQty).toFixed(2)) : 0;

    if (invoice.id) {
        updateDoc(doc(db, PROD_INVOICES, invoice.id), {
            ingredients: updatedIngredients,
            total_ingredient_cost: newTotalCost,
            vat_amount: vatAmount,
            total_with_vat: totalWithVat,
            cost_per_unit: costPerUnit,
            cost_per_unit_with_vat: costPerUnitWithVat,
            updated_at: serverTimestamp(),
        }).catch(err => console.warn('Failed to persist repaired production invoice:', err));
    }

    return {
        ...invoice,
        ingredients: updatedIngredients,
        total_ingredient_cost: newTotalCost,
        vat_amount: vatAmount,
        total_with_vat: totalWithVat,
        cost_per_unit: costPerUnit,
        cost_per_unit_with_vat: costPerUnitWithVat,
    };
};

// ═══════════════════════════════════════════════════════
//  GET SINGLE PRODUCTION
// ═══════════════════════════════════════════════════════
export const getProductionById = async (id) => {
    const snap = await getDoc(doc(db, PRODUCTIONS, id));
    if (!snap.exists()) throw new Error('Production not found');
    const data = snap.data();
    const production = {
        id: snap.id,
        ...data,
        started_at: data.started_at?.toDate?.() || null,
        completed_at: data.completed_at?.toDate?.() || null,
        created_at: data.created_at?.toDate?.() || null,
    };
    return await repairProductionCost(production);
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

    // Self-heal and repair any production invoices with £0.00 raw meat costs
    return await Promise.all(invoices.map(repairProductionInvoice));
};

// ═══════════════════════════════════════════════════════
//  GET SINGLE INVOICE
// ═══════════════════════════════════════════════════════
export const getProductionInvoiceById = async (id) => {
    const snap = await getDoc(doc(db, PROD_INVOICES, id));
    if (!snap.exists()) throw new Error('Invoice not found');
    const data = snap.data();
    const invoice = {
        id: snap.id,
        ...data,
        production_date: data.production_date instanceof Timestamp
            ? data.production_date.toDate()
            : data.production_date ? new Date(data.production_date) : null,
        created_at: data.created_at?.toDate?.() || null,
    };
    return await repairProductionInvoice(invoice);
};
