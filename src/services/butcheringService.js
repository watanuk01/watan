/**
 * Butchering & Traceability Service — Firestore CRUD for Butchering Module
 *
 * Collections:
 *   cut_types           — Cut master definitions (e.g. Lamb Chops, Chicken Wings)
 *   butchering_orders   — Butchering processing orders (Parent -> Child batches)
 *   inventory_batches   — Extended with parent_batch_id, is_cut, qr_code_data
 *   purchase_orders     — Meat POs created by butcher
 */

import {
    collection,
    doc,
    getDocs,
    addDoc,
    updateDoc,
    deleteDoc,
    query,
    where,
    serverTimestamp,
    writeBatch,
} from 'firebase/firestore';
import { db } from '../firebase';

// ─── COLLECTIONS ───
const CUT_TYPES = 'cut_types';
const BUTCHERING_ORDERS = 'butchering_orders';
const BATCHES = 'inventory_batches';
const ITEMS = 'inventory_items';
const PURCHASE_ORDERS = 'purchase_orders';

// ─── DEFAULT SEED CUT TYPES ───
export const DEFAULT_CUT_TYPES = [
    // Lamb Cuts
    { name: 'Lamb Legs', animal_type: 'Lamb', std_weight_kg: 5.0, shelf_life_days: 7, storage: 'Chiller', is_waste: false },
    { name: 'Lamb Chops', animal_type: 'Lamb', std_weight_kg: 3.5, shelf_life_days: 5, storage: 'Chiller', is_waste: false },
    { name: 'Lamb Ribs', animal_type: 'Lamb', std_weight_kg: 3.0, shelf_life_days: 5, storage: 'Chiller', is_waste: false },
    { name: 'Lamb Shanks', animal_type: 'Lamb', std_weight_kg: 4.0, shelf_life_days: 7, storage: 'Chiller', is_waste: false },
    { name: 'Lamb Mince', animal_type: 'Lamb', std_weight_kg: 2.5, shelf_life_days: 3, storage: 'Chiller', is_waste: false },
    { name: 'Lamb Bones & Trim (Waste)', animal_type: 'Lamb', std_weight_kg: 2.0, shelf_life_days: 2, storage: 'Ambient', is_waste: true },

    // Chicken Cuts
    { name: 'Chicken Wings', animal_type: 'Chicken', std_weight_kg: 1.2, shelf_life_days: 5, storage: 'Chiller', is_waste: false },
    { name: 'Chicken Legs', animal_type: 'Chicken', std_weight_kg: 3.0, shelf_life_days: 5, storage: 'Chiller', is_waste: false },
    { name: 'Chicken Breast', animal_type: 'Chicken', std_weight_kg: 2.5, shelf_life_days: 5, storage: 'Chiller', is_waste: false },
    { name: 'Chicken Thighs', animal_type: 'Chicken', std_weight_kg: 2.0, shelf_life_days: 5, storage: 'Chiller', is_waste: false },
    { name: 'Chicken Bones & Waste', animal_type: 'Chicken', std_weight_kg: 0.8, shelf_life_days: 2, storage: 'Ambient', is_waste: true },

    // Beef Cuts
    { name: 'Beef Rump', animal_type: 'Beef', std_weight_kg: 8.0, shelf_life_days: 10, storage: 'Chiller', is_waste: false },
    { name: 'Beef Mince', animal_type: 'Beef', std_weight_kg: 4.0, shelf_life_days: 4, storage: 'Chiller', is_waste: false },
    { name: 'Beef Fat & Waste', animal_type: 'Beef', std_weight_kg: 3.0, shelf_life_days: 2, storage: 'Ambient', is_waste: true },

    // Mutton Cuts
    { name: 'Mutton Fillet', animal_type: 'Mutton', std_weight_kg: 4.0, shelf_life_days: 7, storage: 'Chiller', is_waste: false },
    { name: 'Mutton Legs', animal_type: 'Mutton', std_weight_kg: 5.5, shelf_life_days: 7, storage: 'Chiller', is_waste: false },
    { name: 'Mutton Chops', animal_type: 'Mutton', std_weight_kg: 3.5, shelf_life_days: 5, storage: 'Chiller', is_waste: false },
    { name: 'Mutton Mince', animal_type: 'Mutton', std_weight_kg: 3.0, shelf_life_days: 4, storage: 'Chiller', is_waste: false },
    { name: 'Mutton Bones & Trim (Waste)', animal_type: 'Mutton', std_weight_kg: 2.5, shelf_life_days: 2, storage: 'Ambient', is_waste: true },

    // Goat Cuts
    { name: 'Goat Leg', animal_type: 'Goat', std_weight_kg: 4.5, shelf_life_days: 7, storage: 'Chiller', is_waste: false },
    { name: 'Goat Shoulder', animal_type: 'Goat', std_weight_kg: 4.0, shelf_life_days: 7, storage: 'Chiller', is_waste: false },
    { name: 'Goat Mince', animal_type: 'Goat', std_weight_kg: 2.5, shelf_life_days: 4, storage: 'Chiller', is_waste: false },
    { name: 'Goat Bones & Trim (Waste)', animal_type: 'Goat', std_weight_kg: 2.0, shelf_life_days: 2, storage: 'Ambient', is_waste: true },

    // Seafood Cuts
    { name: 'Prawns Peeled', animal_type: 'Seafood', std_weight_kg: 2.0, shelf_life_days: 3, storage: 'Freezer', is_waste: false },
    { name: 'Prawns Shell-On', animal_type: 'Seafood', std_weight_kg: 3.0, shelf_life_days: 3, storage: 'Freezer', is_waste: false },
    { name: 'Fish Fillet', animal_type: 'Seafood', std_weight_kg: 2.5, shelf_life_days: 3, storage: 'Chiller', is_waste: false },
    { name: 'Fish Portions', animal_type: 'Seafood', std_weight_kg: 2.0, shelf_life_days: 3, storage: 'Chiller', is_waste: false },
    { name: 'Seafood Shell & Waste', animal_type: 'Seafood', std_weight_kg: 1.5, shelf_life_days: 1, storage: 'Ambient', is_waste: true },
];

// ═══════════════════════════════════════════
// 1. CUT TYPES MASTER CRUD
// ═══════════════════════════════════════════

/** Seed default cut types if collection is empty */
export const seedCutTypesIfEmpty = async () => {
    try {
        const snap = await getDocs(collection(db, CUT_TYPES));
        if (snap.empty) {
            console.log('🥩 Seeding default Cut Types master...');
            for (const cut of DEFAULT_CUT_TYPES) {
                await addDoc(collection(db, CUT_TYPES), {
                    ...cut,
                    created_at: serverTimestamp(),
                });
            }
        }
    } catch (err) {
        console.error('Error seeding cut types:', err);
    }
};

/** Get all Cut Types */
export const getCutTypes = async () => {
    await seedCutTypesIfEmpty();
    try {
        const snap = await getDocs(collection(db, CUT_TYPES));
        //get all the documents from firestore map it to an array every object in array has its own id and data field [{},{}]
        const list = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        //sort by animal name
        return list.sort((a, b) => (a.animal_type || '').localeCompare(b.animal_type || ''));
    } catch (err) {
        console.error('Error fetching cut types:', err);
        return DEFAULT_CUT_TYPES.map((c, i) => ({ id: `default-${i}`, ...c }));
    }
};

/** Create a new Cut Type for admin cut types */
export const createCutType = async (data) => {
    const docRef = await addDoc(collection(db, CUT_TYPES), {
        ...data,
        std_weight_kg: Number(data.std_weight_kg) || 0,
        shelf_life_days: Number(data.shelf_life_days) || 3,
        is_waste: Boolean(data.is_waste),
        created_at: serverTimestamp(),
    });
    return { id: docRef.id, ...data };
};

/** Update Cut Type for admin cut types */
export const updateCutType = async (id, data) => {
    await updateDoc(doc(db, CUT_TYPES, id), {
        ...data,
        std_weight_kg: Number(data.std_weight_kg) || 0,
        shelf_life_days: Number(data.shelf_life_days) || 3,
        is_waste: Boolean(data.is_waste),
        updated_at: serverTimestamp(),
    });
};

/** Delete Cut Type for admin cut types */
export const deleteCutType = async (id) => {
    await deleteDoc(doc(db, CUT_TYPES, id));
};

// ═══════════════════════════════════════════
// 2. BUTCHERING ORDERS & BATCH SPLITTING
// ═══════════════════════════════════════════

/** Get parent batches available for butchering (raw_meat, whole animals) */
export const getUnbutcheredBatches = async () => {
    try {
        const snap = await getDocs(collection(db, BATCHES));
        const allBatches = snap.docs.map(d => ({ id: d.id, ...d.data() }));

        // Filter batches that are raw_meat or whole animals, not depleted, and not already cut
        return allBatches.filter(b => {
            //might become issue suggestions:
            //const isParentBatch =b.is_cut !== true &&!b.parent_batch_id;
            //and ideally use an explicit field such as:
            //b.batch_stage: 'whole'
            //or:
            //b.is_parent_batch: true
            const isMeat = (b.item_type === 'raw_meat' || b.item_name?.toLowerCase().includes('whole') || b.category?.toLowerCase().includes('meat'));
            const hasStock = (Number(b.quantity || b.remaining_weight_kg || b.initial_quantity) > 0);
            // //might become issue suggestions:
            //const isNotChild =b.is_cut !== true &&!b.parent_batch_id;
            const isNotChild = !b.parent_batch_id;
            const notFullyButchered = b.butchered_status !== 'completed';
            return isMeat && hasStock && isNotChild && notFullyButchered;
        });
    } catch (err) {
        console.error('Error fetching unbutchered batches:', err);
        return [];
    }
};

/** Create a new Butchering Order and generate child batches */
export const createButcheringOrder = async (orderData) => {
    const {
        sourceBatch,      // object of parent batch
        butcherName,
        date,
        cuts,             // array of { cut_type_id, cut_name, weight_kg, is_waste, child_batch_no }
        notes,
    } = orderData;

    if (!sourceBatch || !cuts?.length) {
        throw new Error('Source batch and at least one cut output are required');
    }

    const inputWeight = Number(sourceBatch.weight_kg || sourceBatch.quantity || sourceBatch.initial_quantity) || 0;
    const totalOutputWeight = cuts.filter(c => !c.is_waste).reduce((sum, c) => sum + (Number(c.weight_kg) || 0), 0);
    const wasteWeight = cuts.filter(c => c.is_waste).reduce((sum, c) => sum + (Number(c.weight_kg) || 0), 0);
    const totalProcessed = totalOutputWeight + wasteWeight;
    const yieldPct = inputWeight > 0 ? Math.round((totalOutputWeight / inputWeight) * 1000) / 10 : 0;

    // Generate Butchering Order Number e.g. BUT-260807-001
    const dateCode = new Date().toISOString().substring(2, 10).replace(/-/g, '');
    const randomSeq = Math.floor(100 + Math.random() * 900);
    const orderNo = `BUT-${dateCode}-${randomSeq}`;

    const batchRef = writeBatch(db);

    // 1. Create Butchering Order document
    const orderRef = doc(collection(db, BUTCHERING_ORDERS));
    const childBatchDocs = [];

    // 2. Create Child Batches in inventory_batches
    const childBatchIds = [];
    const parentBatchNo = sourceBatch.batch_number || sourceBatch.id;

    for (let i = 0; i < cuts.length; i++) {
        const cut = cuts[i];
        const childRef = doc(collection(db, BATCHES));
        const cutCode = (cut.cut_name || 'CUT').replace(/[^a-zA-Z0-9]/g, '').substring(0, 4).toUpperCase();
        const childBatchNo = cut.child_batch_no || `${parentBatchNo}-${cutCode}-${i + 1}`;

        const expiryDate = new Date();
        expiryDate.setDate(expiryDate.getDate() + (Number(cut.shelf_life_days) || 5));

        const childData = {
            batch_number: childBatchNo,
            item_name: `${cut.cut_name} (${sourceBatch.item_name || 'Meat'})`,
            item_type: 'raw_meat',
            category: 'Raw Meat',
            cut_name: cut.cut_name,
            quantity: Number(cut.weight_kg) || 0,
            remaining_weight_kg: Number(cut.weight_kg) || 0,
            unit: 'kg',
            parent_batch_id: sourceBatch.id,
            parent_batch_no: parentBatchNo,
            vendor_name: sourceBatch.vendor_name || sourceBatch.supplier || 'Vendor Delivery',
            received_at: sourceBatch.received_at || sourceBatch.created_at || new Date().toISOString(),
            expiry_date: expiryDate.toISOString().substring(0, 10),
            created_at: serverTimestamp(),
            is_cut: true,
            is_waste: Boolean(cut.is_waste),
            butcher_name: butcherName || 'Central Kitchen Butcher',
            qr_code_data: [
                `WATAN CENTRAL KITCHEN`,
                `─── BATCH TRACEABILITY ───`,
                `Batch: ${childBatchNo}`,
                `Product: ${cut.cut_name}`,
                `Weight: ${cut.weight_kg} kg`,
                `Type: ${cut.is_waste ? 'Waste/Bones' : 'Usable Cut'}`,
                ``,
                `─── GENEALOGY FLOW ───`,
                `Vendor: ${sourceBatch.vendor_name || sourceBatch.supplier || 'Meat Supplier'}`,
                `  ↓`,
                `Parent Batch: ${parentBatchNo}`,
                `Parent Product: ${sourceBatch.item_name || 'Whole Carcass'}`,
                `Parent Weight: ${inputWeight} kg`,
                `  ↓`,
                `Butchering Order: ${orderNo}`,
                `Butcher: ${butcherName || 'Central Kitchen Butcher'}`,
                `Date: ${date || new Date().toISOString().substring(0, 10)}`,
                `Yield: ${yieldPct}%`,
                `  ↓`,
                `This Cut: ${childBatchNo}`,
                `Cut: ${cut.cut_name} — ${cut.weight_kg} kg`,
                ``,
                `Expiry: ${expiryDate.toISOString().substring(0, 10)}`,
            ].join('\n'),
        };

        batchRef.set(childRef, childData);
        childBatchIds.push(childRef.id);
        childBatchDocs.push({ id: childRef.id, ...childData });
    }

    // 3. Mark/Deduct Parent Batch
    const parentDocRef = doc(db, BATCHES, sourceBatch.id);
    batchRef.update(parentDocRef, {
        quantity: Math.max(0, inputWeight - totalProcessed),
        remaining_weight_kg: Math.max(0, inputWeight - totalProcessed),
        butchered_status: 'completed',
        butchered_at: serverTimestamp(),
        child_batch_ids: childBatchIds,
    });

    // 4. Save Order
    const butcheringDocData = {
        order_no: orderNo,
        source_batch_id: sourceBatch.id,
        source_batch_no: parentBatchNo,
        source_product: sourceBatch.item_name || 'Whole Animal',
        input_weight_kg: inputWeight,
        output_weight_kg: totalOutputWeight,
        waste_weight_kg: wasteWeight,
        yield_pct: yieldPct,
        butcher_name: butcherName || 'Central Kitchen Butcher',
        date: date || new Date().toISOString().substring(0, 10),
        status: 'completed',
        child_batch_ids: childBatchIds,
        cuts_detail: cuts,
        notes: notes || '',
        created_at: serverTimestamp(),
    };

    batchRef.set(orderRef, butcheringDocData);

    await batchRef.commit();

    return {
        id: orderRef.id,
        ...butcheringDocData,
        child_batches: childBatchDocs,
    };
};

/** Get Butchering Orders history */
export const getButcheringOrders = async () => {
    try {
        const snap = await getDocs(collection(db, BUTCHERING_ORDERS));
        const list = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        return list.sort((a, b) => {
            const tA = a.created_at?.seconds || new Date(a.date || 0).getTime();
            const tB = b.created_at?.seconds || new Date(b.date || 0).getTime();
            return tB - tA;
        });
    } catch (err) {
        console.error('Error fetching butchering orders:', err);
        return [];
    }
};

// ═══════════════════════════════════════════
// 3. BATCH TRACEABILITY & GENEALOGY TREE
// ═══════════════════════════════════════════

/**
 * Fetch full forward & backward genealogy for a batch number or batch ID.
 * Returns a recursive tree node: { type, name, batch_number, quantity, date, info, children[] }
 */
export const getBatchGenealogyTree = async (searchTerm) => {
    if (!searchTerm) return null;
    const term = searchTerm.trim().toLowerCase();

    try {
        const [batchesSnap, prodSnap, ordersSnap] = await Promise.all([
            getDocs(collection(db, BATCHES)).catch(() => ({ docs: [] })),
            getDocs(collection(db, 'production_logs')).catch(() => ({ docs: [] })),
            getDocs(collection(db, 'restaurant_orders')).catch(() => ({ docs: [] })),
        ]);

        const allBatches = batchesSnap.docs.map(d => ({ id: d.id, ...d.data() }));
        const allProds = prodSnap.docs.map(d => ({ id: d.id, ...d.data() }));
        const allOrders = ordersSnap.docs.map(d => ({ id: d.id, ...d.data() }));

        // Find target batch
        const target = allBatches.find(b =>
            (b.batch_number || '').toLowerCase() === term ||
            (b.id || '').toLowerCase() === term ||
            (b.item_name || '').toLowerCase().includes(term)
        );

        if (!target) return null;

        // Find parent batch
        let parentBatch = null;
        if (target.parent_batch_id || target.parent_batch_no) {
            parentBatch = allBatches.find(b =>
                b.id === target.parent_batch_id ||
                b.batch_number === target.parent_batch_no
            );
        }

        // Find child cut batches
        const childCuts = allBatches.filter(b =>
            b.parent_batch_id === target.id ||
            b.parent_batch_no === target.batch_number
        );

        // Productions that used this batch
        const productions = allProds.filter(p => {
            const used = p.used_batches || p.ingredients || [];
            return used.some(b =>
                b.batch_id === target.id ||
                b.batch_number === target.batch_number
            );
        });

        // Restaurant orders that contain this batch
        const deliveries = allOrders.filter(o => {
            const items = o.items || [];
            return items.some(i =>
                i.batch_id === target.id ||
                i.batch_number === target.batch_number
            );
        });

        // Build vendor node
        const vendorNode = {
            type: 'vendor',
            name: target.vendor_name || target.supplier || (parentBatch?.vendor_name) || 'Meat Supplier',
            info: 'Supplier / Vendor Delivery',
            children: [],
        };

        // Build parent batch node (if exists, it wraps the target)
        const buildTargetNode = () => {
            // Child cut nodes
            const cutNodes = childCuts.map(cut => {
                const prodNodes = productions
                    .filter(p => (p.used_batches || p.ingredients || []).some(b => b.batch_number === cut.batch_number))
                    .map(p => ({
                        type: 'production',
                        name: p.product_name || p.recipe_name || 'Production Run',
                        info: `Qty: ${p.quantity_produced || '?'}`,
                        date: p.production_date || p.date,
                        children: deliveries.map(o => ({
                            type: 'restaurant',
                            name: o.restaurant_name || o.branch || 'Restaurant Branch',
                            info: `Order #${o.order_number || o.id?.substring(0, 8) || '—'}`,
                            date: o.order_date || o.created_at,
                            children: [],
                        })),
                    }));

                return {
                    type: 'child',
                    name: cut.item_name || cut.cut_name || 'Cut Batch',
                    batch_number: cut.batch_number || cut.id,
                    quantity: cut.quantity || cut.remaining_weight_kg,
                    date: cut.expiry_date,
                    info: cut.is_waste ? 'Waste/Trim' : 'Usable Cut',
                    children: prodNodes,
                };
            });

            return {
                type: target.parent_batch_id ? 'parent' : 'butcher',
                name: target.item_name || 'Whole Meat Batch',
                batch_number: target.batch_number || target.id,
                quantity: target.weight_kg || target.quantity || target.initial_quantity,
                date: target.received_at ? (typeof target.received_at === 'string' ? target.received_at : undefined) : undefined,
                info: target.is_cut ? 'Processed Cut' : 'Parent Batch',
                children: cutNodes,
            };
        };

        const targetNode = buildTargetNode();

        if (parentBatch) {
            return {
                type: 'vendor',
                name: vendorNode.name,
                info: 'Supplier / Vendor Delivery',
                children: [{
                    type: 'parent',
                    name: parentBatch.item_name || 'Whole Meat',
                    batch_number: parentBatch.batch_number || parentBatch.id,
                    quantity: parentBatch.weight_kg || parentBatch.quantity,
                    info: 'Parent Batch',
                    children: [targetNode],
                }],
            };
        }

        return {
            type: 'vendor',
            name: vendorNode.name,
            info: 'Supplier / Vendor Delivery',
            children: [targetNode],
        };
    } catch (err) {
        console.error('Error fetching batch genealogy:', err);
        return null;
    }
};

// ═══════════════════════════════════════════
// 4. BUTCHER PURCHASE ORDER
// ═══════════════════════════════════════════

/** Create a Meat-specific Purchase Order for Butchering */
export const createButcherPurchaseOrder = async (poData) => {
    const poNumber = poData.po_number || `MPO-${new Date().toISOString().substring(2, 10).replace(/-/g, '')}-${Math.floor(100 + Math.random() * 900)}`;
    const vendorName = poData.vendor || poData.vendor_name || 'Meat Supplier';

    const docData = {
        po_number: poNumber,
        invoice_no: poData.invoice_no || '',
        invoice_date: poData.invoice_date || '',
        receive_date: poData.receive_date || '',
        receive_time: poData.receive_time || '',
        is_butcher_po: true,
        vendor: vendorName,
        vendor_name: vendorName,
        items: poData.items || [],
        total_quantity: (poData.items || []).reduce((s, i) => s + (Number(i.quantity) || 0), 0),
        total_weight_kg: (poData.items || []).reduce((s, i) => s + (Number(i.weight_kg || i.quantity) || 0), 0),
        total_amount: (poData.items || []).reduce((s, i) => s + ((Number(i.weight_kg || i.quantity) || 0) * (Number(i.unit_price) || 0)), 0),
        status: 'received',
        notes: poData.notes || 'Meat Delivery Received — Butchering Dept',
        created_at: serverTimestamp(),
    };

    const docRef = await addDoc(collection(db, PURCHASE_ORDERS), docData);

    // Fetch existing inventory items to check if received raw meat items exist
    const existingItemsSnap = await getDocs(query(collection(db, ITEMS), where('item_type', '==', 'raw_meat'))).catch(() => ({ docs: [] }));
    const existingItemMap = new Map();
    existingItemsSnap.docs.forEach(d => {
        const data = d.data();
        if (data.name) existingItemMap.set(data.name.toLowerCase().trim(), d.id);
    });

    // Create raw meat parent batches in inventory_batches AND register in inventory_items!
    const createdBatches = [];
    const bRef = writeBatch(db);

    for (let i = 0; i < (poData.items || []).length; i++) {
        const item = poData.items[i];
        const itemName = item.item_name || 'Raw Meat';
        const newBatchRef = doc(collection(db, BATCHES));
        const batchNo = item.batch_number || `BT-RM-${new Date().toISOString().substring(2, 10).replace(/-/g, '')}-${Math.floor(100 + Math.random() * 900)}`;

        const weight = Number(item.weight_kg || item.quantity) || 10;
        const batchData = {
            batch_number: batchNo,
            item_name: itemName,
            item_type: 'raw_meat',
            category: 'Raw Meat',
            quantity: weight,
            remaining_weight_kg: weight,
            weight_kg: weight,
            initial_quantity: weight,
            unit: 'kg',
            vendor_name: vendorName,
            supplier: vendorName,
            invoice_no: poData.invoice_no || '',
            received_at: serverTimestamp(),
            expiry_date: item.expiry_date || new Date(Date.now() + 7 * 86400 * 1000).toISOString().substring(0, 10),
            butchered_status: 'pending',
            is_cut: false,
            created_at: serverTimestamp(),
        };

        bRef.set(newBatchRef, batchData);
        createdBatches.push({ id: newBatchRef.id, ...batchData });

        // Check if item exists in inventory_items; if not, create it!
        const normKey = itemName.toLowerCase().trim();
        if (!existingItemMap.has(normKey)) {
            const newItemRef = doc(collection(db, ITEMS));
            bRef.set(newItemRef, {
                name: itemName,
                item_type: 'raw_meat',
                category_name: 'Raw Meat',
                vendor: vendorName,
                supplier: vendorName,
                unit: 'kg',
                cost_price: Number(item.unit_price) || 0,
                current_stock: weight,
                status: 'active',
                created_at: serverTimestamp(),
                updated_at: serverTimestamp(),
            });
            existingItemMap.set(normKey, newItemRef.id);
        }
    }

    await bRef.commit();

    return { id: docRef.id, ...docData, createdBatches };
};
