import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
    MdFilterList, MdSearch, MdPictureAsPdf,
    MdTrendingUp, MdShoppingCart, MdCategory,
} from 'react-icons/md';
import {
    fetchTopOrderedItems,
    fetchRestaurantList,
    formatCurrency,
    startOfDay,
    endOfDay,
} from '../../services/analyticsService';
import toast from 'react-hot-toast';
import '../dashboard/Dashboard.css';

const CHART_COLORS = ['#c9a96e', '#3b82f6', '#22c55e', '#f59e0b', '#8b5cf6', '#ef4444', '#14b8a6', '#f97316'];

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

const ItemSalesReport = () => {
    const [loading, setLoading] = useState(false);
    const [items, setItems] = useState([]);
    const [categories, setCategories] = useState([]);

    // Filters
    const [datePreset, setDatePreset] = useState('this_month');
    const [customFrom, setCustomFrom] = useState('');
    const [customTo, setCustomTo] = useState('');
    const [appliedCustomFrom, setAppliedCustomFrom] = useState('');
    const [appliedCustomTo, setAppliedCustomTo] = useState('');
    const [selectedRestaurant, setSelectedRestaurant] = useState('');
    const [restaurantOptions, setRestaurantOptions] = useState([]);
    const [categoryFilter, setCategoryFilter] = useState('all');
    const [searchQuery, setSearchQuery] = useState('');

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

    // Reload on filter change
    useEffect(() => {
        loadData();
    }, [datePreset, appliedCustomFrom, appliedCustomTo, selectedRestaurant]); // eslint-disable-line

    // Apply client-side filters
    let filteredItems = items;
    if (categoryFilter !== 'all') {
        filteredItems = filteredItems.filter(i => i.category === categoryFilter);
    }
    if (searchQuery) {
        const q = searchQuery.toLowerCase();
        filteredItems = filteredItems.filter(i => i.name.toLowerCase().includes(q));
    }

    // Sort by value (revenue) descending
    const sortedItems = [...filteredItems].sort((a, b) => b.value - a.value);

    // KPI calculations
    const totalQty = filteredItems.reduce((s, i) => s + i.quantity, 0);
    const totalValue = filteredItems.reduce((s, i) => s + i.value, 0);
    const avgItemValue = filteredItems.length > 0 ? totalValue / filteredItems.length : 0;

    // PDF Export
    const handlePdfExport = async () => {
        toast.loading('Generating PDF…', { id: 'pdf' });
        try {
            const { default: jsPDF } = await import('jspdf');
            const { default: autoTable } = await import('jspdf-autotable');
            const doc = new jsPDF({ orientation: 'landscape' });

            // Title
            doc.setFontSize(16);
            doc.setTextColor(40);
            doc.text('Item Sales Report', 14, 15);

            // Subtitle with filter info
            doc.setFontSize(10);
            doc.setTextColor(100);
            const preset = DATE_PRESETS.find(p => p.id === datePreset);
            let filterText = `Period: ${preset?.label || datePreset}`;
            if (selectedRestaurant) {
                const rest = restaurantOptions.find(r => r.restaurant_id === selectedRestaurant);
                if (rest) filterText += ` | Restaurant: ${rest.restaurant_name}`;
            }
            if (categoryFilter !== 'all') filterText += ` | Category: ${categoryFilter}`;
            doc.text(filterText, 14, 22);
            doc.text(`Generated: ${new Date().toLocaleDateString('en-GB')} ${new Date().toLocaleTimeString('en-GB')}`, 14, 27);

            // Summary KPIs
            doc.setFontSize(10);
            doc.setTextColor(40);
            doc.text(`Total Items: ${sortedItems.length}  |  Total Quantity: ${totalQty.toFixed(2)}  |  Total Revenue: ${formatCurrency(totalValue)}  |  Avg Item Value: ${formatCurrency(avgItemValue)}`, 14, 35);

            // Table
            autoTable(doc, {
                head: [['#', 'Item Name', 'Category', 'Quantity Ordered', 'Unit Price', 'Total Value', '% Revenue']],
                body: sortedItems.map((item, i) => [
                    i + 1,
                    item.name,
                    item.category || '—',
                    `${item.quantity.toFixed(2)} ${item.unit || 'units'}`,
                    item.quantity > 0 ? formatCurrency(item.value / item.quantity) : '—',
                    formatCurrency(item.value),
                    totalValue > 0 ? `${Math.round(item.value / totalValue * 100)}%` : '0%',
                ]),
                startY: 42,
                styles: { fontSize: 8, cellPadding: 3 },
                headStyles: { fillColor: [201, 169, 110], textColor: [255, 255, 255], fontStyle: 'bold' },
                alternateRowStyles: { fillColor: [245, 245, 245] },
                columnStyles: {
                    0: { cellWidth: 12, halign: 'center' },
                    3: { halign: 'right' },
                    4: { halign: 'right' },
                    5: { halign: 'right' },
                    6: { halign: 'right' },
                },
                didDrawPage: (data) => {
                    // Footer
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

            {/* Filter Bar */}
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

            {/* Item Filters */}
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
                <div style={{ textAlign: 'center', padding: 80, color: 'var(--color-text-muted)' }}>
                    Loading item sales data…
                </div>
            ) : (
                <div ref={reportRef} style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
                    {/* KPI Cards */}
                    <div className="kpi-row">
                        <KpiCard label="Total Items" value={sortedItems.length} icon={MdCategory} />
                        <KpiCard label="Total Quantity" value={totalQty.toFixed(2)} icon={MdShoppingCart} />
                        <KpiCard label="Total Revenue" value={formatCurrency(totalValue)} color="#c9a96e" icon={MdTrendingUp} />
                        <KpiCard label="Avg Item Value" value={formatCurrency(avgItemValue)} color="#3b82f6" />
                    </div>

                    {/* Sales Table */}
                    {sortedItems.length === 0 ? (
                        <div className="card">
                            <div className="empty-state" style={{ padding: 60 }}>
                                <div className="empty-state-icon">📊</div>
                                <div className="empty-state-title">No Item Sales Data</div>
                                <div className="empty-state-description">No orders found for the selected filters. Try adjusting the date range or restaurant filter.</div>
                            </div>
                        </div>
                    ) : (
                        <div className="card">
                            <div className="card-header">
                                <h3>Item Sales Breakdown</h3>
                                <span className="badge badge-muted">{sortedItems.length} items</span>
                            </div>
                            <div className="data-table-wrapper" style={{ border: 'none', borderRadius: 0 }}>
                                <table className="data-table">
                                    <thead>
                                        <tr>
                                            <th>#</th>
                                            <th>Item Name</th>
                                            <th>Category</th>
                                            <th>Quantity Ordered</th>
                                            <th>Unit Price</th>
                                            <th>Total Value</th>
                                            <th>% of Revenue</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {sortedItems.map((item, i) => {
                                            const pct = totalValue > 0 ? Math.round(item.value / totalValue * 100) : 0;
                                            const unitPrice = item.quantity > 0 ? item.value / item.quantity : 0;
                                            return (
                                                <tr key={item.name}>
                                                    <td style={{ color: 'var(--color-text-muted)', fontWeight: 700 }}>{i + 1}</td>
                                                    <td style={{ fontWeight: 600 }}>{item.name}</td>
                                                    <td style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>{item.category || '—'}</td>
                                                    <td>{item.quantity.toFixed(2)} {item.unit || 'units'}</td>
                                                    <td style={{ color: 'var(--color-text-secondary)' }}>{formatCurrency(unitPrice)}</td>
                                                    <td style={{ fontWeight: 700, color: '#c9a96e' }}>{formatCurrency(item.value)}</td>
                                                    <td>
                                                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                                            <div style={{ flex: 1, height: 6, background: 'var(--color-border)', borderRadius: 3 }}>
                                                                <div style={{
                                                                    width: `${pct}%`,
                                                                    height: '100%',
                                                                    background: CHART_COLORS[i % CHART_COLORS.length],
                                                                    borderRadius: 3,
                                                                    transition: 'width 0.3s ease',
                                                                }} />
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
                    )}
                </div>
            )}
        </div>
    );
};

export default ItemSalesReport;
