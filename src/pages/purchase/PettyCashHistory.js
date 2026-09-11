import React, { useEffect, useState } from 'react';
import { MdReceipt, MdVisibility, MdRefresh, MdImage } from 'react-icons/md';
import { getPettyCashPurchases } from '../../services/pettyCashService';
import PettyCashInvoiceDetail from './PettyCashInvoiceDetail';
import toast from 'react-hot-toast';
import { useAuth } from '../../contexts/AuthContext';
import './Purchase.css';

const PettyCashHistory = () => {
    const { userProfile, currentUser } = useAuth();
    const [purchases, setPurchases] = useState([]);
    const [loading, setLoading] = useState(true);
    const [viewInvoice, setViewInvoice] = useState(null);
    const [receiptImg, setReceiptImg] = useState(null);
    const isRestaurant = ['restaurant_manager', 'restaurant_manager_non_managed'].includes(userProfile?.role);
    const restaurantId = userProfile?.restaurant_id || currentUser?.uid || '';

    const fetchData = async () => {
        setLoading(true);
        try {
            const data = await getPettyCashPurchases(isRestaurant ? restaurantId : '');
            setPurchases(data);
        } catch (err) {
            console.error(err);
            toast.error('Failed to load purchase history');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { fetchData(); }, [restaurantId, isRestaurant]); // eslint-disable-line react-hooks/exhaustive-deps

    const formatDate = (date) => {
        if (!date) return '—';
        const d = date instanceof Date ? date : new Date(date);
        return isNaN(d.getTime()) ? '—' : d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
    };

    const formatTime = (date) => {
        if (!date) return '';
        const d = date instanceof Date ? date : new Date(date);
        return isNaN(d.getTime()) ? '' : d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
    };

    const formatCurrency = (amt) => `£${(Number(amt) || 0).toFixed(2)}`;

    // Summary stats
    const totalSpent = purchases.reduce((s, p) => s + Number(p.total || 0), 0);
    const cashTotal = purchases.filter(p => p.payment_method === 'Cash').reduce((s, p) => s + Number(p.total || 0), 0);
    const cardTotal = purchases.filter(p => p.payment_method === 'Card').reduce((s, p) => s + Number(p.total || 0), 0);

    return (
        <div className="page-container">
            <div className="page-header">
                <div>
                    <h1><MdReceipt style={{ verticalAlign: 'middle', marginRight: 8 }} />Quick Purchase History</h1>
                    <p>{isRestaurant ? 'View purchases made for this restaurant only.' : 'View all emergency cash and card purchases with invoices.'}</p>
                </div>
                <button className="btn btn-secondary btn-sm" onClick={fetchData} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <MdRefresh /> Refresh
                </button>
            </div>

            {/* ── Summary Cards ── */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, marginBottom: 24 }}>
                <div className="card" style={{ padding: '20px 24px', textAlign: 'center' }}>
                    <div style={{ fontSize: 12, textTransform: 'uppercase', color: 'var(--color-text-muted)', fontWeight: 600, letterSpacing: 0.5, marginBottom: 6 }}>Total Spent</div>
                    <div style={{ fontSize: 24, fontWeight: 800, color: 'var(--color-primary)' }}>{formatCurrency(totalSpent)}</div>
                    <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 4 }}>{purchases.length} purchase{purchases.length !== 1 ? 's' : ''}</div>
                </div>
                <div className="card" style={{ padding: '20px 24px', textAlign: 'center' }}>
                    <div style={{ fontSize: 12, textTransform: 'uppercase', color: 'var(--color-text-muted)', fontWeight: 600, letterSpacing: 0.5, marginBottom: 6 }}>Cash</div>
                    <div style={{ fontSize: 24, fontWeight: 800, color: '#22c55e' }}>{formatCurrency(cashTotal)}</div>
                </div>
                <div className="card" style={{ padding: '20px 24px', textAlign: 'center' }}>
                    <div style={{ fontSize: 12, textTransform: 'uppercase', color: 'var(--color-text-muted)', fontWeight: 600, letterSpacing: 0.5, marginBottom: 6 }}>Card</div>
                    <div style={{ fontSize: 24, fontWeight: 800, color: '#3b82f6' }}>{formatCurrency(cardTotal)}</div>
                </div>
            </div>

            {/* ── Purchase Table ── */}
            <div className="card">
                <div className="data-table-wrapper">
                    <table className="data-table">
                        <thead>
                            <tr>
                                <th>INVOICE #</th>
                                <th>DATE</th>
                                <th>ITEMS</th>
                                <th>PAYMENT</th>
                                <th>PURCHASED BY</th>
                                <th style={{ textAlign: 'right' }}>TOTAL</th>
                                <th>RECEIPT</th>
                                <th>INVOICE</th>
                            </tr>
                        </thead>
                        <tbody>
                            {loading ? (
                                <tr><td colSpan="8" style={{ textAlign: 'center', padding: 40, color: 'var(--color-text-muted)' }}>Loading...</td></tr>
                            ) : purchases.length === 0 ? (
                                <tr><td colSpan="8" style={{ textAlign: 'center', padding: 40, color: 'var(--color-text-muted)' }}>No petty cash purchases yet.</td></tr>
                            ) : purchases.map(p => (
                                <tr key={p.id} style={{ cursor: 'pointer' }} onClick={() => setViewInvoice(p)}>
                                    <td>
                                        <span style={{ fontFamily: 'monospace', fontWeight: 600, color: 'var(--color-primary)', fontSize: 13 }}>
                                            {p.invoice_number || '—'}
                                        </span>
                                    </td>
                                    <td>
                                        <div style={{ fontWeight: 500 }}>{formatDate(p.created_at)}</div>
                                        <div style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>{formatTime(p.created_at)}</div>
                                    </td>
                                    <td>
                                        <div style={{ maxWidth: 250, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 13 }}>
                                            {(p.items || []).map(i => `${i.name || i.item_name} × ${i.quantity}`).join(', ')}
                                        </div>
                                        <div style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>{(p.items || []).length} item{(p.items || []).length !== 1 ? 's' : ''}</div>
                                    </td>
                                    <td>
                                        <span style={{
                                            padding: '3px 10px', borderRadius: 12, fontSize: 12, fontWeight: 600,
                                            background: p.payment_method === 'Cash' ? 'rgba(34,197,94,0.1)' : 'rgba(59,130,246,0.1)',
                                            color: p.payment_method === 'Cash' ? '#16a34a' : '#2563eb',
                                        }}>
                                            {p.payment_method}
                                        </span>
                                    </td>
                                    <td style={{ fontSize: 13 }}>{p.created_by?.name || '—'}</td>
                                    <td style={{ textAlign: 'right', fontWeight: 700, color: 'var(--color-primary)', fontSize: 15 }}>
                                        {formatCurrency(p.total)}
                                    </td>
                                    <td>
                                        {p.receipt_base64 ? (
                                            <button
                                                className="btn btn-ghost btn-sm"
                                                onClick={e => { e.stopPropagation(); setReceiptImg(p.receipt_base64); }}
                                                title="View receipt"
                                            >
                                                <MdImage />
                                            </button>
                                        ) : (
                                            <span style={{ color: 'var(--color-text-muted)', fontSize: 12 }}>—</span>
                                        )}
                                    </td>
                                    <td>
                                        <button
                                            className="btn btn-ghost btn-sm"
                                            onClick={e => { e.stopPropagation(); setViewInvoice(p); }}
                                            title="View invoice"
                                        >
                                            <MdVisibility />
                                        </button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* ── Invoice Detail Modal ── */}
            {viewInvoice && (
                <PettyCashInvoiceDetail
                    purchase={viewInvoice}
                    onClose={() => setViewInvoice(null)}
                />
            )}

            {/* ── Receipt Image Modal ── */}
            {receiptImg && (
                <div className="modal-overlay" onClick={() => setReceiptImg(null)}>
                    <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 600, borderRadius: 16 }}>
                        <div className="modal-header" style={{ padding: '16px 20px', borderBottom: '1px solid var(--color-border)' }}>
                            <h2 style={{ margin: 0, fontSize: '1.1rem' }}>Receipt Image</h2>
                            <button className="btn btn-icon" onClick={() => setReceiptImg(null)}
                                style={{ background: 'var(--color-surface-hover)', borderRadius: '50%', width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', border: 'none', cursor: 'pointer' }}>
                                ✕
                            </button>
                        </div>
                        <div className="modal-body" style={{ padding: 20, textAlign: 'center' }}>
                            <img src={receiptImg} alt="Purchase receipt" style={{ width: '100%', maxHeight: '70vh', objectFit: 'contain', borderRadius: 8 }} />
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default PettyCashHistory;
