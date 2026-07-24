import React, { useState, useMemo, useEffect } from 'react';
import { buildEposSalesMatrix, getEposFilterOptions } from '../../utils/eposSalesMatrix';

const MENU_CATEGORY_LABELS = {
    starters: 'Starters', seafood: 'Seafood', grill: 'Grill & Kebabs',
    platters: 'Platters', karahi: 'Karahi & Curries', rice: 'Rice',
    breads: 'Breads & Sides', desserts: 'Desserts', beverages: 'Beverages',
};
const MODEL_LABELS = {
    bulk_curry: 'Curry', biryani: 'Biryani', combo: 'Combo',
    grill: 'Grill', platter: 'Platter', side: 'Side',
};

const fmt = (n, d = 2) => (Number(n) || 0).toFixed(d);
const fmtQty = (n, unit) => `${fmt(n, 3).replace(/\.?0+$/, '')} ${unit || ''}`.trim();

/**
 * Format a quantity with dual-unit display when unit_conversion is available.
 * e.g. "1.65 packs (50 units)" or just "5.5 kg" if no conversion.
 */
const fmtDualUnit = (quantity, row) => {
    const q = Number(quantity) || 0;
    const unit = row.unit || '';
    const primary = fmtQty(q, unit);
    if (!row.unit_conversion?.has_conversion || !row.base_unit) return primary;
    const baseFactor = row.unit_conversion.base_factor || 1;
    let rawBase = Math.round(q * baseFactor * 100) / 100;
    let baseUnit = row.base_unit;
    // Smart format: g→kg, ml→l when ≥1000
    if (baseUnit === 'g' && Math.abs(rawBase) >= 1000) { rawBase = Math.round(rawBase / 10) / 100; baseUnit = 'kg'; }
    if (baseUnit === 'ml' && Math.abs(rawBase) >= 1000) { rawBase = Math.round(rawBase / 10) / 100; baseUnit = 'l'; }
    return `${primary} (${fmtQty(rawBase, baseUnit)})`;
};

// ── Pagination component ──────────────────────────────────────────────────────
function Pagination({ total, page, pageSize, onPage, onPageSize }) {
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const start = total === 0 ? 0 : (page - 1) * pageSize + 1;
    const end = Math.min(page * pageSize, total);
    return (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 16px', borderTop: '1px solid var(--color-border, rgba(255,255,255,0.08))', flexWrap: 'wrap', gap: 8 }}>
            <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
                {total === 0 ? '0 rows' : `${start}–${end} of ${total} rows`}
            </span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>Rows per page:</span>
                <select value={pageSize} onChange={e => { onPageSize(Number(e.target.value)); onPage(1); }} style={pgSelectStyle}>
                    {[25, 50, 100].map(s => <option key={s} value={s}>{s}</option>)}
                </select>
                <button onClick={() => onPage(1)} disabled={page === 1} style={pgBtnStyle}>«</button>
                <button onClick={() => onPage(page - 1)} disabled={page === 1} style={pgBtnStyle}>‹</button>
                <span style={{ fontSize: 12, color: 'var(--color-text)', minWidth: 60, textAlign: 'center' }}>
                    {page} / {totalPages}
                </span>
                <button onClick={() => onPage(page + 1)} disabled={page >= totalPages} style={pgBtnStyle}>›</button>
                <button onClick={() => onPage(totalPages)} disabled={page >= totalPages} style={pgBtnStyle}>»</button>
            </div>
        </div>
    );
}

export default function EposSalesTable({ eposEvents, menuItems, inventoryItems }) {
    const [activeTab, setActiveTab] = useState('menu');
    const [menuSearch, setMenuSearch] = useState('');
    const [menuCategory, setMenuCategory] = useState('');
    const [menuModel, setMenuModel] = useState('');
    const [invSearch, setInvSearch] = useState('');
    const [invCategory, setInvCategory] = useState('');
    const [invType, setInvType] = useState('');

    // Sort state — default: Category asc
    const [menuSort, setMenuSort] = useState({ key: 'menu_item_category', dir: 'asc' });
    const [invSort, setInvSort] = useState({ key: 'category_name', dir: 'asc' });

    // Pagination state — separate per tab
    const [menuPage, setMenuPage] = useState(1);
    const [menuPageSize, setMenuPageSize] = useState(25);
    const [invPage, setInvPage] = useState(1);
    const [invPageSize, setInvPageSize] = useState(25);

    // Reset pages when filters change
    useEffect(() => { setMenuPage(1); }, [menuSearch, menuCategory, menuModel]);
    useEffect(() => { setInvPage(1); }, [invSearch, invCategory, invType]);

    const { menuSalesRows, inventoryRows } = useMemo(
        () => buildEposSalesMatrix(eposEvents, menuItems, inventoryItems),
        [eposEvents, menuItems, inventoryItems]
    );
    const { menuCategories, menuModels, invCategories, invTypes } = useMemo(
        () => getEposFilterOptions(menuSalesRows, inventoryRows),
        [menuSalesRows, inventoryRows]
    );

    // Full filtered sets — used for exports and totals
    const filteredMenu = useMemo(() => {
        const s = menuSearch.toLowerCase();
        return menuSalesRows.filter(r =>
            (!s || r.menu_item_name.toLowerCase().includes(s)) &&
            (!menuCategory || r.menu_item_category === menuCategory) &&
            (!menuModel || r.menu_item_model === menuModel)
        );
    }, [menuSalesRows, menuSearch, menuCategory, menuModel]);

    const filteredInv = useMemo(() => {
        const s = invSearch.toLowerCase();
        return inventoryRows.filter(r =>
            (!s || r.item_name.toLowerCase().includes(s)) &&
            (!invCategory || r.category_name === invCategory) &&
            (!invType || r.item_type === invType)
        );
    }, [inventoryRows, invSearch, invCategory, invType]);

    // ── Sort helpers ─────────────────────────────────────────────────────────
    const applySort = (rows, { key, dir }) => {
        if (!key) return rows;
        return [...rows].sort((a, b) => {
            const av = a[key] ?? '';
            const bv = b[key] ?? '';
            const cmp = typeof av === 'number' && typeof bv === 'number'
                ? av - bv
                : String(av).localeCompare(String(bv), undefined, { sensitivity: 'base' });
            return dir === 'asc' ? cmp : -cmp;
        });
    };

    const toggleSort = (isMenu, colKey) => {
        if (isMenu) {
            setMenuSort(prev => ({ key: colKey, dir: prev.key === colKey && prev.dir === 'asc' ? 'desc' : 'asc' }));
            setMenuPage(1);
        } else {
            setInvSort(prev => ({ key: colKey, dir: prev.key === colKey && prev.dir === 'asc' ? 'desc' : 'asc' }));
            setInvPage(1);
        }
    };

    const sortIcon = (sort, colKey) => {
        if (sort.key !== colKey) return <span style={{ opacity: 0.3, marginLeft: 4 }}>⇅</span>;
        return <span style={{ marginLeft: 4 }}>{sort.dir === 'asc' ? '▲' : '▼'}</span>;
    };

    // Sorted full sets — used for pagination display AND exports
    // eslint-disable-next-line react-hooks/exhaustive-deps
    const sortedMenu = useMemo(() => applySort(filteredMenu, menuSort), [filteredMenu, menuSort]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    const sortedInv = useMemo(() => applySort(filteredInv, invSort), [filteredInv, invSort]);

    // Paginated slices from sorted data
    const pagedMenu = useMemo(() => sortedMenu.slice((menuPage - 1) * menuPageSize, menuPage * menuPageSize), [sortedMenu, menuPage, menuPageSize]);
    const pagedInv = useMemo(() => sortedInv.slice((invPage - 1) * invPageSize, invPage * invPageSize), [sortedInv, invPage, invPageSize]);

    // Totals always on full filtered set
    const menuTotals = useMemo(() => ({
        qtySold: filteredMenu.reduce((s, r) => s + r.qty_sold, 0),
        revenue: filteredMenu.reduce((s, r) => s + r.epos_revenue, 0),
    }), [filteredMenu]);
    const invTotals = useMemo(() => ({
        value: filteredInv.reduce((s, r) => s + r.consumption_value, 0),
        stockValue: filteredInv.reduce((s, r) => s + r.stock_value, 0),
    }), [filteredInv]);

    // ── Exports (always full sorted+filtered data) ───────────────────────────
    const triggerDownload = (blob, filename) => {
        // Edge / IE fallback
        if (window.navigator && window.navigator.msSaveOrOpenBlob) {
            window.navigator.msSaveOrOpenBlob(blob, filename);
            return;
        }
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.setAttribute('href', url);
        link.setAttribute('download', filename);
        link.style.visibility = 'hidden';
        link.style.position = 'absolute';
        link.style.left = '-9999px';
        document.body.appendChild(link);
        link.click();
        // Cleanup after a short delay
        setTimeout(() => {
            document.body.removeChild(link);
            URL.revokeObjectURL(url);
        }, 500);
    };

    const exportCSV = (rows, filename, headers, rowFn) => {
        if (!rows || rows.length === 0) {
            alert('No data to export');
            return;
        }
        const csvContent = [
            headers.join(','),
            ...rows.map(r => rowFn(r).map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(','))
        ].join('\n');
        const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
        triggerDownload(blob, `${filename}_${new Date().toISOString().slice(0, 10)}.csv`);
    };
    const exportMenuCSV = () => exportCSV(sortedMenu, 'epos_menu_sales',
        ['Item', 'Portion', 'Category', 'Model', 'Qty Sold', 'Menu Price (£)', 'EPOS Revenue (£)', 'Recipe Cost (£)', 'Markup (£)', 'Markup %', 'Status'],
        r => [r.menu_item_name, r.portion_name, MENU_CATEGORY_LABELS[r.menu_item_category] || r.menu_item_category,
            MODEL_LABELS[r.menu_item_model] || r.menu_item_model, r.qty_sold,
            fmt(r.portion_selling_price), fmt(r.epos_revenue), fmt(r.portion_cost_price),
            r.markup != null ? fmt(r.markup) : '', r.markup_pct != null ? fmt(r.markup_pct, 1) + '%' : '', r.status]);
    const exportInvCSV = () => exportCSV(sortedInv, 'epos_inventory_consumption',
        ['Item', 'Category', 'Type', 'Consumed', 'Unit', 'Inv Cost (£)', 'Inv Sell (£)', 'Consumption Value (£)', 'Current Stock', 'Stock Value (£)', 'Risk'],
        r => [r.item_name, r.category_name, r.item_type, fmt(r.total_consumed, 3), r.unit,
            fmt(r.cost_price), fmt(r.selling_price), fmt(r.consumption_value), fmt(r.current_stock, 3), fmt(r.stock_value), r.depletion_risk]);

    const exportExcel = async (isMenu) => {
        try {
            const XLSX = await import('xlsx');
            const rows = isMenu ? sortedMenu : sortedInv;
            const data = rows.map(r => isMenu ? ({
                'Item': r.menu_item_name, 'Portion': r.portion_name,
                'Category': MENU_CATEGORY_LABELS[r.menu_item_category] || r.menu_item_category,
                'Model': MODEL_LABELS[r.menu_item_model] || r.menu_item_model,
                'Qty Sold': r.qty_sold, 'Menu Price (£)': +fmt(r.portion_selling_price),
                'EPOS Revenue (£)': +fmt(r.epos_revenue), 'Recipe Cost (£)': +fmt(r.portion_cost_price),
                'Markup (£)': r.markup != null ? +fmt(r.markup) : '',
                'Markup %': r.markup_pct != null ? +fmt(r.markup_pct, 1) : '', 'Status': r.status,
            }) : ({
                'Item': r.item_name, 'Category': r.category_name, 'Type': r.item_type,
                'Consumed': +fmt(r.total_consumed, 3), 'Unit': r.unit,
                'Inv Cost (£)': +fmt(r.cost_price), 'Inv Sell (£)': +fmt(r.selling_price),
                'Consumption Value (£)': +fmt(r.consumption_value),
                'Current Stock': +fmt(r.current_stock, 3), 'Stock Value (£)': +fmt(r.stock_value),
                'Risk': r.depletion_risk,
            }));
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data), isMenu ? 'Menu Sales' : 'Inventory');
            const wbOut = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
            const xlBlob = new Blob([wbOut], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
            triggerDownload(xlBlob, `epos_${isMenu ? 'menu' : 'inventory'}_${new Date().toISOString().slice(0, 10)}.xlsx`);
        } catch (err) {
            console.error('Excel export failed:', err);
            alert('Excel export failed. Make sure xlsx is installed: npm install xlsx');
        }
    };

    const exportPDF = async (isMenu) => {
        try {
            const { default: jsPDF } = await import('jspdf');
            const { default: autoTable } = await import('jspdf-autotable');
            const doc = new jsPDF({ orientation: 'landscape' });
            doc.text(`EPOS ${isMenu ? 'Menu Sales' : 'Inventory Consumption'} — ${new Date().toLocaleDateString()}`, 14, 10);
            if (isMenu) {
                autoTable(doc, {
                    head: [['Item', 'Portion', 'Category', 'Qty', 'Menu £', 'Revenue £', 'Markup £', 'Markup %', 'Status']],
                    body: sortedMenu.map(r => [r.menu_item_name, r.portion_name,
                        MENU_CATEGORY_LABELS[r.menu_item_category] || r.menu_item_category,
                        r.qty_sold, fmt(r.portion_selling_price), fmt(r.epos_revenue),
                        r.markup != null ? fmt(r.markup) : '—', r.markup_pct != null ? `${fmt(r.markup_pct, 1)}%` : '—', r.status]),
                    startY: 20, styles: { fontSize: 8 },
                });
            } else {
                autoTable(doc, {
                    head: [['Item', 'Category', 'Type', 'Consumed', 'Unit', 'Inv Sell £', 'Consumed Value £', 'Stock', 'Stock Value £', 'Risk']],
                    body: sortedInv.map(r => [r.item_name, r.category_name, r.item_type,
                        fmt(r.total_consumed, 3), r.unit, fmt(r.selling_price),
                        fmt(r.consumption_value), fmt(r.current_stock, 3), fmt(r.stock_value), r.depletion_risk]),
                    startY: 20, styles: { fontSize: 8 },
                });
            }
            const pdfBlob = doc.output('blob');
            triggerDownload(pdfBlob, `epos_${isMenu ? 'menu' : 'inventory'}_${new Date().toISOString().slice(0, 10)}.pdf`);
        } catch (err) {
            console.error('PDF export failed:', err);
            alert('PDF export failed. Make sure jspdf and jspdf-autotable are installed.');
        }
    };

    // ── Badges ───────────────────────────────────────────────────────────────
    const riskBadge = risk => {
        const map = { out: ['#ef4444', 'Out of Stock'], low: ['#f59e0b', 'Low Stock'], ok: ['#22c55e', 'OK'] };
        const [bg, label] = map[risk] || map.ok;
        return <span style={{ background: bg, color: '#fff', borderRadius: 4, padding: '2px 7px', fontSize: 11, fontWeight: 600 }}>{label}</span>;
    };
    const statusBadge = status => status === 'unmapped'
        ? <span style={{ background: '#f59e0b22', color: '#f59e0b', border: '1px solid #f59e0b55', borderRadius: 4, padding: '2px 7px', fontSize: 11, fontWeight: 600 }}>Unmapped</span>
        : <span style={{ background: '#22c55e22', color: '#22c55e', border: '1px solid #22c55e55', borderRadius: 4, padding: '2px 7px', fontSize: 11, fontWeight: 600 }}>Tracked</span>;

    const tabStyle = tab => ({
        padding: '8px 20px', borderRadius: 6, cursor: 'pointer', fontWeight: 600, fontSize: 13,
        background: activeTab === tab ? 'var(--color-accent, #c9a96e)' : 'transparent',
        color: activeTab === tab ? '#fff' : 'var(--color-text-muted)',
        border: activeTab === tab ? 'none' : '1px solid var(--color-border, rgba(255,255,255,0.1))',
        transition: 'all 0.2s',
    });

    const exportBar = isMenu => (
        <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={isMenu ? exportMenuCSV : exportInvCSV} style={exportBtnStyle}>⬇ CSV</button>
            <button onClick={() => exportExcel(isMenu)} style={exportBtnStyle}>⬇ Excel</button>
            <button onClick={() => exportPDF(isMenu)} style={exportBtnStyle}>⬇ PDF</button>
        </div>
    );

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {/* Tabs */}
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <button style={tabStyle('menu')} onClick={() => setActiveTab('menu')}>🍽 Menu Item Sales</button>
                <button style={tabStyle('inv')} onClick={() => setActiveTab('inv')}>📦 Inventory Consumption</button>
            </div>

            {/* ── TAB: Menu Sales ── */}
            {activeTab === 'menu' && (
                <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                    <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--color-border, rgba(255,255,255,0.08))', display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
                        <input placeholder="Search item…" value={menuSearch} onChange={e => setMenuSearch(e.target.value)} style={filterInputStyle} />
                        <select value={menuCategory} onChange={e => setMenuCategory(e.target.value)} style={filterInputStyle}>
                            <option value="">All Categories</option>
                            {menuCategories.map(c => <option key={c} value={c}>{MENU_CATEGORY_LABELS[c] || c}</option>)}
                        </select>
                        <select value={menuModel} onChange={e => setMenuModel(e.target.value)} style={filterInputStyle}>
                            <option value="">All Types</option>
                            {menuModels.map(m => <option key={m} value={m}>{MODEL_LABELS[m] || m}</option>)}
                        </select>
                        <div style={{ marginLeft: 'auto' }}>{exportBar(true)}</div>
                    </div>
                    <div style={{ padding: '10px 16px', background: 'rgba(201,169,110,0.08)', borderBottom: '1px solid var(--color-border, rgba(255,255,255,0.06))', display: 'flex', gap: 24 }}>
                        <span style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>{filteredMenu.length} items</span>
                        <span style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>Total Qty: <strong style={{ color: 'var(--color-text)' }}>{menuTotals.qtySold}</strong></span>
                        <span style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>EPOS Revenue: <strong style={{ color: '#22c55e' }}>£{fmt(menuTotals.revenue)}</strong></span>
                    </div>
                    <div style={{ overflowX: 'auto' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                            <thead>
                                <tr style={{ background: 'rgba(255,255,255,0.03)' }}>
                                    {[
                                        { label: 'Menu Item', key: 'menu_item_name' },
                                        { label: 'Portion', key: 'portion_name' },
                                        { label: 'Category', key: 'menu_item_category' },
                                        { label: 'Type', key: 'menu_item_model' },
                                        { label: 'Qty Sold', key: 'qty_sold' },
                                        { label: 'Menu Price', key: 'portion_selling_price' },
                                        { label: 'EPOS Revenue', key: 'epos_revenue' },
                                        { label: 'Recipe Cost', key: 'portion_cost_price' },
                                        { label: 'Markup', key: 'markup' },
                                        { label: 'Markup %', key: 'markup_pct' },
                                        { label: 'Status', key: 'status' },
                                    ].map(({ label, key }) => (
                                        <th key={key} style={{ ...thStyle, cursor: 'pointer', userSelect: 'none' }}
                                            onClick={() => toggleSort(true, key)}>
                                            {label}{sortIcon(menuSort, key)}</th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {pagedMenu.length === 0 ? (
                                    <tr><td colSpan={11} style={{ textAlign: 'center', padding: 32, color: 'var(--color-text-muted)', fontSize: 13 }}>No sales data for this filter</td></tr>
                                ) : pagedMenu.map(r => (
                                    <tr key={r.key} style={{ borderBottom: '1px solid var(--color-border, rgba(255,255,255,0.06))', transition: 'background 0.15s' }}
                                        onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.03)'}
                                        onMouseLeave={e => e.currentTarget.style.background = ''}>
                                        <td style={tdStyle}><strong>{r.menu_item_name}</strong></td>
                                        <td style={tdStyle}>{r.portion_name}</td>
                                        <td style={tdStyle}>{MENU_CATEGORY_LABELS[r.menu_item_category] || r.menu_item_category || '—'}</td>
                                        <td style={tdStyle}>{MODEL_LABELS[r.menu_item_model] || r.menu_item_model || '—'}</td>
                                        <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 600 }}>{r.qty_sold}</td>
                                        <td style={{ ...tdStyle, textAlign: 'right' }}>{r.portion_selling_price > 0 ? `£${fmt(r.portion_selling_price)}` : '—'}</td>
                                        <td style={{ ...tdStyle, textAlign: 'right', color: '#22c55e', fontWeight: 600 }}>£{fmt(r.epos_revenue)}</td>
                                        <td style={{ ...tdStyle, textAlign: 'right' }}>{r.portion_cost_price > 0 ? `£${fmt(r.portion_cost_price)}` : '—'}</td>
                                        <td style={{ ...tdStyle, textAlign: 'right', color: r.markup > 0 ? '#22c55e' : r.markup < 0 ? '#ef4444' : undefined }}>{r.markup != null ? `£${fmt(r.markup)}` : '—'}</td>
                                        <td style={{ ...tdStyle, textAlign: 'right' }}>{r.markup_pct != null ? `${fmt(r.markup_pct, 1)}%` : '—'}</td>
                                        <td style={tdStyle}>{statusBadge(r.status)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                    <Pagination total={filteredMenu.length} page={menuPage} pageSize={menuPageSize} onPage={setMenuPage} onPageSize={setMenuPageSize} />
                </div>
            )}

            {/* ── TAB: Inventory Consumption ── */}
            {activeTab === 'inv' && (
                <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                    <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--color-border, rgba(255,255,255,0.08))', display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
                        <input placeholder="Search item…" value={invSearch} onChange={e => setInvSearch(e.target.value)} style={filterInputStyle} />
                        <select value={invCategory} onChange={e => setInvCategory(e.target.value)} style={filterInputStyle}>
                            <option value="">All Categories</option>
                            {invCategories.map(c => <option key={c} value={c}>{c}</option>)}
                        </select>
                        <select value={invType} onChange={e => setInvType(e.target.value)} style={filterInputStyle}>
                            <option value="">All Types</option>
                            {invTypes.map(t => <option key={t} value={t}>{t}</option>)}
                        </select>
                        <div style={{ marginLeft: 'auto' }}>{exportBar(false)}</div>
                    </div>
                    <div style={{ padding: '10px 16px', background: 'rgba(201,169,110,0.08)', borderBottom: '1px solid var(--color-border, rgba(255,255,255,0.06))', display: 'flex', gap: 24 }}>
                        <span style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>{filteredInv.length} items</span>
                        <span style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>Consumption Value: <strong style={{ color: '#f59e0b' }}>£{fmt(invTotals.value)}</strong></span>
                        <span style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>Remaining Stock Value: <strong style={{ color: '#22c55e' }}>£{fmt(invTotals.stockValue)}</strong></span>
                    </div>
                    <div style={{ overflowX: 'auto' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                            <thead>
                                <tr style={{ background: 'rgba(255,255,255,0.03)' }}>
                                    {[
                                        { label: 'Inventory Item', key: 'item_name' },
                                        { label: 'Category', key: 'category_name' },
                                        { label: 'Type', key: 'item_type' },
                                        { label: 'Consumed', key: 'total_consumed' },
                                        { label: 'Inv Cost/u', key: 'cost_price' },
                                        { label: 'Inv Sell/u', key: 'selling_price' },
                                        { label: 'Consumption Value', key: 'consumption_value' },
                                        { label: 'Current Stock', key: 'current_stock' },
                                        { label: 'Stock Value', key: 'stock_value' },
                                        { label: 'Risk', key: 'depletion_risk' },
                                    ].map(({ label, key }) => (
                                        <th key={key} style={{ ...thStyle, cursor: 'pointer', userSelect: 'none' }}
                                            onClick={() => toggleSort(false, key)}>
                                            {label}{sortIcon(invSort, key)}</th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {pagedInv.length === 0 ? (
                                    <tr><td colSpan={10} style={{ textAlign: 'center', padding: 32, color: 'var(--color-text-muted)', fontSize: 13 }}>No inventory consumption data for this filter</td></tr>
                                ) : pagedInv.map(r => (
                                    <tr key={r.item_id} style={{ borderBottom: '1px solid var(--color-border, rgba(255,255,255,0.06))', transition: 'background 0.15s' }}
                                        onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.03)'}
                                        onMouseLeave={e => e.currentTarget.style.background = ''}>
                                        <td style={tdStyle}><strong>{r.item_name}</strong></td>
                                        <td style={tdStyle}>{r.category_name}</td>
                                        <td style={tdStyle}>{r.item_type}</td>
                                        <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 600 }}>{fmtDualUnit(r.total_consumed, r)}</td>
                                        <td style={{ ...tdStyle, textAlign: 'right' }}>£{fmt(r.cost_price)}</td>
                                        <td style={{ ...tdStyle, textAlign: 'right' }}>£{fmt(r.selling_price)}</td>
                                        <td style={{ ...tdStyle, textAlign: 'right', color: '#f59e0b', fontWeight: 600 }}>£{fmt(r.consumption_value)}</td>
                                        <td style={{ ...tdStyle, textAlign: 'right' }}>{fmtDualUnit(r.current_stock, r)}</td>
                                        <td style={{ ...tdStyle, textAlign: 'right', color: '#22c55e', fontWeight: 600 }}>£{fmt(r.stock_value)}</td>
                                        <td style={tdStyle}>{riskBadge(r.depletion_risk)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                    <Pagination total={filteredInv.length} page={invPage} pageSize={invPageSize} onPage={setInvPage} onPageSize={setInvPageSize} />
                </div>
            )}
        </div>
    );
}

// ── Styles ───────────────────────────────────────────────────────────────────
const thStyle = { padding: '10px 14px', textAlign: 'left', fontWeight: 600, fontSize: 12, color: 'var(--color-text-muted)', borderBottom: '1px solid var(--color-border, rgba(255,255,255,0.08))', whiteSpace: 'nowrap' };
const tdStyle = { padding: '10px 14px', color: 'var(--color-text)', whiteSpace: 'nowrap' };
const filterInputStyle = { padding: '7px 12px', borderRadius: 6, fontSize: 13, background: 'var(--color-surface, rgba(255,255,255,0.06))', border: '1px solid var(--color-border, rgba(255,255,255,0.12))', color: 'var(--color-text)', outline: 'none', minWidth: 160 };
const exportBtnStyle = { padding: '7px 14px', borderRadius: 6, fontSize: 12, cursor: 'pointer', fontWeight: 600, background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)', color: 'var(--color-text)', transition: 'background 0.2s' };
const pgBtnStyle = { padding: '4px 10px', borderRadius: 4, fontSize: 13, cursor: 'pointer', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)', color: 'var(--color-text)' };
const pgSelectStyle = { padding: '4px 8px', borderRadius: 4, fontSize: 12, background: 'var(--color-surface, rgba(255,255,255,0.06))', border: '1px solid rgba(255,255,255,0.12)', color: 'var(--color-text)' };
