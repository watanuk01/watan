import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
    MdFilterList, MdSearch, MdPictureAsPdf,
    MdTrendingUp, MdShoppingCart, MdCategory,
} from 'react-icons/md';
import {
    BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
    ResponsiveContainer, Legend,
} from 'recharts';
import {
    fetchTopOrderedItems,
    fetchRestaurantList,
    formatCurrency,
    startOfDay,
    endOfDay,
} from '../../services/analyticsService';
import toast from 'react-hot-toast';
import '../dashboard/Dashboard.css';

const DATE_PRESETS = [
    { id: 'today', label: 'Today' },
    { id: 'yesterday', label: 'Yesterday' },
    { id: 'this_week', label: 'This Week' },
    { id: 'this_month', label: 'This Month' },
    { id: 'custom', label: 'Custom' },
];

const getPresetDates = (presetId) => {
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

const KpiCard = ({ label, value, sub, color, icon: Icon }) => (
    <div className="kpi-card">
        {Icon && (
            <div style={{ fontSize: 20, color: color || 'var(--color-text-muted)', marginBottom: 4 }}>
                <Icon />
            </div>
        )}
        <div className="kpi-value" style={color ? { color } : {}}>{value}</div>
        <div className="kpi-label">{label}</div>
        {sub && <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 4 }}>{sub}</div>}
    </div>
);

const CustomChartTooltip = ({ active, payload, label }) => {
    if (active && payload && payload.length) {
        const prevVal = payload.find(p => p.dataKey === 'prevQuantity')?.value ?? 0;
        const selVal = payload.find(p => p.dataKey === 'quantity')?.value ?? 0;
        return (
            <div style={{
                background: '#ffffff',
                border: '1px solid #cbd5e1',
                borderRadius: '8px',
                padding: '10px 14px',
                boxShadow: '0 10px 25px -5px rgba(0,0,0,0.15)',
                color: '#1e293b',
                fontSize: '12px',
                minWidth: '170px',
            }}>
                <div style={{ fontWeight: 700, marginBottom: '6px', color: '#0f172a' }}>{label}</div>
                <div style={{ color: '#60a5fa', marginBottom: '2px' }}>Previous Qty : {prevVal}</div>
                <div style={{ color: '#22c55e', fontWeight: 600 }}>Selected Qty : {selVal}</div>
            </div>
        );
    }
    return null;
};

const CustomLeastChartTooltip = ({ active, payload, label }) => {
    if (active && payload && payload.length) {
        const prevVal = payload.find(p => p.dataKey === 'prevQuantity')?.value ?? 0;
        const selVal = payload.find(p => p.dataKey === 'quantity')?.value ?? 0;
        return (
            <div style={{
                background: '#ffffff',
                border: '1px solid #cbd5e1',
                borderRadius: '8px',
                padding: '10px 14px',
                boxShadow: '0 10px 25px -5px rgba(0,0,0,0.15)',
                color: '#1e293b',
                fontSize: '12px',
                minWidth: '170px',
            }}>
                <div style={{ fontWeight: 700, marginBottom: '6px', color: '#0f172a' }}>{label}</div>
                <div style={{ color: '#f472b6', marginBottom: '2px' }}>Previous Qty : {prevVal}</div>
                <div style={{ color: '#ef4444', fontWeight: 600 }}>Selected Qty : {selVal}</div>
            </div>
        );
    }
    return null;
};

const ItemSalesReport = () => {
    const [loading, setLoading] = useState(false);
    const [items, setItems] = useState([]);
    const [categories, setCategories] = useState([]);

    // Filters
    const [datePreset, setDatePreset] = useState('today');
    const [customFrom, setCustomFrom] = useState('');
    const [customTo, setCustomTo] = useState('');
    const [appliedCustomFrom, setAppliedCustomFrom] = useState('');
    const [appliedCustomTo, setAppliedCustomTo] = useState('');
    const [selectedRestaurant, setSelectedRestaurant] = useState('');
    const [restaurantOptions, setRestaurantOptions] = useState([]);
    const [categoryFilter, setCategoryFilter] = useState('all');
    const [selectedItemFilter, setSelectedItemFilter] = useState('all');
    const [searchQuery, setSearchQuery] = useState('');

    const reportRef = useRef(null);

    useEffect(() => {
        fetchRestaurantList().then(setRestaurantOptions).catch(console.error);
    }, []);

    const getFilters = useCallback(() => {
        let filters = {};
        if (datePreset === 'custom') {
            if (appliedCustomFrom) filters.dateFrom = new Date(appliedCustomFrom);
            if (appliedCustomTo) filters.dateTo = endOfDay(new Date(appliedCustomTo));
        } else {
            const { dateFrom, dateTo } = getPresetDates(datePreset);
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

    const loadData = useCallback(async () => {
        setLoading(true);
        try {
            const result = await fetchTopOrderedItems(500, getFilters());
            setItems(result.items);
            setCategories(result.categories);
        } catch (e) {
            toast.error('Failed to load item sales data');
            console.error(e);
        } finally {
            setLoading(false);
        }
    }, [getFilters]);

    useEffect(() => {
        loadData();
    }, [datePreset, appliedCustomFrom, appliedCustomTo, selectedRestaurant]); // eslint-disable-line

    let filteredItems = items;
    if (categoryFilter !== 'all') {
        filteredItems = filteredItems.filter(i => i.category === categoryFilter);
    }
    if (selectedItemFilter !== 'all') {
        filteredItems = filteredItems.filter(i => i.name === selectedItemFilter);
    }
    if (searchQuery) {
        const q = searchQuery.toLowerCase();
        filteredItems = filteredItems.filter(i => i.name.toLowerCase().includes(q));
    }

    const sortedItems = [...filteredItems].sort((a, b) => b.quantity - a.quantity);
    const top10Most = sortedItems.slice(0, 10);
    const top10Least = [...filteredItems].sort((a, b) => a.quantity - b.quantity).slice(0, 10);

    // KPI calculations
    const totalQty = filteredItems.reduce((s, i) => s + i.quantity, 0);
    const totalValue = filteredItems.reduce((s, i) => s + i.value, 0);
    const avgItemValue = filteredItems.length > 0 ? totalValue / filteredItems.length : 0;

    const activePresetLabel = DATE_PRESETS.find(p => p.id === datePreset)?.label || 'Today';

    const handlePdfExport = async () => {
        toast.loading('Generating PDF…', { id: 'pdf' });
        try {
            const { default: jsPDF } = await import('jspdf');
            const { default: autoTable } = await import('jspdf-autotable');
            const doc = new jsPDF({ orientation: 'landscape' });

            doc.setFontSize(16);
            doc.setTextColor(40);
            doc.text('Item Sales Report', 14, 15);

            doc.setFontSize(10);
            doc.setTextColor(100);
            let filterText = `Period: ${activePresetLabel}`;
            if (selectedRestaurant) {
                const rest = restaurantOptions.find(r => r.restaurant_id === selectedRestaurant);
                if (rest) filterText += ` | Restaurant: ${rest.restaurant_name}`;
            }
            if (categoryFilter !== 'all') filterText += ` | Category: ${categoryFilter}`;
            doc.text(filterText, 14, 22);
            doc.text(`Generated: ${new Date().toLocaleDateString('en-GB')} ${new Date().toLocaleTimeString('en-GB')}`, 14, 27);

            autoTable(doc, {
                head: [['#', 'Item Title', 'Price', 'Selected Qty', 'Previous Qty', 'Difference', 'Growth %']],
                body: sortedItems.map((item, i) => [
                    i + 1,
                    item.name,
                    formatCurrency(item.price),
                    item.quantity,
                    item.prevQuantity,
                    item.difference > 0 ? `+${item.difference}` : `${item.difference}`,
                    item.growthPct > 0 ? `+${item.growthPct}%` : `${item.growthPct}%`,
                ]),
                startY: 34,
                styles: { fontSize: 8, cellPadding: 3 },
                headStyles: { fillColor: [253, 232, 237], textColor: [30, 41, 59], fontStyle: 'bold' },
                alternateRowStyles: { fillColor: [250, 250, 250] },
                columnStyles: {
                    0: { cellWidth: 12, halign: 'center' },
                    2: { halign: 'right' },
                    3: { halign: 'right' },
                    4: { halign: 'right' },
                    5: { halign: 'right' },
                    6: { halign: 'right' },
                },
                didDrawPage: (data) => {
                    doc.setFontSize(8);
                    doc.setTextColor(150);
                    doc.text(`Page ${data.pageNumber}`, data.settings.margin.left, doc.internal.pageSize.height - 10);
                    doc.text('Watan Central Kitchen — Item Sales Report', doc.internal.pageSize.width / 2, doc.internal.pageSize.height - 10, { align: 'center' });
                },
            });

            doc.save(`item_sales_report_${new Date().toISOString().slice(0, 10)}.pdf`);
            toast.success('PDF downloaded', { id: 'pdf' });
        } catch (err) {
            console.error('PDF export failed:', err);
            toast.error('PDF export failed', { id: 'pdf' });
        }
    };

    return (
        <div className="reports-page">
            {/* Header */}
            <div className="page-header">
                <div>
                    <h2 className="page-title">Item Sales Report</h2>
                    <p className="page-subtitle">Detailed breakdown of all items ordered across restaurants.</p>
                </div>
                <div style={{ display: 'flex', gap: 12 }}>
                    <button
                        className="btn btn-secondary btn-sm"
                        onClick={handlePdfExport}
                        title="Export as PDF"
                        style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 600 }}
                    >
                        <MdPictureAsPdf /> Download PDF
                    </button>
                </div>
            </div>

            {/* Filter Bar 1 */}
            <div className="dash-filter-bar">
                <div className="dash-filter-section">
                    <MdFilterList className="dash-filter-icon" />
                    <span className="dash-filter-label">Period</span>
                    <div className="dash-filter-presets">
                        {DATE_PRESETS.map(p => (
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

            {/* Filter Bar 2 */}
            <div className="dash-filter-bar" style={{ marginTop: -8 }}>
                <MdFilterList className="dash-filter-icon" />
                <select
                    className="dash-filter-select"
                    value={categoryFilter}
                    onChange={e => setCategoryFilter(e.target.value)}
                >
                    <option value="all">All Categories</option>
                    {categories.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
                <select
                    className="dash-filter-select"
                    value={selectedItemFilter}
                    onChange={e => setSelectedItemFilter(e.target.value)}
                >
                    <option value="all">All Items</option>
                    {items.map(i => <option key={i.name} value={i.name}>{i.name}</option>)}
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

            {loading ? (
                <div style={{ textAlign: 'center', padding: '80px', color: 'var(--color-text-muted)' }}>
                    Loading item sales breakdown…
                </div>
            ) : (
                <div ref={reportRef} style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
                    {/* 4 KPI Summary Cards */}
                    <div className="kpi-row">
                        <KpiCard label="Total Items" value={sortedItems.length} icon={MdCategory} />
                        <KpiCard label="Total Quantity" value={totalQty.toFixed(2)} icon={MdShoppingCart} />
                        <KpiCard label="Total Revenue" value={formatCurrency(totalValue)} color="#c9a96e" icon={MdTrendingUp} />
                        <KpiCard label="Avg Item Value" value={formatCurrency(avgItemValue)} color="#3b82f6" />
                    </div>

                    {/* Item Sales Table in Scrollable Container */}
                    <div className="card" style={{ padding: 0, overflow: 'hidden', borderRadius: '16px' }}>
                        <div style={{
                            maxHeight: '440px',
                            overflowY: 'auto',
                            overflowX: 'auto',
                        }}>
                            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px', textAlign: 'left' }}>
                                <thead>
                                    <tr style={{
                                        background: '#fde8ed', // Soft pink theme header matching screenshot
                                        position: 'sticky',
                                        top: 0,
                                        zIndex: 10,
                                        boxShadow: '0 2px 4px rgba(0,0,0,0.06)',
                                    }}>
                                        <th style={{ padding: '14px 20px', color: '#1e293b', fontWeight: 700 }}>Item Title</th>
                                        <th style={{ padding: '14px 20px', color: '#1e293b', fontWeight: 700, textAlign: 'right' }}>Price</th>
                                        <th style={{ padding: '14px 20px', color: '#1e293b', fontWeight: 700, textAlign: 'right' }}>Selected Qty</th>
                                        <th style={{ padding: '14px 20px', color: '#1e293b', fontWeight: 700, textAlign: 'right' }}>Previous Qty</th>
                                        <th style={{ padding: '14px 20px', color: '#1e293b', fontWeight: 700, textAlign: 'right' }}>Difference</th>
                                        <th style={{ padding: '14px 20px', color: '#1e293b', fontWeight: 700, textAlign: 'right' }}>Growth %</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {sortedItems.length === 0 ? (
                                        <tr>
                                            <td colSpan={6} style={{ textAlign: 'center', padding: '40px', color: 'var(--color-text-muted)' }}>
                                                No items found for the selected filters.
                                            </td>
                                        </tr>
                                    ) : (
                                        sortedItems.map((item, idx) => {
                                            const isDiffPos = item.difference > 0;
                                            const isDiffNeg = item.difference < 0;
                                            const isGrowthPos = item.growthPct > 0;
                                            const isGrowthNeg = item.growthPct < 0;

                                            return (
                                                <tr
                                                    key={item.name + idx}
                                                    style={{
                                                        borderBottom: '1px solid var(--color-border-light, rgba(255,255,255,0.06))',
                                                    }}
                                                >
                                                    {/* Item Title */}
                                                    <td style={{ padding: '14px 20px', fontWeight: 500, color: 'var(--color-text-primary)' }}>
                                                        {item.name}
                                                    </td>

                                                    {/* Price */}
                                                    <td style={{ padding: '14px 20px', textAlign: 'right', color: 'var(--color-text-secondary)' }}>
                                                        {formatCurrency(item.price)}
                                                    </td>

                                                    {/* Selected Qty */}
                                                    <td style={{ padding: '14px 20px', textAlign: 'right', fontWeight: 700, color: '#d9534f' }}>
                                                        {item.quantity}
                                                    </td>

                                                    {/* Previous Qty */}
                                                    <td style={{ padding: '14px 20px', textAlign: 'right', color: 'var(--color-text-muted)' }}>
                                                        {item.prevQuantity}
                                                    </td>

                                                    {/* Difference */}
                                                    <td style={{ padding: '14px 20px', textAlign: 'right', fontWeight: 600 }}>
                                                        {isDiffPos && <span style={{ color: '#22c55e' }}>↗ +{item.difference}</span>}
                                                        {isDiffNeg && <span style={{ color: '#ef4444' }}>↘ {item.difference}</span>}
                                                        {!isDiffPos && !isDiffNeg && <span style={{ color: 'var(--color-text-muted)' }}>— 0</span>}
                                                    </td>

                                                    {/* Growth % */}
                                                    <td style={{ padding: '14px 20px', textAlign: 'right', fontWeight: 600 }}>
                                                        {isGrowthPos && <span style={{ color: '#22c55e' }}>+{item.growthPct}%</span>}
                                                        {isGrowthNeg && <span style={{ color: '#ef4444' }}>{item.growthPct}%</span>}
                                                        {!isGrowthPos && !isGrowthNeg && <span style={{ color: 'var(--color-text-muted)' }}>0%</span>}
                                                    </td>
                                                </tr>
                                            );
                                        })
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>

                    {/* Dual Comparative Bar Charts Section */}
                    <div style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(auto-fit, minmax(460px, 1fr))',
                        gap: '24px',
                    }}>
                        {/* 🔥 Top 10 Most Ordered Items */}
                        <div className="card" style={{ padding: '20px' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '16px' }}>
                                <div>
                                    <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: 'var(--color-text-primary)', display: 'flex', alignItems: 'center', gap: 6 }}>
                                        <span>🔥</span> Top 10 Most Ordered Items
                                    </h3>
                                    <p style={{ margin: '4px 0 0', fontSize: '12px', color: 'var(--color-text-muted)' }}>
                                        Based on: {activePresetLabel}
                                    </p>
                                </div>
                            </div>

                            <div style={{ width: '100%', height: 350 }}>
                                <ResponsiveContainer>
                                    <BarChart data={top10Most} margin={{ top: 10, right: 10, left: -20, bottom: 85 }}>
                                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" />
                                        <XAxis
                                            dataKey="name"
                                            interval={0}
                                            angle={-45}
                                            textAnchor="end"
                                            height={85}
                                            tick={{ fontSize: 10, fill: 'var(--color-text-muted)' }}
                                        />
                                        <YAxis tick={{ fontSize: 11, fill: 'var(--color-text-muted)' }} />
                                        <Tooltip content={<CustomChartTooltip />} />
                                        <Legend
                                            verticalAlign="top"
                                            align="right"
                                            height={30}
                                            iconType="square"
                                            wrapperStyle={{ fontSize: '12px', paddingBottom: '10px' }}
                                        />
                                        <Bar dataKey="prevQuantity" fill="#70bbfd" radius={[4, 4, 0, 0]} name="Previous Qty" barSize={14} />
                                        <Bar dataKey="quantity" fill="#42bb68" radius={[4, 4, 0, 0]} name="Selected Qty" barSize={14} />
                                    </BarChart>
                                </ResponsiveContainer>
                            </div>
                        </div>

                        {/* 📉 Top 10 Least Selling Items */}
                        <div className="card" style={{ padding: '20px' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '16px' }}>
                                <div>
                                    <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: 'var(--color-text-primary)', display: 'flex', alignItems: 'center', gap: 6 }}>
                                        <span>📉</span> Top 10 Least Selling Items
                                    </h3>
                                    <p style={{ margin: '4px 0 0', fontSize: '12px', color: 'var(--color-text-muted)' }}>
                                        Based on: {activePresetLabel}
                                    </p>
                                </div>
                            </div>

                            <div style={{ width: '100%', height: 350 }}>
                                <ResponsiveContainer>
                                    <BarChart data={top10Least} margin={{ top: 10, right: 10, left: -20, bottom: 85 }}>
                                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" />
                                        <XAxis
                                            dataKey="name"
                                            interval={0}
                                            angle={-45}
                                            textAnchor="end"
                                            height={85}
                                            tick={{ fontSize: 10, fill: 'var(--color-text-muted)' }}
                                        />
                                        <YAxis tick={{ fontSize: 11, fill: 'var(--color-text-muted)' }} />
                                        <Tooltip content={<CustomLeastChartTooltip />} />
                                        <Legend
                                            verticalAlign="top"
                                            align="right"
                                            height={30}
                                            iconType="square"
                                            wrapperStyle={{ fontSize: '12px', paddingBottom: '10px' }}
                                        />
                                        <Bar dataKey="prevQuantity" fill="#fbcfe8" radius={[4, 4, 0, 0]} name="Previous Qty" barSize={14} />
                                        <Bar dataKey="quantity" fill="#ef4444" radius={[4, 4, 0, 0]} name="Selected Qty" barSize={14} />
                                    </BarChart>
                                </ResponsiveContainer>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default ItemSalesReport;
