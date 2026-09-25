import React, { useState, useRef, useEffect, useCallback } from 'react';
import { MdSearch, MdAdd, MdClose } from 'react-icons/md';
import './SmartItemSearch.css';

/**
 * SmartItemSearch — type-ahead autocomplete for inventory items.
 *
 * Props:
 *   items          — array of items to search (must have { id, name/item_name, unit, ... })
 *   onSelect       — (item) => void — called when an existing item is chosen
 *   onAddNew       — (newItem) => void — called when user creates a custom item
 *   placeholder    — input placeholder
 *   excludeIds     — array of IDs to exclude from results (already added)
 *   nameKey        — 'name' | 'item_name' — which field holds the display name
 *   showStock      — boolean — show current_stock in results
 *   showCostPrice  — boolean — show cost_price in results
 *   allowNew       — boolean — show "Add new" option when no match
 */
const SmartItemSearch = ({
    items = [],
    onSelect,
    onAddNew,
    placeholder = 'Search items...',
    excludeIds = [],
    nameKey = 'name',
    showStock = false,
    showCostPrice = true,
    allowNew = true,
}) => {
    const [query, setQuery] = useState('');
    const [open, setOpen] = useState(false);
    const [activeIdx, setActiveIdx] = useState(-1);
    const [showNewForm, setShowNewForm] = useState(false);
    const [newItem, setNewItem] = useState({ name: '', unit: 'kg', cost_price: 0, quantity: 1 });
    const wrapRef = useRef(null);
    const inputRef = useRef(null);
    const listRef = useRef(null);

    // Filter items by query
    const filtered = items.filter(item => {
        if (excludeIds.includes(item.id)) return false;
        if (!query.trim()) return true;
        const q = query.toLowerCase();
        const name = (item[nameKey] || '').toLowerCase();
        const cat = (item.category_name || '').toLowerCase();
        const sku = (item.sku || '').toLowerCase();
        return name.includes(q) || cat.includes(q) || sku.includes(q);
    });

    const hasExactMatch = filtered.some(
        i => (i[nameKey] || '').toLowerCase() === query.trim().toLowerCase()
    );

    // Click outside to close
    useEffect(() => {
        const handler = (e) => {
            if (wrapRef.current && !wrapRef.current.contains(e.target)) {
                setOpen(false);
                setShowNewForm(false);
            }
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, []);

    // Scroll active item into view
    useEffect(() => {
        if (listRef.current && activeIdx >= 0) {
            const el = listRef.current.children[activeIdx];
            if (el) el.scrollIntoView({ block: 'nearest' });
        }
    }, [activeIdx]);

    const handleSelect = useCallback((item) => {
        onSelect(item);
        setQuery('');
        setOpen(false);
        setActiveIdx(-1);
    }, [onSelect]);

    const handleAddNew = () => {
        if (!newItem.name.trim()) return;
        onAddNew({
            id: `custom_${Date.now()}`,
            [nameKey]: newItem.name.trim(),
            name: newItem.name.trim(),
            item_name: newItem.name.trim(),
            unit: newItem.unit,
            cost_price: Number(newItem.cost_price) || 0,
            quantity: Number(newItem.quantity) || 1,
            item_type: 'grocery',
            category_name: 'Custom',
            is_custom: true,
        });
        setNewItem({ name: '', unit: 'kg', cost_price: 0, quantity: 1 });
        setShowNewForm(false);
        setQuery('');
        setOpen(false);
    };

    const handleKeyDown = (e) => {
        if (!open) return;
        const totalItems = filtered.length + (allowNew && query.trim() && !hasExactMatch ? 1 : 0);
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            setActiveIdx(prev => (prev + 1) % totalItems);
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActiveIdx(prev => (prev - 1 + totalItems) % totalItems);
        } else if (e.key === 'Enter') {
            e.preventDefault();
            if (activeIdx >= 0 && activeIdx < filtered.length) {
                handleSelect(filtered[activeIdx]);
            } else if (activeIdx === filtered.length && allowNew) {
                setShowNewForm(true);
                setNewItem(prev => ({ ...prev, name: query.trim() }));
            }
        } else if (e.key === 'Escape') {
            setOpen(false);
            setShowNewForm(false);
        }
    };

    // Highlight matching text
    const highlight = (text) => {
        if (!query.trim()) return text;
        const idx = text.toLowerCase().indexOf(query.toLowerCase());
        if (idx === -1) return text;
        return (
            <>
                {text.slice(0, idx)}
                <strong className="sis-highlight">{text.slice(idx, idx + query.length)}</strong>
                {text.slice(idx + query.length)}
            </>
        );
    };

    return (
        <div className="sis-wrapper" ref={wrapRef}>
            <div className="sis-input-wrap">
                <MdSearch className="sis-input-icon" />
                <input
                    ref={inputRef}
                    className="sis-input"
                    type="text"
                    value={query}
                    onChange={e => { setQuery(e.target.value); setOpen(true); setActiveIdx(-1); }}
                    onFocus={() => setOpen(true)}
                    onKeyDown={handleKeyDown}
                    placeholder={placeholder}
                    autoComplete="off"
                />
                {query && (
                    <button
                        className="sis-clear"
                        onClick={() => { setQuery(''); setOpen(false); inputRef.current?.focus(); }}
                        type="button"
                    >
                        <MdClose />
                    </button>
                )}
            </div>

            {open && !showNewForm && (
                <div className="sis-dropdown" ref={listRef}>
                    {filtered.length === 0 && !allowNew && (
                        <div className="sis-no-results">No items found</div>
                    )}
                    {filtered.length === 0 && allowNew && !query.trim() && (
                        <div className="sis-no-results">Start typing to search...</div>
                    )}
                    {filtered.map((item, idx) => (
                        <div
                            key={item.id}
                            className={`sis-option ${idx === activeIdx ? 'sis-option--active' : ''}`}
                            onClick={() => handleSelect(item)}
                            onMouseEnter={() => setActiveIdx(idx)}
                        >
                            <div className="sis-option-info">
                                <span className="sis-option-name">{highlight(item[nameKey] || '')}</span>
                                <span className="sis-option-meta">
                                    {item.category_name && <span className="sis-tag">{item.category_name}</span>}
                                    {item.unit && <span className="sis-unit">{item.unit}</span>}
                                </span>
                            </div>
                            <div className="sis-option-right">
                                {showCostPrice && item.cost_price > 0 && (
                                    <span className="sis-price">£{Number(item.cost_price).toFixed(2)}</span>
                                )}
                                {showStock && (
                                    <span className={`sis-stock ${(item.current_stock || 0) <= 0 ? 'sis-stock--out' : ''}`}>
                                        {Number(item.current_stock || 0).toFixed(2)} {item.unit}
                                    </span>
                                )}
                            </div>
                        </div>
                    ))}
                    {allowNew && query.trim() && !hasExactMatch && (
                        <div
                            className={`sis-option sis-option--new ${filtered.length === activeIdx ? 'sis-option--active' : ''}`}
                            onClick={() => { setShowNewForm(true); setNewItem(prev => ({ ...prev, name: query.trim() })); }}
                            onMouseEnter={() => setActiveIdx(filtered.length)}
                        >
                            <MdAdd className="sis-add-icon" />
                            <span>Add "<strong>{query.trim()}</strong>" as new item</span>
                        </div>
                    )}
                </div>
            )}

            {showNewForm && (
                <div className="sis-modal-overlay" onClick={() => setShowNewForm(false)}>
                    <div className="sis-modal-card" onClick={e => e.stopPropagation()}>
                        <div className="sis-new-form-header">
                            <span style={{ fontSize: '15px', fontWeight: 700, color: 'var(--color-primary)' }}>✨ Add New Item</span>
                            <button type="button" className="sis-clear" onClick={() => setShowNewForm(false)}><MdClose size={18} /></button>
                        </div>
                        <div className="sis-new-form-body">
                            <div className="sis-new-field">
                                <label>Item Name</label>
                                <input
                                    type="text"
                                    value={newItem.name}
                                    onChange={e => setNewItem({ ...newItem, name: e.target.value })}
                                    placeholder="e.g. Emergency Salt"
                                    autoFocus
                                />
                            </div>
                            <div className="sis-new-row">
                                <div className="sis-new-field">
                                    <label>Unit of Measure</label>
                                    <select value={newItem.unit} onChange={e => setNewItem({ ...newItem, unit: e.target.value })}>
                                        <option value="kg">kg (Kilogram)</option>
                                        <option value="g">g (Gram)</option>
                                        <option value="l">Litre (L)</option>
                                        <option value="ml">ml (Millilitre)</option>
                                        <option value="pcs">Pieces (pcs)</option>
                                        <option value="box">Box</option>
                                        <option value="pack">Pack</option>
                                        <option value="bag">Bag</option>
                                        <option value="bottle">Bottle</option>
                                        <option value="tin">Tin / Can</option>
                                        <option value="tray">Tray</option>
                                        <option value="dozen">Dozen</option>
                                    </select>
                                </div>
                                <div className="sis-new-field">
                                    <label>Quantity</label>
                                    <input
                                        type="number"
                                        min="0.01"
                                        step="any"
                                        placeholder="1"
                                        value={newItem.quantity}
                                        onChange={e => setNewItem({ ...newItem, quantity: e.target.value })}
                                    />
                                </div>
                            </div>
                            <div className="sis-new-row">
                                <div className="sis-new-field">
                                    <label>Unit Cost Price (£)</label>
                                    <input
                                        type="number"
                                        min="0"
                                        step="0.01"
                                        placeholder="0.00"
                                        value={newItem.cost_price}
                                        onChange={e => setNewItem({ ...newItem, cost_price: e.target.value })}
                                    />
                                </div>
                                <div className="sis-new-field">
                                    <label>Line Total</label>
                                    <div style={{ padding: '10px 12px', background: 'rgba(201,169,110,0.08)', border: '1px solid rgba(201,169,110,0.25)', borderRadius: 6, fontWeight: 700, color: 'var(--color-primary, #c9a96e)', fontSize: 16, textAlign: 'right' }}>
                                        £{((Number(newItem.quantity) || 0) * (Number(newItem.cost_price) || 0)).toFixed(2)}
                                    </div>
                                </div>
                            </div>
                            <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
                                <button type="button" className="btn btn-secondary" style={{ flex: 1 }} onClick={() => setShowNewForm(false)}>
                                    Cancel
                                </button>
                                <button type="button" className="btn btn-primary" style={{ flex: 2 }} onClick={handleAddNew} disabled={!newItem.name.trim()}>
                                    <MdAdd size={18} /> Add to Purchase
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default SmartItemSearch;
