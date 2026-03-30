import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
    getProductionInvoices,
    getProductionInvoiceById,
    getCookedMeatItems,
} from '../../services/productionService';
import {
    MdReceipt,
    MdRefresh,
    MdFileDownload,
    MdClose,
    MdVisibility,
    MdPrint,
    MdSearch,
} from 'react-icons/md';
import * as XLSX from 'xlsx';
import toast from 'react-hot-toast';
import './Production.css';

const ProductionInvoices = () => {
    const [invoices, setInvoices] = useState([]);
    const [loading, setLoading] = useState(true);
    const [cookedItems, setCookedItems] = useState([]);
    const [filters, setFilters] = useState({
        item_id: '',
        dateFrom: '',
        dateTo: '',
        search: '',
    });
    const [viewInvoice, setViewInvoice] = useState(null);
    const printRef = useRef();

    const fetchData = useCallback(async () => {
        setLoading(true);
        try {
            const [invs, items] = await Promise.all([
                getProductionInvoices({
                    type: 'single_batch',
                    ...(filters.item_id && { item_id: filters.item_id }),
                    ...(filters.dateFrom && { dateFrom: filters.dateFrom }),
                    ...(filters.dateTo && { dateTo: filters.dateTo }),
                }),
                getCookedMeatItems(),
            ]);
            setInvoices(invs);
            setCookedItems(items);
        } catch (err) {
            toast.error('Failed to load invoices');
        } finally {
            setLoading(false);
        }
    }, [filters.item_id, filters.dateFrom, filters.dateTo]);

    useEffect(() => { fetchData(); }, [fetchData]);

    const filteredInvoices = invoices.filter(inv => {
        if (!filters.search) return true;
        const q = filters.search.toLowerCase();
        return (
            inv.invoice_number?.toLowerCase().includes(q) ||
            inv.production_number?.toLowerCase().includes(q) ||
            inv.item_name?.toLowerCase().includes(q) ||
            inv.batch_number?.toLowerCase().includes(q) ||
            inv.chef_name?.toLowerCase().includes(q)
        );
    });

    const formatDate = (date) => {
        if (!date) return '—';
        const d = date.toDate ? date.toDate() : new Date(date);
        if (isNaN(d.getTime())) return '—';
        return d.toLocaleDateString('en-GB', {
            day: '2-digit', month: 'short', year: 'numeric',
        });
    };
    const formatDateTime = (date) => {
        if (!date) return '—';
        const d = date.toDate ? date.toDate() : new Date(date);
        if (isNaN(d.getTime())) return '—';
        return d.toLocaleDateString('en-GB', {
            day: '2-digit', month: 'short', year: 'numeric',
            hour: '2-digit', minute: '2-digit',
        });
    };

    const getTypeIcon = (type) => type === 'raw_meat' ? '🥩' : '🛒';

    // Export list to Excel
    const handleExportList = () => {
        if (filteredInvoices.length === 0) {
            toast.error('No data to export');
            return;
        }
        const data = filteredInvoices.map(inv => ({
            'Invoice #': inv.invoice_number,
            'Production #': inv.production_number,
            'Date': formatDate(inv.production_date),
            'Item': inv.item_name,
            'Qty Produced': inv.quantity_produced,
            'Unit': inv.item_unit || 'kg',
            'Batch #': inv.batch_number,
            'Chef': inv.chef_name,
            'Ingredient Cost (£)': inv.total_ingredient_cost?.toFixed(2),
            'VAT (£)': inv.vat_amount?.toFixed(2),
            'Total (£)': inv.total_with_vat?.toFixed(2),
            'Cost/Unit (£)': inv.cost_per_unit?.toFixed(2),
        }));
        const ws = XLSX.utils.json_to_sheet(data);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Production Invoices');
        XLSX.writeFile(wb, `Watan_ProductionInvoices_${new Date().toISOString().split('T')[0]}.xlsx`);
        toast.success('Exported to Excel');
    };

    // ─── DOWNLOAD PDF ───
    const handleDownloadPDF = () => {
        if (!printRef.current) return;
        // Clone content and set explicit width for full-width PDF rendering
        const clone = printRef.current.cloneNode(true);
        // Optimize width for A4 scale (A4 is ~210mm, 800px gives good readability scaling)
        clone.style.width = '800px';
        clone.style.padding = '20px';
        clone.style.background = '#ffffff';

        // Set PDF-specific CSS variables to ensure perfect contrast on white paper
        clone.style.setProperty('--color-text-primary', '#111111');
        clone.style.setProperty('--color-text-secondary', '#374151');
        clone.style.setProperty('--color-text-muted', '#4b5563');
        clone.style.setProperty('--color-surface', '#ffffff');
        clone.style.setProperty('--color-surface-hover', '#f9fafb');
        clone.style.setProperty('--color-border', '#e5e7eb');
        clone.style.setProperty('--color-bg-elevated', '#f3f4f6');

        // Fix overflow on wrappers to prevent cutoff
        clone.querySelectorAll('.data-table-wrapper').forEach(w => {
            w.style.overflowX = 'visible';
            w.style.overflow = 'visible';
        });

        clone.querySelectorAll('table').forEach(t => {
            t.style.width = '100%';
            t.style.tableLayout = 'auto';
            t.style.fontSize = '13px'; // Ensure table font is readable
            t.style.color = '#111111';
        });

        clone.querySelectorAll('th').forEach(cell => {
            cell.style.padding = '10px';
            cell.style.backgroundColor = '#f3f4f6'; // Lighter gray so text is visible
            cell.style.color = '#111111';
            cell.style.fontWeight = '700';
        });

        clone.querySelectorAll('td').forEach(cell => {
            cell.style.padding = '10px';
            cell.style.color = '#111111';
        });

        import('html2pdf.js').then(mod => {
            const html2pdf = mod.default;
            const opt = {
                margin: [10, 5, 10, 5],
                filename: `ProductionInvoice_${viewInvoice?.invoice_number || 'Record'}.pdf`,
                image: { type: 'jpeg', quality: 1.0 },
                html2canvas: { scale: 2, useCORS: true, logging: false, width: 800, windowWidth: 800 },
                jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
                pagebreak: { mode: ['css', 'legacy'], avoid: 'tr' }
            };
            html2pdf().set(opt).from(clone).save();
        }).catch(err => {
            console.error('html2pdf failed, falling back to print:', err);
            const printWindow = window.open('', '_blank');
            printWindow.document.write(`
                <html>
                <head>
                    <title>Invoice ${viewInvoice?.invoice_number}</title>
                    <style>
                        body { font-family: -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif; padding: 40px; color: #222; }
                        table { width: 100%; border-collapse: collapse; margin: 16px 0; }
                        th, td { padding: 8px 12px; text-align: left; border-bottom: 1px solid #ddd; }
                        th { background: #f5f5f5; font-weight: 600; }
                        .header { display: flex; justify-content: space-between; border-bottom: 3px solid #d4af37; padding-bottom: 16px; margin-bottom: 24px; }
                        .company { font-size: 24px; font-weight: 800; color: #d4af37; }
                        .totals { text-align: right; margin-top: 16px; }
                        .totals .row { display: flex; justify-content: flex-end; gap: 24px; padding: 4px 0; }
                        .totals .grand { font-size: 18px; font-weight: 700; border-top: 2px solid #d4af37; padding-top: 8px; color: #d4af37; }
                        @media print { body { padding: 20px; } }
                    </style>
                </head>
                <body>
                    ${clone.innerHTML}
                </body>
                </html>
            `);
            printWindow.document.close();
            printWindow.focus();
            setTimeout(() => printWindow.print(), 300);
        });
    };

    const openInvoice = async (inv) => {
        try {
            const full = await getProductionInvoiceById(inv.id);
            setViewInvoice(full);
        } catch {
            setViewInvoice(inv);
        }
    };

    return (
        <div className="page-content">
            <div className="page-header">
                <div>
                    <h1 className="page-title">
                        <MdReceipt style={{ marginRight: 'var(--space-2)' }} />
                        Production Invoices
                    </h1>
                    <p className="page-subtitle">{filteredInvoices.length} invoice{filteredInvoices.length !== 1 ? 's' : ''}</p>
                </div>
                <div style={{ display: 'flex', gap: 'var(--space-3)' }}>
                    <button className="btn btn-secondary btn-sm" onClick={handleExportList} disabled={filteredInvoices.length === 0}>
                        <MdFileDownload /> Export List
                    </button>
                </div>
            </div>

            {/* Filters */}
            <div className="filters-bar" style={{ marginBottom: 'var(--space-5)', flexWrap: 'wrap' }}>
                <div style={{ position: 'relative', flex: 1, minWidth: 250 }}>
                    <MdSearch style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-muted)' }} />
                    <input
                        type="text"
                        className="form-input"
                        placeholder="Search invoice #, batch #, item, or chef..."
                        value={filters.search}
                        onChange={e => setFilters(f => ({ ...f, search: e.target.value }))}
                        style={{ paddingLeft: 36, width: '100%' }}
                    />
                </div>
                <select
                    className="form-input"
                    value={filters.item_id}
                    onChange={e => setFilters(f => ({ ...f, item_id: e.target.value }))}
                    style={{ maxWidth: 200 }}
                >
                    <option value="">All Items</option>
                    {cookedItems.map(item => (
                        <option key={item.id} value={item.id}>🍛 {item.name}</option>
                    ))}
                </select>
                <input
                    type="date"
                    className="form-input"
                    value={filters.dateFrom}
                    onChange={e => setFilters(f => ({ ...f, dateFrom: e.target.value }))}
                    style={{ maxWidth: 155 }}
                />
                <input
                    type="date"
                    className="form-input"
                    value={filters.dateTo}
                    onChange={e => setFilters(f => ({ ...f, dateTo: e.target.value }))}
                    style={{ maxWidth: 155 }}
                />
                <button className="btn-refresh" onClick={fetchData}><MdRefresh /></button>
            </div>

            {/* Table */}
            <div className="card">
                <div className="data-table-wrapper">
                    <table className="data-table">
                        <thead>
                            <tr>
                                <th>Invoice #</th>
                                <th>Date</th>
                                <th>Item</th>
                                <th>Qty Produced</th>
                                <th>Batch #</th>
                                <th>Chef</th>
                                <th>Ingredient Cost</th>
                                <th>VAT</th>
                                <th>Total</th>
                                <th>Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {loading ? (
                                Array.from({ length: 5 }).map((_, i) => (
                                    <tr key={i}>{Array.from({ length: 10 }).map((_, j) => (
                                        <td key={j}><div className="skeleton skeleton-text" /></td>
                                    ))}</tr>
                                ))
                            ) : filteredInvoices.length === 0 ? (
                                <tr>
                                    <td colSpan="10" style={{ textAlign: 'center', padding: 'var(--space-8)', color: 'var(--color-text-muted)' }}>
                                        <MdReceipt style={{ fontSize: 32, display: 'block', margin: '0 auto var(--space-2)' }} />
                                        No invoices found
                                    </td>
                                </tr>
                            ) : (
                                filteredInvoices.map(inv => (
                                    <tr key={inv.id} style={{ cursor: 'pointer' }} onClick={() => openInvoice(inv)}>
                                        <td>
                                            <span style={{ fontFamily: 'var(--font-mono, monospace)', fontWeight: 700, color: 'var(--color-primary)', fontSize: 'var(--text-xs)' }}>
                                                {inv.invoice_number}
                                            </span>
                                        </td>
                                        <td>{formatDate(inv.production_date)}</td>
                                        <td style={{ fontWeight: 600 }}>🍛 {inv.item_name}</td>
                                        <td>{inv.quantity_produced} {inv.item_unit || 'kg'}</td>
                                        <td style={{ fontFamily: 'var(--font-mono, monospace)', fontSize: 'var(--text-xs)' }}>
                                            {inv.batch_number}
                                        </td>
                                        <td>{inv.chef_name || '—'}</td>
                                        <td style={{ fontWeight: 600 }}>£{inv.total_ingredient_cost?.toFixed(2)}</td>
                                        <td>£{inv.vat_amount?.toFixed(2)}</td>
                                        <td style={{ fontWeight: 700, color: 'var(--color-primary)' }}>£{inv.total_with_vat?.toFixed(2)}</td>
                                        <td>
                                            <button className="btn btn-ghost btn-sm" onClick={e => { e.stopPropagation(); openInvoice(inv); }}>
                                                <MdVisibility />
                                            </button>
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* ═══ Invoice Detail Modal ═══ */}
            {viewInvoice && (
                <div className="modal-overlay" onClick={() => setViewInvoice(null)}>
                    <div className="modal modal-lg" onClick={e => e.stopPropagation()}>
                        <div className="modal-header">
                            <h2>Invoice — {viewInvoice.invoice_number}</h2>
                            <button className="modal-close" onClick={() => setViewInvoice(null)}>
                                <MdClose />
                            </button>
                        </div>
                        <div className="modal-body" style={{ maxHeight: '70vh', overflowY: 'auto' }}>
                            <div ref={printRef}>
                                {/* Invoice Content */}
                                <div className="invoice-preview">
                                    <div className="invoice-header">
                                        <div>
                                            <div className="company-name">وطن WATAN</div>
                                            <div style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)' }}>Central Kitchen</div>
                                        </div>
                                        <div className="invoice-title">
                                            <h2>Production Invoice</h2>
                                            <div className="inv-number">{viewInvoice.invoice_number}</div>
                                        </div>
                                    </div>

                                    <div className="invoice-info-grid">
                                        <div className="invoice-info-item">
                                            <span className="label">Production #</span>
                                            <span className="value">{viewInvoice.production_number}</span>
                                        </div>
                                        <div className="invoice-info-item">
                                            <span className="label">Date</span>
                                            <span className="value">{formatDateTime(viewInvoice.production_date)}</span>
                                        </div>
                                        <div className="invoice-info-item">
                                            <span className="label">Item Produced</span>
                                            <span className="value">🍛 {viewInvoice.item_name}</span>
                                        </div>
                                        <div className="invoice-info-item">
                                            <span className="label">Quantity Produced</span>
                                            <span className="value">{viewInvoice.quantity_produced} {viewInvoice.item_unit || 'kg'}</span>
                                        </div>
                                        <div className="invoice-info-item">
                                            <span className="label">Output Batch</span>
                                            <span className="value">{viewInvoice.batch_number}</span>
                                        </div>
                                        <div className="invoice-info-item">
                                            <span className="label">Expiry Date</span>
                                            <span className="value">{formatDate(viewInvoice.expiry_date)}</span>
                                        </div>
                                        <div className="invoice-info-item">
                                            <span className="label">Chef</span>
                                            <span className="value">{viewInvoice.chef_name || '—'}</span>
                                        </div>
                                    </div>

                                    {/* Ingredients Table */}
                                    <h4 style={{ marginBottom: 'var(--space-3)', fontSize: 'var(--text-sm)', fontWeight: 700 }}>
                                        Ingredient Details
                                    </h4>
                                    <div className="data-table-wrapper" style={{ overflowX: 'auto', marginBottom: 'var(--space-4)' }}>
                                        <table className="data-table">
                                            <thead>
                                                <tr>
                                                    <th>Ingredient</th>
                                                    <th>Type</th>
                                                    <th>Qty Used</th>
                                                    <th>Unit</th>
                                                    <th>Cost (£)</th>
                                                    <th>Source Batches</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {(viewInvoice.ingredients || []).map((ing, i) => (
                                                    <tr key={i}>
                                                        <td style={{ fontWeight: 600 }}>{getTypeIcon(ing.item_type)} {ing.item_name}</td>
                                                        <td>{ing.item_type === 'raw_meat' ? 'Raw Meat' : 'Grocery'}</td>
                                                        <td>{ing.required_sub_quantity || ing.required_quantity}</td>
                                                        <td>
                                                            {ing.unit}
                                                            {ing.unit !== ing.master_unit && ing.master_unit && (
                                                                <span style={{ fontSize: '11px', color: 'var(--color-text-muted)', display: 'block' }}>
                                                                    (= {ing.required_quantity} {ing.master_unit})
                                                                </span>
                                                            )}
                                                        </td>
                                                        <td style={{ fontWeight: 600 }}>£{ing.cost?.toFixed(2) || '0.00'}</td>
                                                        <td style={{ fontSize: 'var(--text-xs)', fontFamily: 'var(--font-mono, monospace)', whiteSpace: 'nowrap' }}>
                                                            {(ing.consumed_batches || []).map(b => b.batch_number).join(', ') || '—'}
                                                        </td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>

                                    {/* Totals */}
                                    <div className="invoice-totals">
                                        <div className="total-row">
                                            <span className="label">Ingredient Cost</span>
                                            <span className="value">£{viewInvoice.total_ingredient_cost?.toFixed(2)}</span>
                                        </div>
                                        <div className="total-row">
                                            <span className="label">VAT ({viewInvoice.vat_exempt ? 'Exempt' : `${viewInvoice.vat_rate || 0}%`})</span>
                                            <span className="value">£{viewInvoice.vat_amount?.toFixed(2)}</span>
                                        </div>
                                        <div className="total-row grand">
                                            <span className="label">Total</span>
                                            <span className="value">£{viewInvoice.total_with_vat?.toFixed(2)}</span>
                                        </div>
                                    </div>

                                    {/* Cost Summary */}
                                    <div style={{
                                        marginTop: 'var(--space-4)',
                                        padding: 'var(--space-3)',
                                        background: 'rgba(212, 175, 55, 0.06)',
                                        borderRadius: 'var(--radius-md)',
                                        border: '1px solid rgba(212, 175, 55, 0.15)',
                                        fontSize: 'var(--text-sm)',
                                        textAlign: 'center',
                                    }}>
                                        <strong>Output:</strong> {viewInvoice.quantity_produced}{viewInvoice.item_unit || 'kg'} {viewInvoice.item_name} (Batch {viewInvoice.batch_number})
                                        &nbsp;|&nbsp;
                                        <strong>Cost per {viewInvoice.item_unit || 'kg'}:</strong> £{viewInvoice.cost_per_unit?.toFixed(2)}
                                        &nbsp;|&nbsp;
                                        <strong>Cost per {viewInvoice.item_unit || 'kg'} (incl. VAT):</strong> £{viewInvoice.cost_per_unit_with_vat?.toFixed(2)}
                                    </div>
                                </div>
                            </div>
                        </div>
                        <div className="modal-footer">
                            <button className="btn btn-secondary btn-md" onClick={() => setViewInvoice(null)}>Close</button>
                            <button className="btn btn-primary btn-md" onClick={handleDownloadPDF} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 20px', fontSize: 15 }}>
                                <MdFileDownload size={18} /> Download PDF
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default ProductionInvoices;
