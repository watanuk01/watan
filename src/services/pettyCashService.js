import { addDoc, collection, getDocs, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase';
import { addBatch, adjustStock, addItem } from './inventoryService';

const PURCHASES = 'petty_cash_purchases';

/**
 * Generate a unique petty cash invoice number: PC-YYYY-NNNN
 */
const generatePCInvoiceNumber = async () => {
  const year = new Date().getFullYear();
  const snap = await getDocs(collection(db, PURCHASES));
  const num = snap.size + 1;
  return `PC-${year}-${String(num).padStart(4, '0')}`;
};

/**
 * Save a petty cash purchase, update stock, and generate an invoice record.
 */
export const savePettyCashPurchase = async ({ items, payment_method, receipt_base64, created_by, notes = '' }) => {
  const lines = items
    .filter(i => Number(i.quantity) > 0 && Number(i.unit_price) >= 0)
    .map(i => ({
      ...i,
      quantity: Number(i.quantity),
      unit_price: Number(i.unit_price),
      total: Math.round(Number(i.quantity) * Number(i.unit_price) * 100) / 100,
    }));

  if (!lines.length) throw new Error('Add at least one item');

  // ── Stock adjustments ──
  for (const item of lines) {
    let itemId = item.id;

    // If custom/new item, create it in inventory first
    if (item.is_custom || (itemId && String(itemId).startsWith('custom_'))) {
      const created = await addItem({
        name: item.name || item.item_name,
        item_type: item.item_type || 'grocery',
        unit: item.unit || 'kg',
        cost_price: Number(item.unit_price) || 0,
        current_stock: 0,
        category_name: item.category_name || 'Quick Purchase',
      });
      itemId = created.id;
      item.id = itemId;
    }

    if (item.item_type === 'raw_meat') {
      await addBatch({
        item_id: itemId,
        item_name: item.name,
        item_type: item.item_type,
        quantity: item.quantity,
        unit: item.unit,
        cost_price: item.unit_price,
        source: 'petty_cash',
        notes: 'Quick purchase',
      });
    } else {
      await adjustStock(itemId, item.quantity, 'Quick purchase');
    }
  }

  // ── Build invoice data ──
  const total = Math.round(lines.reduce((s, i) => s + i.total, 0) * 100) / 100;
  const invoiceNumber = await generatePCInvoiceNumber();

  // Build line_items in invoice format (matching InvoiceDetail expectations)
  const invoiceLineItems = lines.map(item => ({
    description: item.name || item.item_name || 'Item',
    quantity: item.quantity,
    unit: item.unit || 'unit',
    unit_price: item.unit_price,
    net_amount: item.total,
    vat_rate: 0,
    vat_exempt: true,
    vat_amount: 0,
    gross_amount: item.total,
    is_custom: item.is_custom || false,
    category_name: item.category_name || '',
  }));

  const purchaseDoc = {
    // Purchase fields
    items: lines,
    payment_method,
    receipt_base64: receipt_base64 || '',
    total,
    notes,
    created_by,
    created_at: serverTimestamp(),

    // Invoice fields
    invoice_number: invoiceNumber,
    type: 'petty_cash',
    line_items: invoiceLineItems,
    subtotal: total,
    total_vat: 0,
    grand_total: total,
    status: 'paid', // petty cash is always paid immediately
    invoice_date: new Date().toISOString(),
    supplier: {
      name: 'Local Vendor / Emergency Purchase',
    },
    customer: {
      name: 'Central Kitchen',
      restaurant_name: 'Watan Central Kitchen',
    },
  };

  const ref = await addDoc(collection(db, PURCHASES), purchaseDoc);
  return { id: ref.id, invoiceNumber };
};

/**
 * Get all petty cash purchases (most recent first).
 */
export const getPettyCashPurchases = async () => {
  const snap = await getDocs(collection(db, PURCHASES));
  return snap.docs
    .map(d => ({
      id: d.id,
      ...d.data(),
      created_at: d.data().created_at?.toDate?.() || null,
    }))
    .sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
};

/**
 * Analytics for petty cash spending.
 */
export const getPettyCashAnalytics = async () => {
  const purchases = await getPettyCashPurchases();
  const categories = {};
  let cash = 0;
  let card = 0;

  purchases.forEach(p => {
    if (p.payment_method === 'Cash') cash += Number(p.total || 0);
    else card += Number(p.total || 0);

    (p.items || []).forEach(i => {
      const k = i.category_name || i.item_type || 'Other';
      categories[k] = (categories[k] || 0) + Number(i.total || 0);
    });
  });

  return {
    total: cash + card,
    cash,
    card,
    categories: Object.entries(categories).map(([name, value]) => ({ name, value })),
  };
};
