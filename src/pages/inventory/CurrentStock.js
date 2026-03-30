import React, { useState, useEffect, useCallback } from 'react';
import Pagination from '../../components/common/Pagination';
import {
    getItems,
    adjustStock,
    adjustStockBatchAware,
    getBatches,
    ITEM_TYPES,
    resolveToBaseUnit,
} from '../../services/inventoryService';
import {
    MdSearch,
    MdRefresh,
    MdAdd,
    MdRemove,
    MdClose,
    MdFileDownload,
    MdInventory2,
    MdGridView,
    MdViewList,
} from 'react-icons/md';
import toast from 'react-hot-toast';
import './Inventory.css';

const CurrentStock = () => {
    const [items, setItems] = useState([]);
    const [loading, setLoading] = useState(true);
    const [searchQuery, setSearchQuery] = useState('');
    const [activeType, setActiveType] = useState('all');
    const [viewMode, setViewMode] = useState('grid'); // 'grid' or 'list'
    const [adjustModal, setAdjustModal] = useState(null);
    const [adjustQty, setAdjustQty] = useState('');
    const [adjustReason, setAdjustReason] = useState('');
    const [adjusting, setAdjusting] = useState(false);
    // Sorting
    const [sortField, setSortField] = useState('name');
    const [sortDir, setSortDir] = useState('asc');
    // Batch-aware fields
    const [batchMode, setBatchMode] = useState('new_batch'); // 'new_batch' | 'existing_batch' | 'fifo' | 'specific_batch'
    const [availableBatches, setAvailableBatches] = useState([]);
    const [selectedBatchId, setSelectedBatchId] = useState('');
    const [expiryDate, setExpiryDate] = useState('');
    const [loadingBatches, setLoadingBatches] = useState(false);
    const [currentPage, setCurrentPage] = useState(1);
    const [itemsPerPage, setItemsPerPage] = useState(10);

    const fetchData = useCallback(async () => {
        setLoading(true);
        try {
            const allItems = await getItems({ status: 'active' });
            setItems(allItems);
        } catch (err) {
            toast.error('Failed to load stock data');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { fetchData(); }, [fetchData]);

    // Filter by type first, then by search
    const typeFilteredItems = activeType === 'all' ? items : items.filter(i => i.item_type === activeType);

    const filteredItems = typeFilteredItems.filter(item => {
        if (!searchQuery) return true;
        const q = searchQuery.toLowerCase();
        return item.name?.toLowerCase().includes(q) || item.sku?.toLowerCase().includes(q);
    }).sort((a, b) => {
        let aVal = a[sortField];
        let bVal = b[sortField];
        // Handle nested values
        if (sortField === 'total_value') {
            aVal = (a.current_stock || 0) * (a.cost_price || 0);
            bVal = (b.current_stock || 0) * (b.cost_price || 0);
        }
        if (sortField === 'updated_at') {
            aVal = a.updated_at?.toDate ? a.updated_at.toDate().getTime() : (a.updated_at || 0);
            bVal = b.updated_at?.toDate ? b.updated_at.toDate().getTime() : (b.updated_at || 0);
        }
        if (typeof aVal === 'string') aVal = aVal.toLowerCase();
        if (typeof bVal === 'string') bVal = bVal.toLowerCase();
        aVal = aVal ?? '';
        bVal = bVal ?? '';
        if (aVal < bVal) return sortDir === 'asc' ? -1 : 1;
        if (aVal > bVal) return sortDir === 'asc' ? 1 : -1;
        return 0;
    });

    // Reset page on filter change
    useEffect(() => { setCurrentPage(1); }, [searchQuery, activeType]);

    const paginatedItems = filteredItems.slice(
        (currentPage - 1) * itemsPerPage,
        currentPage * itemsPerPage
    );

    const toggleSort = (field) => {
        if (sortField === field) {
            setSortDir(prev => prev === 'asc' ? 'desc' : 'asc');
        } else {
            setSortField(field);
            setSortDir('asc');
        }
    };

    const sortIcon = (field) => sortField === field ? (sortDir === 'asc' ? ' ▲' : ' ▼') : '';

    // Check if an item is batch-tracked
    const isBatchTracked = (item) => item?.item_type === 'raw_meat' || item?.item_type === 'cooked_meat';

    // Load batches when opening modal for batch-tracked items
    const openAdjustModal = async (item, type) => {
        setAdjustModal({ item, type });
        setAdjustQty('');
        setAdjustReason('');
        setSelectedBatchId('');
        setExpiryDate('');

        if (isBatchTracked(item)) {
            // Defaults
            setBatchMode(type === 'add' ? 'new_batch' : 'fifo');

            // Pre-calculate default expiry
            const defaultDays = item.default_expiry_days || (item.item_type === 'raw_meat' ? 3 : 2);
            const expDate = new Date(Date.now() + defaultDays * 24 * 60 * 60 * 1000);
            setExpiryDate(expDate.toISOString().split('T')[0]);

            // Load available batches
            setLoadingBatches(true);
            try {
                const batches = await getBatches({ item_id: item.id, status: 'available' });
                batches.sort((a, b) => (a.created_at || 0) - (b.created_at || 0));
                setAvailableBatches(batches);
            } catch {
                setAvailableBatches([]);
            } finally {
                setLoadingBatches(false);
            }
        } else {
            setBatchMode('');
            setAvailableBatches([]);
        }
    };

    const handleAdjust = async () => {
        const qty = Number(adjustQty);
        if (!qty || qty <= 0) {
            toast.error('Enter a valid quantity');
            return;
        }
        setAdjusting(true);
        try {
            const item = adjustModal.item;
            const isAdd = adjustModal.type === 'add';

            if (isBatchTracked(item)) {
                // ── Batch-aware adjustment ──
                await adjustStockBatchAware(item, isAdd ? qty : -qty, {
                    reason: adjustReason,
                    source: 'manual_adjustment',
                    mode: batchMode,
                    batchId: selectedBatchId || null,
                    expiryDate: expiryDate || null,
                });
            } else {
                // ── Grocery: simple stock adjustment ──
                const amount = isAdd ? qty : -qty;
                await adjustStock(item.id, amount, adjustReason);
            }

            toast.success(`Stock ${isAdd ? 'added' : 'removed'} for ${item.name}`);
            setAdjustModal(null);
            setAdjustQty('');
            setAdjustReason('');
            setAvailableBatches([]);
            fetchData();
        } catch (err) {
            toast.error(err.message || 'Failed to adjust stock');
        } finally {
            setAdjusting(false);
        }
    };

    const handleExport = () => {
        const headers = ['Name', 'Type', 'Category', 'SKU', 'Avail Stock', 'Sold Stock', 'Unit', 'Cost/Unit', 'Total Value', 'Status', 'Last Updated'];
        const rows = filteredItems.map(item => [
            item.name, item.item_type, item.category_name || '',
            item.sku || '', Math.round((item.current_stock || 0) * 100) / 100, Math.round((item.total_sold || 0) * 100) / 100, item.unit,
            (item.cost_price || 0).toFixed(2),
            ((item.current_stock || 0) * (item.cost_price || 0)).toFixed(2),
            (item.current_stock <= (item.low_stock_threshold || item.min_stock || 0)) ? 'Low' : 'OK',
            item.updated_at ? new Date(item.updated_at.toDate ? item.updated_at.toDate() : item.updated_at).toISOString().split('T')[0] : '',
        ]);
        const csv = [headers, ...rows].map(r => r.join(',')).join('\n');
        const blob = new Blob([csv], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = `current_stock_${new Date().toISOString().split('T')[0]}.csv`;
        a.click();
    };

    const getStockStatus = (item) => {
        const threshold = item.low_stock_threshold || item.min_stock || 0;
        if ((item.current_stock || 0) <= 0) return { label: 'Out of Stock', class: 'danger' };
        if (threshold > 0 && item.current_stock <= threshold) return { label: 'Low Stock', class: 'warning' };
        return { label: 'In Stock', class: 'success' };
    };

    const getStockPct = (item) => {
        const threshold = item.low_stock_threshold || item.min_stock || 0;
        if (threshold <= 0) return 100;
        return Math.min((item.current_stock / (threshold * 3)) * 100, 100);
    };

    // Summary stats
    const totalItems = filteredItems.length;
    const totalActualValue = filteredItems.reduce((sum, i) => sum + ((i.current_stock || 0) * (i.cost_price || 0)), 0);
    const totalSellingValue = filteredItems.reduce((sum, i) => sum + ((i.current_stock || 0) * (i.selling_price || 0)), 0);
    const lowStockCount = filteredItems.filter(i => {
        const threshold = i.low_stock_threshold || i.min_stock || 0;
        return threshold > 0 && i.current_stock <= threshold;
    }).length;

    const getItemTypeInfo = (type) => ITEM_TYPES.find(t => t.value === type);

    const formatDate = (date) => {
        if (!date) return '—';
        const d = date.toDate ? date.toDate() : new Date(date);
        return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
    };

    return (
        <div className="page-content">
            <div className="page-header">
                <div>
                    <h1 className="page-title">
                        <MdInventory2 style={{ marginRight: 'var(--space-2)' }} />
                        Current Stock
                    </h1>
                    <p className="page-subtitle">
                        Real-time stock overview — <strong>£{totalActualValue.toFixed(2)}</strong> total cost | <strong>£{totalSellingValue.toFixed(2)}</strong> total selling
                        {lowStockCount > 0 && (
                            <span style={{ color: 'var(--color-warning)', marginLeft: 'var(--space-2)' }}>
                                ⚠️ {lowStockCount} low stock
                            </span>
                        )}
                    </p>
                </div>
                <div style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'center' }}>
                    <div className="view-toggle">
                        <button
                            className={`view-toggle-btn ${viewMode === 'grid' ? 'active' : ''}`}
                            onClick={() => setViewMode('grid')}
                            title="Grid View"
                        >
                            <MdGridView />
                        </button>
                        <button
                            className={`view-toggle-btn ${viewMode === 'list' ? 'active' : ''}`}
                            onClick={() => setViewMode('list')}
                            title="List View"
                        >
                            <MdViewList />
                        </button>
                    </div>
                    <button className="btn btn-secondary btn-md" onClick={handleExport}>
                        <MdFileDownload /> Export CSV
                    </button>
                </div>
            </div>

            {/* Type Filter Tabs */}
            <div className="type-tabs">
                <button
                    className={`type-tab ${activeType === 'all' ? 'active' : ''}`}
                    onClick={() => setActiveType('all')}
                    style={{ '--type-color': 'var(--color-primary)' }}
                >
                    All Items ({totalItems})
                </button>
                {ITEM_TYPES.map(t => (
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

            {/* Search */}
            <div className="search-bar" style={{ marginBottom: 'var(--space-5)' }}>
                <MdSearch className="search-icon" />
                <input
                    className="search-input"
                    placeholder="Search by name or SKU..."
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                />
                {searchQuery && (
                    <button className="search-clear" onClick={() => setSearchQuery('')}>
                        <MdClose />
                    </button>
                )}
            </div>

            {loading ? (
                <div className="stock-grid">
                    {Array.from({ length: 6 }).map((_, i) => (
                        <div key={i} className="stock-card">
                            <div className="skeleton skeleton-text" style={{ width: '60%', height: 20 }} />
                            <div className="skeleton skeleton-text" style={{ width: '40%', height: 14, marginTop: 8 }} />
                            <div className="skeleton skeleton-text" style={{ width: '50%', height: 44, marginTop: 12 }} />
                        </div>
                    ))}
                </div>
            ) : viewMode === 'grid' ? (
                /* ── Grid View ── */
                <div className="stock-grid">
                    {paginatedItems.map(item => {
                        const status = getStockStatus(item);
                        const pct = getStockPct(item);
                        const typeInfo = getItemTypeInfo(item.item_type);
                        return (
                            <div key={item.id} className="stock-card">
                                <div className="stock-card-header">
                                    <span className="item-type-badge" style={{ '--type-color': typeInfo?.color || '#888' }}>
                                        {typeInfo?.icon} {typeInfo?.label}
                                    </span>
                                    <span className={`badge badge-${status.class}`}>{status.label}</span>
                                </div>
                                <h4 className="stock-card-name">{item.name}</h4>
                                <div className="stock-card-qty">
                                    <span className="qty-value">{Math.round((item.current_stock || 0) * 100) / 100}</span>
                                    <span className="qty-unit">{item.unit}</span>
                                    {item.unit_conversion?.has_conversion && (() => {
                                        const resolved = resolveToBaseUnit(item.current_stock || 0, item);
                                        return <div className="base-unit-equiv">= {resolved.baseQuantity} {resolved.baseUnit}</div>;
                                    })()}
                                </div>
                                <div className="stock-bar"><div className="stock-bar-fill" style={{ width: `${pct}%`, background: typeInfo?.color }} /></div>
                                <div className="stock-card-meta">
                                    <span>Min: {item.min_stock || 0} {item.unit}</span>
                                    <span>Cost: £{((item.current_stock || 0) * (item.cost_price || 0)).toFixed(2)}</span>
                                    <span>Sell: £{((item.current_stock || 0) * (item.selling_price || 0)).toFixed(2)}</span>
                                </div>
                                <div className="stock-card-actions">
                                    <button className="btn-action" onClick={() => openAdjustModal(item, 'add')} title="Add stock" style={{ color: 'var(--color-success)' }}>
                                        <MdAdd />
                                    </button>
                                    <button className="btn-action delete" onClick={() => openAdjustModal(item, 'remove')} title="Remove stock" style={{ color: 'var(--color-danger)' }}>
                                        <MdRemove />
                                    </button>
                                </div>
                            </div>
                        );
                    })}
                </div>
            ) : (
                /* ── List View ── */
                <div className="data-table-wrapper">
                    <table className="data-table">
                        <thead>
                            <tr>
                                <th style={{ cursor: 'pointer' }} onClick={() => toggleSort('name')}>Item{sortIcon('name')}</th>
                                <th style={{ cursor: 'pointer' }} onClick={() => toggleSort('item_type')}>Type{sortIcon('item_type')}</th>
                                <th style={{ cursor: 'pointer' }} onClick={() => toggleSort('category_name')}>Category{sortIcon('category_name')}</th>
                                <th style={{ cursor: 'pointer' }} onClick={() => toggleSort('current_stock')}>Avail Stock{sortIcon('current_stock')}</th>
                                <th style={{ cursor: 'pointer' }} onClick={() => toggleSort('total_sold')}>Sold{sortIcon('total_sold')}</th>
                                <th>Unit</th>
                                <th style={{ cursor: 'pointer' }} onClick={() => toggleSort('cost_price')}>Cost/Unit{sortIcon('cost_price')}</th>
                                <th>Sell/Unit</th>
                                <th style={{ cursor: 'pointer' }} onClick={() => toggleSort('total_value')}>Total Actual{sortIcon('total_value')}</th>
                                <th>Total Selling</th>
                                <th>Status</th>
                                <th style={{ cursor: 'pointer' }} onClick={() => toggleSort('updated_at')}>Last Updated{sortIcon('updated_at')}</th>
                                <th>Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {paginatedItems.map(item => {
                                const status = getStockStatus(item);
                                const typeInfo = getItemTypeInfo(item.item_type);
                                return (
                                    <tr key={item.id}>
                                        <td style={{ fontWeight: 600 }}>{item.name}</td>
                                        <td>
                                            <span className="item-type-badge" style={{ '--type-color': typeInfo?.color || '#888' }}>
                                                {typeInfo?.icon} {typeInfo?.label}
                                            </span>
                                        </td>
                                        <td>{item.category_name || '—'}</td>
                                        <td>
                                            <div>
                                                <span style={{ fontSize: 'var(--text-md)', fontWeight: 700 }}>{Math.round((item.current_stock || 0) * 100) / 100}</span>
                                                <span style={{ fontSize: 'var(--text-xs)', marginLeft: 4 }}>{item.unit}</span>
                                                {item.unit_conversion?.has_conversion && (() => {
                                                    const resolved = resolveToBaseUnit(item.current_stock || 0, item);
                                                    return <div className="base-unit-equiv">= {resolved.baseQuantity} {resolved.baseUnit}</div>;
                                                })()}
                                            </div>
                                        </td>
                                        <td style={{ color: 'var(--color-text-muted)' }}>{Math.round((item.total_sold || 0) * 100) / 100}</td>
                                        <td>{item.unit}</td>
                                        <td>£{(item.cost_price || 0).toFixed(2)}</td>
                                        <td>£{(item.selling_price || 0).toFixed(2)}</td>
                                        <td style={{ fontWeight: 600 }}>£{((item.current_stock || 0) * (item.cost_price || 0)).toFixed(2)}</td>
                                        <td style={{ fontWeight: 600 }}>£{((item.current_stock || 0) * (item.selling_price || 0)).toFixed(2)}</td>
                                        <td><span className={`badge badge-${status.class}`}>{status.label}</span></td>
                                        <td style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>{formatDate(item.updated_at)}</td>
                                        <td>
                                            <div className="action-btns">
                                                <button
                                                    className="btn-action"
                                                    onClick={() => openAdjustModal(item, 'add')}
                                                    title="Add stock"
                                                    style={{ color: 'var(--color-success)' }}
                                                >
                                                    <MdAdd />
                                                </button>
                                                <button
                                                    className="btn-action delete"
                                                    onClick={() => openAdjustModal(item, 'remove')}
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

            {/* Stock Adjustment Modal */}
            {adjustModal && (
                <div className="modal-overlay" onClick={() => setAdjustModal(null)}>
                    <div className="modal modal-md" onClick={(e) => e.stopPropagation()}>
                        <div className="modal-header">
                            <h2>{adjustModal.type === 'add' ? 'Add Stock' : 'Remove Stock'}</h2>
                            <button className="modal-close" onClick={() => setAdjustModal(null)}><MdClose /></button>
                        </div>
                        <div className="modal-body">
                            <p style={{ color: 'var(--color-text-secondary)', marginBottom: 'var(--space-4)' }}>
                                <strong style={{ color: 'var(--color-text-primary)' }}>{adjustModal.item.name}</strong>
                                <br />Current stock: {adjustModal.item.current_stock} {adjustModal.item.unit}
                                {isBatchTracked(adjustModal.item) && (
                                    <span style={{ color: 'var(--color-primary)', marginLeft: 'var(--space-2)', fontSize: 'var(--text-xs)' }}>
                                        🔗 Batch tracked
                                    </span>
                                )}
                            </p>

                            <div className="form-group" style={{ marginBottom: 'var(--space-4)' }}>
                                <label className="form-label">Quantity ({adjustModal.item.unit})</label>
                                <input
                                    type="number"
                                    className="form-input"
                                    value={adjustQty}
                                    onChange={(e) => setAdjustQty(e.target.value)}
                                    min="0"
                                    step="0.1"
                                    autoFocus
                                />
                            </div>

                            {/* ── Batch-Aware Options (raw_meat / cooked_meat only) ── */}
                            {isBatchTracked(adjustModal.item) && (
                                <div className="batch-options-section">
                                    {adjustModal.type === 'add' ? (
                                        <>
                                            <label className="form-label" style={{ marginBottom: 'var(--space-2)' }}>Add To</label>
                                            <div className="batch-mode-options">
                                                <label className="batch-mode-radio">
                                                    <input
                                                        type="radio"
                                                        name="batchMode"
                                                        value="new_batch"
                                                        checked={batchMode === 'new_batch'}
                                                        onChange={() => { setBatchMode('new_batch'); setSelectedBatchId(''); }}
                                                    />
                                                    <span className="radio-label">
                                                        <strong>Create New Batch</strong>
                                                        <span className="radio-desc">New batch with auto-generated number</span>
                                                    </span>
                                                </label>
                                                <label className="batch-mode-radio">
                                                    <input
                                                        type="radio"
                                                        name="batchMode"
                                                        value="existing_batch"
                                                        checked={batchMode === 'existing_batch'}
                                                        onChange={() => setBatchMode('existing_batch')}
                                                        disabled={availableBatches.length === 0}
                                                    />
                                                    <span className="radio-label">
                                                        <strong>Add to Existing Batch</strong>
                                                        <span className="radio-desc">
                                                            {availableBatches.length > 0
                                                                ? `${availableBatches.length} batch${availableBatches.length > 1 ? 'es' : ''} available`
                                                                : 'No batches available'}
                                                        </span>
                                                    </span>
                                                </label>
                                            </div>

                                            {batchMode === 'new_batch' && (
                                                <div className="form-group" style={{ marginTop: 'var(--space-3)' }}>
                                                    <label className="form-label">Expiry Date</label>
                                                    <input
                                                        type="date"
                                                        className="form-input"
                                                        value={expiryDate}
                                                        onChange={(e) => setExpiryDate(e.target.value)}
                                                    />
                                                    <span className="form-hint">
                                                        Auto-filled from item's default expiry ({adjustModal.item.default_expiry_days || 3} days)
                                                    </span>
                                                </div>
                                            )}

                                            {batchMode === 'existing_batch' && (
                                                <div className="form-group" style={{ marginTop: 'var(--space-3)' }}>
                                                    <label className="form-label">Select Batch</label>
                                                    {loadingBatches ? (
                                                        <div className="skeleton skeleton-text" style={{ height: 40 }} />
                                                    ) : (
                                                        <select
                                                            className="form-select"
                                                            value={selectedBatchId}
                                                            onChange={(e) => setSelectedBatchId(e.target.value)}
                                                        >
                                                            <option value="">Select a batch...</option>
                                                            {availableBatches.map(b => (
                                                                <option key={b.id} value={b.id}>
                                                                    {b.batch_number} — {b.remaining_qty} {adjustModal.item.unit} remaining
                                                                    {b.expiry_date ? ` (exp: ${new Date(b.expiry_date).toLocaleDateString('en-GB')})` : ''}
                                                                </option>
                                                            ))}
                                                        </select>
                                                    )}
                                                </div>
                                            )}
                                        </>
                                    ) : (
                                        /* ── REMOVE: FIFO or Specific Batch ── */
                                        <>
                                            <label className="form-label" style={{ marginBottom: 'var(--space-2)' }}>Remove From</label>
                                            <div className="batch-mode-options">
                                                <label className="batch-mode-radio">
                                                    <input
                                                        type="radio"
                                                        name="batchMode"
                                                        value="fifo"
                                                        checked={batchMode === 'fifo'}
                                                        onChange={() => { setBatchMode('fifo'); setSelectedBatchId(''); }}
                                                    />
                                                    <span className="radio-label">
                                                        <strong>FIFO (Oldest First)</strong>
                                                        <span className="radio-desc">Automatically deduct from oldest batch</span>
                                                    </span>
                                                </label>
                                                <label className="batch-mode-radio">
                                                    <input
                                                        type="radio"
                                                        name="batchMode"
                                                        value="specific_batch"
                                                        checked={batchMode === 'specific_batch'}
                                                        onChange={() => setBatchMode('specific_batch')}
                                                        disabled={availableBatches.length === 0}
                                                    />
                                                    <span className="radio-label">
                                                        <strong>Specific Batch</strong>
                                                        <span className="radio-desc">Choose which batch to deduct from</span>
                                                    </span>
                                                </label>
                                            </div>

                                            {batchMode === 'specific_batch' && (
                                                <div className="form-group" style={{ marginTop: 'var(--space-3)' }}>
                                                    <label className="form-label">Select Batch</label>
                                                    {loadingBatches ? (
                                                        <div className="skeleton skeleton-text" style={{ height: 40 }} />
                                                    ) : (
                                                        <select
                                                            className="form-select"
                                                            value={selectedBatchId}
                                                            onChange={(e) => setSelectedBatchId(e.target.value)}
                                                        >
                                                            <option value="">Select a batch...</option>
                                                            {availableBatches.map(b => (
                                                                <option key={b.id} value={b.id}>
                                                                    {b.batch_number} — {b.remaining_qty} {adjustModal.item.unit} remaining
                                                                    {b.expiry_date ? ` (exp: ${new Date(b.expiry_date).toLocaleDateString('en-GB')})` : ''}
                                                                </option>
                                                            ))}
                                                        </select>
                                                    )}
                                                </div>
                                            )}

                                            {/* Show available batches summary */}
                                            {availableBatches.length > 0 && (
                                                <div className="batch-summary" style={{ marginTop: 'var(--space-3)' }}>
                                                    <p className="form-hint" style={{ marginBottom: 'var(--space-1)' }}>
                                                        Available batches ({availableBatches.length}):
                                                    </p>
                                                    {availableBatches.map(b => (
                                                        <div key={b.id} className="batch-summary-row">
                                                            <span className="batch-num">{b.batch_number}</span>
                                                            <span className="batch-qty">{b.remaining_qty} {adjustModal.item.unit}</span>
                                                            <span className="batch-source">{b.source || 'purchase'}</span>
                                                        </div>
                                                    ))}
                                                </div>
                                            )}
                                        </>
                                    )}
                                </div>
                            )}

                            <div className="form-group" style={{ marginTop: 'var(--space-4)' }}>
                                <label className="form-label">Reason</label>
                                <input
                                    type="text"
                                    className="form-input"
                                    value={adjustReason}
                                    onChange={(e) => setAdjustReason(e.target.value)}
                                    placeholder={adjustModal.type === 'add' ? 'e.g. Received from supplier' : 'e.g. Spoilage / waste'}
                                />
                            </div>
                        </div>
                        <div className="modal-footer">
                            <button className="btn btn-secondary btn-md" onClick={() => setAdjustModal(null)}>Cancel</button>
                            <button
                                className={`btn btn-md ${adjustModal.type === 'add' ? 'btn-primary' : 'btn-danger'}`}
                                onClick={handleAdjust}
                                disabled={
                                    adjusting ||
                                    !adjustQty ||
                                    Number(adjustQty) <= 0 ||
                                    (isBatchTracked(adjustModal.item) && batchMode === 'existing_batch' && !selectedBatchId) ||
                                    (isBatchTracked(adjustModal.item) && batchMode === 'specific_batch' && !selectedBatchId)
                                }
                            >
                                {adjusting ? 'Adjusting...' : adjustModal.type === 'add' ? 'Add Stock' : 'Remove Stock'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default CurrentStock;
