import React, { useEffect, useState, useCallback } from 'react';
import toast from 'react-hot-toast';
import {
    MdSwapHoriz,
    MdSend,
    MdDelete,
    MdCheckCircle,
    MdCancel,
    MdCallReceived,
    MdHistory,
} from 'react-icons/md';
import { useAuth } from '../../contexts/AuthContext';
import { getRestaurantInventory, getRestaurantItem } from '../../services/restaurantInventoryService';
import { getItems } from '../../services/inventoryService';
import {
    acceptStockTransfer,
    createStockTransfer,
    getRestaurantDirectory,
    getStockTransfers,
    receiveStockTransfer,
    rejectStockTransfer,
} from '../../services/stockTransferService';
import SmartItemSearch from '../../components/common/SmartItemSearch';
import './StockTransfers.css';

const StockTransfers = () => {
    const { userProfile, currentUser } = useAuth();
    const restaurant = {
        id: currentUser?.uid || userProfile?.id || userProfile?.restaurant_id,
        name: userProfile?.restaurant_name || userProfile?.name || 'My restaurant',
    };

    const [inventory, setInventory] = useState([]);
    const [restaurants, setRestaurants] = useState([]);
    const [transfers, setTransfers] = useState([]);
    const [lender, setLender] = useState('');
    const [items, setItems] = useState([]);
    const [notes, setNotes] = useState('');
    const [busy, setBusy] = useState(false);
    const [loading, setLoading] = useState(true);

    // Accept modal state
    const [acceptModal, setAcceptModal] = useState(null); // transfer object or null
    const [acceptItems, setAcceptItems] = useState([]);
    const [acceptBusy, setAcceptBusy] = useState(false);
    const [actionBusy, setActionBusy] = useState({}); // { [transferId]: 'receiving' | 'rejecting' }

    const load = useCallback(async () => {
        if (!restaurant.id) return;
        setLoading(true);
        try {
            const [directory, records] = await Promise.all([
                getRestaurantDirectory(restaurant.id),
                getStockTransfers(restaurant.id, userProfile),
            ]);
            setRestaurants(directory);
            setTransfers(records);

            // Load restaurant inventory
            let stock = [];
            try {
                stock = await getRestaurantInventory(restaurant.id);
            } catch (e) {
                console.warn('Could not load restaurant inventory:', e);
            }

            // Also load active CK items so user can borrow any catalog item
            try {
                const ckItems = await getItems({ status: 'active' });
                const existingNames = new Set((stock || []).map(s => (s.item_name || s.name || '').toLowerCase()));
                ckItems.forEach(item => {
                    if (!existingNames.has((item.name || '').toLowerCase())) {
                        stock.push({
                            id: item.id,
                            item_id: item.id,
                            item_name: item.name,
                            name: item.name,
                            item_type: item.item_type || 'grocery',
                            category_name: item.category_name || '',
                            unit: item.unit || 'kg',
                            current_stock: 0,
                            cost_price: item.cost_price || 0,
                        });
                    }
                });
            } catch (e2) {
                console.warn('Could not load CK items:', e2);
            }

            setInventory(stock);
        } catch (err) {
            console.error('Stock transfers load error:', err);
            toast.error('Could not load stock transfers');
        } finally {
            setLoading(false);
        }
    }, [restaurant.id, userProfile]);

    useEffect(() => {
        if (restaurant.id) load();
    }, [restaurant.id, load]);

    // ── Add item from smart search ──
    const addItem = (item) => {
        const itemId = item.item_id || item.id;
        if (items.some(i => (i.item_id || i.id) === itemId)) {
            toast.error('Item already added');
            return;
        }
        setItems(prev => [...prev, {
            ...item,
            item_id: itemId,
            item_name: item.item_name || item.name,
            quantity: 1,
        }]);
    };

    const addNewItem = (item) => {
        setItems(prev => [...prev, {
            ...item,
            item_id: item.id,
            item_name: item.name || item.item_name,
            quantity: 1,
        }]);
    };

    const updateItemQty = (idx, value) => {
        setItems(prev => prev.map((x, j) => j === idx ? { ...x, quantity: value } : x));
    };

    const removeItem = (idx) => {
        setItems(prev => prev.filter((_, j) => j !== idx));
    };

    // ── Send request ──
    const handleRequest = async (e) => {
        e.preventDefault();
        if (!lender) { toast.error('Select a restaurant to borrow from'); return; }
        if (!items.length) { toast.error('Add at least one item'); return; }
        setBusy(true);
        try {
            await createStockTransfer({
                borrower: restaurant,
                lender: restaurants.find(r => r.id === lender),
                items,
                notes,
            });
            toast.success('Borrow request sent');
            setItems([]);
            setNotes('');
            await load();
        } catch (err) {
            toast.error(err.message);
        } finally {
            setBusy(false);
        }
    };

    // ── Reject ──
    const handleReject = async (t) => {
        if (actionBusy[t.id]) return;
        const reason = window.prompt('Why is this request being rejected?');
        if (reason === null) return;
        setActionBusy(prev => ({ ...prev, [t.id]: 'rejecting' }));
        try {
            await rejectStockTransfer(t.id, reason);
            toast.success('Request rejected');
            await load();
        } catch (err) {
            toast.error(err.message);
        } finally {
            setActionBusy(prev => {
                const next = { ...prev };
                delete next[t.id];
                return next;
            });
        }
    };

    // ── Accept — open modal ──
    const openAcceptModal = (t) => {
        // Strictly default sent_quantity to requested_quantity
        const adjusted = (t.items || []).map(i => {
            const reqQty = Number(i.requested_quantity ?? i.quantity ?? 1);
            return {
                ...i,
                requested_quantity: reqQty,
                sent_quantity: reqQty,
                available_stock: null,
            };
        });
        setAcceptItems(adjusted);
        setAcceptModal(t);

        // Fetch available stock in background without blocking modal open
        (t.items || []).forEach(async (i, idx) => {
            try {
                const stock = await getRestaurantItem(t.lender_id, i, i.item_name);
                if (stock) {
                    const avail = Number(stock.current_stock || 0);
                    setAcceptItems(prev => prev.map((x, j) => j === idx ? { ...x, available_stock: avail } : x));
                }
            } catch (e) { /* ignore */ }
        });
    };

    const handleAcceptConfirm = async () => {
        if (!acceptModal || acceptBusy) return;
        setAcceptBusy(true);
        try {
            await acceptStockTransfer(acceptModal, acceptItems);
            toast.success('Stock deducted and transfer accepted');
            setAcceptModal(null);
            await load();
        } catch (err) {
            toast.error(err.message);
        } finally {
            setAcceptBusy(false);
        }
    };

    // ── Receive ──
    const handleReceive = async (t) => {
        if (actionBusy[t.id]) return;
        setActionBusy(prev => ({ ...prev, [t.id]: 'receiving' }));
        try {
            await receiveStockTransfer(t);
            toast.success('Stock received and credit issued');
            await load();
        } catch (e) {
            toast.error(e.message);
        } finally {
            setActionBusy(prev => {
                const next = { ...prev };
                delete next[t.id];
                return next;
            });
        }
    };

    const formatDate = (d) => {
        if (!d) return '';
        return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
    };

    return (
        <div className="page-container">
            <div className="page-header">
                <div>
                    <h1><MdSwapHoriz style={{ verticalAlign: 'middle', marginRight: 8 }} />Stock Transfers</h1>
                    <p>Request stock from another restaurant or respond to incoming requests.</p>
                </div>
            </div>

            {/* ═══════════════════════════════════════════
                REQUEST FORM
            ═══════════════════════════════════════════ */}
            <div className="st-form-card">
                <h3><MdSend /> Request Stock</h3>
                <form onSubmit={handleRequest}>
                    <div className="st-form-grid">
                        <div className="st-form-group">
                            <label>Borrow From</label>
                            <select value={lender} onChange={e => setLender(e.target.value)} required>
                                <option value="">Select restaurant</option>
                                {restaurants.map(r => (
                                    <option key={r.id} value={r.id}>{r.name}</option>
                                ))}
                            </select>
                        </div>
                        <div className="st-form-group">
                            <label>Search & Add Items</label>
                            <SmartItemSearch
                                items={inventory}
                                onSelect={addItem}
                                onAddNew={addNewItem}
                                placeholder="Search items to borrow..."
                                excludeIds={items.map(i => i.item_id || i.id)}
                                nameKey="item_name"
                                showStock={true}
                                showCostPrice={false}
                                allowNew={false}
                            />
                        </div>
                    </div>

                    {/* Added items */}
                    {items.length > 0 ? (
                        <>
                            <div className="st-items-header">Items to request ({items.length})</div>
                            <div className="st-items-list">
                                {items.map((i, n) => (
                                    <div key={i.item_id || i.id} className="st-item-row">
                                        <div>
                                            <div className="st-item-name">{i.item_name || i.name}</div>
                                            <div className="st-item-stock">
                                                {i.category_name && <span className="sis-tag" style={{ marginRight: 6 }}>{i.category_name}</span>}
                                                Stock: {i.current_stock || 0} {i.unit}
                                            </div>
                                        </div>
                                        <div className="st-item-qty">
                                            <label>Quantity</label>
                                            <input
                                                type="number"
                                                min="0.01"
                                                step="any"
                                                value={i.quantity}
                                                onChange={e => updateItemQty(n, e.target.value)}
                                            />
                                        </div>
                                        <div className="st-item-unit">{i.unit}</div>
                                        <button type="button" className="st-remove-btn" onClick={() => removeItem(n)} title="Remove">
                                            <MdDelete />
                                        </button>
                                    </div>
                                ))}
                            </div>
                        </>
                    ) : (
                        <div className="st-empty-items">
                            <MdSwapHoriz style={{ fontSize: 28, opacity: 0.3, marginBottom: 4 }} /><br />
                            Search and add items above to create a borrow request.
                        </div>
                    )}

                    <div className="st-form-group" style={{ marginBottom: 16 }}>
                        <label>Notes (optional)</label>
                        <textarea
                            placeholder="Any additional details..."
                            value={notes}
                            onChange={e => setNotes(e.target.value)}
                            rows={2}
                        />
                    </div>

                    <button className="btn btn-primary" disabled={busy || !items.length} style={{ width: '100%' }}>
                        {busy ? 'Sending...' : 'Send Borrow Request'}
                    </button>
                </form>
            </div>

            {/* ═══════════════════════════════════════════
                TRANSFER ACTIVITY
            ═══════════════════════════════════════════ */}
            <div className="st-activity-card">
                <h3><MdHistory /> Transfer Activity</h3>

                {loading ? (
                    <div className="st-empty-activity">Loading...</div>
                ) : transfers.length === 0 ? (
                    <div className="st-empty-activity">No transfer activity yet.</div>
                ) : (
                    transfers.map(t => (
                        <div key={t.id} className="st-transfer-row">
                            <div>
                                <div className="st-transfer-direction">
                                    {t.borrower_id === restaurant.id
                                        ? `To ${t.lender_name}`
                                        : `From ${t.borrower_name}`}
                                </div>
                                <div className="st-transfer-date">{formatDate(t.created_at)}</div>
                            </div>
                            <div className="st-transfer-items">
                                {(t.items || []).map(i =>
                                    `${i.item_name} × ${i.sent_quantity || i.requested_quantity}`
                                ).join(', ')}
                            </div>
                            <div className="st-transfer-value">
                                £{Number(t.total_value || 0).toFixed(2)}
                            </div>
                            <div>
                                <span className={`st-status st-status--${t.status}`}>
                                    {t.status}
                                </span>
                                {t.rejection_reason && (
                                    <span className="st-rejection-reason">{t.rejection_reason}</span>
                                )}
                            </div>
                            <div className="st-transfer-actions">
                                {t.lender_id === restaurant.id && t.status === 'requested' && (
                                    <>
                                        <button
                                            className="btn btn-primary btn-sm"
                                            onClick={() => openAcceptModal(t)}
                                            disabled={!!actionBusy[t.id]}
                                        >
                                            <MdCheckCircle style={{ marginRight: 4 }} /> Accept
                                        </button>
                                        <button
                                            className="btn btn-danger btn-sm"
                                            onClick={() => handleReject(t)}
                                            disabled={!!actionBusy[t.id]}
                                        >
                                            <MdCancel style={{ marginRight: 4 }} />
                                            {actionBusy[t.id] === 'rejecting' ? 'Rejecting...' : 'Reject'}
                                        </button>
                                    </>
                                )}
                                {t.borrower_id === restaurant.id && t.status === 'accepted' && (
                                    <button
                                        className="btn btn-primary btn-sm"
                                        onClick={() => handleReceive(t)}
                                        disabled={!!actionBusy[t.id]}
                                    >
                                        <MdCallReceived style={{ marginRight: 4 }} />
                                        {actionBusy[t.id] === 'receiving' ? 'Receiving...' : 'Receive'}
                                    </button>
                                )}
                            </div>
                        </div>
                    ))
                )}
            </div>

            {/* ═══════════════════════════════════════════
                ACCEPT MODAL
            ═══════════════════════════════════════════ */}
            {acceptModal && (
                <div className="modal-overlay" onClick={() => !acceptBusy && setAcceptModal(null)}>
                    <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 560 }}>
                        <div className="modal-header">
                            <h2>Accept Transfer Request</h2>
                            <button className="modal-close" onClick={() => !acceptBusy && setAcceptModal(null)}>×</button>
                        </div>
                        <div className="modal-body">
                            <p style={{ marginBottom: 16, color: 'var(--color-text-secondary)' }}>
                                <strong>{acceptModal.borrower_name}</strong> is requesting the following items.
                                Adjust the quantities you're sending:
                            </p>

                            <div className="st-accept-items">
                                {acceptItems.map((item, idx) => (
                                    <div key={idx} className="st-accept-row">
                                        <div>
                                            <div className="st-accept-name">{item.item_name}</div>
                                            <div className="st-accept-requested">
                                                Requested: {item.requested_quantity || item.quantity} {item.unit}
                                                {item.available_stock !== null && (
                                                    <span style={{
                                                        marginLeft: 8,
                                                        color: item.available_stock < (item.sent_quantity || item.requested_quantity) ? '#ef4444' : '#10b981',
                                                        fontWeight: 600,
                                                    }}>
                                                        • In Stock: {item.available_stock} {item.unit}
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                        <div className="st-accept-field">
                                            <input
                                                type="number"
                                                min="0"
                                                step="any"
                                                value={item.sent_quantity}
                                                onChange={e => {
                                                    const val = e.target.value;
                                                    setAcceptItems(prev =>
                                                        prev.map((x, j) => j === idx ? { ...x, sent_quantity: val } : x)
                                                    );
                                                }}
                                            />
                                        </div>
                                        <div className="st-accept-unit">{item.unit}</div>
                                    </div>
                                ))}
                            </div>

                            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 16 }}>
                                <button
                                    className="btn btn-secondary"
                                    onClick={() => setAcceptModal(null)}
                                    disabled={acceptBusy}
                                >
                                    Cancel
                                </button>
                                <button
                                    className="btn btn-primary"
                                    onClick={handleAcceptConfirm}
                                    disabled={acceptBusy}
                                >
                                    {acceptBusy ? 'Processing...' : 'Confirm & Deduct Stock'}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default StockTransfers;
