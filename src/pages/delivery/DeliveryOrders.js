import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import {
    getDeliveryPartnerOrders,
    getUndeliveredOrders,
    assignDeliveryPartner,
    pickupOrder,
    completeDelivery,
    getStatusInfo,
    subscribeToDeliveryPartnerOrders,
    subscribeToOrders,
} from '../../services/orderService';
import {
    MdRefresh,
    MdLocalShipping,
    MdCheckCircle,
    MdAccessTime,
    MdShoppingCart,
    MdClose,
    MdWarning,
    MdHistory,
    MdArrowUpward,
} from 'react-icons/md';
import toast from 'react-hot-toast';
import '../orders/Orders.css';

const DeliveryOrders = () => {
    const { currentUser, userProfile } = useAuth();
    const [activeTab, setActiveTab] = useState('assigned');
    const [assignedOrders, setAssignedOrders] = useState([]);
    const [poolOrders, setPoolOrders] = useState([]);
    const [historyOrders, setHistoryOrders] = useState([]);
    const [loading, setLoading] = useState(true);
    const [assigningId, setAssigningId] = useState(null);

    // Pickup verification state
    const [pickupOrder_, setPickupOrder_] = useState(null);
    const [verifiedItems, setVerifiedItems] = useState([]);

    // Delivery confirm state
    const [confirmOrder, setConfirmOrder] = useState(null);
    const [managerName, setManagerName] = useState('');
    const [deliveryNotes, setDeliveryNotes] = useState('');
    const [completing, setCompleting] = useState(false);
    const [pickingUp, setPickingUp] = useState(false);

    // Signature — use useRef to avoid re-initialization on re-render
    const sigCanvasRef = useRef(null);
    const sigInitializedRef = useRef(false);

    // Real-time subscription instead of polling
    useEffect(() => {
        setLoading(true);
        // Subscribe to delivery partner's orders
        const unsubPartner = subscribeToDeliveryPartnerOrders(currentUser.uid, (allPartnerOrders) => {
            setAssignedOrders(allPartnerOrders.filter(o =>
                ['assigned', 'out_for_delivery'].includes(o.status)
            ));
            setHistoryOrders(allPartnerOrders.filter(o =>
                ['delivered', 'cancelled'].includes(o.status)
            ));
            setLoading(false);
        });
        // Subscribe to all orders for the pool (ready_for_pickup)
        const unsubPool = subscribeToOrders((allOrders) => {
            setPoolOrders(allOrders.filter(o => o.status === 'ready_for_pickup'));
        });
        return () => { unsubPartner(); unsubPool(); };
    }, [currentUser.uid]);

    const handleAssign = async (orderId) => {
        setAssigningId(orderId);
        try {
            await assignDeliveryPartner(
                orderId,
                currentUser.uid,
                userProfile?.name || 'Delivery Partner'
            );
            toast.success('Order assigned to you!');
            setActiveTab('assigned');
        } catch (err) {
            toast.error(err.message || 'Failed to assign order');
        } finally {
            setAssigningId(null);
        }
    };

    // ─── Pickup Verification ───
    const openPickupVerification = (order) => {
        const items = (order.items || []).map(item => ({
            ...item,
            received_qty: String(item.quantity),
            has_discrepancy: false,
            discrepancy_type: '', // 'missing' or 'excess'
            discrepancy_qty: 0,
            missing_reason: '',
        }));
        setVerifiedItems(items);
        setPickupOrder_(order);
    };

    // Issue 7: Allow empty string — only coerce to number on submit
    const handleVerifiedQtyChange = (index, value) => {
        setVerifiedItems(prev => prev.map((item, i) => {
            if (i !== index) return item;
            const receivedQty = parseFloat(value);
            const orderedQty = item.quantity;
            const isValid = value !== '' && !isNaN(receivedQty);
            const isMissing = isValid && receivedQty < orderedQty;
            const isExcess = isValid && receivedQty > orderedQty;
            return {
                ...item,
                received_qty: value, // keep as string — no auto zero
                has_discrepancy: isMissing || isExcess,
                discrepancy_type: isMissing ? 'missing' : isExcess ? 'excess' : '',
                discrepancy_qty: isValid ? Math.abs(orderedQty - receivedQty) : 0,
            };
        }));
    };

    const handleMissingReason = (index, reason) => {
        setVerifiedItems(prev => prev.map((item, i) =>
            i === index ? { ...item, missing_reason: reason } : item
        ));
    };

    const handleConfirmPickup = async () => {
        if (!pickupOrder_) return;

        // Issue 7: Validate on submit — coerce empty strings to 0
        const hasEmpty = verifiedItems.some(item => item.received_qty === '' || item.received_qty === null);
        if (hasEmpty) {
            toast.error('Please enter received quantity for all items');
            return;
        }

        setPickingUp(true);
        try {
            const confirmed = verifiedItems.map(item => ({
                item_id: item.item_id,
                item_name: item.item_name,
                item_type: item.item_type,
                unit: item.unit,
                quantity: parseFloat(item.received_qty) || 0,
                cost_price: item.cost_price,
                selling_price: item.selling_price,
                vat_rate: item.vat_rate,
                vat_exempt: item.vat_exempt,
            }));
            const missing = verifiedItems
                .filter(item => item.has_discrepancy && item.discrepancy_qty > 0)
                .map(item => ({
                    item_id: item.item_id,
                    item_name: item.item_name,
                    ordered_qty: item.quantity,
                    received_qty: parseFloat(item.received_qty) || 0,
                    discrepancy_qty: item.discrepancy_qty,
                    discrepancy_type: item.discrepancy_type,
                    reason: item.missing_reason || '',
                }));

            await pickupOrder(pickupOrder_.id, {
                verifiedItems: confirmed,
                missingItems: missing,
            });
            toast.success('Pickup confirmed! Order is now out for delivery.');
            setPickupOrder_(null);
            setVerifiedItems([]);
        } catch (err) {
            toast.error(err.message || 'Failed to confirm pickup');
        } finally {
            setPickingUp(false);
        }
    };

    // ─── Signature Pad (Issue 8: use useEffect, not ref callback) ───
    useEffect(() => {
        const canvas = sigCanvasRef.current;
        if (!canvas || !confirmOrder) {
            sigInitializedRef.current = false;
            return;
        }
        if (sigInitializedRef.current) return; // Already initialized
        sigInitializedRef.current = true;

        const ctx = canvas.getContext('2d');
        canvas.width = canvas.offsetWidth;
        canvas.height = 150;
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.strokeStyle = '#1e293b';
        ctx.lineWidth = 2;
        ctx.lineCap = 'round';

        let drawing = false;
        const getPos = (e) => {
            const rect = canvas.getBoundingClientRect();
            const clientX = e.touches ? e.touches[0].clientX : e.clientX;
            const clientY = e.touches ? e.touches[0].clientY : e.clientY;
            return { x: clientX - rect.left, y: clientY - rect.top };
        };

        const start = (e) => { e.preventDefault(); drawing = true; const pos = getPos(e); ctx.beginPath(); ctx.moveTo(pos.x, pos.y); };
        const draw = (e) => { if (!drawing) return; e.preventDefault(); const pos = getPos(e); ctx.lineTo(pos.x, pos.y); ctx.stroke(); };
        const stop = () => { drawing = false; };

        canvas.addEventListener('mousedown', start);
        canvas.addEventListener('mousemove', draw);
        canvas.addEventListener('mouseup', stop);
        canvas.addEventListener('mouseleave', stop);
        canvas.addEventListener('touchstart', start, { passive: false });
        canvas.addEventListener('touchmove', draw, { passive: false });
        canvas.addEventListener('touchend', stop);

        return () => {
            canvas.removeEventListener('mousedown', start);
            canvas.removeEventListener('mousemove', draw);
            canvas.removeEventListener('mouseup', stop);
            canvas.removeEventListener('mouseleave', stop);
            canvas.removeEventListener('touchstart', start);
            canvas.removeEventListener('touchmove', draw);
            canvas.removeEventListener('touchend', stop);
        };
    }, [confirmOrder]);

    const clearSignature = () => {
        const canvas = sigCanvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
    };

    const handleComplete = async () => {
        if (!confirmOrder) return;
        if (!managerName.trim()) {
            toast.error('Please enter the manager name');
            return;
        }
        setCompleting(true);
        try {
            let signature = null;
            const canvas = sigCanvasRef.current;
            if (canvas) { signature = canvas.toDataURL('image/png'); }
            await completeDelivery(confirmOrder.id, { managerName, signature, notes: deliveryNotes });
            toast.success('Delivery completed!');
            setConfirmOrder(null);
            setManagerName('');
            setDeliveryNotes('');
            sigInitializedRef.current = false;
        } catch (err) {
            toast.error(err.message || 'Failed to complete delivery');
        } finally {
            setCompleting(false);
        }
    };

    const formatDateTime = (date) => {
        if (!date) return '—';
        const d = date instanceof Date ? date : new Date(date);
        if (isNaN(d.getTime())) return '—';
        return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
    };

    const getTimeSince = (date) => {
        if (!date) return '';
        const diff = Math.floor((new Date() - date) / 60000);
        if (diff < 60) return `${diff}m ago`;
        if (diff < 1440) return `${Math.floor(diff / 60)}h ago`;
        return `${Math.floor(diff / 1440)}d ago`;
    };

    const getActionButton = (order) => {
        if (order.status === 'assigned') {
            return (
                <button
                    className="btn-assign"
                    style={{ background: 'linear-gradient(135deg, #3b82f6, #2563eb)' }}
                    onClick={() => openPickupVerification(order)}
                >
                    <MdShoppingCart style={{ marginRight: 6, verticalAlign: 'middle' }} /> Pickup
                </button>
            );
        }
        if (order.status === 'out_for_delivery') {
            return (
                <button
                    className="btn-assign"
                    style={{ background: 'linear-gradient(135deg, #22c55e, #16a34a)' }}
                    onClick={() => { setConfirmOrder(order); sigInitializedRef.current = false; }}
                >
                    <MdCheckCircle style={{ marginRight: 6, verticalAlign: 'middle' }} /> Mark Delivered
                </button>
            );
        }
        return null;
    };

    // Issue 5: card border style + Issue 3: padding
    const cardBorderStyle = {
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-lg, 12px)',
        padding: 'var(--space-4, 16px)',
    };

    return (
        <div className="page-content">
            <div className="page-header">
                <div>
                    <h1 className="page-title">My Deliveries</h1>
                    <p className="page-subtitle">Manage your assigned deliveries</p>
                </div>
                <button className="btn-refresh" onClick={() => window.location.reload()} disabled={loading}><MdRefresh className={loading ? 'spin' : ''} /></button>
            </div>

            {/* Tabs */}
            <div className="orders-status-tabs">
                <button className={`status-tab ${activeTab === 'assigned' ? 'active' : ''}`} onClick={() => setActiveTab('assigned')}>
                    <MdLocalShipping /> My Deliveries
                    <span className="tab-count">{assignedOrders.length}</span>
                </button>
                <button className={`status-tab ${activeTab === 'pool' ? 'active' : ''}`} onClick={() => setActiveTab('pool')}>
                    <MdShoppingCart /> Available Pickups
                    <span className="tab-count">{poolOrders.length}</span>
                </button>
                <button className={`status-tab ${activeTab === 'history' ? 'active' : ''}`} onClick={() => setActiveTab('history')}>
                    <MdHistory /> History
                    <span className="tab-count">{historyOrders.length}</span>
                </button>
            </div>

            {loading ? (
                <div className="pool-grid">
                    {Array.from({ length: 3 }).map((_, i) => (
                        <div key={i} className="pool-card" style={{ opacity: 0.5, ...cardBorderStyle }}>
                            <div className="skeleton skeleton-text" style={{ width: '60%', height: 20 }} />
                            <div className="skeleton skeleton-text" style={{ width: '80%', height: 14, marginTop: 8 }} />
                            <div className="skeleton skeleton-text" style={{ width: '100%', height: 40, marginTop: 16 }} />
                        </div>
                    ))}
                </div>
            ) : activeTab === 'assigned' ? (
                assignedOrders.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: 'var(--space-12)', color: 'var(--color-text-tertiary)' }}>
                        <MdLocalShipping style={{ fontSize: 60, opacity: 0.3, marginBottom: 'var(--space-4)' }} />
                        <h3>No active deliveries</h3>
                        <p>Pick up orders from the "Available Pickups" tab</p>
                    </div>
                ) : (
                    <div className="pool-grid">
                        {assignedOrders.map(order => (
                            <div key={order.id} className="delivery-card" style={cardBorderStyle}>
                                <div className="delivery-card-header">
                                    <div>
                                        <h3 style={{ margin: 0 }}>{order.restaurant_name}</h3>
                                        <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-tertiary)', marginTop: 2 }}>
                                            {order.order_number}
                                        </div>
                                    </div>
                                    <span className="order-status-badge" style={{
                                        background: `${getStatusInfo(order.status).color}15`,
                                        color: getStatusInfo(order.status).color,
                                    }}>
                                        {getStatusInfo(order.status).icon} {getStatusInfo(order.status).label}
                                    </span>
                                </div>
                                <div className="pool-card-info">
                                    <span><MdShoppingCart /> {order.items?.length || 0} items</span>
                                    <span>£{(order.total || order.total_amount || 0).toFixed(2)}</span>
                                    <span><MdAccessTime /> {formatDateTime(order.assigned_at || order.dispatched_at)}</span>
                                </div>
                                {order.items && (
                                    <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-tertiary)', marginBottom: 'var(--space-3)', lineHeight: 1.5 }}>
                                        {order.items.map(i => `${i.item_name} (${i.quantity} ${i.unit})`).join(', ')}
                                    </div>
                                )}
                                {order.missing_items?.length > 0 && (
                                    <div style={{ fontSize: 'var(--text-xs)', color: '#ef4444', marginBottom: 'var(--space-3)', display: 'flex', alignItems: 'center', gap: 4 }}>
                                        <MdWarning /> {order.missing_items.length} item discrepancy reported
                                    </div>
                                )}
                                {getActionButton(order)}
                            </div>
                        ))}
                    </div>
                )
            ) : activeTab === 'pool' ? (
                poolOrders.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: 'var(--space-12)', color: 'var(--color-text-tertiary)' }}>
                        <MdShoppingCart style={{ fontSize: 60, opacity: 0.3, marginBottom: 'var(--space-4)' }} />
                        <h3>No orders available for pickup</h3>
                        <p>Check back soon for new orders</p>
                    </div>
                ) : (
                    <div className="pool-grid">
                        {poolOrders.map(order => (
                            <div key={order.id} className="pool-card" style={cardBorderStyle}>
                                <div className="pool-card-header">
                                    <div>
                                        <div className="pool-card-restaurant">{order.restaurant_name}</div>
                                        <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-tertiary)' }}>{order.order_number}</div>
                                    </div>
                                    <div className="pool-card-time">
                                        <MdAccessTime style={{ marginRight: 4 }} />
                                        {getTimeSince(order.ready_at || order.created_at)}
                                    </div>
                                </div>
                                <div className="pool-card-info">
                                    <span><MdShoppingCart /> {order.items?.length || 0} items</span>
                                    <span>£{(order.total || order.total_amount || 0).toFixed(2)}</span>
                                </div>
                                <button className="btn-assign" onClick={() => handleAssign(order.id)} disabled={assigningId === order.id}>
                                    {assigningId === order.id ? 'Assigning...' : (<><MdLocalShipping style={{ marginRight: 6 }} /> Assign to Me</>)}
                                </button>
                            </div>
                        ))}
                    </div>
                )
            ) : (
                /* ─── History Tab ─── */
                historyOrders.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: 'var(--space-12)', color: 'var(--color-text-tertiary)' }}>
                        <MdHistory style={{ fontSize: 60, opacity: 0.3, marginBottom: 'var(--space-4)' }} />
                        <h3>No delivery history</h3>
                        <p>Completed deliveries will appear here</p>
                    </div>
                ) : (
                    <div className="data-table-wrapper">
                        <table className="data-table">
                            <thead>
                                <tr>
                                    <th>Order</th><th>Restaurant</th><th>Items</th>
                                    <th>Total</th><th>Status</th><th>Delivered</th>
                                </tr>
                            </thead>
                            <tbody>
                                {historyOrders.map(order => (
                                    <tr key={order.id}>
                                        <td style={{ fontWeight: 600, color: 'var(--color-primary)' }}>{order.order_number}</td>
                                        <td>{order.restaurant_name}</td>
                                        <td>{order.items?.length || 0}</td>
                                        <td>£{(order.total || order.total_amount || 0).toFixed(2)}</td>
                                        <td>
                                            <span className="order-status-badge" style={{
                                                background: `${getStatusInfo(order.status).color}15`,
                                                color: getStatusInfo(order.status).color,
                                            }}>
                                                {getStatusInfo(order.status).icon} {getStatusInfo(order.status).label}
                                            </span>
                                        </td>
                                        <td style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)' }}>
                                            {formatDateTime(order.delivered_at)}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )
            )}

            {/* ─── Pickup Verification Modal ─── */}
            {pickupOrder_ && (
                <div className="modal-overlay" onClick={() => setPickupOrder_(null)}>
                    <div className="modal modal-lg" onClick={e => e.stopPropagation()} style={{ maxWidth: 720 }}>
                        <div className="modal-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '20px 24px', borderBottom: '1px solid var(--color-border)' }}>
                            <h2 style={{ margin: 0, fontSize: '1.1rem' }}>📋 Verify Pickup — {pickupOrder_.order_number}</h2>
                            <button className="btn-refresh" onClick={() => setPickupOrder_(null)} style={{ width: 36, height: 36 }}>
                                <MdClose size={20} />
                            </button>
                        </div>
                        <div className="modal-body" style={{ padding: '24px', maxHeight: '60vh', overflowY: 'auto' }}>
                            <p style={{ color: 'var(--color-text-secondary)', marginBottom: 'var(--space-4)', fontSize: 'var(--text-sm)' }}>
                                Verify each item quantity. Adjust if any items are missing or have quantity differences.
                            </p>
                            <div className="data-table-wrapper" style={{ marginBottom: 'var(--space-4)' }}>
                                <table className="data-table" style={{ fontSize: 'var(--text-sm)' }}>
                                    <thead>
                                        <tr>
                                            <th>Item</th>
                                            <th style={{ textAlign: 'center' }}>Ordered</th>
                                            <th style={{ textAlign: 'center' }}>Received</th>
                                            <th>Status</th>
                                            <th>Reason</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {verifiedItems.map((item, idx) => (
                                            <tr key={idx}>
                                                <td style={{ fontWeight: 500 }}>{item.item_name}</td>
                                                <td style={{ textAlign: 'center', color: 'var(--color-text-muted)' }}>
                                                    {item.quantity} {item.unit}
                                                </td>
                                                <td style={{ textAlign: 'center' }}>
                                                    <input
                                                        type="number"
                                                        className="form-input"
                                                        value={item.received_qty}
                                                        onChange={e => handleVerifiedQtyChange(idx, e.target.value)}
                                                        min="0"
                                                        step="0.5"
                                                        style={{ width: 80, textAlign: 'center', padding: '6px 8px' }}
                                                    />
                                                </td>
                                                <td>
                                                    {item.has_discrepancy ? (
                                                        item.discrepancy_type === 'missing' ? (
                                                            <span style={{ color: '#ef4444', fontWeight: 600, fontSize: 'var(--text-xs)' }}>
                                                                <MdWarning style={{ verticalAlign: 'middle' }} /> Missing {item.discrepancy_qty} {item.unit}
                                                            </span>
                                                        ) : (
                                                            <span style={{ color: '#f59e0b', fontWeight: 600, fontSize: 'var(--text-xs)' }}>
                                                                <MdArrowUpward style={{ verticalAlign: 'middle' }} /> Excess {item.discrepancy_qty} {item.unit}
                                                            </span>
                                                        )
                                                    ) : (
                                                        item.received_qty !== '' && (
                                                            <span style={{ color: '#22c55e', fontWeight: 600, fontSize: 'var(--text-xs)' }}>
                                                                <MdCheckCircle style={{ verticalAlign: 'middle' }} /> OK
                                                            </span>
                                                        )
                                                    )}
                                                </td>
                                                <td>
                                                    {item.has_discrepancy && (
                                                        <input
                                                            type="text"
                                                            className="form-input"
                                                            placeholder={item.discrepancy_type === 'excess' ? 'Reason for excess...' : 'Reason for missing...'}
                                                            value={item.missing_reason}
                                                            onChange={e => handleMissingReason(idx, e.target.value)}
                                                            style={{ padding: '6px 8px', fontSize: 'var(--text-xs)', minWidth: 140 }}
                                                        />
                                                    )}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                            {verifiedItems.some(i => i.has_discrepancy) && (
                                <div style={{
                                    padding: '12px 16px',
                                    background: '#ef444415',
                                    borderRadius: 8,
                                    border: '1px solid #ef444430',
                                    fontSize: 'var(--text-sm)',
                                    color: '#f87171',
                                    marginBottom: 'var(--space-4)',
                                }}>
                                    <MdWarning style={{ verticalAlign: 'middle', marginRight: 6 }} />
                                    <strong>{verifiedItems.filter(i => i.has_discrepancy).length} item(s)</strong> have quantity discrepancies.
                                    Inventory will be updated based on actual received quantities.
                                </div>
                            )}
                        </div>
                        <div className="modal-footer" style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-3)', padding: '16px 24px', borderTop: '1px solid var(--color-border)' }}>
                            <button className="btn btn-secondary btn-md" onClick={() => setPickupOrder_(null)}>Cancel</button>
                            <button
                                className="btn btn-primary btn-md"
                                onClick={handleConfirmPickup}
                                disabled={pickingUp}
                                style={{ display: 'flex', alignItems: 'center', gap: 6 }}
                            >
                                <MdCheckCircle /> {pickingUp ? 'Confirming...' : 'Confirm Pickup'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* ─── Delivery Confirmation Modal ─── */}
            {confirmOrder && (
                <div className="modal-overlay" onClick={() => { setConfirmOrder(null); sigInitializedRef.current = false; }}>
                    <div className="modal modal-md" onClick={e => e.stopPropagation()} style={{ maxWidth: 520 }}>
                        <div className="modal-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '20px 24px', borderBottom: '1px solid var(--color-border)' }}>
                            <h2 style={{ margin: 0, fontSize: '1.1rem' }}>✅ Confirm Delivery — {confirmOrder.order_number}</h2>
                            <button className="btn-refresh" onClick={() => { setConfirmOrder(null); sigInitializedRef.current = false; }} style={{ width: 36, height: 36 }}>
                                <MdClose size={20} />
                            </button>
                        </div>
                        <div className="modal-body" style={{ padding: '24px' }}>
                            <p style={{ color: 'var(--color-text-secondary)', marginBottom: 'var(--space-4)', fontSize: 'var(--text-sm)' }}>
                                Delivering to <strong>{confirmOrder.restaurant_name}</strong>
                            </p>

                            <div className="form-group" style={{ marginBottom: 'var(--space-4)' }}>
                                <label style={{ display: 'block', marginBottom: 6, fontWeight: 600, fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)' }}>
                                    Restaurant Manager Name *
                                </label>
                                <input
                                    type="text"
                                    className="form-input"
                                    value={managerName}
                                    onChange={(e) => setManagerName(e.target.value)}
                                    placeholder="Enter manager name..."
                                    style={{ width: '100%' }}
                                />
                            </div>

                            <div className="form-group" style={{ marginBottom: 'var(--space-4)' }}>
                                <label style={{ display: 'block', marginBottom: 6, fontWeight: 600, fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)' }}>
                                    Signature
                                </label>
                                <div style={{
                                    border: '2px solid var(--color-border)',
                                    borderRadius: 8,
                                    overflow: 'hidden',
                                    background: '#ffffff',
                                    padding: 4,
                                }}>
                                    <canvas
                                        ref={sigCanvasRef}
                                        style={{
                                            width: '100%',
                                            display: 'block',
                                            cursor: 'crosshair',
                                            borderRadius: 4,
                                        }}
                                    />
                                </div>
                                <div style={{ marginTop: 8 }}>
                                    <button className="btn btn-secondary btn-sm" onClick={clearSignature} type="button">
                                        Clear Signature
                                    </button>
                                </div>
                            </div>

                            <div className="form-group">
                                <label style={{ display: 'block', marginBottom: 6, fontWeight: 600, fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)' }}>
                                    Delivery Notes (optional)
                                </label>
                                <textarea
                                    className="form-input"
                                    value={deliveryNotes}
                                    onChange={(e) => setDeliveryNotes(e.target.value)}
                                    placeholder="Any delivery notes..."
                                    rows={3}
                                    style={{ width: '100%', resize: 'vertical' }}
                                />
                            </div>
                        </div>
                        <div className="modal-footer" style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-3)', padding: '16px 24px', borderTop: '1px solid var(--color-border)' }}>
                            <button className="btn btn-secondary btn-md" onClick={() => { setConfirmOrder(null); sigInitializedRef.current = false; }}>
                                Cancel
                            </button>
                            <button
                                className="btn btn-md"
                                onClick={handleComplete}
                                disabled={completing || !managerName.trim()}
                                style={{ background: '#22c55e', color: 'white', display: 'flex', alignItems: 'center', gap: 6 }}
                            >
                                <MdCheckCircle /> {completing ? 'Completing...' : 'Complete Delivery'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default DeliveryOrders;
