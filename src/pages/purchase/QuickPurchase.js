import React, { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { MdShoppingCart, MdDelete, MdReceipt, MdPayment } from 'react-icons/md';
import { getItems } from '../../services/inventoryService';
import { getRestaurantInventory } from '../../services/restaurantInventoryService';
import { savePettyCashPurchase } from '../../services/pettyCashService';
import { useAuth } from '../../contexts/AuthContext';
import SmartItemSearch from '../../components/common/SmartItemSearch';
import './Purchase.css';

const QuickPurchase = () => {
    const { userProfile } = useAuth();
    const [inventory, setInventory] = useState([]);
    const [lines, setLines] = useState([]);
    const [payment, setPayment] = useState('Cash');
    const [receipt, setReceipt] = useState('');
    const [saving, setSaving] = useState(false);
    const [notes, setNotes] = useState('');
    const [category, setCategory] = useState('All');
    const isRestaurantPurchase = ['restaurant_manager', 'restaurant_manager_non_managed'].includes(userProfile?.role);
    const restaurantId = userProfile?.restaurant_id || userProfile?.id || '';

    useEffect(() => {
        (isRestaurantPurchase ? getRestaurantInventory(restaurantId) : getItems({ status: 'active' }))
            .then(setInventory)
            .catch(() => toast.error('Could not load inventory'));
    }, [isRestaurantPurchase, restaurantId]);

    const addItem = (item) => {
        if (lines.some(x => x.id === item.id)) {
            toast.error('Item already added');
            return;
        }
        setLines(prev => [...prev, {
            ...item,
            quantity: 1,
            unit_price: item.cost_price || 0,
        }]);
    };

    const addNewItem = (item) => {
        setLines(prev => [...prev, {
            ...item,
            quantity: Number(item.quantity) || 1,
            unit_price: item.cost_price || 0,
        }]);
    };

    const updateLine = (idx, field, value) => {
        setLines(prev => prev.map((x, j) => j === idx ? { ...x, [field]: value } : x));
    };

    const removeLine = (idx) => {
        setLines(prev => prev.filter((_, j) => j !== idx));
    };

    const handleFile = (e) => {
        const f = e.target.files?.[0];
        if (!f) return;
        if (f.size > 500 * 1024) {
            toast.error('Image must be under 500KB');
            e.target.value = '';
            return;
        }
        const r = new FileReader();
        r.onload = () => setReceipt(r.result);
        r.readAsDataURL(f);
    };

    const total = lines.reduce((s, x) => s + Number(x.quantity || 0) * Number(x.unit_price || 0), 0);
    const categories = ['All', ...new Set(inventory.map(item => item.category_name).filter(Boolean))];
    const filteredInventory = category === 'All' ? inventory : inventory.filter(item => item.category_name === category);

    const save = async (e) => {
        e.preventDefault();
        if (!lines.length) { toast.error('Add at least one item'); return; }
        setSaving(true);
        try {
            const result = await savePettyCashPurchase({
                items: lines,
                payment_method: payment,
                receipt_base64: receipt,
                created_by: { id: userProfile?.id, name: userProfile?.name },
                notes,
                restaurant_id: isRestaurantPurchase ? restaurantId : '',
                restaurant_name: isRestaurantPurchase ? (userProfile?.restaurant_name || userProfile?.name || '') : '',
            });
            toast.success(`Purchase saved! Invoice ${result.invoiceNumber} created`);
            setLines([]);
            setReceipt('');
            setNotes('');
        } catch (err) {
            toast.error(err.message);
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="page-container">
            <div className="page-header">
                <div>
                    <h1><MdShoppingCart style={{ verticalAlign: 'middle', marginRight: 8 }} />Quick Purchase</h1>
                    <p>Log an emergency local purchase and update {isRestaurantPurchase ? 'restaurant' : 'central kitchen'} inventory immediately.</p>
                </div>
            </div>

            <form onSubmit={save}>
                {/* ── Search & Settings ── */}
                <div className="card" style={{ marginBottom: 20, overflow: 'visible', position: 'relative', zIndex: 20 }}>
                    <h3 style={{ marginBottom: 16, color: 'var(--color-primary)', fontSize: '15px', fontWeight: 600 }}>
                        Add Items
                    </h3>
                    <div style={{ marginBottom: 16 }}>
                        <label className="form-label">Category</label>
                        <select className="form-select" value={category} onChange={e => setCategory(e.target.value)} style={{ marginBottom: 12 }}>
                            {categories.map(value => <option key={value} value={value}>{value}</option>)}
                        </select>
                        <SmartItemSearch
                            items={filteredInventory}
                            onSelect={addItem}
                            onAddNew={addNewItem}
                            placeholder="Search inventory items or add new..."
                            excludeIds={lines.map(l => l.id)}
                            nameKey={isRestaurantPurchase ? 'item_name' : 'name'}
                            showCostPrice={true}
                            allowNew={true}
                        />
                    </div>

                    <div className="qp-settings-row">
                        <div className="qp-setting">
                            <MdPayment style={{ fontSize: 18, color: 'var(--color-text-muted)' }} />
                            <label>Payment</label>
                            <select className="form-input" value={payment} onChange={e => setPayment(e.target.value)}>
                                <option>Cash</option>
                                <option>Card</option>
                            </select>
                        </div>
                        <div className="qp-setting">
                            <MdReceipt style={{ fontSize: 18, color: 'var(--color-text-muted)' }} />
                            <label>Receipt</label>
                            <input className="form-input" type="file" accept="image/*" onChange={handleFile}
                                style={{ fontSize: 12 }} />
                        </div>
                    </div>
                </div>

                {/* ── Line Items ── */}
                {lines.length > 0 && (
                    <div className="card" style={{ marginBottom: 20 }}>
                        <h3 style={{ marginBottom: 16, color: 'var(--color-primary)', fontSize: '15px', fontWeight: 600 }}>
                            Purchase Items ({lines.length})
                        </h3>

                        <div className="qp-items-list">
                            {lines.map((l, n) => (
                                <div key={l.id} className="qp-item-row">
                                    <div className="qp-item-info">
                                        <span className="qp-item-name">{l.name || l.item_name}</span>
                                        <span className="qp-item-meta">
                                            {l.category_name && <span className="sis-tag">{l.category_name}</span>}
                                            <span style={{ color: 'var(--color-text-muted)', fontSize: 11 }}>{l.unit}</span>
                                            {l.is_custom && <span className="qp-custom-badge">NEW</span>}
                                        </span>
                                    </div>
                                    <div className="qp-item-field">
                                        <label>Qty</label>
                                        <input
                                            type="number"
                                            min="0.01"
                                            step="any"
                                            value={l.quantity}
                                            onChange={e => updateLine(n, 'quantity', e.target.value)}
                                        />
                                    </div>
                                    <div className="qp-item-field">
                                        <label>Price (£)</label>
                                        <input
                                            type="number"
                                            min="0"
                                            step="0.01"
                                            value={l.unit_price}
                                            onChange={e => updateLine(n, 'unit_price', e.target.value)}
                                        />
                                    </div>
                                    <div className="qp-item-total">
                                        £{(Number(l.quantity || 0) * Number(l.unit_price || 0)).toFixed(2)}
                                    </div>
                                    <button
                                        type="button"
                                        className="qp-remove-btn"
                                        onClick={() => removeLine(n)}
                                        title="Remove"
                                    >
                                        <MdDelete />
                                    </button>
                                </div>
                            ))}
                        </div>

                        {/* Notes */}
                        <textarea
                            className="form-input"
                            placeholder="Notes (optional)"
                            value={notes}
                            onChange={e => setNotes(e.target.value)}
                            rows={2}
                            style={{ marginTop: 16 }}
                        />

                        {/* ── Summary ── */}
                        <div className="qp-summary">
                            <div className="qp-summary-row">
                                <span>Items</span>
                                <span>{lines.length}</span>
                            </div>
                            <div className="qp-summary-row">
                                <span>Payment</span>
                                <span>{payment}</span>
                            </div>
                            <div className="qp-summary-row qp-summary-total">
                                <span>Total</span>
                                <span>£{total.toFixed(2)}</span>
                            </div>
                        </div>

                        <button className="btn btn-primary" disabled={saving || !lines.length} style={{ width: '100%' }}>
                            {saving ? 'Saving...' : `Save Purchase — £${total.toFixed(2)}`}
                        </button>
                    </div>
                )}

                {lines.length === 0 && (
                    <div className="card" style={{ textAlign: 'center', padding: '48px 24px', color: 'var(--color-text-muted)' }}>
                        <MdShoppingCart style={{ fontSize: 48, opacity: 0.3, marginBottom: 12 }} />
                        <p>Search and add items above to start a quick purchase.</p>
                    </div>
                )}
            </form>
        </div>
    );
};

export default QuickPurchase;
