/**
 * Analytics Service — v2 with date/restaurant filter support
 * All client-side aggregation over Firestore collections:
 *   orders, inventory_items, inventory_batches, waste_events
 *
 * Filter object: { dateFrom: Date, dateTo: Date, restaurantId?: string, restaurantName?: string }
 */

import { collection, getDocs, query, where } from 'firebase/firestore';
import { db } from '../firebase';

export const formatCurrency = (n) =>
    `£${Number(n || 0).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// ─── Date helpers ───
export const startOfDay = (d = new Date()) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
export const startOfWeek = () => {
    const d = new Date(); d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - d.getDay()); return d;
};
export const daysAgo = (n) => { const d = new Date(); d.setDate(d.getDate() - n); d.setHours(0, 0, 0, 0); return d; };
export const endOfDay = (d = new Date()) => { const x = new Date(d); x.setHours(23, 59, 59, 999); return x; };

export const toDate = (ts) => {
    if (!ts) return null;
    if (ts.toDate) return ts.toDate();
    if (ts instanceof Date) return ts;
    return new Date(ts);
};

/**
 * Preset filter presets
 * Returns { label, dateFrom, dateTo }
 */
export const DATE_PRESETS = [
    { id: 'today', label: 'Today', days: 0 },
    { id: '7d', label: 'Last 7 Days', days: 7 },
    { id: '15d', label: 'Last 15 Days', days: 15 },
    { id: '30d', label: 'Last 30 Days', days: 30 },
    { id: 'custom', label: 'Custom', days: null },
];

export const getPresetDates = (presetId) => {
    const today = new Date();
    const from = startOfDay(today);
    switch (presetId) {
        case 'today': return { dateFrom: from, dateTo: endOfDay(today) };
        case '7d': return { dateFrom: daysAgo(7), dateTo: endOfDay(today) };
        case '15d': return { dateFrom: daysAgo(15), dateTo: endOfDay(today) };
        case '30d':
        default: return { dateFrom: daysAgo(30), dateTo: endOfDay(today) };
    }
};

// ════════════════════════════════════════════════════════
// CORE DATA FETCHERS (cached per session)
// ════════════════════════════════════════════════════════
let _orderCache = null;
let _wasteCache = null;

export const clearCache = () => { _orderCache = null; _wasteCache = null; };

const getOrders = async () => {
    if (_orderCache) return _orderCache;
    const snap = await getDocs(collection(db, 'orders'));
    _orderCache = snap.docs.map(d => ({ id: d.id, ...d.data(), created_at: toDate(d.data().created_at) }));
    return _orderCache;
};

const getWaste = async () => {
    if (_wasteCache) return _wasteCache;
    const snap = await getDocs(collection(db, 'waste_events'));
    _wasteCache = snap.docs.map(d => ({ id: d.id, ...d.data(), created_at: toDate(d.data().created_at) }));
    return _wasteCache;
};

// Apply filters to an array of records (must have created_at as Date)
const applyFilters = (rows, { dateFrom, dateTo, restaurantId, restaurantName } = {}) =>
    rows.filter(r => {
        const ca = r.created_at;
        if (dateFrom && ca && ca < dateFrom) return false;
        if (dateTo && ca && ca > dateTo) return false;
        if (restaurantId && r.restaurant_id && r.restaurant_id !== restaurantId) return false;
        if (restaurantName && !restaurantId && r.restaurant_name && r.restaurant_name !== restaurantName) return false;
        return true;
    });

// ════════════════════════════════════════════════════════
// CK DASHBOARD METRICS
// ════════════════════════════════════════════════════════

export const fetchDashboardMetrics = async (filters = {}) => {
    const [items, orders, waste, batches] = await Promise.all([
        getDocs(query(collection(db, 'inventory_items'), where('status', '==', 'active'))),
        getOrders(),
        getWaste(),
        getDocs(collection(db, 'inventory_batches')),
    ]);

    const todayStart = startOfDay();
    const weekStart = startOfWeek();
    const now = new Date();
    const in48h = new Date(now.getTime() + 48 * 3600 * 1000);

    // Filter orders/waste by date range & restaurant
    const filteredOrders = applyFilters(orders, filters);
    const filteredWaste = applyFilters(waste, filters);

    // ─── Inventory (never filtered by restaurant — CK-level) ───
    let inventoryValue = 0, lowStockCount = 0;
    items.docs.forEach(d => {
        const item = d.data();
        inventoryValue += (item.current_stock || 0) * (item.cost_price || 0);
        if (item.current_stock <= (item.low_stock_threshold || item.min_stock || 0)) lowStockCount++;
    });

    // ─── Orders ───
    let ordersInRange = 0, orderValueInRange = 0, pendingDeliveries = 0;
    let ordersToday = 0, orderValueToday = 0;
    let ordersWeek = 0, orderValueWeek = 0;

    // Always compute today/week from unfiltered for the stat cards on the right
    orders.forEach(o => {
        const ca = o.created_at;
        if (ca >= todayStart) { ordersToday++; orderValueToday += o.total || 0; }
        if (ca >= weekStart) { ordersWeek++; orderValueWeek += o.total || 0; }
        if (o.status === 'ready_for_pickup' || o.status === 'out_for_delivery') pendingDeliveries++;
    });
    filteredOrders.forEach(o => { ordersInRange++; orderValueInRange += o.total || 0; });

    // ─── Waste ───
    let wasteToday = 0, wasteWeek = 0, wasteInRange = 0;
    waste.forEach(w => {
        const ca = w.created_at;
        const val = w.total_value || w.estimated_value || 0;
        if (ca >= todayStart) wasteToday += val;
        if (ca >= weekStart) wasteWeek += val;
    });
    filteredWaste.forEach(w => { wasteInRange += w.total_value || w.estimated_value || 0; });

    // ─── Near-expiry batches ───
    const nearExpiryBatches = batches.docs
        .map(d => ({ id: d.id, ...d.data(), expiry_date: toDate(d.data().expiry_date) }))
        .filter(b => b.status === 'active' && b.expiry_date && b.expiry_date > now && b.expiry_date <= in48h)
        .sort((a, b) => a.expiry_date - b.expiry_date)
        .slice(0, 8);

    // ─── Recent orders (filtered) ───
    const recentOrders = [...filteredOrders]
        .sort((a, b) => (b.created_at || 0) - (a.created_at || 0))
        .slice(0, 5);

    return {
        inventoryValue,
        lowStockCount,
        ordersToday,
        orderValueToday,
        ordersWeek,
        orderValueWeek,
        ordersInRange,
        orderValueInRange,
        pendingDeliveries,
        wasteToday,
        wasteWeek,
        wasteInRange,
        nearExpiryBatches,
        recentOrders,
    };
};

// ════════════════════════════════════════════════════════
// CHART DATA — all accept filters
// ════════════════════════════════════════════════════════

/** Inventory value grouped by category (pie) — not filterable by date */
export const fetchInventoryByCategory = async () => {
    const snap = await getDocs(query(collection(db, 'inventory_items'), where('status', '==', 'active')));
    const map = {};
    snap.docs.forEach(d => {
        const item = d.data();
        const cat = item.category_name || 'Uncategorised';
        const val = (item.current_stock || 0) * (item.cost_price || 0);
        map[cat] = (map[cat] || 0) + val;
    });
    return Object.entries(map)
        .map(([name, value]) => ({ name, value: Math.round(value * 100) / 100 }))
        .sort((a, b) => b.value - a.value)
        .slice(0, 8);
};

/** Daily order volume — respects date range + restaurant filters */
export const fetchDailyOrderVolume = async (filters = {}) => {
    const { dateFrom = daysAgo(30), dateTo = endOfDay() } = filters;
    const allOrders = await getOrders();
    const filtered = applyFilters(allOrders, filters);

    // Build day map between dateFrom → dateTo
    const dayMap = {};
    const cursor = new Date(dateFrom);
    while (cursor <= dateTo) {
        const key = cursor.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
        dayMap[key] = { date: key, orders: 0, value: 0 };
        cursor.setDate(cursor.getDate() + 1);
    }

    filtered.forEach(o => {
        const ca = o.created_at;
        if (!ca) return;
        const key = ca.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
        if (dayMap[key]) {
            dayMap[key].orders++;
            dayMap[key].value = Math.round((dayMap[key].value + (o.total || 0)) * 100) / 100;
        }
    });

    return Object.values(dayMap);
};

/** Top N ordered items — respects filters */
export const fetchTopOrderedItems = async (limit = 10, filters = {}) => {
    const allOrders = await getOrders();
    const filtered = applyFilters(allOrders, filters);
    const map = {};
    filtered.forEach(o => {
        (o.items || []).forEach(item => {
            if (!map[item.item_name]) map[item.item_name] = { name: item.item_name, quantity: 0, value: 0 };
            map[item.item_name].quantity += item.quantity || 0;
            map[item.item_name].value += item.line_total || 0;
        });
    });
    return Object.values(map)
        .sort((a, b) => b.quantity - a.quantity)
        .slice(0, limit)
        .map(i => ({ ...i, quantity: Math.round(i.quantity * 10) / 10, value: Math.round(i.value * 100) / 100 }));
};

/** Top restaurants by total order value — respects date filters only */
export const fetchTopRestaurants = async (limit = 5, filters = {}) => {
    const allOrders = await getOrders();
    // Don't apply restaurant filter here (we're comparing across restaurants)
    const { restaurantId, restaurantName, ...dateFilters } = filters;
    const filtered = applyFilters(allOrders, dateFilters);
    const map = {};
    filtered.forEach(o => {
        const name = o.restaurant_name || 'Unknown';
        if (!map[name]) map[name] = { name, orders: 0, value: 0 };
        map[name].orders++;
        map[name].value = Math.round((map[name].value + (o.total || 0)) * 100) / 100;
    });
    return Object.values(map).sort((a, b) => b.value - a.value).slice(0, limit);
};

/** Waste by category — respects filters */
export const fetchWasteByCategory = async (filters = {}) => {
    const allWaste = await getWaste();
    const filtered = applyFilters(allWaste, filters);
    const map = {};
    filtered.forEach(w => {
        const cat = w.category || 'Other';
        const val = w.total_value || w.estimated_value || 0;
        map[cat] = (map[cat] || 0) + val;
    });
    return Object.entries(map)
        .map(([name, value]) => ({ name, value: Math.round(value * 100) / 100 }))
        .sort((a, b) => b.value - a.value);
};

// ════════════════════════════════════════════════════════
// COMPARATIVE ANALYTICS (5.10.2)
// ════════════════════════════════════════════════════════

export const fetchRestaurantComparison = async (filters = {}) => {
    const [allOrders, allWaste] = await Promise.all([getOrders(), getWaste()]);
    const { restaurantId, restaurantName, ...dateFilters } = filters;
    const filteredOrders = applyFilters(allOrders, dateFilters);
    const filteredWaste = applyFilters(allWaste, dateFilters);
    const map = {};

    filteredOrders.forEach(o => {
        const name = o.restaurant_name || 'Unknown';
        if (!map[name]) map[name] = { name, orders: 0, orderValue: 0, wasteValue: 0, itemsOrdered: {} };
        map[name].orders++;
        map[name].orderValue += o.total || 0;
        (o.items || []).forEach(item => {
            map[name].itemsOrdered[item.item_name] = (map[name].itemsOrdered[item.item_name] || 0) + (item.quantity || 0);
        });
    });

    filteredWaste.filter(w => w.location_type === 'restaurant').forEach(w => {
        const name = w.location_name || 'Unknown';
        if (!map[name]) map[name] = { name, orders: 0, orderValue: 0, wasteValue: 0, itemsOrdered: {} };
        map[name].wasteValue += w.total_value || w.estimated_value || 0;
    });

    return Object.values(map).map(r => ({
        name: r.name, orders: r.orders,
        orderValue: Math.round(r.orderValue * 100) / 100,
        avgOrderValue: r.orders > 0 ? Math.round((r.orderValue / r.orders) * 100) / 100 : 0,
        wasteValue: Math.round(r.wasteValue * 100) / 100,
        wastePercent: r.orderValue > 0 ? Math.round((r.wasteValue / r.orderValue) * 1000) / 10 : 0,
        topItem: Object.entries(r.itemsOrdered).sort((a, b) => b[1] - a[1])[0]?.[0] || '—',
    })).sort((a, b) => b.orderValue - a.orderValue);
};

export const fetchVendorAnalysis = async () => {
    const snap = await getDocs(collection(db, 'purchase_orders'));
    const map = {};
    snap.docs.forEach(d => {
        const data = d.data();
        const vendor = data.vendor_name || data.supplier_name || 'Unknown';
        if (!map[vendor]) map[vendor] = { name: vendor, orders: 0, value: 0, items: 0 };
        map[vendor].orders++;
        map[vendor].value += data.total || 0;
        map[vendor].items += (data.items || []).length;
    });
    return Object.values(map)
        .sort((a, b) => b.value - a.value)
        .map(v => ({ ...v, value: Math.round(v.value * 100) / 100 }));
};

export const fetchBatchAnalytics = async () => {
    const snap = await getDocs(collection(db, 'inventory_batches'));
    const now = new Date();
    const weekStart = startOfWeek();
    let totalBatches = 0, activeBatches = 0, expiredBatches = 0;
    let expiredValue = 0, totalUsed = 0, totalReceived = 0;
    let doneToday = 0, doneWeek = 0;
    const expiredList = [];

    snap.docs.forEach(d => {
        const b = { id: d.id, ...d.data(), expiry_date: toDate(d.data().expiry_date), created_at: toDate(d.data().created_at) };
        totalBatches++;
        if (b.status === 'active') activeBatches++;
        if (b.expiry_date && b.expiry_date < now && b.status !== 'active') {
            expiredBatches++;
            const remaining = b.current_quantity || 0;
            const cost = remaining * (b.cost_price || 0);
            expiredValue += cost;
            if (cost > 0) expiredList.push({ id: b.id, item_name: b.item_name, batch_number: b.batch_number, quantity: remaining, unit: b.unit, value: cost, expiry_date: b.expiry_date });
        }
        if (b.initial_quantity > 0) {
            totalReceived += b.initial_quantity;
            totalUsed += (b.initial_quantity - (b.current_quantity || 0));
        }
        if (b.created_at && b.item_type === 'cooked_meat') {
            if (b.created_at >= startOfDay()) doneToday++;
            if (b.created_at >= weekStart) doneWeek++;
        }
    });

    return {
        totalBatches, activeBatches, expiredBatches,
        expiredValue: Math.round(expiredValue * 100) / 100,
        avgUtilization: totalReceived > 0 ? Math.round((totalUsed / totalReceived) * 1000) / 10 : 0,
        productionToday: doneToday,
        productionWeek: doneWeek,
        expiredList: expiredList.sort((a, b) => b.value - a.value).slice(0, 10),
    };
};

// ════════════════════════════════════════════════════════
// RESTAURANT DIRECTORY (for Restaurants management page)
// ════════════════════════════════════════════════════════

export const fetchRestaurantDirectory = async () => {
    const [usersSnap, allOrders, allWaste] = await Promise.all([
        getDocs(query(collection(db, 'users'), where('role', 'in', ['restaurant_manager', 'restaurant_manager_non_managed']))),
        getOrders(),
        getWaste(),
    ]);

    return usersSnap.docs.map(d => {
        const u = { id: d.id, ...d.data() };
        const rName = u.restaurant_name || u.name;

        const orders = allOrders.filter(o => o.restaurant_id === u.id || o.restaurant_name === rName);
        const waste = allWaste.filter(w => w.location_id === u.id || w.location_name === rName);

        const totalOrderValue = orders.reduce((s, o) => s + (o.total || 0), 0);
        const totalWasteValue = waste.reduce((s, w) => s + (w.total_value || w.estimated_value || 0), 0);
        const pendingOrders = orders.filter(o => ['pending', 'ready_for_pickup', 'out_for_delivery'].includes(o.status)).length;
        const lastOrder = orders.sort((a, b) => (b.created_at || 0) - (a.created_at || 0))[0];

        return {
            id: u.id,
            name: u.name,
            restaurant_name: rName,
            restaurant_id: u.restaurant_id || u.id,
            email: u.email,
            phone: u.phone,
            role: u.role,
            status: u.status || 'active',
            created_at: toDate(u.created_at),
            totalOrders: orders.length,
            totalOrderValue: Math.round(totalOrderValue * 100) / 100,
            totalWasteValue: Math.round(totalWasteValue * 100) / 100,
            pendingOrders,
            lastOrderDate: lastOrder?.created_at || null,
            recentOrders: orders.sort((a, b) => (b.created_at || 0) - (a.created_at || 0)).slice(0, 5),
        };
    }).sort((a, b) => b.totalOrderValue - a.totalOrderValue);
};
