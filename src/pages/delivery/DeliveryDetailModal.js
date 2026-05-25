import React from 'react';
import { MdClose, MdCheckCircle, MdWarning } from 'react-icons/md';
import { getStatusInfo } from '../../services/orderService';

const DeliveryDetailModal = ({ detailOrder, onClose }) => {
    if (!detailOrder) return null;

    const formatDateTime = (date) => {
        if (!date) return '—';
        const d = date instanceof Date ? date : new Date(date);
        if (isNaN(d.getTime())) return '—';
        return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
    };

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal modal-lg" onClick={e => e.stopPropagation()} style={{ maxWidth: 720 }}>
                <div className="modal-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '20px 24px', borderBottom: '1px solid var(--color-border)' }}>
                    <div>
                        <h2 style={{ margin: 0, fontSize: '1.1rem' }}>
                            📦 Delivery Details — {detailOrder.order_number}
                        </h2>
                        <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>
                            {detailOrder.restaurant_name}
                        </span>
                    </div>
                    <button className="btn-refresh" onClick={onClose} style={{ width: 36, height: 36 }}>
                        <MdClose size={20} />
                    </button>
                </div>
                <div className="modal-body" style={{ padding: '24px', maxHeight: '70vh', overflowY: 'auto' }}>

                    {/* Info Grid */}
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-4)', marginBottom: 'var(--space-5)' }}>
                        <div style={{ padding: 'var(--space-3)', background: 'var(--color-surface-hover)', borderRadius: 8 }}>
                            <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', marginBottom: 4 }}>Status</div>
                            <span className="order-status-badge" style={{
                                background: `${getStatusInfo(detailOrder.status).color}15`,
                                color: getStatusInfo(detailOrder.status).color,
                            }}>
                                {getStatusInfo(detailOrder.status).icon} {getStatusInfo(detailOrder.status).label}
                            </span>
                        </div>
                        <div style={{ padding: 'var(--space-3)', background: 'var(--color-surface-hover)', borderRadius: 8 }}>
                            <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', marginBottom: 4 }}>Total</div>
                            <div style={{ fontWeight: 700, fontSize: 'var(--text-md)' }}>£{(detailOrder.total || detailOrder.total_amount || 0).toFixed(2)}</div>
                        </div>
                        <div style={{ padding: 'var(--space-3)', background: 'var(--color-surface-hover)', borderRadius: 8 }}>
                            <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', marginBottom: 4 }}>Delivered At</div>
                            <div style={{ fontWeight: 600, fontSize: 'var(--text-sm)' }}>{formatDateTime(detailOrder.delivered_at)}</div>
                        </div>
                        <div style={{ padding: 'var(--space-3)', background: 'var(--color-surface-hover)', borderRadius: 8 }}>
                            <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', marginBottom: 4 }}>Received By</div>
                            <div style={{ fontWeight: 600, fontSize: 'var(--text-sm)' }}>{detailOrder.delivery_manager_name || '—'}</div>
                        </div>
                    </div>

                    {/* Items Table */}
                    <h4 style={{ margin: '0 0 var(--space-3)', fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)' }}>📋 Items ({detailOrder.items?.length || 0})</h4>
                    <div className="data-table-wrapper" style={{ marginBottom: 'var(--space-5)' }}>
                        <table className="data-table" style={{ fontSize: 'var(--text-sm)' }}>
                            <thead>
                                <tr>
                                    <th>Item</th>
                                    <th style={{ textAlign: 'center' }}>Ordered</th>
                                    {detailOrder.verified_items?.length > 0 && (
                                        <th style={{ textAlign: 'center' }}>Received</th>
                                    )}
                                    <th>Unit</th>
                                    <th style={{ textAlign: 'right' }}>Price</th>
                                </tr>
                            </thead>
                            <tbody>
                                {(detailOrder.items || []).map((item, idx) => {
                                    const verified = detailOrder.verified_items?.find(v => v.item_id === item.item_id);
                                    const hasDiscrepancy = verified && verified.quantity !== item.quantity;
                                    return (
                                        <tr key={idx}>
                                            <td style={{ fontWeight: 500 }}>{item.item_name}</td>
                                            <td style={{ textAlign: 'center' }}>{item.quantity}</td>
                                            {detailOrder.verified_items?.length > 0 && (
                                                <td style={{ textAlign: 'center', fontWeight: 600, color: hasDiscrepancy ? '#ef4444' : '#22c55e' }}>
                                                    {verified ? verified.quantity : '—'}
                                                    {hasDiscrepancy && <MdWarning style={{ verticalAlign: 'middle', marginLeft: 4, fontSize: 14 }} />}
                                                </td>
                                            )}
                                            <td style={{ color: 'var(--color-text-muted)' }}>{item.unit}</td>
                                            <td style={{ textAlign: 'right' }}>£{(item.selling_price || 0).toFixed(2)}</td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>

                    {/* Discrepancies */}
                    {detailOrder.missing_items?.length > 0 && (
                        <div style={{ marginBottom: 'var(--space-5)' }}>
                            <h4 style={{ margin: '0 0 var(--space-3)', fontSize: 'var(--text-sm)', color: '#ef4444' }}>
                                <MdWarning style={{ verticalAlign: 'middle', marginRight: 4 }} />
                                Pickup Discrepancies ({detailOrder.missing_items.length})
                            </h4>
                            <div style={{ background: '#ef444410', border: '1px solid #ef444425', borderRadius: 8, padding: 'var(--space-3)' }}>
                                {detailOrder.missing_items.map((m, idx) => (
                                    <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', borderBottom: idx < detailOrder.missing_items.length - 1 ? '1px solid #ef444415' : 'none' }}>
                                        <div>
                                            <span style={{ fontWeight: 600, fontSize: 'var(--text-sm)' }}>{m.item_name}</span>
                                            <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>
                                                Ordered: {m.ordered_qty} → Received: {m.received_qty}
                                                {m.reason && <span style={{ marginLeft: 8, fontStyle: 'italic', color: '#f59e0b' }}>— {m.reason}</span>}
                                            </div>
                                        </div>
                                        <span style={{ fontSize: 'var(--text-xs)', fontWeight: 700, color: m.discrepancy_type === 'missing' ? '#ef4444' : '#f59e0b', whiteSpace: 'nowrap' }}>
                                            {m.discrepancy_type === 'missing' ? `↓ ${m.discrepancy_qty}` : `↑ ${m.discrepancy_qty}`}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Signature */}
                    {detailOrder.delivery_signature && (
                        <div style={{ marginBottom: 'var(--space-5)' }}>
                            <h4 style={{ margin: '0 0 var(--space-3)', fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)' }}>✍️ Signature</h4>
                            <div style={{
                                border: '1px solid var(--color-border)',
                                borderRadius: 8,
                                padding: 'var(--space-3)',
                                background: '#ffffff',
                                display: 'inline-block',
                            }}>
                                <img
                                    src={detailOrder.delivery_signature}
                                    alt="Manager signature"
                                    style={{ maxWidth: '100%', maxHeight: 120, display: 'block' }}
                                />
                            </div>
                        </div>
                    )}

                    {/* Delivery Notes */}
                    {detailOrder.delivery_notes && (
                        <div>
                            <h4 style={{ margin: '0 0 var(--space-3)', fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)' }}>📝 Delivery Notes</h4>
                            <div style={{
                                padding: 'var(--space-3)',
                                background: 'var(--color-surface-hover)',
                                borderRadius: 8,
                                fontSize: 'var(--text-sm)',
                                color: 'var(--color-text-secondary)',
                                lineHeight: 1.5,
                            }}>
                                {detailOrder.delivery_notes}
                            </div>
                        </div>
                    )}

                    {/* Timeline */}
                    <div style={{ marginTop: 'var(--space-5)' }}>
                        <h4 style={{ margin: '0 0 var(--space-3)', fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)' }}>⏱️ Timeline</h4>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                            {[
                                { label: 'Order Placed', time: detailOrder.created_at },
                                { label: 'Ready for Pickup', time: detailOrder.ready_at },
                                { label: 'Assigned', time: detailOrder.assigned_at },
                                { label: 'Picked Up', time: detailOrder.dispatched_at || detailOrder.picked_up_at },
                                { label: 'Delivered', time: detailOrder.delivered_at },
                            ].filter(s => s.time).map((step, idx) => (
                                <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
                                    <MdCheckCircle style={{ color: '#22c55e', fontSize: 16, flexShrink: 0 }} />
                                    <span style={{ fontSize: 'var(--text-sm)', fontWeight: 500, minWidth: 130 }}>{step.label}</span>
                                    <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>{formatDateTime(step.time)}</span>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
                <div className="modal-footer" style={{ display: 'flex', justifyContent: 'flex-end', padding: '16px 24px', borderTop: '1px solid var(--color-border)' }}>
                    <button className="btn btn-secondary btn-md" onClick={onClose}>Close</button>
                </div>
            </div>
        </div>
    );
};

export default DeliveryDetailModal;
