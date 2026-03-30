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
export const receivePurchaseOrder = async (orderId, receivedItems, receivedBy = '') => {
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
        received_at: serverTimestamp(),
        updated_at: serverTimestamp(),
    });

    return { status: newStatus, createdBatches, receivedTotal };
};

// ═══════════════════════════════════════════
// CANCEL PURCHASE ORDER
// ═══════════════════════════════════════════

export const cancelPurchaseOrder = async (orderId, reason = '') => {
    const orderRef = doc(db, PURCHASE_ORDERS, orderId);
    const orderSnap = await getDoc(orderRef);
    if (!orderSnap.exists()) throw new Error('Purchase order not found');

    const data = orderSnap.data();
    if (data.status === 'received') throw new Error('Cannot cancel a received order');

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
    const q = query(collection(db, PURCHASE_ORDERS));
    const snap = await getDocs(q);
    const vendors = new Set();
    snap.docs.forEach(d => {
        const vendor = d.data().vendor;
        if (vendor) vendors.add(vendor);
    });

    // Also get vendors from inventory items
    const itemSnap = await getDocs(collection(db, 'inventory_items'));
    itemSnap.docs.forEach(d => {
        const v = d.data().vendor;
        if (v) vendors.add(v);
    });

    return [...vendors].sort();
};
