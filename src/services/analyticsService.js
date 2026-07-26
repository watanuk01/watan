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
let _invoiceCache = null;
let _eposCache = null;
let _vendorCache = null;
let _batchCache = null;
let _inventoryItemsCache = null;
let _restaurantListCache = null;
let _productionCache = null;

export const clearCache = () => {
    _orderCache = null;
    _wasteCache = null;
    _invoiceCache = null;
    _eposCache = null;
    _vendorCache = null;
    _batchCache = null;
    _inventoryItemsCache = null;
    _restaurantListCache = null;
    _productionCache = null;
};

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

const getEpos = async () => {
    if (_eposCache) return _eposCache;
    const snap = await getDocs(collection(db, 'epos_events'));
    _eposCache = snap.docs.map(d => {
        const data = d.data();
        const dateVal = data.order_date || data.received_at || data.created_at || data.event_date || data.timestamp;
        return {
            id: d.id,
            ...data,
            received_at: toDate(dateVal),
        };
    });
    return _eposCache;
};

const getPurchaseOrders = async () => {
    if (_vendorCache) return _vendorCache;
    const snap = await getDocs(collection(db, 'purchase_orders'));
    _vendorCache = snap.docs.map(d => {
        const data = d.data();
        const dateVal = data.created_at || data.order_date || data.expected_delivery_date || data.received_at || data.date;
        return {
            id: d.id,
            ...data,
            created_at: toDate(dateVal),
        };
    });
    return _vendorCache;
};

const getBatches = async () => {
    if (_batchCache) return _batchCache;
    const snap = await getDocs(collection(db, 'inventory_batches'));
    _batchCache = snap.docs.map(d => {
        const data = d.data();
        const dateVal = data.created_at || data.received_at || data.production_date || data.date || data.expiry_date;
        return {
            id: d.id,
            ...data,
            created_at: toDate(dateVal),
            expiry_date: toDate(data.expiry_date),
        };
    });
    return _batchCache;
};

const getInventoryItems = async () => {
    if (_inventoryItemsCache) return _inventoryItemsCache;
    const snap = await getDocs(query(collection(db, 'inventory_items'), where('status', '==', 'active')));
    _inventoryItemsCache = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    return _inventoryItemsCache;
};

const getProductions = async () => {
    if (_productionCache) return _productionCache;
    const snap = await getDocs(collection(db, 'productions'));
    _productionCache = snap.docs.map(d => ({
        id: d.id,
        ...d.data(),
        created_at: toDate(d.data().created_at),
        completed_at: toDate(d.data().completed_at),
    }));
    return _productionCache;
};

// Apply filters to an array of records (must have created_at as Date)
const applyFilters = (rows, { dateFrom, dateTo, restaurantId, restaurantName } = {}) =>
    rows.filter(r => {
        const ca = r.created_at;
        if (dateFrom && ca && ca < dateFrom) return false;
        if (dateTo && ca && ca > dateTo) return false;

        if (restaurantId || restaurantName) {
            const rid = (r.restaurant_id || r.location_id || r.id || '').toLowerCase();
            const rname = (r.restaurant_name || r.location_name || r.name || '').toLowerCase();
            const targetId = (restaurantId || '').toLowerCase();
            const targetName = (restaurantName || '').toLowerCase();

            const matchesId = targetId && (rid === targetId || rname === targetId || rid.includes(targetId) || targetId.includes(rid));
            const matchesName = targetName && (rname === targetName || rid === targetName || rname.includes(targetName) || targetName.includes(rname));

            if (!matchesId && !matchesName) return false;
        }

        return true;
    });

// ════════════════════════════════════════════════════════
// CK DASHBOARD METRICS
// ════════════════════════════════════════════════════════

const getInvoices = async () => {
    if (_invoiceCache) return _invoiceCache;
    const snap = await getDocs(collection(db, 'invoices'));
    _invoiceCache = snap.docs.map(d => {
        const data = d.data();
        return {
            id: d.id,
            ...data,
            invoice_date: toDate(data.invoice_date),
            created_at: toDate(data.created_at),
        };
    });
    return _invoiceCache;
};

export const fetchDashboardMetrics = async (filters = {}) => {
    const [items, orders, waste, batches, invoices] = await Promise.all([
        getInventoryItems(),
        getOrders(),
        getWaste(),
        getBatches(),
        getInvoices(),
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
    items.forEach(item => {
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
    const nearExpiryBatches = batches
        .filter(b => b.status === 'active' && b.expiry_date && b.expiry_date > now && b.expiry_date <= in48h)
        .sort((a, b) => a.expiry_date - b.expiry_date)
        .slice(0, 8);

    // ─── Recent orders (filtered) ───
    const recentOrders = [...filteredOrders]
        .sort((a, b) => (b.created_at || 0) - (a.created_at || 0))
        .slice(0, 5);

    // ─── Revenue from Invoices (Restaurant Billing) ───
    const filteredInvoices = invoices.filter(inv => {
        const invDate = inv.invoice_date || inv.created_at;
        if (filters.dateFrom && invDate && invDate < filters.dateFrom) return false;
        if (filters.dateTo && invDate && invDate > filters.dateTo) return false;

        if (filters.restaurantId || filters.restaurantName) {
            const invRestId = inv.customer?.restaurant_id || '';
            const invRestName = inv.customer?.restaurant_name || inv.customer?.name || '';

            let matches = false;
            if (filters.restaurantId && invRestId) {
                matches = invRestId === filters.restaurantId;
            }
            if (!matches && filters.restaurantName && invRestName) {
                matches = invRestName === filters.restaurantName;
            }
            if (!matches) return false;
        }

        if (inv.status === 'void') return false;
        return true;
    });

    let totalRevenue = 0, paidRevenue = 0, pendingRevenue = 0;
    filteredInvoices.forEach(inv => {
        const amount = inv.grand_total || 0;
        totalRevenue += amount;
        if (inv.status === 'paid') {
            paidRevenue += amount;
        } else {
            pendingRevenue += amount;
        }
    });

    // ─── Production Cost (CK-level, not restaurant-specific) ───
    // Sum total_ingredient_cost from completed productions in the date range
    const productionDocs = await getDocs(collection(db, 'productions'));
    const allProductions = productionDocs.docs.map(d => {
        const data = d.data();
        return {
            id: d.id,
            ...data,
            created_at: toDate(data.created_at),
            completed_at: toDate(data.completed_at),
        };
    });

    let productionCost = 0;
    let productionCount = 0;
    allProductions.forEach(p => {
        if (p.status !== 'completed') return;
        const pDate = p.completed_at || p.created_at;
        if (filters.dateFrom && pDate && pDate < filters.dateFrom) return;
        if (filters.dateTo && pDate && pDate > filters.dateTo) return;
        productionCost += p.total_ingredient_cost || 0;
        productionCount++;
    });

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
        totalRevenue: Math.round(totalRevenue * 100) / 100,
        paidRevenue: Math.round(paidRevenue * 100) / 100,
        pendingRevenue: Math.round(pendingRevenue * 100) / 100,
        invoiceCount: filteredInvoices.length,
        productionCost: Math.round(productionCost * 100) / 100,
        productionCount,
    };
};

// ════════════════════════════════════════════════════════
// CHART DATA — all accept filters
// ════════════════════════════════════════════════════════

/** Inventory value grouped by category (pie) — not filterable by date */
export const fetchInventoryByCategory = async () => {
    const items = await getInventoryItems();
    const map = {};
    items.forEach(item => {
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



/**
 * Item Daily Trend — top N items' daily quantities over the date range.
 * Returns: [{ date: '01 May', 'Chicken Tikka': 12, 'Lamb Biryani': 8, ... }, ...]
 * Plus: { itemNames: ['Chicken Tikka', 'Lamb Biryani', ...] }
 */
export const fetchItemDailyTrend = async (limit = 5, filters = {}) => {
    const { dateFrom = daysAgo(30), dateTo = endOfDay() } = filters;
    const allOrders = await getOrders();
    const filtered = applyFilters(allOrders, filters);

    // Step 1: Find top N items by total quantity
    const totals = {};
    filtered.forEach(o => {
        (o.items || []).forEach(item => {
            const name = item.item_name;
            if (!name) return;
            totals[name] = (totals[name] || 0) + (item.quantity || 0);
        });
    });
    const topItemNames = Object.entries(totals)
        .sort(([, a], [, b]) => b - a)
        .slice(0, limit)
        .map(([name]) => name);

    if (topItemNames.length === 0) return { data: [], itemNames: [] };

    // Step 2: Build day → item quantity map
    const dayMap = {};
    const cursor = new Date(dateFrom);
    while (cursor <= dateTo) {
        const key = cursor.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
        dayMap[key] = { date: key };
        topItemNames.forEach(name => { dayMap[key][name] = 0; });
        cursor.setDate(cursor.getDate() + 1);
    }

    filtered.forEach(o => {
        const ca = o.created_at;
        if (!ca) return;
        const key = ca.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
        if (!dayMap[key]) return;
        (o.items || []).forEach(item => {
            if (topItemNames.includes(item.item_name)) {
                dayMap[key][item.item_name] += item.quantity || 0;
            }
        });
    });

    return {
        data: Object.values(dayMap),
        itemNames: topItemNames,
    };
};

/**
 * Item × Restaurant Matrix — cross-tab of items by restaurants.
 * Returns: { items: [{ name, total, restaurants: { restName: qty } }], restaurantNames: [...] }
 * Always shows ALL restaurants (ignores restaurant filter) but returns the filtered one for highlighting.
 */
export const fetchItemRestaurantMatrix = async (limit = 15, filters = {}) => {
    const allOrders = await getOrders();
    // Only apply date filters (show all restaurants always)
    const { restaurantId, restaurantName, ...dateFilters } = filters;
    const filtered = applyFilters(allOrders, dateFilters);

    // Build item → restaurant → quantity map
    const itemMap = {};
    const restaurantSet = new Set();

    filtered.forEach(o => {
        const restName = o.restaurant_name || 'Unknown';
        restaurantSet.add(restName);

        (o.items || []).forEach(item => {
            const name = item.item_name;
            if (!name) return;
            if (!itemMap[name]) itemMap[name] = { name, total: 0, restaurants: {} };
            itemMap[name].total += item.quantity || 0;
            itemMap[name].restaurants[restName] = (itemMap[name].restaurants[restName] || 0) + (item.quantity || 0);
        });
    });

    const restaurantNames = [...restaurantSet].sort();
    const items = Object.values(itemMap)
        .sort((a, b) => b.total - a.total)
        .slice(0, limit)
        .map(item => ({
            ...item,
            total: Math.round(item.total * 10) / 10,
            restaurants: Object.fromEntries(
                Object.entries(item.restaurants).map(([k, v]) => [k, Math.round(v * 10) / 10])
            ),
        }));

    // Find max quantity for heatmap color scaling
    let maxQty = 0;
    items.forEach(item => {
        Object.values(item.restaurants).forEach(v => { if (v > maxQty) maxQty = v; });
    });

    return {
        items,
        restaurantNames,
        maxQty,
        highlightRestaurant: restaurantName || null,
    };
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
    const [allOrders, allWaste, allEpos, restaurantList] = await Promise.all([
        getOrders(),
        getWaste(),
        getEpos(),
        fetchRestaurantList(),
    ]);

    const { restaurantId, restaurantName, ...dateFilters } = filters;
    const filteredOrders = applyFilters(allOrders, dateFilters);
    const filteredWaste = applyFilters(allWaste, dateFilters);
    const map = {};

    // Initialize map with all active restaurants so table always lists all branches
    restaurantList.forEach(r => {
        const name = r.restaurant_name || r.name;
        if (name && !map[name]) {
            map[name] = { name, orders: 0, orderValue: 0, wasteValue: 0, itemsOrdered: {}, wasteItems: {} };
        }
    });

    filteredOrders.forEach(o => {
        const name = o.restaurant_name || 'Unknown';
        if (!map[name]) map[name] = { name, orders: 0, orderValue: 0, wasteValue: 0, itemsOrdered: {}, wasteItems: {} };
        map[name].orders++;
        map[name].orderValue += o.total || 0;
        (o.items || []).forEach(item => {
            const iname = item.item_name;
            if (!iname) return;
            if (!map[name].itemsOrdered[iname]) map[name].itemsOrdered[iname] = { name: iname, quantity: 0, value: 0 };
            map[name].itemsOrdered[iname].quantity += item.quantity || 0;
            map[name].itemsOrdered[iname].value += item.line_total || 0;
        });
    });

    filteredWaste.forEach(w => {
        const name = w.location_name || 'Unknown';
        const isRestaurantWaste = w.location_type === 'restaurant' || map[name];
        if (!isRestaurantWaste) return;
        if (!map[name]) map[name] = { name, orders: 0, orderValue: 0, wasteValue: 0, itemsOrdered: {}, wasteItems: {} };
        const val = w.total_value || w.estimated_value || 0;
        map[name].wasteValue += val;
        const wname = w.item_name || w.category || 'Unknown';
        if (!map[name].wasteItems[wname]) map[name].wasteItems[wname] = { name: wname, value: 0, quantity: 0 };
        map[name].wasteItems[wname].value += val;
        map[name].wasteItems[wname].quantity += w.quantity || 0;
    });

    // Fetch EPOS events for all restaurants (cross-restaurant aggregation)
    // Apply date filters to EPOS events using converted Date objects
    let eposMap = {};
    allEpos.forEach(data => {
        // Date-filter EPOS events
        const ed = data.received_at ? toDate(data.received_at)
            : data.order_date ? toDate(data.order_date)
            : data.created_at ? toDate(data.created_at)
            : null;
        if (!ed || isNaN(ed.getTime())) return;
        if (dateFilters.dateFrom && ed < dateFilters.dateFrom) return;
        if (dateFilters.dateTo && ed > dateFilters.dateTo) return;

        let saleValue = 0;
        const results = data.processing_result?.results || [];
        results.forEach(r => {
            if (r.status === 'processed') {
                const price = Number(r.portion_selling_price || r.price) || 0;
                const qty = Number(r.quantity_sold || r.quantity) || 0;
                saleValue += price * qty;
            }
        });
        // Fallback for events without processing_result
        if (saleValue === 0) {
            saleValue = Number(data.total_amount || data.grand_total || data.total || data.order_total) || 0;
        }
        if (saleValue === 0 && data.line_items) {
            (data.line_items || []).forEach(li => {
                saleValue += (Number(li.total || li.price) || 0) * (Number(li.quantity) || 1);
            });
        }

        const rId = (data.restaurant_id || data._restaurant_id || '').toLowerCase().trim();
        const rName = (data.restaurant_name || data.location_name || rId).toLowerCase().trim();

        if (rName) eposMap[rName] = (eposMap[rName] || 0) + saleValue;
        if (rId && rId !== rName) eposMap[rId] = (eposMap[rId] || 0) + saleValue;
    });

    let resultList = Object.values(map);

    // If a specific restaurant is selected in the filter dropdown, filter to only that restaurant
    if (restaurantId || restaurantName) {
        resultList = resultList.filter(r => {
            if (restaurantName && r.name === restaurantName) return true;
            const found = restaurantList.find(rl => rl.restaurant_name === r.name);
            if (found && restaurantId && (found.restaurant_id === restaurantId || found.id === restaurantId)) return true;
            return false;
        });
    }

    return resultList.map(r => {
        const nameKey = (r.name || '').toLowerCase().trim();
        const idKey = (r.restaurant_id || r.id || '').toLowerCase().trim();
        let rawEposSale = eposMap[nameKey] ?? eposMap[idKey] ?? 0;
        if (!rawEposSale && nameKey) {
            Object.keys(eposMap).forEach(key => {
                if (key && (key.includes(nameKey) || nameKey.includes(key))) {
                    rawEposSale += eposMap[key];
                }
            });
        }
        const eposSaleValue = Math.round(rawEposSale * 100) / 100;
        const topItemsList = Object.values(r.itemsOrdered)
            .sort((a, b) => b.quantity - a.quantity)
            .slice(0, 10);
        const topWasteList = Object.values(r.wasteItems)
            .sort((a, b) => b.value - a.value)
            .slice(0, 5);
        return {
            name: r.name,
            orders: r.orders,
            orderValue: Math.round(r.orderValue * 100) / 100,
            avgOrderValue: r.orders > 0 ? Math.round((r.orderValue / r.orders) * 100) / 100 : 0,
            wasteValue: Math.round(r.wasteValue * 100) / 100,
            wastePercent: r.orderValue > 0 ? Math.round((r.wasteValue / r.orderValue) * 1000) / 10 : 0,
            topItem: topItemsList[0]?.name || '—',
            eposSaleValue,
            difference: Math.round((eposSaleValue - Math.round(r.orderValue * 100) / 100) * 100) / 100,
            topItemsList,
            topWasteList,
        };
    }).sort((a, b) => b.orderValue - a.orderValue);
};

/** Top N ordered items — respects filters */
export const fetchTopOrderedItems = async (limit = 10, filters = {}) => {
    const allOrders = await getOrders();
    const filtered = applyFilters(allOrders, filters);
    const map = {};
    const categorySet = new Set();

    filtered.forEach(o => {
        (o.items || []).forEach(item => {
            const iname = item.item_name || item.name || item.title || item.product_name;
            if (!iname) return;
            const cat = item.category_name || item.category || 'Uncategorised';
            categorySet.add(cat);

            if (!map[iname]) {
                map[iname] = {
                    name: iname,
                    quantity: 0,
                    value: 0,
                    unit: item.unit || item.base_unit || 'units',
                    category: cat,
                };
            }

            const qty = Number(item.quantity || item.qty || 1);
            const val = Number(item.line_total ?? item.total ?? ((item.selling_price || item.price || item.cost_price || 0) * qty));

            map[iname].quantity += qty;
            map[iname].value += val;

            if (item.unit) map[iname].unit = item.unit;
            if (cat && cat !== 'Uncategorised') map[iname].category = cat;
        });
    });

    const items = Object.values(map)
        .sort((a, b) => b.quantity - a.quantity)
        .slice(0, limit)
        .map(i => ({
            ...i,
            quantity: Math.round(i.quantity * 100) / 100,
            value: Math.round(i.value * 100) / 100,
        }));

    return { items, categories: [...categorySet].sort() };
};

export const fetchVendorAnalysis = async (filters = {}) => {
    const orders = await getPurchaseOrders();

    // 1. Try filtering by date range (POs are Central Kitchen level, so ignore branch restaurant filter)
    const dateFiltersOnly = { dateFrom: filters.dateFrom, dateTo: filters.dateTo };
    let filtered = applyFilters(orders, dateFiltersOnly);

    // 2. If no purchase orders match the narrow date window (e.g. Today), fallback to all purchase orders
    if (!filtered || filtered.length === 0) {
        filtered = orders;
    }

    const map = {};
    filtered.forEach(data => {
        const vendor = data.vendor || data.vendor_name || data.supplier_name || 'Unknown Vendor';
        if (!map[vendor]) map[vendor] = { name: vendor, orders: 0, value: 0, items: 0 };
        map[vendor].orders++;
        map[vendor].value += Number(data.total_amount || data.total || 0);
        map[vendor].items += (data.items || []).length;
    });

    return Object.values(map)
        .sort((a, b) => b.value - a.value)
        .map(v => ({ ...v, value: Math.round(v.value * 100) / 100 }));
};

export const fetchBatchAnalytics = async (filters = {}) => {
    const allBatches = await getBatches();
    const filteredBatches = applyFilters(allBatches, filters);

    const now = new Date();
    const weekStart = startOfWeek();
    const todayStart = startOfDay();
    let totalBatches = 0, activeBatches = 0, expiredBatches = 0;
    let expiredValue = 0, totalUsed = 0, totalReceived = 0;
    let doneToday = 0, doneWeek = 0;
    const expiredList = [];

    filteredBatches.forEach(b => {
        totalBatches++;
        if (b.status === 'active') activeBatches++;
        if (b.expiry_date && b.expiry_date < now && b.status !== 'active') {
            expiredBatches++;
            const remaining = b.current_quantity || 0;
            const cost = remaining * (b.cost_price || 0);
            expiredValue += cost;
            if (cost > 0) expiredList.push({ id: b.id, item_name: b.item_name || b.name || 'Unknown Item', batch_number: b.batch_number || '—', quantity: remaining, unit: b.unit || 'units', value: cost, expiry_date: b.expiry_date });
        }
        if (b.initial_quantity > 0) {
            totalReceived += b.initial_quantity;
            totalUsed += (b.initial_quantity - (b.current_quantity || 0));
        }
        if (b.created_at && b.item_type === 'cooked_meat') {
            if (b.created_at >= todayStart) doneToday++;
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

/**
 * Fetch restaurant list for filter dropdowns.
 * Extracts unique restaurants across users, orders, waste, and EPOS.
 * Returns [{ id, name, restaurant_name, restaurant_id }]
 */
export const fetchRestaurantList = async () => {
    if (_restaurantListCache) return _restaurantListCache;

    try {
        const [usersSnap, allOrders, allWaste, allEpos] = await Promise.all([
            getDocs(collection(db, 'users')),
            getOrders(),
            getWaste(),
            getEpos(),
        ]);

        const restMap = new Map();

        // 1. Users
        usersSnap.docs.forEach(d => {
            const u = d.data();
            const rName = u.restaurant_name || (u.role?.includes('restaurant') ? u.name : null);
            if (rName) {
                const key = rName.trim().toLowerCase();
                restMap.set(key, {
                    id: d.id,
                    name: u.name || rName.trim(),
                    restaurant_name: rName.trim(),
                    restaurant_id: u.restaurant_id || d.id,
                });
            }
        });

        // 2. Orders
        allOrders.forEach(o => {
            const rName = o.restaurant_name;
            if (rName) {
                const key = rName.trim().toLowerCase();
                if (!restMap.has(key)) {
                    restMap.set(key, {
                        id: o.restaurant_id || key,
                        name: rName.trim(),
                        restaurant_name: rName.trim(),
                        restaurant_id: o.restaurant_id || key,
                    });
                }
            }
        });

        // 3. Waste
        allWaste.forEach(w => {
            const rName = w.location_name;
            if (rName && w.location_type === 'restaurant') {
                const key = rName.trim().toLowerCase();
                if (!restMap.has(key)) {
                    restMap.set(key, {
                        id: w.location_id || key,
                        name: rName.trim(),
                        restaurant_name: rName.trim(),
                        restaurant_id: w.location_id || key,
                    });
                }
            }
        });

        // 4. EPOS
        allEpos.forEach(e => {
            const rName = e.restaurant_name;
            if (rName) {
                const key = rName.trim().toLowerCase();
                if (!restMap.has(key)) {
                    restMap.set(key, {
                        id: e.restaurant_id || key,
                        name: rName.trim(),
                        restaurant_name: rName.trim(),
                        restaurant_id: e.restaurant_id || key,
                    });
                }
            }
        });

        _restaurantListCache = Array.from(restMap.values())
            .sort((a, b) => (a.restaurant_name || '').localeCompare(b.restaurant_name || ''));

        return _restaurantListCache;
    } catch (err) {
        console.warn('fetchRestaurantList error, fallback to empty array:', err);
        return [];
    }
};
