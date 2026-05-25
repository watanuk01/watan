import React, { useState, useEffect, useRef } from 'react';
import { MdClose, MdDelete, MdImage, MdSearch } from 'react-icons/md';
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
    const [itemSearch, setItemSearch] = useState('');
    const [selectedCategory, setSelectedCategory] = useState('All');
    const [selectedInvCategory, setSelectedInvCategory] = useState('All');
    const [showItemDropdown, setShowItemDropdown] = useState(false);
    const itemDropdownRef = useRef(null);

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

    // Handle clicks outside the dropdown to close it
    useEffect(() => {
        const handleClickOutside = (event) => {
            if (itemDropdownRef.current && !itemDropdownRef.current.contains(event.target)) {
                setShowItemDropdown(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
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
                            {/* Item Search / Selection */}
                            <div className="waste-form-group" ref={itemDropdownRef} style={{ position: 'relative' }}>
                                <label>Item *</label>
                                
                                {/* Item Type Filters */}
                                <div style={{ display: 'flex', gap: 8, marginBottom: 8, overflowX: 'auto', paddingBottom: 4 }}>
                                    {['All', 'grocery', 'raw_meat', 'cooked_meat'].map(cat => (
                                        <button
                                            type="button"
                                            key={cat}
                                            onClick={() => setSelectedCategory(cat)}
                                            style={{
                                                padding: '4px 12px',
                                                borderRadius: '16px',
                                                border: '1px solid',
                                                borderColor: selectedCategory === cat ? 'var(--color-primary)' : 'var(--color-border)',
                                                background: selectedCategory === cat ? 'var(--color-primary)' : 'var(--color-surface)',
                                                color: selectedCategory === cat ? 'var(--color-bg)' : 'var(--color-text-secondary)',
                                                fontSize: '12px',
                                                fontWeight: selectedCategory === cat ? 600 : 500,
                                                cursor: 'pointer',
                                                whiteSpace: 'nowrap',
                                                transition: 'all 0.2s'
                                            }}
                                        >
                                            {cat === 'All' ? 'All Types' : cat.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase())}
                                        </button>
                                    ))}
                                </div>

                                {/* Inventory Category Filters */}
                                {(() => {
                                    const catNames = [...new Set(
                                        items
                                            .filter(i => selectedCategory === 'All' || i.item_type === selectedCategory)
                                            .map(i => i.category_name)
                                            .filter(Boolean)
                                    )].sort();
                                    if (catNames.length === 0) return null;
                                    return (
                                        <div style={{ display: 'flex', gap: 6, marginBottom: 8, overflowX: 'auto', paddingBottom: 4, flexWrap: 'wrap' }}>
                                            <button
                                                type="button"
                                                onClick={() => setSelectedInvCategory('All')}
                                                style={{
                                                    padding: '3px 10px',
                                                    borderRadius: '12px',
                                                    border: '1px solid',
                                                    borderColor: selectedInvCategory === 'All' ? '#8b5cf6' : 'var(--color-border)',
                                                    background: selectedInvCategory === 'All' ? '#8b5cf6' : 'var(--color-surface)',
                                                    color: selectedInvCategory === 'All' ? '#fff' : 'var(--color-text-secondary)',
                                                    fontSize: '11px',
                                                    fontWeight: selectedInvCategory === 'All' ? 600 : 500,
                                                    cursor: 'pointer',
                                                    whiteSpace: 'nowrap',
                                                    transition: 'all 0.2s'
                                                }}
                                            >
                                                All Categories
                                            </button>
                                            {catNames.map(cn => (
                                                <button
                                                    type="button"
                                                    key={cn}
                                                    onClick={() => setSelectedInvCategory(cn)}
                                                    style={{
                                                        padding: '3px 10px',
                                                        borderRadius: '12px',
                                                        border: '1px solid',
                                                        borderColor: selectedInvCategory === cn ? '#8b5cf6' : 'var(--color-border)',
                                                        background: selectedInvCategory === cn ? '#8b5cf6' : 'var(--color-surface)',
                                                        color: selectedInvCategory === cn ? '#fff' : 'var(--color-text-secondary)',
                                                        fontSize: '11px',
                                                        fontWeight: selectedInvCategory === cn ? 600 : 500,
                                                        cursor: 'pointer',
                                                        whiteSpace: 'nowrap',
                                                        transition: 'all 0.2s'
                                                    }}
                                                >
                                                    {cn}
                                                </button>
                                            ))}
                                        </div>
                                    );
                                })()}

                                <div style={{ position: 'relative' }}>
                                    <MdSearch style={{ position: 'absolute', left: 12, top: 12, color: 'var(--color-text-muted)', fontSize: 18 }} />
                                    <input
                                        type="text"
                                        placeholder="Search and select item..."
                                        value={itemSearch}
                                        onChange={e => {
                                            setItemSearch(e.target.value);
                                            setShowItemDropdown(true);
                                            if (form.item_id) handleChange('item_id', '');
                                        }}
                                        onFocus={() => setShowItemDropdown(true)}
                                        style={{ 
                                            width: '100%', 
                                            padding: '10px 12px 10px 36px', 
                                            borderRadius: '8px', 
                                            border: '1px solid var(--color-border)', 
                                            fontSize: '14px', 
                                            boxSizing: 'border-box',
                                            background: 'var(--color-bg)',
                                            color: 'var(--color-text-primary)'
                                        }}
                                        required={!form.item_id}
                                    />
                                    {showItemDropdown && (
                                        <div style={{
                                            position: 'absolute', top: '100%', left: 0, right: 0,
                                            backgroundColor: '#ffffff', border: '1px solid var(--color-border)', 
                                            borderRadius: '8px', marginTop: '4px', maxHeight: '240px', 
                                            overflowY: 'auto', zIndex: 9999, boxShadow: '0 8px 24px rgba(0,0,0,0.25)',
                                            opacity: 1
                                        }}>
                                            {(() => {
                                                const filtered = items.filter(item => {
                                                    if (selectedCategory !== 'All' && item.item_type !== selectedCategory) return false;
                                                    if (selectedInvCategory !== 'All' && (item.category_name || '') !== selectedInvCategory) return false;
                                                    if (!itemSearch) return true;
                                                    const q = itemSearch.toLowerCase();
                                                    return item.name.toLowerCase().includes(q) || item.item_type.replace('_', ' ').toLowerCase().includes(q);
                                                });

                                                if (filtered.length === 0) {
                                                    return (
                                                        <div style={{ padding: '12px', color: '#64748b', fontSize: '13px', textAlign: 'center' }}>
                                                            No items found matching "{itemSearch}"
                                                        </div>
                                                    );
                                                }

                                                return filtered.map(item => (
                                                    <div
                                                        key={item.id}
                                                        onClick={() => {
                                                            handleChange('item_id', item.id);
                                                            setItemSearch(item.name);
                                                            setShowItemDropdown(false);
                                                        }}
                                                        style={{
                                                            padding: '10px 12px', cursor: 'pointer', borderBottom: '1px solid #e2e8f0',
                                                            backgroundColor: form.item_id === item.id ? '#f1f5f9' : '#ffffff',
                                                            display: 'flex', flexDirection: 'column', gap: 4,
                                                            transition: 'background-color 0.15s'
                                                        }}
                                                        onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#f8fafc'}
                                                        onMouseLeave={(e) => e.currentTarget.style.backgroundColor = form.item_id === item.id ? '#f1f5f9' : '#ffffff'}
                                                    >
                                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                                            <span style={{ fontWeight: 600, fontSize: '14px', color: '#0f172a' }}>{item.name}</span>
                                                            <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                                                                {item.category_name && (
                                                                    <span style={{ fontSize: '10px', color: '#7c3aed', background: '#f5f3ff', padding: '2px 6px', borderRadius: '4px' }}>
                                                                        {item.category_name}
                                                                    </span>
                                                                )}
                                                                <span style={{ fontSize: '11px', color: '#475569', background: '#f1f5f9', padding: '2px 6px', borderRadius: '4px', textTransform: 'capitalize' }}>
                                                                    {item.item_type.replace('_', ' ')}
                                                                </span>
                                                            </div>
                                                        </div>
                                                        <div style={{ fontSize: '12px', color: '#64748b' }}>
                                                            Current Stock: <strong style={{ color: '#0284c7' }}>{item.current_stock} {item.unit}</strong>
                                                        </div>
                                                    </div>
                                                ));
                                            })()}
                                        </div>
                                    )}
                                </div>
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
