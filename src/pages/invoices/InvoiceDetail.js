import React, { useRef, useState, useEffect } from 'react';
import {
    MdClose, MdFileDownload, MdCheckCircle, MdWarning,
    MdEdit, MdSave, MdCancel, MdEmail, MdSync,
} from 'react-icons/md';
import { updateInvoice, updateInvoiceStatus } from '../../services/invoiceService';
import toast from 'react-hot-toast';
import './Invoices.css';

const InvoiceDetail = ({ invoice, onClose, supplierDetails, onUpdated }) => {
    const printRef = useRef();
    const [editing, setEditing] = useState(false);
    const [editItems, setEditItems] = useState([]);
    const [editDiscount, setEditDiscount] = useState({ type: 'none', value: 0 });
    const [editStatus, setEditStatus] = useState(invoice?.status || 'issued');
    const [saving, setSaving] = useState(false);
    const [savingStatus, setSavingStatus] = useState(false);
    const [sendingEmail, setSendingEmail] = useState(false);
    const [syncingXero, setSyncingXero] = useState(false);

    const handleSaveStatus = async () => {
        const targetId = invoice?.id || invoice?.doc_id || invoice?.invoice_id;
        if (!targetId) {
            toast.error('Invoice ID is missing');
            return;
        }
        setSavingStatus(true);
        try {
            await updateInvoiceStatus(targetId, editStatus);
            toast.success(`Payment status updated to ${editStatus.toUpperCase()}`);
            if (onUpdated) {
                onUpdated({ ...invoice, status: editStatus });
            }
        } catch (err) {
            console.error('Save status error:', err);
            toast.error(`Failed to update status: ${err.message || 'Error'}`);
        } finally {
            setSavingStatus(false);
        }
    };

    useEffect(() => {
        if (invoice) {
            setEditItems((invoice.line_items || []).map(item => ({ ...item })));
            setEditDiscount({
                type: invoice.discount_type || 'none',
                value: invoice.discount_value || 0,
            });
            setEditStatus(invoice.status || 'issued');
        }
    }, [invoice]);

    if (!invoice) return null;

    const formatDate = (date) => {
        if (!date) return '—';
        const d = date instanceof Date ? date : new Date(date);
        if (isNaN(d.getTime())) return '—';
        return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
    };

    const formatCurrency = (amount) => `£${(amount || 0).toFixed(2)}`;

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
        clone.style.color = '#000000';

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
                filename: `${invoice.invoice_number || 'Invoice'}.pdf`,
                image: { type: 'jpeg', quality: 1.0 },
                html2canvas: { scale: 2, useCORS: true, logging: false, width: 800, windowWidth: 800 },
                jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
                pagebreak: { mode: ['css', 'legacy'], avoid: 'tr' }
            };
            html2pdf().set(opt).from(clone).save();
        }).catch(err => {
            console.error('html2pdf failed, falling back to print:', err);
            const printWindow = window.open('', '_blank');
            printWindow.document.write(`<html><head><title>Invoice ${invoice.invoice_number}</title>
                <style>body{font-family:-apple-system,BlinkMacSystemFont,sans-serif;padding:40px;color:#222}table{width:100%;border-collapse:collapse;font-size:14px}th,td{padding:10px 12px;text-align:left;border-bottom:1px solid #eee}th{font-weight:600;background:#f9fafb;color:#374151}.text-right{text-align:right}@media print{body{padding:20px}}</style>
            </head><body>${clone.innerHTML}</body></html>`);
            printWindow.document.close();
            printWindow.onload = () => { printWindow.print(); printWindow.close(); };
        });
    };

    // ─── EDIT MODE HELPERS ───
    const handleItemChange = (index, field, value) => {
        const updated = [...editItems];
        
        // Handle vat_exempt separately as it is a boolean
        if (field === 'vat_exempt') {
            updated[index] = { ...updated[index], vat_exempt: value, vat_rate: value ? 0 : 20 };
        } else {
            updated[index] = { ...updated[index], [field]: parseFloat(value) || 0 };
        }
        
        // Recalculate net_amount
        const netAmount = updated[index].unit_price * updated[index].quantity;
        const vatRate = updated[index].vat_exempt ? 0 : (updated[index].vat_rate ?? 20);
        const vatAmount = netAmount * (vatRate / 100);
        updated[index].net_amount = Math.round(netAmount * 100) / 100;
        updated[index].vat_amount = Math.round(vatAmount * 100) / 100;
        updated[index].gross_amount = Math.round((netAmount + vatAmount) * 100) / 100;
        setEditItems(updated);
    };

    // Edit grand totals
    const getEditTotals = () => {
        const subtotal = editItems.reduce((sum, li) => sum + (li.net_amount || 0), 0);
        const totalVat = editItems.reduce((sum, li) => sum + (li.vat_amount || 0), 0);
        const preDiscount = subtotal + totalVat;
        let discountAmount = 0;
        if (editDiscount.type === 'amount') {
            discountAmount = Math.min(editDiscount.value || 0, preDiscount);
        } else if (editDiscount.type === 'percentage') {
            discountAmount = preDiscount * ((editDiscount.value || 0) / 100);
        }
        return {
            subtotal: Math.round(subtotal * 100) / 100,
            totalVat: Math.round(totalVat * 100) / 100,
            discountAmount: Math.round(discountAmount * 100) / 100,
            grandTotal: Math.round((preDiscount - discountAmount) * 100) / 100,
        };
    };

    const handleSave = async () => {
        setSaving(true);
        try {
            const editTotals = getEditTotals();
            await updateInvoice(invoice.id, {
                line_items: editItems,
                discount_type: editDiscount.type,
                discount_value: editDiscount.value,
                status: editStatus,
            });
            toast.success('Invoice updated successfully');
            setEditing(false);
            // Pass the updated invoice data so the parent can update its state immediately
            if (onUpdated) {
                onUpdated({
                    ...invoice,
                    line_items: editItems,
                    discount_type: editDiscount.type,
                    discount_value: editDiscount.value,
                    discount_amount: editTotals.discountAmount,
                    subtotal: editTotals.subtotal,
                    total_vat: editTotals.totalVat,
                    grand_total: editTotals.grandTotal,
                    status: editStatus,
                });
            }
        } catch (err) {
            console.error(err);
            toast.error('Failed to save invoice');
        } finally {
            setSaving(false);
        }
    };

    const handleCancelEdit = () => {
        setEditItems((invoice.line_items || []).map(item => ({ ...item })));
        setEditDiscount({
            type: invoice.discount_type || 'none',
            value: invoice.discount_value || 0,
        });
        setEditStatus(invoice.status || 'issued');
        setEditing(false);
    };

    // ─── SEND EMAIL ───
    const handleSendEmail = async () => {
        const recipientEmail = invoice.customer?.email;
        if (!recipientEmail) {
            toast.error('No email address found for this restaurant');
            return;
        }
        setSendingEmail(true);
        try {
            const { getFunctions, httpsCallable } = await import('firebase/functions');
            const functions = getFunctions();
            const sendInvoiceEmail = httpsCallable(functions, 'sendInvoiceEmail');
            await sendInvoiceEmail({
                invoiceId: invoice.id,
                recipientEmail,
                invoiceHtml: printRef.current?.innerHTML || '',
            });
            toast.success(`Invoice emailed to ${recipientEmail}`);
        } catch (err) {
            console.error('Email send failed:', err);
            toast.error(err?.message || 'Failed to send email. Cloud function may not be deployed yet.');
        } finally {
            setSendingEmail(false);
        }
    };

    // ─── SYNC TO XERO ───
    const handleSyncToXero = async () => {
        if (invoice.xero_invoice_id) {
            toast('This invoice is already synced to Xero', { icon: 'ℹ️' });
            return;
        }
        setSyncingXero(true);
        try {
            const { getFunctions, httpsCallable } = await import('firebase/functions');
            const functions = getFunctions();
            const xeroSyncInvoice = httpsCallable(functions, 'xeroSyncInvoice');
            const result = await xeroSyncInvoice({ invoiceId: invoice.id });

            if (result.data?.success) {
                toast.success(result.data.message || 'Synced to Xero!');
                // Update local invoice state
                if (onUpdated) {
                    onUpdated({
                        ...invoice,
                        xero_invoice_id: result.data.xeroInvoiceId,
                        xero_invoice_number: result.data.xeroInvoiceNumber,
                        xero_status: 'synced',
                        xero_synced_at: new Date(),
                    });
                }
            }
        } catch (err) {
            console.error('Xero sync failed:', err);
            toast.error(err?.message || 'Failed to sync to Xero. Check the restaurant mapping in Settings → Integrations.');
        } finally {
            setSyncingXero(false);
        }
    };

    // ─── DISPLAY DATA ───
    const isProduction = invoice.type === 'production';
    const rawSupplier = invoice.supplier || supplierDetails || {};
    const supplierName = (!rawSupplier.name || rawSupplier.name === 'Watan Central Kitchen') ? 'CATERING SPICE LTD' : rawSupplier.name;
    const supplier = {
        ...rawSupplier,
        name: supplierName,
    };
    const customer = isProduction ? { name: 'Internal Production' } : (invoice.customer || { name: '—' });

    const lineItems = editing ? editItems : (
        isProduction
            ? [{
                description: `Output: ${invoice.quantity_produced}${invoice.item_unit || 'kg'} ${invoice.item_name} (Batch ${invoice.batch_number})`,
                quantity: 1, unit: 'batch', unit_price: invoice.total_ingredient_cost,
                net_amount: invoice.total_ingredient_cost,
                vat_rate: invoice.vat_exempt ? 0 : (invoice.vat_rate ?? 20),
                vat_exempt: invoice.vat_exempt,
                vat_amount: invoice.vat_amount || 0,
                gross_amount: invoice.total_with_vat || 0,
            }]
            : (invoice.line_items || [])
    );

    const editTotals = editing ? getEditTotals() : null;
    const subtotal = editing ? editTotals.subtotal : (isProduction ? invoice.total_ingredient_cost : invoice.subtotal);
    const totalVat = editing ? editTotals.totalVat : (isProduction ? invoice.vat_amount : invoice.total_vat);
    const discountAmt = editing ? editTotals.discountAmount : (invoice.discount_amount || 0);
    const grandTotal = editing ? editTotals.grandTotal : (isProduction ? invoice.total_with_vat : invoice.grand_total);
    const hasDiscount = discountAmt > 0;

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal modal-lg" onClick={e => e.stopPropagation()} style={{ maxWidth: 900, borderRadius: 16 }}>
                <div className="modal-header" style={{ borderBottom: '1px solid var(--color-border)', padding: '20px 24px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        <h2 style={{ margin: 0, fontSize: '1.25rem' }}>Invoice <span className="text-monospace">{invoice.invoice_number}</span></h2>
                        {(invoice.status === 'issued' || !invoice.status) && <span className="badge badge-info"><MdCheckCircle /> Issued</span>}
                        {invoice.status === 'paid' && <span className="badge badge-success" style={{ background: 'rgba(34, 197, 94, 0.12)', color: '#16a34a', border: '1px solid rgba(34, 197, 94, 0.3)' }}><MdCheckCircle /> Paid</span>}
                        {invoice.status === 'draft' && <span className="badge badge-warning" style={{ background: 'rgba(245, 158, 11, 0.15)', color: '#d97706', border: '1px solid rgba(245, 158, 11, 0.3)' }}>Draft</span>}
                        {invoice.status === 'void' && <span className="badge badge-danger" style={{ background: 'rgba(239, 68, 68, 0.12)', color: '#ef4444', border: '1px solid rgba(239, 68, 68, 0.3)' }}>Void</span>}
                        {invoice.xero_invoice_id && (
                            <span className="badge badge-success" style={{ background: 'rgba(19, 181, 234, 0.12)', color: '#0d9dd9', border: '1px solid rgba(19, 181, 234, 0.3)' }}
                                title={`Xero Invoice: ${invoice.xero_invoice_number || invoice.xero_invoice_id}`}>
                                ✓ Synced to Xero
                            </span>
                        )}
                        {invoice.xero_sync_error && !invoice.xero_invoice_id && (
                            <span className="badge badge-danger" style={{ background: 'rgba(239, 68, 68, 0.12)', color: '#ef4444', border: '1px solid rgba(239, 68, 68, 0.3)' }}
                                title={invoice.xero_sync_error}>
                                ✗ Xero Sync Failed
                            </span>
                        )}
                        {editing && <span className="badge badge-warning" style={{ background: 'rgba(245, 158, 11, 0.15)', color: '#d97706', border: '1px solid rgba(245, 158, 11, 0.3)' }}>✏️ Editing</span>}
                    </div>
                    <button className="btn btn-icon" onClick={onClose}
                        style={{ background: 'var(--color-surface-hover)', borderRadius: '50%', width: 36, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center', border: 'none', cursor: 'pointer' }}>
                        <MdClose size={20} />
                    </button>
                </div>

                <div className="modal-body" style={{ padding: 0, maxHeight: 'calc(90vh - 140px)', overflowY: 'auto', background: '#f9fafb' }}>
                    <div style={{ padding: '32px 40px' }} ref={printRef}>
                        <div style={{ background: '#fff', padding: '48px', borderRadius: 8, boxShadow: '0 4px 6px -1px rgba(0,0,0,0.05)' }}>

                            {/* Header */}
                            <div className="header" style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '3px solid #d4af37', paddingBottom: 24, marginBottom: 32 }}>
                                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16 }}>
                                    <img src="/watan-logo.png" alt="Watan" style={{ width: 64, height: 64, borderRadius: 8, objectFit: 'cover' }} />
                                    <div>
                                        <h1 className="company-name" style={{ margin: '0 0 8px 0', fontSize: 28, fontWeight: 800, color: '#d4af37' }}>{supplier.name}</h1>
                                        <div style={{ fontSize: 14, color: '#374151', whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>
                                            {supplier.address}
                                            {supplier.vat_number && `\nVAT No: ${supplier.vat_number}`}
                                            {supplier.phone && `\nTel: ${supplier.phone}`}
                                            {supplier.email && `\nEmail: ${supplier.email}`}
                                        </div>
                                    </div>
                                </div>
                                <div style={{ textAlign: 'right' }}>
                                    <h2 className="inv-title" style={{ margin: '0 0 8px 0', fontSize: 24, fontWeight: 700, color: '#111', textTransform: 'uppercase', letterSpacing: 1 }}>VAT Invoice</h2>
                                    <div className="inv-number" style={{ fontSize: 18, color: '#4b5563', fontFamily: 'monospace', marginBottom: 16 }}>{invoice.invoice_number}</div>
                                    <table style={{ margin: '0 0 0 auto', textAlign: 'right', fontSize: 13, color: '#4b5563', borderCollapse: 'collapse', width: 'auto' }}>
                                        <tbody>
                                            <tr>
                                                <td style={{ padding: '2px 12px 2px 0', fontWeight: 600, border: 'none' }}>Invoice Date:</td>
                                                <td style={{ padding: '2px 0', border: 'none' }}>{formatDate(invoice.invoice_date || invoice.created_at)}</td>
                                            </tr>
                                            <tr>
                                                <td style={{ padding: '2px 12px 2px 0', fontWeight: 600, border: 'none' }}>Supply Date:</td>
                                                <td style={{ padding: '2px 0', border: 'none' }}>{formatDate(invoice.supply_date || invoice.production_date)}</td>
                                            </tr>
                                            {invoice.type === 'order' && (
                                                <tr>
                                                    <td style={{ padding: '2px 12px 2px 0', fontWeight: 600, border: 'none' }}>Order Ref:</td>
                                                    <td style={{ padding: '2px 0', border: 'none', fontFamily: 'monospace' }}>{invoice.order_number}</td>
                                                </tr>
                                            )}
                                            {invoice.updated_at && invoice.updated_at !== invoice.created_at && (
                                                <tr>
                                                    <td style={{ padding: '2px 12px 2px 0', fontWeight: 600, border: 'none' }}>Last Updated:</td>
                                                    <td style={{ padding: '2px 0', border: 'none' }}>{formatDate(invoice.updated_at)}</td>
                                                </tr>
                                            )}
                                        </tbody>
                                    </table>
                                </div>
                            </div>

                            {/* Billing From / Billing To */}
                            <div className="parties" style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 32 }}>
                                <div className="party-box" style={{ width: '45%' }}>
                                    <div className="party-title" style={{ fontSize: 12, textTransform: 'uppercase', color: '#374151', fontWeight: 700, marginBottom: 8, letterSpacing: 0.5 }}>Billing From</div>
                                    <div className="party-name" style={{ fontSize: 16, fontWeight: 700, color: '#111', marginBottom: 4 }}>{supplier.name}</div>
                                    {supplier.address && <div className="party-details" style={{ fontSize: 14, color: '#374151', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{supplier.address}</div>}
                                    {supplier.vat_number && <div style={{ fontSize: 13, color: '#374151', marginTop: 4 }}>VAT No: {supplier.vat_number}</div>}
                                    {supplier.phone && <div style={{ fontSize: 13, color: '#374151' }}>Tel: {supplier.phone}</div>}
                                    {supplier.email && <div style={{ fontSize: 13, color: '#374151' }}>Email: {supplier.email}</div>}
                                </div>
                                <div className="party-box" style={{ width: '45%' }}>
                                    <div className="party-title" style={{ fontSize: 12, textTransform: 'uppercase', color: '#374151', fontWeight: 700, marginBottom: 8, letterSpacing: 0.5 }}>Billing To</div>
                                    <div className="party-name" style={{ fontSize: 16, fontWeight: 700, color: '#111', marginBottom: 4 }}>
                                        {customer.restaurant_name || customer.name}
                                    </div>
                                    {customer.name && customer.name !== customer.restaurant_name && (
                                        <div style={{ fontSize: 14, color: '#374151', marginBottom: 2 }}>{customer.name}</div>
                                    )}
                                    {customer.address && <div className="party-details" style={{ fontSize: 14, color: '#374151', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{customer.address}</div>}
                                    {customer.email && <div style={{ fontSize: 13, color: '#374151', marginTop: 4 }}>Email: {customer.email}</div>}
                                    {customer.phone && <div style={{ fontSize: 13, color: '#374151' }}>Tel: {customer.phone}</div>}
                                    {customer.vat_number && <div style={{ fontSize: 13, color: '#374151' }}>VAT No: {customer.vat_number}</div>}
                                </div>
                            </div>

                            {/* Line Items */}
                            <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 16, fontSize: 14 }}>
                                <thead>
                                    <tr>
                                        <th style={{ padding: '10px 12px', textAlign: 'left', borderBottom: '2px solid #e5e7eb', background: '#f9fafb', color: '#374151', fontWeight: 600 }}>Description</th>
                                        <th style={{ padding: '10px 12px', textAlign: 'right', borderBottom: '2px solid #e5e7eb', background: '#f9fafb', color: '#374151', fontWeight: 600 }}>Qty</th>
                                        <th style={{ padding: '10px 12px', textAlign: 'right', borderBottom: '2px solid #e5e7eb', background: '#f9fafb', color: '#374151', fontWeight: 600 }}>Unit Price</th>
                                        <th style={{ padding: '10px 12px', textAlign: 'right', borderBottom: '2px solid #e5e7eb', background: '#f9fafb', color: '#374151', fontWeight: 600 }}>Net Amount</th>
                                        <th style={{ padding: '10px 12px', textAlign: 'right', borderBottom: '2px solid #e5e7eb', background: '#f9fafb', color: '#374151', fontWeight: 600 }}>VAT %</th>
                                        <th style={{ padding: '10px 12px', textAlign: 'right', borderBottom: '2px solid #e5e7eb', background: '#f9fafb', color: '#374151', fontWeight: 600 }}>VAT Amt</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {lineItems.map((item, i) => (
                                        <tr key={i}>
                                            <td style={{ padding: '12px', borderBottom: '1px solid #f3f4f6', color: '#111' }}>
                                                <div style={{ fontWeight: 500 }}>{item.description}</div>
                                            </td>
                                            <td style={{ padding: '12px', textAlign: 'right', borderBottom: '1px solid #f3f4f6', color: '#374151' }}>
                                                {editing ? (
                                                    <input
                                                        type="number"
                                                        step="0.01"
                                                        value={item.quantity}
                                                        onChange={e => handleItemChange(i, 'quantity', e.target.value)}
                                                        style={{ width: 70, textAlign: 'right', padding: '4px 6px', border: '1px solid #d1d5db', borderRadius: 4, fontSize: 14, backgroundColor: '#ffffff', color: '#111111' }}
                                                    />
                                                ) : (
                                                    `${item.quantity} ${item.unit}`
                                                )}
                                            </td>
                                            <td style={{ padding: '12px', textAlign: 'right', borderBottom: '1px solid #f3f4f6', color: '#374151' }}>
                                                {editing ? (
                                                    <input
                                                        type="number"
                                                        step="0.01"
                                                        value={item.unit_price}
                                                        onChange={e => handleItemChange(i, 'unit_price', e.target.value)}
                                                        style={{ width: 80, textAlign: 'right', padding: '4px 6px', border: '1px solid #d1d5db', borderRadius: 4, fontSize: 14, backgroundColor: '#ffffff', color: '#111111' }}
                                                    />
                                                ) : (
                                                    formatCurrency(item.unit_price)
                                                )}
                                            </td>
                                            <td style={{ padding: '12px', textAlign: 'right', borderBottom: '1px solid #f3f4f6', color: '#111', fontWeight: 500 }}>{formatCurrency(item.net_amount)}</td>
                                            <td style={{ padding: '12px', textAlign: 'right', borderBottom: '1px solid #f3f4f6', color: '#374151', fontSize: 13 }}>
                                                {editing ? (
                                                    <select
                                                        value={item.vat_exempt ? 'exempt' : (item.vat_rate ?? 20)}
                                                        onChange={e => {
                                                            const val = e.target.value;
                                                            if (val === 'exempt') {
                                                                handleItemChange(i, 'vat_exempt', true);
                                                            } else {
                                                                const numVal = parseInt(val);
                                                                const updated = [...editItems];
                                                                updated[i] = { ...updated[i], vat_exempt: false, vat_rate: numVal };
                                                                // Manually call handleItemChange to trigger recalculations
                                                                const netAmount = updated[i].unit_price * updated[i].quantity;
                                                                const vatAmount = netAmount * (numVal / 100);
                                                                updated[i].net_amount = Math.round(netAmount * 100) / 100;
                                                                updated[i].vat_amount = Math.round(vatAmount * 100) / 100;
                                                                updated[i].gross_amount = Math.round((netAmount + vatAmount) * 100) / 100;
                                                                setEditItems(updated);
                                                            }
                                                        }}
                                                        style={{ width: 130, textAlign: 'right', padding: '4px 6px', border: '1px solid #d1d5db', borderRadius: 4, fontSize: 13, backgroundColor: '#ffffff', color: '#111111' }}
                                                    >
                                                        <option value="exempt">Exempt</option>
                                                        <option value="0">Zero-rated (0%)</option>
                                                        <option value="5">Reduced (5%)</option>
                                                        <option value="20">Standard (20%)</option>
                                                    </select>
                                                ) : (
                                                    item.vat_exempt ? 'Exempt' : `${item.vat_rate != null ? item.vat_rate : (item.vat_amount > 0 ? Math.round((item.vat_amount / item.net_amount) * 100) : 0)}%`
                                                )}
                                            </td>
                                            <td style={{ padding: '12px', textAlign: 'right', borderBottom: '1px solid #f3f4f6', color: '#374151' }}>{formatCurrency(item.vat_amount)}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>

                            {/* Discount Section (edit mode) */}
                            {editing && (
                                <div style={{ padding: '16px 20px', background: '#f0fdf4', borderRadius: 8, border: '1px solid #bbf7d0', marginBottom: 16 }}>
                                    <div style={{ fontWeight: 600, fontSize: 13, color: '#15803d', marginBottom: 10 }}>💰 Discount</div>
                                    <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                                        <select
                                            value={editDiscount.type}
                                            onChange={e => setEditDiscount(prev => ({ ...prev, type: e.target.value, value: e.target.value === 'none' ? 0 : prev.value }))}
                                            style={{ padding: '6px 10px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 14, backgroundColor: '#ffffff', color: '#111111' }}
                                        >
                                            <option value="none">No Discount</option>
                                            <option value="amount">Amount (£)</option>
                                            <option value="percentage">Percentage (%)</option>
                                        </select>
                                        {editDiscount.type !== 'none' && (
                                            <input
                                                type="number"
                                                step="0.01"
                                                min="0"
                                                value={editDiscount.value}
                                                onChange={e => setEditDiscount(prev => ({ ...prev, value: parseFloat(e.target.value) || 0 }))}
                                                style={{ width: 100, padding: '6px 10px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 14, textAlign: 'right', backgroundColor: '#ffffff', color: '#111111' }}
                                                placeholder={editDiscount.type === 'amount' ? '£0.00' : '0%'}
                                            />
                                        )}
                                        {editDiscount.type !== 'none' && (
                                            <span style={{ fontSize: 14, color: '#15803d', fontWeight: 600 }}>
                                                = -{formatCurrency(getEditTotals().discountAmount)}
                                            </span>
                                        )}
                                    </div>
                                </div>
                            )}

                            {/* Totals Section */}
                            <div className="totals-wrapper" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginTop: 32 }}>
                                {/* Left Column: VAT Summary & Payment Status Selector in White Space */}
                                <div style={{ width: '48%', display: 'flex', flexDirection: 'column', gap: 16 }}>
                                    {invoice.vat_summary && invoice.vat_summary.length > 0 && (
                                        <div className="vat-summary">
                                            <div style={{ fontSize: 13, textTransform: 'uppercase', color: '#1f2937', fontWeight: 700, marginBottom: 8, letterSpacing: 0.5 }}>VAT Summary</div>
                                            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                                                <thead>
                                                    <tr>
                                                        <th style={{ padding: '6px 8px', textAlign: 'left', borderBottom: '1px solid #e5e7eb', color: '#374151', fontWeight: 600 }}>Rate</th>
                                                        <th style={{ padding: '6px 8px', textAlign: 'right', borderBottom: '1px solid #e5e7eb', color: '#374151', fontWeight: 600 }}>Net</th>
                                                        <th style={{ padding: '6px 8px', textAlign: 'right', borderBottom: '1px solid #e5e7eb', color: '#374151', fontWeight: 600 }}>VAT</th>
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {invoice.vat_summary.map((vs, i) => (
                                                        <tr key={i}>
                                                            <td style={{ padding: '6px 8px', borderBottom: '1px solid #f3f4f6', color: '#1f2937' }}>{vs.label}</td>
                                                            <td style={{ padding: '6px 8px', textAlign: 'right', borderBottom: '1px solid #f3f4f6', color: '#1f2937' }}>{formatCurrency(vs.net)}</td>
                                                            <td style={{ padding: '6px 8px', textAlign: 'right', borderBottom: '1px solid #f3f4f6', color: '#1f2937' }}>{formatCurrency(vs.vat)}</td>
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                        </div>
                                    )}

                                    {/* Payment Status Dropdown Selector in Left White Space */}
                                    <div className="pdf-hide-select" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', background: '#f8fafc', borderRadius: 8, border: '1px solid #e2e8f0', width: 'fit-content' }}>
                                        <span style={{ fontSize: 13, fontWeight: 700, color: '#334155' }}>Payment Status:</span>
                                        <select
                                            value={editStatus}
                                            onChange={e => setEditStatus(e.target.value)}
                                            style={{
                                                padding: '6px 10px',
                                                borderRadius: '6px',
                                                border: '1px solid #cbd5e1',
                                                fontSize: '13px',
                                                fontWeight: 600,
                                                backgroundColor: '#ffffff',
                                                color: '#0f172a',
                                                cursor: 'pointer',
                                                outline: 'none',
                                            }}
                                        >
                                            <option value="issued">Issued</option>
                                            <option value="paid">Paid</option>
                                            <option value="draft">Draft</option>
                                            <option value="void">Void / Cancelled</option>
                                        </select>
                                    </div>
                                </div>

                                {/* Right Column: Grand Totals */}
                                <div className="totals" style={{ width: '45%' }}>
                                    <div className="row" style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid #f3f4f6', fontSize: 14 }}>
                                        <span style={{ color: '#374151' }}>Total Net Amount</span>
                                        <span style={{ fontWeight: 600, color: '#111' }}>{formatCurrency(subtotal)}</span>
                                    </div>
                                    <div className="row" style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid #f3f4f6', fontSize: 14 }}>
                                        <span style={{ color: '#374151' }}>Total VAT Amount</span>
                                        <span style={{ fontWeight: 600, color: '#111' }}>{formatCurrency(totalVat)}</span>
                                    </div>
                                    {hasDiscount && (
                                        <div className="row discount" style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid #f3f4f6', fontSize: 14, color: '#16a34a' }}>
                                            <span>
                                                Discount
                                                {invoice.discount_type === 'percentage' && ` (${invoice.discount_value}%)`}
                                            </span>
                                            <span style={{ fontWeight: 600 }}>-{formatCurrency(discountAmt)}</span>
                                        </div>
                                    )}
                                    <div className="row grand" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: 12, marginTop: 4, borderTop: '2px solid #111' }}>
                                        <span style={{ fontSize: 18, fontWeight: 700, color: '#111' }}>Invoice Total</span>
                                        <span style={{ fontSize: 18, fontWeight: 700, color: '#111' }}>{formatCurrency(grandTotal)}</span>
                                    </div>
                                </div>
                            </div>

                            {/* Footer */}
                            <div className="footer" style={{ marginTop: 64, textAlign: 'center', fontSize: 12, color: '#6b7280', paddingTop: 16, borderTop: '1px solid #e5e7eb' }}>
                                {invoice.notes && (
                                    <div style={{ marginBottom: 16, color: '#374151', fontStyle: 'italic' }}>
                                        <strong>Notes:</strong> {invoice.notes}
                                    </div>
                                )}
                                <div>This is a VAT invoice issued under UK regulations.</div>
                                <div>Thank you for your business.</div>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Modal Actions */}
                <div className="modal-footer" style={{ borderTop: '1px solid var(--color-border)', padding: '16px 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        {invoice.xero_status === 'failed' && (
                            <span style={{ color: 'var(--color-danger)', fontSize: 'var(--text-sm)', display: 'flex', alignItems: 'center', gap: 4 }}>
                                <MdWarning /> Xero Sync Failed
                            </span>
                        )}
                    </div>
                    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                        {editing ? (
                            <>
                                <button className="btn btn-secondary btn-md" onClick={handleCancelEdit} style={{ padding: '8px 16px', display: 'flex', alignItems: 'center', gap: 6 }}>
                                    <MdCancel size={16} /> Cancel
                                </button>
                                <button className="btn btn-primary btn-md" onClick={handleSave} disabled={saving}
                                    style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 20px', fontSize: 15 }}>
                                    <MdSave size={18} /> {saving ? 'Saving...' : 'Save Changes'}
                                </button>
                            </>
                        ) : (
                            <>
                                <button className="btn btn-secondary btn-md" onClick={onClose} style={{ padding: '8px 16px' }}>
                                    Close
                                </button>
                                <button className="btn btn-primary btn-md" onClick={handleSaveStatus} disabled={savingStatus}
                                    style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 16px' }}>
                                    <MdSave size={16} /> {savingStatus ? 'Saving...' : 'Save'}
                                </button>
                                {!isProduction && (
                                    <button className="btn btn-ghost btn-md" onClick={() => setEditing(true)}
                                        style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 16px', color: 'var(--color-primary)' }}>
                                        <MdEdit size={16} /> Edit
                                    </button>
                                )}
                                <button className="btn btn-ghost btn-md" onClick={handleSendEmail} disabled={sendingEmail}
                                    style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 16px' }}>
                                    <MdEmail size={16} /> {sendingEmail ? 'Sending...' : 'Send Email'}
                                </button>
                                {!isProduction && (
                                    <button
                                        className="btn btn-ghost btn-md"
                                        onClick={handleSyncToXero}
                                        disabled={syncingXero || !!invoice.xero_invoice_id}
                                        style={{
                                            display: 'flex', alignItems: 'center', gap: 6, padding: '8px 16px',
                                            color: invoice.xero_invoice_id ? '#22c55e' : '#13b5ea',
                                        }}
                                        title={invoice.xero_invoice_id ? `Synced: ${invoice.xero_invoice_number || invoice.xero_invoice_id}` : 'Sync this invoice to Xero'}
                                    >
                                        <MdSync size={16} className={syncingXero ? 'xero-spin' : ''} />
                                        {syncingXero ? 'Syncing...' : invoice.xero_invoice_id ? 'Synced ✓' : 'Sync to Xero'}
                                    </button>
                                )}
                                <button className="btn btn-primary btn-md" onClick={handleDownloadPDF}
                                    style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 20px', fontSize: 15 }}>
                                    <MdFileDownload size={18} /> Download PDF
                                </button>
                            </>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default InvoiceDetail;
