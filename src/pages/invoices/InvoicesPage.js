import React, { useState, useEffect, useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
    getInvoices, getInvoiceById, getSupplierDetails, saveSupplierDetails,
    getConsolidatedData, getRestaurantUsers, regenerateAllInvoiceVat,
} from '../../services/invoiceService';
import { getProductionInvoices } from '../../services/productionService';
import {
    MdReceipt, MdRefresh, MdFileDownload, MdClose, MdVisibility, MdSearch,
    MdFilterList, MdEdit, MdSave, MdCheckCircle, MdWarning, MdBusinessCenter,
    MdPictureAsPdf, MdExpandMore, MdSync,
} from 'react-icons/md';
import InvoiceDetail from './InvoiceDetail';
import ConsolidatedDetailModal from './ConsolidatedDetailModal';
import Pagination from '../../components/common/Pagination';
import * as XLSX from 'xlsx';
import toast from 'react-hot-toast';
import './Invoices.css';

// ═══ PERIOD GROUPING HELPERS ═══
const getWeekLabel = (date) => {
    const d = new Date(date);
    const day = d.getDay();
    const sun = new Date(d); sun.setDate(d.getDate() - day);
    const sat = new Date(sun); sat.setDate(sun.getDate() + 6);
    const fmt = (dt) => dt.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
    return `${fmt(sun)} – ${fmt(sat)}, ${sat.getFullYear()}`;
};
const getWeekKey = (date) => {
    const d = new Date(date);
    const day = d.getDay();
    const sun = new Date(d); sun.setDate(d.getDate() - day); sun.setHours(0, 0, 0, 0);
    return sun.toISOString().split('T')[0];
};
const getFortnightLabel = (date) => {
    const d = new Date(date);
    const day = d.getDate();
    const monthName = d.toLocaleDateString('en-GB', { month: 'short', year: 'numeric' });
    return day <= 15 ? `1–15 ${monthName}` : `16–${new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()} ${monthName}`;
};
const getFortnightKey = (date) => {
    const d = new Date(date);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${d.getDate() <= 15 ? 'A' : 'B'}`;
};
const getMonthLabel = (date) => new Date(date).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
const getMonthKey = (date) => { const d = new Date(date); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };

const groupInvoicesByPeriod = (invoices, period) => {
    const groups = {};
    const keyFn = period === 'weekly' ? getWeekKey : period === 'fortnightly' ? getFortnightKey : getMonthKey;
    const labelFn = period === 'weekly' ? getWeekLabel : period === 'fortnightly' ? getFortnightLabel : getMonthLabel;
    invoices.forEach(inv => {
        const d = inv.invoice_date || inv.production_date || inv.created_at;
        if (!d) return;
        const key = keyFn(d);
        if (!groups[key]) groups[key] = { key, label: labelFn(d), invoices: [], subtotal: 0, total_vat: 0, total_discount: 0, grand_total: 0 };
        groups[key].invoices.push(inv);
        groups[key].subtotal += inv.subtotal || inv.total_ingredient_cost || 0;
        groups[key].total_vat += inv.total_vat || inv.vat_amount || 0;
        groups[key].total_discount += inv.discount_amount || 0;
        groups[key].grand_total += inv.grand_total || inv.total_with_vat || 0;
    });
    // Round and sort descending
    return Object.values(groups).map(g => ({
        ...g, subtotal: Math.round(g.subtotal * 100) / 100, total_vat: Math.round(g.total_vat * 100) / 100,
        total_discount: Math.round(g.total_discount * 100) / 100, grand_total: Math.round(g.grand_total * 100) / 100,
    })).sort((a, b) => b.key.localeCompare(a.key));
};

// ═══ HELPERS ═══
const formatDate = (date) => {
    if (!date) return '—';
    const d = date instanceof Date ? date : new Date(date);
    return isNaN(d.getTime()) ? '—' : d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
};
const formatCurrency = (amt) => `£${(amt || 0).toFixed(2)}`;

const InvoicesPage = () => {
    const location = useLocation();
    const navigate = useNavigate();
    const activeTab = location.pathname.includes('/consolidated') ? 'consolidated' : 'all';

    // ─── STATE ───
    const [invoices, setInvoices] = useState([]);
    const [productionInvoices, setProductionInvoices] = useState([]);
    const [loading, setLoading] = useState(true);
    const [searchQuery, setSearchQuery] = useState('');
    const [typeFilter, setTypeFilter] = useState('all');
    const [filters, setFilters] = useState({ restaurant_id: '', dateFrom: '', dateTo: '', status: '' });
    const [viewInvoice, setViewInvoice] = useState(null);
    const [supplierDetails, setSupplierDetails] = useState(null);
    const [restaurants, setRestaurants] = useState([]);
    // Consolidated
    const [consolidatedType, setConsolidatedType] = useState('order');
    const [consolidatedRestaurant, setConsolidatedRestaurant] = useState('');
    const [consolidatedPeriod, setConsolidatedPeriod] = useState('weekly');
    const [allOrderInvoices, setAllOrderInvoices] = useState([]);
    const [allProdInvoices, setAllProdInvoices] = useState([]);
    const [consolidatedLoading, setConsolidatedLoading] = useState(false);
    const [viewGroup, setViewGroup] = useState(null);
    const [customDateFrom, setCustomDateFrom] = useState('');
    const [customDateTo, setCustomDateTo] = useState('');
    const [fixingVat, setFixingVat] = useState(false);

    // Pagination State
    const [currentPageAll, setCurrentPageAll] = useState(1);
    const [itemsPerPageAll, setItemsPerPageAll] = useState(15);
    const [currentPageConsolidated, setCurrentPageConsolidated] = useState(1);
    const [itemsPerPageConsolidated, setItemsPerPageConsolidated] = useState(15);

    // Reset pagination to page 1 on search, tab, or filter changes
    useEffect(() => {
        setCurrentPageAll(1);
    }, [activeTab, searchQuery, typeFilter, filters]);

    useEffect(() => {
        setCurrentPageConsolidated(1);
    }, [activeTab, consolidatedType, consolidatedRestaurant, consolidatedPeriod, customDateFrom, customDateTo]);

    const handleFixVat = async () => {
        setFixingVat(true);
        try {
            const results = await regenerateAllInvoiceVat();
            if (results.updated > 0) {
                toast.success(`Fixed VAT on ${results.updated} invoice(s)`);
                fetchData();
            } else {
                toast.success('All invoice VAT rates are already correct');
            }
        } catch (err) {
            console.error(err);
            toast.error('Failed to fix VAT rates');
        } finally {
            setFixingVat(false);
        }
    };

    useEffect(() => { getRestaurantUsers().then(setRestaurants); }, []);

    // ─── FETCH ALL INVOICES (All Invoices tab) ───
    const fetchData = useCallback(async () => {
        if (activeTab !== 'all') return;
        setLoading(true);
        try {
            const [orderInvs, prodInvs] = await Promise.all([
                getInvoices({ ...(filters.dateFrom && { date_from: filters.dateFrom }), ...(filters.dateTo && { date_to: filters.dateTo }), ...(filters.status && { status: filters.status }) }),
                getProductionInvoices({ ...(filters.dateFrom && { dateFrom: filters.dateFrom }), ...(filters.dateTo && { dateTo: filters.dateTo }) }),
            ]);
            setInvoices(orderInvs);
            setProductionInvoices(prodInvs.map(pi => ({
                ...pi,
                type: 'production',
                status: pi.status || 'issued',
                invoice_date: pi.production_date,
                customer: { name: 'Internal Production', restaurant_name: 'Internal Production' },
                grand_total: pi.total_with_vat || 0,
                total_vat: pi.vat_amount || 0,
                subtotal: pi.total_ingredient_cost || 0,
            })));
            const sup = await getSupplierDetails();
            setSupplierDetails(sup);
        } catch (err) { toast.error('Failed to load invoices'); console.error(err); }
        finally { setLoading(false); }
    }, [activeTab, filters]);
    useEffect(() => { fetchData(); }, [fetchData]);

    // ─── FETCH CONSOLIDATED DATA ───
    const fetchConsolidatedData = useCallback(async () => {
        if (activeTab !== 'consolidated') return;
        setConsolidatedLoading(true);
        try {
            if (consolidatedType === 'order') {
                if (!consolidatedRestaurant) { setAllOrderInvoices([]); setConsolidatedLoading(false); return; }
                const data = await getConsolidatedData(consolidatedRestaurant, new Date(2020, 0, 1), new Date());
                setAllOrderInvoices(data.invoices || []);
            } else {
                const prodInvs = await getProductionInvoices({});
                setAllProdInvoices(prodInvs.map(inv => ({ ...inv, type: 'production', status: inv.status || 'issued', invoice_date: inv.production_date, subtotal: inv.total_ingredient_cost || 0, total_vat: inv.vat_amount || 0, grand_total: inv.total_with_vat || 0 })));
            }
            if (!supplierDetails) { const sup = await getSupplierDetails(); setSupplierDetails(sup); }
        } catch (err) { toast.error('Failed to load consolidated data'); console.error(err); }
        finally { setConsolidatedLoading(false); }
    }, [activeTab, consolidatedType, consolidatedRestaurant, supplierDetails]);
    useEffect(() => { if (activeTab === 'consolidated') fetchConsolidatedData(); }, [activeTab, fetchConsolidatedData]);

    // ─── COMPUTED: COMBINED & FILTERED ───
    const allInvoices = (() => {
        let combined = [...invoices, ...productionInvoices];
        if (typeFilter === 'order') combined = combined.filter(i => i.type === 'order');
        else if (typeFilter === 'production') combined = combined.filter(i => i.type === 'production');
        if (filters.restaurant_id) combined = combined.filter(i => i.customer?.restaurant_id === filters.restaurant_id);
        if (filters.status) {
            const targetStatus = filters.status.toLowerCase();
            combined = combined.filter(i => (i.status || 'issued').toLowerCase() === targetStatus);
        }
        if (searchQuery) {
            const q = searchQuery.toLowerCase();
            combined = combined.filter(inv => inv.invoice_number?.toLowerCase().includes(q) || inv.order_number?.toLowerCase().includes(q) || inv.customer?.name?.toLowerCase().includes(q) || inv.customer?.restaurant_name?.toLowerCase().includes(q) || inv.item_name?.toLowerCase().includes(q) || inv.production_number?.toLowerCase().includes(q));
        }
        combined.sort((a, b) => (b.invoice_date || b.created_at || 0) - (a.invoice_date || a.created_at || 0));
        return combined;
    })();

    // ─── PERIOD GROUPS FOR CONSOLIDATED (with optional custom date filter) ───
    const consolidatedGroups = (() => {
        let src = consolidatedType === 'order' ? allOrderInvoices : allProdInvoices;
        if (customDateFrom) { const from = new Date(customDateFrom); from.setHours(0, 0, 0, 0); src = src.filter(inv => { const d = inv.invoice_date || inv.production_date; return d && d >= from; }); }
        if (customDateTo) { const to = new Date(customDateTo); to.setHours(23, 59, 59, 999); src = src.filter(inv => { const d = inv.invoice_date || inv.production_date; return d && d <= to; }); }
        return groupInvoicesByPeriod(src, consolidatedPeriod);
    })();

    // Paginated arrays for display
    const paginatedAllInvoices = allInvoices.slice(
        (currentPageAll - 1) * itemsPerPageAll,
        currentPageAll * itemsPerPageAll
    );

    const paginatedConsolidatedGroups = consolidatedGroups.slice(
        (currentPageConsolidated - 1) * itemsPerPageConsolidated,
        currentPageConsolidated * itemsPerPageConsolidated
    );

    // ─── BADGES ───
    const getTypeBadge = (type) => type === 'order' ? <span className="inv-type-badge inv-type-order">📦 Order</span> : type === 'production' ? <span className="inv-type-badge inv-type-production">🍳 Production</span> : <span className="inv-type-badge">{type}</span>;
    const getStatusBadge = (status) => {
        const s = (status || 'issued').toLowerCase();
        switch (s) {
            case 'issued': return <span className="badge badge-info"><MdCheckCircle /> Issued</span>;
            case 'paid': return <span className="badge badge-success"><MdCheckCircle /> Paid</span>;
            case 'draft': return <span className="badge badge-warning"><MdWarning /> Draft</span>;
            case 'cancelled':
            case 'void': return <span className="badge badge-danger"><MdClose /> Void</span>;
            default: return <span className="badge badge-muted">{status || '—'}</span>;
        }
    };
    const getDiscountBadge = (inv) => (!inv.discount_amount || inv.discount_amount <= 0) ? null : inv.discount_type === 'percentage' ? <span className="inv-discount-badge">🏷️ {inv.discount_value}% off</span> : <span className="inv-discount-badge">🏷️ £{inv.discount_amount.toFixed(2)} off</span>;

    const handleViewInvoice = async (inv) => {
        if (inv.type === 'production') { setViewInvoice(inv); return; }
        try { const full = await getInvoiceById(inv.id); setViewInvoice(full || inv); } catch { setViewInvoice(inv); }
    };

    // ─── EXPORT EXCEL ───
    const handleExportList = (dataSource) => {
        const data = (dataSource || allInvoices).map(inv => ({
            'Invoice #': inv.invoice_number || inv.production_number || '—', 'Type': inv.type, 'Date': formatDate(inv.invoice_date),
            'Customer/Item': inv.customer?.restaurant_name || inv.customer?.name || inv.item_name || '—',
            'Net (£)': (inv.subtotal || 0).toFixed(2), 'VAT (£)': (inv.total_vat || 0).toFixed(2), 'Total (£)': (inv.grand_total || 0).toFixed(2), 'Status': inv.status || '—',
        }));
        if (!data.length) { toast.error('No invoices to export'); return; }
        const ws = XLSX.utils.json_to_sheet(data);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Invoices');
        XLSX.writeFile(wb, `Watan_Invoices_${new Date().toISOString().split('T')[0]}.xlsx`);
        toast.success('Exported to Excel');
    };

    const restaurantObj = restaurants.find(r => r.id === consolidatedRestaurant);
    const selectedRestaurantName = restaurantObj?.name || '';
    const stats = { total: allInvoices.length, totalAmount: allInvoices.reduce((s, i) => s + (i.grand_total || i.total_with_vat || 0), 0), totalVat: allInvoices.reduce((s, i) => s + (i.total_vat || i.vat_amount || 0), 0) };

    return (
        <div className="page-content">
            {/* Header */}
            <div className="page-header">
                <div>
                    <h1 className="page-title"><MdReceipt style={{ marginRight: 'var(--space-2)' }} /> Invoices</h1>
                    <p className="page-subtitle">{activeTab === 'all' ? `${stats.total} invoices · ${formatCurrency(stats.totalAmount)} total · ${formatCurrency(stats.totalVat)} VAT` : 'Consolidated view — group by period and drill down'}</p>
                </div>
                <div style={{ display: 'flex', gap: 'var(--space-2)', flexShrink: 0, alignItems: 'center' }}>
                    <button className="btn-refresh" onClick={() => activeTab === 'all' ? fetchData() : fetchConsolidatedData()} title="Refresh"><MdRefresh /></button>
                    {activeTab === 'all' && (<>
                        {/* <button className="btn btn-secondary btn-sm" onClick={handleFixVat} disabled={fixingVat} title="Regenerate VAT rates from source orders">
                            <MdSync className={fixingVat ? 'xero-spin' : ''} /> {fixingVat ? 'Fixing…' : 'Fix VAT Rates'}
                        </button> */}
                        <button className="btn btn-secondary btn-sm" onClick={() => handleExportList()} disabled={!allInvoices.length}><MdFileDownload /> Export</button>
                    </>)}
                </div>
            </div>

            {/* Tabs */}
            <div className="inv-tabs">
                <button className={`inv-tab ${activeTab === 'all' ? 'active' : ''}`} onClick={() => navigate('/invoices/all')}><span className="inv-tab-icon">📋</span> All Invoices</button>
                <button className={`inv-tab ${activeTab === 'consolidated' ? 'active' : ''}`} onClick={() => navigate('/invoices/consolidated')}><span className="inv-tab-icon">📊</span> Consolidated</button>
            </div>

            {/* ═══ ALL INVOICES TAB ═══ */}
            {activeTab === 'all' && (<>
                <div className="filters-bar" style={{ marginBottom: 'var(--space-5)', flexWrap: 'wrap' }}>
                    <div style={{ position: 'relative', flex: 1, minWidth: 250 }}>
                        <MdSearch style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-muted)' }} />
                        <input type="text" className="form-input" placeholder="Search invoice #, order #, restaurant, item..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)} style={{ paddingLeft: 36, width: '100%' }} />
                    </div>
                    <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
                        <MdFilterList style={{ color: 'var(--color-text-muted)' }} />
                        <select className="form-input" value={typeFilter} onChange={e => setTypeFilter(e.target.value)} style={{ maxWidth: 140 }}>
                            <option value="all">All Types</option><option value="order">📦 Orders</option><option value="production">🍳 Production</option>
                        </select>
                        {typeFilter !== 'production' && restaurants.length > 0 && (
                            <select className="form-input" value={filters.restaurant_id} onChange={e => setFilters(f => ({ ...f, restaurant_id: e.target.value }))} style={{ maxWidth: 180 }}>
                                <option value="">All Restaurants</option>
                                {restaurants.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                            </select>
                        )}
                        <select className="form-input" value={filters.status} onChange={e => setFilters(f => ({ ...f, status: e.target.value }))} style={{ maxWidth: 130 }}>
                            <option value="">All Status</option><option value="issued">Issued</option><option value="paid">Paid</option><option value="draft">Draft</option>
                        </select>
                        <input type="date" className="form-input" value={filters.dateFrom} onChange={e => setFilters(f => ({ ...f, dateFrom: e.target.value }))} style={{ maxWidth: 155 }} />
                        <input type="date" className="form-input" value={filters.dateTo} onChange={e => setFilters(f => ({ ...f, dateTo: e.target.value }))} style={{ maxWidth: 155 }} />
                    </div>
                </div>
                <div className="card">
                    <div className="data-table-wrapper">
                        <table className="data-table">
                            <thead>
                                <tr>
                                    <th>INVOICE #</th><th>TYPE</th><th>DATE</th><th>CUSTOMER / ITEM</th><th>ORDER / PROD #</th>
                                    <th style={{ textAlign: 'right' }}>NET</th><th style={{ textAlign: 'right' }}>VAT</th><th style={{ textAlign: 'right' }}>TOTAL</th><th>STATUS</th><th>XERO</th><th>ACTIONS</th>
                                </tr>
                            </thead>
                            <tbody>
                                {loading ? Array.from({ length: 5 }).map((_, i) => <tr key={i}>{Array.from({ length: 11 }).map((_, j) => <td key={j}><div className="skeleton skeleton-text" /></td>)}</tr>)
                                    : !allInvoices.length ? <tr><td colSpan="11" style={{ textAlign: 'center', padding: 'var(--space-8)', color: 'var(--color-text-muted)' }}>
                                        <MdReceipt style={{ fontSize: 36, display: 'block', margin: '0 auto var(--space-2)' }} /> No invoices found
                                    </td></tr>
                                        : paginatedAllInvoices.map(inv => <tr key={inv.id} style={{ cursor: 'pointer' }} onClick={() => handleViewInvoice(inv)}>
                                            <td><span style={{ fontFamily: 'var(--font-mono,monospace)', fontWeight: 700, color: 'var(--color-primary)', fontSize: 'var(--text-xs)' }}>{inv.invoice_number || inv.production_number || '—'}</span>{getDiscountBadge(inv)}</td>
                                            <td>{getTypeBadge(inv.type)}</td><td>{formatDate(inv.invoice_date)}</td>
                                            <td style={{ fontWeight: 500 }}>{inv.type === 'production' ? (inv.item_name || 'Production Item') : (inv.customer?.restaurant_name || inv.customer?.name || '—')}</td>
                                            <td style={{ fontFamily: 'var(--font-mono,monospace)', fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>{inv.order_number || inv.production_number || '—'}</td>
                                            <td style={{ textAlign: 'right', fontWeight: 500 }}>{formatCurrency(inv.subtotal || inv.total_ingredient_cost)}</td>
                                            <td style={{ textAlign: 'right', color: 'var(--color-text-muted)' }}>{formatCurrency(inv.total_vat || inv.vat_amount)}</td>
                                            <td style={{ textAlign: 'right', fontWeight: 700, color: 'var(--color-primary)' }}>{formatCurrency(inv.grand_total || inv.total_with_vat)}</td>
                                            <td>{getStatusBadge(inv.status)}</td>
                                            <td>
                                                {inv.xero_invoice_id ? (
                                                    <span title={`Xero: ${inv.xero_invoice_number || inv.xero_invoice_id}`} style={{ color: '#13b5ea', fontSize: 16, display: 'flex', alignItems: 'center', gap: 4 }}>
                                                        <MdCheckCircle /> <span style={{ fontSize: 10, fontWeight: 600 }}>Synced</span>
                                                    </span>
                                                ) : inv.xero_sync_error ? (
                                                    <span title={inv.xero_sync_error} style={{ color: '#ef4444', fontSize: 16, display: 'flex', alignItems: 'center', gap: 4 }}>
                                                        <MdWarning /> <span style={{ fontSize: 10, fontWeight: 600 }}>Error</span>
                                                    </span>
                                                ) : inv.type === 'order' ? (
                                                    <span style={{ color: 'var(--color-text-muted)', fontSize: 10 }}>—</span>
                                                ) : null}
                                            </td>
                                            <td><button className="btn btn-ghost btn-sm" onClick={e => { e.stopPropagation(); handleViewInvoice(inv) }}><MdVisibility /></button></td>
                                        </tr>)}
                            </tbody>
                        </table>
                    </div>
                    {!loading && allInvoices.length > 0 && (
                        <Pagination
                            currentPage={currentPageAll}
                            totalItems={allInvoices.length}
                            itemsPerPage={itemsPerPageAll}
                            onPageChange={setCurrentPageAll}
                            onItemsPerPageChange={setItemsPerPageAll}
                        />
                    )}
                </div>
            </>)}

            {/* ═══ CONSOLIDATED TAB ═══ */}
            {activeTab === 'consolidated' && (<>
                <div className="card" style={{ marginBottom: 'var(--space-5)' }}>
                    <div style={{ padding: 'var(--space-4)', display: 'flex', gap: 'var(--space-3)', alignItems: 'flex-end', flexWrap: 'wrap' }}>
                        <div className="form-group" style={{ margin: 0 }}><label className="form-label" style={{ fontSize: 12, marginBottom: 4 }}>Type</label>
                            <div style={{ display: 'flex', gap: 4 }}>
                                <button onClick={() => setConsolidatedType('order')} className={`btn btn-sm ${consolidatedType === 'order' ? 'btn-primary' : 'btn-ghost'}`} style={{ padding: '6px 12px', fontSize: 13 }}>📦 Order</button>
                                <button onClick={() => setConsolidatedType('production')} className={`btn btn-sm ${consolidatedType === 'production' ? 'btn-primary' : 'btn-ghost'}`} style={{ padding: '6px 12px', fontSize: 13 }}>🍳 Production</button>
                            </div>
                        </div>
                        {consolidatedType === 'order' && <div className="form-group" style={{ flex: 1, minWidth: 200, margin: 0 }}><label className="form-label" style={{ fontSize: 12, marginBottom: 4 }}>Restaurant</label>
                            <select className="form-input" value={consolidatedRestaurant} onChange={e => setConsolidatedRestaurant(e.target.value)}>
                                <option value="">Select Restaurant...</option>{restaurants.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                            </select></div>}
                        <div className="form-group" style={{ margin: 0 }}><label className="form-label" style={{ fontSize: 12, marginBottom: 4 }}>Group By</label>
                            <div style={{ display: 'flex', gap: 4 }}>
                                {['weekly', 'fortnightly', 'monthly'].map(p => <button key={p} onClick={() => setConsolidatedPeriod(p)} className={`btn btn-sm ${consolidatedPeriod === p ? 'btn-primary' : 'btn-ghost'}`} style={{ textTransform: 'capitalize', padding: '6px 12px', fontSize: 13 }}>{p}</button>)}
                            </div>
                        </div>
                        <div className="form-group" style={{ margin: 0 }}><label className="form-label" style={{ fontSize: 12, marginBottom: 4 }}>From</label>
                            <input type="date" className="form-input" value={customDateFrom} onChange={e => setCustomDateFrom(e.target.value)} style={{ maxWidth: 155 }} />
                        </div>
                        <div className="form-group" style={{ margin: 0 }}><label className="form-label" style={{ fontSize: 12, marginBottom: 4 }}>To</label>
                            <input type="date" className="form-input" value={customDateTo} onChange={e => setCustomDateTo(e.target.value)} style={{ maxWidth: 155 }} />
                        </div>
                        {(customDateFrom || customDateTo) && <button className="btn btn-ghost btn-sm" onClick={() => { setCustomDateFrom(''); setCustomDateTo(''); }} style={{ alignSelf: 'flex-end', fontSize: 11 }}>✕ Clear dates</button>}
                    </div>
                </div>

                {consolidatedType === 'order' && !consolidatedRestaurant ? (
                    <div className="card" style={{ textAlign: 'center', padding: 'var(--space-10)', color: 'var(--color-text-muted)' }}><MdReceipt style={{ fontSize: 48, display: 'block', margin: '0 auto var(--space-3)', opacity: 0.3 }} /><h3 style={{ margin: '0 0 var(--space-2)', color: 'var(--color-text)' }}>Select a Restaurant</h3><p>Choose a restaurant from the dropdown to view consolidated data.</p></div>
                ) : consolidatedLoading ? (
                    <div className="card" style={{ padding: 'var(--space-8)' }}>{Array.from({ length: 4 }).map((_, i) => <div key={i} className="skeleton skeleton-text" style={{ marginBottom: 'var(--space-3)' }} />)}</div>
                ) : consolidatedGroups.length === 0 ? (
                    <div className="card" style={{ textAlign: 'center', padding: 'var(--space-10)', color: 'var(--color-text-muted)' }}><MdReceipt style={{ fontSize: 48, display: 'block', margin: '0 auto var(--space-3)', opacity: 0.3 }} /><h3 style={{ margin: '0 0 var(--space-2)', color: 'var(--color-text)' }}>No Invoices Found</h3><p>No {consolidatedType} invoices found for the selected criteria.</p></div>
                ) : (
                    <>
                        {/* Period Groups Table */}
                        <div className="card" style={{ marginBottom: 'var(--space-5)' }}>
                            <div style={{ padding: 'var(--space-4)', borderBottom: '1px solid var(--color-border)' }}><h3 style={{ margin: 0, fontSize: '1rem' }}>📅 {consolidatedType === 'order' ? `${selectedRestaurantName} — ` : ''}Consolidated by {consolidatedPeriod === 'weekly' ? 'Week' : consolidatedPeriod === 'fortnightly' ? 'Fortnight' : 'Month'}</h3></div>
                            <div className="data-table-wrapper">
                                <table className="data-table">
                                    <thead>
                                        <tr>
                                            <th>PERIOD</th><th style={{ textAlign: 'right' }}>INVOICES</th><th style={{ textAlign: 'right' }}>NET</th><th style={{ textAlign: 'right' }}>VAT</th>
                                            {consolidatedType === 'order' && <th style={{ textAlign: 'right' }}>DISCOUNT</th>}<th style={{ textAlign: 'right' }}>TOTAL</th><th>ACTIONS</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {paginatedConsolidatedGroups.map(g => (
                                            <tr key={g.key} style={{ cursor: 'pointer' }} onClick={() => setViewGroup(g)}>
                                                <td style={{ fontWeight: 600 }}>{g.label}</td>
                                                <td style={{ textAlign: 'right' }}>{g.invoices.length}</td>
                                                <td style={{ textAlign: 'right', fontWeight: 500 }}>{formatCurrency(g.subtotal)}</td>
                                                <td style={{ textAlign: 'right', color: 'var(--color-text-muted)' }}>{formatCurrency(g.total_vat)}</td>
                                                {consolidatedType === 'order' && <td style={{ textAlign: 'right', color: g.total_discount > 0 ? '#16a34a' : 'var(--color-text-muted)' }}>{g.total_discount > 0 ? `-${formatCurrency(g.total_discount)}` : '—'}</td>}
                                                <td style={{ textAlign: 'right', fontWeight: 700, color: 'var(--color-primary)' }}>{formatCurrency(g.grand_total)}</td>
                                                <td><button className="btn btn-ghost btn-sm" onClick={e => { e.stopPropagation(); setViewGroup(g); }} title="View details"><MdVisibility /></button></td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                            {!consolidatedLoading && consolidatedGroups.length > 0 && (
                                <Pagination
                                    currentPage={currentPageConsolidated}
                                    totalItems={consolidatedGroups.length}
                                    itemsPerPage={itemsPerPageConsolidated}
                                    onPageChange={setCurrentPageConsolidated}
                                    onItemsPerPageChange={setItemsPerPageConsolidated}
                                />
                            )}
                        </div>
                    </>
                )}
            </>)}

            {/* Invoice Detail Modal */}
            {viewInvoice && <InvoiceDetail invoice={viewInvoice} onClose={() => setViewInvoice(null)} supplierDetails={supplierDetails} onUpdated={(updatedInv) => {
                if (updatedInv) {
                    // Update the modal view with fresh data
                    setViewInvoice(updatedInv);
                    // Update the invoice in the list so the table reflects changes
                    setInvoices(prev => prev.map(inv => inv.id === updatedInv.id ? { ...inv, ...updatedInv } : inv));
                } else {
                    setViewInvoice(null);
                    if (activeTab === 'all') fetchData(); else fetchConsolidatedData();
                }
            }} />}

            {/* Consolidated Detail Modal */}
            {viewGroup && <ConsolidatedDetailModal group={viewGroup} type={consolidatedType} restaurantName={restaurantObj?.name || ''} restaurantEmail={restaurantObj?.email || ''} restaurantAddress={restaurantObj?.address || ''} restaurantPhone={restaurantObj?.phone || ''} supplierDetails={supplierDetails} onClose={() => setViewGroup(null)} onInvoiceUpdated={() => { setViewGroup(null); fetchConsolidatedData(); }} />}
        </div>
    );
};

export default InvoicesPage;
