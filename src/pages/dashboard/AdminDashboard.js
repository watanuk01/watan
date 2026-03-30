import React, { useState, useEffect, useCallback } from 'react';
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
    MdStore, MdClear,
} from 'react-icons/md';
import { useAuth } from '../../contexts/AuthContext';
import {
    fetchDashboardMetrics,
    fetchInventoryByCategory,
    fetchDailyOrderVolume,
    fetchTopOrderedItems,
    fetchTopRestaurants,
    fetchWasteByCategory,
    fetchRestaurantDirectory,
    DATE_PRESETS,
    getPresetDates,
    clearCache,
    formatCurrency,
    endOfDay,
    startOfDay,
} from '../../services/analyticsService';
import { getStatusInfo } from '../../services/orderService';
import toast from 'react-hot-toast';
import './Dashboard.css';

const CHART_COLORS = ['#c9a96e', '#3b82f6', '#22c55e', '#f59e0b', '#8b5cf6', '#ef4444', '#14b8a6', '#f97316'];
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
        const df = startOfDay(new Date(customFrom));
        const dt = endOfDay(new Date(customTo));
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
                        ? `${filters.dateFrom?.toLocaleDateString('en-GB')} → ${filters.dateTo?.toLocaleDateString('en-GB')}`
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
    const [loading, setLoading] = useState(true);
    const [chartsLoading, setChartsLoading] = useState(true);

    // Load restaurant list once
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

    const loadCharts = useCallback(async (f) => {
        setChartsLoading(true);
        try {
            const [inv, daily, items, rests, waste] = await Promise.all([
                fetchInventoryByCategory(),
                fetchDailyOrderVolume(f),
                fetchTopOrderedItems(10, f),
                fetchTopRestaurants(5, f),
                fetchWasteByCategory(f),
            ]);
            setInvByCategory(inv);
            setDailyVolume(daily);
            setTopItems(items);
            setTopRestaurants(rests);
            setWasteByCat(waste);
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
                        <button key={a.label} className="action-card" onClick={() => navigate(a.path)}>
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
                            <ResponsiveContainer width="100%" height={220}>
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
                                <ResponsiveContainer width="100%" height={220}>
                                    <PieChart>
                                        <Pie data={invByCategory} dataKey="value" nameKey="name" cx="50%" cy="50%"
                                            outerRadius={80} labelLine={false} label={renderPieLabel}>
                                            {invByCategory.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
                                        </Pie>
                                        <Tooltip contentStyle={tooltipStyle} formatter={v => [formatCurrency(v), 'Value']} />
                                        <Legend iconSize={10} wrapperStyle={{ fontSize: 11, color: TEXT_COLOR }} />
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
        </div>
    );
};

export default AdminDashboard;
