import React, { useState, useEffect, useRef } from 'react';
import {
    addItem,
    updateItem,
    UNITS,
    STORAGE_TYPES,
    VAT_RATES,
    isBaseUnit,
} from '../../services/inventoryService';
import UnitConversionBuilder from '../../components/inventory/UnitConversionBuilder';
import { MdClose } from 'react-icons/md';
import toast from 'react-hot-toast';

const RawMeatItemForm = ({ item, categories, onSubmit, onClose }) => {
    const isEdit = Boolean(item);
    const [formData, setFormData] = useState({
        name: '',
        category_id: '',
        category_name: '',
        unit: 'kg',
        base_unit: 'kg',
        unit_conversion: { has_conversion: false, levels: [], base_factor: 1 },
        vendor: '',
        cost_price: 0,
        selling_price: 0,
        vat_rate: 0,
        vat_exempt: true,
        min_stock: 0,
        low_stock_threshold: 0,
        default_expiry_days: 3,
        storage_type: 'chilled',
        notes: '',
    });
    const [loading, setLoading] = useState(false);
    const [errors, setErrors] = useState({});
    const nameRef = useRef(null);

    useEffect(() => {
        if (isEdit && item) {
            setFormData({
                name: item.name || '',
                category_id: item.category_id || '',
                category_name: item.category_name || '',
                unit: item.unit || 'kg',
                base_unit: item.base_unit || item.unit || 'kg',
                unit_conversion: item.unit_conversion || { has_conversion: false, levels: [], base_factor: 1 },
                vendor: item.vendor || '',
                cost_price: item.cost_price || 0,
                selling_price: item.selling_price || 0,
                vat_rate: item.vat_rate ?? 0,
                vat_exempt: item.vat_exempt ?? true,
                min_stock: item.min_stock || 0,
                low_stock_threshold: item.low_stock_threshold || item.min_stock || 0,
                default_expiry_days: item.default_expiry_days || 3,
                storage_type: item.storage_type || 'chilled',
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
            if (field === 'category_id') {
                const cat = categories.find(c => c.id === value);
                updated.category_name = cat?.name || '';
            }
            if (field === 'vat_exempt') {
                updated.vat_rate = value ? 0 : 20;
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
        if (formData.cost_price < 0) e.cost_price = 'Cannot be negative';
        if (formData.default_expiry_days < 1) e.default_expiry_days = 'Must be at least 1 day';
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
                item_type: 'raw_meat',
                min_stock: Number(formData.min_stock),
                low_stock_threshold: Number(formData.low_stock_threshold || formData.min_stock),
                cost_price: Number(formData.cost_price),
                selling_price: Number(formData.selling_price),
                default_expiry_days: Number(formData.default_expiry_days),
                batch_tracking: true,
            };

            if (isEdit) {
                await updateItem(item.id, data);
                toast.success(`${data.name} updated`);
            } else {
                await addItem(data);
                toast.success(`${data.name} added to Raw Meat`);
            }
            onSubmit();
        } catch (err) {
            toast.error(err.message || 'Failed to save item');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal modal-lg" onClick={(e) => e.stopPropagation()}>
                <div className="modal-header">
                    <div>
                        <h2>{isEdit ? 'Edit Raw Meat Item' : 'Add Raw Meat Item'}</h2>
                        <p style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', marginTop: 'var(--space-1)' }}>
                            🥩 Always batch-tracked with expiry — chicken, mutton, fish
                        </p>
                    </div>
                    <button className="modal-close" onClick={onClose}><MdClose /></button>
                </div>

                <form onSubmit={handleSubmit}>
                    <div className="modal-body">
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
                            {/* Name */}
                            <div className="form-group">
                                <label className="form-label" htmlFor="rm-name">Item Name *</label>
                                <input
                                    ref={nameRef}
                                    id="rm-name"
                                    type="text"
                                    className={`form-input ${errors.name ? 'error' : ''}`}
                                    placeholder="e.g. Chicken Breast, Mutton Leg"
                                    value={formData.name}
                                    onChange={(e) => handleChange('name', e.target.value)}
                                    disabled={loading}
                                />
                                {errors.name && <span className="form-error">{errors.name}</span>}
                            </div>

                            {/* Category + Unit */}
                            <div className="form-row">
                                <div className="form-group">
                                    <label className="form-label" htmlFor="rm-category">Category *</label>
                                    <select
                                        id="rm-category"
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
                                    <label className="form-label" htmlFor="rm-unit">Unit *</label>
                                    <select
                                        id="rm-unit"
                                        className={`form-select ${errors.unit ? 'error' : ''}`}
                                        value={formData.unit}
                                        onChange={(e) => handleChange('unit', e.target.value)}
                                        disabled={loading}
                                    >
                                        {UNITS.filter(u => ['kg', 'g', 'pcs', 'portions', 'box', 'pack', 'bag', 'tray'].includes(u.value)).map(u => (
                                            <option key={u.value} value={u.value}>{u.label}</option>
                                        ))}
                                    </select>
                                </div>
                            </div>

                            {/* Unit Conversion Builder */}
                            <UnitConversionBuilder
                                stockingUnit={formData.unit}
                                value={formData.unit_conversion}
                                baseUnit={formData.base_unit}
                                onChange={({ unit_conversion, base_unit }) => {
                                    setFormData(prev => ({ ...prev, unit_conversion, base_unit }));
                                }}
                            />

                            {/* Vendor + Storage */}
                            <div className="form-row">
                                <div className="form-group">
                                    <label className="form-label" htmlFor="rm-vendor">Vendor *</label>
                                    <input
                                        id="rm-vendor"
                                        type="text"
                                        className="form-input"
                                        placeholder="e.g. Smithfield Meats"
                                        value={formData.vendor}
                                        onChange={(e) => handleChange('vendor', e.target.value)}
                                        disabled={loading}
                                    />
                                </div>
                                <div className="form-group">
                                    <label className="form-label" htmlFor="rm-storage">Storage Type</label>
                                    <select
                                        id="rm-storage"
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
                            </div>

                            {/* Pricing */}
                            <div className="form-row">
                                <div className="form-group">
                                    <label className="form-label" htmlFor="rm-cost">Actual Cost (£/unit) *</label>
                                    <input
                                        id="rm-cost"
                                        type="number"
                                        className={`form-input ${errors.cost_price ? 'error' : ''}`}
                                        value={formData.cost_price}
                                        onChange={(e) => handleChange('cost_price', e.target.value)}
                                        disabled={loading}
                                        min="0"
                                        step="0.01"
                                        placeholder="0.00"
                                    />
                                    <span className="form-hint">Purchase price per {formData.unit}</span>
                                </div>
                                <div className="form-group">
                                    <label className="form-label" htmlFor="rm-sell">Selling Price (£/unit)</label>
                                    <input
                                        id="rm-sell"
                                        type="number"
                                        className="form-input"
                                        value={formData.selling_price}
                                        onChange={(e) => handleChange('selling_price', e.target.value)}
                                        disabled={loading}
                                        min="0"
                                        step="0.01"
                                        placeholder="0.00"
                                    />
                                    <span className="form-hint">Price visible to restaurants</span>
                                </div>
                            </div>

                            {/* VAT */}
                            <div className="form-group">
                                <label className="form-label">VAT Rate</label>
                                <div className="vat-toggle-group">
                                    {VAT_RATES.map(v => (
                                        <button
                                            key={v.value}
                                            type="button"
                                            className={`vat-toggle-btn ${!formData.vat_exempt && formData.vat_rate === v.value ? 'active' : ''}`}
                                            onClick={() => { handleChange('vat_exempt', false); handleChange('vat_rate', v.value); }}
                                            disabled={loading}
                                        >
                                            {v.value}%
                                        </button>
                                    ))}
                                    <button
                                        type="button"
                                        className={`vat-toggle-btn exempt ${formData.vat_exempt ? 'active' : ''}`}
                                        onClick={() => handleChange('vat_exempt', !formData.vat_exempt)}
                                        disabled={loading}
                                    >
                                        Exempt
                                    </button>
                                </div>
                            </div>

                            {/* Expiry + Threshold */}
                            <div className="form-row">
                                <div className="form-group">
                                    <label className="form-label" htmlFor="rm-expiry">Default Expiry Duration (days) *</label>
                                    <input
                                        id="rm-expiry"
                                        type="number"
                                        className={`form-input ${errors.default_expiry_days ? 'error' : ''}`}
                                        value={formData.default_expiry_days}
                                        onChange={(e) => handleChange('default_expiry_days', e.target.value)}
                                        disabled={loading}
                                        min="1"
                                    />
                                    {errors.default_expiry_days && <span className="form-error">{errors.default_expiry_days}</span>}
                                    <span className="form-hint">Batch expiry will be set to this many days from receipt</span>
                                </div>
                                <div className="form-group">
                                    <label className="form-label" htmlFor="rm-threshold">Low Stock Threshold</label>
                                    <input
                                        id="rm-threshold"
                                        type="number"
                                        className="form-input"
                                        value={formData.low_stock_threshold}
                                        onChange={(e) => handleChange('low_stock_threshold', e.target.value)}
                                        disabled={loading}
                                        min="0"
                                    />
                                </div>
                            </div>

                            {/* Info badges */}
                            <div style={{
                                display: 'flex',
                                gap: 'var(--space-2)',
                                padding: 'var(--space-3)',
                                background: 'rgba(239, 68, 68, 0.08)',
                                borderRadius: 'var(--radius-md)',
                                border: '1px solid rgba(239, 68, 68, 0.15)',
                            }}>
                                <span style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)' }}>
                                    ℹ️ Batch tracking is <strong>always enabled</strong> for raw meat. Each purchase receipt creates a new batch with expiry.
                                </span>
                            </div>

                            {/* Notes */}
                            <div className="form-group">
                                <label className="form-label" htmlFor="rm-notes">Notes</label>
                                <textarea
                                    id="rm-notes"
                                    className="form-textarea"
                                    placeholder="Any additional notes..."
                                    value={formData.notes}
                                    onChange={(e) => handleChange('notes', e.target.value)}
                                    disabled={loading}
                                    rows={2}
                                />
                            </div>
                        </div>
                    </div>

                    <div className="modal-footer">
                        <button type="button" className="btn btn-secondary btn-md" onClick={onClose} disabled={loading}>
                            Cancel
                        </button>
                        <button type="submit" className="btn btn-primary btn-md" disabled={loading}>
                            {loading ? 'Saving...' : (isEdit ? 'Save Changes' : 'Add Item')}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

export default RawMeatItemForm;
