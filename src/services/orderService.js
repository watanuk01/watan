/**
 * Order Service — Firestore CRUD for Restaurant → Central Kitchen Orders
 *
 * Order Lifecycle:
 *   pending → ready_for_pickup → out_for_delivery → delivered
 *                                                  → cancelled (from pending only)
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
    onSnapshot,
    Timestamp,
} from 'firebase/firestore';
import { db } from '../firebase';
import { deductStockFIFO, adjustStock } from './inventoryService';
import { generateOrderInvoice, getInvoiceById, updateInvoice } from './invoiceService';
import { addStockFromDelivery } from './restaurantInventoryService';

// ─── COLLECTION ───
const ORDERS = 'orders';

// ─── STATUS CONSTANTS ───
export const ORDER_STATUSES = [
    { value: 'pending', label: 'Pending', color: '#f59e0b', icon: '🕐' },
    { value: 'ready_for_pickup', label: 'Ready for Pickup', color: '#3b82f6', icon: '📦' },
    { value: 'assigned', label: 'Assigned', color: '#6366f1', icon: '👤' },
    { value: 'picked_up', label: 'Picked Up', color: '#8b5cf6', icon: '📋' },
    { value: 'out_for_delivery', label: 'Out for Delivery', color: '#a855f7', icon: '🚚' },
    { value: 'delivered', label: 'Delivered', color: '#22c55e', icon: '✅' },
    { value: 'cancelled', label: 'Cancelled', color: '#ef4444', icon: '❌' },
];

export const getStatusInfo = (status) =>
    ORDER_STATUSES.find(s => s.value === status) || ORDER_STATUSES[0];

// ═══════════════════════════════════════════
// ORDER NUMBER GENERATION
// ═══════════════════════════════════════════

const generateOrderNumber = async () => {
    const year = new Date().getFullYear();
    const ordersRef = collection(db, ORDERS);
    const snap = await getDocs(ordersRef);
    const num = snap.size + 1;
    return `ORD-${year}-${String(num).padStart(4, '0')}`;
};

/**
 * Create a new order from a restaurant.
 *
 * @param {Object} orderData
 * @param {string} orderData.restaurant_id — UID of the restaurant user
 * @param {string} orderData.restaurant_name
 * @param {Array}  orderData.items — [{ item_id, item_name, item_type, unit, quantity, cost_price, selling_price, vat_rate, vat_exempt }]
 * @param {string} orderData.created_by — UID of the user placing the order
 * @param {string} orderData.notes — optional order notes
 */
export const createOrder = async (orderData) => {
    const { restaurant_id, restaurant_name, items, created_by, notes } = orderData;

    // Calculate totals
    let subtotal = 0;
    let vatAmount = 0;

    const processedItems = items.map(item => {
        const lineTotal = (item.selling_price || 0) * item.quantity;
        const itemVatRate = item.vat_exempt ? 0 : (item.vat_rate ?? 20);
        const itemVat = lineTotal * (itemVatRate / 100);

        subtotal += lineTotal;
        vatAmount += itemVat;

        return {
            item_id: item.item_id,
            item_name: item.item_name,
            item_type: item.item_type || 'grocery',
            category_name: item.category_name || '',
            unit: item.unit || 'kg',
            base_unit: item.base_unit || item.unit || 'kg',
            quantity: item.quantity,
            base_quantity: item.unit_conversion?.has_conversion
                ? Math.round(item.quantity * (item.unit_conversion.base_factor || 1) * 100) / 100
                : item.quantity,
            cost_price: item.cost_price || 0,
            selling_price: item.selling_price || 0,
            vat_rate: itemVatRate,
            vat_exempt: item.vat_exempt || false,
            line_total: lineTotal,
            vat_amount: itemVat,
        };
    });

    const orderNumber = await generateOrderNumber();

    const order = {
        order_number: orderNumber,
        restaurant_id,
        restaurant_name: restaurant_name || '',
        status: 'pending',
        items: processedItems,
        item_count: processedItems.length,
        subtotal: Math.round(subtotal * 100) / 100,
        vat_amount: Math.round(vatAmount * 100) / 100,
        total: Math.round((subtotal + vatAmount) * 100) / 100,
        notes: notes || '',
        // Delivery fields
        delivery_partner_id: null,
        delivery_partner_name: null,
        delivery_notes: '',
        delivery_signature: null,
        // Invoice
        invoice_number: null,
        // Timestamps
        created_by,
        created_at: serverTimestamp(),
        updated_at: serverTimestamp(),
        ready_at: null,
        dispatched_at: null,
        delivered_at: null,
        cancelled_at: null,
    };

    const docRef = await addDoc(collection(db, ORDERS), order);
    return { id: docRef.id, ...order };
};

// ═══════════════════════════════════════════
// READ ORDERS
// ═══════════════════════════════════════════

const convertTimestamp = (ts) => {
    if (!ts) return null;
    if (ts.toDate) return ts.toDate();
    if (ts instanceof Date) return ts;
    return new Date(ts);
};

/**
 * Fetch orders with optional filters.
 * @param {Object} filters — { status, restaurant_id, date_from, date_to }
 */
export const getOrders = async (filters = {}) => {
    const constraints = [];

    if (filters.status) {
        constraints.push(where('status', '==', filters.status));
    }
    if (filters.restaurant_id) {
        constraints.push(where('restaurant_id', '==', filters.restaurant_id));
    }

    const q = query(collection(db, ORDERS), ...constraints);
    const snap = await getDocs(q);

    let orders = snap.docs.map(d => ({
        id: d.id,
        ...d.data(),
        created_at: convertTimestamp(d.data().created_at),
        updated_at: convertTimestamp(d.data().updated_at),
        ready_at: convertTimestamp(d.data().ready_at),
        assigned_at: convertTimestamp(d.data().assigned_at),
        picked_up_at: convertTimestamp(d.data().picked_up_at),
        dispatched_at: convertTimestamp(d.data().dispatched_at),
        delivered_at: convertTimestamp(d.data().delivered_at),
        cancelled_at: convertTimestamp(d.data().cancelled_at),
    }));

    // Client-side date filtering
    if (filters.date_from) {
        const from = new Date(filters.date_from);
        from.setHours(0, 0, 0, 0);
        orders = orders.filter(o => o.created_at && o.created_at >= from);
    }
    if (filters.date_to) {
        const to = new Date(filters.date_to);
        to.setHours(23, 59, 59, 999);
        orders = orders.filter(o => o.created_at && o.created_at <= to);
    }

    // Sort newest first
    orders.sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
    return orders;
};

/**
 * Get a single order by ID.
 */
export const getOrderById = async (orderId) => {
    const snap = await getDoc(doc(db, ORDERS, orderId));
    if (!snap.exists()) return null;
    const data = snap.data();
    return {
        id: snap.id,
        ...data,
        created_at: convertTimestamp(data.created_at),
        updated_at: convertTimestamp(data.updated_at),
        ready_at: convertTimestamp(data.ready_at),
        dispatched_at: convertTimestamp(data.dispatched_at),
        delivered_at: convertTimestamp(data.delivered_at),
        cancelled_at: convertTimestamp(data.cancelled_at),
    };
};

/**
 * Get all orders for a specific restaurant.
 */
export const getRestaurantOrders = async (restaurantId) => {
    return getOrders({ restaurant_id: restaurantId });
};

/**
 * Get undelivered orders (ready for pickup).
 */
export const getUndeliveredOrders = async () => {
    return getOrders({ status: 'ready_for_pickup' });
};

// ═══════════════════════════════════════════
// REAL-TIME LISTENERS (onSnapshot)
// ═══════════════════════════════════════════

const mapOrderDoc = (d) => ({
    id: d.id,
    ...d.data(),
    created_at: convertTimestamp(d.data().created_at),
    updated_at: convertTimestamp(d.data().updated_at),
    ready_at: convertTimestamp(d.data().ready_at),
    assigned_at: convertTimestamp(d.data().assigned_at),
    picked_up_at: convertTimestamp(d.data().picked_up_at),
    dispatched_at: convertTimestamp(d.data().dispatched_at),
    delivered_at: convertTimestamp(d.data().delivered_at),
    cancelled_at: convertTimestamp(d.data().cancelled_at),
});

/**
 * Subscribe to all orders (admin/CK).
 * @param {Function} callback  — receives sorted order array on each change
 * @returns {Function} unsubscribe
 */
export const subscribeToOrders = (callback) => {
    // Only listen to orders from the last 7 days to avoid downloading the entire collection
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const q = query(
        collection(db, ORDERS),
        where('created_at', '>=', Timestamp.fromDate(sevenDaysAgo)),
        orderBy('created_at', 'desc')
    );
    return onSnapshot(q, (snap) => {
        const orders = snap.docs.map(mapOrderDoc);
        orders.sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
        callback(orders);
    });
};

/**
 * Subscribe to a restaurant's orders.
 * @param {string} restaurantId
 * @param {Function} callback
 * @returns {Function} unsubscribe
 */
export const subscribeToRestaurantOrders = (restaurantId, callback) => {
    // Only listen to orders from the last 7 days to avoid downloading the entire collection
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const q = query(
        collection(db, ORDERS),
        where('restaurant_id', '==', restaurantId),
        where('created_at', '>=', Timestamp.fromDate(sevenDaysAgo)),
        orderBy('created_at', 'desc')
    );
    return onSnapshot(q, (snap) => {
        const orders = snap.docs.map(mapOrderDoc);
        orders.sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
        callback(orders);
    });
};

/**
 * Subscribe to a delivery partner's orders.
 * @param {string} partnerId
 * @param {Function} callback
 * @returns {Function} unsubscribe
 */
export const subscribeToDeliveryPartnerOrders = (partnerId, callback) => {
    // Only listen to orders from the last 7 days to avoid downloading the entire collection
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const q = query(
        collection(db, ORDERS),
        where('delivery_partner_id', '==', partnerId),
        where('created_at', '>=', Timestamp.fromDate(sevenDaysAgo)),
        orderBy('created_at', 'desc')
    );
    return onSnapshot(q, (snap) => {
        const orders = snap.docs.map(mapOrderDoc);
        orders.sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
        callback(orders);
    });
};

// ═══════════════════════════════════════════
// UPDATE ORDER STATUS
// ═══════════════════════════════════════════

/**
 * Mark pending orders as "ready for pickup".
 * This is where stock gets deducted from CK inventory (FIFO).
 *
 * @param {string} orderId
 */
export const markReadyForPickup = async (orderId) => {
    const order = await getOrderById(orderId);
    if (!order || order.status !== 'pending') {
        throw new Error('Order is not in pending status');
    }

    // Deduct stock from CK inventory for each item (FIFO)
    const batchAllocations = [];
    for (const item of order.items) {
        try {
            if (item.item_type === 'grocery') {
                // Grocery: simple stock deduction
                await adjustStock(item.item_id, -item.quantity, `Order ${order.order_number}`);
                batchAllocations.push({
                    item_id: item.item_id,
                    item_name: item.item_name,
                    quantity: item.quantity,
                    batches: [],
                });
            } else {
                // Raw meat / Cooked meat: FIFO batch deduction
                const consumed = await deductStockFIFO(item.item_id, item.quantity);
                batchAllocations.push({
                    item_id: item.item_id,
                    item_name: item.item_name,
                    quantity: item.quantity,
                    batches: consumed,
                });
            }
        } catch (err) {
            console.error(`Failed to deduct stock for ${item.item_name}:`, err);
            // Continue processing other items
        }
    }

    // Generate full invoice document (this returns the generated invoice_number)
    const invoice = await generateOrderInvoice(orderId);

    // Update order
    const orderRef = doc(db, ORDERS, orderId);
    await updateDoc(orderRef, {
        status: 'ready_for_pickup',
        batch_allocations: batchAllocations,
        invoice_number: invoice.invoice_number,
        invoice_id: invoice.id,
        ready_at: serverTimestamp(),
        updated_at: serverTimestamp(),
    });

    return { invoiceNumber: invoice.invoice_number, batchAllocations };
};

/**
 * Bulk mark multiple orders as ready for pickup.
 * @param {Array<string>} orderIds
 */
export const bulkMarkReady = async (orderIds) => {
    const results = [];
    for (const id of orderIds) {
        try {
            const result = await markReadyForPickup(id);
            results.push({ id, success: true, ...result });
        } catch (err) {
            results.push({ id, success: false, error: err.message });
        }
    }
    return results;
};

/**
 * Delivery partner self-assigns an order.
 */
export const assignDeliveryPartner = async (orderId, partnerId, partnerName) => {
    const order = await getOrderById(orderId);
    if (!order || order.status !== 'ready_for_pickup') {
        throw new Error('Order is not ready for pickup');
    }

    const orderRef = doc(db, ORDERS, orderId);
    await updateDoc(orderRef, {
        status: 'assigned',
        delivery_partner_id: partnerId,
        delivery_partner_name: partnerName,
        assigned_at: serverTimestamp(),
        updated_at: serverTimestamp(),
    });
};

/**
 * Admin assigns a delivery partner to an order.
 */
export const adminAssignDeliveryPartner = async (orderId, partnerId, partnerName) => {
    const order = await getOrderById(orderId);
    if (!order || order.status !== 'ready_for_pickup') {
        throw new Error('Order is not ready for pickup');
    }

    const orderRef = doc(db, ORDERS, orderId);
    await updateDoc(orderRef, {
        status: 'assigned',
        delivery_partner_id: partnerId,
        delivery_partner_name: partnerName,
        assigned_at: serverTimestamp(),
        admin_assigned: true,
        updated_at: serverTimestamp(),
    });
};

/**
 * Delivery partner confirms pickup — verifies items and records missing items.
 * After verification, status moves to out_for_delivery.
 *
 * @param {string} orderId
 * @param {Object} verificationData
 * @param {Array}  verificationData.verifiedItems — items with confirmed quantities
 * @param {Array}  verificationData.missingItems — items that are missing or have quantity discrepancies
 */
export const pickupOrder = async (orderId, { verifiedItems, missingItems }) => {
    const order = await getOrderById(orderId);
    if (!order || order.status !== 'assigned') {
        throw new Error('Order is not in assigned status');
    }

    let updatedItems = order.items || [];
    let newSubtotal = order.subtotal || 0;
    let newVatAmount = order.vat_amount || 0;
    let newTotal = order.total || 0;
    let newItemCount = order.item_count || 0;

    // Rebuild the order items array so the UI displays the verified quantities correctly
    if (missingItems && missingItems.length > 0) {
        updatedItems = updatedItems.map(item => {
            const verified = (verifiedItems || []).find(vi => vi.item_id === item.item_id);
            if (verified) {
                const quantity = verified.quantity;
                const base_quantity = item.quantity > 0
                    ? Number(((item.base_quantity || item.quantity) / item.quantity * quantity).toFixed(2))
                    : quantity;
                const line_total = quantity * (item.selling_price || 0);
                const vat_amount = (line_total * (item.vat_rate || 0)) / 100;

                return { ...item, quantity, base_quantity, line_total, vat_amount };
            }
            return item;
        }).filter(item => item.quantity > 0);

        newSubtotal = updatedItems.reduce((sum, item) => sum + (item.line_total || 0), 0);
        newVatAmount = updatedItems.reduce((sum, item) => sum + (item.vat_amount || 0), 0);
        newTotal = newSubtotal + newVatAmount;
        newItemCount = updatedItems.length;
    }

    const orderRef = doc(db, ORDERS, orderId);
    await updateDoc(orderRef, {
        status: 'out_for_delivery',
        items: updatedItems,
        item_count: newItemCount,
        subtotal: Math.round(newSubtotal * 100) / 100,
        vat_amount: Math.round(newVatAmount * 100) / 100,
        total: Math.round(newTotal * 100) / 100,
        verified_items: verifiedItems || [],
        missing_items: missingItems || [],
        picked_up_at: serverTimestamp(),
        dispatched_at: serverTimestamp(),
        updated_at: serverTimestamp(),
    });

    // Auto-sync the invoice to reflect the actual received quantities if there are missing items
    if (order.invoice_id && missingItems && missingItems.length > 0) {
        try {
            const invoice = await getInvoiceById(order.invoice_id);
            if (invoice) {
                const updatedLineItems = (invoice.line_items || []).map(li => {
                    const verified = (verifiedItems || []).find(vi => vi.item_id === li.item_id);
                    if (verified) {
                        return { ...li, quantity: verified.quantity };
                    }
                    return li;
                }).filter(li => li.quantity > 0);

                await updateInvoice(order.invoice_id, {
                    line_items: updatedLineItems,
                    discount_type: invoice.discount_type,
                    discount_value: invoice.discount_value,
                    notes: invoice.notes
                });
            }
        } catch (err) {
            console.error('Failed to sync invoice with pickup discrepancy:', err);
        }
    }
};

/**
 * Complete delivery with signature.
 */
export const completeDelivery = async (orderId, { managerName, signature, notes }) => {
    const order = await getOrderById(orderId);
    if (!order || order.status !== 'out_for_delivery') {
        throw new Error('Order is not out for delivery');
    }

    const orderRef = doc(db, ORDERS, orderId);
    await updateDoc(orderRef, {
        status: 'delivered',
        delivery_manager_name: managerName || '',
        delivery_signature: signature || null,
        delivery_notes: notes || '',
        delivered_at: serverTimestamp(),
        updated_at: serverTimestamp(),
    });

    // ── Auto-transfer stock to restaurant inventory ──
    // Use verified_items if available (reflects actual received quantities)
    const itemsToTransfer = order.verified_items?.length > 0 ? order.verified_items : order.items;
    if (order.restaurant_id && itemsToTransfer?.length > 0) {
        try {
            await addStockFromDelivery(
                order.restaurant_id,
                itemsToTransfer,
                order.order_number || orderId
            );
        } catch (err) {
            console.error('Failed to transfer stock to restaurant inventory:', err);
        }
    }
};

/**
 * Cancel an order (only pending orders can be cancelled).
 */
export const cancelOrder = async (orderId, reason = '') => {
    const order = await getOrderById(orderId);
    if (!order || order.status !== 'pending') {
        throw new Error('Only pending orders can be cancelled');
    }

    const orderRef = doc(db, ORDERS, orderId);
    await updateDoc(orderRef, {
        status: 'cancelled',
        cancel_reason: reason,
        cancelled_at: serverTimestamp(),
        updated_at: serverTimestamp(),
    });
};

// ═══════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════

/**
 * Check if restaurant already has a pending order today.
 * Returns the order if it exists, null otherwise.
 */
export const getTodaysPendingOrder = async (restaurantId) => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const constraints = [
        where('restaurant_id', '==', restaurantId),
        where('status', '==', 'pending'),
    ];

    const q = query(collection(db, ORDERS), ...constraints);
    const snap = await getDocs(q);

    const todayOrders = snap.docs
        .map(d => ({
            id: d.id,
            ...d.data(),
            created_at: convertTimestamp(d.data().created_at),
        }))
        .filter(o => o.created_at && o.created_at >= today && o.created_at < tomorrow);

    return todayOrders.length > 0 ? todayOrders[0] : null;
};

/**
 * Add items to an existing pending order (merge).
 */
export const addItemsToOrder = async (orderId, newItems) => {
    const order = await getOrderById(orderId);
    if (!order || order.status !== 'pending') {
        throw new Error('Can only add items to pending orders');
    }

    let subtotal = order.subtotal || 0;
    let vatAmount = order.vat_amount || 0;

    const processedNewItems = newItems.map(item => {
        const lineTotal = (item.selling_price || 0) * item.quantity;
        const itemVatRate = item.vat_exempt ? 0 : (item.vat_rate ?? 20);
        const itemVat = lineTotal * (itemVatRate / 100);
        subtotal += lineTotal;
        vatAmount += itemVat;

        return {
            item_id: item.item_id,
            item_name: item.item_name,
            item_type: item.item_type || 'grocery',
            category_name: item.category_name || '',
            unit: item.unit || 'kg',
            quantity: item.quantity,
            cost_price: item.cost_price || 0,
            selling_price: item.selling_price || 0,
            vat_rate: itemVatRate,
            vat_exempt: item.vat_exempt || false,
            line_total: lineTotal,
            vat_amount: itemVat,
        };
    });

    // Merge: if same item exists, add quantities; otherwise add new entry
    const mergedItems = [...order.items];
    for (const newItem of processedNewItems) {
        const existingIdx = mergedItems.findIndex(i => i.item_id === newItem.item_id);
        if (existingIdx >= 0) {
            // Recalculate — remove old contribution, add new combined
            subtotal -= mergedItems[existingIdx].line_total;
            vatAmount -= mergedItems[existingIdx].vat_amount;

            mergedItems[existingIdx].quantity += newItem.quantity;
            mergedItems[existingIdx].line_total = mergedItems[existingIdx].selling_price * mergedItems[existingIdx].quantity;
            const rate = mergedItems[existingIdx].vat_exempt ? 0 : (mergedItems[existingIdx].vat_rate ?? 20);
            mergedItems[existingIdx].vat_amount = mergedItems[existingIdx].line_total * (rate / 100);

            subtotal += mergedItems[existingIdx].line_total;
            vatAmount += mergedItems[existingIdx].vat_amount;
        } else {
            mergedItems.push(newItem);
        }
    }

    const orderRef = doc(db, ORDERS, orderId);
    await updateDoc(orderRef, {
        items: mergedItems,
        item_count: mergedItems.length,
        subtotal: Math.round(subtotal * 100) / 100,
        vat_amount: Math.round(vatAmount * 100) / 100,
        total: Math.round((subtotal + vatAmount) * 100) / 100,
        updated_at: serverTimestamp(),
    });
};

/**
 * Get orders assigned to a specific delivery partner.
 */
export const getDeliveryPartnerOrders = async (partnerId) => {
    const constraints = [
        where('delivery_partner_id', '==', partnerId),
    ];
    const q = query(collection(db, ORDERS), ...constraints);
    const snap = await getDocs(q);

    const orders = snap.docs.map(d => ({
        id: d.id,
        ...d.data(),
        created_at: convertTimestamp(d.data().created_at),
        updated_at: convertTimestamp(d.data().updated_at),
        assigned_at: convertTimestamp(d.data().assigned_at),
        picked_up_at: convertTimestamp(d.data().picked_up_at),
        dispatched_at: convertTimestamp(d.data().dispatched_at),
        delivered_at: convertTimestamp(d.data().delivered_at),
    }));

    orders.sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
    return orders;
};

// ═══════════════════════════════════════════
// REPLENISHMENT (ADMIN-PLACED ON BEHALF OF RESTAURANT)
// ═══════════════════════════════════════════

/**
 * Admin places a replenishment order for a restaurant.
 * Respects single-order-per-day rule:
 *   - If a pending order exists today → merge items in
 *   - Otherwise → create a new order tagged admin_created
 *
 * @param {Object} opts
 * @param {string}  opts.restaurant_id
 * @param {string}  opts.restaurant_name
 * @param {Array}   opts.items  — items to order
 * @param {Object}  opts.adminUser — { uid/id, name, email }
 * @param {string}  [opts.notes]
 */
export const placeReplenishmentOrder = async ({ restaurant_id, restaurant_name, items, adminUser, notes }) => {
    // Check if restaurant already has a pending order today
    const existingOrder = await getTodaysPendingOrder(restaurant_id);

    const adminId = adminUser?.uid || adminUser?.id;
    const adminName = adminUser?.name || adminUser?.email || 'Admin';

    if (existingOrder) {
        // MERGE into existing order
        await addItemsToOrder(existingOrder.id, items);
        await updateDoc(doc(db, ORDERS, existingOrder.id), {
            admin_updated: true,
            admin_updated_by: { uid: adminId, name: adminName },
            updated_at: serverTimestamp(),
        });
        return { orderId: existingOrder.id, orderNumber: existingOrder.order_number, merged: true };
    } else {
        // CREATE new order tagged as admin-created
        const order = await createOrder({
            restaurant_id,
            restaurant_name,
            items,
            created_by: adminId,
            notes: notes || `Auto-replenishment order created by admin (${adminName})`,
        });
        // Tag as admin-created
        await updateDoc(doc(db, ORDERS, order.id), {
            admin_created: true,
            admin_created_by: { uid: adminId, name: adminName },
            order_source: 'auto_replenishment',
            updated_at: serverTimestamp(),
        });
        return { orderId: order.id, orderNumber: order.order_number, merged: false };
    }
};

