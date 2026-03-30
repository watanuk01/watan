import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import {
    MdInventory2, MdShoppingCart, MdWarning, MdArrowForward,
    MdMenuBook, MdDelete, MdReceipt, MdRefresh, MdTrendingUp,
    MdTrendingDown, MdFilterList, MdAttachMoney, MdCategory,
    MdLocalDining, MdKitchen, MdPieChart, MdRestaurantMenu,
} from 'react-icons/md';
import {
    PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, Tooltip, Legend,
    ResponsiveContainer, LineChart, Line, CartesianGrid, Area, AreaChart,
} from 'recharts';
import { getRestaurantInventory, getRestaurantInventoryStats } from '../../services/restaurantInventoryService';
import { getOrders } from '../../services/orderService';
import { getInvoices } from '../../services/invoiceService';
import { getMenuItems, MENU_CATEGORIES, getCategoryInfo, calcPortionCost } from '../../services/menuService';
import toast from 'react-hot-toast';
import { seedRestaurantDashboard } from '../../scripts/seedRestaurantDashboard';
import './Dashboard.css';

/* ═══ Chart colour palette ═══ */
const COLORS = [
    '#c9a96e', '#3b82f6', '#22c55e', '#f59e0b',
    '#ef4444', '#8b5cf6', '#06b6d4', '#ec4899',
    '#14b8a6', '#f97316', '#6366f1', '#84cc16',
];
const PIE_COLORS = ['#c9a96e', '#3b82f6', '#22c55e', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#ec4899'];

/* ═══ Tooltip styling ═══ */
const tooltipStyle = {
    backgroundColor: 'var(--color-bg-elevated)',
    border: '1px solid var(--color-border)',
    borderRadius: 8,
    fontSize: 12,
    boxShadow: '0 4px 12px rgba(0,0,0,.3)',
};

/* ═══ Custom Pie Label — percentage only inside, names in legend ═══ */
const renderPieLabel = ({ percent }) =>
    percent > 0.04 ? `${(percent * 100).toFixed(0)}%` : '';

/* ═══ Date Parser ═══ */
const parseDate = (d) => {
    if (!d) return new Date(0);
    if (d instanceof Date) return d;
    if (typeof d.toDate === 'function') return d.toDate();
    if (d.seconds) return new Date(d.seconds * 1000);
    return new Date(d);
};

const RestaurantDashboard = () => {
    const { currentUser, userProfile } = useAuth();
    const navigate = useNavigate();
    const [loading, setLoading] = useState(true);
    const restaurantId = currentUser?.uid;

    /* ─── raw data ─── */
    const [inventoryItems, setInventoryItems] = useState([]);
    const [invStats, setInvStats] = useState(null);
    const [orders, setOrders] = useState([]);
    const [invoices, setInvoices] = useState([]);
    const [menuItems, setMenuItems] = useState([]);
    const [seeding, setSeeding] = useState(false);

    /* ─── filters ─── */
    const [menuCatFilter, setMenuCatFilter] = useState('all');
    const [invTypeFilter, setInvTypeFilter] = useState('all');
    const [dateRange, setDateRange] = useState('week');
    const [customFrom, setCustomFrom] = useState('');
    const [customTo, setCustomTo] = useState('');

    /* ─── date range helper ─── */
    const getDateRangeFilter = useCallback(() => {
        const now = new Date();
        let from;
        switch (dateRange) {
            case 'today': from = new Date(now.getFullYear(), now.getMonth(), now.getDate()); break;
            case '3days': from = new Date(now); from.setDate(from.getDate() - 3); break;
            case 'week': from = new Date(now); from.setDate(from.getDate() - 7); break;
            case 'month': from = new Date(now); from.setMonth(from.getMonth() - 1); break;
            case 'custom': from = customFrom ? new Date(customFrom) : new Date(0); break;
            default: from = new Date(0);
        }
        const to = dateRange === 'custom' && customTo ? new Date(customTo + 'T23:59:59') : now;
        return { from, to };
    }, [dateRange, customFrom, customTo]);

    const filterByDate = useCallback((items, dateField = 'created_at') => {
        const { from, to } = getDateRangeFilter();
        return (items || []).filter(item => {
            const d = parseDate(item[dateField]);
            return d >= from && d <= to;
        });
    }, [getDateRangeFilter]);

    /* ═══════════════════════════════════════ FETCH ═══ */
    const fetchAll = useCallback(async () => {
        if (!restaurantId) return;
        setLoading(true);
        try {
            const [stats, inv, ord, inv2, menu] = await Promise.all([
                getRestaurantInventoryStats(restaurantId),
                getRestaurantInventory(restaurantId).catch(() => []),
                getOrders({ restaurant_id: restaurantId }).catch(() => []),
                getInvoices({ restaurant_id: restaurantId }).catch(() => []),
                getMenuItems(restaurantId).catch(() => []),
            ]);
            setInvStats(stats);
            setInventoryItems(inv || []);
            setOrders(ord || []);
            setInvoices(inv2 || []);
            setMenuItems(menu || []);
        } catch (err) {
            console.error('Dashboard load error:', err);
            toast.error('Failed to load dashboard data');
        } finally {
            setLoading(false);
        }
    }, [restaurantId]);

    useEffect(() => { fetchAll(); }, [fetchAll]);

    /* ═══════════════════════════════════════ COMPUTED DATA ═══ */

    // ─── ORDER STATS ───
    const orderAnalytics = useMemo(() => {
        const all = filterByDate(orders || []);
        const active = all.filter(o => ['pending', 'confirmed', 'preparing', 'ready'].includes(o.status));
        const delivered = all.filter(o => o.status === 'delivered');
        const cancelled = all.filter(o => o.status === 'cancelled');
        const totalAmount = delivered.reduce((s, o) => s + (o.total_amount || 0), 0);

        // Orders by status (pie)
        const statusMap = {};
        all.forEach(o => {
            const st = o.status || 'unknown';
            statusMap[st] = (statusMap[st] || 0) + 1;
        });
        const byStatus = Object.entries(statusMap).map(([name, value]) => ({ name, value }));

        // Orders over time (bar/line)
        const { from, to } = getDateRangeFilter();
        const diffDays = Math.ceil((to - from) / (1000 * 60 * 60 * 24));
        const isDayView = diffDays <= 45;

        const byPeriod = {};
        all.forEach(o => {
            const d = parseDate(o.created_at);
            const key = isDayView 
                ? `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
                : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
            const label = isDayView 
                ? d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
                : d.toLocaleDateString('en-GB', { month: 'short', year: '2-digit' });

            if (!byPeriod[key]) byPeriod[key] = { period: label, orders: 0, amount: 0 };
            byPeriod[key].orders++;
            byPeriod[key].amount += (o.total_amount || 0);
        });
        const trend = Object.keys(byPeriod).sort().map(k => byPeriod[k]);

        // Recent 5
        const recent = [...all]
            .sort((a, b) => parseDate(b.created_at) - parseDate(a.created_at))
            .slice(0, 5);

        // Avg order value
        const avgValue = delivered.length ? totalAmount / delivered.length : 0;

        return {
            total: all.length,
            active: active.length,
            delivered: delivered.length,
            cancelled: cancelled.length,
            totalAmount,
            avgValue,
            byStatus,
            trend,
            recent,
        };
    }, [orders, filterByDate, getDateRangeFilter]);

    // ─── INVENTORY ANALYTICS ───
    const inventoryAnalytics = useMemo(() => {
        let items = inventoryItems || [];
        if (invTypeFilter !== 'all') {
            items = items.filter(i => (i.item_type || 'other') === invTypeFilter);
        }
        const lowStock = items.filter(i => (i.current_stock || 0) <= (i.low_stock_threshold || 5));
        const outOfStock = items.filter(i => (i.current_stock || 0) <= 0);
        const totalValue = items.reduce((s, i) => s + ((i.current_stock || 0) * (i.cost_price || 0)), 0);

        // By type (pie)
        const typeMap = {};
        items.forEach(i => {
            const t = i.item_type || 'other';
            if (!typeMap[t]) typeMap[t] = { name: t, count: 0, value: 0 };
            typeMap[t].count++;
            typeMap[t].value += (i.current_stock || 0) * (i.cost_price || 0);
        });
        const byType = Object.values(typeMap);

        // By category (bar)
        const catMap = {};
        items.forEach(i => {
            const c = i.category || 'Uncategorised';
            if (!catMap[c]) catMap[c] = { name: c, count: 0, value: 0 };
            catMap[c].count++;
            catMap[c].value += (i.current_stock || 0) * (i.cost_price || 0);
        });
        const byCategory = Object.values(catMap).sort((a, b) => b.value - a.value).slice(0, 10);

        // Top 10 by stock value
        const topByValue = [...items]
            .map(i => ({
                name: i.item_name || i.name || 'Unknown',
                value: Number(((i.current_stock || 0) * (i.cost_price || 0)).toFixed(2)),
            }))
            .sort((a, b) => b.value - a.value)
            .slice(0, 10);

        // Stock health distribution (pie)
        const healthDist = [
            { name: 'Healthy', value: items.length - lowStock.length },
            { name: 'Low Stock', value: lowStock.length - outOfStock.length },
            { name: 'Out of Stock', value: outOfStock.length },
        ].filter(d => d.value > 0);

        return {
            total: items.length,
            lowStock: lowStock.length,
            outOfStock: outOfStock.length,
            totalValue,
            byType,
            byCategory,
            topByValue,
            healthDist,
            lowStockItems: lowStock.slice(0, 8),
        };
    }, [inventoryItems, invTypeFilter]);

    // ─── MENU ANALYTICS ───
    const menuAnalytics = useMemo(() => {
        let items = menuItems || [];
        if (menuCatFilter !== 'all') {
            items = items.filter(i => i.category === menuCatFilter);
        }
        const active = items.filter(i => i.is_active !== false);
        const inactive = items.filter(i => i.is_active === false);

        // By category (pie)
        const catMap = {};
        items.forEach(i => {
            const cat = i.category || 'other';
            const info = getCategoryInfo(cat);
            if (!catMap[cat]) catMap[cat] = { name: info.label, value: 0 };
            catMap[cat].value++;
        });
        const byCategory = Object.values(catMap);

        // All portions with costs
        const allPortions = [];
        items.forEach(item => {
            (item.portions || []).forEach(p => {
                const costPrice = Number(p.cost_price) || calcPortionCost(p);
                const sellingPrice = Number(p.selling_price ?? p.price) || 0;
                const margin = sellingPrice - costPrice;
                const marginPct = sellingPrice > 0 ? (margin / sellingPrice) * 100 : 0;
                allPortions.push({
                    itemName: item.name,
                    itemCategory: item.category,
                    portionName: p.name,
                    costPrice,
                    sellingPrice,
                    margin,
                    marginPct,
                    ingredientCount: (p.recipe?.length || 0) + (p.sub_items?.length || 0),
                });
            });
        });

        // Top 10 highest margin portions (bar)
        const topMargin = [...allPortions]
            .filter(p => p.sellingPrice > 0)
            .sort((a, b) => b.marginPct - a.marginPct)
            .slice(0, 10)
            .map(p => ({
                name: `${p.itemName} (${p.portionName})`,
                margin: Number(p.marginPct.toFixed(1)),
                cost: Number(p.costPrice.toFixed(2)),
                price: Number(p.sellingPrice.toFixed(2)),
            }));

        // Lowest margin (risk) portions (bar)
        const lowMargin = [...allPortions]
            .filter(p => p.sellingPrice > 0)
            .sort((a, b) => a.marginPct - b.marginPct)
            .slice(0, 10)
            .map(p => ({
                name: `${p.itemName} (${p.portionName})`,
                margin: Number(p.marginPct.toFixed(1)),
                cost: Number(p.costPrice.toFixed(2)),
                price: Number(p.sellingPrice.toFixed(2)),
            }));

        // Price distribution (area chart)
        const priceRanges = [
            { range: '£0-5', min: 0, max: 5 },
            { range: '£5-10', min: 5, max: 10 },
            { range: '£10-20', min: 10, max: 20 },
            { range: '£20-30', min: 20, max: 30 },
            { range: '£30-50', min: 30, max: 50 },
            { range: '£50+', min: 50, max: Infinity },
        ];
        const priceDist = priceRanges.map(r => ({
            name: r.range,
            count: allPortions.filter(p => p.sellingPrice >= r.min && p.sellingPrice < r.max).length,
        }));

        // Cost vs Selling scatter data (top 15)
        const costVsPrice = [...allPortions]
            .filter(p => p.sellingPrice > 0)
            .sort((a, b) => b.sellingPrice - a.sellingPrice)
            .slice(0, 15)
            .map(p => ({
                name: `${p.itemName.slice(0, 20)}`,
                cost: Number(p.costPrice.toFixed(2)),
                price: Number(p.sellingPrice.toFixed(2)),
                margin: Number(p.margin.toFixed(2)),
            }));

        // Allergen distribution
        const allergenMap = {};
        items.forEach(i => {
            (i.allergens || []).forEach(a => {
                allergenMap[a] = (allergenMap[a] || 0) + 1;
            });
        });
        const allergenDist = Object.entries(allergenMap).map(([name, count]) => ({
            allergen: name.toUpperCase(),
            count,
            full: items.length,
        }));

        // Items missing recipes
        const missingRecipe = items.filter(i =>
            !i.portions?.length || i.portions.some(p => (!p.recipe?.length && !p.sub_items?.length))
        ).length;

        // Avg margin
        const avgMargin = allPortions.length
            ? allPortions.reduce((s, p) => s + p.marginPct, 0) / allPortions.length
            : 0;

        // Avg cost
        const avgCost = allPortions.length
            ? allPortions.reduce((s, p) => s + p.costPrice, 0) / allPortions.length
            : 0;

        return {
            total: items.length,
            active: active.length,
            inactive: inactive.length,
            portionCount: allPortions.length,
            missingRecipe,
            avgMargin,
            avgCost,
            byCategory,
            topMargin,
            lowMargin,
            priceDist,
            costVsPrice,
            allergenDist,
        };
    }, [menuItems, menuCatFilter]);

    // ─── INVOICE ANALYTICS ───
    const invoiceAnalytics = useMemo(() => {
        const all = filterByDate(invoices || []);
        const totalAmount = all.reduce((s, i) => s + (i.grand_total || 0), 0);

        // Spend over time
        const { from, to } = getDateRangeFilter();
        const diffDays = Math.ceil((to - from) / (1000 * 60 * 60 * 24));
        const isDayView = diffDays <= 45;

        const byPeriod = {};
        all.forEach(inv => {
            const d = parseDate(inv.invoice_date || inv.created_at);
            const key = isDayView 
                ? `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
                : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
            const label = isDayView 
                ? d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
                : d.toLocaleDateString('en-GB', { month: 'short', year: '2-digit' });

            if (!byPeriod[key]) byPeriod[key] = { period: label, spend: 0, count: 0 };
            byPeriod[key].spend += (inv.grand_total || 0);
            byPeriod[key].count++;
        });
        const spendTrend = Object.keys(byPeriod).sort().map(k => byPeriod[k]);

        return {
            count: all.length,
            totalAmount,
            avgAmount: all.length ? totalAmount / all.length : 0,
            spendTrend,
        };
    }, [invoices, filterByDate, getDateRangeFilter]);

    // ─── EPOS SALES (SAMPLE DATA — will be replaced by live webhook data) ───
    const eposSample = useMemo(() => {
        const days = [];
        const now = new Date();
        for (let i = 13; i >= 0; i--) {
            const d = new Date(now); d.setDate(d.getDate() - i);
            const dayLabel = d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
            const rev = Math.round(800 + Math.random() * 1200);
            const ord = Math.round(30 + Math.random() * 40);
            days.push({ day: dayLabel, revenue: rev, orders: ord });
        }
        const topSellers = [
            { name: 'Chicken Biryani', revenue: 2840, qty: 142 },
            { name: 'Afghani Mix Platter', revenue: 2380, qty: 35 },
            { name: 'Lamb Karahi', revenue: 1960, qty: 98 },
            { name: 'Chapli Kebabs', revenue: 1750, qty: 70 },
            { name: 'Seekh Kebab', revenue: 1540, qty: 110 },
            { name: 'Malai Chicken Boti', revenue: 1320, qty: 88 },
            { name: 'Lamb Chops', revenue: 1180, qty: 59 },
            { name: 'Chicken Tikka', revenue: 1050, qty: 105 },
            { name: 'Afghani Naan', revenue: 840, qty: 280 },
            { name: 'Saffron Rice', revenue: 680, qty: 170 },
        ];
        const byCategory = [
            { name: 'Grill & Kebabs', value: 4850 },
            { name: 'Platters', value: 3200 },
            { name: 'Karahi & Curries', value: 2800 },
            { name: 'Rice', value: 1960 },
            { name: 'Breads & Sides', value: 1200 },
            { name: 'Starters', value: 980 },
            { name: 'Desserts', value: 450 },
            { name: 'Beverages', value: 380 },
        ];
        const hourlySales = [
            { hour: '11am', sales: 120 }, { hour: '12pm', sales: 380 },
            { hour: '1pm', sales: 520 }, { hour: '2pm', sales: 340 },
            { hour: '3pm', sales: 180 }, { hour: '4pm', sales: 90 },
            { hour: '5pm', sales: 220 }, { hour: '6pm', sales: 480 },
            { hour: '7pm', sales: 680 }, { hour: '8pm', sales: 750 },
            { hour: '9pm', sales: 620 }, { hour: '10pm', sales: 340 },
            { hour: '11pm', sales: 120 },
        ];
        const totalRevenue = days.reduce((s, d) => s + d.revenue, 0);
        const totalOrders = days.reduce((s, d) => s + d.orders, 0);
        return {
            dailyRevenue: days,
            topSellers,
            byCategory,
            hourlySales,
            totalRevenue,
            totalOrders,
            avgTicket: totalOrders ? totalRevenue / totalOrders : 0,
            itemsSold: topSellers.reduce((s, t) => s + t.qty, 0),
        };
    }, []);
    /* ═══════════════════════════════════════ HELPERS ═══ */
    const formatTime = (date) => {
        if (!date) return '';
        const d = parseDate(date);
        const now = new Date();
        const diffMs = now - d;
        const diffMins = Math.floor(diffMs / 60000);
        if (diffMins < 1) return 'Just now';
        if (diffMins < 60) return `${diffMins}m ago`;
        const diffHrs = Math.floor(diffMins / 60);
        if (diffHrs < 24) return `${diffHrs}h ago`;
        const diffDays = Math.floor(diffHrs / 24);
        if (diffDays === 1) return 'Yesterday';
        return `${diffDays}d ago`;
    };

    const getStatusColor = (status) => {
        switch (status) {
            case 'delivered': return '#22c55e';
            case 'pending': return '#3b82f6';
            case 'confirmed': case 'preparing': return '#c9a96e';
            case 'ready': return '#06b6d4';
            case 'cancelled': return '#ef4444';
            default: return '#6b7280';
        }
    };

    const restaurantName = userProfile?.restaurant_name || userProfile?.name || 'Restaurant';

    /* ═══════════════════════════════════════ RENDER ═══ */
    return (
        <div className="dashboard-page">
            {/* ─── Welcome Banner ─── */}
            <div className="dashboard-welcome">
                <div>
                    <h2 className="welcome-title">{restaurantName} Analytics 📊</h2>
                    <p className="welcome-subtitle">Comprehensive analytics across inventory, orders, menu & financials.</p>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
                    <div className="welcome-date">
                        {new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
                    </div>
                    <button className="btn-refresh" onClick={fetchAll} title="Refresh"><MdRefresh /></button>
                    <button
                        className="btn btn-sm btn-secondary"
                        disabled={seeding}
                        onClick={async () => {
                            if (!restaurantId) return;
                            setSeeding(true);
                            try {
                                await seedRestaurantDashboard(restaurantId);
                                toast.success('Sample data seeded! Refreshing...');
                                await fetchAll();
                            } catch (e) {
                                console.error(e);
                                toast.error('Seeding failed: ' + e.message);
                            } finally {
                                setSeeding(false);
                            }
                        }}
                    >
                        {seeding ? 'Seeding...' : '🌱 Seed Data'}
                    </button>
                </div>
            </div>

            {/* ═══ KPI STAT CARDS ═══ */}
            <div className="stats-grid stats-grid-6">
                {[
                    { label: 'Inventory Items', value: loading ? '...' : invStats?.totalItems || 0, icon: MdInventory2, color: 'primary', sub: `Value: £${(inventoryAnalytics.totalValue || 0).toFixed(2)}` },
                    { label: 'Active Orders', value: loading ? '...' : orderAnalytics.active, icon: MdShoppingCart, color: 'info', sub: `Total placed: ${orderAnalytics.total}` },
                    { label: 'Low Stock', value: loading ? '...' : inventoryAnalytics.lowStock, icon: MdWarning, color: inventoryAnalytics.lowStock > 0 ? 'danger' : 'success', sub: `Out of stock: ${inventoryAnalytics.outOfStock}` },
                    { label: 'Menu Items', value: loading ? '...' : menuAnalytics.total, icon: MdMenuBook, color: 'primary', sub: `Active: ${menuAnalytics.active} | Inactive: ${menuAnalytics.inactive}` },
                    { label: 'CK Spend', value: loading ? '...' : `£${(invoiceAnalytics.totalAmount || 0).toFixed(2)}`, icon: MdReceipt, color: 'warning', sub: `${invoiceAnalytics.count} invoices` },
                    { label: 'Avg Margin', value: loading ? '...' : `${menuAnalytics.avgMargin.toFixed(1)}%`, icon: MdTrendingUp, color: menuAnalytics.avgMargin >= 50 ? 'success' : 'warning', sub: `Avg cost: £${menuAnalytics.avgCost.toFixed(2)}` },
                ].map((stat, idx) => (
                    <div key={idx} className="dash-stat-card">
                        <div className="dash-stat-top">
                            <div className={`dash-stat-icon ${stat.color}`}><stat.icon /></div>
                        </div>
                        <div className="dash-stat-value">{stat.value}</div>
                        <div className="dash-stat-label">{stat.label}</div>
                        <div className="dash-stat-sub">{stat.sub}</div>
                    </div>
                ))}
            </div>

            {/* ═══ DATE RANGE FILTER BAR ═══ */}
            <div className="dash-filter-bar">
                <div className="dash-filter-section">
                    <MdFilterList className="dash-filter-icon" />
                    <span className="dash-filter-label">Date Range</span>
                    <div className="dash-filter-presets">
                        {[
                            { key: 'today', label: 'Today' },
                            { key: '3days', label: 'Last 3 Days' },
                            { key: 'week', label: '1 Week' },
                            { key: 'month', label: '1 Month' },
                            { key: 'custom', label: 'Custom' },
                        ].map(f => (
                            <button key={f.key} className={`dash-filter-btn ${dateRange === f.key ? 'active' : ''}`}
                                onClick={() => setDateRange(f.key)}>
                                {f.label}
                            </button>
                        ))}
                    </div>
                </div>
                {dateRange === 'custom' && (
                    <div className="dash-filter-custom">
                        <label>From: <input type="date" className="dash-date-input" value={customFrom}
                            onChange={e => setCustomFrom(e.target.value)} /></label>
                        <label>To: <input type="date" className="dash-date-input" value={customTo}
                            onChange={e => setCustomTo(e.target.value)} /></label>
                    </div>
                )}
            </div>

            {/* ═══ QUICK ACTIONS ═══ */}
            <div className="quick-actions">
                <h3 className="section-title">Quick Actions</h3>
                <div className="actions-grid">
                    {[
                        { label: 'Order from CK', icon: MdShoppingCart, path: '/restaurant/order' },
                        { label: 'My Inventory', icon: MdInventory2, path: '/restaurant/inventory' },
                        { label: 'Menu Management', icon: MdMenuBook, path: '/restaurant/menu' },
                        { label: 'Log Waste', icon: MdDelete, path: '/waste' },
                    ].map(action => (
                        <button key={action.label} className="action-card" onClick={() => navigate(action.path)}>
                            <action.icon className="action-icon" />
                            <span className="action-label">{action.label}</span>
                            <MdArrowForward className="action-arrow" />
                        </button>
                    ))}
                </div>
            </div>

            {/* ═══════════════════════════════════════
                INVENTORY ANALYTICS SECTION
               ═══════════════════════════════════════ */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 'var(--space-3)' }}>
                    <h3 className="section-title" style={{ margin: 0 }}>📦 Inventory Analytics</h3>
                    <p style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', marginTop: -8 }}>Stock levels, values, and health across all inventory items</p>
                    <div className="dash-filter-presets">
                        <button className={`dash-filter-btn ${invTypeFilter === 'all' ? 'active' : ''}`} onClick={() => setInvTypeFilter('all')}>All Types</button>
                        <button className={`dash-filter-btn ${invTypeFilter === 'grocery' ? 'active' : ''}`} onClick={() => setInvTypeFilter('grocery')}>Grocery</button>
                        <button className={`dash-filter-btn ${invTypeFilter === 'raw_meat' ? 'active' : ''}`} onClick={() => setInvTypeFilter('raw_meat')}>Raw Meat</button>
                        <button className={`dash-filter-btn ${invTypeFilter === 'cooked_meat' ? 'active' : ''}`} onClick={() => setInvTypeFilter('cooked_meat')}>Cooked Meat</button>
                    </div>
                </div>

                <div className="dash-chart-row">
                    {/* Stock Health Pie */}
                    <div className="card dash-chart-card">
                        <div className="card-header"><h3>Stock Health Distribution</h3></div>
                        <div className="dash-chart-body">
                            {loading ? <div className="chart-loading">Loading...</div> : inventoryAnalytics.healthDist.length === 0 ? (
                                <div className="chart-empty">No inventory data</div>
                            ) : (
                                <ResponsiveContainer width="100%" height={260}>
                                    <PieChart>
                                        <Pie data={inventoryAnalytics.healthDist} cx="50%" cy="50%" labelLine={false} label={renderPieLabel}
                                            outerRadius={100} dataKey="value" strokeWidth={0}>
                                            {inventoryAnalytics.healthDist.map((_, i) => (
                                                <Cell key={i} fill={['#22c55e', '#f59e0b', '#ef4444'][i] || COLORS[i]} />
                                            ))}
                                        </Pie>
                                        <Tooltip contentStyle={tooltipStyle} />
                                        <Legend wrapperStyle={{ fontSize: 12 }} />
                                    </PieChart>
                                </ResponsiveContainer>
                            )}
                        </div>
                    </div>

                    {/* Inventory by Type Pie */}
                    <div className="card dash-chart-card">
                        <div className="card-header"><h3>Inventory Value by Type</h3></div>
                        <div className="dash-chart-body">
                            {loading ? <div className="chart-loading">Loading...</div> : inventoryAnalytics.byType.length === 0 ? (
                                <div className="chart-empty">No data</div>
                            ) : (
                                <ResponsiveContainer width="100%" height={260}>
                                    <PieChart>
                                        <Pie data={inventoryAnalytics.byType} cx="50%" cy="50%" labelLine={false}
                                            label={renderPieLabel} outerRadius={100} dataKey="value" nameKey="name" strokeWidth={0}>
                                            {inventoryAnalytics.byType.map((_, i) => (
                                                <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                                            ))}
                                        </Pie>
                                        <Tooltip contentStyle={tooltipStyle} formatter={(v) => `£${Number(v).toFixed(2)}`} />
                                        <Legend wrapperStyle={{ fontSize: 12 }} />
                                    </PieChart>
                                </ResponsiveContainer>
                            )}
                        </div>
                    </div>
                </div>

                <div className="dash-chart-row">
                    {/* Top Items by Stock Value Bar */}
                    <div className="card dash-chart-card">
                        <div className="card-header"><h3>Top 10 Items by Stock Value</h3></div>
                        <div className="dash-chart-body">
                            {loading ? <div className="chart-loading">Loading...</div> : (
                                <ResponsiveContainer width="100%" height={300}>
                                    <BarChart data={inventoryAnalytics.topByValue} layout="vertical" margin={{ left: 20, right: 20 }}>
                                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,.06)" />
                                        <XAxis type="number" tick={{ fontSize: 11, fill: '#9ca3af' }} tickFormatter={v => `£${v}`} />
                                        <YAxis dataKey="name" type="category" tick={{ fontSize: 10, fill: '#9ca3af' }} width={110} />
                                        <Tooltip contentStyle={tooltipStyle} formatter={(v) => `£${Number(v).toFixed(2)}`} />
                                        <Bar dataKey="value" fill="#c9a96e" radius={[0, 4, 4, 0]} />
                                    </BarChart>
                                </ResponsiveContainer>
                            )}
                        </div>
                    </div>

                    {/* Low Stock Alert Table */}
                    <div className="card dash-chart-card">
                        <div className="card-header">
                            <h3>⚠️ Low Stock Alerts</h3>
                            <button className="btn btn-sm btn-secondary" onClick={() => navigate('/restaurant/inventory')}>
                                View All <MdArrowForward />
                            </button>
                        </div>
                        <div className="card-body" style={{ padding: 0, maxHeight: 300, overflowY: 'auto' }}>
                            {loading ? <div className="chart-loading">Loading...</div> :
                                inventoryAnalytics.lowStockItems.length === 0 ? (
                                    <div className="chart-empty" style={{ color: '#22c55e' }}>✅ All items in stock!</div>
                                ) : (
                                    <div className="activity-list">
                                        {inventoryAnalytics.lowStockItems.map((item, idx) => (
                                            <div key={idx} className="activity-item">
                                                <div className="activity-dot" style={{
                                                    background: (item.current_stock || 0) <= 0 ? '#ef4444' : '#f59e0b'
                                                }} />
                                                <div className="activity-content">
                                                    <p className="activity-text" style={{ fontWeight: 600 }}>
                                                        {item.item_name || item.name}
                                                    </p>
                                                    <span className="activity-time">
                                                        Stock: {(item.current_stock || 0).toFixed(2)} {item.unit || ''} | Threshold: {item.low_stock_threshold || 5}
                                                    </span>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                        </div>
                    </div>
                </div>

                {/* Inventory by Category Bar */}
                <div className="card dash-chart-card">
                    <div className="card-header"><h3>Inventory Value by Category</h3></div>
                    <div className="dash-chart-body">
                        {loading ? <div className="chart-loading">Loading...</div> : (
                            <ResponsiveContainer width="100%" height={280}>
                                <BarChart data={inventoryAnalytics.byCategory} margin={{ left: 10, right: 20 }}>
                                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,.06)" />
                                    <XAxis dataKey="name" tick={{ fontSize: 10, fill: '#9ca3af' }} angle={-35} textAnchor="end" height={60} />
                                    <YAxis tick={{ fontSize: 11, fill: '#9ca3af' }} tickFormatter={v => `£${v}`} />
                                    <Tooltip contentStyle={tooltipStyle} formatter={(v, name) => [name === 'value' ? `£${Number(v).toFixed(2)}` : v, name === 'value' ? 'Value' : 'Items']} />
                                    <Bar dataKey="value" fill="#3b82f6" radius={[4, 4, 0, 0]} name="Value" />
                                    <Bar dataKey="count" fill="#c9a96e" radius={[4, 4, 0, 0]} name="Items" />
                                </BarChart>
                            </ResponsiveContainer>
                        )}
                    </div>
                </div>
            </div>

            {/* ═══════════════════════════════════════
                CK ORDERS ANALYTICS SECTION
               ═══════════════════════════════════════ */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
                <h3 className="section-title" style={{ margin: 0 }}>🛒 CK Order Analytics</h3>
                <p style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', marginTop: -8 }}>Orders placed to Central Kitchen — supply chain tracking</p>

                {/* KPI Row */}
                <div className="kpi-row">
                    <div className="kpi-card">
                        <div className="kpi-value">{loading ? '...' : orderAnalytics.total}</div>
                        <div className="kpi-label">Total Orders</div>
                    </div>
                    <div className="kpi-card">
                        <div className="kpi-value" style={{ color: '#22c55e' }}>{loading ? '...' : orderAnalytics.delivered}</div>
                        <div className="kpi-label">Delivered</div>
                    </div>
                    <div className="kpi-card">
                        <div className="kpi-value">£{loading ? '...' : orderAnalytics.totalAmount.toFixed(2)}</div>
                        <div className="kpi-label">Total Spend</div>
                    </div>
                    <div className="kpi-card">
                        <div className="kpi-value">£{loading ? '...' : orderAnalytics.avgValue.toFixed(2)}</div>
                        <div className="kpi-label">Avg Order Value</div>
                    </div>
                </div>

                <div className="dash-chart-row">
                    {/* Order Trend */}
                    <div className="card dash-chart-card">
                        <div className="card-header"><h3>Order Trend</h3></div>
                        <div className="dash-chart-body">
                            {loading ? <div className="chart-loading">Loading...</div> : orderAnalytics.trend.length === 0 ? (
                                <div className="chart-empty">No order data yet</div>
                            ) : (
                                <ResponsiveContainer width="100%" height={280}>
                                    <AreaChart data={orderAnalytics.trend} margin={{ left: 10, right: 20 }}>
                                        <defs>
                                            <linearGradient id="orderGrad" x1="0" y1="0" x2="0" y2="1">
                                                <stop offset="5%" stopColor="#c9a96e" stopOpacity={0.3} />
                                                <stop offset="95%" stopColor="#c9a96e" stopOpacity={0} />
                                            </linearGradient>
                                        </defs>
                                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,.06)" />
                                        <XAxis dataKey="period" tick={{ fontSize: 11, fill: '#9ca3af' }} />
                                        <YAxis yAxisId="left" tick={{ fontSize: 11, fill: '#9ca3af' }} tickFormatter={v => `£${v}`} />
                                        <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11, fill: '#9ca3af' }} />
                                        <Tooltip contentStyle={tooltipStyle} />
                                        <Area yAxisId="left" type="monotone" dataKey="amount" stroke="#c9a96e" fill="url(#orderGrad)" strokeWidth={2} name="Amount (£)" />
                                        <Line yAxisId="right" type="monotone" dataKey="orders" stroke="#3b82f6" strokeWidth={2} dot={{ r: 3, fill: '#3b82f6' }} name="Orders" />
                                        <Legend wrapperStyle={{ fontSize: 12 }} />
                                    </AreaChart>
                                </ResponsiveContainer>
                            )}
                        </div>
                    </div>

                    {/* Orders by Status Pie */}
                    <div className="card dash-chart-card">
                        <div className="card-header"><h3>Orders by Status</h3></div>
                        <div className="dash-chart-body">
                            {loading ? <div className="chart-loading">Loading...</div> : orderAnalytics.byStatus.length === 0 ? (
                                <div className="chart-empty">No data</div>
                            ) : (
                                <ResponsiveContainer width="100%" height={280}>
                                    <PieChart>
                                        <Pie data={orderAnalytics.byStatus} cx="50%" cy="50%" labelLine={false}
                                            label={renderPieLabel} outerRadius={100} dataKey="value" strokeWidth={0}>
                                            {orderAnalytics.byStatus.map((entry, i) => (
                                                <Cell key={i} fill={getStatusColor(entry.name)} />
                                            ))}
                                        </Pie>
                                        <Tooltip contentStyle={tooltipStyle} />
                                        <Legend wrapperStyle={{ fontSize: 12 }} />
                                    </PieChart>
                                </ResponsiveContainer>
                            )}
                        </div>
                    </div>
                </div>

                {/* Recent Activity */}
                <div className="card">
                    <div className="card-header">
                        <h3>Recent Orders</h3>
                        <button className="btn btn-sm btn-secondary" onClick={() => navigate('/restaurant/orders')}>
                            View All <MdArrowForward />
                        </button>
                    </div>
                    <div className="card-body" style={{ padding: 0 }}>
                        <div className="activity-list">
                            {loading ? (
                                Array.from({ length: 3 }).map((_, i) => (
                                    <div key={i} className="activity-item">
                                        <div className="activity-dot" style={{ background: 'var(--color-text-muted)' }} />
                                        <div className="activity-content">
                                            <div className="skeleton skeleton-text" style={{ height: 14, width: '60%' }} />
                                        </div>
                                    </div>
                                ))
                            ) : orderAnalytics.recent.length === 0 ? (
                                <div className="activity-item">
                                    <div className="activity-dot" style={{ background: 'var(--color-text-muted)' }} />
                                    <div className="activity-content">
                                        <p className="activity-text">No recent orders. Place an order to get started!</p>
                                    </div>
                                </div>
                            ) : (
                                orderAnalytics.recent.map((order, idx) => {
                                    const num = order.order_number || order.id?.slice(0, 8);
                                    const items = order.items?.length || 0;
                                    const total = (order.total_amount || 0).toFixed(2);
                                    return (
                                        <div key={idx} className="activity-item">
                                            <div className="activity-dot" style={{ background: getStatusColor(order.status) }} />
                                            <div className="activity-content">
                                                <p className="activity-text">
                                                    Order #{num} — {items} items, £{total}
                                                    <span style={{
                                                        marginLeft: 8, fontSize: 11, fontWeight: 600,
                                                        padding: '1px 8px', borderRadius: 99,
                                                        background: `${getStatusColor(order.status)}20`,
                                                        color: getStatusColor(order.status),
                                                    }}>
                                                        {order.status}
                                                    </span>
                                                </p>
                                                <span className="activity-time">{formatTime(order.created_at)}</span>
                                            </div>
                                        </div>
                                    );
                                })
                            )}
                        </div>
                    </div>
                </div>
            </div>

            {/* ═══════════════════════════════════════
                MENU ANALYTICS SECTION
               ═══════════════════════════════════════ */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 'var(--space-3)' }}>
                    <h3 className="section-title" style={{ margin: 0 }}>🍽️ Menu Analytics</h3>
                    <p style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', marginTop: -8 }}>Menu item costs, margins, pricing analysis, and allergen coverage</p>
                    <div className="dash-filter-presets">
                        <button className={`dash-filter-btn ${menuCatFilter === 'all' ? 'active' : ''}`} onClick={() => setMenuCatFilter('all')}>All</button>
                        {MENU_CATEGORIES.map(cat => (
                            <button key={cat.value} className={`dash-filter-btn ${menuCatFilter === cat.value ? 'active' : ''}`}
                                onClick={() => setMenuCatFilter(cat.value)}>
                                {cat.icon} {cat.label}
                            </button>
                        ))}
                    </div>
                </div>

                {/* Menu KPIs */}
                <div className="kpi-row">
                    <div className="kpi-card">
                        <div className="kpi-value">{loading ? '...' : menuAnalytics.total}</div>
                        <div className="kpi-label">Menu Items</div>
                    </div>
                    <div className="kpi-card">
                        <div className="kpi-value">{loading ? '...' : menuAnalytics.portionCount}</div>
                        <div className="kpi-label">Total Portions</div>
                    </div>
                    <div className="kpi-card">
                        <div className="kpi-value" style={{ color: menuAnalytics.avgMargin >= 50 ? '#22c55e' : '#f59e0b' }}>
                            {loading ? '...' : `${menuAnalytics.avgMargin.toFixed(1)}%`}
                        </div>
                        <div className="kpi-label">Avg Profit Margin</div>
                    </div>
                    <div className="kpi-card">
                        <div className="kpi-value" style={{ color: menuAnalytics.missingRecipe > 0 ? '#ef4444' : '#22c55e' }}>
                            {loading ? '...' : menuAnalytics.missingRecipe}
                        </div>
                        <div className="kpi-label">Missing Recipes</div>
                    </div>
                </div>

                <div className="dash-chart-row">
                    {/* Menu Items by Category Pie */}
                    <div className="card dash-chart-card">
                        <div className="card-header"><h3>Items by Category</h3></div>
                        <div className="dash-chart-body">
                            {loading ? <div className="chart-loading">Loading...</div> : menuAnalytics.byCategory.length === 0 ? (
                                <div className="chart-empty">No menu items</div>
                            ) : (
                                <ResponsiveContainer width="100%" height={280}>
                                    <PieChart>
                                        <Pie data={menuAnalytics.byCategory} cx="50%" cy="50%" labelLine={false}
                                            label={renderPieLabel} outerRadius={100} dataKey="value" strokeWidth={0}>
                                            {menuAnalytics.byCategory.map((_, i) => (
                                                <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                                            ))}
                                        </Pie>
                                        <Tooltip contentStyle={tooltipStyle} />
                                        <Legend wrapperStyle={{ fontSize: 12 }} />
                                    </PieChart>
                                </ResponsiveContainer>
                            )}
                        </div>
                    </div>

                    {/* Allergen Bar Chart */}
                    <div className="card dash-chart-card">
                        <div className="card-header"><h3>Allergen Coverage</h3></div>
                        <div className="dash-chart-body">
                            <p style={{ fontSize: 11, color: 'var(--color-text-muted)', margin: '0 0 8px 8px' }}>Number of menu items containing each allergen</p>
                            {loading ? <div className="chart-loading">Loading...</div> : menuAnalytics.allergenDist.length === 0 ? (
                                <div className="chart-empty">No allergen data</div>
                            ) : (
                                <ResponsiveContainer width="100%" height={260}>
                                    <BarChart data={menuAnalytics.allergenDist} layout="vertical" margin={{ left: 10, right: 20 }}>
                                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,.06)" />
                                        <XAxis type="number" tick={{ fontSize: 11, fill: '#9ca3af' }} allowDecimals={false} />
                                        <YAxis dataKey="allergen" type="category" tick={{ fontSize: 11, fill: '#9ca3af' }} width={55} />
                                        <Tooltip contentStyle={tooltipStyle} formatter={(v) => `${v} items`} />
                                        <Bar dataKey="count" fill="#f59e0b" radius={[0, 4, 4, 0]} name="Items" />
                                    </BarChart>
                                </ResponsiveContainer>
                            )}
                        </div>
                    </div>
                </div>

                {/* Top Margin Portions */}
                <div className="card dash-chart-card">
                    <div className="card-header"><h3>🏆 Top 10 Profitable Portions (by Margin %)</h3></div>
                    <div className="dash-chart-body">
                        {loading ? <div className="chart-loading">Loading...</div> : menuAnalytics.topMargin.length === 0 ? (
                            <div className="chart-empty">Add recipes to see margin data</div>
                        ) : (
                            <ResponsiveContainer width="100%" height={350}>
                                <BarChart data={menuAnalytics.topMargin} layout="vertical" margin={{ left: 20, right: 20 }}>
                                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,.06)" />
                                    <XAxis type="number" tick={{ fontSize: 11, fill: '#9ca3af' }} domain={[0, 100]} tickFormatter={v => `${v}%`} />
                                    <YAxis dataKey="name" type="category" tick={{ fontSize: 10, fill: '#9ca3af' }} width={120} />
                                    <Tooltip contentStyle={tooltipStyle}
                                        formatter={(v, name) => name === 'margin' ? `${v}%` : `£${v}`}
                                        labelFormatter={name => name} />
                                    <Bar dataKey="margin" fill="#22c55e" radius={[0, 4, 4, 0]} name="Margin %" />
                                </BarChart>
                            </ResponsiveContainer>
                        )}
                    </div>
                </div>

                {/* Low Margin Alert */}
                <div className="card dash-chart-card">
                    <div className="card-header"><h3>⚠️ Lowest Margin Portions (Review Pricing)</h3></div>
                    <div className="dash-chart-body">
                        {loading ? <div className="chart-loading">Loading...</div> : menuAnalytics.lowMargin.length === 0 ? (
                            <div className="chart-empty">Add recipes to see margin data</div>
                        ) : (
                            <ResponsiveContainer width="100%" height={350}>
                                <BarChart data={menuAnalytics.lowMargin} layout="vertical" margin={{ left: 20, right: 20 }}>
                                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,.06)" />
                                    <XAxis type="number" tick={{ fontSize: 11, fill: '#9ca3af' }} tickFormatter={v => `${v}%`} />
                                    <YAxis dataKey="name" type="category" tick={{ fontSize: 10, fill: '#9ca3af' }} width={120} />
                                    <Tooltip contentStyle={tooltipStyle}
                                        formatter={(v, name) => name === 'margin' ? `${v}%` : `£${v}`} />
                                    <Bar dataKey="margin" fill="#ef4444" radius={[0, 4, 4, 0]} name="Margin %" />
                                </BarChart>
                            </ResponsiveContainer>
                        )}
                    </div>
                </div>

                <div className="dash-chart-row">
                    {/* Cost vs Selling Price */}
                    <div className="card dash-chart-card">
                        <div className="card-header"><h3>Cost vs Selling Price (Top 15)</h3></div>
                        <div className="dash-chart-body">
                            {loading ? <div className="chart-loading">Loading...</div> : menuAnalytics.costVsPrice.length === 0 ? (
                                <div className="chart-empty">No data</div>
                            ) : (
                                <ResponsiveContainer width="100%" height={300}>
                                    <BarChart data={menuAnalytics.costVsPrice} margin={{ left: 10, right: 20 }}>
                                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,.06)" />
                                        <XAxis dataKey="name" tick={{ fontSize: 9, fill: '#9ca3af' }} angle={-40} textAnchor="end" height={70} />
                                        <YAxis tick={{ fontSize: 11, fill: '#9ca3af' }} tickFormatter={v => `£${v}`} />
                                        <Tooltip contentStyle={tooltipStyle} formatter={v => `£${v}`} />
                                        <Legend wrapperStyle={{ fontSize: 12 }} />
                                        <Bar dataKey="cost" fill="#ef4444" radius={[4, 4, 0, 0]} name="Cost" />
                                        <Bar dataKey="price" fill="#22c55e" radius={[4, 4, 0, 0]} name="Selling Price" />
                                    </BarChart>
                                </ResponsiveContainer>
                            )}
                        </div>
                    </div>

                    {/* Price Distribution */}
                    <div className="card dash-chart-card">
                        <div className="card-header"><h3>Price Range Distribution</h3></div>
                        <div className="dash-chart-body">
                            {loading ? <div className="chart-loading">Loading...</div> : (
                                <ResponsiveContainer width="100%" height={300}>
                                    <AreaChart data={menuAnalytics.priceDist} margin={{ left: 10, right: 20 }}>
                                        <defs>
                                            <linearGradient id="priceGrad" x1="0" y1="0" x2="0" y2="1">
                                                <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.3} />
                                                <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0} />
                                            </linearGradient>
                                        </defs>
                                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,.06)" />
                                        <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#9ca3af' }} />
                                        <YAxis tick={{ fontSize: 11, fill: '#9ca3af' }} />
                                        <Tooltip contentStyle={tooltipStyle} />
                                        <Area type="monotone" dataKey="count" stroke="#8b5cf6" fill="url(#priceGrad)" strokeWidth={2} name="Portions" />
                                    </AreaChart>
                                </ResponsiveContainer>
                            )}
                        </div>
                    </div>
                </div>
            </div>

            {/* ═══════════════════════════════════════
                FINANCIAL / CK SPEND ANALYTICS
               ═══════════════════════════════════════ */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
                <h3 className="section-title" style={{ margin: 0 }}>💰 CK Spend Analytics</h3>
                <p style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', marginTop: -8 }}>Central Kitchen procurement spend and invoice tracking</p>

                <div className="kpi-row" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
                    <div className="kpi-card">
                        <div className="kpi-value">£{loading ? '...' : invoiceAnalytics.totalAmount.toFixed(2)}</div>
                        <div className="kpi-label">Total CK Spend</div>
                    </div>
                    <div className="kpi-card">
                        <div className="kpi-value">{loading ? '...' : invoiceAnalytics.count}</div>
                        <div className="kpi-label">Invoices Received</div>
                    </div>
                    <div className="kpi-card">
                        <div className="kpi-value">£{loading ? '...' : invoiceAnalytics.avgAmount.toFixed(2)}</div>
                        <div className="kpi-label">Avg Invoice Value</div>
                    </div>
                </div>

                <div className="card dash-chart-card">
                    <div className="card-header"><h3>CK Spend Trend</h3></div>
                    <div className="dash-chart-body">
                        {loading ? <div className="chart-loading">Loading...</div> : invoiceAnalytics.spendTrend.length === 0 ? (
                            <div className="chart-empty">No invoice data yet</div>
                        ) : (
                            <ResponsiveContainer width="100%" height={300}>
                                <AreaChart data={invoiceAnalytics.spendTrend} margin={{ left: 10, right: 20 }}>
                                    <defs>
                                        <linearGradient id="spendGrad" x1="0" y1="0" x2="0" y2="1">
                                            <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.3} />
                                            <stop offset="95%" stopColor="#f59e0b" stopOpacity={0} />
                                        </linearGradient>
                                    </defs>
                                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,.06)" />
                                    <XAxis dataKey="period" tick={{ fontSize: 11, fill: '#9ca3af' }} />
                                    <YAxis yAxisId="left" tick={{ fontSize: 11, fill: '#9ca3af' }} tickFormatter={v => `£${v}`} />
                                    <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11, fill: '#9ca3af' }} />
                                    <Tooltip contentStyle={tooltipStyle} />
                                    <Area yAxisId="left" type="monotone" dataKey="spend" stroke="#f59e0b" fill="url(#spendGrad)" strokeWidth={2} name="Spend (£)" />
                                    <Line yAxisId="right" type="monotone" dataKey="count" stroke="#3b82f6" strokeWidth={2} dot={{ fill: '#3b82f6', r: 3 }} name="Invoice Count" />
                                    <Legend wrapperStyle={{ fontSize: 12 }} />
                                </AreaChart>
                            </ResponsiveContainer>
                        )}
                    </div>
                </div>
            </div>

            {/* ═══════════════════════════════════════
                EPOS SALES ANALYTICS (Simulated / Awaiting Webhook)
               ═══════════════════════════════════════ */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
                <div>
                    <h3 className="section-title" style={{ margin: 0 }}>📈 Sales Analytics (EPOS)</h3>
                    <p style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', marginTop: -8 }}>
                        Revenue, top sellers, and sales trends — <span style={{ color: '#f59e0b', fontWeight: 600 }}>Sample data shown • Will use live EPOS webhook data after integration</span>
                    </p>
                </div>

                <div className="kpi-row">
                    <div className="kpi-card">
                        <div className="kpi-value" style={{ color: '#22c55e' }}>£{eposSample.totalRevenue.toLocaleString()}</div>
                        <div className="kpi-label">Total Revenue (sample)</div>
                    </div>
                    <div className="kpi-card">
                        <div className="kpi-value">{eposSample.totalOrders}</div>
                        <div className="kpi-label">Total Sales Orders</div>
                    </div>
                    <div className="kpi-card">
                        <div className="kpi-value">£{eposSample.avgTicket.toFixed(2)}</div>
                        <div className="kpi-label">Avg Ticket Size</div>
                    </div>
                    <div className="kpi-card">
                        <div className="kpi-value">{eposSample.itemsSold}</div>
                        <div className="kpi-label">Items Sold</div>
                    </div>
                </div>

                <div className="dash-chart-row">
                    <div className="card dash-chart-card">
                        <div className="card-header"><h3>Daily Revenue Trend (Last 14 Days)</h3></div>
                        <div className="dash-chart-body">
                            <ResponsiveContainer width="100%" height={280}>
                                <AreaChart data={eposSample.dailyRevenue} margin={{ left: 10, right: 20 }}>
                                    <defs>
                                        <linearGradient id="revGrad" x1="0" y1="0" x2="0" y2="1">
                                            <stop offset="5%" stopColor="#22c55e" stopOpacity={0.3} />
                                            <stop offset="95%" stopColor="#22c55e" stopOpacity={0} />
                                        </linearGradient>
                                    </defs>
                                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,.06)" />
                                    <XAxis dataKey="day" tick={{ fontSize: 11, fill: '#9ca3af' }} />
                                    <YAxis tick={{ fontSize: 11, fill: '#9ca3af' }} tickFormatter={v => `£${v}`} />
                                    <Tooltip contentStyle={tooltipStyle} formatter={v => `£${v}`} />
                                    <Area type="monotone" dataKey="revenue" stroke="#22c55e" fill="url(#revGrad)" strokeWidth={2} name="Revenue" />
                                    <Line type="monotone" dataKey="orders" stroke="#c9a96e" strokeWidth={2} dot={false} name="Orders" />
                                    <Legend wrapperStyle={{ fontSize: 12 }} />
                                </AreaChart>
                            </ResponsiveContainer>
                        </div>
                    </div>

                    <div className="card dash-chart-card">
                        <div className="card-header"><h3>Sales by Category</h3></div>
                        <div className="dash-chart-body">
                            <ResponsiveContainer width="100%" height={280}>
                                <PieChart>
                                    <Pie data={eposSample.byCategory} cx="50%" cy="50%" labelLine={false}
                                        label={renderPieLabel} outerRadius={100} dataKey="value" strokeWidth={0}>
                                        {eposSample.byCategory.map((_, i) => (
                                            <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                                        ))}
                                    </Pie>
                                    <Tooltip contentStyle={tooltipStyle} formatter={v => `£${v}`} />
                                    <Legend wrapperStyle={{ fontSize: 12 }} />
                                </PieChart>
                            </ResponsiveContainer>
                        </div>
                    </div>
                </div>

                <div className="card dash-chart-card">
                    <div className="card-header"><h3>Top 10 Best Sellers (by Revenue)</h3></div>
                    <div className="dash-chart-body">
                        <ResponsiveContainer width="100%" height={320}>
                            <BarChart data={eposSample.topSellers} layout="vertical" margin={{ left: 20, right: 20 }}>
                                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,.06)" />
                                <XAxis type="number" tick={{ fontSize: 11, fill: '#9ca3af' }} tickFormatter={v => `£${v}`} />
                                <YAxis dataKey="name" type="category" tick={{ fontSize: 10, fill: '#9ca3af' }} width={120} />
                                <Tooltip contentStyle={tooltipStyle} formatter={(v, name) => name === 'revenue' ? `£${v}` : `${v} sold`} />
                                <Bar dataKey="revenue" fill="#c9a96e" radius={[0, 4, 4, 0]} name="Revenue" />
                            </BarChart>
                        </ResponsiveContainer>
                    </div>
                </div>

                <div className="card dash-chart-card">
                    <div className="card-header"><h3>Hourly Sales Pattern</h3></div>
                    <div className="dash-chart-body">
                        <p style={{ fontSize: 11, color: 'var(--color-text-muted)', margin: '0 0 8px 8px' }}>Average sales per hour — identify peak and slow periods</p>
                        <ResponsiveContainer width="100%" height={250}>
                            <BarChart data={eposSample.hourlySales} margin={{ left: 10, right: 20 }}>
                                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,.06)" />
                                <XAxis dataKey="hour" tick={{ fontSize: 10, fill: '#9ca3af' }} />
                                <YAxis tick={{ fontSize: 11, fill: '#9ca3af' }} tickFormatter={v => `£${v}`} />
                                <Tooltip contentStyle={tooltipStyle} formatter={v => `£${v}`} />
                                <Bar dataKey="sales" fill="#8b5cf6" radius={[4, 4, 0, 0]} name="Avg Sales" />
                            </BarChart>
                        </ResponsiveContainer>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default RestaurantDashboard;
