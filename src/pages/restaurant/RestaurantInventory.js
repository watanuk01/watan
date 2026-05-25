import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import Pagination from '../../components/common/Pagination';
import {
    getRestaurantInventory,
    adjustRestaurantStock,
    getRestaurantInventoryStats,
    updateRestaurantItemSettings,
} from '../../services/restaurantInventoryService';
import {
    MdSearch,
    MdRefresh,
    MdClose,
    MdFileDownload,
    MdInventory2,
    MdAdd,
    MdRemove,
    MdTrendingDown,
    MdTrendingUp,
    MdLocalShipping,
    MdVisibility,
    MdEdit,
    MdSave,
    MdWarning,
} from 'react-icons/md';
import toast from 'react-hot-toast';
import '../inventory/Inventory.css';
import './Restaurant.css';

// Restaurant item types (matching CK item types)
const REST_ITEM_TYPES = [
    { value: 'grocery',     label: 'Grocery',     icon: '🛒', color: '#22c55e' },
    { value: 'raw_meat',    label: 'Raw Meat',    icon: '🥩', color: '#ef4444' },
    { value: 'cooked_meat', label: 'Cooked Meat', icon: '🍖', color: '#f59e0b' },
];

const getItemTypeInfo = (type) => REST_ITEM_TYPES.find(t => t.value === type) || { label: type, icon: '📦', color: '#888' };

const RestaurantInventory = () => {
    const { currentUser, userProfile } = useAuth();
    const [items, setItems] = useState([]);
    const [loading, setLoading] = useState(true);
    const [searchQuery, setSearchQuery] = useState('');
    const [activeType, setActiveType] = useState('all');
    const [activeCategory, setActiveCategory] = useState('all');
    const [showLowStock, setShowLowStock] = useState(false);
    const [stats, setStats] = useState(null);

    // Sorting
    const [sortField, setSortField] = useState('item_name');
    const [sortDir, setSortDir] = useState('asc');

    // Pagination
    const [currentPage, setCurrentPage] = useState(1);
    const [itemsPerPage, setItemsPerPage] = useState(15);

    // Adjust modal
    const [adjustModal, setAdjustModal] = useState(null);
    const [adjustQty, setAdjustQty] = useState('');
    const [adjustReason, setAdjustReason] = useState('');
    const [adjusting, setAdjusting] = useState(false);

    // Batch detail modal
    const [batchModal, setBatchModal] = useState(null);

    // Threshold editing
    const [editThresholdId, setEditThresholdId] = useState(null);
    const [editThresholdVal, setEditThresholdVal] = useState('');
    const [savingThreshold, setSavingThreshold] = useState(false);

    const restaurantId = currentUser?.uid;

    const fetchData = useCallback(async () => {
        if (!restaurantId) return;
        setLoading(true);
        try {
            const [inventory, inventoryStats] = await Promise.all([
                getRestaurantInventory(restaurantId),
                getRestaurantInventoryStats(restaurantId),
            ]);
            setItems(inventory);
            setStats(inventoryStats);
        } catch (err) {
            console.error('Failed to load restaurant inventory:', err);
            toast.error('Failed to load inventory');
        } finally {
            setLoading(false);
        }
    }, [restaurantId]);

    useEffect(() => { fetchData(); }, [fetchData]);

    // ── Filtering ──
    const typeFilteredItems = useMemo(() => {
        return activeType === 'all' ? items : items.filter(i => i.item_type === activeType);
    }, [items, activeType]);

    // Extract unique categories from current type-filtered items
    const categories = useMemo(() => {
        const cats = new Set();
        typeFilteredItems.forEach(i => {
            if (i.category_name) cats.add(i.category_name);
        });
        return [...cats].sort();
    }, [typeFilteredItems]);

    const filteredItems = useMemo(() => {
        let result = typeFilteredItems;
        // Category filter
        if (activeCategory !== 'all') {
            result = result.filter(i => i.category_name === activeCategory);
        }
        // Low stock filter
        if (showLowStock) {
            result = result.filter(i => (i.current_stock || 0) <= (i.low_stock_threshold || 5));
        }
        // Search
        if (searchQuery.trim()) {
            const q = searchQuery.toLowerCase();
            result = result.filter(i =>
                i.item_name?.toLowerCase().includes(q) ||
                i.category_name?.toLowerCase().includes(q)
            );
        }
        // Sort
        result = [...result].sort((a, b) => {
            let aVal = a[sortField];
            let bVal = b[sortField];
            if (sortField === 'stock_value') {
                aVal = (a.current_stock || 0) * (a.cost_price || 0);
                bVal = (b.current_stock || 0) * (b.cost_price || 0);
            }
            if (sortField === 'margin') {
                aVal = (a.selling_price || 0) - (a.cost_price || 0);
                bVal = (b.selling_price || 0) - (b.cost_price || 0);
            }
            if (typeof aVal === 'string') aVal = aVal.toLowerCase();
            if (typeof bVal === 'string') bVal = bVal.toLowerCase();
            aVal = aVal ?? '';
            bVal = bVal ?? '';
            if (aVal < bVal) return sortDir === 'asc' ? -1 : 1;
            if (aVal > bVal) return sortDir === 'asc' ? 1 : -1;
            return 0;
        });
        return result;
    }, [typeFilteredItems, activeCategory, showLowStock, searchQuery, sortField, sortDir]);

    // Reset page on filter change
    useEffect(() => { setCurrentPage(1); }, [searchQuery, activeType, activeCategory, showLowStock]);

    const paginatedItems = filteredItems.slice(
        (currentPage - 1) * itemsPerPage,
        currentPage * itemsPerPage
    );

    const toggleSort = (field) => {
        if (sortField === field) setSortDir(prev => prev === 'asc' ? 'desc' : 'asc');
        else { setSortField(field); setSortDir('asc'); }
    };

    const sortIcon = (field) => sortField === field ? (sortDir === 'asc' ? ' ▲' : ' ▼') : '';

    // ── Stock status ──
    const getStockStatus = (item) => {
        const threshold = item.low_stock_threshold || 5;
        if ((item.current_stock || 0) <= 0) return { label: 'Out of Stock', class: 'danger' };
        if (item.current_stock <= threshold) return { label: 'Low Stock', class: 'warning' };
        return { label: 'In Stock', class: 'success' };
    };

    // ── Adjust stock ──
    const handleAdjust = async () => {
        const qty = Number(adjustQty);
        if (!qty || qty <= 0) { toast.error('Enter a valid quantity'); return; }

        setAdjusting(true);
        try {
            const isAdd = adjustModal.type === 'add';
            const amount = isAdd ? qty : -qty;
            await adjustRestaurantStock(
                restaurantId,
                adjustModal.item.id,
                amount,
                adjustReason || (isAdd ? 'Manual stock addition' : 'Manual stock removal'),
                { uid: currentUser.uid, name: userProfile?.name || '', email: currentUser.email }
            );
            toast.success(`Stock ${isAdd ? 'increased' : 'decreased'} for ${adjustModal.item.item_name}`);
            setAdjustModal(null);
            setAdjustQty('');
            setAdjustReason('');
            fetchData();
        } catch (err) {
            toast.error(err.message || 'Failed to adjust stock');
        } finally {
            setAdjusting(false);
        }
    };

    // ── Save threshold ──
    const handleSaveThreshold = async (item) => {
        const newVal = Number(editThresholdVal);
        if (isNaN(newVal) || newVal < 0) {
            toast.error('Enter a valid threshold');
            return;
        }
        setSavingThreshold(true);
        try {
            await updateRestaurantItemSettings(item.id, { low_stock_threshold: newVal });
            // Update local state
            setItems(prev => prev.map(i =>
                i.id === item.id ? { ...i, low_stock_threshold: newVal } : i
            ));
            toast.success(`Threshold updated for ${item.item_name}`);
            setEditThresholdId(null);
            setEditThresholdVal('');
        } catch (err) {
            toast.error('Failed to update threshold');
            console.error(err);
        } finally {
            setSavingThreshold(false);
        }
    };

    // ── Export ──
    const handleExport = () => {
        const headers = ['Item Name', 'Type', 'Category', 'Current Stock', 'Unit', 'Cost/Unit', 'Sell/Unit', 'Stock Value', 'Margin/Unit', 'Status', 'Last Delivery'];
        const rows = filteredItems.map(item => [
            item.item_name,
            item.item_type,
            item.category_name || '',
            Math.round((item.current_stock || 0) * 100) / 100,
            item.unit,
            (item.cost_price || 0).toFixed(2),
            (item.selling_price || 0).toFixed(2),
            ((item.current_stock || 0) * (item.cost_price || 0)).toFixed(2),
            ((item.selling_price || 0) - (item.cost_price || 0)).toFixed(2),
            getStockStatus(item).label,
            item.last_delivery_date ? new Date(item.last_delivery_date).toLocaleDateString('en-GB') : '—',
        ]);
        const csv = [headers, ...rows].map(r => r.join(',')).join('\n');
        const blob = new Blob([csv], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `restaurant_inventory_${new Date().toISOString().split('T')[0]}.csv`;
        a.click();
    };

    const formatDate = (date) => {
        if (!date) return '—';
        const d = date instanceof Date ? date : new Date(date);
        return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
    };

    // Summary values
    const totalCostValue = filteredItems.reduce((s, i) => s + ((i.current_stock || 0) * (i.cost_price || 0)), 0);
    const totalSellValue = filteredItems.reduce((s, i) => s + ((i.current_stock || 0) * (i.selling_price || 0)), 0);
    const lowStockCount = filteredItems.filter(i => (i.current_stock || 0) <= (i.low_stock_threshold || 5) && (i.current_stock || 0) > 0).length;
    const outOfStockCount = filteredItems.filter(i => (i.current_stock || 0) <= 0).length;

    return (
        <div className="page-content">
            <div className="page-header">
                <div>
                    <h1 className="page-title">
                        <MdInventory2 style={{ marginRight: 'var(--space-2)' }} />
                        My Inventory
                    </h1>
                    <p className="page-subtitle">
                        <strong>£{totalCostValue.toFixed(2)}</strong> total cost | <strong>£{totalSellValue.toFixed(2)}</strong> total selling
                        {lowStockCount > 0 && (
                            <span style={{ color: 'var(--color-warning)', marginLeft: 'var(--space-2)' }}>
                                ⚠️ {lowStockCount} low stock
                            </span>
                        )}
                        {outOfStockCount > 0 && (
                            <span style={{ color: 'var(--color-danger)', marginLeft: 'var(--space-2)' }}>
                                ❌ {outOfStockCount} out of stock
                            </span>
                        )}
                    </p>
                </div>
                <div style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'center' }}>
                    <button className="btn btn-secondary btn-md" onClick={handleExport}>
                        <MdFileDownload /> Export CSV
                    </button>
                    <button className="btn-refresh" onClick={fetchData} title="Refresh">
                        <MdRefresh />
                    </button>
                </div>
            </div>

            {/* Stats Cards */}
            {stats && (
                <div className="stats-grid" style={{ marginBottom: 'var(--space-5)' }}>
                    <div className="stats-card">
                        <div className="stats-card-top">
                            <div className="stats-card-icon primary"><MdInventory2 /></div>
                        </div>
                        <div className="stats-card-value">{stats.totalItems}</div>
                        <div className="stats-card-label">Total Items</div>
                    </div>
                    <div className="stats-card">
                        <div className="stats-card-top">
                            <div className="stats-card-icon info"><MdTrendingUp /></div>
                        </div>
                        <div className="stats-card-value">£{stats.totalValue.toFixed(2)}</div>
                        <div className="stats-card-label">Stock Value</div>
                    </div>
                    <div className="stats-card">
                        <div className="stats-card-top">
                            <div className="stats-card-icon warning"><MdTrendingDown /></div>
                        </div>
                        <div className="stats-card-value">{stats.lowStockCount}</div>
                        <div className="stats-card-label">Low Stock</div>
                    </div>
                    <div className="stats-card">
                        <div className="stats-card-top">
                            <div className="stats-card-icon danger"><MdLocalShipping /></div>
                        </div>
                        <div className="stats-card-value">{stats.outOfStockCount}</div>
                        <div className="stats-card-label">Out of Stock</div>
                    </div>
                </div>
            )}

            {/* Type Filter Tabs */}
            <div className="type-tabs">
                <button
                    className={`type-tab ${activeType === 'all' ? 'active' : ''}`}
                    onClick={() => setActiveType('all')}
                    style={{ '--type-color': 'var(--color-primary)' }}
                >
                    All Items ({items.length})
                </button>
                {REST_ITEM_TYPES.map(t => (
                    <button
                        key={t.value}
                        className={`type-tab ${activeType === t.value ? 'active' : ''}`}
                        onClick={() => setActiveType(t.value)}
                        style={{ '--type-color': t.color }}
                    >
                        {t.icon} {t.label} ({items.filter(i => i.item_type === t.value).length})
                    </button>
                ))}
            </div>

            {/* Category Chips + Low Stock Filter */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', flexWrap: 'wrap', marginBottom: 'var(--space-4)' }}>
                {/* Category chips */}
                <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap', flex: 1 }}>
                    <button
                        className={`type-tab ${activeCategory === 'all' ? 'active' : ''}`}
                        onClick={() => setActiveCategory('all')}
                        style={{ '--type-color': 'var(--color-primary)', fontSize: 'var(--text-xs)', padding: '4px 12px' }}
                    >
                        All Categories
                    </button>
                    {categories.map(cat => (
                        <button
                            key={cat}
                            className={`type-tab ${activeCategory === cat ? 'active' : ''}`}
                            onClick={() => setActiveCategory(cat)}
                            style={{ '--type-color': '#3b82f6', fontSize: 'var(--text-xs)', padding: '4px 12px' }}
                        >
                            {cat}
                        </button>
                    ))}
                </div>

                {/* Low Stock Toggle */}
                <button
                    onClick={() => setShowLowStock(prev => !prev)}
                    style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                        padding: '6px 14px',
                        borderRadius: 20,
                        border: showLowStock ? '1px solid #f59e0b' : '1px solid var(--color-border)',
                        background: showLowStock ? 'rgba(245, 158, 11, 0.15)' : 'transparent',
                        color: showLowStock ? '#f59e0b' : 'var(--color-text-secondary)',
                        fontSize: 'var(--text-xs)',
                        fontWeight: 600,
                        cursor: 'pointer',
                        transition: 'all 0.2s',
                        whiteSpace: 'nowrap',
                    }}
                >
                    <MdWarning /> Low Stock ({items.filter(i => (i.current_stock || 0) <= (i.low_stock_threshold || 5)).length})
                </button>
            </div>

            {/* Search Bar */}
            <div className="search-bar" style={{ marginBottom: 'var(--space-5)' }}>
                <MdSearch className="search-icon" />
                <input
                    className="search-input"
                    placeholder="Search by item name or category..."
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                />
                {searchQuery && (
                    <button className="search-clear" onClick={() => setSearchQuery('')}>
                        <MdClose />
                    </button>
                )}
            </div>

            {/* Table */}
            {loading ? (
                <div className="data-table-wrapper">
                    <table className="data-table">
                        <thead>
                            <tr>
                                <th>Item</th><th>Type</th><th>Category</th><th>Stock</th><th>Unit</th>
                                <th>Cost/Unit</th><th>Sell/Unit</th><th>Stock Value</th><th>Margin</th>
                                <th>Threshold</th><th>Status</th><th>Last Delivery</th><th>Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {Array.from({ length: 5 }).map((_, i) => (
                                <tr key={i}>
                                    {Array.from({ length: 13 }).map((_, j) => (
                                        <td key={j}><div className="skeleton skeleton-text" style={{ height: 16, width: '70%' }} /></td>
                                    ))}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            ) : filteredItems.length === 0 ? (
                <div className="card" style={{ textAlign: 'center', padding: 'var(--space-12)' }}>
                    <MdInventory2 style={{ fontSize: 48, opacity: 0.3, marginBottom: 'var(--space-4)', color: 'var(--color-text-muted)' }} />
                    <h3 style={{ color: 'var(--color-text-secondary)', marginBottom: 'var(--space-2)' }}>
                        {items.length === 0 ? 'No Inventory Yet' : 'No items match your search'}
                    </h3>
                    <p style={{ color: 'var(--color-text-muted)', fontSize: 'var(--text-sm)' }}>
                        {items.length === 0
                            ? 'Your inventory will be populated when orders from Central Kitchen are delivered.'
                            : 'Try adjusting your filters or search query.'
                        }
                    </p>
                </div>
            ) : (
                <div className="data-table-wrapper">
                    <table className="data-table">
                        <thead>
                            <tr>
                                <th style={{ cursor: 'pointer' }} onClick={() => toggleSort('item_name')}>Item{sortIcon('item_name')}</th>
                                <th style={{ cursor: 'pointer' }} onClick={() => toggleSort('item_type')}>Type{sortIcon('item_type')}</th>
                                <th style={{ cursor: 'pointer' }} onClick={() => toggleSort('category_name')}>Category{sortIcon('category_name')}</th>
                                <th style={{ cursor: 'pointer' }} onClick={() => toggleSort('current_stock')}>Stock{sortIcon('current_stock')}</th>
                                <th>Unit</th>
                                <th style={{ cursor: 'pointer' }} onClick={() => toggleSort('cost_price')}>Cost/Unit{sortIcon('cost_price')}</th>
                                <th style={{ cursor: 'pointer' }} onClick={() => toggleSort('selling_price')}>Sell/Unit{sortIcon('selling_price')}</th>
                                <th style={{ cursor: 'pointer' }} onClick={() => toggleSort('stock_value')}>Stock Value{sortIcon('stock_value')}</th>
                                <th style={{ cursor: 'pointer' }} onClick={() => toggleSort('margin')}>Margin{sortIcon('margin')}</th>
                                <th style={{ cursor: 'pointer' }} onClick={() => toggleSort('low_stock_threshold')}>Threshold{sortIcon('low_stock_threshold')}</th>
                                <th>Status</th>
                                <th>Last Delivery</th>
                                <th>Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {paginatedItems.map(item => {
                                const status = getStockStatus(item);
                                const typeInfo = getItemTypeInfo(item.item_type);
                                const stockValue = (item.current_stock || 0) * (item.cost_price || 0);
                                const margin = (item.selling_price || 0) - (item.cost_price || 0);
                                return (
                                    <tr key={item.id}>
                                        <td style={{ fontWeight: 600, color: 'var(--color-text-primary)' }}>{item.item_name}</td>
                                        <td>
                                            <span className="item-type-badge" style={{ '--type-color': typeInfo.color }}>
                                                {typeInfo.icon} {typeInfo.label}
                                            </span>
                                        </td>
                                        <td style={{ color: 'var(--color-text-secondary)' }}>{item.category_name || '—'}</td>
                                        <td>
                                            <span style={{ fontSize: 'var(--text-md)', fontWeight: 700, color: 'var(--color-text-primary)' }}>
                                                {Math.round((item.current_stock || 0) * 100) / 100}
                                            </span>
                                        </td>
                                        <td style={{ color: 'var(--color-text-muted)' }}>{item.unit}</td>
                                        <td>£{(item.cost_price || 0).toFixed(2)}</td>
                                        <td>£{(item.selling_price || 0).toFixed(2)}</td>
                                        <td style={{ fontWeight: 600 }}>£{stockValue.toFixed(2)}</td>
                                        <td>
                                            <span style={{
                                                color: margin >= 0 ? 'var(--color-success)' : 'var(--color-danger)',
                                                fontWeight: 600,
                                            }}>
                                                {margin >= 0 ? '+' : ''}£{margin.toFixed(2)}
                                            </span>
                                        </td>
                                        <td>
                                            {editThresholdId === item.id ? (
                                                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                                    <input
                                                        type="number"
                                                        min={0}
                                                        step={0.5}
                                                        value={editThresholdVal}
                                                        onChange={e => setEditThresholdVal(e.target.value)}
                                                        className="form-input"
                                                        style={{ width: 70, height: 28, fontSize: 12, padding: '2px 6px' }}
                                                        autoFocus
                                                        onKeyDown={e => {
                                                            if (e.key === 'Enter') handleSaveThreshold(item);
                                                            if (e.key === 'Escape') { setEditThresholdId(null); setEditThresholdVal(''); }
                                                        }}
                                                    />
                                                    <span style={{ fontSize: 10, color: 'var(--color-text-muted)' }}>{item.unit}</span>
                                                    <button
                                                        className="btn-action"
                                                        onClick={() => handleSaveThreshold(item)}
                                                        disabled={savingThreshold}
                                                        title="Save"
                                                        style={{ color: 'var(--color-success)', padding: 2 }}
                                                    >
                                                        <MdSave size={16} />
                                                    </button>
                                                    <button
                                                        className="btn-action"
                                                        onClick={() => { setEditThresholdId(null); setEditThresholdVal(''); }}
                                                        title="Cancel"
                                                        style={{ color: 'var(--color-text-muted)', padding: 2 }}
                                                    >
                                                        <MdClose size={16} />
                                                    </button>
                                                </div>
                                            ) : (
                                                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                                    <span style={{ fontSize: 'var(--text-sm)' }}>
                                                        {item.low_stock_threshold ?? 5} {item.unit}
                                                    </span>
                                                    <button
                                                        className="btn-action"
                                                        onClick={() => {
                                                            setEditThresholdId(item.id);
                                                            setEditThresholdVal(item.low_stock_threshold ?? 5);
                                                        }}
                                                        title="Edit threshold"
                                                        style={{ padding: 2, color: 'var(--color-text-muted)' }}
                                                    >
                                                        <MdEdit size={14} />
                                                    </button>
                                                </div>
                                            )}
                                        </td>
                                        <td><span className={`badge badge-${status.class}`}>{status.label}</span></td>
                                        <td style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>
                                            {formatDate(item.last_delivery_date)}
                                        </td>
                                        <td>
                                            <div className="action-btns">
                                                {(item.item_type === 'raw_meat' || item.item_type === 'cooked_meat') && (
                                                    <button
                                                        className="btn-action"
                                                        onClick={() => setBatchModal(item)}
                                                        title="View Batches"
                                                        style={{ color: 'var(--color-info)' }}
                                                    >
                                                        <MdVisibility />
                                                    </button>
                                                )}
                                                <button
                                                    className="btn-action"
                                                    onClick={() => { setAdjustModal({ item, type: 'add' }); setAdjustQty(''); setAdjustReason(''); }}
                                                    title="Add stock"
                                                    style={{ color: 'var(--color-success)' }}
                                                >
                                                    <MdAdd />
                                                </button>
                                                <button
                                                    className="btn-action delete"
                                                    onClick={() => { setAdjustModal({ item, type: 'remove' }); setAdjustQty(''); setAdjustReason(''); }}
                                                    title="Remove stock"
                                                    style={{ color: 'var(--color-danger)' }}
                                                >
                                                    <MdRemove />
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            )}

            {/* Pagination */}
            {!loading && filteredItems.length > 0 && (
                <Pagination
                    currentPage={currentPage}
                    totalItems={filteredItems.length}
                    itemsPerPage={itemsPerPage}
                    onPageChange={setCurrentPage}
                    onItemsPerPageChange={setItemsPerPage}
                />
            )}

            {/* ── Stock Adjustment Modal ── */}
            {adjustModal && (
                <div className="modal-overlay" onClick={() => setAdjustModal(null)}>
                    <div className="modal modal-md" onClick={e => e.stopPropagation()}>
                        <div className="modal-header">
                            <h2>{adjustModal.type === 'add' ? 'Add Stock' : 'Remove Stock'}</h2>
                            <button className="modal-close" onClick={() => setAdjustModal(null)}><MdClose /></button>
                        </div>
                        <div className="modal-body">
                            <p style={{ color: 'var(--color-text-secondary)', marginBottom: 'var(--space-4)' }}>
                                <strong style={{ color: 'var(--color-text-primary)' }}>{adjustModal.item.item_name}</strong>
                                <br />Current stock: <strong>{Math.round((adjustModal.item.current_stock || 0) * 100) / 100}</strong> {adjustModal.item.unit}
                            </p>

                            <div style={{
                                background: 'var(--color-info-bg)',
                                border: '1px solid var(--color-info)',
                                borderRadius: 'var(--radius-md)',
                                padding: 'var(--space-3)',
                                marginBottom: 'var(--space-4)',
                                fontSize: 'var(--text-xs)',
                                color: 'var(--color-info)',
                            }}>
                                ℹ️ Stock adjustments will be notified to Central Kitchen admin for transparency.
                            </div>

                            <div className="form-group" style={{ marginBottom: 'var(--space-4)' }}>
                                <label className="form-label">Quantity ({adjustModal.item.unit})</label>
                                <input
                                    type="number"
                                    className="form-input"
                                    value={adjustQty}
                                    onChange={e => setAdjustQty(e.target.value)}
                                    min="0"
                                    step="0.1"
                                    autoFocus
                                />
                            </div>

                            <div className="form-group">
                                <label className="form-label">Reason</label>
                                <input
                                    type="text"
                                    className="form-input"
                                    value={adjustReason}
                                    onChange={e => setAdjustReason(e.target.value)}
                                    placeholder={adjustModal.type === 'add' ? 'e.g. Received extra stock' : 'e.g. Spillage / correction'}
                                />
                            </div>
                        </div>
                        <div className="modal-footer">
                            <button className="btn btn-secondary btn-md" onClick={() => setAdjustModal(null)}>Cancel</button>
                            <button
                                className={`btn btn-md ${adjustModal.type === 'add' ? 'btn-primary' : 'btn-danger'}`}
                                onClick={handleAdjust}
                                disabled={adjusting || !adjustQty || Number(adjustQty) <= 0}
                            >
                                {adjusting ? 'Adjusting...' : adjustModal.type === 'add' ? 'Add Stock' : 'Remove Stock'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* ── Batch Detail Modal ── */}
            {batchModal && (
                <div className="modal-overlay" onClick={() => setBatchModal(null)}>
                    <div className="modal modal-lg" onClick={e => e.stopPropagation()}>
                        <div className="modal-header">
                            <h2>Batch Details — {batchModal.item_name}</h2>
                            <button className="modal-close" onClick={() => setBatchModal(null)}><MdClose /></button>
                        </div>
                        <div className="modal-body">
                            {batchModal.batches && batchModal.batches.length > 0 ? (
                                <div className="data-table-wrapper">
                                    <table className="data-table">
                                        <thead>
                                            <tr>
                                                <th>Batch #</th>
                                                <th>Quantity</th>
                                                <th>Unit</th>
                                                <th>Expiry</th>
                                                <th>Status</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {batchModal.batches.map((batch, idx) => (
                                                <tr key={idx}>
                                                    <td style={{ fontWeight: 600, fontFamily: 'var(--font-mono)' }}>
                                                        {batch.batch_number || `Batch ${idx + 1}`}
                                                    </td>
                                                    <td style={{ fontWeight: 700 }}>
                                                        {Math.round((batch.remaining_qty || batch.quantity || 0) * 100) / 100}
                                                    </td>
                                                    <td>{batchModal.unit}</td>
                                                    <td>
                                                        {batch.expiry_date
                                                            ? new Date(batch.expiry_date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
                                                            : '—'
                                                        }
                                                    </td>
                                                    <td>
                                                        <span className={`badge badge-${batch.status === 'expired' ? 'danger' : 'success'}`}>
                                                            {batch.status || 'Available'}
                                                        </span>
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            ) : (
                                <div style={{ textAlign: 'center', padding: 'var(--space-8)', color: 'var(--color-text-muted)' }}>
                                    No batch details available for this item.
                                </div>
                            )}
                        </div>
                        <div className="modal-footer">
                            <button className="btn btn-secondary btn-md" onClick={() => setBatchModal(null)}>Close</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default RestaurantInventory;
