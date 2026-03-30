import React, { useState, useEffect, useCallback } from 'react';
import {
    BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
    ResponsiveContainer, Cell, PieChart, Pie, Legend,
    LineChart, Line,
} from 'recharts';
import {
    MdBarChart, MdStore, MdShoppingCart, MdDelete,
    MdInventory2, MdRefresh, MdWarning,
} from 'react-icons/md';
import {
    fetchRestaurantComparison,
    fetchVendorAnalysis,
    fetchBatchAnalytics,
    fetchTopOrderedItems,
    formatCurrency,
} from '../../services/analyticsService';
import toast from 'react-hot-toast';
import '../dashboard/Dashboard.css';

const CHART_COLORS = ['#c9a96e', '#3b82f6', '#22c55e', '#f59e0b', '#8b5cf6', '#ef4444', '#14b8a6', '#f97316'];
const GRID_COLOR = 'rgba(255,255,255,0.08)';
const TEXT_COLOR = '#9ca3af';
const tooltipStyle = { background: '#1e1e2e', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 8, color: '#f1f5f9', fontSize: 12 };

const TABS = [
    { id: 'restaurants', label: 'Restaurant Comparison', icon: MdStore },
    { id: 'items', label: 'Item Analytics', icon: MdShoppingCart },
    { id: 'vendors', label: 'Vendor Performance', icon: MdInventory2 },
    { id: 'batches', label: 'Batch Analytics', icon: MdBarChart },
];

const KpiCard = ({ label, value, sub, color }) => (
    <div className="kpi-card">
        <div className="kpi-value" style={color ? { color } : {}}>{value}</div>
        <div className="kpi-label">{label}</div>
        {sub && <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 4 }}>{sub}</div>}
    </div>
);

// ─── custom label for pie ───
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

const shortVal = v => v >= 1000 ? `£${(v / 1000).toFixed(1)}k` : `£${v}`;

// ═══════════════════════════════════════════════════════
// RESTAURANT COMPARISON
// ═══════════════════════════════════════════════════════
const RestaurantComparison = ({ data }) => {
    if (!data?.length) return <div className="chart-empty" style={{ height: 200 }}>No order data available</div>;

    const totalOrders = data.reduce((s, r) => s + r.orders, 0);
    const totalValue = data.reduce((s, r) => s + r.orderValue, 0);
    const totalWaste = data.reduce((s, r) => s + r.wasteValue, 0);
    const maxAvg = Math.max(...data.map(r => r.avgOrderValue));

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
            {/* KPIs */}
            <div className="kpi-row">
                <KpiCard label="Total Restaurants" value={data.length} />
                <KpiCard label="Total Orders" value={totalOrders} />
                <KpiCard label="Total Order Value" value={formatCurrency(totalValue)} color="#c9a96e" />
                <KpiCard label="Total Waste Value" value={formatCurrency(totalWaste)} color="#ef4444" />
            </div>

            {/* Order value by restaurant — bar */}
            <div className="card">
                <div className="card-header"><h3>Order Value by Restaurant</h3><span className="badge badge-muted">All time</span></div>
                <div className="dash-chart-body">
                    <ResponsiveContainer width="100%" height={260}>
                        <BarChart data={data} margin={{ top: 4, right: 20, left: 0, bottom: 60 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke={GRID_COLOR} />
                            <XAxis dataKey="name" tick={{ fill: TEXT_COLOR, fontSize: 10 }} angle={-20} textAnchor="end" interval={0} />
                            <YAxis tick={{ fill: TEXT_COLOR, fontSize: 10 }} tickFormatter={shortVal} width={55} />
                            <Tooltip contentStyle={tooltipStyle} formatter={v => [formatCurrency(v), 'Order Value']} />
                            <Bar dataKey="orderValue" name="Order Value" radius={[4, 4, 0, 0]}>
                                {data.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
                            </Bar>
                        </BarChart>
                    </ResponsiveContainer>
                </div>
            </div>

            {/* Avg order value + waste % — two columns */}
            <div className="dashboard-grid-2">
                <div className="card">
                    <div className="card-header"><h3>Average Order Value</h3></div>
                    <div className="dash-chart-body">
                        <ResponsiveContainer width="100%" height={220}>
                            <BarChart data={data} layout="vertical" margin={{ top: 0, right: 30, left: 0, bottom: 0 }}>
                                <CartesianGrid strokeDasharray="3 3" stroke={GRID_COLOR} horizontal={false} />
                                <XAxis type="number" tick={{ fill: TEXT_COLOR, fontSize: 10 }} tickFormatter={shortVal} />
                                <YAxis type="category" dataKey="name" tick={{ fill: TEXT_COLOR, fontSize: 10 }} width={100} />
                                <Tooltip contentStyle={tooltipStyle} formatter={v => [formatCurrency(v), 'Avg Order']} />
                                <Bar dataKey="avgOrderValue" fill="#c9a96e" radius={[0, 4, 4, 0]} name="Avg Order Value" />
                            </BarChart>
                        </ResponsiveContainer>
                    </div>
                </div>
                <div className="card">
                    <div className="card-header"><h3>Waste % of Order Value</h3></div>
                    <div className="dash-chart-body">
                        <ResponsiveContainer width="100%" height={220}>
                            <BarChart data={data} layout="vertical" margin={{ top: 0, right: 30, left: 0, bottom: 0 }}>
                                <CartesianGrid strokeDasharray="3 3" stroke={GRID_COLOR} horizontal={false} />
                                <XAxis type="number" tick={{ fill: TEXT_COLOR, fontSize: 10 }} unit="%" />
                                <YAxis type="category" dataKey="name" tick={{ fill: TEXT_COLOR, fontSize: 10 }} width={100} />
                                <Tooltip contentStyle={tooltipStyle} formatter={v => [`${v}%`, 'Waste %']} />
                                <Bar dataKey="wastePercent" fill="#ef4444" radius={[0, 4, 4, 0]} name="Waste %" />
                            </BarChart>
                        </ResponsiveContainer>
                    </div>
                </div>
            </div>

            {/* Summary table */}
            <div className="card">
                <div className="card-header"><h3>Restaurant Summary Table</h3></div>
                <div className="data-table-wrapper" style={{ border: 'none', borderRadius: 0 }}>
                    <table className="data-table">
                        <thead>
                            <tr>
                                <th>#</th>
                                <th>Restaurant</th>
                                <th>Orders</th>
                                <th>Total Value</th>
                                <th>Avg Order</th>
                                <th>Waste Value</th>
                                <th>Waste %</th>
                                <th>Top Item</th>
                            </tr>
                        </thead>
                        <tbody>
                            {data.map((r, i) => (
                                <tr key={r.name}>
                                    <td style={{ color: 'var(--color-text-muted)', fontWeight: 700 }}>{i + 1}</td>
                                    <td style={{ fontWeight: 600 }}>{r.name}</td>
                                    <td>{r.orders}</td>
                                    <td style={{ fontWeight: 700, color: '#c9a96e' }}>{formatCurrency(r.orderValue)}</td>
                                    <td>{formatCurrency(r.avgOrderValue)}</td>
                                    <td style={{ color: r.wasteValue > 0 ? '#ef4444' : 'var(--color-text-muted)' }}>{formatCurrency(r.wasteValue)}</td>
                                    <td>
                                        <span className={`badge ${r.wastePercent > 10 ? 'badge-danger' : r.wastePercent > 5 ? 'badge-warning' : 'badge-success'}`}>
                                            {r.wastePercent}%
                                        </span>
                                    </td>
                                    <td style={{ color: 'var(--color-text-muted)', fontSize: 12 }}>{r.topItem}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
};

// ═══════════════════════════════════════════════════════
// ITEM ANALYTICS
// ═══════════════════════════════════════════════════════
const ItemAnalytics = ({ data }) => {
    if (!data?.length) return <div className="chart-empty" style={{ height: 200 }}>No order data available</div>;
    const totalQty = data.reduce((s, i) => s + i.quantity, 0);
    const totalValue = data.reduce((s, i) => s + i.value, 0);

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
            <div className="kpi-row">
                <KpiCard label="Unique Items Ordered" value={data.length} />
                <KpiCard label="Total Quantity" value={`${totalQty.toFixed(2)} units`} />
                <KpiCard label="Total Value" value={formatCurrency(totalValue)} color="#c9a96e" />
                <KpiCard label="Top Item" value={data[0]?.name || '—'} />
            </div>

            <div className="card">
                <div className="card-header"><h3>Top 10 Items by Quantity Ordered</h3><span className="badge badge-muted">All time</span></div>
                <div className="dash-chart-body">
                    <ResponsiveContainer width="100%" height={300}>
                        <BarChart data={data} layout="vertical" margin={{ top: 0, right: 30, left: 0, bottom: 0 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke={GRID_COLOR} horizontal={false} />
                            <XAxis type="number" tick={{ fill: TEXT_COLOR, fontSize: 10 }} />
                            <YAxis type="category" dataKey="name" tick={{ fill: TEXT_COLOR, fontSize: 10 }} width={120} />
                            <Tooltip contentStyle={tooltipStyle} formatter={(v, n) => [n === 'quantity' ? `${v} units` : formatCurrency(v), n === 'quantity' ? 'Quantity' : 'Value']} />
                            <Bar dataKey="quantity" fill="#c9a96e" radius={[0, 4, 4, 0]} name="quantity" />
                        </BarChart>
                    </ResponsiveContainer>
                </div>
            </div>

            <div className="card">
                <div className="card-header"><h3>Top Items by Revenue</h3></div>
                <div className="data-table-wrapper" style={{ border: 'none', borderRadius: 0 }}>
                    <table className="data-table">
                        <thead>
                            <tr><th>#</th><th>Item</th><th>Quantity Ordered</th><th>Revenue</th><th>% of Revenue</th></tr>
                        </thead>
                        <tbody>
                            {[...data].sort((a, b) => b.value - a.value).map((item, i) => (
                                <tr key={item.name}>
                                    <td style={{ color: 'var(--color-text-muted)', fontWeight: 700 }}>{i + 1}</td>
                                    <td style={{ fontWeight: 600 }}>{item.name}</td>
                                    <td>{item.quantity.toFixed(2)}</td>
                                    <td style={{ fontWeight: 700, color: '#c9a96e' }}>{formatCurrency(item.value)}</td>
                                    <td>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                            <div style={{ flex: 1, height: 6, background: 'var(--color-border)', borderRadius: 3 }}>
                                                <div style={{ width: `${Math.round(item.value / totalValue * 100)}%`, height: '100%', background: '#c9a96e', borderRadius: 3 }} />
                                            </div>
                                            <span style={{ fontSize: 11, minWidth: 30 }}>{Math.round(item.value / totalValue * 100)}%</span>
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
};

// ═══════════════════════════════════════════════════════
// VENDOR PERFORMANCE
// ═══════════════════════════════════════════════════════
const VendorPerformance = ({ data }) => {
    if (!data?.length) return (
        <div className="card">
            <div className="empty-state" style={{ padding: 60 }}>
                <div className="empty-state-icon">🏭</div>
                <div className="empty-state-title">No Purchase Orders Found</div>
                <div className="empty-state-description">Create purchase orders to see vendor analytics here.</div>
            </div>
        </div>
    );
    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
            <div className="card">
                <div className="card-header"><h3>Purchase Volume by Vendor</h3></div>
                <div className="dash-chart-body">
                    <ResponsiveContainer width="100%" height={260}>
                        <BarChart data={data} margin={{ top: 4, right: 20, left: 0, bottom: 40 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke={GRID_COLOR} />
                            <XAxis dataKey="name" tick={{ fill: TEXT_COLOR, fontSize: 10 }} angle={-20} textAnchor="end" interval={0} />
                            <YAxis tick={{ fill: TEXT_COLOR, fontSize: 10 }} tickFormatter={shortVal} width={55} />
                            <Tooltip contentStyle={tooltipStyle} formatter={v => [formatCurrency(v), 'Purchase Value']} />
                            <Bar dataKey="value" fill="#22c55e" radius={[4, 4, 0, 0]} name="Purchase Value">
                                {data.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
                            </Bar>
                        </BarChart>
                    </ResponsiveContainer>
                </div>
            </div>
            <div className="card">
                <div className="card-header"><h3>Vendor Summary</h3></div>
                <div className="data-table-wrapper" style={{ border: 'none', borderRadius: 0 }}>
                    <table className="data-table">
                        <thead>
                            <tr><th>Vendor</th><th>Purchase Orders</th><th>Total Value</th><th>Items Purchased</th></tr>
                        </thead>
                        <tbody>
                            {data.map(v => (
                                <tr key={v.name}>
                                    <td style={{ fontWeight: 600 }}>{v.name}</td>
                                    <td>{v.orders}</td>
                                    <td style={{ fontWeight: 700, color: '#22c55e' }}>{formatCurrency(v.value)}</td>
                                    <td>{v.items}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
};

// ═══════════════════════════════════════════════════════
// BATCH ANALYTICS
// ═══════════════════════════════════════════════════════
const BatchAnalyticsTab = ({ data }) => {
    if (!data) return <div className="chart-loading">Loading…</div>;
    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
            <div className="kpi-row">
                <KpiCard label="Total Batches" value={data.totalBatches} />
                <KpiCard label="Active Batches" value={data.activeBatches} color="#22c55e" />
                <KpiCard label="Avg Utilization" value={`${data.avgUtilization}%`} color="#3b82f6" />
                <KpiCard label="Expired Batch Loss" value={formatCurrency(data.expiredValue)} color="#ef4444" sub={`${data.expiredBatches} batches`} />
            </div>

            <div className="dashboard-grid-2">
                <div className="card">
                    <div className="card-header">
                        <h3>Batch Status Overview</h3>
                    </div>
                    <div className="dash-chart-body">
                        <ResponsiveContainer width="100%" height={200}>
                            <PieChart>
                                <Pie
                                    data={[
                                        { name: 'Active', value: data.activeBatches },
                                        { name: 'Expired', value: data.expiredBatches },
                                        { name: 'Other', value: Math.max(0, data.totalBatches - data.activeBatches - data.expiredBatches) },
                                    ].filter(d => d.value > 0)}
                                    dataKey="value" nameKey="name"
                                    cx="50%" cy="50%" outerRadius={75} labelLine={false}>
                                    {['#22c55e', '#ef4444', '#9ca3af'].map((c, i) => <Cell key={i} fill={c} />)}
                                </Pie>
                                <Tooltip contentStyle={tooltipStyle} />
                                <Legend iconSize={10} wrapperStyle={{ fontSize: 11, color: TEXT_COLOR }} />
                            </PieChart>
                        </ResponsiveContainer>
                    </div>
                </div>

                <div className="card">
                    <div className="card-header">
                        <h3>Production Batches</h3>
                        <span className="badge badge-muted">Cooked meat</span>
                    </div>
                    <div style={{ padding: '24px 20px', display: 'flex', flexDirection: 'column', gap: 16 }}>
                        {[
                            { label: 'Completed Today', value: data.productionToday, color: '#c9a96e' },
                            { label: 'Completed This Week', value: data.productionWeek, color: '#3b82f6' },
                            { label: 'Avg Utilization', value: `${data.avgUtilization}%`, color: '#22c55e' },
                            { label: 'Expired Value Loss', value: formatCurrency(data.expiredValue), color: '#ef4444' },
                        ].map(item => (
                            <div key={item.label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: '1px solid var(--color-border-light)' }}>
                                <span style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>{item.label}</span>
                                <span style={{ fontWeight: 700, fontSize: 15, color: item.color }}>{item.value}</span>
                            </div>
                        ))}
                    </div>
                </div>
            </div>

            {/* Expired batch loss table */}
            {data.expiredList?.length > 0 && (
                <div className="card">
                    <div className="card-header">
                        <h3 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <MdWarning style={{ color: '#ef4444' }} /> Expired Batch Loss Analysis
                        </h3>
                        <span className="badge badge-danger">{data.expiredBatches} batches</span>
                    </div>
                    <div className="data-table-wrapper" style={{ border: 'none', borderRadius: 0 }}>
                        <table className="data-table">
                            <thead>
                                <tr><th>Item</th><th>Batch</th><th>Remaining Qty</th><th>Expired On</th><th>Loss Value</th></tr>
                            </thead>
                            <tbody>
                                {data.expiredList.map(b => (
                                    <tr key={b.id}>
                                        <td style={{ fontWeight: 600 }}>{b.item_name}</td>
                                        <td style={{ fontFamily: 'monospace', fontSize: 12 }}>{b.batch_number}</td>
                                        <td>{b.quantity} {b.unit}</td>
                                        <td style={{ color: '#ef4444' }}>{b.expiry_date?.toLocaleDateString('en-GB') || '—'}</td>
                                        <td style={{ fontWeight: 700, color: '#ef4444' }}>{formatCurrency(b.value)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}
        </div>
    );
};

// ═══════════════════════════════════════════════════════
// MAIN REPORTS PAGE
// ═══════════════════════════════════════════════════════
const ReportsPage = () => {
    const [tab, setTab] = useState('restaurants');
    const [loading, setLoading] = useState(false);
    const [restaurants, setRestaurants] = useState(null);
    const [items, setItems] = useState(null);
    const [vendors, setVendors] = useState(null);
    const [batches, setBatches] = useState(null);

    const loadTab = useCallback(async (t) => {
        setLoading(true);
        try {
            if (t === 'restaurants' && !restaurants) {
                setRestaurants(await fetchRestaurantComparison());
            } else if (t === 'items' && !items) {
                setItems(await fetchTopOrderedItems(20));
            } else if (t === 'vendors' && !vendors) {
                setVendors(await fetchVendorAnalysis());
            } else if (t === 'batches' && !batches) {
                setBatches(await fetchBatchAnalytics());
            }
        } catch (e) {
            toast.error('Failed to load analytics data');
            console.error(e);
        } finally {
            setLoading(false);
        }
    }, [restaurants, items, vendors, batches]);

    useEffect(() => { loadTab(tab); }, [tab]); // eslint-disable-line

    const handleRefresh = () => {
        if (tab === 'restaurants') setRestaurants(null);
        if (tab === 'items') setItems(null);
        if (tab === 'vendors') setVendors(null);
        if (tab === 'batches') setBatches(null);
        setTimeout(() => loadTab(tab), 50);
    };

    return (
        <div className="reports-page">
            <div className="page-header">
                <div>
                    <h2 className="page-title">Reports & Analytics</h2>
                    <p className="page-subtitle">Comparative insights across restaurants, items, vendors, and batches.</p>
                </div>
                <button className="btn-refresh" onClick={handleRefresh}><MdRefresh /></button>
            </div>

            <div className="reports-tab-bar">
                {TABS.map(t => (
                    <button key={t.id}
                        className={`reports-tab ${tab === t.id ? 'active' : ''}`}
                        onClick={() => setTab(t.id)}>
                        <t.icon /> {t.label}
                    </button>
                ))}
            </div>

            {loading ? (
                <div style={{ textAlign: 'center', padding: 80, color: 'var(--color-text-muted)' }}>
                    Loading analytics…
                </div>
            ) : (
                <>
                    {tab === 'restaurants' && <RestaurantComparison data={restaurants} />}
                    {tab === 'items' && <ItemAnalytics data={items} />}
                    {tab === 'vendors' && <VendorPerformance data={vendors} />}
                    {tab === 'batches' && <BatchAnalyticsTab data={batches} />}
                </>
            )}
        </div>
    );
};

export default ReportsPage;
