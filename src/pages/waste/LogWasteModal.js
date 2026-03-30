import React, { useState, useEffect, useRef } from 'react';
import { MdClose, MdDelete, MdImage } from 'react-icons/md';
import { WASTE_CATEGORIES, getItemsForWasteLog, getBatchesForItem, logWasteEvent } from '../../services/wasteService';
import toast from 'react-hot-toast';

const formatDate = (d) => {
    if (!d) return '—';
    return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
};

/**
 * Log Waste Modal — manual waste entry form.
 */
const LogWasteModal = ({ onClose, onSubmitted, userProfile, locationOverride }) => {
    const [items, setItems] = useState([]);
    const [batches, setBatches] = useState([]);
    const [loading, setLoading] = useState(true);
    const [submitting, setSubmitting] = useState(false);

    const [form, setForm] = useState({
        item_id: '',
        quantity: '',
        category: '',
        batch_id: '',
        notes: '',
        estimated_value: '',
    });
    const [imageData, setImageData] = useState(null);
    const [imagePreview, setImagePreview] = useState(null);
    const fileInputRef = useRef(null);

    const isRestaurant = userProfile?.role === 'restaurant_manager' || userProfile?.role === 'restaurant_manager_non_managed';
    const locationType = locationOverride?.type || (isRestaurant ? 'restaurant' : 'central_kitchen');
    const locationId = locationOverride?.id || (isRestaurant ? userProfile?.uid : null);
    const locationName = locationOverride?.name || (isRestaurant ? (userProfile?.restaurant_name || userProfile?.name || 'Restaurant') : 'Central Kitchen');

    // Load items
    useEffect(() => {
        getItemsForWasteLog().then(data => {
            setItems(data);
            setLoading(false);
        }).catch(err => {
            console.error('Failed to load items:', err);
            setLoading(false);
        });
    }, []);

    // Load batches when item changes
    useEffect(() => {
        if (!form.item_id) { setBatches([]); return; }
        getBatchesForItem(form.item_id).then(setBatches).catch(() => setBatches([]));
    }, [form.item_id]);

    const selectedItem = items.find(i => i.id === form.item_id);

    const handleChange = (field, value) => {
        setForm(prev => {
            const next = { ...prev, [field]: value };
            if (field === 'item_id') {
                next.batch_id = '';
                // Auto-calculate estimated value
                const item = items.find(i => i.id === value);
                const price = item?.selling_price || item?.cost_price || 0;
                const qty = parseFloat(next.quantity) || 0;
                next.estimated_value = (price * qty).toFixed(2);
            }
            if (field === 'quantity') {
                const item = items.find(i => i.id === next.item_id);
                const price = item?.selling_price || item?.cost_price || 0;
                const qty = parseFloat(value) || 0;
                next.estimated_value = (price * qty).toFixed(2);
            }
            return next;
        });
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!form.item_id || !form.quantity || !form.category) {
            toast.error('Please fill item, quantity, and category');
            return;
        }

        const qty = parseFloat(form.quantity);
        if (isNaN(qty) || qty <= 0) {
            toast.error('Quantity must be a positive number');
            return;
        }

        setSubmitting(true);
        try {
            const selectedBatch = batches.find(b => b.id === form.batch_id);
            await logWasteEvent({
                item_id: form.item_id,
                item_name: selectedItem?.name || '',
                item_type: selectedItem?.item_type || '',
                item_unit: selectedItem?.unit || '',
                quantity: qty,
                unit_cost: parseFloat(form.estimated_value || 0) / qty || (selectedItem?.selling_price || selectedItem?.cost_price || 0),
                category: form.category,
                source: 'manual',
                location_type: locationType,
                location_id: locationId,
                location_name: locationName,
                batch_id: form.batch_id || null,
                batch_number: selectedBatch?.batch_number || null,
                notes: form.notes,
                image_data: imageData || null,
                submitted_by: {
                    uid: userProfile?.uid || '',
                    name: userProfile?.name || userProfile?.email || '',
                    email: userProfile?.email || '',
                },
            });

            toast.success('Waste event logged successfully');
            if (onSubmitted) onSubmitted();
            onClose();
        } catch (err) {
            console.error('Failed to log waste:', err);
            toast.error('Failed to log waste event');
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 520, borderRadius: 16 }}>
                {/* Header */}
                <div className="modal-header" style={{ borderBottom: '1px solid var(--color-border)', padding: '20px 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <h2 style={{ margin: 0, fontSize: '1.1rem', display: 'flex', alignItems: 'center', gap: 8 }}>
                        🗑️ Log Waste Event
                    </h2>
                    <button className="btn btn-icon" onClick={onClose}
                        style={{ background: 'var(--color-surface-hover)', borderRadius: '50%', width: 36, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center', border: 'none', cursor: 'pointer' }}>
                        <MdClose size={20} color="white" />
                    </button>
                </div>

                {/* Body */}
                <form onSubmit={handleSubmit} style={{ padding: '24px' }}>
                    {loading ? (
                        <div style={{ textAlign: 'center', padding: 40, color: 'var(--color-text-muted)' }}>Loading items...</div>
                    ) : (
                        <>
                            {/* Item */}
                            <div className="waste-form-group">
                                <label>Item *</label>
                                <select value={form.item_id} onChange={e => handleChange('item_id', e.target.value)} required>
                                    <option value="">Select item...</option>
                                    {items.map(item => (
                                        <option key={item.id} value={item.id}>
                                            {item.name} ({item.item_type.replace('_', ' ')}) — {item.current_stock} {item.unit} in stock
                                        </option>
                                    ))}
                                </select>
                            </div>

                            {/* Quantity */}
                            <div className="waste-form-group">
                                <label>Quantity Wasted * {selectedItem && `(${selectedItem.unit})`}</label>
                                <input
                                    type="number"
                                    step="0.01"
                                    min="0.01"
                                    placeholder="Enter quantity"
                                    value={form.quantity}
                                    onChange={e => handleChange('quantity', e.target.value)}
                                    required
                                />
                                {selectedItem && (
                                    <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 4 }}>
                                        Current stock: {selectedItem.current_stock} {selectedItem.unit}
                                        {selectedItem.selling_price > 0 && ` · Selling price: £${selectedItem.selling_price.toFixed(2)}/${selectedItem.unit}`}
                                    </div>
                                )}
                            </div>

                            {/* Estimated Value (editable) */}
                            {selectedItem && form.quantity && (
                                <div className="waste-form-group">
                                    <label>Estimated Waste Value (£)</label>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                        <input
                                            type="number"
                                            step="0.01"
                                            min="0"
                                            value={form.estimated_value}
                                            onChange={e => setForm(prev => ({ ...prev, estimated_value: e.target.value }))}
                                            style={{ flex: 1 }}
                                        />
                                        <button type="button" className="btn btn-ghost btn-sm"
                                            onClick={() => {
                                                const price = selectedItem?.selling_price || selectedItem?.cost_price || 0;
                                                const qty = parseFloat(form.quantity) || 0;
                                                setForm(prev => ({ ...prev, estimated_value: (price * qty).toFixed(2) }));
                                            }}
                                            title="Reset to auto-calculated value">
                                            🔄 Reset
                                        </button>
                                    </div>
                                    <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 4 }}>
                                        Auto-calculated from selling price. Edit if needed.
                                    </div>
                                </div>
                            )}

                            {/* Category */}
                            <div className="waste-form-group">
                                <label>Waste Category *</label>
                                <select value={form.category} onChange={e => handleChange('category', e.target.value)} required>
                                    <option value="">Select category...</option>
                                    {WASTE_CATEGORIES.map(cat => (
                                        <option key={cat.value} value={cat.value}>
                                            {cat.icon} {cat.label}
                                        </option>
                                    ))}
                                </select>
                            </div>

                            {/* Batch (optional) */}
                            {batches.length > 0 && (
                                <div className="waste-form-group">
                                    <label>Link to Batch (Optional)</label>
                                    <select value={form.batch_id} onChange={e => handleChange('batch_id', e.target.value)}>
                                        <option value="">No specific batch</option>
                                        {batches.map(b => (
                                            <option key={b.id} value={b.id}>
                                                {b.batch_number} — {b.current_quantity} {b.unit} available · Exp: {formatDate(b.expiry_date)}
                                            </option>
                                        ))}
                                    </select>
                                </div>
                            )}

                            {/* Notes */}
                            <div className="waste-form-group">
                                <label>Notes (Optional)</label>
                                <textarea
                                    placeholder="Describe the waste event..."
                                    value={form.notes}
                                    onChange={e => handleChange('notes', e.target.value)}
                                />
                            </div>

                            {/* Location info */}
                            <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginBottom: 16, padding: '8px 12px', background: 'var(--color-surface-hover)', borderRadius: 8 }}>
                                📍 Location: <strong>{locationName}</strong>
                            </div>

                            {/* Image Upload */}
                            <div className="waste-form-group">
                                <label>Photo Evidence (Optional)</label>
                                {imagePreview ? (
                                    <div style={{ position: 'relative', display: 'inline-block', marginBottom: 8 }}>
                                        <img
                                            src={imagePreview}
                                            alt="Waste evidence"
                                            style={{ maxWidth: '100%', maxHeight: 180, borderRadius: 8, border: '1px solid var(--color-border)', display: 'block' }}
                                        />
                                        <button
                                            type="button"
                                            onClick={() => { setImageData(null); setImagePreview(null); if (fileInputRef.current) fileInputRef.current.value = ''; }}
                                            style={{
                                                position: 'absolute', top: 6, right: 6,
                                                background: '#ef4444', color: 'white', border: 'none', borderRadius: '50%',
                                                width: 28, height: 28, cursor: 'pointer',
                                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                            }}
                                        >
                                            <MdClose size={16} />
                                        </button>
                                    </div>
                                ) : (
                                    <div
                                        onClick={() => fileInputRef.current?.click()}
                                        style={{
                                            border: '2px dashed var(--color-border)',
                                            borderRadius: 10,
                                            padding: '24px 16px',
                                            textAlign: 'center',
                                            cursor: 'pointer',
                                            transition: 'border-color 0.2s',
                                            color: 'var(--color-text-muted)',
                                        }}
                                    >
                                        <MdImage style={{ fontSize: 32, opacity: 0.5, marginBottom: 6 }} />
                                        <div style={{ fontSize: 13, fontWeight: 500 }}>Click to upload photo</div>
                                        <div style={{ fontSize: 11, marginTop: 4 }}>JPG, PNG up to 5MB</div>
                                    </div>
                                )}
                                <input
                                    ref={fileInputRef}
                                    type="file"
                                    accept="image/*"
                                    style={{ display: 'none' }}
                                    onChange={(e) => {
                                        const file = e.target.files?.[0];
                                        if (!file) return;
                                        if (file.size > 5 * 1024 * 1024) {
                                            toast.error('Image must be under 5MB');
                                            return;
                                        }
                                        const reader = new FileReader();
                                        reader.onload = () => {
                                            setImageData(reader.result);
                                            setImagePreview(reader.result);
                                        };
                                        reader.readAsDataURL(file);
                                    }}
                                />
                            </div>

                            {/* Submit */}
                            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
                                <button type="button" className="btn btn-secondary btn-md" onClick={onClose}>Cancel</button>
                                <button type="submit" className="btn btn-primary btn-md" disabled={submitting}
                                    style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                    <MdDelete /> {submitting ? 'Logging...' : 'Log Waste'}
                                </button>
                            </div>
                        </>
                    )}
                </form>
            </div>
        </div>
    );
};

export default LogWasteModal;
