import React, { useState, useRef } from 'react';
import {
    MdClose, MdVisibility, MdPictureAsPdf, MdFileDownload, MdEmail, MdEdit,
    MdCheckCircle, MdSave,
} from 'react-icons/md';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { updateInvoiceStatus } from '../../services/invoiceService';
import InvoiceDetail from './InvoiceDetail';
import * as XLSX from 'xlsx';
import toast from 'react-hot-toast';

const formatDate = (date) => {
    if (!date) return '—';
    const d = date instanceof Date ? date : new Date(date);
    return isNaN(d.getTime()) ? '—' : d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
};
const formatCurrency = (amt) => `£${(amt || 0).toFixed(2)}`;

/**
 * Consolidated Detail Modal — Shows a period group's detailed invoices
 * with edit access, PDF download, Excel export, and email send.
 */
const ConsolidatedDetailModal = ({
    group,              // { key, label, invoices, subtotal, total_vat, total_discount, grand_total }
    type,               // 'order' | 'production'
    restaurantName,     // For orders
    restaurantEmail,    // For email sending (orders)
    restaurantAddress,  // Restaurant address
    restaurantPhone,    // Restaurant phone
    supplierDetails,
    onClose,
    onInvoiceUpdated,
}) => {
    const [viewInvoice, setViewInvoice] = useState(null);
    const [sendingEmail, setSendingEmail] = useState(false);
    const isProduction = type === 'production';
    const invoices = group.invoices || [];
    const [tableStatuses, setTableStatuses] = useState(() => {
        const map = {};
        invoices.forEach(inv => {
            map[inv.id] = inv.status || 'issued';
        });
        return map;
    });
    const [savingStatus, setSavingStatus] = useState(false);
    const pdfRef = useRef();

    const handleSaveStatus = async () => {
        setSavingStatus(true);
        try {
            const updates = Object.entries(tableStatuses).map(([invId, st]) => updateInvoiceStatus(invId, st));
            if (updates.length > 0) {
                await Promise.all(updates);
                toast.success('Invoice statuses updated successfully');
                if (onInvoiceUpdated) onInvoiceUpdated();
            }
        } catch (err) {
            console.error('Failed to save status:', err);
            toast.error('Failed to update invoice statuses');
        } finally {
            setSavingStatus(false);
        }
    };
    const supplier = supplierDetails || { name: 'Watan Central Kitchen', address: '', email: '', phone: '', vat_number: '' };
    const customer = !isProduction
        ? { name: restaurantName, email: restaurantEmail, address: restaurantAddress || '', phone: restaurantPhone || '' }
        : { name: 'Internal Production', email: 'watanuk01@gmail.com', address: 'Central Kitchen, London, UK', phone: '' };

    // ─── Item Summary (Production) ───
    const itemSummary = (() => {
        if (!isProduction) return [];
        const map = {};
        invoices.forEach(inv => {
            const key = inv.item_id || inv.item_name;
            if (!map[key]) map[key] = { name: inv.item_name, unit: inv.item_unit, qty: 0, cost: 0, count: 0 };
            map[key].qty += inv.quantity_produced || 0;
            map[key].cost += inv.total_ingredient_cost || 0;
            map[key].count++;
        });
        return Object.values(map).sort((a, b) => a.name.localeCompare(b.name));
    })();

    // ─── PDF Download (direct file download via html2pdf.js) ───
    const handlePDF = () => {
        if (!pdfRef.current) return;
        // Clone the content and strip out elements not meant for PDF
        const clone = pdfRef.current.cloneNode(true);
        clone.querySelectorAll('.pdf-hide').forEach(el => el.remove());

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
        clone.style.color = '#000000';
        clone.style.fontSize = '12px'; // Base font size

        // Fix overflow on wrappers to prevent cutoff
        clone.querySelectorAll('.data-table-wrapper').forEach(w => {
            w.style.overflowX = 'visible';
            w.style.overflow = 'visible';
        });

        clone.querySelectorAll('table').forEach(t => {
            t.style.width = '100%';
            t.style.tableLayout = 'auto';
            t.style.fontSize = '12px'; // Ensure table font is readable
            t.style.color = '#111111';
        });

        clone.querySelectorAll('th').forEach(cell => {
            cell.style.padding = '8px';
            cell.style.backgroundColor = '#f3f4f6'; // Lighter gray so text is visible
            cell.style.color = '#111111';
            cell.style.fontWeight = '700';
        });

        clone.querySelectorAll('td').forEach(cell => {
            cell.style.padding = '8px';
            cell.style.color = '#111111';
        });

        import('html2pdf.js').then(mod => {
            const html2pdf = mod.default;
            const opt = {
                margin: [10, 5, 10, 5],
                filename: `Consolidated_${type}_${group.label.replace(/[^a-zA-Z0-9]/g, '_')}.pdf`,
                image: { type: 'jpeg', quality: 1.0 },
                html2canvas: { scale: 2, useCORS: true, logging: false, width: 800, windowWidth: 800 },
                jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
                pagebreak: { mode: ['css', 'legacy'], avoid: 'tr' }
            };
            html2pdf().set(opt).from(clone).save();
        }).catch(err => {
            console.error('html2pdf failed, falling back to print:', err);
            const win = window.open('', '_blank');
            win.document.write(`<html><head><title>Consolidated Invoice</title><style>body{font-family:sans-serif;padding:20px;font-size:11px}table{width:100%;border-collapse:collapse}th,td{padding:6px 8px;text-align:left;border-bottom:1px solid #ddd;font-size:11px}th{background:#f5f5f5;font-weight:600}</style></head><body>${clone.innerHTML}</body></html>`);
            win.document.close();
            win.onload = () => { win.print(); win.close(); };
        });
    };

    // ─── Export Excel ───
    const handleExcel = () => {
        const data = invoices.map(inv => ({
            'Invoice #': inv.invoice_number || inv.production_number || '—',
            'Date': formatDate(inv.invoice_date),
            ...(isProduction ? { 'Item': inv.item_name || '—', 'Qty': inv.quantity_produced || '—', 'Unit': inv.item_unit || '', 'Expiry': formatDate(inv.expiry_date) } : { 'Order #': inv.order_number || '—' }),
            'Net (£)': (inv.subtotal || 0).toFixed(2),
            'VAT (£)': (inv.total_vat || 0).toFixed(2),
            ...(!isProduction ? { 'Discount (£)': (inv.discount_amount || 0).toFixed(2) } : {}),
            'Total (£)': (inv.grand_total || 0).toFixed(2),
        }));
        if (!data.length) { toast.error('No data'); return; }
        const wb = XLSX.utils.book_new();
        // Main sheet
        const ws = XLSX.utils.json_to_sheet(data);
        XLSX.utils.book_append_sheet(wb, ws, 'Invoices');
        // Item summary sheet for production
        if (isProduction && itemSummary.length > 0) {
            const summaryData = itemSummary.map(it => ({ 'Item': it.name, 'Batches': it.count, 'Total Qty': `${it.qty} ${it.unit}`, 'Total Cost (£)': it.cost.toFixed(2) }));
            const ws2 = XLSX.utils.json_to_sheet(summaryData);
            XLSX.utils.book_append_sheet(wb, ws2, 'Summary by Item');
        }
        XLSX.writeFile(wb, `Consolidated_${type}_${group.label.replace(/[^a-zA-Z0-9]/g, '_')}.xlsx`);
        toast.success('Exported to Excel');
    };

    // ─── Send Email ───
    const handleSendEmail = async () => {
        const recipientEmail = isProduction ? 'watanuk01@gmail.com' : restaurantEmail;
        if (!recipientEmail) { toast.error('No email address found for this restaurant'); return; }

        setSendingEmail(true);
        try {
            // Build email HTML
            const itemRows = invoices.map(inv =>
                `<tr><td>${formatDate(inv.invoice_date)}</td><td>${inv.invoice_number || inv.production_number || '—'}</td>
                <td>${isProduction ? (inv.item_name || '—') : (inv.order_number || '—')}</td>
                ${isProduction ? `<td style="text-align:right">${inv.quantity_produced || '—'} ${inv.item_unit || ''}</td>` : ''}
                <td style="text-align:right">£${(inv.subtotal || 0).toFixed(2)}</td>
                <td style="text-align:right">£${(inv.total_vat || 0).toFixed(2)}</td>
                <td style="text-align:right;font-weight:700">£${(inv.grand_total || 0).toFixed(2)}</td></tr>`
            ).join('');

            const emailHtml = `<div style="padding:20px">
                <h2>Consolidated ${isProduction ? 'Production' : 'Order'} Invoice — ${group.label}</h2>
                <div style="display:flex;justify-content:space-between;margin-bottom:20px">
                    <div style="width:45%">
                        <div style="font-size:11px;text-transform:uppercase;font-weight:700;margin-bottom:6px;color:#374151">Billing From</div>
                        <div style="font-weight:700">${supplier.name}</div>
                        ${supplier.address ? `<div style="color:#374151">${supplier.address}</div>` : ''}
                        ${supplier.email ? `<div style="color:#374151">Email: ${supplier.email}</div>` : ''}
                    </div>
                    <div style="width:45%">
                        <div style="font-size:11px;text-transform:uppercase;font-weight:700;margin-bottom:6px;color:#374151">Billing To</div>
                        <div style="font-weight:700">${customer.name}</div>
                        ${customer.address ? `<div style="color:#374151">${customer.address}</div>` : ''}
                        ${customer.email ? `<div style="color:#374151">Email: ${customer.email}</div>` : ''}
                        ${customer.phone ? `<div style="color:#374151">Tel: ${customer.phone}</div>` : ''}
                    </div>
                </div>
                <p><strong>Period:</strong> ${group.label}</p>
                <p><strong>Total Invoices:</strong> ${invoices.length}</p>
                <table style="width:100%;border-collapse:collapse"><thead><tr>
                <th style="padding:8px;text-align:left;border-bottom:2px solid #ddd">Date</th>
                <th style="padding:8px;text-align:left;border-bottom:2px solid #ddd">Invoice #</th>
                <th style="padding:8px;text-align:left;border-bottom:2px solid #ddd">${isProduction ? 'Item' : 'Order #'}</th>
                ${isProduction ? '<th style="padding:8px;text-align:right;border-bottom:2px solid #ddd">Qty</th>' : ''}
                <th style="padding:8px;text-align:right;border-bottom:2px solid #ddd">Net</th>
                <th style="padding:8px;text-align:right;border-bottom:2px solid #ddd">VAT</th>
                <th style="padding:8px;text-align:right;border-bottom:2px solid #ddd">Total</th>
                </tr></thead><tbody>${itemRows}</tbody></table>
                <div style="margin-top:16px;padding:12px;background:#f5f5f5;border-radius:8px">
                <strong>Grand Total: £${group.grand_total.toFixed(2)}</strong> (Net: £${group.subtotal.toFixed(2)} + VAT: £${group.total_vat.toFixed(2)})
                </div></div>`;

            const functions = getFunctions();
            const sendEmail = httpsCallable(functions, 'sendInvoiceEmail');
            await sendEmail({
                invoiceId: null,
                recipientEmail,
                invoiceHtml: emailHtml,
            });
            toast.success(`Consolidated invoice emailed to ${recipientEmail}`);
        } catch (err) {
            console.error('Email failed:', err);
            toast.error('Failed to send email. Make sure Cloud Functions are deployed.');
        } finally {
            setSendingEmail(false);
        }
    };

    if (viewInvoice) {
        return <InvoiceDetail
            invoice={viewInvoice}
            onClose={() => setViewInvoice(null)}
            supplierDetails={supplierDetails}
            onUpdated={(updatedInv) => {
                if (updatedInv) {
                    setViewInvoice(updatedInv);
                } else {
                    setViewInvoice(null);
                    if (onInvoiceUpdated) onInvoiceUpdated();
                }
            }}
        />;
    }

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 1000, maxHeight: '90vh', overflow: 'auto', borderRadius: 16 }}>
                {/* Header */}
                <div className="modal-header" style={{ borderBottom: '1px solid var(--color-border)', padding: '20px 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                        <h2 style={{ margin: 0, fontSize: '1.15rem', display: 'flex', alignItems: 'center', gap: 8 }}>
                            📊 Consolidated {isProduction ? 'Production' : 'Order'} Invoice
                            <span className={`inv-type-badge ${isProduction ? 'inv-type-production' : 'inv-type-order'}`} style={{ fontSize: 11 }}>
                                {invoices.length} invoices
                            </span>
                        </h2>
                        <p style={{ margin: '4px 0 0', color: 'var(--color-text-muted)', fontSize: 'var(--text-sm)' }}>
                            {group.label}{!isProduction ? ` — ${restaurantName}` : ''}
                        </p>
                    </div>
                    <button className="btn btn-icon" onClick={onClose}
                        style={{ background: 'var(--color-surface-hover)', borderRadius: '50%', width: 36, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center', border: 'none', cursor: 'pointer' }}>
                        <MdClose size={20} color='white' />
                    </button>
                </div>

                {/* Summary Cards */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 'var(--space-2)', padding: '16px 24px', background: 'var(--color-surface)' }}>
                    <div style={{ textAlign: 'center', padding: 8 }}>
                        <div style={{ fontSize: 11, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: 0.5 }}>Invoices</div>
                        <div style={{ fontSize: 20, fontWeight: 700 }}>{invoices.length}</div>
                    </div>
                    <div style={{ textAlign: 'center', padding: 8 }}>
                        <div style={{ fontSize: 11, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: 0.5 }}>Total Net</div>
                        <div style={{ fontSize: 20, fontWeight: 700 }}>{formatCurrency(group.subtotal)}</div>
                    </div>
                    <div style={{ textAlign: 'center', padding: 8 }}>
                        <div style={{ fontSize: 11, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: 0.5 }}>Total VAT</div>
                        <div style={{ fontSize: 20, fontWeight: 700 }}>{formatCurrency(group.total_vat)}</div>
                    </div>
                    <div style={{ textAlign: 'center', padding: 8, background: 'var(--color-primary)', color: '#fff', borderRadius: 8 }}>
                        <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5, opacity: 0.8 }}>Grand Total</div>
                        <div style={{ fontSize: 20, fontWeight: 700 }}>{formatCurrency(group.grand_total)}</div>
                    </div>
                </div>

                {/* Billing From / Billing To + Printable Content */}
                <div ref={pdfRef} style={{ padding: '16px 24px', background: '#fff', borderRadius: 8, margin: '0 0 0 0' }}>
                    {/* Invoice Header with Logo */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '3px solid #d4af37', paddingBottom: 16, marginBottom: 20 }}>
                        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                            <img src="/watan-logo.png" alt="Watan" style={{ width: 56, height: 56, borderRadius: 8, objectFit: 'cover' }} />
                            <div>
                                <h3 style={{ margin: '0 0 4px', fontSize: 20, fontWeight: 800, color: '#d4af37' }}>{supplier.name}</h3>
                                <div style={{ fontSize: 12, color: '#374151', whiteSpace: 'pre-wrap', lineHeight: 1.4 }}>
                                    {supplier.address}{supplier.vat_number ? `\nVAT: ${supplier.vat_number}` : ''}
                                </div>
                            </div>
                        </div>
                        <div style={{ textAlign: 'right' }}>
                            <h3 style={{ margin: '0 0 4px', fontSize: 16, fontWeight: 700, color: '#111', textTransform: 'uppercase', letterSpacing: 1 }}>Consolidated {isProduction ? 'Production' : 'Order'} Invoice</h3>
                            <div style={{ fontSize: 13, color: '#4b5563' }}>{group.label}</div>
                        </div>
                    </div>

                    {/* Billing From / Billing To */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 20 }}>
                        <div style={{ width: '45%' }}>
                            <div style={{ fontSize: 11, textTransform: 'uppercase', color: '#374151', fontWeight: 700, marginBottom: 6, letterSpacing: 0.5 }}>Billing From</div>
                            <div style={{ fontSize: 14, fontWeight: 700, color: '#111', marginBottom: 2 }}>{supplier.name}</div>
                            {supplier.address && <div style={{ fontSize: 13, color: '#374151', lineHeight: 1.4, whiteSpace: 'pre-wrap' }}>{supplier.address}</div>}
                            {supplier.vat_number && <div style={{ fontSize: 12, color: '#374151', marginTop: 2 }}>VAT: {supplier.vat_number}</div>}
                            {supplier.phone && <div style={{ fontSize: 12, color: '#374151' }}>Tel: {supplier.phone}</div>}
                            {supplier.email && <div style={{ fontSize: 12, color: '#374151' }}>Email: {supplier.email}</div>}
                        </div>
                        <div style={{ width: '45%' }}>
                            <div style={{ fontSize: 11, textTransform: 'uppercase', color: '#374151', fontWeight: 700, marginBottom: 6, letterSpacing: 0.5 }}>Billing To</div>
                            <div style={{ fontSize: 14, fontWeight: 700, color: '#111', marginBottom: 2 }}>{customer.name}</div>
                            {customer.address && <div style={{ fontSize: 13, color: '#374151', lineHeight: 1.4, whiteSpace: 'pre-wrap' }}>{customer.address}</div>}
                            {customer.email && <div style={{ fontSize: 12, color: '#374151' }}>Email: {customer.email}</div>}
                            {customer.phone && <div style={{ fontSize: 12, color: '#374151' }}>Tel: {customer.phone}</div>}
                        </div>
                    </div>

                    {/* Production Summary by Item */}
                    {isProduction && itemSummary.length > 0 && (
                        <div style={{ padding: '0 24px', marginTop: 16 }}>
                            <h4 style={{ margin: '0 0 8px', fontSize: 13, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: 0.5 }}>🍳 Production Summary by Item</h4>
                            <table className="data-table" style={{ fontSize: 13 }}><thead><tr>
                                <th>Item</th><th style={{ textAlign: 'right' }}>Batches</th><th style={{ textAlign: 'right' }}>Total Qty</th><th style={{ textAlign: 'right' }}>Total Cost</th>
                            </tr></thead><tbody>
                                    {itemSummary.map((it, idx) => <tr key={idx}>
                                        <td style={{ fontWeight: 500 }}>{it.name}</td><td style={{ textAlign: 'right' }}>{it.count}</td>
                                        <td style={{ textAlign: 'right' }}>{it.qty} {it.unit}</td><td style={{ textAlign: 'right', fontWeight: 600 }}>{formatCurrency(it.cost)}</td>
                                    </tr>)}
                                </tbody></table>
                        </div>
                    )}

                    {/* Invoice Breakdown Table */}
                    <div style={{ padding: '16px 24px' }}>
                        <h4 style={{ margin: '0 0 8px', fontSize: 13, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: 0.5 }}>📋 Invoice Breakdown</h4>
                        <div className="data-table-wrapper">
                            <table className="data-table" style={{ fontSize: 13 }}>
                                <thead><tr>
                                    <th>DATE</th>
                                    <th>INVOICE #</th>
                                    <th>STATUS</th>
                                    <th>{isProduction ? 'ITEM' : 'ORDER #'}</th>
                                    {isProduction && <th style={{ textAlign: 'right' }}>QTY</th>}
                                    {isProduction && <th>EXPIRY</th>}
                                    <th style={{ textAlign: 'right' }}>NET</th>
                                    <th style={{ textAlign: 'right' }}>VAT</th>
                                    {!isProduction && <th style={{ textAlign: 'right' }}>DISCOUNT</th>}
                                    <th style={{ textAlign: 'right' }}>TOTAL</th>
                                    <th className="pdf-hide">ACTIONS</th>
                                </tr></thead>
                                <tbody>
                                    {invoices.map((inv, idx) => {
                                        const st = inv.status || 'issued';
                                        return (
                                            <tr key={inv.id || idx} style={{ cursor: 'pointer' }} onClick={() => setViewInvoice(inv)}>
                                                <td>{formatDate(inv.invoice_date)}</td>
                                                <td>
                                                    <span style={{ fontFamily: 'var(--font-mono, monospace)', fontWeight: 700, color: 'var(--color-primary)', fontSize: 'var(--text-xs)' }}>
                                                        {inv.invoice_number || inv.production_number || '—'}
                                                    </span>
                                                </td>
                                                <td>
                                                    <select
                                                        value={tableStatuses[inv.id] || inv.status || 'issued'}
                                                        onClick={e => e.stopPropagation()}
                                                        onChange={(e) => {
                                                            const newStatus = e.target.value;
                                                            setTableStatuses(prev => ({
                                                                ...prev,
                                                                [inv.id]: newStatus
                                                            }));
                                                        }}
                                                        style={{
                                                            padding: '4px 8px',
                                                            borderRadius: '6px',
                                                            border: '1px solid var(--color-border, #cbd5e1)',
                                                            fontSize: '12px',
                                                            fontWeight: 600,
                                                            background: 'var(--color-bg-surface, #ffffff)',
                                                            color: 'var(--color-text-primary, #0f172a)',
                                                            cursor: 'pointer',
                                                            outline: 'none',
                                                        }}
                                                    >
                                                        <option value="issued">Issued</option>
                                                        <option value="paid">Paid</option>
                                                        <option value="draft">Draft</option>
                                                        <option value="void">Void</option>
                                                    </select>
                                                </td>
                                                <td style={{ fontWeight: 500 }}>
                                                    {isProduction ? (inv.item_name || '—') : (inv.order_number || '—')}
                                                </td>
                                                {isProduction && <td style={{ textAlign: 'right' }}>{inv.quantity_produced || '—'} {inv.item_unit || ''}</td>}
                                                {isProduction && <td style={{ fontSize: 'var(--text-xs)' }}>{formatDate(inv.expiry_date)}</td>}
                                                <td style={{ textAlign: 'right', fontWeight: 500 }}>{formatCurrency(inv.subtotal)}</td>
                                                <td style={{ textAlign: 'right', color: 'var(--color-text-muted)' }}>{formatCurrency(inv.total_vat)}</td>
                                                {!isProduction && <td style={{ textAlign: 'right', color: (inv.discount_amount || 0) > 0 ? '#16a34a' : 'var(--color-text-muted)' }}>
                                                    {(inv.discount_amount || 0) > 0 ? `-${formatCurrency(inv.discount_amount)}` : '—'}
                                                </td>}
                                                <td style={{ textAlign: 'right', fontWeight: 700, color: 'var(--color-primary)' }}>{formatCurrency(inv.grand_total)}</td>
                                                <td className="pdf-hide">
                                                    <button className="btn btn-ghost btn-sm" onClick={e => { e.stopPropagation(); setViewInvoice(inv); }} title="View / Edit">
                                                        <MdEdit style={{ fontSize: 14 }} />
                                                    </button>
                                                </td>
                                            </tr>
                                        );
                                    })}
                                    {/* Totals Row */}
                                    <tr style={{ fontWeight: 700, borderTop: '2px solid var(--color-border)', background: 'var(--color-surface-hover)' }}>
                                        <td colSpan={isProduction ? 6 : 4} style={{ textAlign: 'right', textTransform: 'uppercase', fontSize: 'var(--text-xs)', letterSpacing: 0.5 }}>
                                            Total ({invoices.length} invoices)
                                        </td>
                                        <td style={{ textAlign: 'right' }}>{formatCurrency(group.subtotal)}</td>
                                        <td style={{ textAlign: 'right' }}>{formatCurrency(group.total_vat)}</td>
                                        {!isProduction && <td style={{ textAlign: 'right', color: group.total_discount > 0 ? '#16a34a' : 'var(--color-text-muted)' }}>
                                            {group.total_discount > 0 ? `-${formatCurrency(group.total_discount)}` : '—'}
                                        </td>}
                                        <td style={{ textAlign: 'right', color: 'var(--color-primary)', fontSize: 14 }}>{formatCurrency(group.grand_total)}</td>
                                        <td className="pdf-hide"></td>
                                    </tr>
                                </tbody>
                            </table>
                        </div>
                    </div>

                </div> {/* close pdfRef */}

                {/* Footer Actions */}
                <div className="modal-footer" style={{ borderTop: '1px solid var(--color-border)', padding: '16px 24px', display: 'flex', justifyContent: 'flex-end', gap: 10, flexWrap: 'wrap' }}>
                    <button className="btn btn-secondary btn-md" onClick={onClose}>Close</button>
                    <button className="btn btn-primary btn-md" onClick={handleSaveStatus} disabled={savingStatus} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <MdSave size={16} /> {savingStatus ? 'Saving...' : 'Save'}
                    </button>
                    <button className="btn btn-secondary btn-md" onClick={handleExcel} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <MdFileDownload /> Export Excel
                    </button>
                    <button className="btn btn-secondary btn-md" onClick={handleSendEmail} disabled={sendingEmail} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <MdEmail /> {sendingEmail ? 'Sending...' : `Email ${isProduction ? 'CK' : restaurantName}`}
                    </button>
                    <button className="btn btn-primary btn-md" onClick={handlePDF} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <MdPictureAsPdf /> Download PDF
                    </button>
                </div>
            </div>
        </div>
    );
};

export default ConsolidatedDetailModal;
