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
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
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

const shortVal = v => {
    if (!v) return '£0';
    if (v >= 1000) return `£${(v / 1000).toFixed(1)}k`;
    return `£${v}`;
};

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
                    value={highestOrder && highestOrder.orderValue > 0 ? formatCurrency(highestOrder.orderValue) : '£0.00'}
                    sub={highestOrder && highestOrder.orderValue > 0 ? highestOrder.name : 'No orders in period'}
                    color="#22c55e"
                />
                <KpiCard
                    label="Lowest Order Value"
                    value={lowestOrder && lowestOrder.orderValue > 0 ? formatCurrency(lowestOrder.orderValue) : '£0.00'}
                    sub={lowestOrder && lowestOrder.orderValue > 0 ? lowestOrder.name : 'No orders in period'}
                    color="#f59e0b"
                />
                <KpiCard
                    label="Highest EPOS Sale"
                    value={highestEpos && highestEpos.eposSaleValue > 0 ? formatCurrency(highestEpos.eposSaleValue) : '£0.00'}
                    sub={highestEpos && highestEpos.eposSaleValue > 0 ? highestEpos.name : 'No EPOS data'}
                    color="#3b82f6"
                />
                <KpiCard
                    label="Lowest EPOS Sale"
                    value={lowestEpos && lowestEpos.eposSaleValue > 0 ? formatCurrency(lowestEpos.eposSaleValue) : '£0.00'}
                    sub={lowestEpos && lowestEpos.eposSaleValue > 0 ? lowestEpos.name : 'No EPOS data'}
                    color="#8b5cf6"
                />
                <KpiCard
                    label="Highest Wastage"
                    value={highestWaste && highestWaste.wasteValue > 0 ? formatCurrency(highestWaste.wasteValue) : '£0.00'}
                    sub={highestWaste && highestWaste.wasteValue > 0 ? highestWaste.name : 'No waste data'}
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
    const [datePreset, setDatePreset] = useState('today');
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
            const found = restaurantOptions.find(r => r.restaurant_name === selectedRestaurant || r.restaurant_id === selectedRestaurant || r.id === selectedRestaurant);
            if (found) {
                filters.restaurantId = found.restaurant_id || found.id;
                filters.restaurantName = found.restaurant_name || found.name;
            } else {
                filters.restaurantName = selectedRestaurant;
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
            } else if (t === 'vendors') {
                setVendors(await fetchVendorAnalysis(filters));
            } else if (t === 'batches') {
                setBatches(await fetchBatchAnalytics(filters));
            }
        } catch (e) {
            toast.error('Failed to load analytics data');
            console.error(e);
        } finally {
            setLoading(false);
        }
    }, [getFilters]);

    // Reload on tab change or filter change
    useEffect(() => {
        loadTab(tab);
    }, [tab, loadTab]);

    const handleRefresh = () => {
        clearCache();
        setRestaurants(null);
        setItems(null);
        setVendors(null);
        setBatches(null);
        setTimeout(() => loadTab(tab), 50);
    };

    // PDF Export — jsPDF + autoTable structured export covering ALL fields on the page
    const handlePdfExport = () => {
        toast.loading('Generating PDF…', { id: 'pdf' });
        try {
            const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
            const gold = [201, 169, 110];
            const dark = [30, 30, 46];
            const pageW = doc.internal.pageSize.getWidth();

            // ─ Header ─
            doc.setFillColor(...dark);
            doc.rect(0, 0, pageW, 20, 'F');
            doc.setFont('helvetica', 'bold');
            doc.setFontSize(14);
            doc.setTextColor(...gold);
            doc.text('Watan CK — Reports & Analytics', 14, 13);
            doc.setFontSize(10);
            doc.setTextColor(220, 220, 220);
            const tabLabel = TABS.find(t => t.id === tab)?.label || tab;
            doc.text(tabLabel, pageW - 14, 13, { align: 'right' });

            // ─ Filter context bar ─
            doc.setFillColor(245, 247, 250);
            doc.rect(0, 20, pageW, 10, 'F');
            doc.setFont('helvetica', 'normal');
            doc.setFontSize(9);
            doc.setTextColor(80, 80, 90);
            const dateStr = datePreset === 'custom'
                ? `${appliedCustomFrom || '—'} to ${appliedCustomTo || '—'}`
                : REPORT_PRESETS.find(p => p.id === datePreset)?.label || datePreset;
            const restStr = selectedRestaurant
                ? restaurantOptions.find(r => r.restaurant_name === selectedRestaurant || r.restaurant_id === selectedRestaurant || r.id === selectedRestaurant)?.restaurant_name || selectedRestaurant
                : 'All Restaurants';
            doc.text(`Period: ${dateStr}   |   Restaurant Filter: ${restStr}   |   Generated: ${new Date().toLocaleString('en-GB')}`, 14, 26);

            let startY = 34;
            const headStyles = { fillColor: gold, textColor: [30, 30, 30], fontStyle: 'bold', fontSize: 8 };
            const bodyStyles = { fontSize: 8, textColor: [60, 60, 60] };

            if (tab === 'restaurants' && restaurants?.length) {
                const totalOrders = restaurants.reduce((s, r) => s + r.orders, 0);
                const totalValue = restaurants.reduce((s, r) => s + r.orderValue, 0);
                const totalWaste = restaurants.reduce((s, r) => s + r.wasteValue, 0);
                const totalEpos = restaurants.reduce((s, r) => s + (r.eposSaleValue || 0), 0);

                // 1. Aggregate Overview Bar
                doc.setFontSize(9.5);
                doc.setFont('helvetica', 'bold');
                doc.setTextColor(30, 30, 46);
                doc.text(`Aggregate Overview: ${restaurants.length} Restaurants  |  ${totalOrders} Total Orders  |  Order Value: ${formatCurrency(totalValue)}  |  EPOS Sale: ${formatCurrency(totalEpos)}  |  Waste: ${formatCurrency(totalWaste)}`, 14, startY);
                startY += 6;

                // 2. Comparison KPI Highlights
                const sortedByOrder = [...restaurants].sort((a, b) => b.orderValue - a.orderValue);
                const highestOrder = sortedByOrder[0];
                const lowestOrder = [...restaurants].filter(r => r.orders > 0).sort((a, b) => a.orderValue - b.orderValue)[0];
                const highestEpos = [...restaurants].sort((a, b) => (b.eposSaleValue || 0) - (a.eposSaleValue || 0))[0];
                const lowestEpos = [...restaurants].filter(r => (r.eposSaleValue || 0) > 0).sort((a, b) => (a.eposSaleValue || 0) - (b.eposSaleValue || 0))[0];
                const highestWaste = [...restaurants].sort((a, b) => b.wasteValue - a.wasteValue)[0];

                doc.setFontSize(9.5);
                doc.setFont('helvetica', 'bold');
                doc.setTextColor(30, 30, 46);
                doc.text('Key Performance Highlights & Extremes', 14, startY);
                startY += 4;

                autoTable(doc, {
                    startY,
                    head: [['Metric Highlight', 'Value', 'Restaurant / Branch']],
                    body: [
                        ['Highest Order Value', highestOrder && highestOrder.orderValue > 0 ? formatCurrency(highestOrder.orderValue) : '£0.00', highestOrder && highestOrder.orderValue > 0 ? highestOrder.name : 'No orders in period'],
                        ['Lowest Order Value', lowestOrder && lowestOrder.orderValue > 0 ? formatCurrency(lowestOrder.orderValue) : '£0.00', lowestOrder && lowestOrder.orderValue > 0 ? lowestOrder.name : 'No orders in period'],
                        ['Highest EPOS Sale', highestEpos && highestEpos.eposSaleValue > 0 ? formatCurrency(highestEpos.eposSaleValue) : '£0.00', highestEpos && highestEpos.eposSaleValue > 0 ? highestEpos.name : 'No EPOS data'],
                        ['Lowest EPOS Sale', lowestEpos && lowestEpos.eposSaleValue > 0 ? formatCurrency(lowestEpos.eposSaleValue) : '£0.00', lowestEpos && lowestEpos.eposSaleValue > 0 ? lowestEpos.name : 'No EPOS data'],
                        ['Highest Wastage', highestWaste && highestWaste.wasteValue > 0 ? formatCurrency(highestWaste.wasteValue) : '£0.00', highestWaste && highestWaste.wasteValue > 0 ? highestWaste.name : 'No waste data'],
                    ],
                    headStyles: { fillColor: [30, 30, 46], textColor: [201, 169, 110], fontStyle: 'bold', fontSize: 8 },
                    bodyStyles,
                    styles: { cellPadding: 2 },
                });
                startY = doc.lastAutoTable.finalY + 6;

                // 3. Order Value by Restaurant Breakdown Table
                doc.setFontSize(9.5);
                doc.setFont('helvetica', 'bold');
                doc.setTextColor(30, 30, 46);
                doc.text('Order Value by Restaurant (Revenue Breakdown)', 14, startY);
                startY += 4;

                autoTable(doc, {
                    startY,
                    head: [['Rank', 'Restaurant Name', 'Total Order Value', '% of Total Revenue']],
                    body: sortedByOrder.map((r, i) => [
                        i + 1, r.name, formatCurrency(r.orderValue),
                        `${totalValue > 0 ? Math.round(r.orderValue / totalValue * 100) : 0}%`
                    ]),
                    headStyles, bodyStyles,
                    styles: { cellPadding: 2 },
                });
                startY = doc.lastAutoTable.finalY + 6;

                // 4. Comprehensive Restaurant Summary Table
                doc.setFontSize(9.5);
                doc.setFont('helvetica', 'bold');
                doc.setTextColor(30, 30, 46);
                doc.text('Restaurant Performance Summary Table', 14, startY);
                startY += 4;

                autoTable(doc, {
                    startY,
                    head: [['#', 'Restaurant', 'Orders', 'Order Value', 'EPOS Sale', 'Difference', 'Avg Order', 'Waste Value', 'Waste %', 'Top Item']],
                    body: restaurants.map((r, i) => [
                        i + 1, r.name, r.orders,
                        formatCurrency(r.orderValue), formatCurrency(r.eposSaleValue || 0),
                        `${(r.difference || 0) >= 0 ? '+' : ''}${formatCurrency(r.difference || 0)}`,
                        formatCurrency(r.avgOrderValue), formatCurrency(r.wasteValue),
                        `${r.wastePercent}%`, r.topItem || '—',
                    ]),
                    headStyles, bodyStyles,
                    styles: { cellPadding: 2.5 },
                });
            } else if (tab === 'items' && items?.length) {
                const sorted = [...items].sort((a, b) => b.value - a.value);
                const totalVal = sorted.reduce((s, it) => s + it.value, 0);
                const totalQty = sorted.reduce((s, it) => s + it.quantity, 0);

                doc.setFontSize(9.5);
                doc.setFont('helvetica', 'bold');
                doc.setTextColor(30, 30, 46);
                doc.text(`Item Analytics Summary: ${sorted.length} Tracked Items  |  ${itemCategories?.length || 0} Categories  |  Total Qty: ${totalQty.toFixed(2)}  |  Total Revenue: ${formatCurrency(totalVal)}`, 14, startY);
                startY += 6;

                autoTable(doc, {
                    startY,
                    head: [['#', 'Item Name', 'Category', 'Quantity Sold', 'Total Revenue', '% of Total Revenue']],
                    body: sorted.map((item, i) => [
                        i + 1, item.name, item.category || '—',
                        `${item.quantity.toFixed(2)} ${item.unit || 'units'}`,
                        formatCurrency(item.value),
                        `${totalVal > 0 ? Math.round(item.value / totalVal * 100) : 0}%`,
                    ]),
                    headStyles, bodyStyles,
                    styles: { cellPadding: 2.5 },
                });
            } else if (tab === 'vendors' && vendors?.length) {
                const totalSpend = vendors.reduce((s, v) => s + v.value, 0);
                const totalPOs = vendors.reduce((s, v) => s + v.orders, 0);

                doc.setFontSize(9.5);
                doc.setFont('helvetica', 'bold');
                doc.setTextColor(30, 30, 46);
                doc.text(`Vendor Performance Summary: ${vendors.length} Active Vendors  |  ${totalPOs} Purchase Orders  |  Total Spend: ${formatCurrency(totalSpend)}`, 14, startY);
                startY += 6;

                autoTable(doc, {
                    startY,
                    head: [['Vendor Name', 'Purchase Orders', 'Total Value', 'Items Purchased']],
                    body: vendors.map(v => [v.name, v.orders, formatCurrency(v.value), v.items]),
                    headStyles, bodyStyles,
                    styles: { cellPadding: 2.5 },
                });
            } else if (tab === 'batches' && batches) {
                doc.setFontSize(9.5);
                doc.setFont('helvetica', 'bold');
                doc.setTextColor(30, 30, 46);
                doc.text(`Batch Analytics Summary: ${batches.totalBatches} Total Batches  |  ${batches.activeBatches} Active  |  ${batches.expiredBatches} Expired  |  Utilization: ${batches.avgUtilization}%  |  Loss: ${formatCurrency(batches.expiredValue)}`, 14, startY);
                startY += 6;
                if (batches.expiredList?.length) {
                    autoTable(doc, {
                        startY,
                        head: [['Item Name', 'Batch Number', 'Remaining Qty', 'Expired Date', 'Loss Value']],
                        body: batches.expiredList.map(b => [
                            b.item_name, b.batch_number, `${b.quantity} ${b.unit}`,
                            b.expiry_date?.toLocaleDateString('en-GB') || '—',
                            formatCurrency(b.value),
                        ]),
                        headStyles, bodyStyles,
                        styles: { cellPadding: 2.5 },
                    });
                }
            }

            // Footer
            const pageCount = doc.internal.getNumberOfPages();
            for (let i = 1; i <= pageCount; i++) {
                doc.setPage(i);
                doc.setFontSize(8);
                doc.setTextColor(150, 150, 150);
                doc.text(`Watan CK Operational Reports — Page ${i} of ${pageCount}`, pageW / 2, doc.internal.pageSize.getHeight() - 6, { align: 'center' });
            }

            doc.save(`watan_report_${tab}_${new Date().toISOString().slice(0, 10)}.pdf`);
            toast.success('PDF downloaded successfully', { id: 'pdf' });
        } catch (err) {
            console.error('PDF export failed:', err);
            toast.error('PDF export failed: ' + (err.message || err), { id: 'pdf' });
        }
    };

    // Email Report — clean inline HTML template covering ALL fields on the page
    const handleEmailReport = async (email) => {
        setEmailSending(true);
        try {
            const tabLabel = TABS.find(t => t.id === tab)?.label || tab;
            const dateStr = datePreset === 'custom'
                ? `${appliedCustomFrom || '—'} to ${appliedCustomTo || '—'}`
                : REPORT_PRESETS.find(p => p.id === datePreset)?.label || datePreset;
            const restStr = selectedRestaurant
                ? restaurantOptions.find(r => r.restaurant_name === selectedRestaurant || r.restaurant_id === selectedRestaurant || r.id === selectedRestaurant)?.restaurant_name || selectedRestaurant
                : 'All Restaurants';

            let bodyHtml = '';

            if (tab === 'restaurants' && restaurants?.length) {
                const totalOrders = restaurants.reduce((s, r) => s + r.orders, 0);
                const totalValue = restaurants.reduce((s, r) => s + r.orderValue, 0);
                const totalWaste = restaurants.reduce((s, r) => s + r.wasteValue, 0);
                const totalEpos = restaurants.reduce((s, r) => s + (r.eposSaleValue || 0), 0);

                const sortedByOrder = [...restaurants].sort((a, b) => b.orderValue - a.orderValue);
                const highestOrder = sortedByOrder[0];
                const lowestOrder = [...restaurants].filter(r => r.orders > 0).sort((a, b) => a.orderValue - b.orderValue)[0];
                const highestEpos = [...restaurants].sort((a, b) => (b.eposSaleValue || 0) - (a.eposSaleValue || 0))[0];
                const lowestEpos = [...restaurants].filter(r => (r.eposSaleValue || 0) > 0).sort((a, b) => (a.eposSaleValue || 0) - (b.eposSaleValue || 0))[0];
                const highestWaste = [...restaurants].sort((a, b) => b.wasteValue - a.wasteValue)[0];

                const orderValueRows = sortedByOrder.map((r, i) => `
                    <tr style="border-bottom: 1px solid #e2e8f0; ${i % 2 === 1 ? 'background-color: #f8fafc;' : ''}">
                        <td style="padding: 8px; font-weight: bold;">${i + 1}</td>
                        <td style="padding: 8px; font-weight: 600;">${r.name}</td>
                        <td style="padding: 8px; font-weight: bold; color: #c9a96e;">${formatCurrency(r.orderValue)}</td>
                        <td style="padding: 8px;">${totalValue > 0 ? Math.round(r.orderValue / totalValue * 100) : 0}%</td>
                    </tr>
                `).join('');

                const summaryRows = restaurants.map((r, i) => `
                    <tr style="border-bottom: 1px solid #e2e8f0; ${i % 2 === 1 ? 'background-color: #f8fafc;' : ''}">
                        <td style="padding: 10px; font-weight: bold;">${i + 1}</td>
                        <td style="padding: 10px; font-weight: 600;">${r.name}</td>
                        <td style="padding: 10px;">${r.orders}</td>
                        <td style="padding: 10px; font-weight: bold; color: #c9a96e;">${formatCurrency(r.orderValue)}</td>
                        <td style="padding: 10px; color: #3b82f6;">${formatCurrency(r.eposSaleValue || 0)}</td>
                        <td style="padding: 10px; font-weight: 600; color: ${(r.difference || 0) >= 0 ? '#22c55e' : '#ef4444'};">
                            ${(r.difference || 0) >= 0 ? '+' : ''}${formatCurrency(r.difference || 0)}
                        </td>
                        <td style="padding: 10px;">${formatCurrency(r.avgOrderValue)}</td>
                        <td style="padding: 10px; color: #ef4444;">${formatCurrency(r.wasteValue)}</td>
                        <td style="padding: 10px;">${r.wastePercent}%</td>
                        <td style="padding: 10px; color: #64748b;">${r.topItem || '—'}</td>
                    </tr>
                `).join('');

                bodyHtml = `
                    <!-- 1. Aggregate Overview -->
                    <div style="margin-bottom: 20px; display: table; width: 100%;">
                        <div style="display: table-cell; background:#f8fafc; padding:12px; border-radius:6px; text-align:center; width:20%;">
                            <div style="font-size:18px; font-weight:bold; color:#1e293b;">${restaurants.length}</div>
                            <div style="font-size:11px; color:#64748b;">Total Restaurants</div>
                        </div>
                        <div style="display: table-cell; background:#f8fafc; padding:12px; border-radius:6px; text-align:center; width:20%;">
                            <div style="font-size:18px; font-weight:bold; color:#1e293b;">${totalOrders}</div>
                            <div style="font-size:11px; color:#64748b;">Total Orders</div>
                        </div>
                        <div style="display: table-cell; background:#f8fafc; padding:12px; border-radius:6px; text-align:center; width:20%;">
                            <div style="font-size:18px; font-weight:bold; color:#c9a96e;">${formatCurrency(totalValue)}</div>
                            <div style="font-size:11px; color:#64748b;">Total Order Value</div>
                        </div>
                        <div style="display: table-cell; background:#f8fafc; padding:12px; border-radius:6px; text-align:center; width:20%;">
                            <div style="font-size:18px; font-weight:bold; color:#3b82f6;">${formatCurrency(totalEpos)}</div>
                            <div style="font-size:11px; color:#64748b;">Total EPOS Sale</div>
                        </div>
                        <div style="display: table-cell; background:#f8fafc; padding:12px; border-radius:6px; text-align:center; width:20%;">
                            <div style="font-size:18px; font-weight:bold; color:#ef4444;">${formatCurrency(totalWaste)}</div>
                            <div style="font-size:11px; color:#64748b;">Total Waste Value</div>
                        </div>
                    </div>

                    <!-- 2. Comparison Highlights -->
                    <h3 style="font-size:14px; color:#1e293b; margin: 16px 0 10px 0;">Key Performance Highlights & Extremes</h3>
                    <div style="margin-bottom: 24px; display: table; width: 100%;">
                        <div style="display: table-cell; background:#f0fdf4; padding:10px; border-radius:6px; text-align:center; width:20%; border:1px solid #bbf7d0;">
                            <div style="font-size:15px; font-weight:bold; color:#16a34a;">${highestOrder && highestOrder.orderValue > 0 ? formatCurrency(highestOrder.orderValue) : '£0.00'}</div>
                            <div style="font-size:11px; font-weight:bold; color:#15803d; margin-top:2px;">Highest Order Value</div>
                            <div style="font-size:10px; color:#64748b; margin-top:2px;">${highestOrder && highestOrder.orderValue > 0 ? highestOrder.name : 'No orders'}</div>
                        </div>
                        <div style="display: table-cell; background:#fffbeb; padding:10px; border-radius:6px; text-align:center; width:20%; border:1px solid #fef3c7;">
                            <div style="font-size:15px; font-weight:bold; color:#d97706;">${lowestOrder && lowestOrder.orderValue > 0 ? formatCurrency(lowestOrder.orderValue) : '£0.00'}</div>
                            <div style="font-size:11px; font-weight:bold; color:#b45309; margin-top:2px;">Lowest Order Value</div>
                            <div style="font-size:10px; color:#64748b; margin-top:2px;">${lowestOrder && lowestOrder.orderValue > 0 ? lowestOrder.name : 'No orders'}</div>
                        </div>
                        <div style="display: table-cell; background:#eff6ff; padding:10px; border-radius:6px; text-align:center; width:20%; border:1px solid #bfdbfe;">
                            <div style="font-size:15px; font-weight:bold; color:#2563eb;">${highestEpos && highestEpos.eposSaleValue > 0 ? formatCurrency(highestEpos.eposSaleValue) : '£0.00'}</div>
                            <div style="font-size:11px; font-weight:bold; color:#1d4ed8; margin-top:2px;">Highest EPOS Sale</div>
                            <div style="font-size:10px; color:#64748b; margin-top:2px;">${highestEpos && highestEpos.eposSaleValue > 0 ? highestEpos.name : 'No EPOS data'}</div>
                        </div>
                        <div style="display: table-cell; background:#f3e8ff; padding:10px; border-radius:6px; text-align:center; width:20%; border:1px solid #e9d5ff;">
                            <div style="font-size:15px; font-weight:bold; color:#9333ea;">${lowestEpos && lowestEpos.eposSaleValue > 0 ? formatCurrency(lowestEpos.eposSaleValue) : '£0.00'}</div>
                            <div style="font-size:11px; font-weight:bold; color:#7e22ce; margin-top:2px;">Lowest EPOS Sale</div>
                            <div style="font-size:10px; color:#64748b; margin-top:2px;">${lowestEpos && lowestEpos.eposSaleValue > 0 ? lowestEpos.name : 'No EPOS data'}</div>
                        </div>
                        <div style="display: table-cell; background:#fef2f2; padding:10px; border-radius:6px; text-align:center; width:20%; border:1px solid #fecaca;">
                            <div style="font-size:15px; font-weight:bold; color:#dc2626;">${highestWaste && highestWaste.wasteValue > 0 ? formatCurrency(highestWaste.wasteValue) : '£0.00'}</div>
                            <div style="font-size:11px; font-weight:bold; color:#b91c1c; margin-top:2px;">Highest Wastage</div>
                            <div style="font-size:10px; color:#64748b; margin-top:2px;">${highestWaste && highestWaste.wasteValue > 0 ? highestWaste.name : 'No waste data'}</div>
                        </div>
                    </div>

                    <!-- 3. Order Value by Restaurant Breakdown -->
                    <h3 style="font-size:14px; color:#1e293b; margin: 16px 0 10px 0;">Order Value by Restaurant</h3>
                    <table style="width: 100%; border-collapse: collapse; font-size: 12px; margin-bottom: 24px;">
                        <thead>
                            <tr style="background: #1e1e2e; color: #c9a96e; text-align: left;">
                                <th style="padding: 8px;">Rank</th>
                                <th style="padding: 8px;">Restaurant Name</th>
                                <th style="padding: 8px;">Total Order Value</th>
                                <th style="padding: 8px;">% of Total Revenue</th>
                            </tr>
                        </thead>
                        <tbody>${orderValueRows}</tbody>
                    </table>

                    <!-- 4. Full Restaurant Summary Table -->
                    <h3 style="font-size:14px; color:#1e293b; margin: 16px 0 10px 0;">Restaurant Summary Table</h3>
                    <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
                        <thead>
                            <tr style="background: #1e1e2e; color: #c9a96e; text-align: left;">
                                <th style="padding: 10px;">#</th>
                                <th style="padding: 10px;">Restaurant</th>
                                <th style="padding: 10px;">Orders</th>
                                <th style="padding: 10px;">Order Value</th>
                                <th style="padding: 10px;">EPOS Sale</th>
                                <th style="padding: 10px;">Difference</th>
                                <th style="padding: 10px;">Avg Order</th>
                                <th style="padding: 10px;">Waste</th>
                                <th style="padding: 10px;">Waste %</th>
                                <th style="padding: 10px;">Top Item</th>
                            </tr>
                        </thead>
                        <tbody>${summaryRows}</tbody>
                    </table>
                `;
            } else if (tab === 'items' && items?.length) {
                const sorted = [...items].sort((a, b) => b.value - a.value);
                const totalValue = sorted.reduce((s, it) => s + it.value, 0);

                const rows = sorted.map((item, i) => `
                    <tr style="border-bottom: 1px solid #e2e8f0; ${i % 2 === 1 ? 'background-color: #f8fafc;' : ''}">
                        <td style="padding: 10px; font-weight: bold;">${i + 1}</td>
                        <td style="padding: 10px; font-weight: 600;">${item.name}</td>
                        <td style="padding: 10px; color: #64748b;">${item.category || '—'}</td>
                        <td style="padding: 10px;">${item.quantity.toFixed(2)} ${item.unit || 'units'}</td>
                        <td style="padding: 10px; font-weight: bold; color: #c9a96e;">${formatCurrency(item.value)}</td>
                        <td style="padding: 10px;">${totalValue > 0 ? Math.round(item.value / totalValue * 100) : 0}%</td>
                    </tr>
                `).join('');

                bodyHtml = `
                    <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
                        <thead>
                            <tr style="background: #1e1e2e; color: #c9a96e; text-align: left;">
                                <th style="padding: 10px;">#</th>
                                <th style="padding: 10px;">Item</th>
                                <th style="padding: 10px;">Category</th>
                                <th style="padding: 10px;">Quantity</th>
                                <th style="padding: 10px;">Revenue</th>
                                <th style="padding: 10px;">% of Total</th>
                            </tr>
                        </thead>
                        <tbody>${rows}</tbody>
                    </table>
                `;
            } else if (tab === 'vendors' && vendors?.length) {
                const rows = vendors.map((v, i) => `
                    <tr style="border-bottom: 1px solid #e2e8f0; ${i % 2 === 1 ? 'background-color: #f8fafc;' : ''}">
                        <td style="padding: 10px; font-weight: 600;">${v.name}</td>
                        <td style="padding: 10px;">${v.orders}</td>
                        <td style="padding: 10px; font-weight: bold; color: #22c55e;">${formatCurrency(v.value)}</td>
                        <td style="padding: 10px;">${v.items}</td>
                    </tr>
                `).join('');

                bodyHtml = `
                    <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
                        <thead>
                            <tr style="background: #1e1e2e; color: #c9a96e; text-align: left;">
                                <th style="padding: 10px;">Vendor</th>
                                <th style="padding: 10px;">Orders</th>
                                <th style="padding: 10px;">Total Value</th>
                                <th style="padding: 10px;">Items Purchased</th>
                            </tr>
                        </thead>
                        <tbody>${rows}</tbody>
                    </table>
                `;
            } else if (tab === 'batches' && batches) {
                const rows = (batches.expiredList || []).map((b, i) => `
                    <tr style="border-bottom: 1px solid #e2e8f0; ${i % 2 === 1 ? 'background-color: #f8fafc;' : ''}">
                        <td style="padding: 10px; font-weight: 600;">${b.item_name}</td>
                        <td style="padding: 10px; font-family: monospace;">${b.batch_number}</td>
                        <td style="padding: 10px;">${b.quantity} ${b.unit}</td>
                        <td style="padding: 10px; color: #ef4444;">${b.expiry_date?.toLocaleDateString('en-GB') || '—'}</td>
                        <td style="padding: 10px; font-weight: bold; color: #ef4444;">${formatCurrency(b.value)}</td>
                    </tr>
                `).join('');

                bodyHtml = `
                    <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
                        <thead>
                            <tr style="background: #1e1e2e; color: #c9a96e; text-align: left;">
                                <th style="padding: 10px;">Item</th>
                                <th style="padding: 10px;">Batch</th>
                                <th style="padding: 10px;">Remaining Qty</th>
                                <th style="padding: 10px;">Expired On</th>
                                <th style="padding: 10px;">Loss Value</th>
                            </tr>
                        </thead>
                        <tbody>${rows}</tbody>
                    </table>
                `;
            }

            const htmlContent = `
                <div style="font-family: Arial, Helvetica, sans-serif; background-color: #f1f5f9; padding: 24px; color: #1e293b;">
                    <div style="max-width: 900px; margin: 0 auto; background: #ffffff; border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.08); overflow: hidden;">
                        <div style="background: #1e1e2e; padding: 24px; border-bottom: 3px solid #c9a96e;">
                            <h1 style="margin: 0; color: #c9a96e; font-size: 22px;">Watan CK — Operational Analytics Report</h1>
                            <div style="color: #94a3b8; font-size: 14px; margin-top: 6px;">${tabLabel}</div>
                        </div>
                        <div style="background: #f8fafc; padding: 14px 24px; border-bottom: 1px solid #e2e8f0; font-size: 13px; color: #475569;">
                            <strong>Period:</strong> ${dateStr} &nbsp;|&nbsp;
                            <strong>Restaurant Scope:</strong> ${restStr} &nbsp;|&nbsp;
                            <strong>Generated:</strong> ${new Date().toLocaleString('en-GB')}
                        </div>
                        <div style="padding: 24px;">
                            ${bodyHtml}
                        </div>
                        <div style="background: #f1f5f9; padding: 14px 24px; font-size: 12px; color: #64748b; text-align: center; border-top: 1px solid #e2e8f0;">
                            Watan Central Kitchen Operational Platform — Automated Operations Report
                        </div>
                    </div>
                </div>
            `;

            const functions = getFunctions();
            const fn = httpsCallable(functions, 'sendReportEmail');
            await fn({
                recipientEmail: email,
                reportHtml: htmlContent,
                reportTitle: `Reports & Analytics — ${tabLabel}`,
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
                            <option key={r.restaurant_id || r.id} value={r.restaurant_name}>{r.restaurant_name}</option>
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
