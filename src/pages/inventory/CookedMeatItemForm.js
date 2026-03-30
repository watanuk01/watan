import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
    addItem,
    updateItem,
    getIngredientItems,
    UNITS,
    VAT_RATES,
    isBaseUnit,
} from '../../services/inventoryService';
import UnitConversionBuilder from '../../components/inventory/UnitConversionBuilder';
import { MdClose, MdAdd, MdDelete, MdSearch } from 'react-icons/md';
import toast from 'react-hot-toast';

const CookedMeatItemForm = ({ item, categories, onSubmit, onClose }) => {
    const isEdit = Boolean(item);
    const [formData, setFormData] = useState({
        name: '',
        category_id: '',
        category_name: '',
        unit: 'kg',
        base_unit: 'kg',
        unit_conversion: { has_conversion: false, levels: [], base_factor: 1 },
        cost_price: 0,
        selling_price: 0,
        vat_rate: 20,
        vat_exempt: false,
        min_stock: 0,
        low_stock_threshold: 0,
        default_expiry_days: 2,
        notes: '',
    });
    const [recipe, setRecipe] = useState({
        base_batch_size: 10,
        base_batch_unit: 'kg',
        ingredients: [],
    });
    const [productionQtys, setProductionQtys] = useState('');
    const [loading, setLoading] = useState(false);
    const [errors, setErrors] = useState({});
    const nameRef = useRef(null);

    // Ingredient search
    const [ingredientItems, setIngredientItems] = useState([]);
    const [ingredientSearch, setIngredientSearch] = useState('');
    const [showIngredientSearch, setShowIngredientSearch] = useState(false);
    const [ingredientLoading, setIngredientLoading] = useState(false);
    const searchRef = useRef(null);

    // Track whether user manually edited cost/selling prices
    const costManuallySet = useRef(false);
    const sellingManuallySet = useRef(false);
    const initialLoadDone = useRef(false);

    useEffect(() => {
        if (isEdit && item) {
            setFormData({
                name: item.name || '',
                category_id: item.category_id || '',
                category_name: item.category_name || '',
                unit: item.unit || 'kg',
                base_unit: item.base_unit || item.unit || 'kg',
                unit_conversion: item.unit_conversion || { has_conversion: false, levels: [], base_factor: 1 },
                cost_price: item.cost_price || 0,
                selling_price: item.selling_price || 0,
                vat_rate: item.vat_rate ?? 20,
                vat_exempt: item.vat_exempt || false,
                min_stock: item.min_stock || 0,
                low_stock_threshold: item.low_stock_threshold || item.min_stock || 0,
                default_expiry_days: item.default_expiry_days || 2,
                notes: item.notes || '',
            });
            // Mark manual overrides from saved data
            if (item.cost_manually_set) costManuallySet.current = true;
            if (item.selling_manually_set) sellingManuallySet.current = true;
            if (item.recipe) {
                setRecipe(item.recipe);
            }
            if (item.allowed_production_quantities) {
                setProductionQtys(item.allowed_production_quantities.join(', '));
            }
            // Delay so initial auto-calc doesn't overwrite
            setTimeout(() => { initialLoadDone.current = true; }, 500);
        } else {
            initialLoadDone.current = true;
            if (categories.length > 0 && !formData.category_id) {
                setFormData(prev => ({
                    ...prev,
                    category_id: categories[0].id,
                    category_name: categories[0].name,
                }));
            }
        }
        setTimeout(() => nameRef.current?.focus(), 100);
    }, [isEdit, item]); // eslint-disable-line react-hooks/exhaustive-deps

    // Load available ingredients (grocery + raw meat items)
    useEffect(() => {
        const loadIngredients = async () => {
            setIngredientLoading(true);
            try {
                const items = await getIngredientItems();
                setIngredientItems(items);
            } catch (err) {
                console.error('Failed to load ingredients:', err);
            } finally {
                setIngredientLoading(false);
            }
        };
        loadIngredients();
    }, []);

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
            // Track manual price overrides
            if (field === 'cost_price') costManuallySet.current = true;
            if (field === 'selling_price') sellingManuallySet.current = true;
            return updated;
        });
        if (errors[field]) setErrors(prev => ({ ...prev, [field]: '' }));
    };

    const handleRecipeChange = (field, value) => {
        setRecipe(prev => ({ ...prev, [field]: value }));
    };

    const getAvailableUnits = (item) => {
        if (!item) return [];
        const units = [{ label: item.unit, value: item.unit, conversion_to_master: 1 }];
        if (!item?.unit_conversion?.has_conversion) {
            if (item.unit === 'kg' || item.unit === 'Kg') {
                units.push({ label: 'g', value: 'g', conversion_to_master: 0.001 });
            } else if (item.unit === 'l' || item.unit === 'L' || item.unit === 'liter') {
                units.push({ label: 'ml', value: 'ml', conversion_to_master: 0.001 });
            }
            return units;
        }
        let currentFactor = 1;
        if (item.unit_conversion?.levels) {
            for (const level of item.unit_conversion.levels) {
                currentFactor *= level.factor;
                if (!units.some(u => u.value === level.to)) {
                    units.push({
                        label: level.to,
                        value: level.to,
                        conversion_to_master: 1 / currentFactor
                    });
                }
            }
        }
        return units;
    };

    const addIngredient = (ingredientItem) => {
        // Check if already added
        if (recipe.ingredients.some(ing => ing.item_id === ingredientItem.id)) {
            toast.error(`${ingredientItem.name} is already in the recipe`);
            return;
        }
        setRecipe(prev => ({
            ...prev,
            ingredients: [
                ...prev.ingredients,
                {
                    item_id: ingredientItem.id,
                    item_name: ingredientItem.name,
                    item_type: ingredientItem.item_type,
                    quantity: 0,
                    unit: ingredientItem.unit,
                    conversion_to_master: 1,
                },
            ],
        }));
        setIngredientSearch('');
        setShowIngredientSearch(false);
    };

    const updateIngredientQty = (index, qty) => {
        setRecipe(prev => ({
            ...prev,
            ingredients: prev.ingredients.map((ing, i) =>
                i === index ? { ...ing, quantity: Number(qty) } : ing
            ),
        }));
    };

    const updateIngredientUnit = (index, newUnitVal, ingredientItem) => {
        setRecipe(prev => ({
            ...prev,
            ingredients: prev.ingredients.map((ing, i) => {
                if (i === index) {
                    const units = getAvailableUnits(ingredientItem);
                    const unitObj = units.find(u => u.value === newUnitVal);
                    return {
                        ...ing,
                        unit: newUnitVal,
                        conversion_to_master: unitObj ? unitObj.conversion_to_master : 1
                    };
                }
                return ing;
            }),
        }));
    };

    const removeIngredient = (index) => {
        setRecipe(prev => ({
            ...prev,
            ingredients: prev.ingredients.filter((_, i) => i !== index),
        }));
    };

    const filteredIngredients = ingredientItems.filter(item =>
        item.name.toLowerCase().includes(ingredientSearch.toLowerCase()) &&
        !recipe.ingredients.some(ing => ing.item_id === item.id)
    );

    // Check for missing ingredients (deleted from master)
    const missingIngredients = recipe.ingredients.filter(
        ing => ingredientItems.length > 0 && !ingredientItems.some(item => item.id === ing.item_id)
    );
    const hasMissingIngredients = missingIngredients.length > 0 && !ingredientLoading;

    // Auto-calculate cost and selling price from ingredients
    const calculatedPrices = useMemo(() => {
        if (recipe.ingredients.length === 0 || !recipe.base_batch_size) {
            return { cost: 0, selling: 0 };
        }
        let totalCost = 0;
        let totalSelling = 0;
        for (const ing of recipe.ingredients) {
            const masterItem = ingredientItems.find(i => i.id === ing.item_id);
            if (masterItem) {
                const conv = ing.conversion_to_master || 1;
                totalCost += (Number(masterItem.cost_price) || 0) * (Number(ing.quantity) || 0) * conv;
                totalSelling += (Number(masterItem.selling_price) || 0) * (Number(ing.quantity) || 0) * conv;
            }
        }
        const batchSize = Number(recipe.base_batch_size) || 1;
        return {
            cost: Number((totalCost / batchSize).toFixed(2)),
            selling: Number((totalSelling / batchSize).toFixed(2)),
        };
    }, [recipe.ingredients, recipe.base_batch_size, ingredientItems]);

    // Auto-populate prices into form — only when user hasn't manually overridden
    useEffect(() => {
        if (!initialLoadDone.current) return;
        if (!costManuallySet.current && calculatedPrices.cost > 0) {
            setFormData(prev => ({ ...prev, cost_price: calculatedPrices.cost }));
        }
        if (!sellingManuallySet.current && calculatedPrices.selling > 0) {
            setFormData(prev => ({ ...prev, selling_price: calculatedPrices.selling }));
        }
    }, [calculatedPrices]);

    const validate = () => {
        const e = {};
        if (!formData.name.trim()) e.name = 'Name is required';
        if (!formData.category_id) e.category_id = 'Category is required';
        if (recipe.base_batch_size <= 0) e.base_batch_size = 'Base batch size must be positive';
        if (recipe.ingredients.length === 0) e.ingredients = 'At least one ingredient is required';
        const zeroQty = recipe.ingredients.find(ing => ing.quantity <= 0);
        if (zeroQty) e.ingredients = `Quantity for ${zeroQty.item_name} must be > 0`;
        if (formData.default_expiry_days < 1) e.default_expiry_days = 'Must be at least 1 day';
        setErrors(e);
        return Object.keys(e).length === 0;
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!validate()) return;

        setLoading(true);
        try {
            // Parse production quantities
            const allowed = productionQtys
                .split(',')
                .map(s => Number(s.trim()))
                .filter(n => n > 0);

            const data = {
                ...formData,
                item_type: 'cooked_meat',
                min_stock: Number(formData.min_stock),
                low_stock_threshold: Number(formData.low_stock_threshold || formData.min_stock),
                default_expiry_days: Number(formData.default_expiry_days),
                cost_price: Number(formData.cost_price),
                selling_price: Number(formData.selling_price),
                cost_manually_set: costManuallySet.current,
                selling_manually_set: sellingManuallySet.current,
                batch_tracking: true,
                recipe: {
                    ...recipe,
                    base_batch_size: Number(recipe.base_batch_size),
                },
                allowed_production_quantities: allowed,
            };

            if (isEdit) {
                await updateItem(item.id, data);
                toast.success(`${data.name} updated`);
            } else {
                await addItem(data);
                toast.success(`${data.name} added to Cooked Meat`);
            }
            onSubmit();
        } catch (err) {
            toast.error(err.message || 'Failed to save item');
        } finally {
            setLoading(false);
        }
    };

    const getTypeIcon = (type) => type === 'raw_meat' ? '🥩' : '🛒';

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal modal-xl" onClick={(e) => e.stopPropagation()}>
                <div className="modal-header">
                    <div>
                        <h2>{isEdit ? 'Edit Cooked Meat Item' : 'Add Cooked Meat Item'}</h2>
                        <p style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', marginTop: 'var(--space-1)' }}>
                            🍛 Produced in kitchen from recipes — never purchased directly
                        </p>
                    </div>
                    <button className="modal-close" onClick={onClose}><MdClose /></button>
                </div>

                <form onSubmit={handleSubmit}>
                    <div className="modal-body" style={{ maxHeight: '70vh', overflowY: 'auto' }}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
                            {/* Name */}
                            <div className="form-group">
                                <label className="form-label" htmlFor="cm-name">Item Name *</label>
                                <input
                                    ref={nameRef}
                                    id="cm-name"
                                    type="text"
                                    className={`form-input ${errors.name ? 'error' : ''}`}
                                    placeholder="e.g. Chicken Curry, Lamb Biryani"
                                    value={formData.name}
                                    onChange={(e) => handleChange('name', e.target.value)}
                                    disabled={loading}
                                />
                                {errors.name && <span className="form-error">{errors.name}</span>}
                            </div>

                            {/* Category + Unit */}
                            <div className="form-row">
                                <div className="form-group">
                                    <label className="form-label" htmlFor="cm-category">Category *</label>
                                    <select
                                        id="cm-category"
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
                                    <label className="form-label" htmlFor="cm-unit">Output Unit</label>
                                    <select
                                        id="cm-unit"
                                        className="form-select"
                                        value={formData.unit}
                                        onChange={(e) => handleChange('unit', e.target.value)}
                                        disabled={loading}
                                    >
                                        {UNITS.filter(u => ['kg', 'g', 'portions'].includes(u.value)).map(u => (
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

                            {/* VAT + Expiry */}
                            <div className="form-row">
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
                                <div className="form-group">
                                    <label className="form-label" htmlFor="cm-expiry">Default Expiry (days from production) *</label>
                                    <input
                                        id="cm-expiry"
                                        type="number"
                                        className={`form-input ${errors.default_expiry_days ? 'error' : ''}`}
                                        value={formData.default_expiry_days}
                                        onChange={(e) => handleChange('default_expiry_days', e.target.value)}
                                        disabled={loading}
                                        min="1"
                                    />
                                    {errors.default_expiry_days && <span className="form-error">{errors.default_expiry_days}</span>}
                                </div>
                            </div>

                            {/* ═══════════ RECIPE BUILDER ═══════════ */}
                            <div className="recipe-builder">
                                <div className="recipe-builder-header">
                                    <h3>📋 Recipe Definition</h3>
                                    <p>Define ingredients and quantities for this item's production batch</p>
                                </div>

                                {/* Base Batch Size */}
                                <div className="form-row" style={{ marginBottom: 'var(--space-4)' }}>
                                    <div className="form-group">
                                        <label className="form-label" htmlFor="cm-batch-size">Base Batch Size *</label>
                                        <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
                                            <input
                                                id="cm-batch-size"
                                                type="number"
                                                className={`form-input ${errors.base_batch_size ? 'error' : ''}`}
                                                value={recipe.base_batch_size}
                                                onChange={(e) => handleRecipeChange('base_batch_size', e.target.value)}
                                                disabled={loading}
                                                min="1"
                                                step="0.5"
                                                style={{ flex: 1 }}
                                            />
                                            <select
                                                className="form-select"
                                                value={recipe.base_batch_unit}
                                                onChange={(e) => handleRecipeChange('base_batch_unit', e.target.value)}
                                                disabled={loading}
                                                style={{ width: 120 }}
                                            >
                                                <option value="kg">kg</option>
                                                <option value="portions">portions</option>
                                            </select>
                                        </div>
                                        {errors.base_batch_size && <span className="form-error">{errors.base_batch_size}</span>}
                                        <span className="form-hint">
                                            Ingredient quantities below are for this batch size. System scales proportionally.
                                        </span>
                                    </div>
                                    <div className="form-group">
                                        <label className="form-label" htmlFor="cm-prod-qtys">Allowed Production Quantities</label>
                                        <input
                                            id="cm-prod-qtys"
                                            type="text"
                                            className="form-input"
                                            placeholder="e.g. 10, 20, 30"
                                            value={productionQtys}
                                            onChange={(e) => setProductionQtys(e.target.value)}
                                            disabled={loading}
                                        />
                                        <span className="form-hint">
                                            Comma-separated values. These appear in dropdown during production.
                                        </span>
                                    </div>
                                </div>

                                {/* Ingredients List */}
                                <div className="recipe-ingredients">
                                    <div className="recipe-ingredients-header">
                                        <strong>Ingredients ({recipe.ingredients.length})</strong>
                                        <button
                                            type="button"
                                            className="btn btn-secondary btn-sm"
                                            onClick={() => {
                                                setShowIngredientSearch(true);
                                                setTimeout(() => searchRef.current?.focus(), 100);
                                            }}
                                            disabled={loading}
                                        >
                                            <MdAdd /> Add Ingredient
                                        </button>
                                    </div>

                                    {errors.ingredients && (
                                        <span className="form-error" style={{ display: 'block', marginBottom: 'var(--space-2)' }}>
                                            {errors.ingredients}
                                        </span>
                                    )}

                                    {/* Ingredient Search Dropdown */}
                                    {showIngredientSearch && (
                                        <div className="ingredient-search-box">
                                            <div className="ingredient-search-input-wrap">
                                                <MdSearch />
                                                <input
                                                    ref={searchRef}
                                                    type="text"
                                                    className="form-input"
                                                    placeholder="Search grocery or raw meat items..."
                                                    value={ingredientSearch}
                                                    onChange={(e) => setIngredientSearch(e.target.value)}
                                                />
                                                <button
                                                    type="button"
                                                    className="btn btn-ghost btn-sm"
                                                    onClick={() => { setShowIngredientSearch(false); setIngredientSearch(''); }}
                                                >
                                                    <MdClose />
                                                </button>
                                            </div>
                                            <div className="ingredient-search-results">
                                                {ingredientLoading ? (
                                                    <div className="ingredient-search-empty">Loading items...</div>
                                                ) : filteredIngredients.length === 0 ? (
                                                    <div className="ingredient-search-empty">
                                                        {ingredientSearch ? 'No matching items found' : 'Type to search...'}
                                                    </div>
                                                ) : (
                                                    filteredIngredients.slice(0, 10).map(ing => (
                                                        <button
                                                            key={ing.id}
                                                            type="button"
                                                            className="ingredient-search-item"
                                                            onClick={() => addIngredient(ing)}
                                                        >
                                                            <span className="ingredient-type-badge">
                                                                {getTypeIcon(ing.item_type)}
                                                            </span>
                                                            <span className="ingredient-search-name">{ing.name}</span>
                                                            <span className="ingredient-search-meta">
                                                                {ing.unit} · {ing.current_stock} in stock
                                                            </span>
                                                        </button>
                                                    ))
                                                )}
                                            </div>
                                        </div>
                                    )}

                                    {/* Missing Ingredient Warning */}
                                    {hasMissingIngredients && (
                                        <div style={{
                                            padding: 'var(--space-3) var(--space-4)',
                                            background: 'rgba(239, 68, 68, 0.08)',
                                            border: '1px solid rgba(239, 68, 68, 0.2)',
                                            borderRadius: 'var(--radius-md)',
                                            marginBottom: 'var(--space-3)',
                                        }}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', color: '#ef4444', fontWeight: 700, marginBottom: 'var(--space-1)', fontSize: 'var(--text-sm)' }}>
                                                ⚠️ {missingIngredients.length} ingredient{missingIngredients.length > 1 ? 's' : ''} deleted from Item Master
                                            </div>
                                            <p style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', marginBottom: 'var(--space-2)' }}>
                                                The following ingredients no longer exist: <strong>{missingIngredients.map(i => i.item_name).join(', ')}</strong>.
                                                Production will fail until they are removed or replaced.
                                            </p>
                                            <button
                                                type="button"
                                                className="btn btn-secondary btn-sm"
                                                onClick={() => {
                                                    setRecipe(prev => ({
                                                        ...prev,
                                                        ingredients: prev.ingredients.filter(
                                                            ing => ingredientItems.some(item => item.id === ing.item_id)
                                                        ),
                                                    }));
                                                    toast.success('Missing ingredients removed');
                                                }}
                                                style={{ borderColor: 'var(--color-danger)', color: 'var(--color-danger)', fontSize: 'var(--text-xs)' }}
                                            >
                                                Remove Missing Ingredients
                                            </button>
                                        </div>
                                    )}

                                    {/* Ingredient Table */}
                                    {recipe.ingredients.length > 0 ? (
                                        <table className="recipe-table">
                                            <thead>
                                                <tr>
                                                    <th>Type</th>
                                                    <th>Ingredient</th>
                                                    <th>Quantity (per {recipe.base_batch_size}{recipe.base_batch_unit})</th>
                                                    <th>Unit</th>
                                                    <th></th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {recipe.ingredients.map((ing, idx) => {
                                                    const isMissing = ingredientItems.length > 0 && !ingredientLoading && !ingredientItems.some(item => item.id === ing.item_id);
                                                    return (
                                                        <tr key={ing.item_id} style={isMissing ? { background: 'rgba(239, 68, 68, 0.06)' } : {}}>
                                                            <td>
                                                                <span className="ingredient-type-badge">
                                                                    {getTypeIcon(ing.item_type)}
                                                                </span>
                                                            </td>
                                                            <td>
                                                                {ing.item_name}
                                                                {isMissing && (
                                                                    <span style={{
                                                                        marginLeft: 'var(--space-2)',
                                                                        background: 'var(--color-danger)',
                                                                        color: '#fff',
                                                                        padding: '1px 6px',
                                                                        borderRadius: 'var(--radius-full)',
                                                                        fontSize: '10px',
                                                                        fontWeight: 700,
                                                                        verticalAlign: 'middle',
                                                                    }}>DELETED</span>
                                                                )}
                                                            </td>
                                                            <td>
                                                                <input
                                                                    type="number"
                                                                    className="form-input ingredient-qty-input"
                                                                    value={ing.quantity}
                                                                    onChange={(e) => updateIngredientQty(idx, e.target.value)}
                                                                    min="0"
                                                                    step="any"
                                                                    placeholder="Qty"
                                                                />
                                                            </td>
                                                            <td>
                                                                {(() => {
                                                                    const itemData = ingredientItems.find(i => i.id === ing.item_id);
                                                                    const units = getAvailableUnits(itemData);
                                                                    if (units && units.length > 1) {
                                                                        return (
                                                                            <select
                                                                                className="form-select"
                                                                                value={ing.unit}
                                                                                onChange={(e) => updateIngredientUnit(idx, e.target.value, itemData)}
                                                                                style={{ padding: 'var(--space-2) var(--space-3)', width: 'auto' }}
                                                                            >
                                                                                {units.map(u => (
                                                                                    <option key={u.value} value={u.value}>
                                                                                        {u.label}
                                                                                    </option>
                                                                                ))}
                                                                            </select>
                                                                        );
                                                                    }
                                                                    return <span style={{ padding: 'var(--space-2)' }}>{ing.unit}</span>;
                                                                })()}
                                                            </td>
                                                            <td style={{ textAlign: 'right' }}>
                                                                <button
                                                                    type="button"
                                                                    className="btn btn-ghost btn-sm"
                                                                    onClick={() => removeIngredient(idx)}
                                                                    style={{ color: 'var(--color-danger)', fontSize: '18px' }}
                                                                    disabled={loading}
                                                                >
                                                                    <MdDelete size={18} />
                                                                </button>
                                                            </td>
                                                        </tr>
                                                    );
                                                })}
                                            </tbody>
                                        </table>
                                    ) : (
                                        <div className="recipe-empty">
                                            No ingredients added yet. Click "Add Ingredient" to search and select items.
                                        </div>
                                    )}
                                </div>
                            </div>
                            {/* ═══════════ END RECIPE BUILDER ═══════════ */}

                            {/* ═══════════ PRICING ═══════════ */}
                            <div className="form-section-header" style={{ marginTop: 'var(--space-2)', marginBottom: 'var(--space-3)' }}>
                                <h3 style={{ fontSize: 'var(--text-md)', fontWeight: 700 }}>💰 Pricing (per {formData.unit})</h3>
                                <p style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>
                                    Auto-calculated from ingredient prices. You can override manually.
                                </p>
                            </div>
                            <div className="form-row">
                                <div className="form-group">
                                    <label className="form-label" htmlFor="cm-cost">Actual Cost (£/{formData.unit})</label>
                                    <input
                                        id="cm-cost"
                                        type="number"
                                        className="form-input"
                                        value={formData.cost_price}
                                        onChange={(e) => handleChange('cost_price', e.target.value)}
                                        disabled={loading}
                                        min="0"
                                        step="0.01"
                                        placeholder="0.00"
                                    />
                                    {calculatedPrices.cost > 0 && (
                                        <span className="form-hint">
                                            Calculated from ingredients: <strong>£{calculatedPrices.cost.toFixed(2)}</strong>
                                            {Number(formData.cost_price) !== calculatedPrices.cost && (
                                                <button
                                                    type="button"
                                                    style={{ marginLeft: 'var(--space-2)', color: 'var(--color-primary)', background: 'none', border: 'none', cursor: 'pointer', fontSize: 'inherit', textDecoration: 'underline', padding: 0 }}
                                                    onClick={() => handleChange('cost_price', calculatedPrices.cost)}
                                                >Apply</button>
                                            )}
                                        </span>
                                    )}
                                </div>
                                <div className="form-group">
                                    <label className="form-label" htmlFor="cm-sell">Selling Price (£/{formData.unit})</label>
                                    <input
                                        id="cm-sell"
                                        type="number"
                                        className="form-input"
                                        value={formData.selling_price}
                                        onChange={(e) => handleChange('selling_price', e.target.value)}
                                        disabled={loading}
                                        min="0"
                                        step="0.01"
                                        placeholder="0.00"
                                    />
                                    {calculatedPrices.selling > 0 && (
                                        <span className="form-hint">
                                            Calculated from ingredients: <strong>£{calculatedPrices.selling.toFixed(2)}</strong>
                                            {Number(formData.selling_price) !== calculatedPrices.selling && (
                                                <button
                                                    type="button"
                                                    style={{ marginLeft: 'var(--space-2)', color: 'var(--color-primary)', background: 'none', border: 'none', cursor: 'pointer', fontSize: 'inherit', textDecoration: 'underline', padding: 0 }}
                                                    onClick={() => handleChange('selling_price', calculatedPrices.selling)}
                                                >Apply</button>
                                            )}
                                        </span>
                                    )}
                                </div>
                            </div>

                            {/* Low stock */}
                            <div className="form-row">
                                <div className="form-group">
                                    <label className="form-label" htmlFor="cm-threshold">Low Stock Threshold</label>
                                    <input
                                        id="cm-threshold"
                                        type="number"
                                        className="form-input"
                                        value={formData.low_stock_threshold}
                                        onChange={(e) => handleChange('low_stock_threshold', e.target.value)}
                                        disabled={loading}
                                        min="0"
                                    />
                                </div>
                            </div>

                            {/* Info banner */}
                            <div style={{
                                display: 'flex',
                                gap: 'var(--space-2)',
                                padding: 'var(--space-3)',
                                background: 'rgba(245, 158, 11, 0.08)',
                                borderRadius: 'var(--radius-md)',
                                border: '1px solid rgba(245, 158, 11, 0.15)',
                            }}>
                                <span style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)' }}>
                                    ℹ️ Cooked meat items are <strong>never purchased</strong>. They are produced in the central kitchen.
                                    During production, ingredient quantities are <strong>scaled proportionally</strong> from the base recipe
                                    and deducted from inventory automatically.
                                </span>
                            </div>

                            {/* Notes */}
                            <div className="form-group">
                                <label className="form-label" htmlFor="cm-notes">Notes</label>
                                <textarea
                                    id="cm-notes"
                                    className="form-textarea"
                                    placeholder="Cooking instructions, special handling, etc."
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

export default CookedMeatItemForm;
