import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
    getOrders, bulkMarkReady, cancelOrder, ORDER_STATUSES, subscribeToOrders
} from '../../services/orderService';
import {
    downloadPDF, downloadExcel, downloadDispatchPDF, downloadDispatchExcel
} from '../../services/orderExportService';
import { getItems } from '../../services/inventoryService';
import {
    MdRefresh, MdSearch, MdFilterList, MdViewModule, MdViewList,
    MdFileDownload, MdLocalShipping, MdCheckBox, MdCheckBoxOutlineBlank,
    MdVisibility, MdCancel, MdClose, MdPending, MdViewColumn
} from 'react-icons/md';
import toast from 'react-hot-toast';
import './Orders.css';

const DATE_RANGES = [
    { value: 'today', label: 'Today' },
    { value: '3days', label: 'Last 3 Days' },
    { value: '7days', label: 'Last 7 Days' },
    { value: '30days', label: 'Last 30 Days' },
    { value: 'custom', label: 'Custom Range' },
];

const TodaysOrders = () => {
    const [viewMode, setViewMode] = useState('grid'); // 'grid' or 'list'
    const [orders, setOrders] = useState([]);
    const [loading, setLoading] = useState(true);
    const [searchQuery, setSearchQuery] = useState('');
    const [dateRange, setDateRange] = useState('today');
    const [customStartDate, setCustomStartDate] = useState('');
    const [customEndDate, setCustomEndDate] = useState('');
    const [exportOpen, setExportOpen] = useState(false);

    // List View State
    const [activeStatus, setActiveStatus] = useState('all');
    const [selectedIds, setSelectedIds] = useState(new Set());
    const [bulkLoading, setBulkLoading] = useState(false);
    const [detailOrder, setDetailOrder] = useState(null);
    const [markReadyLoading, setMarkReadyLoading] = useState(false);
    const [cancelModal, setCancelModal] = useState(null);
    const [cancelReason, setCancelReason] = useState('');

    // Grid View State
    const [categories, setCategories] = useState({});
    const [restaurants, setRestaurants] = useState([]);
    const [gridData, setGridData] = useState([]);
    const [visibleColumns, setVisibleColumns] = useState({}); // To manage column visibility
    const [columnMenuOpen, setColumnMenuOpen] = useState(false);
    const [inventoryMap, setInventoryMap] = useState({}); // To map item names to their correct category
    const allOrdersRef = React.useRef([]);

    // Process and apply date filters to raw orders
    const applyFilters = useCallback((data, invMap) => {
        const now = new Date();
        let start = new Date();
        let end = new Date();

        if (dateRange === 'today') {
            start.setHours(0, 0, 0, 0);
        } else if (dateRange === '3days') {
            start.setDate(now.getDate() - 3); start.setHours(0, 0, 0, 0);
        } else if (dateRange === '7days') {
            start.setDate(now.getDate() - 7); start.setHours(0, 0, 0, 0);
        } else if (dateRange === '30days') {
            start.setDate(now.getDate() - 30); start.setHours(0, 0, 0, 0);
        } else if (dateRange === 'custom') {
            if (customStartDate) start = new Date(customStartDate);
            if (customEndDate) { end = new Date(customEndDate); end.setHours(23, 59, 59, 999); }
        }

        const filteredData = data.filter(order => {
            const orderDate = new Date(order.created_at);
            if (dateRange === 'custom' && customStartDate && customEndDate) {
                return orderDate >= start && orderDate <= end;
            } else if (dateRange !== 'all') {
                return orderDate >= start;
            }
            return true;
        });

        setOrders(filteredData);
        processGridData(filteredData, invMap);
    }, [dateRange, customStartDate, customEndDate]);

    // Real-time subscription to all orders
    useEffect(() => {
        setLoading(true);
        let invMap = inventoryMap;

        // Load inventory map once
        const initInventory = async () => {
            if (Object.keys(invMap).length === 0) {
                try {
                    const invItems = await getItems();
                    const map = {};
                    invItems.forEach(i => {
                        if (i.name && i.category_name) map[i.name] = i.category_name;
                    });
                    setInventoryMap(map);
                    invMap = map;
                } catch (err) {
                    console.error('Failed fetching inventory map', err);
                }
            }
        };

        let unsubscribe;
        initInventory().then(() => {
            unsubscribe = subscribeToOrders((orders) => {
                allOrdersRef.current = orders;
                applyFilters(orders, invMap);
                setLoading(false);
            });
        });

        return () => { if (unsubscribe) unsubscribe(); };
    }, []); // Subscribe once on mount

    // Re-apply filters when date range changes
    useEffect(() => {
        if (allOrdersRef.current.length > 0) {
            applyFilters(allOrdersRef.current, inventoryMap);
        }
    }, [dateRange, customStartDate, customEndDate, applyFilters, inventoryMap]);

    // Manual refresh (for the refresh button)
    const loadOrders = useCallback(async () => {
        setLoading(true);
        try {
            const data = await getOrders();
            allOrdersRef.current = data;
            applyFilters(data, inventoryMap);
        } catch (err) {
            console.error('Error reloading orders:', err);
            toast.error('Failed to reload orders');
        } finally {
            setLoading(false);
        }
    }, [inventoryMap, applyFilters]);

    // Process Pivot Grid Data
    const processGridData = (orderData, invMap) => {
        const itemMap = {};
        const restSet = new Set();
        const catSet = new Set();

        orderData.forEach(order => {
            const restName = order.restaurant_name || 'Unknown';
            restSet.add(restName);

            (order.items || []).forEach(item => {
                // Determine category, falling back to db and then custom mappings
                let cat = item.category;
                if (!cat) {
                    cat = invMap[item.item_name] || 'General';
                }

                const itemName = item.item_name;
                const key = `${cat}|${itemName}`;

                catSet.add(cat);

                if (!itemMap[key]) {
                    itemMap[key] = {
                        category: cat,
                        itemName: itemName,
                        unit: item.unit || 'unit',
                        restaurants: {},
                        total: 0
                    };
                }

                const qty = Number(item.quantity) || 0;
                itemMap[key].restaurants[restName] = (itemMap[key].restaurants[restName] || 0) + qty;
                itemMap[key].total += qty;
            });
        });

        const sortedRests = Array.from(restSet).sort();
        setRestaurants(sortedRests);

        // Update Column Visibility retaining existing preferences
        setVisibleColumns(prev => {
            const nextVisibility = { ...prev };
            sortedRests.forEach(r => {
                if (nextVisibility[r] === undefined) {
                    nextVisibility[r] = true; // Auto-check new columns
                }
            });
            if (nextVisibility['Total'] === undefined) nextVisibility['Total'] = true;
            return nextVisibility;
        });

        const grouped = {};
        Array.from(catSet).sort().forEach(c => grouped[c] = []);

        Object.values(itemMap).forEach(row => {
            grouped[row.category].push({
                ...row,
                restaurants: sortedRests.map(r => row.restaurants[r] || 0)
            });
        });

        Object.keys(grouped).forEach(cat => {
            grouped[cat].sort((a, b) => a.itemName.localeCompare(b.itemName));
        });

        setCategories(grouped);

        // Flatten for export
        const flatData = [];
        Object.keys(grouped).forEach(cat => {
            grouped[cat].forEach(row => {
                flatData.push(row);
            });
        });
        setGridData(flatData);
    };

    const handleExport = async (type) => {
        if (!gridData.length) {
            toast.error('No data to export');
            return;
        }

        // Use filtered restaurants based on visibility
        const activeRestaurants = restaurants.filter(r => visibleColumns[r]);

        // Rebuild data structure expected by orderExportService.js
        const exportCategorizedItems = {};
        const exportMatrix = {};
        const exportItemTotals = {};

        Object.entries(categories).forEach(([cat, items]) => {
            exportCategorizedItems[cat] = items.map(it => ({
                item_name: it.itemName,
                unit: it.unit
            }));

            items.forEach(it => {
                exportItemTotals[it.itemName] = it.total;
                // it.restaurants is an array parallel to `restaurants` state
                it.restaurants.forEach((qty, idx) => {
                    const rName = restaurants[idx];
                    exportMatrix[`${it.itemName}::${rName}`] = qty;
                });
            });
        });

        const customData = {
            categorizedItems: exportCategorizedItems,
            restaurants: activeRestaurants,
            matrix: exportMatrix,
            itemTotals: exportItemTotals
        };

        try {
            switch (type) {
                case 'pdf': downloadPDF(customData); break;
                case 'excel': downloadExcel(customData); break;
                case 'dispatch_pdf': downloadDispatchPDF(customData); break;
                case 'dispatch_excel': downloadDispatchExcel(customData); break;
                default: break;
            }
            toast.success('Export downloaded');
            setExportOpen(false);
        } catch (err) {
            console.error('Export error:', err);
            toast.error('Export failed');
        }
    };

    const toggleColumn = (col) => {
        setVisibleColumns(prev => ({
            ...prev,
            [col]: !prev[col]
        }));
    };

    // --- restored List View Handlers ---
    const toggleSelect = (id) => {
        setSelectedIds(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

    const toggleSelectAll = (filteredList) => {
        if (selectedIds.size === filteredList.length) {
            setSelectedIds(new Set());
        } else {
            setSelectedIds(new Set(filteredList.map(o => o.id)));
        }
    };

    const handleBulkReady = async () => {
        if (selectedIds.size === 0) {
            toast.error('No orders selected');
            return;
        }

        // Filter out orders that are already ready_for_pickup
        const pendingIds = [...selectedIds].filter(id => {
            const order = orders.find(o => o.id === id);
            return order && order.status === 'pending';
        });
        const alreadyReadyCount = selectedIds.size - pendingIds.length;

        if (pendingIds.length === 0) {
            toast('All selected orders are already marked as ready for pickup', { icon: 'ℹ️' });
            setSelectedIds(new Set());
            return;
        }

        setBulkLoading(true);
        try {
            const results = await bulkMarkReady(pendingIds);
            const successCount = results.filter(r => r.success).length;
            const failCount = results.filter(r => !r.success).length;

            if (successCount > 0) {
                toast.success(`${successCount} order(s) marked ready for pickup`);
            }
            if (alreadyReadyCount > 0) {
                toast(`${alreadyReadyCount} order(s) already marked as ready`, { icon: 'ℹ️' });
            }
            if (failCount > 0) {
                toast.error(`${failCount} order(s) failed to process`);
            }

            setSelectedIds(new Set());
            await loadOrders();
        } catch (err) {
            toast.error('Bulk operation failed');
        } finally {
            setBulkLoading(false);
        }
    };

    const handleCancel = async () => {
        if (!cancelModal) return;
        try {
            await cancelOrder(cancelModal.id, cancelReason);
            toast.success('Order cancelled');
            setCancelModal(null);
            setCancelReason('');
            await loadOrders();
        } catch (err) {
            toast.error(err.message || 'Failed to cancel order');
        }
    };

    const formatDate = (date) => {
        if (!date) return '—';
        const d = date instanceof Date ? date : new Date(date);
        if (isNaN(d.getTime())) return '—';
        return d.toLocaleDateString('en-GB', {
            day: '2-digit', month: 'short', year: 'numeric',
        });
    };

    const formatDateTime = (date) => {
        if (!date) return '—';
        const d = date instanceof Date ? date : new Date(date);
        if (isNaN(d.getTime())) return '—';
        return d.toLocaleDateString('en-GB', {
            day: '2-digit', month: 'short', year: 'numeric',
            hour: '2-digit', minute: '2-digit',
        });
    };
    // -----------------------------------

    // Status helper for colored badges
    const getStatusConfig = (status) => {
        const configs = {
            pending: { label: 'Pending', color: '#f59e0b', bg: 'rgba(245,158,11,0.15)', icon: '⏳' },
            ready_for_pickup: { label: 'Ready for Pickup', color: '#22c55e', bg: 'rgba(34,197,94,0.15)', icon: '✅' },
            out_for_delivery: { label: 'Out for Delivery', color: '#3b82f6', bg: 'rgba(59,130,246,0.15)', icon: '🚚' },
            delivered: { label: 'Delivered', color: '#10b981', bg: 'rgba(16,185,129,0.15)', icon: '📦' },
            cancelled: { label: 'Cancelled', color: '#ef4444', bg: 'rgba(239,68,68,0.15)', icon: '❌' },
            completed: { label: 'Completed', color: '#6366f1', bg: 'rgba(99,102,241,0.15)', icon: '🏁' },
        };
        return configs[status] || { label: status, color: '#94a3b8', bg: 'rgba(148,163,184,0.15)', icon: '•' };
    };

    // Sub-components
    const renderToolbar = () => (
        <div className="orders-toolbar">
            <div className="toolbar-left">
                <div className="view-toggle-group">
                    <button
                        className={`view-toggle-btn ${viewMode === 'grid' ? 'active' : ''}`}
                        onClick={() => setViewMode('grid')}
                    >
                        <MdViewModule /> Grid Pivot
                    </button>
                    <button
                        className={`view-toggle-btn ${viewMode === 'list' ? 'active' : ''}`}
                        onClick={() => setViewMode('list')}
                    >
                        <MdViewList /> Orders List
                    </button>
                </div>

                <div className="search-box">
                    <MdSearch />
                    <input
                        type="text"
                        placeholder="Search items or orders..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                    />
                </div>
            </div>

            <div className="toolbar-right">
                <div className="filter-group">
                    <select
                        className="date-select"
                        value={dateRange}
                        onChange={(e) => setDateRange(e.target.value)}
                    >
                        {DATE_RANGES.map(r => (
                            <option key={r.value} value={r.value}>{r.label}</option>
                        ))}
                    </select>
                    {dateRange === 'custom' && (
                        <div className="custom-date-inputs">
                            <input type="date" value={customStartDate} onChange={e => setCustomStartDate(e.target.value)} />
                            <span>-</span>
                            <input type="date" value={customEndDate} onChange={e => setCustomEndDate(e.target.value)} />
                        </div>
                    )}
                </div>

                {viewMode === 'grid' && (
                    <div style={{ position: 'relative' }} onClick={e => e.stopPropagation()}>
                        <button className="btn btn-secondary styled-btn" onClick={(e) => {
                            e.stopPropagation();
                            setColumnMenuOpen(!columnMenuOpen);
                            setExportOpen(false);
                        }}>
                            <MdViewColumn /> Columns
                        </button>
                        {columnMenuOpen && (
                            <div className="dropdown-menu column-dropdown">
                                <div className="dropdown-header">Visible Columns</div>
                                {restaurants.map(r => (
                                    <label key={r} className="dropdown-item checkbox-label">
                                        <input
                                            type="checkbox"
                                            checked={visibleColumns[r] !== false}
                                            onChange={() => toggleColumn(r)}
                                        />
                                        {r}
                                    </label>
                                ))}
                                <div className="export-divider"></div>
                                <label className="dropdown-item checkbox-label">
                                    <input
                                        type="checkbox"
                                        checked={visibleColumns['Total'] !== false}
                                        onChange={() => toggleColumn('Total')}
                                    />
                                    Total Quantity
                                </label>
                            </div>
                        )}
                    </div>
                )}

                <div className="export-dropdown-container" onClick={e => e.stopPropagation()}>
                    <button className="btn btn-secondary styled-btn primary-outline" onClick={(e) => {
                        e.stopPropagation();
                        setExportOpen(!exportOpen);
                        setColumnMenuOpen(false);
                    }}>
                        <MdFileDownload /> Export
                    </button>
                    {exportOpen && (
                        <div className="dropdown-menu export-menu active">
                            <div className="export-section-label">Download</div>
                            <button className="dropdown-item" onClick={() => handleExport('pdf')}>
                                <MdFileDownload /> Download PDF
                            </button>
                            <button className="dropdown-item" onClick={() => handleExport('excel')}>
                                <MdFileDownload /> Download Excel
                            </button>
                            <div className="export-divider"></div>
                            <div className="export-section-label">Dispatch</div>
                            <button className="dropdown-item" onClick={() => handleExport('dispatch_pdf')}>
                                <MdLocalShipping /> Dispatch PDF
                            </button>
                            <button className="dropdown-item" onClick={() => handleExport('dispatch_excel')}>
                                <MdLocalShipping /> Dispatch Excel
                            </button>
                        </div>
                    )}
                </div>

                <button className="btn-refresh" onClick={loadOrders} disabled={loading}><MdRefresh className={loading ? 'spin' : ''} /></button>
            </div>
        </div>
    );

    const renderGridView = () => {
        // Filter purely over rendering items by search query
        const hasData = Object.keys(categories).length > 0;

        let grandTotals = new Array(restaurants.length).fill(0);
        let finalGrandTotal = 0;

        return (
            <div className="orders-table-wrapper">
                <table className="data-table pivot-table">
                    <thead>
                        <tr>
                            <th className="sticky-col">Category / Item</th>
                            <th>Unit</th>
                            {restaurants.map((r, i) => visibleColumns[r] && (
                                <th key={i}>{r}</th>
                            ))}
                            {visibleColumns['Total'] && <th>Total Qty</th>}
                        </tr>
                    </thead>
                    <tbody>
                        {!hasData && (
                            <tr><td colSpan={10} className="empty-state">No items found for the selected dates.</td></tr>
                        )}
                        {Object.entries(categories).map(([cat, items]) => {
                            const filteredItems = items.filter(it =>
                                it.itemName.toLowerCase().includes(searchQuery.toLowerCase())
                            );
                            if (filteredItems.length === 0) return null;

                            // Category totals
                            const catTotals = new Array(restaurants.length).fill(0);
                            let catGrandTotal = 0;

                            filteredItems.forEach(item => {
                                item.restaurants.forEach((qty, idx) => {
                                    catTotals[idx] += qty;
                                    grandTotals[idx] += qty;
                                });
                                catGrandTotal += item.total;
                                finalGrandTotal += item.total;
                            });

                            return (
                                <React.Fragment key={cat}>
                                    <tr className="category-row">
                                        <td className="sticky-col">{cat}</td>
                                    </tr>
                                    {filteredItems.map((item, idx) => (
                                        <tr key={`${cat}-${idx}`}>
                                            <td className="sticky-col item-name-cell">{item.itemName}</td>
                                            <td className="unit-cell">{item.unit}</td>
                                            {item.restaurants.map((qty, i) => visibleColumns[restaurants[i]] && (
                                                <td key={i} className={qty > 0 ? 'has-qty' : 'no-qty'}>
                                                    {qty || '-'}
                                                </td>
                                            ))}
                                            {visibleColumns['Total'] && <td className="total-qty-cell">{item.total || '-'}</td>}
                                        </tr>
                                    ))}
                                </React.Fragment>
                            );
                        })}
                    </tbody>
                    {hasData && (
                        <tfoot>
                            <tr className="grand-total-row">
                                <td className="sticky-col">GRAND TOTAL</td>
                                <td></td>
                                {restaurants.map((r, i) => visibleColumns[r] && (
                                    <td key={i}>{grandTotals[i] || '-'}</td>
                                ))}
                                {visibleColumns['Total'] && <td>{finalGrandTotal || '-'}</td>}
                            </tr>
                        </tfoot>
                    )}
                </table>
            </div>
        );
    };

    // We can restore ListView logic here as well
    const renderListView = () => {
        const filteredList = orders.filter(o =>
            (activeStatus === 'all' || o.status === activeStatus) &&
            (o.order_number?.toLowerCase().includes(searchQuery.toLowerCase()) ||
                o.restaurant_name?.toLowerCase().includes(searchQuery.toLowerCase()))
        );

        return (
            <div className="orders-list-view">
                <div className="orders-status-tabs" style={{ marginBottom: 'var(--space-4)' }}>
                    <button className={`status-tab ${activeStatus === 'all' ? 'active' : ''}`} onClick={() => setActiveStatus('all')}>
                        All
                    </button>
                    {ORDER_STATUSES.map(s => (
                        <button key={s.value} className={`status-tab ${activeStatus === s.value ? 'active' : ''}`} onClick={() => setActiveStatus(s.value)}>
                            {s.label}
                        </button>
                    ))}
                </div>

                {selectedIds.size > 0 && (
                    <div className="bulk-toolbar">
                        <div className="bulk-toolbar-info">
                            <MdCheckBox style={{ color: 'var(--color-primary)' }} /> <strong>{selectedIds.size}</strong> order(s) selected
                        </div>
                        <div className="bulk-toolbar-actions">
                            <button
                                className="btn btn-primary"
                                onClick={handleBulkReady}
                                disabled={bulkLoading}
                                style={{ display: 'flex', alignItems: 'center', gap: 6 }}
                            >
                                <MdLocalShipping /> {bulkLoading ? 'Processing...' : 'Mark as Ready for Pickup'}
                            </button>
                            <button
                                className="btn btn-secondary"
                                onClick={() => setSelectedIds(new Set())}
                                style={{ display: 'flex', alignItems: 'center', gap: 6 }}
                            >
                                <MdClose /> Clear Selection
                            </button>
                        </div>
                    </div>
                )}

                <div className="orders-table-wrapper">
                    <table className="data-table">
                        <thead>
                            <tr>
                                <th style={{ width: 40 }}>
                                    <span style={{ cursor: 'pointer' }} onClick={() => toggleSelectAll(filteredList)}>
                                        {selectedIds.size === filteredList.length && filteredList.length > 0
                                            ? <MdCheckBox size={20} />
                                            : <MdCheckBoxOutlineBlank size={20} />
                                        }
                                    </span>
                                </th>
                                <th>ORDER #</th>
                                <th>RESTAURANT</th>
                                <th>DATE</th>
                                <th>ITEMS</th>
                                <th>STATUS</th>
                                <th>SUBTOTAL</th>
                                <th>VAT</th>
                                <th>TOTAL</th>
                                <th>ACTIONS</th>
                            </tr>
                        </thead>
                        <tbody>
                            {filteredList.length === 0 ? (
                                <tr>
                                    <td colSpan="10">
                                        <div className="empty-state">
                                            <span style={{ fontSize: 40 }}>✅</span>
                                            <p>No orders found for the selected filters.</p>
                                        </div>
                                    </td>
                                </tr>
                            ) : (
                                filteredList.map(order => {
                                    const isSelected = selectedIds.has(order.id);
                                    const itemPreview = order.items?.map(i => i.item_name).join(', ') || '';

                                    return (
                                        <tr
                                            key={order.id}
                                            className={isSelected ? 'order-row-selected' : ''}
                                        >
                                            <td>
                                                <span style={{ cursor: 'pointer' }} onClick={() => toggleSelect(order.id)}>
                                                    {isSelected
                                                        ? <MdCheckBox size={20} style={{ color: 'var(--color-primary)' }} />
                                                        : <MdCheckBoxOutlineBlank size={20} />
                                                    }
                                                </span>
                                            </td>
                                            <td>
                                                <strong>{order.order_number}</strong>
                                            </td>
                                            <td>{order.restaurant_name || '—'}</td>
                                            <td>{formatDate(order.created_at)}</td>
                                            <td>
                                                <div>{order.item_count || order.items?.length || 0} item(s)</div>
                                                <div className="order-items-preview" style={{ fontSize: '0.8em', color: 'var(--color-text-tertiary)', maxWidth: 200, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{itemPreview}</div>
                                            </td>
                                            <td>
                                                {(() => {
                                                    const sc = getStatusConfig(order.status);
                                                    return (
                                                        <span style={{
                                                            display: 'inline-flex', alignItems: 'center', gap: 4,
                                                            padding: '4px 10px', borderRadius: 20,
                                                            fontSize: '0.78em', fontWeight: 600,
                                                            color: sc.color, background: sc.bg,
                                                            whiteSpace: 'nowrap',
                                                        }}>
                                                            {sc.icon} {sc.label}
                                                        </span>
                                                    );
                                                })()}
                                            </td>
                                            <td>£{(order.subtotal || 0).toFixed(2)}</td>
                                            <td>£{(order.vat_amount || 0).toFixed(2)}</td>
                                            <td><strong>£{(order.total || 0).toFixed(2)}</strong></td>
                                            <td>
                                                <div className="action-btns">
                                                    <button
                                                        className="btn-action"
                                                        title="View Details"
                                                        onClick={(e) => { e.stopPropagation(); setDetailOrder(order); }}
                                                    >
                                                        <MdVisibility />
                                                    </button>
                                                    {order.status !== 'cancelled' && order.status !== 'completed' && (
                                                        <button
                                                            className="btn-action delete"
                                                            title="Cancel Order"
                                                            onClick={(e) => { e.stopPropagation(); setCancelModal(order); }}
                                                        >
                                                            <MdCancel />
                                                        </button>
                                                    )}
                                                </div>
                                            </td>
                                        </tr>
                                    );
                                })
                            )}
                        </tbody>
                    </table>
                </div>

                {/* ─── Order Detail Modal ─── */}
                {detailOrder && (() => {
                    const sc = getStatusConfig(detailOrder.status);
                    return (
                        <div className="modal-overlay" onClick={() => setDetailOrder(null)}>
                            <div className="modal modal-lg" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 820, borderRadius: 16 }}>
                                {/* Header */}
                                <div className="modal-header" style={{ borderBottom: '1px solid var(--color-border)', padding: '20px 24px' }}>
                                    <div>
                                        <h2 style={{ margin: 0, fontSize: '1.25rem' }}>Order {detailOrder.order_number}</h2>
                                        <span style={{ fontSize: '0.85em', color: 'var(--color-text-secondary)' }}>{detailOrder.restaurant_name}</span>
                                    </div>
                                    <button className="btn btn-icon" onClick={() => setDetailOrder(null)} style={{ background: 'var(--color-surface-hover)', borderRadius: '50%', width: 36, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center', border: 'none', cursor: 'pointer' }}>
                                        <MdClose size={20} color='white' />
                                    </button>
                                </div>

                                {/* Body */}
                                <div className="modal-body" style={{ padding: '10px 12px', }}>
                                    {/* Info Cards */}
                                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12, marginBottom: 24 }}>
                                        <div style={{ background: sc.bg, borderRadius: 10, padding: '12px 16px' }}>
                                            <div style={{ fontSize: '0.75em', color: 'var(--color-text-tertiary)', marginBottom: 4 }}>Status</div>
                                            <div style={{ fontWeight: 700, color: sc.color, display: 'flex', alignItems: 'center', gap: 6 }}>{sc.icon} {sc.label}</div>
                                        </div>
                                        <div style={{ background: 'var(--color-surface-hover)', borderRadius: 10, padding: '12px 16px' }}>
                                            <div style={{ fontSize: '0.75em', color: 'var(--color-text-tertiary)', marginBottom: 4 }}>Order Date</div>
                                            <div style={{ fontWeight: 600 }}>{formatDateTime(detailOrder.created_at)}</div>
                                        </div>
                                        <div style={{ background: 'var(--color-surface-hover)', borderRadius: 10, padding: '12px 16px' }}>
                                            <div style={{ fontSize: '0.75em', color: 'var(--color-text-tertiary)', marginBottom: 4 }}>Total Items</div>
                                            <div style={{ fontWeight: 600 }}>{detailOrder.item_count || detailOrder.items?.length || 0}</div>
                                        </div>
                                        <div style={{ background: 'var(--color-surface-hover)', borderRadius: 10, padding: '12px 16px' }}>
                                            <div style={{ fontSize: '0.75em', color: 'var(--color-text-tertiary)', marginBottom: 4 }}>Grand Total</div>
                                            <div style={{ fontWeight: 700, fontSize: '1.1em', color: 'var(--color-primary)' }}>£{(detailOrder.total || 0).toFixed(2)}</div>
                                        </div>
                                    </div>

                                    {detailOrder.notes && (
                                        <div style={{ background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.3)', borderRadius: 8, padding: '10px 14px', marginBottom: 20, fontSize: '0.9em' }}>
                                            <strong style={{ color: '#f59e0b' }}>Notes:</strong> {detailOrder.notes}
                                        </div>
                                    )}

                                    {/* Items Table */}
                                    <div style={{ border: '1px solid var(--color-border)', borderRadius: 10, overflowX: 'auto' }}>
                                        <table className="data-table" style={{ margin: 0 }}>
                                            <thead>
                                                <tr>
                                                    <th>Item</th>
                                                    <th>Type</th>
                                                    <th style={{ textAlign: 'center' }}>Qty</th>
                                                    <th>Unit</th>
                                                    <th style={{ textAlign: 'right' }}>Price</th>
                                                    <th style={{ textAlign: 'right' }}>VAT</th>
                                                    <th style={{ textAlign: 'right' }}>Total</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {detailOrder.items?.map((item, idx) => (
                                                    <tr key={idx}>
                                                        <td><strong>{item.item_name}</strong></td>
                                                        <td style={{ opacity: 0.7 }}>{item.item_type || '—'}</td>
                                                        <td style={{ textAlign: 'center', fontWeight: 600 }}>{item.quantity}</td>
                                                        <td>{item.unit}</td>
                                                        <td style={{ textAlign: 'right' }}>£{(item.selling_price || 0).toFixed(2)}</td>
                                                        <td style={{ textAlign: 'right', opacity: 0.7 }}>{item.vat_rate || 0}%</td>
                                                        <td style={{ textAlign: 'right', fontWeight: 600 }}>£{(item.line_total || 0).toFixed(2)}</td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                            <tfoot>
                                                <tr style={{ borderTop: '1px solid var(--color-border)' }}>
                                                    <td colSpan="6" style={{ textAlign: 'right', opacity: 0.7 }}>Subtotal</td>
                                                    <td style={{ textAlign: 'right' }}>£{(detailOrder.subtotal || 0).toFixed(2)}</td>
                                                </tr>
                                                <tr>
                                                    <td colSpan="6" style={{ textAlign: 'right', opacity: 0.7 }}>VAT</td>
                                                    <td style={{ textAlign: 'right' }}>£{(detailOrder.vat_amount || 0).toFixed(2)}</td>
                                                </tr>
                                                <tr style={{ borderTop: '2px solid var(--color-border)' }}>
                                                    <td colSpan="6" style={{ textAlign: 'right', fontWeight: 700, fontSize: '1.05em' }}>Total</td>
                                                    <td style={{ textAlign: 'right', fontWeight: 700, fontSize: '1.05em', color: 'var(--color-primary)' }}>£{(detailOrder.total || 0).toFixed(2)}</td>
                                                </tr>
                                            </tfoot>
                                        </table>
                                    </div>
                                </div>

                                {/* Footer */}
                                <div className="modal-footer" style={{ borderTop: '1px solid var(--color-border)', padding: '16px 24px', display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
                                    <button className="btn btn-secondary" onClick={() => setDetailOrder(null)} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '10px' }}>
                                        Close
                                    </button>
                                    {detailOrder.status === 'pending' && (
                                        <button
                                            className="btn btn-primary"
                                            style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '10px' }}
                                            disabled={markReadyLoading}
                                            onClick={async () => {
                                                setMarkReadyLoading(true);
                                                try {
                                                    await bulkMarkReady([detailOrder.id]);
                                                    toast.success('Order marked as ready for pickup');
                                                    setDetailOrder(null);
                                                    await loadOrders();
                                                } catch (err) {
                                                    toast.error('Failed to update order');
                                                } finally {
                                                    setMarkReadyLoading(false);
                                                }
                                            }}
                                        >
                                            <MdLocalShipping /> {markReadyLoading ? 'Processing...' : 'Mark Ready for Pickup'}
                                        </button>
                                    )}
                                </div>
                            </div>
                        </div>
                    );
                })()}

                {/* ─── Cancel Modal ─── */}
                {cancelModal && (
                    <div className="modal-overlay" onClick={() => setCancelModal(null)}>
                        <div className="modal modal-md" onClick={(e) => e.stopPropagation()}>
                            <div className="modal-header">
                                <h2>Cancel Order {cancelModal.order_number}</h2>
                                <button className="btn btn-icon" onClick={() => setCancelModal(null)}>
                                    <MdClose />
                                </button>
                            </div>
                            <div className="modal-body">
                                <p style={{ marginBottom: 'var(--space-4)', color: 'var(--color-text-secondary)' }}>
                                    Are you sure you want to cancel this order from <strong>{cancelModal.restaurant_name}</strong>?
                                    This action cannot be undone.
                                </p>
                                <div className="form-group">
                                    <label>Reason (optional)</label>
                                    <textarea
                                        value={cancelReason}
                                        onChange={(e) => setCancelReason(e.target.value)}
                                        placeholder="Enter cancellation reason..."
                                        rows={3}
                                    />
                                </div>
                            </div>
                            <div className="modal-footer" style={{ borderTop: '1px solid var(--color-border)', padding: '16px 24px', display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
                                <button className="btn btn-secondary" onClick={() => setCancelModal(null)} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px' }}>
                                    Keep Order
                                </button>
                                <button className="btn btn-danger" onClick={handleCancel} style={{ display: 'flex', alignItems: 'center', gap: 6, background: '#ef4444', color: 'white', border: 'none', padding: '8px 16px', borderRadius: 8, fontWeight: 600, cursor: 'pointer' }}>
                                    <MdCancel /> Cancel Order
                                </button>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        );
    };

    return (
        <div className="page-content" onClick={() => { setExportOpen(false); setColumnMenuOpen(false); }}>
            <div className="page-header">
                <div>
                    <h1 className="page-title">Today's Orders</h1>
                    <p className="page-subtitle">Unified view of incoming restaurant demands</p>
                </div>
            </div>

            {renderToolbar()}

            {loading ? (
                <div className="loading-state">Loading orders...</div>
            ) : (
                viewMode === 'grid' ? renderGridView() : renderListView()
            )}
        </div>
    );
};

export default TodaysOrders;
