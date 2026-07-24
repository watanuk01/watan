import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
    BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
    ResponsiveContainer, Cell, PieChart, Pie, Legend,
    LineChart, Line,
} from 'recharts';
import {
    MdBarChart, MdStore, MdShoppingCart, MdDelete,
    MdInventory2, MdRefresh, MdWarning, MdFilterList,
    MdPictureAsPdf, MdEmail, MdClose, MdExpandMore,
    MdExpandLess, MdSearch, MdTrendingUp, MdTrendingDown,
} from 'react-icons/md';
import {
    fetchRestaurantComparison,
    fetchVendorAnalysis,
    fetchBatchAnalytics,
    fetchTopOrderedItems,
    fetchRestaurantList,
    formatCurrency,
    clearCache,
    startOfDay,
    endOfDay,
} from '../../services/analyticsService';
import { getFunctions, httpsCallable } from 'firebase/functions';
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

// Report-specific date presets
const REPORT_PRESETS = [
    { id: 'today', label: 'Today' },
    { id: 'yesterday', label: 'Yesterday' },
    { id: 'this_week', label: 'This Week' },
    { id: 'this_month', label: 'This Month' },
    { id: 'custom', label: 'Custom' },
];

const getReportPresetDates = (presetId) => {
    const now = new Date();
    const todayStart = startOfDay(now);
    const todayEnd = endOfDay(now);
    switch (presetId) {
        case 'today':
            return { dateFrom: todayStart, dateTo: todayEnd };
        case 'yesterday': {
            const y = new Date(now);
            y.setDate(y.getDate() - 1);
            return { dateFrom: startOfDay(y), dateTo: endOfDay(y) };
        }
        case 'this_week': {
            const d = new Date(now);
            d.setDate(d.getDate() - d.getDay());
            d.setHours(0, 0, 0, 0);
            return { dateFrom: d, dateTo: todayEnd };
        }
        case 'this_month': {
            const d = new Date(now.getFullYear(), now.getMonth(), 1);
            return { dateFrom: d, dateTo: todayEnd };
        }
        default:
            return { dateFrom: null, dateTo: null };
    }
};

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
// EMAIL MODAL
// ═══════════════════════════════════════════════════════
const EmailModal = ({ onClose, onSend, sending }) => {
    const [email, setEmail] = useState('');
    const valid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
    return (
        <div className="report-modal-overlay" onClick={onClose}>
            <div className="report-modal" onClick={e => e.stopPropagation()}>
                <div className="report-modal-header">
                    <h3><MdEmail /> Email Report</h3>
                    <button className="report-modal-close" onClick={onClose}><MdClose /></button>
                </div>
                <div className="report-modal-body">
                    <label className="report-modal-label">Recipient Email</label>
                    <input
                        type="email"
                        className="report-modal-input"
                        placeholder="e.g. manager@watan.com"
                        value={email}
                        onChange={e => setEmail(e.target.value)}
                        autoFocus
                    />
                    {email && !valid && <p style={{ color: '#ef4444', fontSize: 12, marginTop: 4 }}>Please enter a valid email address</p>}
                </div>
                <div className="report-modal-footer">
                    <button className="btn-secondary" onClick={onClose}>Cancel</button>
                    <button
                        className="btn-primary"
                        disabled={!valid || sending}
                        onClick={() => onSend(email)}
                    >
                        {sending ? 'Sending…' : 'Send Report'}
                    </button>
                </div>
            </div>
        </div>
    );
};

// ═══════════════════════════════════════════════════════
// RESTAURANT COMPARISON
// ═══════════════════════════════════════════════════════
const RestaurantComparison = ({ data }) => {
    const [expandedRow, setExpandedRow] = useState(null);

    if (!data?.length) return <div className="chart-empty" style={{ height: 200 }}>No order data available</div>;

    const totalOrders = data.reduce((s, r) => s + r.orders, 0);
    const totalValue = data.reduce((s, r) => s + r.orderValue, 0);
    const totalWaste = data.reduce((s, r) => s + r.wasteValue, 0);
    const totalEpos = data.reduce((s, r) => s + (r.eposSaleValue || 0), 0);

    // Comparison KPIs
    const sorted = [...data];
    const highestOrder = sorted.sort((a, b) => b.orderValue - a.orderValue)[0];
    const lowestOrder = sorted.filter(r => r.orders > 0).sort((a, b) => a.orderValue - b.orderValue)[0];
    const highestEpos = [...data].sort((a, b) => (b.eposSaleValue || 0) - (a.eposSaleValue || 0))[0];
    const lowestEpos = [...data].filter(r => (r.eposSaleValue || 0) > 0).sort((a, b) => (a.eposSaleValue || 0) - (b.eposSaleValue || 0))[0];
    const highestWaste = [...data].sort((a, b) => b.wasteValue - a.wasteValue)[0];

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
            {/* Aggregate KPIs */}
            <div className="kpi-row">
                <KpiCard label="Total Restaurants" value={data.length} />
                <KpiCard label="Total Orders" value={totalOrders} />
                <KpiCard label="Total Order Value" value={formatCurrency(totalValue)} color="#c9a96e" />
                <KpiCard label="Total Waste Value" value={formatCurrency(totalWaste)} color="#ef4444" />
            </div>

            {/* Comparison KPIs (Req 5) */}
            <div className="kpi-row" style={{ gridTemplateColumns: 'repeat(5, 1fr)' }}>
                <KpiCard
                    label="Highest Order Value"
                    value={highestOrder ? formatCurrency(highestOrder.orderValue) : '—'}
                    sub={highestOrder?.name || ''}
                    color="#22c55e"
                />
                <KpiCard
                    label="Lowest Order Value"
                    value={lowestOrder ? formatCurrency(lowestOrder.orderValue) : '—'}
                    sub={lowestOrder?.name || ''}
                    color="#f59e0b"
                />
                <KpiCard
                    label="Highest EPOS Sale"
                    value={highestEpos && highestEpos.eposSaleValue > 0 ? formatCurrency(highestEpos.eposSaleValue) : '—'}
                    sub={highestEpos?.eposSaleValue > 0 ? highestEpos.name : 'No EPOS data'}
                    color="#3b82f6"
                />
                <KpiCard
                    label="Lowest EPOS Sale"
                    value={lowestEpos ? formatCurrency(lowestEpos.eposSaleValue) : '—'}
                    sub={lowestEpos?.name || 'No EPOS data'}
                    color="#8b5cf6"
                />
                <KpiCard
                    label="Highest Wastage"
                    value={highestWaste && highestWaste.wasteValue > 0 ? formatCurrency(highestWaste.wasteValue) : '—'}
                    sub={highestWaste?.wasteValue > 0 ? highestWaste.name : 'No waste data'}
                    color="#ef4444"
                />
            </div>

            {/* Order Value by Restaurant — TABLE (Req 6) */}
            <div className="card">
                <div className="card-header"><h3>Order Value by Restaurant</h3></div>
                <div className="data-table-wrapper" style={{ border: 'none', borderRadius: 0 }}>
                    <table className="data-table">
                        <thead>
                            <tr>
                                <th>Rank</th>
                                <th>Restaurant Name</th>
                                <th>Total Order Value</th>
                                <th>% of Total Revenue</th>
                            </tr>
                        </thead>
                        <tbody>
                            {data.map((r, i) => {
                                const pct = totalValue > 0 ? Math.round(r.orderValue / totalValue * 100) : 0;
                                return (
                                    <tr key={r.name}>
                                        <td style={{ color: 'var(--color-text-muted)', fontWeight: 700 }}>{i + 1}</td>
                                        <td style={{ fontWeight: 600 }}>{r.name}</td>
                                        <td style={{ fontWeight: 700, color: '#c9a96e' }}>{formatCurrency(r.orderValue)}</td>
                                        <td>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                                <div style={{ flex: 1, height: 6, background: 'var(--color-border)', borderRadius: 3 }}>
                                                    <div style={{ width: `${pct}%`, height: '100%', background: CHART_COLORS[i % CHART_COLORS.length], borderRadius: 3 }} />
                                                </div>
                                                <span style={{ fontSize: 11, minWidth: 30 }}>{pct}%</span>
                                            </div>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
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

            {/* Summary table (Req 7) */}
            <div className="card">
                <div className="card-header"><h3>Restaurant Summary Table</h3></div>
                <div className="data-table-wrapper" style={{ border: 'none', borderRadius: 0 }}>
                    <table className="data-table">
                        <thead>
                            <tr>
                                <th>#</th>
                                <th>Restaurant</th>
                                <th>Orders</th>
                                <th>Total Order Value</th>
                                <th>Total EPOS Sale</th>
                                <th>Difference</th>
                                <th>Avg Order</th>
                                <th>Waste Value</th>
                                <th>Waste %</th>
                                <th>Top Item</th>
                                <th></th>
                            </tr>
                        </thead>
                        <tbody>
                            {data.map((r, i) => (
                                <React.Fragment key={r.name}>
                                    <tr>
                                        <td style={{ color: 'var(--color-text-muted)', fontWeight: 700 }}>{i + 1}</td>
                                        <td style={{ fontWeight: 600 }}>{r.name}</td>
                                        <td>{r.orders}</td>
                                        <td style={{ fontWeight: 700, color: '#c9a96e' }}>{formatCurrency(r.orderValue)}</td>
                                        <td style={{ fontWeight: 600, color: '#3b82f6' }}>{formatCurrency(r.eposSaleValue || 0)}</td>
                                        <td style={{ fontWeight: 600, color: (r.difference || 0) >= 0 ? '#22c55e' : '#ef4444' }}>
                                            {(r.difference || 0) >= 0 ? '+' : ''}{formatCurrency(r.difference || 0)}
                                        </td>
                                        <td>{formatCurrency(r.avgOrderValue)}</td>
                                        <td style={{ color: r.wasteValue > 0 ? '#ef4444' : 'var(--color-text-muted)' }}>{formatCurrency(r.wasteValue)}</td>
                                        <td>
                                            <span className={`badge ${r.wastePercent > 10 ? 'badge-danger' : r.wastePercent > 5 ? 'badge-warning' : 'badge-success'}`}>
                                                {r.wastePercent}%
                                            </span>
                                        </td>
                                        <td style={{ color: 'var(--color-text-muted)', fontSize: 12 }}>{r.topItem}</td>
                                        <td>
                                            <button
                                                className="report-expand-btn"
                                                onClick={() => setExpandedRow(expandedRow === i ? null : i)}
                                                title="Show top items & waste"
                                            >
                                                {expandedRow === i ? <MdExpandLess /> : <MdExpandMore />}
                                            </button>
                                        </td>
                                    </tr>
                                    {expandedRow === i && (
                                        <tr className="report-expanded-row">
                                            <td colSpan={11}>
                                                <div className="report-expanded-content">
                                                    <div className="report-expanded-section">
                                                        <h4>Top 10 Items Ordered</h4>
                                                        {r.topItemsList?.length > 0 ? (
                                                            <table className="data-table" style={{ fontSize: 12 }}>
                                                                <thead><tr><th>#</th><th>Item</th><th>Qty</th><th>Value</th></tr></thead>
                                                                <tbody>
                                                                    {r.topItemsList.map((item, j) => (
                                                                        <tr key={item.name}><td>{j + 1}</td><td>{item.name}</td><td>{Math.round(item.quantity * 10) / 10}</td><td>{formatCurrency(item.value)}</td></tr>
                                                                    ))}
                                                                </tbody>
                                                            </table>
                                                        ) : <p style={{ color: 'var(--color-text-muted)', fontSize: 12 }}>No items data</p>}
                                                    </div>
                                                    <div className="report-expanded-section">
                                                        <h4>Top 5 Waste Items</h4>
                                                        {r.topWasteList?.length > 0 ? (
                                                            <table className="data-table" style={{ fontSize: 12 }}>
                                                                <thead><tr><th>#</th><th>Item</th><th>Value</th></tr></thead>
                                                                <tbody>
                                                                    {r.topWasteList.map((item, j) => (
                                                                        <tr key={item.name}><td>{j + 1}</td><td>{item.name}</td><td style={{ color: '#ef4444' }}>{formatCurrency(item.value)}</td></tr>
                                                                    ))}
                                                                </tbody>
                                                            </table>
                                                        ) : <p style={{ color: 'var(--color-text-muted)', fontSize: 12 }}>No waste data</p>}
                                                    </div>
                                                </div>
                                            </td>
                                        </tr>
                                    )}
                                </React.Fragment>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
};

// ═══════════════════════════════════════════════════════
// ITEM ANALYTICS (Req 8)
// ═══════════════════════════════════════════════════════
const ItemAnalytics = ({ data, categories }) => {
    const [categoryFilter, setCategoryFilter] = useState('all');
    const [searchQuery, setSearchQuery] = useState('');

    if (!data?.length) return <div className="chart-empty" style={{ height: 200 }}>No order data available</div>;

    // Apply category + search filters
    let filteredData = data;
    if (categoryFilter !== 'all') {
        filteredData = filteredData.filter(i => i.category === categoryFilter);
    }
    if (searchQuery) {
        const q = searchQuery.toLowerCase();
        filteredData = filteredData.filter(i => i.name.toLowerCase().includes(q));
    }

    const totalQty = filteredData.reduce((s, i) => s + i.quantity, 0);
    const totalValue = filteredData.reduce((s, i) => s + i.value, 0);

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
            {/* Item Filters */}
            <div className="dash-filter-bar">
                <MdFilterList className="dash-filter-icon" />
                <select
                    className="dash-filter-select"
                    value={categoryFilter}
                    onChange={e => setCategoryFilter(e.target.value)}
                >
                    <option value="all">All Categories</option>
                    {(categories || []).map(c => <option key={c} value={c}>{c}</option>)}
                </select>
                <div style={{ position: 'relative', flex: 1, minWidth: 180 }}>
                    <MdSearch style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-muted)', fontSize: 16 }} />
                    <input
                        type="text"
                        className="dash-filter-select"
                        style={{ paddingLeft: 28, width: '100%', boxSizing: 'border-box' }}
                        placeholder="Search items…"
                        value={searchQuery}
                        onChange={e => setSearchQuery(e.target.value)}
                    />
                </div>
            </div>

            <div className="kpi-row">
                <KpiCard label="Items Shown" value={filteredData.length} />
                <KpiCard label="Total Quantity" value={`${totalQty.toFixed(2)}`} />
                <KpiCard label="Total Value" value={formatCurrency(totalValue)} color="#c9a96e" />
                <KpiCard label="Top Item" value={filteredData[0]?.name || '—'} />
            </div>

            <div className="card">
                <div className="card-header"><h3>Top Items by Quantity Ordered</h3></div>
                <div className="dash-chart-body">
                    <ResponsiveContainer width="100%" height={300}>
                        <BarChart data={filteredData.slice(0, 10)} layout="vertical" margin={{ top: 0, right: 30, left: 0, bottom: 0 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke={GRID_COLOR} horizontal={false} />
                            <XAxis type="number" tick={{ fill: TEXT_COLOR, fontSize: 10 }} />
                            <YAxis type="category" dataKey="name" tick={{ fill: TEXT_COLOR, fontSize: 10 }} width={120} />
                            <Tooltip contentStyle={tooltipStyle} formatter={(v, n, props) => [`${v} ${props.payload.unit || 'units'}`, 'Quantity']} />
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
                            <tr><th>#</th><th>Item</th><th>Category</th><th>Quantity Ordered</th><th>Revenue</th><th>% of Revenue</th></tr>
                        </thead>
                        <tbody>
                            {[...filteredData].sort((a, b) => b.value - a.value).map((item, i) => (
                                <tr key={item.name}>
                                    <td style={{ color: 'var(--color-text-muted)', fontWeight: 700 }}>{i + 1}</td>
                                    <td style={{ fontWeight: 600 }}>{item.name}</td>
                                    <td style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>{item.category || '—'}</td>
                                    <td>{item.quantity.toFixed(2)} {item.unit || 'units'}</td>
                                    <td style={{ fontWeight: 700, color: '#c9a96e' }}>{formatCurrency(item.value)}</td>
                                    <td>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                            <div style={{ flex: 1, height: 6, background: 'var(--color-border)', borderRadius: 3 }}>
                                                <div style={{ width: `${totalValue > 0 ? Math.round(item.value / totalValue * 100) : 0}%`, height: '100%', background: '#c9a96e', borderRadius: 3 }} />
                                            </div>
                                            <span style={{ fontSize: 11, minWidth: 30 }}>{totalValue > 0 ? Math.round(item.value / totalValue * 100) : 0}%</span>
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
    const [itemCategories, setItemCategories] = useState([]);
    const [vendors, setVendors] = useState(null);
    const [batches, setBatches] = useState(null);

    // Filter state
    const [datePreset, setDatePreset] = useState('this_month');
    const [customFrom, setCustomFrom] = useState('');
    const [customTo, setCustomTo] = useState('');
    const [appliedCustomFrom, setAppliedCustomFrom] = useState('');
    const [appliedCustomTo, setAppliedCustomTo] = useState('');
    const [selectedRestaurant, setSelectedRestaurant] = useState('');
    const [restaurantOptions, setRestaurantOptions] = useState([]);

    // Email modal
    const [showEmailModal, setShowEmailModal] = useState(false);
    const [emailSending, setEmailSending] = useState(false);

    // Ref for PDF export
    const reportRef = useRef(null);

    // Load restaurant list for filter
    useEffect(() => {
        fetchRestaurantList().then(setRestaurantOptions).catch(console.error);
    }, []);

    // Build filter object
    const getFilters = useCallback(() => {
        let filters = {};
        if (datePreset === 'custom') {
            if (appliedCustomFrom) filters.dateFrom = new Date(appliedCustomFrom);
            if (appliedCustomTo) filters.dateTo = endOfDay(new Date(appliedCustomTo));
        } else {
            const { dateFrom, dateTo } = getReportPresetDates(datePreset);
            if (dateFrom) filters.dateFrom = dateFrom;
            if (dateTo) filters.dateTo = dateTo;
        }
        if (selectedRestaurant) {
            const found = restaurantOptions.find(r => r.restaurant_id === selectedRestaurant);
            if (found) {
                filters.restaurantId = found.restaurant_id;
                filters.restaurantName = found.restaurant_name;
            }
        }
        return filters;
    }, [datePreset, appliedCustomFrom, appliedCustomTo, selectedRestaurant, restaurantOptions]);

    const loadTab = useCallback(async (t) => {
        setLoading(true);
        const filters = getFilters();
        try {
            if (t === 'restaurants') {
                setRestaurants(await fetchRestaurantComparison(filters));
            } else if (t === 'items') {
                const result = await fetchTopOrderedItems(50, filters);
                setItems(result.items);
                setItemCategories(result.categories);
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
    }, [getFilters, vendors, batches]);

    // Reload on tab change or filter change
    useEffect(() => {
        loadTab(tab);
    }, [tab, datePreset, appliedCustomFrom, appliedCustomTo, selectedRestaurant]); // eslint-disable-line

    const handleRefresh = () => {
        clearCache();
        setRestaurants(null);
        setItems(null);
        setVendors(null);
        setBatches(null);
        setTimeout(() => loadTab(tab), 50);
    };

    // PDF Export
    const handlePdfExport = async () => {
        const el = reportRef.current;
        if (!el) return;
        toast.loading('Generating PDF…', { id: 'pdf' });
        try {
            const html2pdf = (await import('html2pdf.js')).default;
            await html2pdf().set({
                margin: [10, 10, 10, 10],
                filename: `watan_report_${new Date().toISOString().slice(0, 10)}.pdf`,
                image: { type: 'jpeg', quality: 0.95 },
                html2canvas: { scale: 2, useCORS: true, backgroundColor: '#121218' },
                jsPDF: { unit: 'mm', format: 'a3', orientation: 'landscape' },
            }).from(el).save();
            toast.success('PDF downloaded', { id: 'pdf' });
        } catch (err) {
            console.error('PDF export failed:', err);
            toast.error('PDF export failed', { id: 'pdf' });
        }
    };

    // Email Report
    const handleEmailReport = async (email) => {
        const el = reportRef.current;
        if (!el) return;
        setEmailSending(true);
        try {
            const htmlContent = el.innerHTML;
            const functions = getFunctions();
            const fn = httpsCallable(functions, 'sendReportEmail');
            await fn({
                recipientEmail: email,
                reportHtml: htmlContent,
                reportTitle: `Reports & Analytics — ${TABS.find(t => t.id === tab)?.label || 'Report'}`,
            });
            toast.success(`Report emailed to ${email}`);
            setShowEmailModal(false);
        } catch (err) {
            console.error('Email send failed:', err);
            toast.error(err.message || 'Failed to send email');
        } finally {
            setEmailSending(false);
        }
    };

    return (
        <div className="reports-page">
            <div className="page-header">
                <div>
                    <h2 className="page-title">Reports & Analytics</h2>
                    <p className="page-subtitle">Comparative insights across restaurants, items, vendors, and batches.</p>
                </div>
                <div style={{ display: 'flex', gap: 12 }}>
                    <button className="btn btn-secondary btn-sm" onClick={handlePdfExport} title="Export as PDF" style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 600 }}>
                        <MdPictureAsPdf /> Export PDF
                    </button>
                    <button className="btn btn-primary btn-sm" onClick={() => setShowEmailModal(true)} title="Email Report" style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 600 }}>
                        <MdEmail /> Email Report
                    </button>
                    <button className="btn-refresh" onClick={handleRefresh} style={{ marginLeft: 8 }}><MdRefresh /></button>
                </div>
            </div>

            {/* Filter Bar (Req 4) */}
            <div className="dash-filter-bar">
                <div className="dash-filter-section">
                    <MdFilterList className="dash-filter-icon" />
                    <span className="dash-filter-label">Period</span>
                    <div className="dash-filter-presets">
                        {REPORT_PRESETS.map(p => (
                            <button
                                key={p.id}
                                className={`dash-filter-btn ${datePreset === p.id ? 'active' : ''}`}
                                onClick={() => setDatePreset(p.id)}
                            >
                                {p.label}
                            </button>
                        ))}
                    </div>
                </div>
                <div className="dash-filter-section">
                    <span className="dash-filter-label">Restaurant</span>
                    <select
                        className="dash-filter-select"
                        value={selectedRestaurant}
                        onChange={e => setSelectedRestaurant(e.target.value)}
                    >
                        <option value="">All Restaurants</option>
                        {restaurantOptions.map(r => (
                            <option key={r.restaurant_id} value={r.restaurant_id}>{r.restaurant_name}</option>
                        ))}
                    </select>
                </div>
                {datePreset === 'custom' && (
                    <div className="dash-filter-custom" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        <label>From <input type="date" className="dash-date-input" value={customFrom} onChange={e => setCustomFrom(e.target.value)} /></label>
                        <label>To <input type="date" className="dash-date-input" value={customTo} onChange={e => setCustomTo(e.target.value)} /></label>
                        <button 
                            className="btn btn-primary btn-sm" 
                            style={{ height: '32px', padding: '0 16px' }}
                            onClick={() => { setAppliedCustomFrom(customFrom); setAppliedCustomTo(customTo); }}
                        >
                            Apply
                        </button>
                    </div>
                )}
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

            <div ref={reportRef}>
                {loading ? (
                    <div style={{ textAlign: 'center', padding: 80, color: 'var(--color-text-muted)' }}>
                        Loading analytics…
                    </div>
                ) : (
                    <>
                        {tab === 'restaurants' && <RestaurantComparison data={restaurants} />}
                        {tab === 'items' && <ItemAnalytics data={items} categories={itemCategories} />}
                        {tab === 'vendors' && <VendorPerformance data={vendors} />}
                        {tab === 'batches' && <BatchAnalyticsTab data={batches} />}
                    </>
                )}
            </div>

            {showEmailModal && (
                <EmailModal
                    onClose={() => setShowEmailModal(false)}
                    onSend={handleEmailReport}
                    sending={emailSending}
                />
            )}
        </div>
    );
};

export default ReportsPage;
