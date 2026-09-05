/**
 * Purchase Service — Firestore CRUD for Purchase Orders
 *
 * Purchase Order lifecycle:
 *   pending  →  received   (fully/partially received)
 *   pending  →  cancelled
 *
 * When receiving:
 *   - Grocery items: adjust stock quantity directly
 *   - Raw Meat items: create a batch per line item, adjust stock
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
    increment,
    Timestamp,
} from 'firebase/firestore';
import { db } from '../firebase';
import { addBatch, generateBatchNumber } from './inventoryService';

// ─── COLLECTION ───
const PURCHASE_ORDERS = 'purchase_orders';

// ═══════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════

export const PO_STATUSES = [
    { value: 'pending', label: 'Pending', color: '#f59e0b', icon: '⏳' },
    { value: 'received', label: 'Received', color: '#22c55e', icon: '✅' },
    { value: 'partially_received', label: 'Partially Received', color: '#3b82f6', icon: '📦' },
    { value: 'cancelled', label: 'Cancelled', color: '#ef4444', icon: '❌' },
];

export const getStatusInfo = (status) =>
    PO_STATUSES.find(s => s.value === status) || PO_STATUSES[0];

// ═══════════════════════════════════════════
// GENERATE PO NUMBER
// ═══════════════════════════════════════════

export const generatePONumber = () => {
    const now = new Date();
    const dateStr = now.toISOString().slice(2, 10).replace(/-/g, '');
    const rand = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
    return `PO-${dateStr}-${rand}`;
};

// ═══════════════════════════════════════════
// CREATE PURCHASE ORDER
// ═══════════════════════════════════════════

export const createPurchaseOrder = async (data) => {
    const poNumber = generatePONumber();

    // Calculate totals
    const totalAmount = (data.items || []).reduce(
        (sum, item) => sum + (item.quantity * item.unit_price), 0
    );

    const orderData = {
        po_number: poNumber,
        vendor: data.vendor || '',
        invoice_no: data.invoice_no || '',
        invoice_date: data.invoice_date || null,
        receive_date: data.receive_date || null,
        receive_time: data.receive_time || '',
        expected_delivery_date: data.expected_delivery_date
            ? (typeof data.expected_delivery_date === 'string'
                ? new Date(data.expected_delivery_date)
                : data.expected_delivery_date)
            : null,
        items: (data.items || []).map(item => ({
            item_id: item.item_id,
            item_name: item.item_name,
            item_type: item.item_type,
            category_name: item.category_name || '',
            unit: item.unit,
            quantity: Number(item.quantity) || 0,
            unit_price: Number(item.unit_price) || 0,
            total: (Number(item.quantity) || 0) * (Number(item.unit_price) || 0),
            // Receiving fields (filled later)
            received_quantity: 0,
            received_price: null,
            expiry_date: null,
            batch_id: null,
        })),
        total_amount: totalAmount,
        notes: data.notes || '',
        status: 'pending',
        created_by: data.created_by || '',
        created_at: serverTimestamp(),
        updated_at: serverTimestamp(),
    };

    const docRef = await addDoc(collection(db, PURCHASE_ORDERS), orderData);
    return { id: docRef.id, ...orderData, po_number: poNumber };
};

// ═══════════════════════════════════════════
// GET PURCHASE ORDERS
// ═══════════════════════════════════════════

export const getPurchaseOrders = async (filters = {}) => {
    let constraints = [];

    if (filters.status) {
        constraints.push(where('status', '==', filters.status));
    }

    if (filters.vendor) {
        constraints.push(where('vendor', '==', filters.vendor));
    }

    let q = query(collection(db, PURCHASE_ORDERS), ...constraints);
    const snap = await getDocs(q);

    let orders = snap.docs.map(d => {
        const data = d.data();
        return {
            id: d.id,
            ...data,
            created_at: data.created_at?.toDate?.() || null,
            updated_at: data.updated_at?.toDate?.() || null,
            expected_delivery_date: data.expected_delivery_date?.toDate?.() || null,
            received_at: data.received_at?.toDate?.() || null,
        };
    });

    // Client-side date filter
    if (filters.dateFrom) {
        const from = new Date(filters.dateFrom);
        from.setHours(0, 0, 0, 0);
        orders = orders.filter(o => o.created_at && o.created_at >= from);
    }
    if (filters.dateTo) {
        const to = new Date(filters.dateTo);
        to.setHours(23, 59, 59, 999);
        orders = orders.filter(o => o.created_at && o.created_at <= to);
    }

    // Sort by created_at descending
    orders.sort((a, b) => (b.created_at || 0) - (a.created_at || 0));

    return orders;
};

export const getPurchaseOrderById = async (id) => {
    const snap = await getDoc(doc(db, PURCHASE_ORDERS, id));
    if (!snap.exists()) return null;
    const data = snap.data();
    return {
        id: snap.id,
        ...data,
        created_at: data.created_at?.toDate?.() || null,
        updated_at: data.updated_at?.toDate?.() || null,
        expected_delivery_date: data.expected_delivery_date?.toDate?.() || null,
        received_at: data.received_at?.toDate?.() || null,
    };
};

// ═══════════════════════════════════════════
// RECEIVE PURCHASE ORDER
// ═══════════════════════════════════════════

/**
 * Receive a purchase order.
 * For each line item:
 *   - Grocery: adds received quantity to inventory item stock
 *   - Raw Meat: creates a new batch AND adds to item stock
 *
 * @param {string} orderId
 * @param {Array} receivedItems — each has:
 *   { item_id, item_type, received_quantity, received_price?, expiry_date?, vendor? }
 * @param {string} receivedBy — user who received
 */
export const receivePurchaseOrder = async (orderId, receivedItems, receivedBy = '', receiptDetails = {}) => {
    const orderRef = doc(db, PURCHASE_ORDERS, orderId);
    const orderSnap = await getDoc(orderRef);
    if (!orderSnap.exists()) throw new Error('Purchase order not found');

    const orderData = orderSnap.data();
    if (orderData.status === 'received') throw new Error('Order already received');
    if (orderData.status === 'cancelled') throw new Error('Order is cancelled');

    const updatedItems = [...orderData.items];
    const createdBatches = [];

    for (const received of receivedItems) {
        const idx = updatedItems.findIndex(i => i.item_id === received.item_id);
        if (idx === -1) continue;

        const lineItem = updatedItems[idx];
        const receivedQty = Number(received.received_quantity) || 0;
        if (receivedQty <= 0) continue;

        // Update line item
        updatedItems[idx] = {
            ...lineItem,
            received_quantity: receivedQty,
            received_price: received.received_price != null
                ? Number(received.received_price)
                : lineItem.unit_price,
            expiry_date: received.expiry_date || null,
        };

        if (lineItem.item_type === 'raw_meat') {
            // Create batch for raw meat
            const batch = await addBatch({
                item_id: lineItem.item_id,
                item_name: lineItem.item_name,
                item_type: 'raw_meat',
                quantity: receivedQty,
                unit: lineItem.unit,
                vendor: received.vendor || orderData.vendor || '',
                cost_price: received.received_price != null ? Number(received.received_price) : Number(lineItem.unit_price || 0),
                purchase_order_id: orderId,
                manufactured_date: new Date(),
                expiry_date: received.expiry_date
                    ? new Date(received.expiry_date)
                    : new Date(Date.now() + 3 * 24 * 60 * 60 * 1000), // default 3 days
                source: 'purchase',
            });
            updatedItems[idx].batch_id = batch.id;
            createdBatches.push(batch);
            // addBatch already increments item stock
        } else {
            // Grocery: directly increment stock
            await updateDoc(doc(db, 'inventory_items', lineItem.item_id), {
                current_stock: increment(receivedQty),
                cost_price: received.received_price != null ? Number(received.received_price) : Number(lineItem.unit_price || 0),
                updated_at: serverTimestamp(),
            });
        }
    }

    // Determine overall status
    const allReceived = updatedItems.every(i => i.received_quantity >= i.quantity);
    const someReceived = updatedItems.some(i => i.received_quantity > 0);
    const newStatus = allReceived ? 'received' : (someReceived ? 'partially_received' : 'pending');

    // Recalculate total with actual received prices
    const receivedTotal = updatedItems.reduce(
        (sum, i) => sum + (i.received_quantity * (i.received_price || i.unit_price)), 0
    );

    await updateDoc(orderRef, {
        items: updatedItems,
        status: newStatus,
        received_total: receivedTotal,
        received_by: receivedBy,
        vendor: receiptDetails.vendor || orderData.vendor || '',
        invoice_no: receiptDetails.invoice_no ?? orderData.invoice_no ?? '',
        invoice_date: receiptDetails.invoice_date ?? orderData.invoice_date ?? null,
        receive_date: receiptDetails.receive_date || null,
        receive_time: receiptDetails.receive_time || '',
        receive_notes: receiptDetails.receive_notes || '',
        received_at: serverTimestamp(),
        updated_at: serverTimestamp(),
    });

    return { status: newStatus, createdBatches, receivedTotal };
};

// Review a completed receipt without changing inventory quantities. Quantity corrections
// must be handled through a stock adjustment so the audit trail and raw-meat batches stay accurate.
export const updateReceivedPurchaseReview = async (orderId, { vendor, invoice_no, invoice_date, receive_notes, items }) => {
    const ref = doc(db, PURCHASE_ORDERS, orderId);
    const snap = await getDoc(ref);
    if (!snap.exists()) throw new Error('Purchase order not found');
    const order = snap.data();
    if (!['received', 'partially_received'].includes(order.status)) throw new Error('Only received orders can be reviewed');
    const updatedItems = (order.items || []).map(line => {
        const review = items?.find(i => i.item_id === line.item_id);
        return review ? { ...line, received_price: Number(review.received_price ?? line.received_price ?? line.unit_price) } : line;
    });
    const receivedTotal = updatedItems.reduce((sum, item) => sum + Number(item.received_quantity || 0) * Number(item.received_price ?? item.unit_price ?? 0), 0);
    await Promise.all(updatedItems.filter(i => i.item_id).map(item => updateDoc(doc(db, 'inventory_items', item.item_id), {
        cost_price: Number(item.received_price ?? item.unit_price ?? 0),
        updated_at: serverTimestamp(),
    })));
    await updateDoc(ref, { vendor: vendor || order.vendor || '', invoice_no: invoice_no || '', invoice_date: invoice_date || null, receive_notes: receive_notes || '', items: updatedItems, received_total: receivedTotal, receipt_reviewed_at: serverTimestamp(), updated_at: serverTimestamp() });
    return { ...order, id: orderId, vendor, invoice_no, invoice_date, receive_notes, items: updatedItems, received_total: receivedTotal };
};

// ═══════════════════════════════════════════
// UPDATE (EDIT) PURCHASE ORDER
// ═══════════════════════════════════════════

/**
 * Update an existing purchase order (full edit).
 * Adjusts inventory stock deltas when received quantities change on
 * already-received orders.
 */
export const updatePurchaseOrder = async (orderId, editData) => {
    const ref = doc(db, PURCHASE_ORDERS, orderId);
    const snap = await getDoc(ref);
    if (!snap.exists()) throw new Error('Purchase order not found');
    const order = snap.data();

    if (order.status === 'cancelled') throw new Error('Cannot edit a cancelled order');

    const oldItems = order.items || [];
    const newItems = (editData.items || []).map((incoming) => {
        const oldLine = oldItems.find(o => o.item_id === incoming.item_id) || {};
        return {
            ...oldLine,
            quantity: Number(incoming.quantity) || 0,
            unit_price: Number(incoming.unit_price) || 0,
            total: (Number(incoming.quantity) || 0) * (Number(incoming.unit_price) || 0),
            received_quantity: Number(incoming.received_quantity) || 0,
            received_price: incoming.received_price != null
                ? Number(incoming.received_price)
                : (oldLine.received_price ?? oldLine.unit_price ?? 0),
        };
    });

    // Inventory delta adjustments (only for items that were already received)
    const wasReceived = ['received', 'partially_received'].includes(order.status);

    for (const newLine of newItems) {
        const oldLine = oldItems.find(o => o.item_id === newLine.item_id);
        if (!oldLine) continue;
        const oldRecvQty = Number(oldLine.received_quantity) || 0;
        const newRecvQty = Number(newLine.received_quantity) || 0;
        const delta = newRecvQty - oldRecvQty;

        if (delta === 0) continue;
        if (!wasReceived && oldRecvQty === 0) continue;

        if (newLine.item_type === 'raw_meat') {
            if (newLine.batch_id) {
                try {
                    await updateDoc(doc(db, 'inventory_batches', newLine.batch_id), {
                        quantity: increment(delta),
                        updated_at: serverTimestamp(),
                    });
                } catch (e) {
                    console.error('Failed to adjust batch quantity:', e);
                }
            }
            try {
                await updateDoc(doc(db, 'inventory_items', newLine.item_id), {
                    current_stock: increment(delta),
                    cost_price: Number(newLine.received_price ?? newLine.unit_price ?? 0),
                    updated_at: serverTimestamp(),
                });
            } catch (e) {
                console.error('Failed to adjust raw meat item stock:', e);
            }
        } else {
            try {
                await updateDoc(doc(db, 'inventory_items', newLine.item_id), {
                    current_stock: increment(delta),
                    cost_price: Number(newLine.received_price ?? newLine.unit_price ?? 0),
                    updated_at: serverTimestamp(),
                });
            } catch (e) {
                console.error('Failed to adjust grocery stock:', e);
            }
        }
    }

    // Recalculate totals
    const totalAmount = newItems.reduce(
        (sum, i) => sum + (i.quantity * i.unit_price), 0
    );
    const receivedTotal = newItems.reduce(
        (sum, i) => sum + ((i.received_quantity || 0) * (i.received_price ?? i.unit_price ?? 0)), 0
    );

    // Re-evaluate status
    const allReceived = newItems.every(i => i.received_quantity >= i.quantity);
    const someReceived = newItems.some(i => i.received_quantity > 0);
    let newStatus = order.status;
    if (wasReceived || someReceived) {
        newStatus = allReceived ? 'received' : (someReceived ? 'partially_received' : 'pending');
    }

    const expectedDeliveryDate = editData.expected_delivery_date
        ? (typeof editData.expected_delivery_date === 'string'
            ? new Date(editData.expected_delivery_date)
            : editData.expected_delivery_date)
        : order.expected_delivery_date;

    await updateDoc(ref, {
        vendor: editData.vendor || order.vendor || '',
        invoice_no: editData.invoice_no ?? order.invoice_no ?? '',
        invoice_date: editData.invoice_date ?? order.invoice_date ?? null,
        receive_date: editData.receive_date ?? order.receive_date ?? null,
        receive_time: editData.receive_time ?? order.receive_time ?? '',
        expected_delivery_date: expectedDeliveryDate,
        notes: editData.notes ?? order.notes ?? '',
        items: newItems,
        total_amount: totalAmount,
        received_total: receivedTotal,
        status: newStatus,
        updated_at: serverTimestamp(),
    });

    return {
        id: orderId,
        ...order,
        vendor: editData.vendor || order.vendor || '',
        invoice_no: editData.invoice_no ?? order.invoice_no ?? '',
        invoice_date: editData.invoice_date ?? order.invoice_date ?? null,
        receive_date: editData.receive_date ?? order.receive_date ?? null,
        receive_time: editData.receive_time ?? order.receive_time ?? '',
        expected_delivery_date: expectedDeliveryDate,
        notes: editData.notes ?? order.notes ?? '',
        items: newItems,
        total_amount: totalAmount,
        received_total: receivedTotal,
        status: newStatus,
    };
};

// ═══════════════════════════════════════════
// CANCEL PURCHASE ORDER
// ═══════════════════════════════════════════

export const cancelPurchaseOrder = async (orderId, reason = '') => {
    const orderRef = doc(db, PURCHASE_ORDERS, orderId);
    const orderSnap = await getDoc(orderRef);
    if (!orderSnap.exists()) throw new Error('Purchase order not found');

    const orderData = orderSnap.data();
    if (orderData.status === 'received') throw new Error('Cannot cancel a received order');

    await updateDoc(orderRef, {
        status: 'cancelled',
        cancel_reason: reason,
        updated_at: serverTimestamp(),
    });
};

// ═══════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════

export const getUniqueVendors = async () => {
    const vendors = new Set();

    try {
        const poSnap = await getDocs(collection(db, PURCHASE_ORDERS));
        poSnap.docs.forEach(d => {
            const data = d.data();
            const v = data.vendor || data.vendor_name || data.supplier;
            if (v && typeof v === 'string' && v.trim()) vendors.add(v.trim());
        });
    } catch (e) { console.error('Error fetching PO vendors:', e); }

    try {
        const itemSnap = await getDocs(collection(db, 'inventory_items'));
        itemSnap.docs.forEach(d => {
            const data = d.data();
            const v = data.vendor || data.supplier || data.vendor_name;
            if (v && typeof v === 'string' && v.trim()) vendors.add(v.trim());
        });
    } catch (e) { console.error('Error fetching item vendors:', e); }

    try {
        const batchSnap = await getDocs(collection(db, 'inventory_batches'));
        batchSnap.docs.forEach(d => {
            const data = d.data();
            const v = data.vendor || data.vendor_name || data.supplier;
            if (v && typeof v === 'string' && v.trim()) vendors.add(v.trim());
        });
    } catch (e) { console.error('Error fetching batch vendors:', e); }

    try {
        const vSnap = await getDocs(collection(db, 'vendors'));
        vSnap.docs.forEach(d => {
            const data = d.data();
            const v = data.name || data.vendor_name || data.title;
            if (v && typeof v === 'string' && v.trim()) vendors.add(v.trim());
        });
    } catch (e) { /* collection optional */ }

    return [...vendors].sort();
};
