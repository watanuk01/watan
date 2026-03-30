import React, { useState, useEffect, useRef } from 'react';
import {
    addItem,
    updateItem,
    UNITS,
    STORAGE_TYPES,
} from '../../services/inventoryService';
import { MdClose } from 'react-icons/md';
import toast from 'react-hot-toast';

const ItemFormModal = ({ item, categories, onSubmit, onClose }) => {
    const isEdit = Boolean(item);
    const [formData, setFormData] = useState({
        name: '',
        sku: '',
        category_id: '',
        category_name: '',
        unit: 'kg',
        min_stock: 0,
        max_stock: 0,
        cost_price: 0,
        selling_price: 0,
        storage_type: 'ambient',
        supplier_name: '',
        notes: '',
    });
    const [loading, setLoading] = useState(false);
    const [errors, setErrors] = useState({});
    const nameRef = useRef(null);

    useEffect(() => {
        if (isEdit && item) {
            setFormData({
                name: item.name || '',
                sku: item.sku || '',
                category_id: item.category_id || '',
                category_name: item.category_name || '',
                unit: item.unit || 'kg',
                min_stock: item.min_stock || 0,
                max_stock: item.max_stock || 0,
                cost_price: item.cost_price || 0,
                selling_price: item.selling_price || 0,
                storage_type: item.storage_type || 'ambient',
                supplier_name: item.supplier_name || '',
                notes: item.notes || '',
            });
        } else if (categories.length > 0 && !formData.category_id) {
            setFormData(prev => ({
                ...prev,
                category_id: categories[0].id,
                category_name: categories[0].name,
            }));
        }
        setTimeout(() => nameRef.current?.focus(), 100);
    }, [isEdit, item]); // eslint-disable-line react-hooks/exhaustive-deps

    const handleChange = (field, value) => {
        setFormData(prev => {
            const updated = { ...prev, [field]: value };
            // Auto-fill category_name when category_id changes
            if (field === 'category_id') {
                const cat = categories.find(c => c.id === value);
                updated.category_name = cat?.name || '';
            }
            return updated;
        });
        if (errors[field]) setErrors(prev => ({ ...prev, [field]: '' }));
    };

    const validate = () => {
        const e = {};
        if (!formData.name.trim()) e.name = 'Name is required';
        if (!formData.category_id) e.category_id = 'Category is required';
        if (!formData.unit) e.unit = 'Unit is required';
        if (formData.min_stock < 0) e.min_stock = 'Cannot be negative';
        if (formData.cost_price < 0) e.cost_price = 'Cannot be negative';
        setErrors(e);
        return Object.keys(e).length === 0;
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!validate()) return;

        setLoading(true);
        try {
            const data = {
                ...formData,
                min_stock: Number(formData.min_stock),
                max_stock: Number(formData.max_stock),
                cost_price: Number(formData.cost_price),
                selling_price: Number(formData.selling_price),
            };

            if (isEdit) {
                await updateItem(item.id, data);
                toast.success(`${data.name} updated`);
            } else {
                const cat = categories.find(c => c.id === data.category_id);
                await addItem(data, cat?.type);
                toast.success(`${data.name} added to inventory`);
            }
            onSubmit();
        } catch (err) {
            console.error('Error saving item:', err);
            toast.error(err.message || 'Failed to save item');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal modal-lg" onClick={(e) => e.stopPropagation()}>
                <div className="modal-header">
                    <h2>{isEdit ? 'Edit Item' : 'Add New Item'}</h2>
                    <button className="modal-close" onClick={onClose}><MdClose /></button>
                </div>

                <form onSubmit={handleSubmit}>
                    <div className="modal-body">
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
                            {/* Name + SKU */}
                            <div className="form-row">
                                <div className="form-group" style={{ flex: 2 }}>
                                    <label className="form-label" htmlFor="item-name">Item Name *</label>
                                    <input
                                        ref={nameRef}
                                        id="item-name"
                                        type="text"
                                        className={`form-input ${errors.name ? 'error' : ''}`}
                                        placeholder="e.g. Chicken Breast"
                                        value={formData.name}
                                        onChange={(e) => handleChange('name', e.target.value)}
                                        disabled={loading}
                                    />
                                    {errors.name && <span className="form-error">{errors.name}</span>}
                                </div>
                                <div className="form-group" style={{ flex: 1 }}>
                                    <label className="form-label" htmlFor="item-sku">SKU</label>
                                    <input
                                        id="item-sku"
                                        type="text"
                                        className="form-input"
                                        placeholder="Auto-generated"
                                        value={formData.sku}
                                        onChange={(e) => handleChange('sku', e.target.value)}
                                        disabled={loading || isEdit}
                                        style={isEdit ? { opacity: 0.6 } : {}}
                                    />
                                    <span className="form-hint">{isEdit ? 'SKU cannot be changed' : 'Leave blank to auto-generate'}</span>
                                </div>
                            </div>

                            {/* Category + Unit */}
                            <div className="form-row">
                                <div className="form-group">
                                    <label className="form-label" htmlFor="item-category">Category *</label>
                                    <select
                                        id="item-category"
                                        className={`form-select ${errors.category_id ? 'error' : ''}`}
                                        value={formData.category_id}
                                        onChange={(e) => handleChange('category_id', e.target.value)}
                                        disabled={loading}
                                    >
                                        <option value="">Select category</option>
                                        {categories.map(c => (
                                            <option key={c.id} value={c.id}>{c.icon} {c.name}</option>
                                        ))}
                                    </select>
                                    {errors.category_id && <span className="form-error">{errors.category_id}</span>}
                                </div>
                                <div className="form-group">
                                    <label className="form-label" htmlFor="item-unit">Unit of Measurement *</label>
                                    <select
                                        id="item-unit"
                                        className={`form-select ${errors.unit ? 'error' : ''}`}
                                        value={formData.unit}
                                        onChange={(e) => handleChange('unit', e.target.value)}
                                        disabled={loading}
                                    >
                                        {UNITS.map(u => (
                                            <option key={u.value} value={u.value}>{u.label}</option>
                                        ))}
                                    </select>
                                </div>
                            </div>

                            {/* Stock Levels */}
                            <div className="form-row">
                                <div className="form-group">
                                    <label className="form-label" htmlFor="item-min-stock">Minimum Stock (Reorder Point)</label>
                                    <input
                                        id="item-min-stock"
                                        type="number"
                                        className={`form-input ${errors.min_stock ? 'error' : ''}`}
                                        value={formData.min_stock}
                                        onChange={(e) => handleChange('min_stock', e.target.value)}
                                        disabled={loading}
                                        min="0"
                                    />
                                    {errors.min_stock && <span className="form-error">{errors.min_stock}</span>}
                                </div>
                                <div className="form-group">
                                    <label className="form-label" htmlFor="item-max-stock">Maximum Stock</label>
                                    <input
                                        id="item-max-stock"
                                        type="number"
                                        className="form-input"
                                        value={formData.max_stock}
                                        onChange={(e) => handleChange('max_stock', e.target.value)}
                                        disabled={loading}
                                        min="0"
                                    />
                                </div>
                            </div>

                            {/* Pricing */}
                            <div className="form-row">
                                <div className="form-group">
                                    <label className="form-label" htmlFor="item-cost">Cost Price (£)</label>
                                    <input
                                        id="item-cost"
                                        type="number"
                                        className={`form-input ${errors.cost_price ? 'error' : ''}`}
                                        value={formData.cost_price}
                                        onChange={(e) => handleChange('cost_price', e.target.value)}
                                        disabled={loading}
                                        min="0"
                                        step="0.01"
                                    />
                                </div>
                                <div className="form-group">
                                    <label className="form-label" htmlFor="item-sell">Selling Price (£)</label>
                                    <input
                                        id="item-sell"
                                        type="number"
                                        className="form-input"
                                        value={formData.selling_price}
                                        onChange={(e) => handleChange('selling_price', e.target.value)}
                                        disabled={loading}
                                        min="0"
                                        step="0.01"
                                    />
                                </div>
                            </div>

                            {/* Storage + Supplier */}
                            <div className="form-row">
                                <div className="form-group">
                                    <label className="form-label" htmlFor="item-storage">Storage Type</label>
                                    <select
                                        id="item-storage"
                                        className="form-select"
                                        value={formData.storage_type}
                                        onChange={(e) => handleChange('storage_type', e.target.value)}
                                        disabled={loading}
                                    >
                                        {STORAGE_TYPES.map(s => (
                                            <option key={s.value} value={s.value}>{s.label}</option>
                                        ))}
                                    </select>
                                </div>
                                <div className="form-group">
                                    <label className="form-label" htmlFor="item-supplier">Supplier Name</label>
                                    <input
                                        id="item-supplier"
                                        type="text"
                                        className="form-input"
                                        placeholder="e.g. Fresh Direct UK"
                                        value={formData.supplier_name}
                                        onChange={(e) => handleChange('supplier_name', e.target.value)}
                                        disabled={loading}
                                    />
                                </div>
                            </div>

                            {/* Notes */}
                            <div className="form-group">
                                <label className="form-label" htmlFor="item-notes">Notes</label>
                                <textarea
                                    id="item-notes"
                                    className="form-textarea"
                                    placeholder="Any additional notes..."
                                    value={formData.notes}
                                    onChange={(e) => handleChange('notes', e.target.value)}
                                    disabled={loading}
                                    rows={3}
                                />
                            </div>
                        </div>
                    </div>

                    <div className="modal-footer">
                        <button type="button" className="btn btn-secondary btn-md" onClick={onClose} disabled={loading}>
                            Cancel
                        </button>
                        <button type="submit" className="btn btn-primary btn-md" disabled={loading}>
                            {loading ? (isEdit ? 'Saving...' : 'Creating...') : (isEdit ? 'Save Changes' : 'Add Item')}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

export default ItemFormModal;
