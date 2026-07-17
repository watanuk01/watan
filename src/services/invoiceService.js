/**
 * Invoice Service — Firestore CRUD for Order Invoices
 *
 * Collections:
 *   - invoices      (order-level invoices only — consolidated are computed on-the-fly)
 *   - app_settings  (supplier details, VAT config)
 *   - users         (restaurant profiles with address, phone, email)
 *
 * Invoice Types stored:
 *   - "order" — auto-generated per restaurant order
 *
 * Discount Model:
 *   - discount_type:  'none' | 'amount' | 'percentage'
 *   - discount_value: number (£ or %)
 *   - discount_amount: calculated £ discount
 */

import {
    collection,
    doc,
    getDoc,
    getDocs,
    setDoc,
    addDoc,
    updateDoc,
    query,
    where,
    serverTimestamp,
    Timestamp,
} from 'firebase/firestore';
import { db } from '../firebase';

// ─── COLLECTIONS ───
const INVOICES = 'invoices';
const ORDERS = 'orders';
const APP_SETTINGS = 'app_settings';

// ═══════════════════════════════════════════════════════
//  SUPPLIER / COMPANY SETTINGS
// ═══════════════════════════════════════════════════════

const DEFAULT_SUPPLIER = {
    name: 'Watan Central Kitchen',
    address: 'Central Kitchen, London, UK',
    vat_number: '',
    phone: '',
    email: '',
};

/**
 * Get the supplier (company) details from Firestore settings.
 * Falls back to defaults if not configured.
 */
export const getSupplierDetails = async () => {
    try {
        const snap = await getDoc(doc(db, APP_SETTINGS, 'supplier'));
        if (snap.exists()) {
            return { ...DEFAULT_SUPPLIER, ...snap.data() };
        }
    } catch (err) {
        console.error('Failed to load supplier settings:', err);
    }
    return DEFAULT_SUPPLIER;
};

/**
 * Save/update supplier details.
 */
export const saveSupplierDetails = async (details) => {
    await setDoc(doc(db, APP_SETTINGS, 'supplier'), {
        ...details,
        updated_at: serverTimestamp(),
    }, { merge: true });
};

// ═══════════════════════════════════════════════════════
//  INVOICE NUMBER GENERATION
// ═══════════════════════════════════════════════════════

const generateInvoiceNumber = async (prefix = 'INV') => {
    const year = new Date().getFullYear();
    const invoicesRef = collection(db, INVOICES);
    const snap = await getDocs(invoicesRef);
    const num = snap.size + 1;
    return `${prefix}-${year}-${String(num).padStart(4, '0')}`;
};

// ═══════════════════════════════════════════════════════
//  TIMESTAMP HELPERS
// ═══════════════════════════════════════════════════════

const convertTimestamp = (ts) => {
    if (!ts) return null;
    if (ts.toDate) return ts.toDate();
    if (ts instanceof Date) return ts;
    return new Date(ts);
};

// ═══════════════════════════════════════════════════════
//  VAT HELPERS
// ═══════════════════════════════════════════════════════

/**
 * Build VAT summary from line items.
 */
const buildVatSummary = (lineItems) => {
    const vatMap = {};
    lineItems.forEach(li => {
        const key = li.vat_exempt ? 'exempt' : `${li.vat_rate}`;
        if (!vatMap[key]) {
            vatMap[key] = {
                rate: li.vat_rate,
                label: li.vat_exempt ? 'Exempt' : `${li.vat_rate}%`,
                net: 0,
                vat: 0,
            };
        }
        vatMap[key].net += li.net_amount;
        vatMap[key].vat += li.vat_amount;
    });
    return Object.values(vatMap).map(v => ({
        ...v,
        net: Math.round(v.net * 100) / 100,
        vat: Math.round(v.vat * 100) / 100,
    }));
};

/**
 * Recalculate totals for line items + discount.
 */
const calculateTotals = (lineItems, discountType = 'none', discountValue = 0) => {
    const subtotal = lineItems.reduce((sum, li) => sum + li.net_amount, 0);
    const totalVat = lineItems.reduce((sum, li) => sum + li.vat_amount, 0);
    const preDiscountTotal = subtotal + totalVat;

    let discountAmount = 0;
    if (discountType === 'amount') {
        discountAmount = Math.min(discountValue || 0, preDiscountTotal);
    } else if (discountType === 'percentage') {
        discountAmount = preDiscountTotal * ((discountValue || 0) / 100);
    }

    const grandTotal = preDiscountTotal - discountAmount;

    return {
        subtotal: Math.round(subtotal * 100) / 100,
        total_vat: Math.round(totalVat * 100) / 100,
        discount_type: discountType,
        discount_value: discountValue || 0,
        discount_amount: Math.round(discountAmount * 100) / 100,
        grand_total: Math.round(grandTotal * 100) / 100,
    };
};

// ═══════════════════════════════════════════════════════
//  FETCH RESTAURANT USER PROFILE
// ═══════════════════════════════════════════════════════

/**
 * Get a restaurant's user profile (address, phone, email, etc.)
 */
const getRestaurantProfile = async (restaurantId) => {
    if (!restaurantId) return null;
    try {
        // Try direct doc lookup first
        const userSnap = await getDoc(doc(db, 'users', restaurantId));
        if (userSnap.exists()) {
            return { id: userSnap.id, ...userSnap.data() };
        }
        // Fallback: query by restaurant_id field
        const q = query(collection(db, 'users'), where('restaurant_id', '==', restaurantId));
        const snap = await getDocs(q);
        if (snap.size > 0) {
            return { id: snap.docs[0].id, ...snap.docs[0].data() };
        }
    } catch (err) {
        console.error('Failed to fetch restaurant profile:', err);
    }
    return null;
};

// ═══════════════════════════════════════════════════════
//  GENERATE ORDER INVOICE
// ═══════════════════════════════════════════════════════

/**
 * Generate a VAT-compliant invoice for a specific order.
 *
 * @param {string} orderId — Firestore order document ID
 * @returns {Object} — The created invoice document
 */
export const generateOrderInvoice = async (orderId) => {
    // 1. Fetch order
    const orderSnap = await getDoc(doc(db, ORDERS, orderId));
    if (!orderSnap.exists()) throw new Error('Order not found');
    const order = { id: orderSnap.id, ...orderSnap.data() };

    // 2. Check if invoice already exists for this order
    const existingQ = query(
        collection(db, INVOICES),
        where('type', '==', 'order'),
        where('order_id', '==', orderId)
    );
    const existingSnap = await getDocs(existingQ);
    if (existingSnap.size > 0) {
        // Return existing invoice
        const existing = existingSnap.docs[0];
        return { id: existing.id, ...existing.data() };
    }

    // 3. Get supplier details
    const supplier = await getSupplierDetails();

    // 4. Get restaurant profile for billing info
    const restaurantProfile = await getRestaurantProfile(order.restaurant_id);

    // 5. Generate invoice number
    const invoiceNumber = await generateInvoiceNumber('INV');

    // 6. Build line items with VAT
    const lineItems = (order.items || []).map(item => {
        const netAmount = (item.selling_price || 0) * (item.quantity || 0);
        const vatRate = item.vat_exempt ? 0 : (item.vat_rate ?? 20);
        const vatAmount = netAmount * (vatRate / 100);
        return {
            item_id: item.item_id,
            description: item.item_name,
            item_type: item.item_type || 'grocery',
            category_name: item.category_name || '',
            quantity: item.quantity || 0,
            unit: item.unit || 'kg',
            unit_price: item.selling_price || 0,
            vat_rate: vatRate,
            vat_exempt: item.vat_exempt || false,
            net_amount: Math.round(netAmount * 100) / 100,
            vat_amount: Math.round(vatAmount * 100) / 100,
            gross_amount: Math.round((netAmount + vatAmount) * 100) / 100,
        };
    });

    // 7. VAT Summary
    const vatSummary = buildVatSummary(lineItems);

    // 8. Calculate totals (no discount initially)
    const totals = calculateTotals(lineItems);

    // 9. Build the invoice document
    const invoiceDate = new Date();
    const supplyDate = convertTimestamp(order.ready_at) || convertTimestamp(order.created_at) || invoiceDate;

    const invoice = {
        invoice_number: invoiceNumber,
        type: 'order',
        // Order reference
        order_id: orderId,
        order_number: order.order_number || '',
        // Parties
        supplier: {
            name: supplier.name,
            address: supplier.address,
            vat_number: supplier.vat_number,
            phone: supplier.phone || '',
            email: supplier.email || '',
        },
        customer: {
            name: restaurantProfile?.name || order.restaurant_name || '',
            restaurant_name: restaurantProfile?.restaurant_name || order.restaurant_name || '',
            restaurant_id: order.restaurant_id || '',
            address: restaurantProfile?.address || '',
            vat_number: restaurantProfile?.vat_number || '',
            email: restaurantProfile?.email || '',
            phone: restaurantProfile?.phone || '',
        },
        // Dates
        invoice_date: Timestamp.fromDate(invoiceDate),
        supply_date: Timestamp.fromDate(supplyDate instanceof Date ? supplyDate : new Date(supplyDate)),
        // Line items & VAT
        line_items: lineItems,
        vat_summary: vatSummary,
        // Totals
        ...totals,
        // Discount (default: none)
        discount_type: 'none',
        discount_value: 0,
        discount_amount: 0,
        // Status
        status: 'issued',
        xero_status: null,
        xero_invoice_id: null,
        // Notes
        notes: order.notes || '',
        // Timestamps
        created_at: serverTimestamp(),
        updated_at: serverTimestamp(),
    };

    // 10. Save to Firestore
    const docRef = await addDoc(collection(db, INVOICES), invoice);

    // 11. Update the order with the invoice number
    await updateDoc(doc(db, ORDERS, orderId), {
        invoice_number: invoiceNumber,
        invoice_id: docRef.id,
        updated_at: serverTimestamp(),
    });

    return { id: docRef.id, ...invoice };
};

// ═══════════════════════════════════════════════════════
//  REGENERATE INVOICE VAT FROM ORDER DATA
// ═══════════════════════════════════════════════════════

/**
 * Regenerate an invoice's line item VAT rates from its source order.
 * This fixes invoices that were generated before items had correct VAT rates.
 *
 * @param {string} invoiceId — Firestore invoice document ID
 * @returns {{ updated: boolean, changes: number }}
 */
export const regenerateInvoiceFromOrder = async (invoiceId) => {
    const invoiceSnap = await getDoc(doc(db, INVOICES, invoiceId));
    if (!invoiceSnap.exists()) throw new Error('Invoice not found');
    const invoice = invoiceSnap.data();

    if (invoice.type !== 'order' || !invoice.order_id) {
        return { updated: false, changes: 0 };
    }

    // Fetch the source order
    const orderSnap = await getDoc(doc(db, ORDERS, invoice.order_id));
    if (!orderSnap.exists()) {
        return { updated: false, changes: 0, reason: 'Order not found' };
    }
    const order = orderSnap.data();

    // Build a lookup from order items: item_id → { vat_rate, vat_exempt }
    const orderVatMap = {};
    (order.items || []).forEach(item => {
        orderVatMap[item.item_id] = {
            vat_rate: item.vat_rate ?? 0,
            vat_exempt: item.vat_exempt || false,
        };
    });

    // Update invoice line items with correct VAT from order
    let changes = 0;
    const updatedLineItems = (invoice.line_items || []).map(li => {
        const orderVat = orderVatMap[li.item_id];
        if (!orderVat) return li;

        const currentRate = li.vat_rate ?? 20;
        const correctRate = orderVat.vat_exempt ? 0 : orderVat.vat_rate;

        if (currentRate !== correctRate || li.vat_exempt !== orderVat.vat_exempt) {
            changes++;
            const netAmount = li.net_amount || ((li.unit_price || 0) * (li.quantity || 0));
            const vatAmount = netAmount * (correctRate / 100);
            return {
                ...li,
                vat_rate: correctRate,
                vat_exempt: orderVat.vat_exempt,
                vat_amount: Math.round(vatAmount * 100) / 100,
                gross_amount: Math.round((netAmount + vatAmount) * 100) / 100,
            };
        }
        return li;
    });

    if (changes === 0) return { updated: false, changes: 0 };

    // Recalculate totals
    const vatSummary = buildVatSummary(updatedLineItems);
    const totals = calculateTotals(updatedLineItems, invoice.discount_type, invoice.discount_value);

    await updateDoc(doc(db, INVOICES, invoiceId), {
        line_items: updatedLineItems,
        vat_summary: vatSummary,
        ...totals,
        updated_at: serverTimestamp(),
    });

    return { updated: true, changes };
};

/**
 * Regenerate VAT rates on ALL order invoices from their source orders.
 * @returns {{ total: number, updated: number, skipped: number, errors: number }}
 */
export const regenerateAllInvoiceVat = async () => {
    const q = query(collection(db, INVOICES), where('type', '==', 'order'));
    const snap = await getDocs(q);

    const results = { total: snap.size, updated: 0, skipped: 0, errors: 0 };

    for (const invDoc of snap.docs) {
        try {
            const result = await regenerateInvoiceFromOrder(invDoc.id);
            if (result.updated) {
                results.updated++;
                console.log(`✅ Fixed ${result.changes} VAT rate(s) on invoice ${invDoc.data().invoice_number}`);
            } else {
                results.skipped++;
            }
        } catch (err) {
            results.errors++;
            console.error(`❌ Failed to fix invoice ${invDoc.id}:`, err);
        }
    }

    console.log(`🔄 VAT regeneration complete: ${results.updated} fixed, ${results.skipped} already correct, ${results.errors} errors (out of ${results.total})`);
    return results;
};

// ═══════════════════════════════════════════════════════
//  UPDATE INVOICE (EDIT)
// ═══════════════════════════════════════════════════════

/**
 * Update an invoice's line items, discount, and recalculate totals.
 *
 * @param {string} invoiceId
 * @param {Object} updates — { line_items, discount_type, discount_value, notes }
 */
export const updateInvoice = async (invoiceId, updates) => {
    const { line_items, discount_type, discount_value, notes } = updates;

    // Recalculate line item amounts
    const recalculatedItems = (line_items || []).map(item => {
        const netAmount = (item.unit_price || 0) * (item.quantity || 0);
        const vatRate = item.vat_exempt ? 0 : (item.vat_rate ?? 20);
        const vatAmount = netAmount * (vatRate / 100);
        return {
            ...item,
            net_amount: Math.round(netAmount * 100) / 100,
            vat_amount: Math.round(vatAmount * 100) / 100,
            gross_amount: Math.round((netAmount + vatAmount) * 100) / 100,
        };
    });

    // Recalculate VAT summary
    const vatSummary = buildVatSummary(recalculatedItems);

    // Recalculate totals with discount
    const totals = calculateTotals(recalculatedItems, discount_type || 'none', discount_value || 0);

    const updateData = {
        line_items: recalculatedItems,
        vat_summary: vatSummary,
        ...totals,
        updated_at: serverTimestamp(),
    };

    if (notes !== undefined) {
        updateData.notes = notes;
    }

    await updateDoc(doc(db, INVOICES, invoiceId), updateData);

    return { id: invoiceId, ...updateData };
};

// ═══════════════════════════════════════════════════════
//  CONSOLIDATED DATA (DYNAMIC — NOT STORED)
// ═══════════════════════════════════════════════════════

/**
 * Get consolidated invoice data for a restaurant over a date range.
 * This is computed on-the-fly, NOT stored in Firestore.
 *
 * @param {string} restaurantId
 * @param {string|Date} dateFrom
 * @param {string|Date} dateTo
 * @returns {{ invoices: Array, aggregated: Object, byDate: Object }}
 */
export const getConsolidatedData = async (restaurantId, dateFrom, dateTo) => {
    // 1. Fetch all order invoices for this restaurant
    const constraints = [
        where('type', '==', 'order'),
        where('customer.restaurant_id', '==', restaurantId),
    ];

    const q = query(collection(db, INVOICES), ...constraints);
    const snap = await getDocs(q);

    const from = new Date(dateFrom);
    from.setHours(0, 0, 0, 0);
    const to = new Date(dateTo);
    to.setHours(23, 59, 59, 999);

    // 2. Filter by date range client-side
    let invoices = snap.docs.map(d => {
        const data = d.data();
        return {
            id: d.id,
            ...data,
            invoice_date: convertTimestamp(data.invoice_date),
            supply_date: convertTimestamp(data.supply_date),
            created_at: convertTimestamp(data.created_at),
            updated_at: convertTimestamp(data.updated_at),
        };
    }).filter(inv => {
        const invDate = inv.invoice_date || inv.created_at;
        return invDate && invDate >= from && invDate <= to;
    });

    // Sort by date ascending
    invoices.sort((a, b) => (a.invoice_date || 0) - (b.invoice_date || 0));

    // 3. Group by date
    const byDate = {};
    invoices.forEach(inv => {
        const dateKey = (inv.invoice_date || inv.created_at).toLocaleDateString('en-GB', {
            day: '2-digit', month: 'short', year: 'numeric'
        });
        if (!byDate[dateKey]) {
            byDate[dateKey] = [];
        }
        byDate[dateKey].push(inv);
    });

    // 4. Aggregate totals
    const aggregated = {
        invoice_count: invoices.length,
        subtotal: 0,
        total_vat: 0,
        total_discount: 0,
        grand_total: 0,
    };

    // 5. Aggregate line items across all invoices
    const itemMap = {};
    invoices.forEach(inv => {
        aggregated.subtotal += inv.subtotal || 0;
        aggregated.total_vat += inv.total_vat || 0;
        aggregated.total_discount += inv.discount_amount || 0;
        aggregated.grand_total += inv.grand_total || 0;

        (inv.line_items || []).forEach(item => {
            const key = item.item_id || item.description;
            if (!itemMap[key]) {
                itemMap[key] = {
                    ...item,
                    quantity: 0,
                    net_amount: 0,
                    vat_amount: 0,
                    gross_amount: 0,
                };
            }
            itemMap[key].quantity += item.quantity || 0;
            itemMap[key].net_amount += item.net_amount || 0;
            itemMap[key].vat_amount += item.vat_amount || 0;
            itemMap[key].gross_amount += item.gross_amount || 0;
        });
    });

    // Round aggregated values
    aggregated.subtotal = Math.round(aggregated.subtotal * 100) / 100;
    aggregated.total_vat = Math.round(aggregated.total_vat * 100) / 100;
    aggregated.total_discount = Math.round(aggregated.total_discount * 100) / 100;
    aggregated.grand_total = Math.round(aggregated.grand_total * 100) / 100;

    const aggregatedItems = Object.values(itemMap).map(item => ({
        ...item,
        net_amount: Math.round(item.net_amount * 100) / 100,
        vat_amount: Math.round(item.vat_amount * 100) / 100,
        gross_amount: Math.round(item.gross_amount * 100) / 100,
    })).sort((a, b) => (a.description || '').localeCompare(b.description || ''));

    aggregated.line_items = aggregatedItems;
    aggregated.vat_summary = buildVatSummary(aggregatedItems);

    return { invoices, aggregated, byDate };
};

// ═══════════════════════════════════════════════════════
//  FETCH INVOICES
// ═══════════════════════════════════════════════════════

/**
 * Fetch invoices with optional filters.
 * @param {Object} filters — { type, restaurant_id, date_from, date_to, status }
 */
export const getInvoices = async (filters = {}) => {
    const constraints = [];

    if (filters.type) {
        constraints.push(where('type', '==', filters.type));
    }
    if (filters.restaurant_id) {
        constraints.push(where('customer.restaurant_id', '==', filters.restaurant_id));
    }

    const q = query(collection(db, INVOICES), ...constraints);
    const snap = await getDocs(q);

    let invoices = snap.docs.map(d => {
        const data = d.data();
        return {
            id: d.id,
            ...data,
            invoice_date: convertTimestamp(data.invoice_date),
            supply_date: convertTimestamp(data.supply_date),
            date_from: convertTimestamp(data.date_from),
            date_to: convertTimestamp(data.date_to),
            created_at: convertTimestamp(data.created_at),
            updated_at: convertTimestamp(data.updated_at),
        };
    });

    // Client-side date filtering
    if (filters.date_from) {
        const from = new Date(filters.date_from);
        from.setHours(0, 0, 0, 0);
        invoices = invoices.filter(inv => inv.invoice_date && inv.invoice_date >= from);
    }
    if (filters.date_to) {
        const to = new Date(filters.date_to);
        to.setHours(23, 59, 59, 999);
        invoices = invoices.filter(inv => inv.invoice_date && inv.invoice_date <= to);
    }
    if (filters.status) {
        invoices = invoices.filter(inv => inv.status === filters.status);
    }

    // Sort newest first
    invoices.sort((a, b) => (b.invoice_date || 0) - (a.invoice_date || 0));
    return invoices;
};

/**
 * Get a single invoice by ID.
 */
export const getInvoiceById = async (invoiceId) => {
    const snap = await getDoc(doc(db, INVOICES, invoiceId));
    if (!snap.exists()) return null;
    const data = snap.data();
    return {
        id: snap.id,
        ...data,
        invoice_date: convertTimestamp(data.invoice_date),
        supply_date: convertTimestamp(data.supply_date),
        date_from: convertTimestamp(data.date_from),
        date_to: convertTimestamp(data.date_to),
        created_at: convertTimestamp(data.created_at),
        updated_at: convertTimestamp(data.updated_at),
    };
};

/**
 * Update invoice status (e.g., paid, void).
 */
export const updateInvoiceStatus = async (invoiceId, status) => {
    await updateDoc(doc(db, INVOICES, invoiceId), {
        status,
        updated_at: serverTimestamp(),
    });
};

// ═══════════════════════════════════════════════════════
//  FETCH RESTAURANTS LIST
// ═══════════════════════════════════════════════════════

/**
 * Get all restaurant users for dropdown filters.
 */
export const getRestaurantUsers = async () => {
    try {
        const q = query(
            collection(db, 'users'),
            where('role', 'in', ['restaurant_manager', 'restaurant_manager_non_managed'])
        );
        const snap = await getDocs(q);
        return snap.docs.map(d => ({
            id: d.id,
            name: d.data().restaurant_name || d.data().name || 'Unnamed Restaurant',
            email: d.data().email || '',
            phone: d.data().phone || '',
            address: d.data().address || '',
        })).sort((a, b) => a.name.localeCompare(b.name));
    } catch (err) {
        console.error('Failed to load restaurants', err);
        return [];
    }
};
