import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { getRestaurantInventory } from '../../services/restaurantInventoryService';
import {
    MENU_CATEGORIES,
    ALLERGEN_CODES,
    MODEL_TYPES,
    createMenuItem,
    updateMenuItem,
    getMenuItems,
    getAvailableUnits,
    getConversionToMaster,
    calcIngredientCost,
    calcPortionCost,
} from '../../services/menuService';
import {
    MdClose,
    MdArrowBack,
    MdArrowForward,
    MdAdd,
    MdDelete,
    MdSearch,
    MdSave,
    MdRestaurantMenu,
} from 'react-icons/md';
import toast from 'react-hot-toast';
import './Menu.css';

/**
 * MenuItemForm — Modal for creating / editing a menu item.
 */
const MenuItemForm = ({ isOpen, onClose, onSaved, editItem, restaurantId }) => {
    const { currentUser } = useAuth();

    const [step, setStep] = useState(1);

    // Step 1 fields
    const [name, setName] = useState('');
    const [category, setCategory] = useState('');
    const [description, setDescription] = useState('');
    const [allergens, setAllergens] = useState([]);
    const [modelType, setModelType] = useState('');

    // Step 2 fields
    const [portions, setPortions] = useState([
        { id: tempId(), name: 'Regular', selling_price: '', cost_price: 0, recipe: [], sub_items: [] },
    ]);

    // Inventory + Menu items for pickers
    const [inventoryItems, setInventoryItems] = useState([]);
    const [existingMenuItems, setExistingMenuItems] = useState([]);
    const [loadingInventory, setLoadingInventory] = useState(false);

    // Ingredient picker
    const [activePickerPortionId, setActivePickerPortionId] = useState(null);
    const [pickerSearch, setPickerSearch] = useState('');
    const [pickerTab, setPickerTab] = useState('inventory'); // 'inventory' or 'menu'
    const pickerRef = useRef(null);

    const [saving, setSaving] = useState(false);

    // ── Map item_id → inventory item for unit lookups ──
    const inventoryMap = {};
    inventoryItems.forEach(item => {
        inventoryMap[item.item_id || item.id] = item;
    });

    // Populate form when editing
    useEffect(() => {
        if (editItem) {
            setName(editItem.name || '');
            setCategory(editItem.category || '');
            setDescription(editItem.description || '');
            setAllergens(editItem.allergens || []);
            setModelType(editItem.model_type || '');
            setPortions(
                editItem.portions?.length
                    ? editItem.portions.map(p => ({
                        id: p.id || tempId(),
                        name: p.name || '',
                        selling_price: p.selling_price ?? p.price ?? '',
                        cost_price: p.cost_price || 0,
                        recipe: p.recipe || [],
                        sub_items: p.sub_items || [],
                    }))
                    : [{ id: tempId(), name: 'Regular', selling_price: '', cost_price: 0, recipe: [], sub_items: [] }]
            );
            setStep(1);
        } else {
            resetForm();
        }
    }, [editItem, isOpen]);

    // Load inventory + existing menu items
    useEffect(() => {
        if (!restaurantId || !isOpen) return;
        const load = async () => {
            setLoadingInventory(true);
            try {
                const [inv, menus] = await Promise.all([
                    getRestaurantInventory(restaurantId),
                    getMenuItems(restaurantId),
                ]);
                setInventoryItems(inv);
                // Exclude current item from composable list
                setExistingMenuItems(menus.filter(m => m.id !== editItem?.id));
            } catch {
                toast.error('Failed to load inventory');
            } finally {
                setLoadingInventory(false);
            }
        };
        load();
    }, [restaurantId, isOpen, editItem?.id]);

    // Close picker on outside click
    useEffect(() => {
        const handler = (e) => {
            if (pickerRef.current && !pickerRef.current.contains(e.target)) {
                setActivePickerPortionId(null);
                setPickerSearch('');
            }
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, []);

    const resetForm = () => {
        setName('');
        setCategory('');
        setDescription('');
        setAllergens([]);
        setModelType('');
        setPortions([{ id: tempId(), name: 'Regular', selling_price: '', cost_price: 0, recipe: [], sub_items: [] }]);
        setStep(1);
    };

    // ── Allergen ──
    const toggleAllergen = (code) => {
        setAllergens(prev =>
            prev.includes(code) ? prev.filter(c => c !== code) : [...prev, code]
        );
    };

    // ── Portion CRUD ──
    const addPortion = () => {
        setPortions(prev => [...prev, { id: tempId(), name: '', selling_price: '', cost_price: 0, recipe: [], sub_items: [] }]);
    };
    const removePortion = (portionId) => {
        if (portions.length <= 1) { toast.error('At least one portion required'); return; }
        setPortions(prev => prev.filter(p => p.id !== portionId));
    };
    const updatePortion = (portionId, field, value) => {
        setPortions(prev => prev.map(p => p.id === portionId ? { ...p, [field]: value } : p));
    };

    // ── Ingredient CRUD ──
    const addIngredient = (portionId, inventoryItem) => {
        const itemId = inventoryItem.item_id || inventoryItem.id;
        const masterUnit = inventoryItem.unit || 'unit';
        const costPrice = Number(inventoryItem.cost_price) || 0;

        setPortions(prev => prev.map(p => {
            if (p.id !== portionId) return p;
            if (p.recipe.some(r => r.item_id === itemId)) return p;
            const updated = {
                ...p,
                recipe: [...p.recipe, {
                    item_id: itemId,
                    item_name: inventoryItem.item_name,
                    item_type: inventoryItem.item_type || '',
                    unit: masterUnit,
                    master_unit: masterUnit,
                    quantity: '',
                    conversion_to_master: 1,
                    cost_price: costPrice,
                    line_cost: 0,
                }],
            };
            return recalcPortionCost(updated);
        }));
        setActivePickerPortionId(null);
        setPickerSearch('');
    };

    const removeIngredient = (portionId, itemId) => {
        setPortions(prev => prev.map(p => {
            if (p.id !== portionId) return p;
            const updated = { ...p, recipe: p.recipe.filter(r => r.item_id !== itemId) };
            return recalcPortionCost(updated);
        }));
    };

    const updateIngredientField = (portionId, itemId, field, value) => {
        setPortions(prev => prev.map(p => {
            if (p.id !== portionId) return p;
            const recipe = p.recipe.map(r => {
                if (r.item_id !== itemId) return r;
                const updated = { ...r, [field]: value };

                // If unit changed, recalc conversion_to_master
                if (field === 'unit') {
                    const invItem = inventoryMap[itemId];
                    updated.conversion_to_master = getConversionToMaster(value, invItem);
                }
                // Recalc line_cost
                updated.line_cost = calcIngredientCost(updated);
                return updated;
            });
            const updated = { ...p, recipe };
            return recalcPortionCost(updated);
        }));
    };

    // ── Sub-menu-item CRUD (for platters) ──
    const addSubItem = (portionId, menuItem) => {
        setPortions(prev => prev.map(p => {
            if (p.id !== portionId) return p;
            if (p.sub_items.some(s => s.menu_item_id === menuItem.id)) return p;
            // Default to first portion
            const defaultPortion = menuItem.portions?.[0];
            const updated = {
                ...p,
                sub_items: [...p.sub_items, {
                    menu_item_id: menuItem.id,
                    menu_item_name: menuItem.name,
                    portion_id: defaultPortion?.id || '',
                    portion_name: defaultPortion?.name || 'Regular',
                    quantity: 1,
                    cost: defaultPortion?.cost_price || 0,
                }],
            };
            return recalcPortionCost(updated);
        }));
        setActivePickerPortionId(null);
        setPickerSearch('');
    };

    const removeSubItem = (portionId, menuItemId) => {
        setPortions(prev => prev.map(p => {
            if (p.id !== portionId) return p;
            const updated = { ...p, sub_items: p.sub_items.filter(s => s.menu_item_id !== menuItemId) };
            return recalcPortionCost(updated);
        }));
    };

    const updateSubItemField = (portionId, menuItemId, field, value) => {
        setPortions(prev => prev.map(p => {
            if (p.id !== portionId) return p;
            const sub_items = p.sub_items.map(s => {
                if (s.menu_item_id !== menuItemId) return s;
                const updated = { ...s, [field]: value };

                // If portion changed, update cost
                if (field === 'portion_id') {
                    const mi = existingMenuItems.find(m => m.id === menuItemId);
                    const portion = mi?.portions?.find(pp => pp.id === value);
                    if (portion) {
                        updated.portion_name = portion.name;
                        updated.cost = portion.cost_price || 0;
                    }
                }
                if (field === 'quantity') {
                    // cost stays per-unit, total is calculated at display
                }
                return updated;
            });
            const updated = { ...p, sub_items };
            return recalcPortionCost(updated);
        }));
    };

    // ── Cost recalculation ──
    const recalcPortionCost = (portion) => {
        const cost = calcPortionCost(portion);
        return { ...portion, cost_price: cost };
    };

    // ── Filtered items for picker ──
    const filteredPickerItems = (pickerTab === 'inventory' ? inventoryItems : existingMenuItems)
        .filter(item => {
            if (!pickerSearch.trim()) return true;
            const q = pickerSearch.toLowerCase();
            const nameField = pickerTab === 'inventory' ? item.item_name : item.name;
            return nameField?.toLowerCase().includes(q);
        });

    // ── Validation ──
    const validateStep1 = () => {
        if (!name.trim()) { toast.error('Item name is required'); return false; }
        if (!category) { toast.error('Category is required'); return false; }
        return true;
    };
    const validateStep2 = () => {
        for (const p of portions) {
            if (!p.name.trim()) { toast.error('Each portion needs a name'); return false; }
            if (p.selling_price === '' || Number(p.selling_price) < 0) { toast.error(`Set a valid price for "${p.name}"`); return false; }
        }
        return true;
    };

    // ── Save ──
    const handleSave = async () => {
        if (!validateStep1() || !validateStep2()) return;
        setSaving(true);
        try {
            const data = {
                restaurant_id: restaurantId,
                name: name.trim(),
                category,
                description: description.trim(),
                allergens,
                model_type: modelType,
                portions: portions.map(p => ({
                    ...p,
                    selling_price: Number(p.selling_price) || 0,
                    cost_price: Number(p.cost_price) || 0,
                    recipe: p.recipe.map(r => ({
                        ...r,
                        quantity: Number(r.quantity) || 0,
                        conversion_to_master: Number(r.conversion_to_master) || 1,
                        line_cost: calcIngredientCost(r),
                    })),
                    sub_items: (p.sub_items || []).map(s => ({
                        ...s,
                        quantity: Number(s.quantity) || 1,
                        cost: Number(s.cost) || 0,
                    })),
                })),
                created_by: currentUser?.uid || '',
            };

            if (editItem) {
                await updateMenuItem(editItem.id, data);
                toast.success(`"${name}" updated`);
            } else {
                await createMenuItem(data);
                toast.success(`"${name}" created`);
            }
            onSaved?.();
            onClose();
        } catch (err) {
            toast.error(err.message || 'Failed to save');
        } finally {
            setSaving(false);
        }
    };

    const getTypeIcon = (type) => {
        if (type === 'raw_meat') return '🥩';
        if (type === 'menu_item' || type === 'cooked_meat') return '🍛';
        return '🛒';
    };

    if (!isOpen) return null;

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal modal-lg" onClick={e => e.stopPropagation()} style={{ maxWidth: 780 }}>
                <div className="modal-header">
                    <h2>{editItem ? 'Edit Menu Item' : 'Add Menu Item'}</h2>
                    <button className="modal-close" onClick={onClose}><MdClose /></button>
                </div>

                {/* Steps */}
                <div style={{ padding: '0 var(--space-5)' }}>
                    <div className="menu-form-steps">
                        <div className={`menu-form-step ${step === 1 ? 'active' : step > 1 ? 'completed' : ''}`}>
                            <span className="menu-form-step-num">{step > 1 ? '✓' : '1'}</span>
                            Item Details
                        </div>
                        <div className={`menu-form-step ${step === 2 ? 'active' : ''}`}>
                            <span className="menu-form-step-num">2</span>
                            Portions & Recipes
                        </div>
                    </div>
                </div>

                <div className="modal-body" style={{ maxHeight: 520, overflowY: 'auto' }}>
                    {/* ═══ Step 1 ═══ */}
                    {step === 1 && (
                        <>
                            <div className="form-group" style={{ marginBottom: 'var(--space-4)' }}>
                                <label className="form-label">Item Name *</label>
                                <input className="form-input" value={name} onChange={e => setName(e.target.value)}
                                    placeholder="e.g., Chicken Biryani" autoFocus />
                            </div>
                            <div className="menu-form-2col">
                                <div className="form-group">
                                    <label className="form-label">Category *</label>
                                    <select className="form-input" value={category} onChange={e => setCategory(e.target.value)}>
                                        <option value="">Select category</option>
                                        {MENU_CATEGORIES.map(c => (
                                            <option key={c.value} value={c.value}>{c.icon} {c.label}</option>
                                        ))}
                                    </select>
                                </div>
                                <div className="form-group">
                                    <label className="form-label">Model Type</label>
                                    <select className="form-input" value={modelType} onChange={e => setModelType(e.target.value)}>
                                        <option value="">Optional</option>
                                        {MODEL_TYPES.map(m => (
                                            <option key={m.value} value={m.value}>{m.label}</option>
                                        ))}
                                    </select>
                                </div>
                            </div>
                            <div className="form-group" style={{ marginBottom: 'var(--space-4)' }}>
                                <label className="form-label">Description</label>
                                <textarea className="form-input" rows={3} value={description} onChange={e => setDescription(e.target.value)}
                                    placeholder="A brief description of the dish..." style={{ resize: 'vertical' }} />
                            </div>
                            <div className="form-group">
                                <label className="form-label">Allergens</label>
                                <div className="allergen-grid">
                                    {ALLERGEN_CODES.map(a => (
                                        <div key={a.code}
                                            className={`allergen-check ${allergens.includes(a.code) ? 'selected' : ''}`}
                                            onClick={() => toggleAllergen(a.code)}>
                                            <span>{a.icon}</span><span>{a.label}</span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </>
                    )}

                    {/* ═══ Step 2 ═══ */}
                    {step === 2 && (
                        <>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-4)' }}>
                                <h4 style={{ margin: 0, fontWeight: 700, fontSize: 'var(--text-md)' }}>
                                    Portions ({portions.length})
                                </h4>
                                <button className="btn btn-secondary btn-sm" onClick={addPortion}><MdAdd /> Add Portion</button>
                            </div>

                            {portions.map((portion, pIdx) => (
                                <div key={portion.id} className="portion-block">
                                    <div className="portion-block-header">
                                        <span className="portion-block-title">
                                            <span style={{ width: 22, height: 22, borderRadius: '50%', background: 'var(--color-primary)', color: '#fff',
                                                display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700 }}>
                                                {pIdx + 1}
                                            </span>
                                            Portion {pIdx + 1}
                                        </span>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                                            {/* Cost summary */}
                                            <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', background: 'var(--color-surface)',
                                                padding: '2px 8px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-border)' }}>
                                                Cost: <strong style={{ color: 'var(--color-danger)' }}>£{(Number(portion.cost_price) || 0).toFixed(2)}</strong>
                                                {portion.selling_price && Number(portion.selling_price) > 0 && (
                                                    <> · Margin: <strong style={{ color: Number(portion.selling_price) - (portion.cost_price || 0) > 0 ? 'var(--color-success)' : 'var(--color-danger)' }}>
                                                        £{(Number(portion.selling_price) - (Number(portion.cost_price) || 0)).toFixed(2)}
                                                    </strong></>
                                                )}
                                            </span>
                                            {portions.length > 1 && (
                                                <button className="btn btn-ghost btn-sm" onClick={() => removePortion(portion.id)}
                                                    style={{ color: 'var(--color-danger)' }}><MdDelete /></button>
                                            )}
                                        </div>
                                    </div>

                                    {/* Name + Price */}
                                    <div className="portion-fields-grid">
                                        <div className="form-group">
                                            <label className="form-label" style={{ fontSize: 'var(--text-xs)' }}>Portion Name *</label>
                                            <input className="form-input" value={portion.name}
                                                onChange={e => updatePortion(portion.id, 'name', e.target.value)}
                                                placeholder="e.g., Regular, Half, Full" />
                                        </div>
                                        <div className="form-group">
                                            <label className="form-label" style={{ fontSize: 'var(--text-xs)' }}>Selling Price (£) *</label>
                                            <input className="form-input" type="number" min="0" step="0.01" value={portion.selling_price}
                                                onChange={e => updatePortion(portion.id, 'selling_price', e.target.value)}
                                                placeholder="0.00" />
                                        </div>
                                        <div className="form-group">
                                            <label className="form-label" style={{ fontSize: 'var(--text-xs)' }}>Cost (Auto)</label>
                                            <input className="form-input" type="text" readOnly value={`£${(Number(portion.cost_price) || 0).toFixed(2)}`}
                                                style={{ background: 'var(--color-bg)', color: 'var(--color-text-muted)', cursor: 'default' }} />
                                        </div>
                                    </div>

                                    {/* Recipe Ingredients */}
                                    <div style={{ marginBottom: 'var(--space-2)' }}>
                                        <label className="form-label" style={{ fontSize: 'var(--text-xs)' }}>
                                            Inventory Ingredients ({portion.recipe.length})
                                        </label>

                                        {portion.recipe.length > 0 && (
                                            <div style={{ marginBottom: 'var(--space-2)' }}>
                                                <div className="recipe-row" style={{ fontWeight: 600, fontSize: 10, color: 'var(--color-text-muted)', textTransform: 'uppercase', borderBottom: '2px solid var(--color-border)' }}>
                                                    <span>Ingredient</span>
                                                    <span>Qty</span>
                                                    <span>Unit</span>
                                                    <span>Cost</span>
                                                </div>
                                                {portion.recipe.map(ing => {
                                                    const invItem = inventoryMap[ing.item_id];
                                                    const unitOptions = getAvailableUnits(invItem);
                                                    const lineCost = calcIngredientCost(ing);
                                                    return (
                                                        <div key={ing.item_id} className="recipe-row" style={{ gridTemplateColumns: '1fr 80px 90px 70px 32px' }}>
                                                            <div>
                                                                <div className="recipe-item-name">{getTypeIcon(ing.item_type)} {ing.item_name}</div>
                                                                <div className="recipe-item-type">{ing.item_type} · {ing.master_unit}</div>
                                                            </div>
                                                            <input className="form-input" type="number" min="0" step="0.01"
                                                                value={ing.quantity}
                                                                onChange={e => updateIngredientField(portion.id, ing.item_id, 'quantity', e.target.value)}
                                                                placeholder="0"
                                                                style={{ padding: '4px 6px', fontSize: 'var(--text-sm)' }} />
                                                            <select className="form-input" value={ing.unit}
                                                                onChange={e => updateIngredientField(portion.id, ing.item_id, 'unit', e.target.value)}
                                                                style={{ padding: '4px 6px', fontSize: 'var(--text-sm)' }}>
                                                                {unitOptions.map(u => (
                                                                    <option key={u.value} value={u.value}>{u.label}</option>
                                                                ))}
                                                            </select>
                                                            <span style={{ fontSize: 'var(--text-xs)', fontWeight: 700, color: lineCost > 0 ? 'var(--color-text-primary)' : 'var(--color-text-muted)', alignSelf: 'center' }}>
                                                                £{lineCost.toFixed(2)}
                                                            </span>
                                                            <button className="btn btn-ghost btn-sm" onClick={() => removeIngredient(portion.id, ing.item_id)}
                                                                style={{ color: 'var(--color-danger)', padding: 2, minWidth: 'auto' }}>
                                                                <MdClose />
                                                            </button>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        )}

                                        {/* Sub-menu items (for platters) */}
                                        {portion.sub_items?.length > 0 && (
                                            <div style={{ marginBottom: 'var(--space-2)' }}>
                                                <label className="form-label" style={{ fontSize: 'var(--text-xs)', marginTop: 'var(--space-2)' }}>
                                                    <MdRestaurantMenu style={{ fontSize: 13, verticalAlign: 'middle' }} /> Sub Menu Items ({portion.sub_items.length})
                                                </label>
                                                {portion.sub_items.map(sub => {
                                                    const mi = existingMenuItems.find(m => m.id === sub.menu_item_id);
                                                    const subTotal = (Number(sub.cost) || 0) * (Number(sub.quantity) || 1);
                                                    return (
                                                        <div key={sub.menu_item_id} className="recipe-row" style={{ gridTemplateColumns: '1fr 60px 100px 70px 32px' }}>
                                                            <div>
                                                                <div className="recipe-item-name">🍽️ {sub.menu_item_name}</div>
                                                            </div>
                                                            <input className="form-input" type="number" min="1" step="1"
                                                                value={sub.quantity}
                                                                onChange={e => updateSubItemField(portion.id, sub.menu_item_id, 'quantity', e.target.value)}
                                                                style={{ padding: '4px 6px', fontSize: 'var(--text-sm)' }} />
                                                            <select className="form-input" value={sub.portion_id}
                                                                onChange={e => updateSubItemField(portion.id, sub.menu_item_id, 'portion_id', e.target.value)}
                                                                style={{ padding: '4px 6px', fontSize: 'var(--text-sm)' }}>
                                                                {(mi?.portions || []).map(pp => (
                                                                    <option key={pp.id} value={pp.id}>{pp.name} (£{(pp.cost_price || 0).toFixed(2)})</option>
                                                                ))}
                                                                {(!mi?.portions?.length) && <option value="">—</option>}
                                                            </select>
                                                            <span style={{ fontSize: 'var(--text-xs)', fontWeight: 700, color: 'var(--color-text-primary)', alignSelf: 'center' }}>
                                                                £{subTotal.toFixed(2)}
                                                            </span>
                                                            <button className="btn btn-ghost btn-sm" onClick={() => removeSubItem(portion.id, sub.menu_item_id)}
                                                                style={{ color: 'var(--color-danger)', padding: 2, minWidth: 'auto' }}>
                                                                <MdClose />
                                                            </button>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        )}

                                        {/* Ingredient / Sub-item Picker */}
                                        <div className="ingredient-picker" ref={activePickerPortionId === portion.id ? pickerRef : null}>
                                            {/* Picker tabs (Inventory vs Menu Items) */}
                                            {activePickerPortionId === portion.id && (
                                                <div style={{ display: 'flex', gap: 0, marginBottom: 4 }}>
                                                    <button
                                                        style={{
                                                            flex: 1, padding: '4px 8px', fontSize: 'var(--text-xs)', fontWeight: 600,
                                                            border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md) 0 0 var(--radius-md)',
                                                            background: pickerTab === 'inventory' ? 'var(--color-primary)' : 'var(--color-surface)',
                                                            color: pickerTab === 'inventory' ? '#fff' : 'var(--color-text-secondary)',
                                                            cursor: 'pointer',
                                                        }}
                                                        onClick={() => setPickerTab('inventory')}>
                                                        🛒 Inventory Items
                                                    </button>
                                                    <button
                                                        style={{
                                                            flex: 1, padding: '4px 8px', fontSize: 'var(--text-xs)', fontWeight: 600,
                                                            border: '1px solid var(--color-border)', borderRadius: '0 var(--radius-md) var(--radius-md) 0',
                                                            background: pickerTab === 'menu' ? 'var(--color-primary)' : 'var(--color-surface)',
                                                            color: pickerTab === 'menu' ? '#fff' : 'var(--color-text-secondary)',
                                                            cursor: 'pointer',
                                                        }}
                                                        onClick={() => setPickerTab('menu')}>
                                                        🍽️ Menu Items (Sub)
                                                    </button>
                                                </div>
                                            )}

                                            <div style={{ position: 'relative' }}>
                                                <MdSearch style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)',
                                                    color: 'var(--color-text-muted)', fontSize: 16 }} />
                                                <input className="form-input"
                                                    placeholder={activePickerPortionId === portion.id
                                                        ? (pickerTab === 'inventory' ? 'Search inventory ingredients...' : 'Search menu items to compose...')
                                                        : 'Search and add ingredient or sub-item...'}
                                                    style={{ paddingLeft: 32, fontSize: 'var(--text-sm)' }}
                                                    value={activePickerPortionId === portion.id ? pickerSearch : ''}
                                                    onFocus={() => { setActivePickerPortionId(portion.id); setPickerTab('inventory'); }}
                                                    onChange={e => { setPickerSearch(e.target.value); setActivePickerPortionId(portion.id); }} />
                                            </div>

                                            {activePickerPortionId === portion.id && (
                                                <div className="ingredient-picker-dropdown">
                                                    {loadingInventory ? (
                                                        <div style={{ padding: 'var(--space-3)', textAlign: 'center', color: 'var(--color-text-muted)', fontSize: 'var(--text-sm)' }}>Loading...</div>
                                                    ) : filteredPickerItems.length === 0 ? (
                                                        <div style={{ padding: 'var(--space-3)', textAlign: 'center', color: 'var(--color-text-muted)', fontSize: 'var(--text-sm)' }}>No items found</div>
                                                    ) : (
                                                        filteredPickerItems.slice(0, 15).map(item => {
                                                            if (pickerTab === 'inventory') {
                                                                const itemId = item.item_id || item.id;
                                                                const alreadyAdded = portion.recipe.some(r => r.item_id === itemId);
                                                                return (
                                                                    <div key={item.id} className="ingredient-picker-item"
                                                                        style={{ opacity: alreadyAdded ? 0.4 : 1, pointerEvents: alreadyAdded ? 'none' : 'auto' }}
                                                                        onClick={() => addIngredient(portion.id, item)}>
                                                                        <div>
                                                                            <span style={{ fontWeight: 600 }}>{getTypeIcon(item.item_type)} {item.item_name}</span>
                                                                            <div className="ing-meta">
                                                                                {item.category_name} · {item.unit} · Stock: {(item.current_stock || 0).toFixed(2)} · £{(item.cost_price || 0).toFixed(2)}/{item.unit}
                                                                            </div>
                                                                        </div>
                                                                        {alreadyAdded ? <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>Added</span> : <MdAdd style={{ color: 'var(--color-primary)' }} />}
                                                                    </div>
                                                                );
                                                            } else {
                                                                // Menu item
                                                                const alreadyAdded = portion.sub_items.some(s => s.menu_item_id === item.id);
                                                                const priceRange = item.portions?.length
                                                                    ? `£${Math.min(...item.portions.map(p => p.selling_price || p.price || 0)).toFixed(2)}`
                                                                    : '—';
                                                                return (
                                                                    <div key={item.id} className="ingredient-picker-item"
                                                                        style={{ opacity: alreadyAdded ? 0.4 : 1, pointerEvents: alreadyAdded ? 'none' : 'auto' }}
                                                                        onClick={() => addSubItem(portion.id, item)}>
                                                                        <div>
                                                                            <span style={{ fontWeight: 600 }}>🍽️ {item.name}</span>
                                                                            <div className="ing-meta">
                                                                                {item.portions?.length || 0} portions · from {priceRange}
                                                                            </div>
                                                                        </div>
                                                                        {alreadyAdded ? <span style={{ fontSize: 'var(--text-xs)' }}>Added</span> : <MdAdd style={{ color: 'var(--color-primary)' }} />}
                                                                    </div>
                                                                );
                                                            }
                                                        })
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </>
                    )}
                </div>

                <div className="modal-footer" style={{ display: 'flex', justifyContent: 'space-between' }}>
                    {step === 1 ? (
                        <>
                            <button className="btn btn-secondary btn-md" onClick={onClose}>Cancel</button>
                            <button className="btn btn-primary btn-md" onClick={() => { if (validateStep1()) setStep(2); }}>
                                Next: Portions & Recipes <MdArrowForward />
                            </button>
                        </>
                    ) : (
                        <>
                            <button className="btn btn-secondary btn-md" onClick={() => setStep(1)}><MdArrowBack /> Back</button>
                            <button className="btn btn-primary btn-md" onClick={handleSave} disabled={saving}
                                style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                {saving ? 'Saving...' : <><MdSave /> {editItem ? 'Update' : 'Create'} Menu Item</>}
                            </button>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
};

function tempId() {
    return 'p_' + Date.now().toString(36) + '_' + Math.random().toString(36).substr(2, 6);
}

export default MenuItemForm;
