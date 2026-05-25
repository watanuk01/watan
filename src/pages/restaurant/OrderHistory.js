import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { getRestaurantOrders, getStatusInfo, subscribeToRestaurantOrders } from '../../services/orderService';
import { downloadSingleOrderPDF } from '../../services/orderExportService';
import {
    MdRefresh,
    MdFilterList,
    MdSearch,
    MdVisibility,
    MdClose,
    MdReceipt,
    MdFileDownload,
} from 'react-icons/md';
import toast from 'react-hot-toast';
import './Restaurant.css';
import '../orders/Orders.css';

const OrderHistory = () => {
    const { currentUser } = useAuth();
    const [orders, setOrders] = useState([]);
    const [loading, setLoading] = useState(true);
    const [statusFilter, setStatusFilter] = useState('all');
    const [searchQuery, setSearchQuery] = useState('');
    const [detailOrder, setDetailOrder] = useState(null);

    const loadOrders = useCallback(async () => {
        setLoading(true);
        try {
            const data = await getRestaurantOrders(currentUser.uid);
            setOrders(data);
        } catch (err) {
            console.error('Failed to load orders:', err);
            toast.error('Failed to load order history');
        } finally {
            setLoading(false);
        }
    }, [currentUser.uid]);

    // Real-time subscription for live updates
    useEffect(() => {
        setLoading(true);
        const unsubscribe = subscribeToRestaurantOrders(currentUser.uid, (data) => {
            setOrders(data);
            setLoading(false);
        });
        return () => unsubscribe();
    }, [currentUser.uid]);

    const filteredOrders = useMemo(() => {
        let result = orders;
        if (statusFilter !== 'all') {
            result = result.filter(o => o.status === statusFilter);
        }
        if (searchQuery.trim()) {
            const q = searchQuery.toLowerCase();
            result = result.filter(o =>
                o.order_number?.toLowerCase().includes(q)
            );
        }
        return result;
    }, [orders, statusFilter, searchQuery]);

    const formatDate = (date) => {
        if (!date) return '—';
        const d = date instanceof Date ? date : new Date(date);
        if (isNaN(d.getTime())) return '—';
        return d.toLocaleDateString('en-GB', {
            day: '2-digit', month: 'short', year: 'numeric',
        });
    };

    const formatDateTime = (date) => {
        if (!date) return '—';
        const d = date instanceof Date ? date : new Date(date);
        if (isNaN(d.getTime())) return '—';
        return d.toLocaleDateString('en-GB', {
            day: '2-digit', month: 'short', year: 'numeric',
            hour: '2-digit', minute: '2-digit',
        });
    };

    return (
        <div className="page-content">
            <div className="page-header">
                <div>
                    <h1 className="page-title">Order History</h1>
                    <p className="page-subtitle">View all your orders to central kitchen</p>
                </div>
                <button className="btn-refresh" onClick={loadOrders} disabled={loading}><MdRefresh className={loading ? 'spin' : ''} /></button>
            </div>

            {/* Filters */}
            <div style={{
                display: 'flex',
                gap: 'var(--space-3)',
                marginBottom: 'var(--space-5)',
                flexWrap: 'wrap',
                alignItems: 'center',
            }}>
                <div className="search-box" style={{ flex: 1, minWidth: 200 }}>
                    <MdSearch />
                    <input
                        type="text"
                        placeholder="Search order number..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                    />
                </div>
                <select
                    className="form-input"
                    value={statusFilter}
                    onChange={(e) => setStatusFilter(e.target.value)}
                    style={{
                        padding: '10px 14px',
                        borderRadius: 'var(--radius-md)',
                        fontSize: 'var(--text-sm)',
                        minWidth: 160,
                    }}
                >
                    <option value="all">All Statuses</option>
                    <option value="pending">Pending</option>
                    <option value="ready_for_pickup">Ready for Pickup</option>
                    <option value="assigned">Assigned</option>
                    <option value="out_for_delivery">Out for Delivery</option>
                    <option value="delivered">Delivered</option>
                    <option value="cancelled">Cancelled</option>
                </select>
            </div>

            {/* Orders List */}
            {loading ? (
                Array.from({ length: 3 }).map((_, i) => (
                    <div key={i} className="order-history-card" style={{ opacity: 0.5 }}>
                        <div className="skeleton skeleton-text" style={{ width: '30%', height: 18 }} />
                        <div className="skeleton skeleton-text" style={{ width: '60%', height: 14, marginTop: 8 }} />
                        <div className="skeleton skeleton-text" style={{ width: '40%', height: 14, marginTop: 8 }} />
                    </div>
                ))
            ) : filteredOrders.length === 0 ? (
                <div style={{
                    textAlign: 'center',
                    padding: 'var(--space-12)',
                    color: 'var(--color-text-tertiary)',
                }}>
                    <MdReceipt style={{ fontSize: 60, opacity: 0.3, marginBottom: 'var(--space-4)' }} />
                    <h3>No orders found</h3>
                    <p>Your order history will appear here</p>
                </div>
            ) : (
                filteredOrders.map(order => {
                    const statusInfo = getStatusInfo(order.status);
                    return (
                        <div
                            key={order.id}
                            className="order-history-card"
                            style={{ cursor: 'pointer' }}
                            onClick={() => setDetailOrder(order)}
                        >
                            <div className="order-card-header">
                                <div>
                                    <div className="order-card-number">{order.order_number}</div>
                                    <div className="order-card-date">{formatDate(order.created_at)}</div>
                                </div>
                                <span className="order-status-badge" style={{
                                    background: `${statusInfo.color}15`,
                                    color: statusInfo.color,
                                }}>
                                    {statusInfo.icon} {statusInfo.label}
                                </span>
                            </div>
                            <div className="order-card-items">
                                {order.items?.map(i => i.item_name).join(', ') || 'No items'}
                            </div>
                            <div className="order-card-footer">
                                <span style={{ color: 'var(--color-text-tertiary)', fontSize: 'var(--text-sm)' }}>
                                    {order.item_count || order.items?.length || 0} item(s)
                                </span>
                                <div className="order-card-total">£{(order.total || 0).toFixed(2)}</div>
                            </div>
                        </div>
                    );
                })
            )}

            {/* Detail Modal */}
            {detailOrder && (() => {
                const statusInfo = getStatusInfo(detailOrder.status);
                return (
                    <div className="modal-overlay" onClick={() => setDetailOrder(null)}>
                        <div className="modal modal-lg" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 720, borderRadius: 16 }}>
                            {/* Header */}
                            <div className="modal-header" style={{ borderBottom: '1px solid var(--color-border)', padding: '20px 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <div>
                                    <h2 style={{ margin: 0, fontSize: '1.2rem' }}>Order {detailOrder.order_number}</h2>
                                    <span style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)' }}>{detailOrder.restaurant_name || ''}</span>
                                </div>
                                <button className="btn-refresh" onClick={() => setDetailOrder(null)} style={{ width: 36, height: 36 }}>
                                    <MdClose size={20} />
                                </button>
                            </div>

                            {/* Body */}
                            <div className="modal-body" style={{ padding: '24px' }}>
                                {/* Info Cards */}
                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12, marginBottom: 24 }}>
                                    <div style={{ background: `${statusInfo.color}15`, borderRadius: 10, padding: '12px 16px' }}>
                                        <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-tertiary)', marginBottom: 4 }}>Status</div>
                                        <div style={{ fontWeight: 700, color: statusInfo.color, display: 'flex', alignItems: 'center', gap: 6 }}>{statusInfo.icon} {statusInfo.label}</div>
                                    </div>
                                    <div style={{ background: 'var(--color-surface-hover)', borderRadius: 10, padding: '12px 16px' }}>
                                        <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-tertiary)', marginBottom: 4 }}>Order Date</div>
                                        <div style={{ fontWeight: 600 }}>{formatDateTime(detailOrder.created_at)}</div>
                                    </div>
                                    <div style={{ background: 'var(--color-surface-hover)', borderRadius: 10, padding: '12px 16px' }}>
                                        <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-tertiary)', marginBottom: 4 }}>Total Items</div>
                                        <div style={{ fontWeight: 600 }}>{detailOrder.item_count || detailOrder.items?.length || 0}</div>
                                    </div>
                                    <div style={{ background: 'var(--color-surface-hover)', borderRadius: 10, padding: '12px 16px' }}>
                                        <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-tertiary)', marginBottom: 4 }}>Grand Total</div>
                                        <div style={{ fontWeight: 700, fontSize: '1.1em', color: 'var(--color-primary)' }}>£{(detailOrder.total || 0).toFixed(2)}</div>
                                    </div>
                                </div>

                                {detailOrder.invoice_number && (
                                    <div style={{ background: 'var(--color-surface-hover)', borderRadius: 8, padding: '10px 14px', marginBottom: 16, fontSize: 'var(--text-sm)' }}>
                                        📄 Invoice: <strong>{detailOrder.invoice_number}</strong>
                                    </div>
                                )}

                                {detailOrder.delivered_at && (
                                    <div style={{ background: 'rgba(34,197,94,0.1)', borderRadius: 8, padding: '10px 14px', marginBottom: 16, fontSize: 'var(--text-sm)', color: '#22c55e' }}>
                                        ✅ Delivered: <strong>{formatDateTime(detailOrder.delivered_at)}</strong>
                                    </div>
                                )}

                                {detailOrder.notes && (
                                    <div style={{ background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.3)', borderRadius: 8, padding: '10px 14px', marginBottom: 20, fontSize: 'var(--text-sm)' }}>
                                        <strong style={{ color: '#f59e0b' }}>Notes:</strong> {detailOrder.notes}
                                    </div>
                                )}

                                {/* Items Table */}
                                <div style={{ border: '1px solid var(--color-border)', borderRadius: 10, overflowX: 'auto', width: '100%' }}>
                                    <table className="data-table" style={{ margin: 0 }}>
                                        <thead>
                                            <tr>
                                                <th>Item</th>
                                                <th>Type</th>
                                                <th>Category</th>
                                                <th style={{ textAlign: 'center' }}>Qty</th>
                                                <th>Unit</th>
                                                <th style={{ textAlign: 'right' }}>Price</th>
                                                <th style={{ textAlign: 'right' }}>VAT</th>
                                                <th style={{ textAlign: 'right' }}>Total</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {detailOrder.items?.map((item, idx) => (
                                                <tr key={idx}>
                                                    <td><strong>{item.item_name}</strong></td>
                                                    <td style={{ opacity: 0.7 }}>{item.item_type || '—'}</td>
                                                    <td style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)' }}>{item.category_name || '—'}</td>
                                                    <td style={{ textAlign: 'center', fontWeight: 600 }}>{item.quantity}</td>
                                                    <td>{item.unit}</td>
                                                    <td style={{ textAlign: 'right' }}>£{(item.selling_price || 0).toFixed(2)}</td>
                                                    <td style={{ textAlign: 'right', opacity: 0.7 }}>{item.vat_rate || 0}%</td>
                                                    <td style={{ textAlign: 'right', fontWeight: 600 }}>£{(item.line_total || 0).toFixed(2)}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                        <tfoot>
                                            <tr>
                                                <td colSpan="6" style={{ textAlign: 'right', fontWeight: 500, opacity: 0.9, color: 'var(--color-text-primary)' }}>Subtotal</td>
                                                <td colSpan="2" style={{ textAlign: 'right', color: 'var(--color-text-primary)', fontWeight: 500 }}>£{(detailOrder.subtotal || 0).toFixed(2)}</td>
                                            </tr>
                                            <tr>
                                                <td colSpan="6" style={{ textAlign: 'right', fontWeight: 500, opacity: 0.9, color: 'var(--color-text-primary)' }}>VAT</td>
                                                <td colSpan="2" style={{ textAlign: 'right', color: 'var(--color-text-primary)', fontWeight: 500 }}>£{(detailOrder.vat_amount || 0).toFixed(2)}</td>
                                            </tr>
                                            <tr>
                                                <td colSpan="6" style={{ textAlign: 'right', fontWeight: 700, color: 'var(--color-text-primary)' }}>Total</td>
                                                <td colSpan="2" style={{ textAlign: 'right', fontWeight: 700, color: 'var(--color-primary)' }}>£{(detailOrder.total || 0).toFixed(2)}</td>
                                            </tr>
                                        </tfoot>
                                    </table>
                                </div>
                            </div>

                            {/* Footer */}
                            <div className="modal-footer" style={{ borderTop: '1px solid var(--color-border)', padding: '16px 24px', display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-3)' }}>
                                <button
                                    className="btn btn-secondary btn-md"
                                    onClick={() => {
                                        try {
                                            downloadSingleOrderPDF(detailOrder);
                                            toast.success('PDF downloaded');
                                        } catch (err) {
                                            console.error('PDF error:', err);
                                            toast.error('Failed to generate PDF');
                                        }
                                    }}
                                    style={{ display: 'flex', alignItems: 'center', gap: 6 }}
                                >
                                    <MdFileDownload /> Download PDF
                                </button>
                                <button className="btn btn-secondary btn-md" onClick={() => setDetailOrder(null)}>
                                    Close
                                </button>
                            </div>
                        </div>
                    </div>
                );
            })()}
        </div>
    );
};

export default OrderHistory;
