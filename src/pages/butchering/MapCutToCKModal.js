import React, { useState, useEffect, useMemo } from 'react';
import {
    MdClose,
    MdSearch,
    MdInventory2,
    MdContentCut,
    MdArrowForward,
    MdCheckCircle,
    MdWarning,
    MdTune,
    MdSyncAlt,
} from 'react-icons/md';
import { getItems } from '../../services/inventoryService';
import { mapCutToCKInventory } from '../../services/butcheringService';
import toast from 'react-hot-toast';

const safeNum = (v, fallback = 0) => {
    const n = Number(v);
    return isNaN(n) ? fallback : n;
};

const safeDate = (val) => {
    if (!val) return '—';
    if (typeof val === 'string') return val;
    if (typeof val === 'number') return new Date(val).toLocaleDateString('en-GB');
    if (val instanceof Date) return val.toLocaleDateString('en-GB');
    if (typeof val === 'object' && val.seconds !== undefined) {
        return new Date(val.seconds * 1000).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
    }
    return String(val);
};

const MapCutToCKModal = ({ cutBatch, isOpen, onClose, onSuccess }) => {
    const [items, setItems] = useState([]);
    const [loadingItems, setLoadingItems] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');
    const [typeFilter, setTypeFilter] = useState('raw_meat'); // default focus on raw_meat
    const [selectedItem, setSelectedItem] = useState(null);
    const [amountToMap, setAmountToMap] = useState('');
    const [notes, setNotes] = useState('');
    const [submitting, setSubmitting] = useState(false);

    // Available weight of source cut batch
    const availableWeight = safeNum(cutBatch?.remaining_qty ?? cutBatch?.remaining_weight_kg ?? cutBatch?.quantity, 0);

    // Load active CK inventory items
    useEffect(() => {
        if (!isOpen) return;

        let isMounted = true;
        setLoadingItems(true);
        setSelectedItem(null);
        setNotes('');
        setSearchTerm('');
        setTypeFilter('raw_meat');

        // Pre-fill amount with full available weight
        if (cutBatch) {
            const avail = safeNum(cutBatch.remaining_qty ?? cutBatch.remaining_weight_kg ?? cutBatch.quantity, 0);
            setAmountToMap(avail > 0 ? String(avail) : '');
        }

        getItems({ status: 'active' })
            .then(data => {
                if (isMounted) {
                    // Butchered cuts belong in meat inventory; hide unrelated groceries.
                    const activeList = (data || []).filter(i => ['raw_meat', 'cooked_meat'].includes(i.item_type));
                    setItems(activeList);

                    // Try to auto-select best matching raw meat item
                    if (cutBatch?.cut_name) {
                        const cutLower = cutBatch.cut_name.toLowerCase();
                        const match = activeList.find(i => 
                            i.item_type === 'raw_meat' && 
                            (cutLower.includes(i.name.toLowerCase()) || i.name.toLowerCase().includes(cutLower))
                        );
                        if (match) {
                            setSelectedItem(match);
                        }
                    }
                }
            })
            .catch(err => {
                console.error('Failed to load CK inventory items:', err);
                toast.error('Failed to load inventory items');
            })
            .finally(() => {
                if (isMounted) setLoadingItems(false);
            });

        return () => {
            isMounted = false;
        };
    }, [isOpen, cutBatch]);

    // Filter items based on type and search query
    const filteredItems = useMemo(() => {
        return items.filter(item => {
            if (typeFilter !== 'all' && item.item_type !== typeFilter) {
                return false;
            }
            if (searchTerm.trim()) {
                const q = searchTerm.toLowerCase().trim();
                const nameMatch = (item.name || '').toLowerCase().includes(q);
                const skuMatch = (item.sku || '').toLowerCase().includes(q);
                const catMatch = (item.category_name || '').toLowerCase().includes(q);
                return nameMatch || skuMatch || catMatch;
            }
            return true;
        });
    }, [items, typeFilter, searchTerm]);

    if (!isOpen || !cutBatch) return null;

    const transferQty = safeNum(amountToMap, 0);
    const isValidAmount = transferQty > 0 && transferQty <= availableWeight + 0.001;
    const remainingAfterTransfer = Math.max(0, Math.round((availableWeight - transferQty) * 100) / 100);
    const newStockAfterTransfer = selectedItem ? Math.round(((selectedItem.current_stock || 0) + transferQty) * 100) / 100 : 0;

    const handleQuickPercent = (pct) => {
        const calculated = Math.round((availableWeight * (pct / 100)) * 100) / 100;
        setAmountToMap(String(calculated));
    };

    const handleConfirmMapping = async (e) => {
        e.preventDefault();
        if (!selectedItem) {
            toast.error('Please select a destination CK inventory item');
            return;
        }
        if (!isValidAmount) {
            toast.error(`Please enter a valid weight between 0.1 kg and ${availableWeight.toFixed(2)} kg`);
            return;
        }

        setSubmitting(true);
        try {
            const res = await mapCutToCKInventory({
                cutBatch,
                destinationItem: selectedItem,
                transferWeightKg: transferQty,
                notes: notes.trim(),
            });

            toast.success(`Successfully mapped ${transferQty} kg to ${selectedItem.name}!`);
            if (onSuccess) onSuccess(res);
            onClose();
        } catch (err) {
            console.error('Error mapping cut to CK:', err);
            toast.error(err.message || 'Failed to map cut meat to CK inventory');
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget && !submitting) onClose(); }}>
            <div className="modal-container" style={{ maxWidth: 680, width: '92%', maxHeight: '90vh', overflowY: 'auto' }}>
                {/* Header */}
                <div className="modal-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--color-border)', paddingBottom: 16 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <div style={{
                            width: 36, height: 36, borderRadius: 'var(--radius-md)',
                            background: 'var(--color-primary-muted)', color: 'var(--color-primary)',
                            display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20
                        }}>
                            <MdSyncAlt />
                        </div>
                        <div>
                            <h3 style={{ margin: 0, fontSize: 18, color: 'var(--color-text-primary)', fontFamily: 'var(--font-heading)' }}>
                                Map Cut Meat to CK Inventory
                            </h3>
                            <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
                                Deduct from butchered cut batch and add stock to Central Kitchen inventory
                            </span>
                        </div>
                    </div>
                    <button
                        type="button"
                        className="btn-back"
                        onClick={onClose}
                        disabled={submitting}
                        style={{ background: 'transparent', border: 'none', color: 'var(--color-text-muted)', fontSize: 22, cursor: 'pointer' }}
                    >
                        <MdClose />
                    </button>
                </div>

                <form onSubmit={handleConfirmMapping} style={{ display: 'flex', flexDirection: 'column', gap: 16, marginTop: 16 }}>
                    {/* Source Cut Batch Card */}
                    <div style={{
                        background: 'var(--color-bg-dark)',
                        border: '1px solid var(--color-border)',
                        borderRadius: 'var(--radius-lg)',
                        padding: 14,
                        display: 'grid',
                        gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
                        gap: 12,
                    }}>
                        <div>
                            <div style={{ fontSize: 11, color: 'var(--color-text-muted)', textTransform: 'uppercase' }}>Source Cut</div>
                            <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--color-primary)', marginTop: 2 }}>
                                {cutBatch.cut_name || cutBatch.item_name}
                            </div>
                        </div>
                        <div>
                            <div style={{ fontSize: 11, color: 'var(--color-text-muted)', textTransform: 'uppercase' }}>Batch Number</div>
                            <div style={{ fontSize: 12, fontFamily: 'monospace', color: 'var(--color-text-primary)', marginTop: 2 }}>
                                {cutBatch.batch_number || cutBatch.id}
                            </div>
                        </div>
                        <div>
                            <div style={{ fontSize: 11, color: 'var(--color-text-muted)', textTransform: 'uppercase' }}>Available Weight</div>
                            <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--color-success)', marginTop: 2 }}>
                                {availableWeight.toFixed(2)} kg
                            </div>
                        </div>
                        <div>
                            <div style={{ fontSize: 11, color: 'var(--color-text-muted)', textTransform: 'uppercase' }}>Expiry Date</div>
                            <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginTop: 2 }}>
                                {safeDate(cutBatch.expiry_date)}
                            </div>
                        </div>
                    </div>

                    {/* Step 1: Select Destination CK Inventory Item */}
                    <div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                            <label style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text-primary)', display: 'flex', alignItems: 'center', gap: 6 }}>
                                <span>1. Select Destination CK Item</span>
                                <span style={{ color: 'var(--color-danger)' }}>*</span>
                            </label>
                            {selectedItem && (
                                <span style={{ fontSize: 12, color: 'var(--color-success)', display: 'flex', alignItems: 'center', gap: 4 }}>
                                    <MdCheckCircle /> Selected: <strong>{selectedItem.name}</strong>
                                </span>
                            )}
                        </div>

                        {/* Search & Filter Bar */}
                        <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
                            <div style={{ position: 'relative', flex: 1 }}>
                                <MdSearch style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-muted)', fontSize: 18 }} />
                                <input
                                    type="text"
                                    className="form-input"
                                    placeholder="Smart search: cut name, meat type, SKU or category..."
                                    value={searchTerm}
                                    onChange={(e) => setSearchTerm(e.target.value)}
                                    style={{ paddingLeft: 34, height: 38, fontSize: 13 }}
                                />
                            </div>
                            <select
                                className="form-select"
                                value={typeFilter}
                                onChange={(e) => setTypeFilter(e.target.value)}
                                style={{ width: 140, height: 38, fontSize: 12 }}
                            >
                                <option value="all">All Types</option>
                                <option value="raw_meat">🥩 Raw Meat</option>
                                <option value="cooked_meat">🍛 Cooked Meat</option>
                                <option value="grocery">🛒 Grocery</option>
                            </select>
                        </div>

                        {/* Searchable Items List */}
                        <div style={{
                            maxHeight: 180,
                            overflowY: 'auto',
                            border: '1px solid var(--color-border)',
                            borderRadius: 'var(--radius-md)',
                            background: 'var(--color-bg-dark)',
                            padding: 4,
                        }}>
                            {loadingItems ? (
                                <div style={{ padding: 20, textAlign: 'center', color: 'var(--color-text-muted)', fontSize: 13 }}>
                                    Loading CK inventory items...
                                </div>
                            ) : filteredItems.length === 0 ? (
                                <div style={{ padding: 20, textAlign: 'center', color: 'var(--color-text-muted)', fontSize: 13 }}>
                                    No matching items found in CK Inventory.
                                </div>
                            ) : (
                                filteredItems.map((item) => {
                                    const isSelected = selectedItem?.id === item.id;
                                    const typeIcon = item.item_type === 'raw_meat' ? '🥩' : item.item_type === 'cooked_meat' ? '🍛' : '🛒';

                                    return (
                                        <div
                                            key={item.id}
                                            onClick={() => setSelectedItem(item)}
                                            style={{
                                                display: 'flex',
                                                justifyContent: 'space-between',
                                                alignItems: 'center',
                                                padding: '8px 12px',
                                                borderRadius: 'var(--radius-sm)',
                                                cursor: 'pointer',
                                                marginBottom: 2,
                                                background: isSelected ? 'var(--color-primary-muted)' : 'transparent',
                                                border: isSelected ? '1px solid var(--color-primary)' : '1px solid transparent',
                                                transition: 'all 0.15s ease',
                                            }}
                                            onMouseEnter={(e) => {
                                                if (!isSelected) e.currentTarget.style.background = 'var(--color-surface)';
                                            }}
                                            onMouseLeave={(e) => {
                                                if (!isSelected) e.currentTarget.style.background = 'transparent';
                                            }}
                                        >
                                            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                                <span style={{ fontSize: 16 }}>{typeIcon}</span>
                                                <div>
                                                    <div style={{ fontWeight: isSelected ? 700 : 500, fontSize: 13, color: isSelected ? 'var(--color-primary)' : 'var(--color-text-primary)' }}>
                                                        {item.name}
                                                    </div>
                                                    <div style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>
                                                        SKU: {item.sku || '—'} {item.category_name ? `• ${item.category_name}` : ''}
                                                    </div>
                                                </div>
                                            </div>
                                            <div style={{ textAlign: 'right' }}>
                                                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-primary)' }}>
                                                    {safeNum(item.current_stock).toFixed(1)} {item.unit || 'kg'}
                                                </div>
                                                <div style={{ fontSize: 10, color: 'var(--color-text-muted)' }}>Current Stock</div>
                                            </div>
                                        </div>
                                    );
                                })
                            )}
                        </div>
                    </div>

                    {/* Step 2: Amount to Map (kg) */}
                    <div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                            <label style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text-primary)' }}>
                                2. Meat Amount to Map (kg) *
                            </label>
                            <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
                                Max available: <strong style={{ color: 'var(--color-success)' }}>{availableWeight.toFixed(2)} kg</strong>
                            </span>
                        </div>

                        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                            <div style={{ position: 'relative', flex: 1 }}>
                                <input
                                    type="number"
                                    step="0.01"
                                    min="0.01"
                                    max={availableWeight}
                                    className="form-input"
                                    value={amountToMap}
                                    onChange={(e) => setAmountToMap(e.target.value)}
                                    placeholder={`Enter weight (e.g. ${availableWeight.toFixed(2)})`}
                                    required
                                    style={{ fontSize: 16, fontWeight: 600 }}
                                />
                                <span style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-muted)', fontSize: 13 }}>
                                    kg
                                </span>
                            </div>

                            {/* Preset Percentage Buttons */}
                            <div style={{ display: 'flex', gap: 6 }}>
                                {[25, 50, 75, 100].map((pct) => (
                                    <button
                                        key={pct}
                                        type="button"
                                        className="btn btn-secondary btn-sm"
                                        onClick={() => handleQuickPercent(pct)}
                                        style={{ fontSize: 11, padding: '6px 10px', whiteSpace: 'nowrap' }}
                                    >
                                        {pct === 100 ? 'All (100%)' : `${pct}%`}
                                    </button>
                                ))}
                            </div>
                        </div>

                        {transferQty > availableWeight && (
                            <div style={{ fontSize: 12, color: 'var(--color-danger)', marginTop: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
                                <MdWarning /> Weight exceeds available cut amount ({availableWeight.toFixed(2)} kg)
                            </div>
                        )}
                    </div>

                    {/* Step 3: Transfer Balance Preview */}
                    {selectedItem && isValidAmount && (
                        <div style={{
                            background: 'var(--color-surface)',
                            border: '1px solid var(--color-border)',
                            borderRadius: 'var(--radius-lg)',
                            padding: 14,
                        }}>
                            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--color-text-muted)', textTransform: 'uppercase', marginBottom: 8 }}>
                                Transfer Preview & Stock Impact
                            </div>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', alignItems: 'center', gap: 12 }}>
                                {/* Source Deduction */}
                                <div style={{ background: 'var(--color-bg-dark)', padding: 10, borderRadius: 'var(--radius-md)' }}>
                                    <div style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>Cut Batch Remaining</div>
                                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginTop: 4 }}>
                                        <span style={{ fontSize: 13, textDecoration: 'line-through', color: 'var(--color-text-muted)' }}>
                                            {availableWeight.toFixed(2)} kg
                                        </span>
                                        <span style={{ fontSize: 15, fontWeight: 700, color: remainingAfterTransfer === 0 ? 'var(--color-danger)' : 'var(--color-warning)' }}>
                                            {remainingAfterTransfer.toFixed(2)} kg
                                        </span>
                                    </div>
                                    <div style={{ fontSize: 10, color: 'var(--color-danger)', marginTop: 2 }}>
                                        -{transferQty.toFixed(2)} kg deducted
                                    </div>
                                </div>

                                <div style={{ color: 'var(--color-primary)', fontSize: 20, display: 'flex', alignItems: 'center' }}>
                                    <MdArrowForward />
                                </div>

                                {/* Destination Addition */}
                                <div style={{ background: 'var(--color-bg-dark)', padding: 10, borderRadius: 'var(--radius-md)' }}>
                                    <div style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>CK Item ({selectedItem.name})</div>
                                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginTop: 4 }}>
                                        <span style={{ fontSize: 13, textDecoration: 'line-through', color: 'var(--color-text-muted)' }}>
                                            {safeNum(selectedItem.current_stock).toFixed(2)} {selectedItem.unit || 'kg'}
                                        </span>
                                        <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--color-success)' }}>
                                            {newStockAfterTransfer.toFixed(2)} {selectedItem.unit || 'kg'}
                                        </span>
                                    </div>
                                    <div style={{ fontSize: 10, color: 'var(--color-success)', marginTop: 2 }}>
                                        +{transferQty.toFixed(2)} kg added to CK
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Optional Notes */}
                    <div>
                        <label style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginBottom: 4, display: 'block' }}>
                            Transfer Notes (Optional)
                        </label>
                        <input
                            type="text"
                            className="form-input"
                            placeholder="e.g. Mapped to CK inventory for daily stew prep"
                            value={notes}
                            onChange={(e) => setNotes(e.target.value)}
                            style={{ fontSize: 13 }}
                        />
                    </div>

                    {/* Footer Actions */}
                    <div style={{
                        display: 'flex',
                        justifyContent: 'flex-end',
                        gap: 12,
                        marginTop: 10,
                        borderTop: '1px solid var(--color-border)',
                        paddingTop: 16,
                    }}>
                        <button
                            type="button"
                            className="btn btn-secondary btn-md"
                            onClick={onClose}
                            disabled={submitting}
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            className="btn btn-primary btn-md"
                            disabled={submitting || !selectedItem || !isValidAmount}
                            style={{ display: 'flex', alignItems: 'center', gap: 6 }}
                        >
                            {submitting ? (
                                <>Mapping to CK...</>
                            ) : (
                                <>
                                    <MdCheckCircle /> Confirm &amp; Map to CK
                                </>
                            )}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

export default MapCutToCKModal;
