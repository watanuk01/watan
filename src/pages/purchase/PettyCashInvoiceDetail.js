import React, { useRef, useState } from 'react';
import { MdClose, MdFileDownload, MdCheckCircle, MdEmail } from 'react-icons/md';
import toast from 'react-hot-toast';
import './Purchase.css';

/**
 * PettyCashInvoiceDetail — Modal to view, download PDF, and email a petty cash invoice.
 * Follows the same design language as InvoiceDetail.
 */
const PettyCashInvoiceDetail = ({ purchase, onClose }) => {
    const printRef = useRef();
    const [sendingEmail, setSendingEmail] = useState(false);

    if (!purchase) return null;

    const formatDate = (date) => {
        if (!date) return '—';
        const d = date instanceof Date ? date : new Date(date);
        if (isNaN(d.getTime())) return '—';
        return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
    };

    const formatCurrency = (amount) => `£${(Number(amount) || 0).toFixed(2)}`;

    const invoiceNumber = purchase.invoice_number || 'PC-0000';
    const lineItems = purchase.line_items || (purchase.items || []).map(i => ({
        description: i.name || i.item_name || 'Item',
        quantity: i.quantity,
        unit: i.unit || 'unit',
        unit_price: i.unit_price,
        net_amount: i.total || (i.quantity * i.unit_price),
        vat_rate: 0,
        vat_amount: 0,
        gross_amount: i.total || (i.quantity * i.unit_price),
    }));

    const subtotal = purchase.subtotal || purchase.total || 0;
    const totalVat = purchase.total_vat || 0;
    const grandTotal = purchase.grand_total || purchase.total || 0;
    const createdBy = purchase.created_by?.name || 'Staff';
    const paymentMethod = purchase.payment_method || 'Cash';

    // ─── DOWNLOAD PDF ───
    const handleDownloadPDF = () => {
        if (!printRef.current) return;
        const clone = printRef.current.cloneNode(true);
        clone.querySelectorAll('.pdf-hide').forEach(el => el.remove());
        clone.style.width = '800px';
        clone.style.padding = '20px';
        clone.style.background = '#ffffff';
        clone.style.setProperty('--color-text-primary', '#111111');
        clone.style.setProperty('--color-text-secondary', '#374151');
        clone.style.setProperty('--color-text-muted', '#4b5563');
        clone.style.setProperty('--color-surface', '#ffffff');
        clone.style.setProperty('--color-border', '#e5e7eb');
        clone.style.color = '#000000';

        clone.querySelectorAll('table').forEach(t => {
            t.style.width = '100%';
            t.style.tableLayout = 'auto';
            t.style.fontSize = '13px';
            t.style.color = '#111111';
        });
        clone.querySelectorAll('th').forEach(cell => {
            cell.style.padding = '10px';
            cell.style.backgroundColor = '#f3f4f6';
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
                filename: `${invoiceNumber}.pdf`,
                image: { type: 'jpeg', quality: 1.0 },
                html2canvas: { scale: 2, useCORS: true, logging: false, width: 800, windowWidth: 800 },
                jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
                pagebreak: { mode: ['css', 'legacy'], avoid: 'tr' },
            };
            html2pdf().set(opt).from(clone).save();
        }).catch(err => {
            console.error('html2pdf failed:', err);
            window.print();
        });
    };

    // ─── SEND EMAIL ───
    const handleSendEmail = async () => {
        const email = prompt('Enter email address to send invoice to:');
        if (!email || !email.includes('@')) {
            if (email !== null) toast.error('Please enter a valid email address');
            return;
        }
        setSendingEmail(true);
        try {
            const { getFunctions, httpsCallable } = await import('firebase/functions');
            const functions = getFunctions();
            const sendInvoiceEmail = httpsCallable(functions, 'sendInvoiceEmail');

            let emailHtml = '';
            if (printRef.current) {
                const clone = printRef.current.cloneNode(true);
                clone.querySelectorAll('.pdf-hide').forEach(el => el.remove());
                emailHtml = clone.innerHTML;
            }

            await sendInvoiceEmail({
                invoiceId: purchase.id,
                recipientEmail: email,
                invoiceHtml: emailHtml,
            });
            toast.success(`Invoice emailed to ${email}`);
        } catch (err) {
            console.error('Email send failed:', err);
            toast.error(err?.message || 'Failed to send email');
        } finally {
            setSendingEmail(false);
        }
    };

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal modal-lg" onClick={e => e.stopPropagation()} style={{ maxWidth: 900, borderRadius: 16 }}>
                <div className="modal-header" style={{ borderBottom: '1px solid var(--color-border)', padding: '20px 24px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        <h2 style={{ margin: 0, fontSize: '1.25rem' }}>Petty Cash Invoice <span className="text-monospace">{invoiceNumber}</span></h2>
                        <span className="badge badge-success" style={{ background: 'rgba(34, 197, 94, 0.12)', color: '#16a34a', border: '1px solid rgba(34, 197, 94, 0.3)' }}>
                            <MdCheckCircle /> Paid
                        </span>
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
                            <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '3px solid #d4af37', paddingBottom: 24, marginBottom: 32 }}>
                                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16 }}>
                                    <img src="/watan-logo.png" alt="Watan" style={{ width: 64, height: 64, borderRadius: 8, objectFit: 'cover' }} />
                                    <div>
                                        <h1 style={{ margin: '0 0 8px 0', fontSize: 28, fontWeight: 800, color: '#d4af37' }}>CATERING SPICE LTD</h1>
                                        <div style={{ fontSize: 14, color: '#374151', lineHeight: 1.5 }}>
                                            Central Kitchen, London, UK
                                        </div>
                                    </div>
                                </div>
                                <div style={{ textAlign: 'right' }}>
                                    <h2 style={{ margin: '0 0 8px 0', fontSize: 24, fontWeight: 700, color: '#111', textTransform: 'uppercase', letterSpacing: 1 }}>
                                        Petty Cash Invoice
                                    </h2>
                                    <div style={{ fontSize: 18, color: '#4b5563', fontFamily: 'monospace', marginBottom: 16 }}>{invoiceNumber}</div>
                                    <table style={{ marginLeft: 'auto', fontSize: 13, borderCollapse: 'collapse' }}>
                                        <tbody>
                                            <tr>
                                                <td style={{ padding: '2px 12px 2px 0', fontWeight: 600, border: 'none' }}>Date:</td>
                                                <td style={{ padding: '2px 0', border: 'none' }}>{formatDate(purchase.created_at || purchase.invoice_date)}</td>
                                            </tr>
                                            <tr>
                                                <td style={{ padding: '2px 12px 2px 0', fontWeight: 600, border: 'none' }}>Payment:</td>
                                                <td style={{ padding: '2px 0', border: 'none' }}>{paymentMethod}</td>
                                            </tr>
                                            <tr>
                                                <td style={{ padding: '2px 12px 2px 0', fontWeight: 600, border: 'none' }}>Purchased By:</td>
                                                <td style={{ padding: '2px 0', border: 'none' }}>{createdBy}</td>
                                            </tr>
                                            <tr>
                                                <td style={{ padding: '2px 12px 2px 0', fontWeight: 600, border: 'none' }}>Status:</td>
                                                <td style={{ padding: '2px 0', border: 'none' }}>
                                                    <span style={{ color: '#16a34a', fontWeight: 700 }}>✓ Paid</span>
                                                </td>
                                            </tr>
                                        </tbody>
                                    </table>
                                </div>
                            </div>

                            {/* Billing From / Billing To */}
                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 32 }}>
                                <div style={{ width: '45%' }}>
                                    <div style={{ fontSize: 12, textTransform: 'uppercase', color: '#374151', fontWeight: 700, marginBottom: 8, letterSpacing: 0.5 }}>Purchased From</div>
                                    <div style={{ fontSize: 16, fontWeight: 700, color: '#111', marginBottom: 4 }}>
                                        {purchase.supplier?.name || 'Local Vendor / Emergency Purchase'}
                                    </div>
                                    <div style={{ fontSize: 13, color: '#6b7280' }}>Emergency / local purchase</div>
                                </div>
                                <div style={{ width: '45%' }}>
                                    <div style={{ fontSize: 12, textTransform: 'uppercase', color: '#374151', fontWeight: 700, marginBottom: 8, letterSpacing: 0.5 }}>Purchased For</div>
                                    <div style={{ fontSize: 16, fontWeight: 700, color: '#111', marginBottom: 4 }}>Watan Central Kitchen</div>
                                    <div style={{ fontSize: 13, color: '#6b7280' }}>Internal stock replenishment</div>
                                </div>
                            </div>

                            {/* Line Items */}
                            <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 16, fontSize: 14 }}>
                                <thead>
                                    <tr>
                                        <th style={{ padding: '10px 12px', textAlign: 'left', borderBottom: '2px solid #e5e7eb', background: '#f9fafb', color: '#374151', fontWeight: 600 }}>Item</th>
                                        <th style={{ padding: '10px 12px', textAlign: 'right', borderBottom: '2px solid #e5e7eb', background: '#f9fafb', color: '#374151', fontWeight: 600 }}>Qty</th>
                                        <th style={{ padding: '10px 12px', textAlign: 'center', borderBottom: '2px solid #e5e7eb', background: '#f9fafb', color: '#374151', fontWeight: 600 }}>Unit</th>
                                        <th style={{ padding: '10px 12px', textAlign: 'right', borderBottom: '2px solid #e5e7eb', background: '#f9fafb', color: '#374151', fontWeight: 600 }}>Unit Price</th>
                                        <th style={{ padding: '10px 12px', textAlign: 'right', borderBottom: '2px solid #e5e7eb', background: '#f9fafb', color: '#374151', fontWeight: 600 }}>Amount</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {lineItems.map((item, i) => (
                                        <tr key={i}>
                                            <td style={{ padding: '12px', borderBottom: '1px solid #f3f4f6', fontWeight: 500, color: '#111' }}>
                                                {item.description}
                                                {item.category_name && (
                                                    <span style={{ fontSize: 11, background: 'rgba(201,169,110,0.12)', color: '#c9a96e', padding: '1px 6px', borderRadius: 10, marginLeft: 8, fontWeight: 500 }}>
                                                        {item.category_name}
                                                    </span>
                                                )}
                                                {item.is_custom && (
                                                    <span style={{ fontSize: 10, background: 'rgba(34,197,94,0.12)', color: '#16a34a', padding: '1px 6px', borderRadius: 10, marginLeft: 6, fontWeight: 600 }}>NEW</span>
                                                )}
                                            </td>
                                            <td style={{ padding: '12px', textAlign: 'right', borderBottom: '1px solid #f3f4f6', color: '#374151' }}>{item.quantity}</td>
                                            <td style={{ padding: '12px', textAlign: 'center', borderBottom: '1px solid #f3f4f6', color: '#6b7280', fontSize: 12 }}>{item.unit}</td>
                                            <td style={{ padding: '12px', textAlign: 'right', borderBottom: '1px solid #f3f4f6', color: '#374151' }}>{formatCurrency(item.unit_price)}</td>
                                            <td style={{ padding: '12px', textAlign: 'right', borderBottom: '1px solid #f3f4f6', fontWeight: 600, color: '#111' }}>{formatCurrency(item.net_amount || item.gross_amount)}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>

                            {/* Totals */}
                            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 32 }}>
                                <div style={{ width: '45%' }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid #f3f4f6', fontSize: 14 }}>
                                        <span style={{ color: '#374151' }}>Subtotal</span>
                                        <span style={{ fontWeight: 600, color: '#111' }}>{formatCurrency(subtotal)}</span>
                                    </div>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid #f3f4f6', fontSize: 14 }}>
                                        <span style={{ color: '#374151' }}>VAT</span>
                                        <span style={{ fontWeight: 600, color: '#111' }}>{formatCurrency(totalVat)}</span>
                                    </div>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: 12, marginTop: 4, borderTop: '2px solid #111' }}>
                                        <span style={{ fontSize: 18, fontWeight: 700, color: '#111' }}>Total Paid</span>
                                        <span style={{ fontSize: 18, fontWeight: 700, color: '#111' }}>{formatCurrency(grandTotal)}</span>
                                    </div>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', fontSize: 13, color: '#6b7280', marginTop: 8 }}>
                                        <span>Payment Method</span>
                                        <span style={{ fontWeight: 600, color: '#374151' }}>{paymentMethod}</span>
                                    </div>
                                </div>
                            </div>

                            {/* Notes */}
                            {purchase.notes && (
                                <div style={{ marginTop: 32, padding: '16px 20px', background: '#f9fafb', borderRadius: 8, border: '1px solid #e5e7eb' }}>
                                    <div style={{ fontSize: 12, fontWeight: 700, color: '#374151', textTransform: 'uppercase', marginBottom: 6 }}>Notes</div>
                                    <div style={{ fontSize: 14, color: '#111', lineHeight: 1.5 }}>{purchase.notes}</div>
                                </div>
                            )}

                            {/* Receipt Image */}
                            {purchase.receipt_base64 && (
                                <div style={{ marginTop: 24 }}>
                                    <div style={{ fontSize: 12, fontWeight: 700, color: '#374151', textTransform: 'uppercase', marginBottom: 10 }}>Receipt Attached</div>
                                    <img src={purchase.receipt_base64} alt="Receipt" style={{ maxWidth: '100%', maxHeight: 400, borderRadius: 8, border: '1px solid #e5e7eb', objectFit: 'contain' }} />
                                </div>
                            )}

                            {/* Footer */}
                            <div style={{ marginTop: 64, textAlign: 'center', fontSize: 12, color: '#6b7280', paddingTop: 16, borderTop: '1px solid #e5e7eb' }}>
                                <div>Petty Cash Purchase — Internal Expense Record</div>
                                <div>Watan Central Kitchen</div>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Modal Footer Actions */}
                <div className="modal-footer" style={{ borderTop: '1px solid var(--color-border)', padding: '16px 24px', display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
                    <button className="btn btn-secondary btn-md" onClick={onClose} style={{ padding: '8px 16px' }}>Close</button>
                    <button className="btn btn-ghost btn-md" onClick={handleSendEmail} disabled={sendingEmail}
                        style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 16px' }}>
                        <MdEmail size={16} /> {sendingEmail ? 'Sending...' : 'Email Invoice'}
                    </button>
                    <button className="btn btn-primary btn-md" onClick={handleDownloadPDF}
                        style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 20px', fontSize: 15 }}>
                        <MdFileDownload size={18} /> Download PDF
                    </button>
                </div>
            </div>
        </div>
    );
};

export default PettyCashInvoiceDetail;
