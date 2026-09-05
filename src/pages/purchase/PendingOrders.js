import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    getPurchaseOrders,
    receivePurchaseOrder,
    cancelPurchaseOrder,
    getStatusInfo,
    getUniqueVendors,
} from '../../services/purchaseService';
import {
    MdShoppingCart,
    MdAdd,
    MdClose,
    MdRefresh,
    MdCheckCircle,
    MdCancel,
    MdLocalShipping,
    MdWarning,
    MdCropFree,
} from 'react-icons/md';
import toast from 'react-hot-toast';
import './Purchase.css';

const getTodayDateStr = () => new Date().toISOString().substring(0, 10);
const getCurrentTimeStr = () => {
    const d = new Date();
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    return `${hh}:${mm}`;
};
const generateAutoInvoiceNo = () => {
    const today = new Date();
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const dd = String(today.getDate()).padStart(2, '0');
    return `INV-${today.getFullYear()}-${mm}${dd}`;
};
const toDateInput = (value) => {
    if (!value) return '';
    const date = value?.toDate ? value.toDate() : new Date(value);
    return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10);
};

const PendingOrders = () => {
    const navigate = useNavigate();
    const [orders, setOrders] = useState([]);
    const [loading, setLoading] = useState(true);
    const [receiveModal, setReceiveModal] = useState(null); // order being received
    const [receiveData, setReceiveData] = useState([]);      // editable receive quantities
    const [receiving, setReceiving] = useState(false);
    const [cancelConfirm, setCancelConfirm] = useState(null);

    const fetchOrders = useCallback(async () => {
        setLoading(true);
        try {
            const pending = await getPurchaseOrders({ status: 'pending' });
            const partial = await getPurchaseOrders({ status: 'partially_received' });
            setOrders([...pending, ...partial]);
        } catch (err) {
            toast.error('Failed to load orders');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { fetchOrders(); }, [fetchOrders]);

    const [receiveVendor, setReceiveVendor] = useState('ABC Meat Suppliers');
    const [vendors, setVendors] = useState([]);
    const [isCustomVendor, setIsCustomVendor] = useState(false);
    const [invoiceNo, setInvoiceNo] = useState(generateAutoInvoiceNo());
    const [invoiceDate, setInvoiceDate] = useState(getTodayDateStr());
    const [receiveDate, setReceiveDate] = useState(getTodayDateStr());
    const [receiveTime, setReceiveTime] = useState(getCurrentTimeStr());
    const [receiveNotes, setReceiveNotes] = useState('');

    useEffect(() => {
        getUniqueVendors().then(setVendors).catch(() => setVendors([]));
    }, []);

    const openReceiveModal = (order) => {
        setReceiveModal(order);
        setReceiveVendor(order.vendor || 'ABC Meat Suppliers');
        setIsCustomVendor(false);
        setInvoiceNo(order.invoice_no || order.po_number?.replace('PO', 'INV') || generateAutoInvoiceNo());
        setInvoiceDate(toDateInput(order.invoice_date) || getTodayDateStr());
        setReceiveDate(toDateInput(order.receive_date) || getTodayDateStr());
        setReceiveTime(order.receive_time || getCurrentTimeStr());
        setReceiveNotes(order.receive_notes || order.notes || '');
        setReceiveData(order.items.map(item => ({
            item_id: item.item_id,
            item_name: item.item_name,
            item_type: item.item_type,
            unit: item.unit,
            ordered_quantity: item.quantity,
            received_quantity: item.quantity, // default to full quantity
            received_price: item.unit_price,
            expiry_date: item.item_type === 'raw_meat'
                ? new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
                : '',
        })));
    };

    const updateReceiveData = (itemId, field, value) => {
        setReceiveData(prev => prev.map(r =>
            r.item_id === itemId ? { ...r, [field]: value } : r
        ));
    };

    const handleReceive = async () => {
        if (!receiveModal) return;

        const hasQty = receiveData.some(r => Number(r.received_quantity) > 0);
        if (!hasQty) {
            toast.error('Enter at least one received quantity');
            return;
        }

        // Validate raw meat expiry dates
        const rawMeatNoExpiry = receiveData.filter(
            r => r.item_type === 'raw_meat' && Number(r.received_quantity) > 0 && !r.expiry_date
        );
        if (rawMeatNoExpiry.length > 0) {
            toast.error('Raw meat items require an expiry date');
            return;
        }

        setReceiving(true);
        try {
            const result = await receivePurchaseOrder(
                receiveModal.id,
                receiveData.filter(r => Number(r.received_quantity) > 0).map(item => ({ ...item, vendor: receiveVendor })),
                '',
                { vendor: receiveVendor, invoice_no: invoiceNo, invoice_date: invoiceDate, receive_date: receiveDate, receive_time: receiveTime, receive_notes: receiveNotes },
            );
            toast.success(`Order ${receiveModal.po_number} — ${result.status === 'received' ? 'Fully Received' : 'Partially Received'}`);
            setReceiveModal(null);
            fetchOrders();
        } catch (err) {
            console.error(err);
            toast.error(err.message || 'Failed to receive order');
        } finally {
            setReceiving(false);
        }
    };

    const handleCancel = async (orderId) => {
        try {
            await cancelPurchaseOrder(orderId);
            toast.success('Order cancelled');
            setCancelConfirm(null);
            fetchOrders();
        } catch (err) {
            toast.error(err.message || 'Failed to cancel');
        }
    };

    const formatDate = (date) => {
        if (!date) return '—';
        return new Date(date).toLocaleDateString('en-GB', {
            day: '2-digit', month: 'short', year: 'numeric'
        });
    };

    return (
        <div className="page-content">
            <div className="page-header">
                <div>
                    <h1 className="page-title">
                        <MdLocalShipping style={{ marginRight: 'var(--space-2)' }} />
                        Pending Orders
                    </h1>
                    <p className="page-subtitle">
                        {orders.length} order{orders.length !== 1 ? 's' : ''} awaiting delivery
                    </p>
                </div>
                <div style={{ display: 'flex', gap: 'var(--space-3)' }}>
                    <button className="btn-refresh" onClick={fetchOrders}><MdRefresh /></button>
                    <button className="btn btn-primary btn-md" onClick={() => navigate('/purchase/create')}>
                        <MdAdd /> New Purchase Order
                    </button>
                </div>
            </div>

            {loading ? (
                <div className="po-cards-grid">
                    {Array.from({ length: 3 }).map((_, i) => (
                        <div key={i} className="po-card">
                            <div className="po-card-header">
                                <div className="skeleton skeleton-text" style={{ width: '50%' }} />
                                <div className="skeleton skeleton-text" style={{ width: '20%' }} />
                            </div>
                            <div className="po-card-body">
                                <div className="skeleton skeleton-text" style={{ width: '80%', marginBottom: 8 }} />
                                <div className="skeleton skeleton-text" style={{ width: '60%' }} />
                            </div>
                        </div>
                    ))}
                </div>
            ) : orders.length === 0 ? (
                <div className="empty-state" style={{ padding: 'var(--space-12)' }}>
                    <MdShoppingCart style={{ fontSize: 48, color: 'var(--color-text-muted)', marginBottom: 'var(--space-3)' }} />
                    <h3 style={{ marginBottom: 'var(--space-2)' }}>No pending orders</h3>
                    <p style={{ color: 'var(--color-text-muted)', marginBottom: 'var(--space-4)' }}>
                        Create a purchase order to get started
                    </p>
                    <button className="btn btn-primary btn-md" onClick={() => navigate('/purchase/create')}>
                        <MdAdd /> Create Purchase Order
                    </button>
                </div>
            ) : (
                <div className="po-cards-grid">
                    {orders.map(order => {
                        const status = getStatusInfo(order.status);
                        return (
                            <div key={order.id} className="po-card">
                                <div className="po-card-header">
                                    <span className="po-number">{order.po_number}</span>
                                    <span className={`po-status-badge ${order.status}`}>
                                        {status.icon} {status.label}
                                    </span>
                                </div>
                                <div className="po-card-body">
                                    <div className="po-card-meta">
                                        <div className="po-card-meta-item">
                                            <span className="label">Vendor</span>
                                            <span className="value">{order.vendor || 'Not specified'}</span>
                                        </div>
                                        <div className="po-card-meta-item">
                                            <span className="label">Expected</span>
                                            <span className="value">{formatDate(order.expected_delivery_date)}</span>
                                        </div>
                                        <div className="po-card-meta-item">
                                            <span className="label">Items</span>
                                            <span className="value">{order.items?.length || 0} items</span>
                                        </div>
                                        <div className="po-card-meta-item">
                                            <span className="label">Total</span>
                                            <span className="value" style={{ color: 'var(--color-primary)' }}>
                                                £{(order.total_amount || 0).toFixed(2)}
                                            </span>
                                        </div>
                                    </div>

                                    <div className="po-card-items-summary">
                                        {(order.items || []).slice(0, 4).map((item, i) => (
                                            <div key={i} className="item-line">
                                                <span>{item.item_type === 'raw_meat' ? '🥩' : '🛒'} {item.item_name}</span>
                                                <span>{item.quantity} {item.unit}</span>
                                            </div>
                                        ))}
                                        {(order.items || []).length > 4 && (
                                            <div className="item-line" style={{ color: 'var(--color-text-muted)', fontStyle: 'italic' }}>
                                                <span>+ {order.items.length - 4} more items</span>
                                            </div>
                                        )}
                                    </div>

                                    {order.created_at && (
                                        <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>
                                            Created: {formatDate(order.created_at)}
                                        </div>
                                    )}
                                </div>
                                <div className="po-card-footer">
                                    {cancelConfirm === order.id ? (
                                        <>
                                            <button className="btn btn-danger btn-sm" onClick={() => handleCancel(order.id)}>
                                                Confirm Cancel
                                            </button>
                                            <button className="btn btn-secondary btn-sm" onClick={() => setCancelConfirm(null)}>
                                                No
                                            </button>
                                        </>
                                    ) : (
                                        <>
                                            <button className="btn btn-secondary btn-sm" onClick={() => setCancelConfirm(order.id)}>
                                                <MdCancel /> Cancel
                                            </button>
                                            <button className="btn btn-primary btn-md" onClick={() => openReceiveModal(order)}>
                                                <MdCheckCircle /> Receive Order
                                            </button>
                                        </>
                                    )}
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}

            {/* ── Receive Order Modal ── */}
            {receiveModal && (
                <div className="modal-overlay" onClick={() => !receiving && setReceiveModal(null)}>
                    <div className="modal modal-lg" onClick={(e) => e.stopPropagation()}>
                        <div className="modal-header">
                            <h2>
                                <MdCheckCircle style={{ color: 'var(--color-success)', marginRight: 8 }} />
                                Receive Order — {receiveModal.po_number}
                            </h2>
                            <button className="modal-close" onClick={() => !receiving && setReceiveModal(null)}>
                                <MdClose />
                            </button>
                        </div>
                        <div className="modal-body">
                            {/* Vendor & Invoice Details */}
                            <div className="vendor-invoice-card" style={{ marginBottom: 20 }}>
                                <h3 className="vendor-invoice-title">Vendor &amp; Invoice Details</h3>

                                <div className="vendor-invoice-grid">
                                    <div className="form-group">
                                        <label className="form-label">Vendor <span className="required" style={{ color: 'var(--color-danger)' }}>*</span></label>
                                        {isCustomVendor ? (
                                            <div style={{ display: 'flex', gap: 8 }}>
                                                <input className="form-input" value={receiveVendor} onChange={e => setReceiveVendor(e.target.value)} placeholder="Enter vendor name" autoFocus />
                                                <button type="button" className="btn btn-secondary btn-sm" onClick={() => setIsCustomVendor(false)}>List</button>
                                            </div>
                                        ) : (
                                            <select className="form-input" value={receiveVendor} onChange={e => {
                                                if (e.target.value === '__custom__') setIsCustomVendor(true);
                                                else setReceiveVendor(e.target.value);
                                            }}>
                                                {receiveVendor && !vendors.includes(receiveVendor) && <option value={receiveVendor}>{receiveVendor}</option>}
                                                {vendors.map(v => <option key={v} value={v}>{v}</option>)}
                                                <option value="__custom__">+ Enter new vendor name…</option>
                                            </select>
                                        )}
                                    </div>

                                    <div className="form-group">
                                        <label className="form-label">Invoice No <span className="required" style={{ color: 'var(--color-danger)' }}>*</span></label>
                                        <input
                                            type="text"
                                            className="form-input"
                                            value={invoiceNo}
                                            onChange={e => setInvoiceNo(e.target.value)}
                                            placeholder="INV-2026-0618"
                                        />
                                    </div>

                                    <div className="form-group">
                                        <label className="form-label">Invoice Date</label>
                                        <input
                                            type="date"
                                            className="form-input"
                                            value={invoiceDate}
                                            onChange={e => setInvoiceDate(e.target.value)}
                                        />
                                    </div>

                                    <div className="form-group">
                                        <label className="form-label">Receive Date</label>
                                        <input
                                            type="date"
                                            className="form-input"
                                            value={receiveDate}
                                            onChange={e => setReceiveDate(e.target.value)}
                                        />
                                    </div>
                                </div>

                                <div className="vendor-invoice-row-2">
                                    <div className="form-group">
                                        <label className="form-label">Receive Time</label>
                                        <input
                                            type="time"
                                            className="form-input"
                                            value={receiveTime}
                                            onChange={e => setReceiveTime(e.target.value)}
                                        />
                                    </div>

                                    <div className="form-group">
                                        <label className="form-label">Notes</label>
                                        <input
                                            type="text"
                                            className="form-input"
                                            value={receiveNotes}
                                            onChange={e => setReceiveNotes(e.target.value)}
                                            placeholder="Vehicle no, driver name, remarks..."
                                        />
                                    </div>
                                </div>
                            </div>

                            <div style={{
                                background: 'rgba(245, 158, 11, 0.08)',
                                border: '1px solid rgba(245, 158, 11, 0.2)',
                                borderRadius: 'var(--radius-md)',
                                padding: 'var(--space-3)',
                                marginBottom: 'var(--space-4)',
                                fontSize: 'var(--text-sm)',
                                color: '#f59e0b',
                                display: 'flex',
                                alignItems: 'center',
                                gap: 'var(--space-2)',
                            }}>
                                <MdWarning /> Verify delivered quantities. For raw meat, enter actual weight and expiry date.
                            </div>

                            {receiveData.map((item) => (
                                <div key={item.item_id} className={`receive-item-row ${item.item_type}`}>
                                    <div className="receive-item-info">
                                        <span className="receive-item-name">
                                            {item.item_type === 'raw_meat' ? '🥩' : '🛒'} {item.item_name}
                                        </span>
                                        <span className="receive-item-meta">
                                            Ordered: {item.ordered_quantity} {item.unit} · £{Number(item.received_price || 0).toFixed(2)}/{item.unit}
                                        </span>
                                    </div>
                                    <div className="receive-field">
                                        <label>Received Qty</label>
                                        <input
                                            type="number"
                                            value={item.received_quantity ?? ''}
                                            onChange={(e) => updateReceiveData(item.item_id, 'received_quantity', e.target.value === '' ? '' : Number(e.target.value))}
                                            min="0"
                                            step="0.1"
                                        />
                                    </div>
                                    <div className="receive-field">
                                        <label>Unit Price (£)</label>
                                        <input
                                            type="number"
                                            value={item.received_price ?? ''}
                                            onChange={(e) => updateReceiveData(item.item_id, 'received_price', e.target.value === '' ? '' : Number(e.target.value))}
                                            min="0"
                                            step="0.01"
                                        />
                                    </div>
                                    {item.item_type === 'raw_meat' ? (
                                        <div className="receive-field">
                                            <label>Expiry Date *</label>
                                            <input
                                                type="date"
                                                value={item.expiry_date}
                                                onChange={(e) => updateReceiveData(item.item_id, 'expiry_date', e.target.value)}
                                            />
                                        </div>
                                    ) : (
                                        <div className="receive-field">
                                            <label>Expiry (opt.)</label>
                                            <input
                                                type="date"
                                                value={item.expiry_date}
                                                onChange={(e) => updateReceiveData(item.item_id, 'expiry_date', e.target.value)}
                                            />
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>
                        <div className="modal-footer">
                            <button className="btn btn-secondary btn-md" onClick={() => setReceiveModal(null)} disabled={receiving}>
                                Cancel
                            </button>
                            <button className="btn btn-primary btn-lg" onClick={handleReceive} disabled={receiving}>
                                {receiving ? 'Processing...' : (
                                    <>
                                        <MdCheckCircle /> Confirm Received
                                    </>
                                )}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default PendingOrders;
