import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
    getOrders,
    getStatusInfo,
    bulkMarkReady,
    cancelOrder,
} from '../../services/orderService';
import {
    MdRefresh,
    MdCheckBox,
    MdCheckBoxOutlineBlank,
    MdLocalShipping,
    MdCancel,
    MdVisibility,
    MdSearch,
    MdClose,
    MdPending,
} from 'react-icons/md';
import toast from 'react-hot-toast';
import './Orders.css';

/**
 * IncomingOrders — Shows PENDING orders only.
 * This is a focused view for CK staff to quickly process new orders.
 * For the full order grid with all statuses, see OrdersGrid.js.
 */
const IncomingOrders = () => {
    const [orders, setOrders] = useState([]);
    const [loading, setLoading] = useState(true);
    const [searchQuery, setSearchQuery] = useState('');
    const [selectedIds, setSelectedIds] = useState(new Set());
    const [bulkLoading, setBulkLoading] = useState(false);
    const [detailOrder, setDetailOrder] = useState(null);
    const [cancelModal, setCancelModal] = useState(null);
    const [cancelReason, setCancelReason] = useState('');

    const loadOrders = useCallback(async () => {
        setLoading(true);
        try {
            const data = await getOrders({ status: 'pending' });
            setOrders(data);
        } catch (err) {
            console.error('Failed to load orders:', err);
            toast.error('Failed to load incoming orders');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        loadOrders();
    }, [loadOrders]);

    const filteredOrders = useMemo(() => {
        if (!searchQuery.trim()) return orders;
        const q = searchQuery.toLowerCase();
        return orders.filter(o =>
            o.order_number?.toLowerCase().includes(q) ||
            o.restaurant_name?.toLowerCase().includes(q)
        );
    }, [orders, searchQuery]);

    // Selection handlers
    const toggleSelect = (id) => {
        setSelectedIds(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

    const toggleSelectAll = () => {
        if (selectedIds.size === filteredOrders.length) {
            setSelectedIds(new Set());
        } else {
            setSelectedIds(new Set(filteredOrders.map(o => o.id)));
        }
    };

    // Bulk mark ready
    const handleBulkReady = async () => {
        if (selectedIds.size === 0) {
            toast.error('No orders selected');
            return;
        }

        setBulkLoading(true);
        try {
            const results = await bulkMarkReady([...selectedIds]);
            const successCount = results.filter(r => r.success).length;
            const failCount = results.filter(r => !r.success).length;

            if (successCount > 0) {
                toast.success(`${successCount} order(s) marked ready for pickup`);
            }
            if (failCount > 0) {
                toast.error(`${failCount} order(s) failed to process`);
            }

            setSelectedIds(new Set());
            await loadOrders();
        } catch (err) {
            toast.error('Bulk operation failed');
        } finally {
            setBulkLoading(false);
        }
    };

    const handleCancel = async () => {
        if (!cancelModal) return;
        try {
            await cancelOrder(cancelModal.id, cancelReason);
            toast.success('Order cancelled');
            setCancelModal(null);
            setCancelReason('');
            await loadOrders();
        } catch (err) {
            toast.error(err.message || 'Failed to cancel order');
        }
    };

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

    // Stats
    const totalValue = orders.reduce((sum, o) => sum + (o.total || 0), 0);
    const totalItems = orders.reduce((sum, o) => sum + (o.item_count || o.items?.length || 0), 0);

    return (
        <div className="page-content">
            <div className="page-header">
                <div>
                    <h1 className="page-title">Incoming Orders</h1>
                    <p className="page-subtitle">New pending orders from restaurants — review and prepare</p>
                </div>
                <div style={{ display: 'flex', gap: 'var(--space-3)' }}>
                    <button className="btn-refresh" onClick={loadOrders} disabled={loading}><MdRefresh className={loading ? 'spin' : ''} /></button>
                </div>
            </div>

            {/* Summary Cards */}
            <div className="incoming-stat-cards">
                <div className="incoming-stat-card">
                    <div className="incoming-stat-value">{orders.length}</div>
                    <div className="incoming-stat-label">Pending Orders</div>
                </div>
                <div className="incoming-stat-card">
                    <div className="incoming-stat-value">{totalItems}</div>
                    <div className="incoming-stat-label">Total Items</div>
                </div>
                <div className="incoming-stat-card">
                    <div className="incoming-stat-value">£{totalValue.toFixed(2)}</div>
                    <div className="incoming-stat-label">Total Value</div>
                </div>
            </div>

            {/* Search */}
            <div className="orders-search-bar">
                <MdSearch className="orders-search-icon" />
                <input
                    type="text"
                    placeholder="Search by order number or restaurant..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                />
            </div>

            {/* Bulk Action Toolbar */}
            {selectedIds.size > 0 && (
                <div className="bulk-toolbar">
                    <div className="bulk-toolbar-info">
                        <MdCheckBox /> {selectedIds.size} order(s) selected
                    </div>
                    <div className="bulk-toolbar-actions">
                        <button
                            className="btn-bulk primary"
                            onClick={handleBulkReady}
                            disabled={bulkLoading}
                        >
                            <MdLocalShipping /> {bulkLoading ? 'Processing...' : 'Mark as Ready for Pickup'}
                        </button>
                        <button
                            className="btn-bulk danger"
                            onClick={() => setSelectedIds(new Set())}
                        >
                            Clear Selection
                        </button>
                    </div>
                </div>
            )}

            {/* Orders Table */}
            <div className="orders-table-wrapper">
                <table className="data-table">
                    <thead>
                        <tr>
                            <th style={{ width: 40 }}>
                                <span style={{ cursor: 'pointer' }} onClick={toggleSelectAll}>
                                    {selectedIds.size === filteredOrders.length && filteredOrders.length > 0
                                        ? <MdCheckBox size={20} />
                                        : <MdCheckBoxOutlineBlank size={20} />
                                    }
                                </span>
                            </th>
                            <th>ORDER #</th>
                            <th>RESTAURANT</th>
                            <th>DATE</th>
                            <th>ITEMS</th>
                            <th>SUBTOTAL</th>
                            <th>VAT</th>
                            <th>TOTAL</th>
                            <th>ACTIONS</th>
                        </tr>
                    </thead>
                    <tbody>
                        {loading ? (
                            Array.from({ length: 5 }).map((_, i) => (
                                <tr key={i}>
                                    {Array.from({ length: 9 }).map((_, j) => (
                                        <td key={j}><div className="skeleton skeleton-text"></div></td>
                                    ))}
                                </tr>
                            ))
                        ) : filteredOrders.length === 0 ? (
                            <tr>
                                <td colSpan="9">
                                    <div className="empty-state">
                                        <span style={{ fontSize: 40 }}>✅</span>
                                        <p>No pending orders — all caught up!</p>
                                    </div>
                                </td>
                            </tr>
                        ) : (
                            filteredOrders.map(order => {
                                const isSelected = selectedIds.has(order.id);
                                const itemPreview = order.items?.map(i => i.item_name).join(', ') || '';

                                return (
                                    <tr
                                        key={order.id}
                                        className={isSelected ? 'order-row-selected' : ''}
                                    >
                                        <td>
                                            <span style={{ cursor: 'pointer' }} onClick={() => toggleSelect(order.id)}>
                                                {isSelected
                                                    ? <MdCheckBox size={20} style={{ color: 'var(--color-primary)' }} />
                                                    : <MdCheckBoxOutlineBlank size={20} />
                                                }
                                            </span>
                                        </td>
                                        <td>
                                            <strong>{order.order_number}</strong>
                                            {order.admin_created && (
                                                <span className="admin-order-badge">👤 Admin</span>
                                            )}
                                        </td>
                                        <td>{order.restaurant_name || '—'}</td>
                                        <td>{formatDate(order.created_at)}</td>
                                        <td>
                                            <div>{order.item_count || order.items?.length || 0} item(s)</div>
                                            <div className="order-items-preview">{itemPreview}</div>
                                        </td>
                                        <td>£{(order.subtotal || 0).toFixed(2)}</td>
                                        <td>£{(order.vat_amount || 0).toFixed(2)}</td>
                                        <td><strong>£{(order.total || 0).toFixed(2)}</strong></td>
                                        <td>
                                            <div className="action-btns">
                                                <button
                                                    className="btn-action"
                                                    title="View Details"
                                                    onClick={() => setDetailOrder(order)}
                                                >
                                                    <MdVisibility />
                                                </button>
                                                <button
                                                    className="btn-action delete"
                                                    title="Cancel Order"
                                                    onClick={() => setCancelModal(order)}
                                                >
                                                    <MdCancel />
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                );
                            })
                        )}
                    </tbody>
                </table>
            </div>

            {/* ─── Order Detail Modal ─── */}
            {detailOrder && (
                <div className="modal-overlay" onClick={() => setDetailOrder(null)}>
                    <div className="modal modal-lg" onClick={(e) => e.stopPropagation()}>
                        <div className="modal-header">
                            <h2>
                                Order {detailOrder.order_number}
                                {detailOrder.admin_created && (
                                    <span className="admin-order-badge">👤 Admin</span>
                                )}
                            </h2>
                            <button className="btn btn-icon" onClick={() => setDetailOrder(null)}>
                                <MdClose />
                            </button>
                        </div>
                        <div className="modal-body">
                            <div className="order-detail-section">
                                <h4>Order Details</h4>
                                <div className="order-info-grid">
                                    <div className="order-info-item">
                                        <label>Restaurant</label>
                                        <span>{detailOrder.restaurant_name}</span>
                                    </div>
                                    <div className="order-info-item">
                                        <label>Status</label>
                                        <span className="order-status-badge" style={{
                                            background: 'var(--color-warning-bg)',
                                            color: 'var(--color-warning)',
                                        }}>
                                            <MdPending /> Pending
                                        </span>
                                    </div>
                                    <div className="order-info-item">
                                        <label>Order Date</label>
                                        <span>{formatDateTime(detailOrder.created_at)}</span>
                                    </div>
                                    <div className="order-info-item">
                                        <label>Total Items</label>
                                        <span>{detailOrder.item_count || detailOrder.items?.length || 0}</span>
                                    </div>
                                    {detailOrder.notes && (
                                        <div className="order-info-item" style={{ gridColumn: '1 / -1' }}>
                                            <label>Notes</label>
                                            <span>{detailOrder.notes}</span>
                                        </div>
                                    )}
                                </div>
                            </div>

                            <div className="order-detail-section">
                                <h4>Items</h4>
                                <table className="order-items-table">
                                    <thead>
                                        <tr>
                                            <th>Item</th>
                                            <th>Type</th>
                                            <th>Category</th>
                                            <th>Qty</th>
                                            <th>Unit</th>
                                            <th>Price</th>
                                            <th>VAT</th>
                                            <th>Total</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {detailOrder.items?.map((item, idx) => (
                                            <tr key={idx}>
                                                <td><strong>{item.item_name}</strong></td>
                                                <td>{item.item_type || '—'}</td>
                                                <td style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)' }}>{item.category_name || '—'}</td>
                                                <td>{item.quantity}</td>
                                                <td>{item.unit}</td>
                                                <td>£{(item.selling_price || 0).toFixed(2)}</td>
                                                <td>{item.vat_rate || 0}%</td>
                                                <td>£{(item.line_total || 0).toFixed(2)}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                    <tfoot>
                                        <tr>
                                            <td colSpan="7" style={{ textAlign: 'right' }}>Subtotal</td>
                                            <td>£{(detailOrder.subtotal || 0).toFixed(2)}</td>
                                        </tr>
                                        <tr>
                                            <td colSpan="7" style={{ textAlign: 'right' }}>VAT</td>
                                            <td>£{(detailOrder.vat_amount || 0).toFixed(2)}</td>
                                        </tr>
                                        <tr>
                                            <td colSpan="7" style={{ textAlign: 'right', fontSize: 'var(--text-base)' }}>Total</td>
                                            <td style={{ fontSize: 'var(--text-base)' }}>£{(detailOrder.total || 0).toFixed(2)}</td>
                                        </tr>
                                    </tfoot>
                                </table>
                            </div>
                        </div>
                        <div className="modal-footer">
                            <button
                                className="btn btn-primary"
                                onClick={async () => {
                                    try {
                                        await bulkMarkReady([detailOrder.id]);
                                        toast.success('Order marked as ready for pickup');
                                        setDetailOrder(null);
                                        await loadOrders();
                                    } catch (err) {
                                        toast.error('Failed to update order');
                                    }
                                }}
                            >
                                <MdLocalShipping /> Mark Ready for Pickup
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* ─── Cancel Modal ─── */}
            {cancelModal && (
                <div className="modal-overlay" onClick={() => setCancelModal(null)}>
                    <div className="modal modal-md" onClick={(e) => e.stopPropagation()}>
                        <div className="modal-header">
                            <h2>Cancel Order {cancelModal.order_number}</h2>
                            <button className="btn btn-icon" onClick={() => setCancelModal(null)}>
                                <MdClose />
                            </button>
                        </div>
                        <div className="modal-body">
                            <p style={{ marginBottom: 'var(--space-4)', color: 'var(--color-text-secondary)' }}>
                                Are you sure you want to cancel this order from <strong>{cancelModal.restaurant_name}</strong>?
                                This action cannot be undone.
                            </p>
                            <div className="form-group">
                                <label>Reason (optional)</label>
                                <textarea
                                    value={cancelReason}
                                    onChange={(e) => setCancelReason(e.target.value)}
                                    placeholder="Enter cancellation reason..."
                                    rows={3}
                                />
                            </div>
                        </div>
                        <div className="modal-footer">
                            <button className="btn btn-secondary" onClick={() => setCancelModal(null)}>
                                Keep Order
                            </button>
                            <button className="btn btn-danger" onClick={handleCancel}>
                                Cancel Order
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default IncomingOrders;
