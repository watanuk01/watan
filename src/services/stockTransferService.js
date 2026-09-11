import { addDoc, collection, doc, getDoc, getDocs, increment, query, serverTimestamp, updateDoc, where, writeBatch } from 'firebase/firestore';
import { db } from '../firebase';
import { addStockFromDelivery, deductRestaurantStock, getRestaurantItem } from './restaurantInventoryService';

const TRANSFERS = 'stock_transfers';
const CREDITS = 'stock_transfer_credits';

const parseDate = (val) => {
  if (!val) return null;
  if (val instanceof Date) return val;
  if (val.toDate && typeof val.toDate === 'function') return val.toDate();
  if (val.seconds) return new Date(val.seconds * 1000);
  const d = new Date(val);
  return isNaN(d.getTime()) ? null : d;
};

const normalise = (d) => {
  const data = d.data();
  return {
    id: d.id,
    ...data,
    created_at: parseDate(data.created_at),
    accepted_at: parseDate(data.accepted_at),
    received_at: parseDate(data.received_at),
    rejected_at: parseDate(data.rejected_at),
  };
};

export const getRestaurantDirectory = async (excludeId) => {
  const snap = await getDocs(collection(db, 'users'));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }))
    .filter(u => u.id !== excludeId && u.restaurant_id !== excludeId && (u.role === 'restaurant_manager' || u.role === 'restaurant_manager_non_managed'))
    .map(u => ({
      id: u.restaurant_id || u.id,
      restaurant_id: u.restaurant_id || u.id,
      name: u.restaurant_name || u.name || u.email || 'Restaurant',
      user_id: u.id,
    }));
};

export const createStockTransfer = async ({ borrower, lender, items, notes = '', requestedBy = null }) => {
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
    requested_by: requestedBy || { id: '', name: borrower.name || 'Restaurant user' },
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

export const getStockTransferAnalytics = async (filters = {}) => {
  const rawSnap = await getDocs(collection(db, TRANSFERS));
  const rawTransfers = rawSnap.docs.map(normalise);

  const filteredTransfers = rawTransfers.filter(transfer => {
    // Check date filter against created_at, accepted_at, or received_at
    const tDate = transfer.created_at || transfer.accepted_at || transfer.received_at;
    if (filters.dateFrom && (!tDate || tDate < filters.dateFrom)) return false;
    if (filters.dateTo && (!tDate || tDate > filters.dateTo)) return false;

    // Check restaurant filter (matches if restaurant is lender OR borrower)
    if (filters.restaurantId || filters.restaurantName) {
      const targets = [filters.restaurantId, filters.restaurantName]
        .filter(Boolean)
        .map(v => String(v).trim().toLowerCase());

      const transferRefs = [
        transfer.borrower_id,
        transfer.lender_id,
        transfer.borrower_name,
        transfer.lender_name,
      ].filter(Boolean).map(v => String(v).trim().toLowerCase());

      const matches = targets.some(target =>
        transferRefs.some(ref => ref === target || ref.includes(target) || target.includes(ref))
      );
      if (!matches) return false;
    }
    return true;
  });

  const completed = filteredTransfers.filter(t => t.status === 'received');
  const statusCounts = {
    requested: filteredTransfers.filter(t => t.status === 'requested').length,
    accepted: filteredTransfers.filter(t => t.status === 'accepted' || t.status === 'accepting').length,
    received: completed.length,
    rejected: filteredTransfers.filter(t => t.status === 'rejected').length,
  };

  const totalTransfers = filteredTransfers.length;

  // Item aggregation across all transfers in period (not just received)
  const itemMap = {};
  filteredTransfers.forEach(transfer => {
    (transfer.items || []).forEach(item => {
      const name = item.item_name || item.name || 'Item';
      const unit = item.unit || 'kg';
      const key = `${name}|${unit}`;
      const qty = Number(item.sent_quantity || item.quantity || item.requested_quantity || 0);
      const val = Number(item.value || (qty * (Number(item.cost_price) || 0)) || 0);
      if (!itemMap[key]) {
        itemMap[key] = { name, unit, quantity: 0, completedQuantity: 0, value: 0, count: 0 };
      }
      itemMap[key].quantity += qty;
      itemMap[key].value += val;
      itemMap[key].count += 1;
      if (transfer.status === 'received') {
        itemMap[key].completedQuantity += qty;
      }
    });
  });

  // Route aggregation across transfers in period
  const routeMap = {};
  filteredTransfers.forEach(transfer => {
    const from = (transfer.lender_name || 'Branch').trim();
    const to = (transfer.borrower_name || 'Branch').trim();
    const routeKey = `${from} → ${to}`;
    const val = Number(transfer.total_value || 0);
    const qty = (transfer.items || []).reduce((s, i) => s + Number(i.sent_quantity || i.quantity || 0), 0);
    if (!routeMap[routeKey]) {
      routeMap[routeKey] = { name: routeKey, from, to, count: 0, totalValue: 0, totalQuantity: 0, completedCount: 0 };
    }
    routeMap[routeKey].count += 1;
    routeMap[routeKey].totalValue += val;
    routeMap[routeKey].totalQuantity += qty;
    if (transfer.status === 'received') {
      routeMap[routeKey].completedCount += 1;
    }
  });

  const totalQuantity = filteredTransfers.reduce((sum, transfer) =>
    sum + (transfer.items || []).reduce((itemSum, item) => itemSum + Number(item.sent_quantity || item.quantity || item.requested_quantity || 0), 0), 0);

  const completedQuantity = completed.reduce((sum, transfer) =>
    sum + (transfer.items || []).reduce((itemSum, item) => itemSum + Number(item.sent_quantity || item.quantity || 0), 0), 0);

  const totalBorrowedValue = completed.reduce((sum, transfer) => sum + Number(transfer.total_value || 0), 0);
  const totalPipelineValue = filteredTransfers.reduce((sum, transfer) => sum + Number(transfer.total_value || 0), 0);

  // Branch-specific focus breakdown if a restaurant is selected
  let branchFocus = null;
  if (filters.restaurantName || filters.restaurantId) {
    const targetName = String(filters.restaurantName || filters.restaurantId).trim().toLowerCase();
    const outbound = filteredTransfers.filter(t => {
      const lName = String(t.lender_name || '').toLowerCase();
      const lId = String(t.lender_id || '').toLowerCase();
      return lName.includes(targetName) || targetName.includes(lName) || lId.includes(targetName);
    });
    const inbound = filteredTransfers.filter(t => {
      const bName = String(t.borrower_name || '').toLowerCase();
      const bId = String(t.borrower_id || '').toLowerCase();
      return bName.includes(targetName) || targetName.includes(bName) || bId.includes(targetName);
    });

    const outboundValue = outbound.reduce((s, t) => s + Number(t.total_value || 0), 0);
    const inboundValue = inbound.reduce((s, t) => s + Number(t.total_value || 0), 0);
    const outboundQty = outbound.reduce((s, t) => s + (t.items || []).reduce((is, i) => is + Number(i.sent_quantity || i.quantity || 0), 0), 0);
    const inboundQty = inbound.reduce((s, t) => s + (t.items || []).reduce((is, i) => is + Number(i.sent_quantity || i.quantity || 0), 0), 0);

    branchFocus = {
      restaurantName: filters.restaurantName || 'Selected Restaurant',
      outboundCount: outbound.length,
      outboundValue: Math.round(outboundValue * 100) / 100,
      outboundQty: Math.round(outboundQty * 100) / 100,
      inboundCount: inbound.length,
      inboundValue: Math.round(inboundValue * 100) / 100,
      inboundQty: Math.round(inboundQty * 100) / 100,
      netValue: Math.round((outboundValue - inboundValue) * 100) / 100,
    };
  }

  return {
    totalTransfers,
    completedTransfers: completed.length,
    pendingAction: statusCounts.requested + statusCounts.accepted,
    statusCounts,
    totalQuantity: Math.round(totalQuantity * 100) / 100,
    completedQuantity: Math.round(completedQuantity * 100) / 100,
    totalBorrowedValue: Math.round(totalBorrowedValue * 100) / 100,
    totalPipelineValue: Math.round(totalPipelineValue * 100) / 100,
    branchFocus,
    mostBorrowed: Object.values(itemMap).sort((a, b) => b.quantity - a.quantity).slice(0, 8),
    busiestRoutes: Object.values(routeMap).sort((a, b) => b.count - a.count).slice(0, 8),
    recentTransfers: filteredTransfers.sort((a, b) => ((b.created_at ? b.created_at.getTime() : 0) - (a.created_at ? a.created_at.getTime() : 0))).slice(0, 15),
  };
};
