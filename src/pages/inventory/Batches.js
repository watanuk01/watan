import React, { useState, useEffect, useCallback } from 'react';
import {
    getBatches,
    getItems,
    addBatch,
    ITEM_TYPES,
} from '../../services/inventoryService';
import {
    MdSearch,
    MdRefresh,
    MdAdd,
    MdClose,
    MdFilterList,
    MdWarning,
    MdTimer,
    MdCheckCircle,
} from 'react-icons/md';
import toast from 'react-hot-toast';
import './Inventory.css';

const Batches = () => {
    const [batches, setBatches] = useState([]);
    const [items, setItems] = useState([]);
    const [loading, setLoading] = useState(true);
    const [searchQuery, setSearchQuery] = useState('');
    const [statusFilter, setStatusFilter] = useState('all');
    const [typeFilter, setTypeFilter] = useState('all');
    const [itemFilter, setItemFilter] = useState('all');
    const [showAddModal, setShowAddModal] = useState(false);
    const [newBatch, setNewBatch] = useState({
        item_id: '',
        item_name: '',
        item_type: '',
        quantity: '',
        unit: 'kg',
        cost_per_unit: '',
        manufactured_date: '',
        expiry_date: '',
        source: 'purchased',
        source_ref: '',
    });
    const [saving, setSaving] = useState(false);

    const fetchData = useCallback(async () => {
        setLoading(true);
        try {
            const batchFilters = {};
            if (statusFilter !== 'all') batchFilters.status = statusFilter;
            if (typeFilter !== 'all') batchFilters.item_type = typeFilter;
            const [batchData, itemData] = await Promise.all([getBatches(batchFilters), getItems()]);
            setBatches(batchData);
            setItems(itemData);
        } catch (err) {
            toast.error('Failed to load batches');
        } finally {
            setLoading(false);
        }
    }, [statusFilter, typeFilter]);

    useEffect(() => { fetchData(); }, [fetchData]);

    const filteredBatches = batches.filter(b => {
        // Item filter
        if (itemFilter !== 'all' && b.item_id !== itemFilter) return false;
        // Search
        if (!searchQuery) return true;
        const q = searchQuery.toLowerCase();
        return (
            b.batch_number?.toLowerCase().includes(q) ||
            b.item_name?.toLowerCase().includes(q)
        );
    });

    // Unique items from batches for filter dropdown
    const batchItems = batches.reduce((acc, b) => {
        if (!acc.find(x => x.id === b.item_id)) {
            acc.push({ id: b.item_id, name: b.item_name, type: b.item_type });
        }
        return acc;
    }, []).sort((a, b) => a.name?.localeCompare(b.name));

    const getDaysUntilExpiry = (expiryDate) => {
        if (!expiryDate) return null;
        const now = new Date();
        const expiry = new Date(expiryDate);
        return Math.ceil((expiry - now) / (1000 * 60 * 60 * 24));
    };

    const getExpiryBadge = (expiryDate, batchStatus) => {
        const days = getDaysUntilExpiry(expiryDate);
        if (days === null) return null;
        // Don't show expired tag for consumed batches — they're used up, expiry is irrelevant
        if (batchStatus === 'consumed') return { label: 'Consumed', class: 'muted' };
        if (days <= 0) return { label: 'Expired', class: 'expired' };
        if (days <= 3) return { label: `${days}d left`, class: 'critical' };
        if (days <= 7) return { label: `${days}d left`, class: 'warning' };
        return { label: `${days}d left`, class: 'ok' };
    };

    const getStatusBadge = (batch) => {
        const { status, expiry_date, remaining_qty } = batch;
        // If Firestore says 'available' but expiry has passed and there's remaining stock, override to expired
        const days = getDaysUntilExpiry(expiry_date);
        const isActuallyExpired = days !== null && days <= 0 && status === 'available' && remaining_qty > 0;

        if (isActuallyExpired) {
            return <span className="badge badge-danger"><MdWarning /> Expired</span>;
        }

        switch (status) {
            case 'available': return <span className="badge badge-success"><MdCheckCircle /> Available</span>;
            case 'consumed': return <span className="badge badge-muted">Consumed</span>;
            case 'expired': return <span className="badge badge-danger"><MdWarning /> Expired</span>;
            case 'reserved': return <span className="badge badge-warning"><MdTimer /> Reserved</span>;
            default: return <span className="badge badge-muted">{status}</span>;
        }
    };

    const formatDate = (date) => {
        if (!date) return '—';
        return new Date(date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
    };

    const getTypeInfo = (type) => ITEM_TYPES.find(t => t.value === type);

    // Filter items for batch add — only batch-tracked types (raw meat + cooked meat, optionally grocery with batch tracking)
    const batchableItems = items.filter(i =>
        i.item_type === 'raw_meat' || i.item_type === 'cooked_meat' ||
        (i.item_type === 'grocery' && i.expiry_tracking)
    );

    const handleAddBatch = async (e) => {
        e.preventDefault();
        if (!newBatch.item_id || !newBatch.quantity) {
            toast.error('Item and quantity are required');
            return;
        }
        setSaving(true);
        try {
            const selectedItem = items.find(i => i.id === newBatch.item_id);
            await addBatch({
                ...newBatch,
                item_name: selectedItem?.name || '',
                item_type: selectedItem?.item_type || '',
                quantity: Number(newBatch.quantity),
                cost_per_unit: Number(newBatch.cost_per_unit) || 0,
                unit: selectedItem?.unit || newBatch.unit,
            });
            toast.success('Batch added successfully');
            setShowAddModal(false);
            setNewBatch({
                item_id: '', item_name: '', item_type: '', quantity: '', unit: 'kg',
                cost_per_unit: '', manufactured_date: '', expiry_date: '',
                source: 'purchased', source_ref: '',
            });
            fetchData();
        } catch (err) {
            toast.error(err.message || 'Failed to add batch');
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="page-content">
            <div className="page-header">
                <div>
                    <h1 className="page-title">Batch Tracking</h1>
                    <p className="page-subtitle">
                        Track inventory batches, expiry dates, and stock sources — {batches.length} batches
                    </p>
                </div>
                <div style={{ display: 'flex', gap: 'var(--space-2)', flexShrink: 0 }}>
                    <button className="btn btn-primary btn-md" onClick={() => setShowAddModal(true)}>
                        <MdAdd /> Add Batch
                    </button>
                </div>
            </div>

            {/* Type Filter Tabs */}
            <div className="type-tabs">
                <button
                    className={`type-tab ${typeFilter === 'all' ? 'active' : ''}`}
                    onClick={() => setTypeFilter('all')}
                    style={{ '--type-color': 'var(--color-primary)' }}
                >
                    <span className="type-tab-icon">📋</span>
                    <span className="type-tab-label">All Batches</span>
                </button>
                {ITEM_TYPES.filter(t => t.value !== 'grocery').map(type => (
                    <button
                        key={type.value}
                        className={`type-tab ${typeFilter === type.value ? 'active' : ''}`}
                        onClick={() => setTypeFilter(type.value)}
                        style={{ '--type-color': type.color }}
                    >
                        <span className="type-tab-icon">{type.icon}</span>
                        <span className="type-tab-label">{type.label}</span>
                    </button>
                ))}
            </div>

            {/* Filters */}
            <div className="filters-bar">
                <div className="search-input-wrap" style={{ marginBottom: 'var(--space-2)' }}>
                    {/* <MdSearch /> */}
                    <input
                        type="text"
                        placeholder="Search by batch number or item..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="form-input"
                    />
                </div>
                <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
                    <MdFilterList style={{ color: 'var(--color-text-muted)' }} />
                    <select
                        className="form-select"
                        value={itemFilter}
                        onChange={(e) => setItemFilter(e.target.value)}
                        style={{ width: 'auto', minWidth: 160 }}
                    >
                        <option value="all">All Items</option>
                        {batchItems.map(item => (
                            <option key={item.id} value={item.id}>
                                {item.name}
                            </option>
                        ))}
                    </select>
                    <select
                        className="form-select"
                        value={statusFilter}
                        onChange={(e) => setStatusFilter(e.target.value)}
                        style={{ width: 'auto', minWidth: 130 }}
                    >
                        <option value="all">All Status</option>
                        <option value="available">Available</option>
                        <option value="consumed">Consumed</option>
                        <option value="expired">Expired</option>
                        <option value="reserved">Reserved</option>
                    </select>
                    <button className="btn-refresh" onClick={fetchData}><MdRefresh /></button>
                </div>
            </div>

            {/* Batch Table */}
            <div className="data-table-wrapper">
                <table className="data-table">
                    <thead>
                        <tr>
                            <th>BATCH #</th>
                            <th>TYPE</th>
                            <th>ITEM</th>
                            <th>QTY / REMAINING</th>
                            <th>SOURCE</th>
                            <th>MANUFACTURED</th>
                            <th>EXPIRY</th>
                            <th>STATUS</th>
                            <th>COST</th>
                        </tr>
                    </thead>
                    <tbody>
                        {loading ? (
                            Array.from({ length: 5 }).map((_, i) => (
                                <tr key={i}>
                                    {Array.from({ length: 9 }).map((_, j) => (
                                        <td key={j}><div className="skeleton skeleton-text"></div></td>
                                    ))}
                                </tr>
                            ))
                        ) : filteredBatches.length === 0 ? (
                            <tr>
                                <td colSpan="9">
                                    <div className="empty-state">
                                        <h3>No batches found</h3>
                                        <p>{searchQuery ? 'Try a different search' : 'Add items and batches to start tracking'}</p>
                                    </div>
                                </td>
                            </tr>
                        ) : (
                            filteredBatches.map(batch => {
                                const expiry = getExpiryBadge(batch.expiry_date, batch.status);
                                const typeInfo = getTypeInfo(batch.item_type);
                                const days = getDaysUntilExpiry(batch.expiry_date);
                                const isExpiredWithStock = days !== null && days <= 0 && batch.status !== 'consumed' && batch.remaining_qty > 0;
                                const usedQty = batch.quantity - batch.remaining_qty;
                                return (
                                    <tr key={batch.id}>
                                        <td>
                                            <span style={{ fontFamily: 'monospace', fontWeight: 600, color: 'var(--color-primary)' }}>
                                                {batch.batch_number}
                                            </span>
                                        </td>
                                        <td>
                                            {typeInfo && (
                                                <span className="badge badge-muted">{typeInfo.icon} {typeInfo.label}</span>
                                            )}
                                        </td>
                                        <td style={{ fontWeight: 500 }}>{batch.item_name}</td>
                                        <td>
                                            <div>
                                                <span style={{ fontWeight: 700 }}>{batch.remaining_qty}</span>
                                                <span style={{ color: 'var(--color-text-muted)' }}> / {batch.quantity} {batch.unit}</span>
                                            </div>
                                            {isExpiredWithStock && (
                                                <div style={{ fontSize: '0.75em', marginTop: 2 }}>
                                                    <span style={{ color: '#ef4444', fontWeight: 600 }}>
                                                        ⚠ {batch.remaining_qty} {batch.unit} expired
                                                    </span>
                                                    {usedQty > 0 && (
                                                        <span style={{ color: 'var(--color-text-muted)' }}>
                                                            {' '}· {usedQty} {batch.unit} used before expiry
                                                        </span>
                                                    )}
                                                </div>
                                            )}
                                        </td>
                                        <td>
                                            <span className={`badge batch-source-badge batch-source-${(batch.source || 'unknown').replace('_', '-')}`}>
                                                {batch.source === 'purchase' ? '🛒 Purchase'
                                                    : batch.source === 'production' ? '🔥 Production'
                                                        : batch.source === 'manual_adjustment' ? '✏️ Manual'
                                                            : batch.source === 'bulk_upload' ? '📤 Bulk Upload'
                                                                : batch.source || 'Unknown'}
                                            </span>
                                        </td>
                                        <td style={{ color: 'var(--color-text-muted)', fontSize: 'var(--text-xs)' }}>
                                            {formatDate(batch.manufactured_date)}
                                        </td>
                                        <td>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                                                <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>
                                                    {formatDate(batch.expiry_date)}
                                                </span>
                                                {expiry && <span className={`expiry-badge ${expiry.class}`}>{expiry.label}</span>}
                                            </div>
                                        </td>
                                        <td>{getStatusBadge(batch)}</td>
                                        <td style={{ color: 'var(--color-text-secondary)' }}>
                                            £{(batch.cost_price || batch.cost_per_unit || 0).toFixed(2)}/{batch.unit}
                                        </td>
                                    </tr>
                                );
                            })
                        )}
                    </tbody>
                </table>
            </div>

            {/* Add Batch Modal */}
            {showAddModal && (
                <div className="modal-overlay" onClick={() => setShowAddModal(false)}>
                    <div className="modal modal-md" onClick={(e) => e.stopPropagation()}>
                        <div className="modal-header">
                            <h2>Add New Batch</h2>
                            <button className="modal-close" onClick={() => setShowAddModal(false)}><MdClose /></button>
                        </div>
                        <form onSubmit={handleAddBatch}>
                            <div className="modal-body">
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
                                    <div className="form-group">
                                        <label className="form-label">Item *</label>
                                        <select
                                            className="form-select"
                                            value={newBatch.item_id}
                                            onChange={(e) => {
                                                const item = items.find(i => i.id === e.target.value);
                                                setNewBatch(prev => ({
                                                    ...prev,
                                                    item_id: e.target.value,
                                                    item_name: item?.name || '',
                                                    item_type: item?.item_type || '',
                                                    unit: item?.unit || 'kg',
                                                    source: item?.item_type === 'cooked_meat' ? 'produced' : 'purchased',
                                                }));
                                            }}
                                        >
                                            <option value="">Select item</option>
                                            {batchableItems.map(i => {
                                                const typeInfo = getTypeInfo(i.item_type);
                                                return (
                                                    <option key={i.id} value={i.id}>
                                                        {typeInfo?.icon} {i.name} ({i.sku})
                                                    </option>
                                                );
                                            })}
                                        </select>
                                        <span className="form-hint">
                                            Only batch-tracked items (Raw Meat, Cooked Meat, Grocery with expiry tracking)
                                        </span>
                                    </div>
                                    <div className="form-row">
                                        <div className="form-group">
                                            <label className="form-label">Quantity *</label>
                                            <input
                                                type="number"
                                                className="form-input"
                                                value={newBatch.quantity}
                                                onChange={(e) => setNewBatch(prev => ({ ...prev, quantity: e.target.value }))}
                                                min="0"
                                                step="0.1"
                                            />
                                        </div>
                                        <div className="form-group">
                                            <label className="form-label">Cost per Unit (£)</label>
                                            <input
                                                type="number"
                                                className="form-input"
                                                value={newBatch.cost_per_unit}
                                                onChange={(e) => setNewBatch(prev => ({ ...prev, cost_per_unit: e.target.value }))}
                                                min="0"
                                                step="0.01"
                                            />
                                        </div>
                                    </div>
                                    <div className="form-row">
                                        <div className="form-group">
                                            <label className="form-label">Manufactured Date</label>
                                            <input
                                                type="date"
                                                className="form-input"
                                                value={newBatch.manufactured_date}
                                                onChange={(e) => setNewBatch(prev => ({ ...prev, manufactured_date: e.target.value }))}
                                            />
                                        </div>
                                        <div className="form-group">
                                            <label className="form-label">Expiry Date</label>
                                            <input
                                                type="date"
                                                className="form-input"
                                                value={newBatch.expiry_date}
                                                onChange={(e) => setNewBatch(prev => ({ ...prev, expiry_date: e.target.value }))}
                                            />
                                        </div>
                                    </div>
                                    <div className="form-row">
                                        <div className="form-group">
                                            <label className="form-label">Source</label>
                                            <select
                                                className="form-select"
                                                value={newBatch.source}
                                                onChange={(e) => setNewBatch(prev => ({ ...prev, source: e.target.value }))}
                                            >
                                                <option value="purchased">Purchased</option>
                                                <option value="produced">Produced</option>
                                            </select>
                                        </div>
                                        <div className="form-group">
                                            <label className="form-label">Reference</label>
                                            <input
                                                type="text"
                                                className="form-input"
                                                placeholder="PO or Production batch ref"
                                                value={newBatch.source_ref}
                                                onChange={(e) => setNewBatch(prev => ({ ...prev, source_ref: e.target.value }))}
                                            />
                                        </div>
                                    </div>
                                </div>
                            </div>
                            <div className="modal-footer">
                                <button type="button" className="btn btn-secondary btn-md" onClick={() => setShowAddModal(false)}>Cancel</button>
                                <button type="submit" className="btn btn-primary btn-md" disabled={saving}>
                                    {saving ? 'Adding...' : 'Add Batch'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
};

export default Batches;
