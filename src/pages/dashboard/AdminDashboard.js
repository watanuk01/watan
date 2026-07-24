import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend,
    LineChart, Line, XAxis, YAxis, CartesianGrid,
    BarChart, Bar,
} from 'recharts';
import {
    MdInventory2, MdShoppingCart, MdLocalShipping, MdWarning,
    MdDelete, MdOutlineKitchen, MdRefresh, MdArrowForward,
    MdTrendingUp, MdTimer, MdFilterList, MdCalendarToday,
    MdStore, MdClear, MdUploadFile, MdClose,
    MdAttachMoney, MdCheckCircle, MdPending,
} from 'react-icons/md';
import { useAuth } from '../../contexts/AuthContext';
import {
    fetchDashboardMetrics,
    fetchInventoryByCategory,
    fetchDailyOrderVolume,
    fetchTopOrderedItems,
    fetchTopRestaurants,
    fetchWasteByCategory,
    fetchItemDailyTrend,
    fetchItemRestaurantMatrix,
    fetchRestaurantDirectory,
    DATE_PRESETS,
    getPresetDates,
    clearCache,
    formatCurrency,
    endOfDay,
    startOfDay,
} from '../../services/analyticsService';
import { getStatusInfo } from '../../services/orderService';
import { getEposEvents } from '../../services/eposService';
import { getMenuItems } from '../../services/menuService';
import { getRestaurantInventory } from '../../services/restaurantInventoryService';
import EposSalesTable from '../../components/epos/EposSalesTable';
import toast from 'react-hot-toast';
import { runFullSeed } from '../../services/seedService';
import { syncCategoryNamesOnItems } from '../../services/inventoryService';
import './Dashboard.css';

const CHART_COLORS = ['#c9a96e', '#3b82f6', '#22c55e', '#f59e0b', '#8b5cf6', '#ef4444', '#14b8a6', '#f97316'];
const TREND_COLORS = ['#c9a96e', '#3b82f6', '#22c55e', '#f59e0b', '#8b5cf6', '#ef4444', '#14b8a6', '#ec4899', '#06b6d4', '#84cc16'];
const GRID_COLOR = 'rgba(255,255,255,0.08)';
const TEXT_COLOR = '#9ca3af';
const tooltipStyle = { background: '#1e1e2e', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 8, color: '#f1f5f9', fontSize: 12 };

const greeting = () => {
    const h = new Date().getHours();
    if (h < 12) return 'Good Morning';
    if (h < 17) return 'Good Afternoon';
    return 'Good Evening';
};

const shortVal = v => (v >= 1000 ? `£${(v / 1000).toFixed(1)}k` : `£${v}`);
const shortNum = v => (v >= 1000 ? `${(v / 1000).toFixed(1)}k` : v);

const renderPieLabel = ({ cx, cy, midAngle, innerRadius, outerRadius, percent }) => {
    if (percent < 0.05) return null;
    const R = Math.PI / 180;
    const r = innerRadius + (outerRadius - innerRadius) * 0.5;
    return (
        <text x={cx + r * Math.cos(-midAngle * R)} y={cy + r * Math.sin(-midAngle * R)}
            fill="#fff" textAnchor="middle" dominantBaseline="central" fontSize={11} fontWeight={700}>
            {`${(percent * 100).toFixed(0)}%`}
        </text>
    );
};

const StatCard = ({ label, value, sub, icon: Icon, color, onClick }) => (
    <div className={`dash-stat-card ${onClick ? 'clickable' : ''}`} onClick={onClick}>
        <div className="dash-stat-top">
            <div className={`dash-stat-icon ${color}`}><Icon /></div>
        </div>
        <div className="dash-stat-value">{value}</div>
        <div className="dash-stat-label">{label}</div>
        {sub && <div className="dash-stat-sub">{sub}</div>}
    </div>
);

// ═══════════════════════════════════════════════════════
// FILTER BAR COMPONENT
// ═══════════════════════════════════════════════════════
const FilterBar = ({ filters, onChange, restaurants }) => {
    const [showCustom, setShowCustom] = useState(false);
    const [customFrom, setCustomFrom] = useState('');
    const [customTo, setCustomTo] = useState('');

    const handlePreset = (preset) => {
        if (preset.id === 'custom') {
            setShowCustom(true);
            return;
        }
        setShowCustom(false);
        const { dateFrom, dateTo } = getPresetDates(preset.id);
        onChange({ ...filters, preset: preset.id, dateFrom, dateTo });
    };

    const applyCustom = () => {
        if (!customFrom || !customTo) { toast.error('Please select both dates'); return; }
        // Use London timezone for consistent date boundaries
        const toLondonDate = (dateStr, h, m, s, ms) => {
            const [y, mo, d] = dateStr.split('-').map(Number);
            // Calculate offset WITHOUT ms (toLocaleString drops ms, causing rounding errors)
            const guess = new Date(y, mo - 1, d, h, m, s, 0);
            const inTz = new Date(guess.toLocaleString('en-US', { timeZone: 'Europe/London' }));
            return new Date(guess.getTime() + (guess - inTz) + ms);
        };
        const df = toLondonDate(customFrom, 0, 0, 0, 0);
        const dt = toLondonDate(customTo, 23, 59, 59, 999);
        if (df > dt) { toast.error('Start date must be before end date'); return; }
        onChange({ ...filters, preset: 'custom', dateFrom: df, dateTo: dt });
        setShowCustom(false);
    };

    const clearRestaurant = () => onChange({ ...filters, restaurantId: null, restaurantName: null });

    return (
        <div className="dash-filter-bar">
            <div className="dash-filter-section">
                <MdFilterList className="dash-filter-icon" />
                <span className="dash-filter-label">Period:</span>
                <div className="dash-filter-presets">
                    {DATE_PRESETS.filter(p => p.id !== 'custom').map(p => (
                        <button key={p.id}
                            className={`dash-filter-btn ${filters.preset === p.id ? 'active' : ''}`}
                            onClick={() => handlePreset(p)}>
                            {p.label}
                        </button>
                    ))}
                    <button
                        className={`dash-filter-btn ${filters.preset === 'custom' ? 'active' : ''}`}
                        onClick={() => setShowCustom(v => !v)}>
                        <MdCalendarToday style={{ fontSize: 13 }} /> Custom
                    </button>
                </div>
            </div>

            {restaurants?.length > 0 && (
                <div className="dash-filter-section">
                    <MdStore className="dash-filter-icon" />
                    <span className="dash-filter-label">Restaurant:</span>
                    <select
                        className="dash-filter-select"
                        value={filters.restaurantName || ''}
                        onChange={e => {
                            const rn = e.target.value;
                            const r = restaurants.find(r => r.restaurant_name === rn);
                            onChange({ ...filters, restaurantId: r?.id || null, restaurantName: rn || null });
                        }}>
                        <option value="">All Restaurants</option>
                        {restaurants.map(r => (
                            <option key={r.id} value={r.restaurant_name}>{r.restaurant_name}</option>
                        ))}
                    </select>
                    {filters.restaurantName && (
                        <button className="dash-filter-clear" onClick={clearRestaurant} title="Clear restaurant filter">
                            <MdClear />
                        </button>
                    )}
                </div>
            )}

            {showCustom && (
                <div className="dash-filter-custom">
                    <label>From:
                        <input type="date" value={customFrom} onChange={e => setCustomFrom(e.target.value)}
                            className="dash-date-input" max={customTo || undefined} />
                    </label>
                    <label>To:
                        <input type="date" value={customTo} onChange={e => setCustomTo(e.target.value)}
                            className="dash-date-input" min={customFrom || undefined} />
                    </label>
                    <button className="btn btn-primary btn-sm" onClick={applyCustom}>Apply</button>
                    <button className="btn btn-ghost btn-sm" onClick={() => setShowCustom(false)}>Cancel</button>
                </div>
            )}

            {/* Active filter summary */}
            {(filters.restaurantName || filters.preset !== '30d') && (
                <div className="dash-filter-active">
                    {filters.preset === 'custom'
                        ? `${filters.dateFrom?.toLocaleDateString('en-GB', { timeZone: 'Europe/London' })} → ${filters.dateTo?.toLocaleDateString('en-GB', { timeZone: 'Europe/London' })}`
                        : DATE_PRESETS.find(p => p.id === filters.preset)?.label}
                    {filters.restaurantName && ` • ${filters.restaurantName}`}
                </div>
            )}
        </div>
    );
};

// ═══════════════════════════════════════════════════════
// MAIN DASHBOARD
// ═══════════════════════════════════════════════════════
const AdminDashboard = () => {
    const { userProfile } = useAuth();
    const navigate = useNavigate();

    const defaultFilters = { preset: '30d', ...getPresetDates('30d'), restaurantId: null, restaurantName: null };
    const [filters, setFilters] = useState(defaultFilters);
    const [restaurants, setRestaurants] = useState([]);

    const [metrics, setMetrics] = useState(null);
    const [invByCategory, setInvByCategory] = useState([]);
    const [dailyVolume, setDailyVolume] = useState([]);
    const [topItems, setTopItems] = useState([]);
    const [topRestaurants, setTopRestaurants] = useState([]);
    const [wasteByCat, setWasteByCat] = useState([]);
    const [itemTrend, setItemTrend] = useState({ data: [], itemNames: [] });
    const [itemMatrix, setItemMatrix] = useState({ items: [], restaurantNames: [], maxQty: 0, highlightRestaurant: null });
    const [loading, setLoading] = useState(true);
    const [chartsLoading, setChartsLoading] = useState(true);

    // Item Demand Analysis state
    const [demandTab, setDemandTab] = useState('trend'); // 'trend' | 'restaurant'
    const [trendExpanded, setTrendExpanded] = useState(false);
    const trendLimit = trendExpanded ? 15 : 5;

    const [showSeedModal, setShowSeedModal] = useState(false);
    const [seedFile, setSeedFile] = useState(null);
    const [seedRunning, setSeedRunning] = useState(false);
    const [seedLogs, setSeedLogs] = useState([]);
    const [seedConfirmed, setSeedConfirmed] = useState(false);
    const [seedDone, setSeedDone] = useState(false);
    const seedFileRef = useRef(null);
    const seedLogRef = useRef(null);

    // EPOS Admin Analytics state
    // Raw combined data across ALL restaurants
    const [eposAllEvents, setEposAllEvents] = useState([]);
    const [eposAllMenuItems, setEposAllMenuItems] = useState([]);
    const [eposAllInventory, setEposAllInventory] = useState([]);
    const [eposAdminLoading, setEposAdminLoading] = useState(false);
    const [eposAdminLoaded, setEposAdminLoaded] = useState(false);
    // Filter — empty string = All Restaurants
    const [eposRestaurantFilter, setEposRestaurantFilter] = useState('');

    // Load EPOS data for ALL restaurants in parallel — NO Firestore date filter.
    // We fetch up to 2000 events per restaurant once, then the render IIFE
    // filters client-side using the live `filters` state. This avoids ALL
    // stale-closure issues: no re-fetch is ever needed when the date changes.
    const loadEposAllData = useCallback(async (restaurantList) => {
        if (!restaurantList?.length) return;
        setEposAdminLoading(true);
        try {
            const results = await Promise.all(
                restaurantList.map(async (r) => {
                    const [evts, menu, inv] = await Promise.all([
                        // Fetch all recent events — no date constraint so client-side filter is authoritative
                        getEposEvents(r.id, { limit: 2000 }).catch(() => []),
                        getMenuItems(r.id).catch(() => []),
                        getRestaurantInventory(r.id).catch(() => []),
                    ]);
                    const taggedEvts = (evts || []).map(e => ({
                        ...e,
                        restaurant_name: e.restaurant_name || r.restaurant_name,
                        _restaurant_id: r.id,
                    }));
                    return { evts: taggedEvts, menu: menu || [], inv: inv || [] };
                })
            );
            setEposAllEvents(results.flatMap(r => r.evts));
            setEposAllMenuItems(results.flatMap(r => r.menu));
            setEposAllInventory(results.flatMap(r => r.inv));
            setEposAdminLoaded(true);
        } catch (err) {
            toast.error('Failed to load EPOS data: ' + err.message);
        } finally {
            setEposAdminLoading(false);
        }
    }, []); // stable — no date deps; client-side filtering handles all date narrowing

    // Load restaurant list once (EPOS data loads on-demand via Refresh button)
    useEffect(() => {
        fetchRestaurantDirectory().then(setRestaurants).catch(() => { });
    }, []);

    const loadMetrics = useCallback(async (f) => {
        setLoading(true);
        try {
            const data = await fetchDashboardMetrics(f);
            setMetrics(data);
        } catch (e) {
            toast.error('Failed to load dashboard metrics');
        } finally {
            setLoading(false);
        }
    }, []);

    const loadCharts = useCallback(async (f, tLimit = 5) => {
        setChartsLoading(true);
        try {
            const [inv, daily, itemsRes, rests, waste, trend, matrix] = await Promise.all([
                fetchInventoryByCategory(),
                fetchDailyOrderVolume(f),
                fetchTopOrderedItems(10, f),
                fetchTopRestaurants(5, f),
                fetchWasteByCategory(f),
                fetchItemDailyTrend(tLimit, f),
                fetchItemRestaurantMatrix(15, f),
            ]);
            setInvByCategory(inv);
            setDailyVolume(daily);
            setTopItems(itemsRes.items || itemsRes);
            setTopRestaurants(rests);
            setWasteByCat(waste);
            setItemTrend(trend);
            setItemMatrix(matrix);
        } catch (e) {
            console.error('Charts failed:', e);
        } finally {
            setChartsLoading(false);
        }
    }, []);

    // Initial load
    useEffect(() => {
        loadMetrics(filters);
        loadCharts(filters);
    }, []); // eslint-disable-line

    // Re-load when filters change
    const handleFilterChange = useCallback((newFilters) => {
        setFilters(newFilters);
        loadMetrics(newFilters);
        loadCharts(newFilters);
    }, [loadMetrics, loadCharts]);

    const handleRefresh = () => {
        clearCache();
        loadMetrics(filters);
        loadCharts(filters);
    };

    const quickActions = [
        { label: 'Low Stock Items', icon: MdWarning, path: '/inventory/low-stock', color: '#ef4444' },
        { label: 'Pending Orders', icon: MdShoppingCart, path: '/orders/today', color: '#f59e0b' },
        { label: 'Undelivered Orders', icon: MdLocalShipping, path: '/orders/undelivered', color: '#3b82f6' },
        { label: 'Start Production', icon: MdOutlineKitchen, path: '/production/start', color: '#8b5cf6' },
        { label: 'Create Purchase Order', icon: MdInventory2, path: '/purchase/create', color: '#22c55e' },
        { label: 'Log Waste', icon: MdDelete, path: '/waste', color: '#f97316' },
        // {
        //     label: 'Sync Categories', icon: MdRefresh, path: null, color: '#14b8a6', onClick: async () => {
        //         try {
        //             toast.loading('Syncing category names…', { id: 'cat-sync' });
        //             const result = await syncCategoryNamesOnItems();
        //             toast.success(`Done! ${result.updated} items updated, ${result.skipped} already correct${result.orphaned ? `, ${result.orphaned} orphaned` : ''}`, { id: 'cat-sync', duration: 5000 });
        //         } catch (e) {
        //             toast.error(`Sync failed: ${e.message}`, { id: 'cat-sync' });
        //         }
        //     }
        // },
        // { label: 'Seed Data', icon: MdUploadFile, path: null, color: '#6366f1', onClick: () => { setShowSeedModal(true); setSeedFile(null); setSeedLogs([]); setSeedConfirmed(false); setSeedDone(false); } },
    ];

    const isFiltered = filters.restaurantName || filters.preset !== '30d';

    return (
        <div className="dashboard-page">

            {/* Welcome */}
            <div className="dashboard-welcome">
                <div>
                    <h2 className="welcome-title">{greeting()}, {userProfile?.name?.split(' ')[0] || 'Admin'} 👋</h2>
                    <p className="welcome-subtitle">Central kitchen overview{filters.restaurantName ? ` • ${filters.restaurantName}` : ''}.</p>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div className="welcome-date">{new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</div>
                    <button className="btn-refresh" onClick={handleRefresh} title="Refresh data"><MdRefresh /></button>
                </div>
            </div>

            {/* ─── Filter Bar ─── */}
            <FilterBar filters={filters} onChange={handleFilterChange} restaurants={restaurants} />

            {/* ─── Revenue & Production Cards ─── */}
            {loading ? (
                <div className="stats-grid stats-grid-4" style={{ marginBottom: 'var(--space-5)' }}>
                    {Array.from({ length: 4 }).map((_, i) => (
                        <div key={i} className="dash-stat-card"><div className="skeleton" style={{ height: 80 }} /></div>
                    ))}
                </div>
            ) : (
                <div className="stats-grid stats-grid-4" style={{ marginBottom: 'var(--space-5)' }}>
                    <StatCard
                        label="Total Revenue"
                        value={formatCurrency(metrics.totalRevenue)}
                        sub={`${metrics.invoiceCount} invoice${metrics.invoiceCount !== 1 ? 's' : ''} in period`}
                        icon={MdAttachMoney}
                        color="primary"
                        onClick={() => navigate('/invoices')}
                    />
                    <StatCard
                        label="Paid Revenue"
                        value={formatCurrency(metrics.paidRevenue)}
                        sub={metrics.totalRevenue > 0 ? `${Math.round((metrics.paidRevenue / metrics.totalRevenue) * 100)}% collected` : 'No invoices'}
                        icon={MdCheckCircle}
                        color="success"
                        onClick={() => navigate('/invoices')}
                    />
                    <StatCard
                        label="Pending Revenue"
                        value={formatCurrency(metrics.pendingRevenue)}
                        sub={metrics.totalRevenue > 0 ? `${Math.round((metrics.pendingRevenue / metrics.totalRevenue) * 100)}% outstanding` : 'No invoices'}
                        icon={MdPending}
                        color="warning"
                        onClick={() => navigate('/invoices')}
                    />
                    <StatCard
                        label="Production Cost"
                        value={formatCurrency(metrics.productionCost)}
                        sub={`${metrics.productionCount} batch${metrics.productionCount !== 1 ? 'es' : ''} completed`}
                        icon={MdOutlineKitchen}
                        color="info"
                        onClick={() => navigate('/production/start')}
                    />
                </div>
            )}

            {/* ─── Stat Cards ─── */}
            {loading ? (
                <div className="stats-grid stats-grid-6">
                    {Array.from({ length: 6 }).map((_, i) => (
                        <div key={i} className="dash-stat-card"><div className="skeleton" style={{ height: 80 }} /></div>
                    ))}
                </div>
            ) : (
                <div className="stats-grid stats-grid-6">
                    <StatCard label="Inventory Value" value={formatCurrency(metrics.inventoryValue)} sub="Central kitchen" icon={MdInventory2} color="primary" onClick={() => navigate('/inventory/stock')} />
                    <StatCard label="Low Stock Items" value={metrics.lowStockCount} sub="Need attention" icon={MdWarning} color="danger" onClick={() => navigate('/inventory/low-stock')} />
                    <StatCard label={isFiltered ? 'Orders (period)' : 'Orders Today'}
                        value={isFiltered ? metrics.ordersInRange : metrics.ordersToday}
                        sub={isFiltered ? formatCurrency(metrics.orderValueInRange) : formatCurrency(metrics.orderValueToday)}
                        icon={MdShoppingCart} color="info" onClick={() => navigate('/orders/today')} />
                    <StatCard label="Orders This Week" value={metrics.ordersWeek} sub={formatCurrency(metrics.orderValueWeek)} icon={MdTrendingUp} color="primary" />
                    <StatCard label="Pending Deliveries" value={metrics.pendingDeliveries} sub="Awaiting delivery" icon={MdLocalShipping} color="warning" onClick={() => navigate('/orders/undelivered')} />
                    <StatCard label={isFiltered ? 'Waste (period)' : 'Waste This Week'}
                        value={formatCurrency(isFiltered ? metrics.wasteInRange : metrics.wasteWeek)}
                        sub={!isFiltered ? `Today: ${formatCurrency(metrics.wasteToday)}` : undefined}
                        icon={MdDelete} color="danger" onClick={() => navigate('/waste')} />
                </div>
            )}

            {/* ─── Quick Actions ─── */}
            <div className="quick-actions">
                <h3 className="section-title">Quick Actions</h3>
                <div className="actions-grid-6">
                    {quickActions.map(a => (
                        <button key={a.label} className="action-card" onClick={a.onClick ? a.onClick : () => navigate(a.path)}>
                            <div className="action-icon-wrap" style={{ background: `${a.color}20`, color: a.color }}><a.icon /></div>
                            <span className="action-label">{a.label}</span>
                            <MdArrowForward className="action-arrow" />
                        </button>
                    ))}
                </div>
            </div>

            {/* ─── Charts Row 1: Line + Pie (inventory) ─── */}
            <div className="dash-chart-row">
                <div className="card dash-chart-card wide">
                    <div className="card-header">
                        <h3>Order Volume</h3>
                        <span className="badge badge-muted">
                            {filters.preset === 'custom' ? 'Custom range' : DATE_PRESETS.find(p => p.id === filters.preset)?.label}
                            {filters.restaurantName ? ` • ${filters.restaurantName}` : ''}
                        </span>
                    </div>
                    <div className="dash-chart-body">
                        {chartsLoading ? <div className="chart-loading">Loading chart…</div> : dailyVolume.length === 0 ? <div className="chart-empty">No orders in this period</div> : (
                            <ResponsiveContainer width="100%" height={320}>
                                <LineChart data={dailyVolume} margin={{ top: 4, right: 20, left: 0, bottom: 0 }}>
                                    <CartesianGrid strokeDasharray="3 3" stroke={GRID_COLOR} />
                                    <XAxis dataKey="date" tick={{ fill: TEXT_COLOR, fontSize: 10 }} interval={Math.max(0, Math.floor(dailyVolume.length / 10))} />
                                    <YAxis tick={{ fill: TEXT_COLOR, fontSize: 10 }} tickFormatter={shortNum} width={35} />
                                    <Tooltip contentStyle={tooltipStyle} formatter={(v, n) => [n === 'value' ? formatCurrency(v) : v, n === 'value' ? 'Value' : 'Orders']} />
                                    <Line type="monotone" dataKey="orders" stroke="#c9a96e" strokeWidth={2} dot={false} name="Orders" />
                                    <Line type="monotone" dataKey="value" stroke="#3b82f6" strokeWidth={2} dot={false} name="Value" />
                                </LineChart>
                            </ResponsiveContainer>
                        )}
                    </div>
                </div>

                <div className="card dash-chart-card">
                    <div className="card-header"><h3>Inventory by Category</h3><span className="badge badge-muted">Value</span></div>
                    <div className="dash-chart-body">
                        {chartsLoading ? <div className="chart-loading">Loading chart…</div> :
                            invByCategory.length === 0 ? <div className="chart-empty">No data</div> : (
                                <ResponsiveContainer width="100%" height={320}>
                                    <PieChart>
                                        <Pie data={invByCategory} dataKey="value" nameKey="name" cx="50%" cy="45%"
                                            outerRadius={100} innerRadius={40}
                                            labelLine={{ stroke: 'rgba(255,255,255,0.2)', strokeWidth: 1 }}
                                            label={({ cx, cy, midAngle, outerRadius: or, percent, name }) => {
                                                if (percent < 0.03) return null;
                                                const R = Math.PI / 180;
                                                const r = or + 16;
                                                const x = cx + r * Math.cos(-midAngle * R);
                                                const y = cy + r * Math.sin(-midAngle * R);
                                                return (
                                                    <text x={x} y={y} fill="#ccc" textAnchor={x > cx ? 'start' : 'end'}
                                                        dominantBaseline="central" fontSize={10} fontWeight={600}>
                                                        {`${(percent * 100).toFixed(0)}%`}
                                                    </text>
                                                );
                                            }}>
                                            {invByCategory.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
                                        </Pie>
                                        <Tooltip contentStyle={tooltipStyle} formatter={v => [formatCurrency(v), 'Value']} />
                                        <Legend iconSize={8} wrapperStyle={{ fontSize: 10, color: TEXT_COLOR, paddingTop: 8 }}
                                            formatter={(val) => val.length > 20 ? val.slice(0, 18) + '…' : val} />
                                    </PieChart>
                                </ResponsiveContainer>
                            )}
                    </div>
                </div>
            </div>

            {/* ─── Charts Row 2: Top Items + Top Restaurants + Waste ─── */}
            <div className="dash-chart-row">
                <div className="card dash-chart-card wide">
                    <div className="card-header">
                        <h3>Top 10 Ordered Items</h3>
                        <span className="badge badge-muted">
                            {DATE_PRESETS.find(p => p.id === filters.preset)?.label || 'Custom'}
                            {filters.restaurantName ? ` • ${filters.restaurantName}` : ''}
                        </span>
                    </div>
                    <div className="dash-chart-body">
                        {chartsLoading ? <div className="chart-loading">Loading chart…</div> :
                            topItems.length === 0 ? <div className="chart-empty">No orders in this period</div> : (
                                <ResponsiveContainer width="100%" height={280}>
                                    <BarChart data={topItems} layout="vertical" margin={{ top: 0, right: 30, left: 0, bottom: 0 }}>
                                        <CartesianGrid strokeDasharray="3 3" stroke={GRID_COLOR} horizontal={false} />
                                        <XAxis type="number" tick={{ fill: TEXT_COLOR, fontSize: 10 }} tickFormatter={shortNum} />
                                        <YAxis type="category" dataKey="name" tick={{ fill: TEXT_COLOR, fontSize: 10 }} width={110} />
                                        <Tooltip contentStyle={tooltipStyle} formatter={v => [`${v} units`, 'Quantity']} />
                                        <Bar dataKey="quantity" fill="#c9a96e" radius={[0, 4, 4, 0]} />
                                    </BarChart>
                                </ResponsiveContainer>
                            )}
                    </div>
                </div>

                <div className="card dash-chart-card">
                    <div className="card-header"><h3>Top Restaurants</h3><span className="badge badge-muted">By value</span></div>
                    <div className="dash-chart-body">
                        {chartsLoading ? <div className="chart-loading">Loading chart…</div> :
                            topRestaurants.length === 0 ? <div className="chart-empty">No data</div> : (
                                <ResponsiveContainer width="100%" height={220}>
                                    <BarChart data={topRestaurants} margin={{ top: 4, right: 10, left: 0, bottom: 40 }}>
                                        <CartesianGrid strokeDasharray="3 3" stroke={GRID_COLOR} />
                                        <XAxis dataKey="name" tick={{ fill: TEXT_COLOR, fontSize: 10 }} angle={-20} textAnchor="end" interval={0} />
                                        <YAxis tick={{ fill: TEXT_COLOR, fontSize: 10 }} tickFormatter={shortVal} width={50} />
                                        <Tooltip contentStyle={tooltipStyle} formatter={v => [formatCurrency(v), 'Order Value']} />
                                        <Bar dataKey="value" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                                    </BarChart>
                                </ResponsiveContainer>
                            )}
                    </div>
                </div>

                <div className="card dash-chart-card">
                    <div className="card-header"><h3>Waste by Category</h3><span className="badge badge-muted">Value</span></div>
                    <div className="dash-chart-body">
                        {chartsLoading ? <div className="chart-loading">Loading chart…</div> :
                            wasteByCat.length === 0 ? <div className="chart-empty">No waste recorded</div> : (
                                <ResponsiveContainer width="100%" height={220}>
                                    <PieChart>
                                        <Pie data={wasteByCat} dataKey="value" nameKey="name" cx="50%" cy="50%"
                                            outerRadius={75} labelLine={false} label={renderPieLabel}>
                                            {wasteByCat.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
                                        </Pie>
                                        <Tooltip contentStyle={tooltipStyle} formatter={v => [formatCurrency(v), 'Waste Value']} />
                                        <Legend iconSize={10} wrapperStyle={{ fontSize: 11, color: TEXT_COLOR }} />
                                    </PieChart>
                                </ResponsiveContainer>
                            )}
                    </div>
                </div>
            </div>

            {/* ─── Item Demand Analysis ─── */}
            <div className="card" style={{ overflow: 'visible' }}>
                <div className="card-header">
                    <h3>Item Demand Analysis</h3>
                    <div className="demand-tabs">
                        <button className={`demand-tab ${demandTab === 'trend' ? 'active' : ''}`}
                            onClick={() => setDemandTab('trend')}>📈 Daily Trend</button>
                        <button className={`demand-tab ${demandTab === 'restaurant' ? 'active' : ''}`}
                            onClick={() => setDemandTab('restaurant')}>🏪 By Restaurant</button>
                    </div>
                </div>

                {chartsLoading ? (
                    <div className="dash-chart-body"><div className="chart-loading">Loading analysis…</div></div>
                ) : demandTab === 'trend' ? (
                    /* ── Daily Trend Line Chart ── */
                    <div className="dash-chart-body">
                        {itemTrend.data.length === 0 || itemTrend.itemNames.length === 0 ? (
                            <div className="chart-empty">No order data in this period</div>
                        ) : (
                            <>
                                <ResponsiveContainer width="100%" height={320}>
                                    <LineChart data={itemTrend.data} margin={{ top: 8, right: 20, left: 0, bottom: 0 }}>
                                        <CartesianGrid strokeDasharray="3 3" stroke={GRID_COLOR} />
                                        <XAxis dataKey="date" tick={{ fill: TEXT_COLOR, fontSize: 10 }}
                                            interval={Math.max(0, Math.floor(itemTrend.data.length / 12))} />
                                        <YAxis tick={{ fill: TEXT_COLOR, fontSize: 10 }} width={35} />
                                        <Tooltip contentStyle={tooltipStyle}
                                            formatter={(v, name) => [`${v} units`, name]} />
                                        <Legend iconSize={10} wrapperStyle={{ fontSize: 11, color: TEXT_COLOR }} />
                                        {itemTrend.itemNames.map((name, i) => (
                                            <Line key={name} type="monotone" dataKey={name}
                                                stroke={TREND_COLORS[i % TREND_COLORS.length]}
                                                strokeWidth={2} dot={false} name={name} />
                                        ))}
                                    </LineChart>
                                </ResponsiveContainer>
                                <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 8, paddingBottom: 4 }}>
                                    <button className="btn btn-ghost btn-sm" onClick={() => {
                                        const newExpanded = !trendExpanded;
                                        setTrendExpanded(newExpanded);
                                        fetchItemDailyTrend(newExpanded ? 15 : 5, filters).then(setItemTrend);
                                    }}>
                                        {trendExpanded ? '▲ Show Top 5 Only' : '▼ Show All Items'}
                                    </button>
                                </div>
                            </>
                        )}
                    </div>
                ) : (
                    /* ── Item × Restaurant Heatmap Table ── */
                    <div style={{ padding: 'var(--space-4)', overflowX: 'auto' }}>
                        {itemMatrix.items.length === 0 ? (
                            <div className="chart-empty">No order data in this period</div>
                        ) : (
                            <table className="heatmap-table">
                                <thead>
                                    <tr>
                                        <th className="heatmap-item-col">Item</th>
                                        {itemMatrix.restaurantNames.map(rn => (
                                            <th key={rn}
                                                className={`heatmap-rest-col ${rn === itemMatrix.highlightRestaurant ? 'highlighted' : ''}`}>
                                                {rn}
                                            </th>
                                        ))}
                                        <th className="heatmap-total-col">Total</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {itemMatrix.items.map(item => (
                                        <tr key={item.name}>
                                            <td className="heatmap-item-name">{item.name}</td>
                                            {itemMatrix.restaurantNames.map(rn => {
                                                const qty = item.restaurants[rn] || 0;
                                                const intensity = itemMatrix.maxQty > 0 ? qty / itemMatrix.maxQty : 0;
                                                const isHighlighted = rn === itemMatrix.highlightRestaurant;
                                                return (
                                                    <td key={rn}
                                                        className={`heatmap-cell ${isHighlighted ? 'highlighted' : ''}`}
                                                        style={{
                                                            backgroundColor: qty > 0
                                                                ? `rgba(201, 169, 110, ${0.1 + intensity * 0.6})`
                                                                : 'transparent',
                                                        }}>
                                                        {qty > 0 ? qty : '—'}
                                                    </td>
                                                );
                                            })}
                                            <td className="heatmap-total">{item.total}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        )}
                    </div>
                )}
            </div>

            {/* ─── Bottom: Recent Orders + Expiry ─── */}
            <div className="dashboard-grid-2">
                <div className="card">
                    <div className="card-header">
                        <h3>Recent Orders</h3>
                        <button className="btn btn-ghost btn-sm" onClick={() => navigate('/orders/today')}>View All <MdArrowForward /></button>
                    </div>
                    {loading ? (
                        <div style={{ padding: 20 }}><div className="skeleton" style={{ height: 120 }} /></div>
                    ) : !metrics?.recentOrders?.length ? (
                        <div className="empty-state" style={{ padding: 40 }}>
                            <div className="empty-state-icon">📦</div>
                            <div className="empty-state-title">No orders in this period</div>
                        </div>
                    ) : (
                        <div className="data-table-wrapper" style={{ border: 'none', borderRadius: 0 }}>
                            <table className="data-table">
                                <thead><tr><th>Order</th><th>Restaurant</th><th>Items</th><th>Value</th><th>Status</th></tr></thead>
                                <tbody>
                                    {metrics.recentOrders.map(o => {
                                        const si = getStatusInfo(o.status);
                                        return (
                                            <tr key={o.id}>
                                                <td style={{ fontWeight: 700, color: 'var(--color-primary)', fontSize: 12 }}>{o.order_number}</td>
                                                <td style={{ fontSize: 12 }}>{o.restaurant_name}</td>
                                                <td>{o.item_count}</td>
                                                <td style={{ fontWeight: 700 }}>{formatCurrency(o.total)}</td>
                                                <td><span className="badge" style={{ background: `${si.color}22`, color: si.color, fontSize: 11 }}>{si.icon} {si.label}</span></td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>

                <div className="card">
                    <div className="card-header">
                        <h3>Near Expiry (48h)</h3>
                        <button className="btn btn-ghost btn-sm" onClick={() => navigate('/inventory/batches')}>View Batches <MdArrowForward /></button>
                    </div>
                    {loading ? (
                        <div style={{ padding: 20 }}><div className="skeleton" style={{ height: 120 }} /></div>
                    ) : !metrics?.nearExpiryBatches?.length ? (
                        <div className="empty-state" style={{ padding: 40 }}>
                            <div className="empty-state-icon">✅</div>
                            <div className="empty-state-title">No batches expiring soon</div>
                        </div>
                    ) : (
                        <div className="expiry-list">
                            {metrics.nearExpiryBatches.map(b => {
                                const hoursLeft = Math.round((b.expiry_date - new Date()) / 3600000);
                                const isUrgent = hoursLeft < 6;
                                return (
                                    <div key={b.id} className="expiry-item">
                                        <div className="expiry-info">
                                            <span className="expiry-item-name">{b.item_name}</span>
                                            <span className="expiry-batch">{b.batch_number} • {b.current_quantity} {b.unit}</span>
                                        </div>
                                        <span className={`badge ${isUrgent ? 'badge-danger' : 'badge-warning'}`}>
                                            <MdTimer style={{ fontSize: 11 }} /> {hoursLeft < 1 ? '<1h' : `${hoursLeft}h`}
                                        </span>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            </div>

            {/* ═══ EPOS Restaurant Analytics ═══ */}
            <div style={{ marginBottom: 'var(--space-6)' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, flexWrap: 'wrap', gap: 10 }}>
                    <div>
                        <h3 className="section-title" style={{ marginBottom: 2 }}>📈 EPOS Restaurant Analytics</h3>
                        <p style={{ fontSize: 12, color: 'var(--color-text-muted)', margin: 0 }}>
                            Menu sales, inventory consumption &amp; markup — all restaurants
                            {eposAllEvents.length > 0 && ` • ${eposAllEvents.length} EPOS events loaded`}
                        </p>
                    </div>
                    <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                        {/* Restaurant filter — client-side only, no re-fetch */}
                        <select
                            value={eposRestaurantFilter}
                            onChange={e => setEposRestaurantFilter(e.target.value)}
                            style={{ padding: '8px 14px', borderRadius: 8, fontSize: 13, minWidth: 220, background: 'var(--color-surface, rgba(255,255,255,0.06))', border: '1px solid var(--color-border, rgba(255,255,255,0.12))', color: 'var(--color-text)', outline: 'none' }}
                        >
                            <option value="">All Restaurants</option>
                            {restaurants.map(r => <option key={r.id} value={r.id}>{r.restaurant_name}</option>)}
                        </select>
                        <button
                            onClick={() => loadEposAllData(restaurants)}
                            disabled={eposAdminLoading}
                            style={{ padding: '8px 14px', borderRadius: 8, fontSize: 13, cursor: 'pointer', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)', color: 'var(--color-text)' }}
                            title="Refresh EPOS data"
                        >
                            {eposAdminLoading ? '⏳' : '🔄'} Refresh
                        </button>
                    </div>
                </div>

                {eposAdminLoading ? (
                    <div className="card" style={{ padding: 'var(--space-8)', textAlign: 'center', color: 'var(--color-text-muted)' }}>
                        <div style={{ fontSize: 13 }}>Loading EPOS data for all restaurants…</div>
                    </div>
                ) : !eposAdminLoaded ? (
                    <div className="card" style={{ padding: 'var(--space-8)', textAlign: 'center', color: 'var(--color-text-muted)' }}>
                        <div style={{ fontSize: 36, marginBottom: 10 }}>📊</div>
                        <div style={{ fontWeight: 600, marginBottom: 8 }}>Click to load EPOS analytics</div>
                        <div style={{ fontSize: 13, marginBottom: 16 }}>Fetches menu sales &amp; inventory data across all restaurants</div>
                        <button
                            onClick={() => loadEposAllData(restaurants)}
                            disabled={!restaurants.length}
                            style={{ padding: '10px 24px', borderRadius: 8, fontSize: 14, cursor: 'pointer', fontWeight: 600, background: 'var(--color-accent, #c9a96e)', color: '#fff', border: 'none' }}
                        >
                            📈 Load EPOS Data
                        </button>
                    </div>
                ) : eposAllEvents.filter(e =>
                    (e.processing_status === 'processed' || e.processing_status === 'has_unmapped') &&
                    (!eposRestaurantFilter || e._restaurant_id === eposRestaurantFilter)
                ).length === 0 ? (
                    <div className="card" style={{ padding: 'var(--space-8)', textAlign: 'center', color: 'var(--color-text-muted)' }}>
                        <div style={{ fontSize: 36, marginBottom: 10 }}>📭</div>
                        <div style={{ fontWeight: 600, marginBottom: 4 }}>No EPOS data{eposRestaurantFilter ? ' for this restaurant' : ''}</div>
                        <div style={{ fontSize: 13 }}>Data appears once EPOS webhook events are processed</div>
                    </div>
                ) : (() => {
                    // Parse EPOS event date safely (prefer order_date — the business date of the sale)
                    // Uses Intl to avoid the toLocaleString locale-parsing bug in non-en-GB systems.
                    const parseEposDate = (e) => {
                        const raw = e.order_date || e.received_at;
                        if (!raw) return null;
                        if (raw instanceof Date) return isNaN(raw.getTime()) ? null : raw;
                        // Firestore Timestamp
                        if (raw && typeof raw.toDate === 'function') return raw.toDate();
                        if (raw && raw.seconds) return new Date(raw.seconds * 1000);
                        if (typeof raw === 'string') {
                            // Date-only string: treat as midnight London time
                            if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
                                const [y, m, d] = raw.split('-').map(Number);
                                // Build a UTC midnight, then adjust for London offset using Intl
                                const utcGuess = Date.UTC(y, m - 1, d, 0, 0, 0);
                                const guessDate = new Date(utcGuess);
                                const fmt = new Intl.DateTimeFormat('en-US', {
                                    timeZone: 'Europe/London',
                                    year: 'numeric', month: '2-digit', day: '2-digit',
                                    hour: '2-digit', minute: '2-digit', second: '2-digit',
                                    hour12: false
                                });
                                const parts = fmt.formatToParts(guessDate);
                                const gp = (type) => parseInt(parts.find(p => p.type === type)?.value || '0', 10);
                                const londonUtc = Date.UTC(gp('year'), gp('month') - 1, gp('day'), gp('hour'), gp('minute'), gp('second'));
                                const offset = londonUtc - utcGuess;
                                return new Date(utcGuess - offset);
                            }
                            // ISO or other string
                            const parsed = new Date(raw);
                            return isNaN(parsed.getTime()) ? null : parsed;
                        }
                        return null;
                    };

                    // Client-side filter by restaurant + current dashboard date range
                    // This always uses the live `filters` from the render closure — no stale state.
                    const filteredEvts = eposAllEvents.filter(e => {
                        if (e.processing_status !== 'processed' && e.processing_status !== 'has_unmapped') return false;
                        if (eposRestaurantFilter && e._restaurant_id !== eposRestaurantFilter) return false;
                        const d = parseEposDate(e);
                        if (!d) return false;
                        if (filters.dateFrom && d < filters.dateFrom) return false;
                        if (filters.dateTo && d > filters.dateTo) return false;
                        return true;
                    });
                    // Filter menu items and inventory by restaurant if needed
                    const filteredMenu = eposRestaurantFilter
                        ? eposAllMenuItems.filter(m => m.restaurant_id === eposRestaurantFilter)
                        : eposAllMenuItems;
                    const filteredInv = eposRestaurantFilter
                        ? eposAllInventory.filter(i => i.restaurant_id === eposRestaurantFilter)
                        : eposAllInventory;
                    return (
                        <EposSalesTable
                            eposEvents={filteredEvts}
                            menuItems={filteredMenu}
                            inventoryItems={filteredInv}
                        />
                    );
                })()}
            </div>

            {/* ═══ Seed Data Modal ═══ */}
            {showSeedModal && (
                <div className="modal-overlay" onClick={() => !seedRunning && setShowSeedModal(false)}>
                    <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 640, maxHeight: '90vh', overflow: 'auto', borderRadius: 16 }}>
                        <div className="modal-header" style={{ borderBottom: '1px solid var(--color-border)', padding: '20px 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <h2 style={{ margin: 0, fontSize: '1.1rem', display: 'flex', alignItems: 'center', gap: 8 }}>
                                <MdUploadFile style={{ color: '#6366f1' }} /> Seed Data from Excel
                            </h2>
                            {!seedRunning && (
                                <button className="btn-refresh" onClick={() => setShowSeedModal(false)} style={{ width: 36, height: 36 }}>
                                    <MdClose size={20} />
                                </button>
                            )}
                        </div>
                        <div style={{ padding: '24px' }}>
                            {!seedDone ? (
                                <>
                                    <div style={{
                                        background: 'rgba(239,68,68,0.08)',
                                        border: '1px solid rgba(239,68,68,0.3)',
                                        borderRadius: 10,
                                        padding: '14px 18px',
                                        marginBottom: 20,
                                        fontSize: 13,
                                    }}>
                                        <strong style={{ color: '#ef4444' }}>⚠️ Warning:</strong> This will <strong>permanently delete</strong> all
                                        orders, invoices, inventory, waste, productions, and notifications. Only user accounts are preserved.
                                    </div>

                                    <div style={{ marginBottom: 20 }}>
                                        <label style={{ fontWeight: 600, fontSize: 13, display: 'block', marginBottom: 8, color: 'var(--color-text-secondary)' }}>Upload Excel File (.xlsx)</label>
                                        <div
                                            onClick={() => seedFileRef.current?.click()}
                                            style={{
                                                border: `2px dashed ${seedFile ? '#22c55e' : 'var(--color-border)'}`,
                                                borderRadius: 10,
                                                padding: '24px 16px',
                                                textAlign: 'center',
                                                cursor: seedRunning ? 'not-allowed' : 'pointer',
                                                color: seedFile ? '#22c55e' : 'var(--color-text-muted)',
                                                transition: 'all 0.2s',
                                            }}
                                        >
                                            {seedFile ? (
                                                <div>
                                                    <div style={{ fontSize: 28, marginBottom: 4 }}>✅</div>
                                                    <div style={{ fontWeight: 600, fontSize: 14 }}>{seedFile.name}</div>
                                                    <div style={{ fontSize: 12, marginTop: 4 }}>({(seedFile.size / 1024).toFixed(1)} KB)</div>
                                                </div>
                                            ) : (
                                                <div>
                                                    <MdUploadFile style={{ fontSize: 32, opacity: 0.5, marginBottom: 4 }} />
                                                    <div style={{ fontWeight: 500 }}>Click to select .xlsx file</div>
                                                </div>
                                            )}
                                        </div>
                                        <input
                                            ref={seedFileRef}
                                            type="file"
                                            accept=".xlsx,.xls"
                                            style={{ display: 'none' }}
                                            disabled={seedRunning}
                                            onChange={(e) => {
                                                const f = e.target.files?.[0];
                                                if (f) setSeedFile(f);
                                            }}
                                        />
                                    </div>

                                    {seedFile && !seedRunning && (
                                        <label style={{
                                            display: 'flex',
                                            alignItems: 'flex-start',
                                            gap: 10,
                                            padding: '12px 14px',
                                            background: 'var(--color-surface-hover)',
                                            borderRadius: 8,
                                            marginBottom: 20,
                                            cursor: 'pointer',
                                            fontSize: 13,
                                        }}>
                                            <input
                                                type="checkbox"
                                                checked={seedConfirmed}
                                                onChange={e => setSeedConfirmed(e.target.checked)}
                                                style={{ marginTop: 2, accentColor: '#ef4444' }}
                                            />
                                            <span>I understand this will <strong style={{ color: '#ef4444' }}>delete all existing data</strong> and replace it with data from the uploaded Excel file.</span>
                                        </label>
                                    )}

                                    {seedLogs.length > 0 && (
                                        <div
                                            ref={seedLogRef}
                                            style={{
                                                background: '#0d1117',
                                                borderRadius: 8,
                                                padding: '12px 16px',
                                                maxHeight: 300,
                                                overflowY: 'auto',
                                                fontFamily: 'monospace',
                                                fontSize: 12,
                                                lineHeight: 1.6,
                                                marginBottom: 16,
                                                color: '#c9d1d9',
                                            }}
                                        >
                                            {seedLogs.map((line, i) => (
                                                <div key={i} style={{
                                                    color: line.includes('✓') ? '#22c55e' : line.includes('⚠') ? '#f59e0b' : line.includes('═══') ? '#c9a96e' : '#c9d1d9',
                                                }}>{line}</div>
                                            ))}
                                        </div>
                                    )}

                                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
                                        <button
                                            className="btn btn-secondary btn-md"
                                            onClick={() => setShowSeedModal(false)}
                                            disabled={seedRunning}
                                        >
                                            Cancel
                                        </button>
                                        <button
                                            className="btn btn-md"
                                            disabled={!seedFile || !seedConfirmed || seedRunning}
                                            onClick={async () => {
                                                setSeedRunning(true);
                                                setSeedLogs([]);
                                                try {
                                                    const result = await runFullSeed(seedFile, (msg) => {
                                                        setSeedLogs(prev => {
                                                            const next = [...prev, msg];
                                                            // Auto-scroll log
                                                            setTimeout(() => {
                                                                if (seedLogRef.current) {
                                                                    seedLogRef.current.scrollTop = seedLogRef.current.scrollHeight;
                                                                }
                                                            }, 50);
                                                            return next;
                                                        });
                                                    });
                                                    setSeedDone(true);
                                                    toast.success(`Seed complete! ${result.rawMeatCount + result.cookedFoodCount + result.groceryCount} items created.`);
                                                } catch (err) {
                                                    console.error('Seed failed:', err);
                                                    setSeedLogs(prev => [...prev, `❌ FATAL ERROR: ${err.message}`]);
                                                    toast.error('Seed failed: ' + err.message);
                                                } finally {
                                                    setSeedRunning(false);
                                                }
                                            }}
                                            style={{
                                                background: seedRunning ? '#6366f1' : '#ef4444',
                                                color: '#fff',
                                                border: 'none',
                                                display: 'flex',
                                                alignItems: 'center',
                                                gap: 6,
                                                fontWeight: 600,
                                            }}
                                        >
                                            {seedRunning ? (
                                                <><MdUploadFile className="spin" /> Seeding...</>
                                            ) : (
                                                <><MdUploadFile /> Clear & Seed Data</>
                                            )}
                                        </button>
                                    </div>
                                </>
                            ) : (
                                <div style={{ textAlign: 'center', padding: '20px 0' }}>
                                    <div style={{ fontSize: 48, marginBottom: 12 }}>✅</div>
                                    <h3 style={{ marginBottom: 8 }}>Seed Complete!</h3>
                                    <p style={{ color: 'var(--color-text-secondary)', fontSize: 14, marginBottom: 24 }}>
                                        All items have been created. You can now review them in the Inventory section.
                                    </p>

                                    {seedLogs.length > 0 && (
                                        <div
                                            style={{
                                                background: '#0d1117',
                                                borderRadius: 8,
                                                padding: '12px 16px',
                                                maxHeight: 200,
                                                overflowY: 'auto',
                                                fontFamily: 'monospace',
                                                fontSize: 11,
                                                lineHeight: 1.6,
                                                marginBottom: 20,
                                                textAlign: 'left',
                                                color: '#c9d1d9',
                                            }}
                                        >
                                            {seedLogs.map((line, i) => (
                                                <div key={i} style={{
                                                    color: line.includes('✓') ? '#22c55e' : line.includes('⚠') ? '#f59e0b' : line.includes('═══') ? '#c9a96e' : '#c9d1d9',
                                                }}>{line}</div>
                                            ))}
                                        </div>
                                    )}

                                    <div style={{ display: 'flex', justifyContent: 'center', gap: 10 }}>
                                        <button className="btn btn-secondary btn-md" onClick={() => setShowSeedModal(false)}>Close</button>
                                        <button className="btn btn-primary btn-md" onClick={() => { setShowSeedModal(false); navigate('/inventory/stock'); }}>Go to Inventory</button>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default AdminDashboard;
