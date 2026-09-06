import { addDoc, collection, doc, getDoc, getDocs, increment, query, serverTimestamp, updateDoc, where, writeBatch } from 'firebase/firestore';
import { db } from '../firebase';
import { addStockFromDelivery, deductRestaurantStock, getRestaurantItem } from './restaurantInventoryService';

const TRANSFERS = 'stock_transfers';
const CREDITS = 'stock_transfer_credits';

const normalise = (d) => ({ id: d.id, ...d.data(), created_at: d.data().created_at?.toDate?.() || null, accepted_at: d.data().accepted_at?.toDate?.() || null, received_at: d.data().received_at?.toDate?.() || null });

export const getRestaurantDirectory = async (excludeId) => {
  const snap = await getDocs(collection(db, 'users'));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }))
    .filter(u => u.id !== excludeId && u.restaurant_id !== excludeId && (u.role === 'restaurant_manager' || u.role === 'restaurant_manager_non_managed'))
    .map(u => ({
      id: u.id,
      restaurant_id: u.restaurant_id || u.id,
      name: u.restaurant_name || u.name || u.email || 'Restaurant',
      user_id: u.id,
    }));
};

export const createStockTransfer = async ({ borrower, lender, items, notes = '' }) => {
  if (!lender?.id || !items?.length) throw new Error('Choose a restaurant and at least one item');
  const cleaned = items.filter(i => Number(i.quantity) > 0).map(i => ({
    ...i,
    item_id: i.item_id || i.id || '',
    item_name: i.item_name || i.name || '',
    requested_quantity: Number(i.quantity),
    quantity: Number(i.quantity),
    sent_quantity: 0,
  }));
  if (!cleaned.length) throw new Error('Enter a quantity for at least one item');
  const ref = await addDoc(collection(db, TRANSFERS), {
    borrower_id: borrower.id,
    borrower_name: borrower.name,
    lender_id: lender.id,
    lender_name: lender.name,
    items: cleaned,
    notes,
    status: 'requested',
    created_at: serverTimestamp(),
    updated_at: serverTimestamp(),
  });
  return ref.id;
};

export const getStockTransfers = async (restaurantId, userProfile = null) => {
  const snap = await getDocs(collection(db, TRANSFERS));
  const candidateIds = new Set([
    restaurantId,
    userProfile?.id,
    userProfile?.restaurant_id,
    userProfile?.restaurant_name,
  ].filter(Boolean));

  return snap.docs.map(normalise).filter(t => {
    return candidateIds.has(t.borrower_id) ||
           candidateIds.has(t.lender_id) ||
           (userProfile?.restaurant_name && (
             t.borrower_name?.toLowerCase() === userProfile.restaurant_name.toLowerCase() ||
             t.lender_name?.toLowerCase() === userProfile.restaurant_name.toLowerCase()
           ));
  }).sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
};

export const rejectStockTransfer = (id, reason) => {
  if (!reason?.trim()) throw new Error('A rejection reason is required');
  return updateDoc(doc(db, TRANSFERS, id), { status: 'rejected', rejection_reason: reason.trim(), rejected_at: serverTimestamp(), updated_at: serverTimestamp() });
};

export const acceptStockTransfer = async (transfer, items) => {
  const transferRef = doc(db, TRANSFERS, transfer.id);
  const snap = await getDoc(transferRef);
  if (!snap.exists()) throw new Error('Transfer not found');
  const fresh = snap.data();
  if (fresh.status !== 'requested') {
    throw new Error(`Transfer has already been ${fresh.status}`);
  }

  // Atomically lock status to 'accepting' to prevent concurrent/double deductions
  await updateDoc(transferRef, {
    status: 'accepting',
    updated_at: serverTimestamp(),
  });

  try {
    const approved = items.filter(i => Number(i.sent_quantity) > 0).map(i => {
      const qty = Math.round(Number(i.sent_quantity) * 100) / 100;
      const cost = Number(i.cost_price || 0);
      return {
        ...i,
        item_id: i.item_id || i.id || '',
        item_name: i.item_name || i.name || '',
        sent_quantity: qty,
        value: Math.round(qty * cost * 100) / 100,
      };
    });
    if (!approved.length) throw new Error('Enter a quantity being sent');

    // Verify stock for all approved items
    const matchedStockItems = [];
    for (const item of approved) {
      const stock = await getRestaurantItem(transfer.lender_id, item, item.item_name);
      if (!stock) {
        throw new Error(`"${item.item_name}" was not found in ${transfer.lender_name || 'lender'}'s inventory.`);
      }
      const currentStock = Number(stock.current_stock || 0);
      if (currentStock < item.sent_quantity) {
        throw new Error(`Insufficient stock for ${item.item_name}. Available: ${currentStock} ${stock.unit || item.unit || ''}, Requested: ${item.sent_quantity}`);
      }
      matchedStockItems.push({ item, stock });
    }

    // Deduct stock for all approved items using exact stock document ID
    for (const { item, stock } of matchedStockItems) {
      await deductRestaurantStock(transfer.lender_id, stock.id, item.sent_quantity, `Stock transfer ${transfer.id}`, item.item_name);
    }

    const total = Math.round(approved.reduce((sum, i) => sum + i.value, 0) * 100) / 100;
    await updateDoc(transferRef, {
      status: 'accepted',
      items: approved,
      total_value: total,
      accepted_at: serverTimestamp(),
      updated_at: serverTimestamp(),
    });
  } catch (err) {
    await updateDoc(transferRef, { status: 'requested', updated_at: serverTimestamp() });
    throw err;
  }
};

export const receiveStockTransfer = async (transfer) => {
  const transferRef = doc(db, TRANSFERS, transfer.id);
  const snap = await getDoc(transferRef);
  if (!snap.exists()) throw new Error('Transfer not found');
  const fresh = snap.data();
  if (fresh.status !== 'accepted') {
    throw new Error(`Transfer has already been ${fresh.status}`);
  }

  // Atomically lock status to 'receiving' to prevent concurrent delivery additions
  await updateDoc(transferRef, {
    status: 'receiving',
    updated_at: serverTimestamp(),
  });

  try {
    const itemsToReceive = (fresh.items || transfer.items || []).map(i => ({
      ...i,
      quantity: Math.round(Number(i.sent_quantity || i.quantity || 0) * 100) / 100,
    }));

    await addStockFromDelivery(transfer.borrower_id, itemsToReceive, `Transfer ${transfer.id}`);

    const batch = writeBatch(db);
    batch.update(transferRef, {
      status: 'received',
      received_at: serverTimestamp(),
      updated_at: serverTimestamp(),
    });
    batch.set(doc(collection(db, CREDITS)), {
      transfer_id: transfer.id,
      restaurant_id: transfer.lender_id,
      restaurant_name: transfer.lender_name,
      borrower_id: transfer.borrower_id,
      amount: fresh.total_value || transfer.total_value || 0,
      remaining_amount: fresh.total_value || transfer.total_value || 0,
      status: 'available',
      created_at: serverTimestamp(),
    });
    await batch.commit();
  } catch (err) {
    await updateDoc(transferRef, { status: 'accepted', updated_at: serverTimestamp() });
    throw err;
  }
};

export const getAvailableCredits = async (restaurantId) => {
  const snap = await getDocs(query(collection(db, CREDITS), where('restaurant_id', '==', restaurantId)));
  return snap.docs.map(normalise).filter(c => c.status === 'available' && Number(c.remaining_amount) > 0);
};

export const applyCreditsToInvoice = async (invoiceId, credits) => {
  const selected = credits.filter(c => Number(c.apply_amount) > 0 && Number(c.apply_amount) <= Number(c.remaining_amount));
  const total = Math.round(selected.reduce((sum, c) => sum + Number(c.apply_amount), 0) * 100) / 100;
  if (!selected.length) throw new Error('Select a valid credit amount');
  const batch = writeBatch(db);
  selected.forEach(c => batch.update(doc(db, CREDITS, c.id), {
    remaining_amount: Math.round((Number(c.remaining_amount) - Number(c.apply_amount)) * 100) / 100,
    status: Math.round((Number(c.remaining_amount) - Number(c.apply_amount)) * 100) / 100 <= 0 ? 'applied' : 'available',
    updated_at: serverTimestamp(),
  }));
  // Use increment() so multiple credit applications stack correctly on the invoice
  batch.update(doc(db, 'invoices', invoiceId), {
    credit_applied: increment(total),
    credit_applications: selected.map(c => ({ credit_id: c.id, amount: Number(c.apply_amount) })),
    updated_at: serverTimestamp(),
  });
  await batch.commit();
  return total;
};

export const getStockTransferAnalytics = async () => {
  const transfers = (await getDocs(collection(db, TRANSFERS))).docs.map(normalise).filter(t => t.status === 'received');
  const itemMap = {};
  transfers.forEach(t => (t.items || []).forEach(i => { itemMap[i.item_name] = (itemMap[i.item_name] || 0) + Number(i.sent_quantity || 0); }));
  return { totalBorrowedValue: transfers.reduce((s, t) => s + Number(t.total_value || 0), 0), netCreditsEarned: transfers.reduce((s, t) => s + Number(t.total_value || 0), 0), mostBorrowed: Object.entries(itemMap).map(([name, quantity]) => ({ name, quantity })).sort((a, b) => b.quantity - a.quantity).slice(0, 10) };
};
