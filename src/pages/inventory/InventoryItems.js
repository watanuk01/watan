import React, { useState, useEffect, useCallback } from 'react';
import Pagination from '../../components/common/Pagination';
import {
    getItems,
    getCategories,
    deleteItem,
    getItemDependencies,
    cleanupOldCategories,
    toggleItemEnabled,
    ITEM_TYPES,
    UNITS,
    resolveToBaseUnit,
    getConversionSummary,
} from '../../services/inventoryService';
import GroceryItemForm from './GroceryItemForm';
import RawMeatItemForm from './RawMeatItemForm';
import CookedMeatItemForm from './CookedMeatItemForm';
import CategoryManager from './CategoryManager';
import {
    MdAdd,
    MdEdit,
    MdDelete,
    MdSearch,
    MdRefresh,
    MdGridView,
    MdViewList,
    MdCategory,
    MdInventory2,
    MdCheckCircle,
    MdClose,
    MdWarning,
} from 'react-icons/md';
import toast from 'react-hot-toast';
import './Inventory.css';

const InventoryItems = () => {
    const [items, setItems] = useState([]);
    const [categories, setCategories] = useState([]);
    const [loading, setLoading] = useState(true);
    const [searchQuery, setSearchQuery] = useState('');
    const [activeType, setActiveType] = useState('grocery');
    const [selectedCategory, setSelectedCategory] = useState('all');
    const [viewMode, setViewMode] = useState('table');
    const [showItemModal, setShowItemModal] = useState(false);
    const [editingItem, setEditingItem] = useState(null);
    const [showCategoryManager, setShowCategoryManager] = useState(false);
    const [deleteConfirm, setDeleteConfirm] = useState(null);
    const [deleteModal, setDeleteModal] = useState(null); // { item, dependencies, loading }
    const [deleting, setDeleting] = useState(false);
    const [actionMenuId, setActionMenuId] = useState(null);
    const [togglingId, setTogglingId] = useState(null);
    const [currentPage, setCurrentPage] = useState(1);
    const [itemsPerPage, setItemsPerPage] = useState(10);

    // One-time: clean up legacy categories (no item_type)
    useEffect(() => {
        cleanupOldCategories().catch(() => { });
    }, []);

    // Load categories for active type
    const loadCategories = useCallback(async () => {
        try {
            const cats = await getCategories(activeType);
            setCategories(cats);
        } catch (err) {
            console.error('Failed to load categories:', err);
        }
    }, [activeType]);

    useEffect(() => {
        loadCategories();
        setSelectedCategory('all');
    }, [loadCategories]);

    // Load items for active type + optional category filter
    const loadItems = useCallback(async () => {
        setLoading(true);
        try {
            const filters = { item_type: activeType };
            if (selectedCategory !== 'all') {
                filters.category_id = selectedCategory;
            }
            const data = await getItems(filters);
            setItems(data);
        } catch (err) {
            toast.error('Failed to load items');
        } finally {
            setLoading(false);
        }
    }, [activeType, selectedCategory]);

    useEffect(() => {
        loadItems();
    }, [loadItems]);

    // Open delete modal with dependency check
    const openDeleteModal = async (item) => {
        setDeleteModal({ item, dependencies: null, loading: true });
        setDeleteConfirm(null);
        setActionMenuId(null);
        try {
            const deps = await getItemDependencies(item.id);
            setDeleteModal({ item, dependencies: deps, loading: false });
        } catch (err) {
            toast.error('Failed to check dependencies');
            setDeleteModal(null);
        }
    };

    const handleDeleteItem = async (force = false) => {
        if (!deleteModal?.item) return;
        setDeleting(true);
        try {
            await deleteItem(deleteModal.item.id, { force });
            toast.success('Item deleted successfully');
            setDeleteModal(null);
            loadItems();
        } catch (err) {
            toast.error(err.message);
        } finally {
            setDeleting(false);
        }
    };

    const handleRefresh = () => {
        loadCategories();
        loadItems();
    };

    const handleItemSaved = () => {
        setShowItemModal(false);
        setEditingItem(null);
        loadItems();
    };

    const filteredItems = items.filter(item =>
        item.name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        item.sku?.toLowerCase().includes(searchQuery.toLowerCase())
    );

    // Reset page when filters change
    useEffect(() => { setCurrentPage(1); }, [searchQuery, activeType, selectedCategory]);

    // Paginate
    const paginatedItems = filteredItems.slice(
        (currentPage - 1) * itemsPerPage,
        currentPage * itemsPerPage
    );

    const activeTypeInfo = ITEM_TYPES.find(t => t.value === activeType);
    const unitLabel = (unitVal) => UNITS.find(u => u.value === unitVal)?.label || unitVal;

    // Determine which form to show
    const renderItemForm = () => {
        const props = {
            item: editingItem,
            categories: categories,
            onSubmit: handleItemSaved,
            onClose: () => { setShowItemModal(false); setEditingItem(null); },
        };

        switch (activeType) {
            case 'grocery': return <GroceryItemForm {...props} />;
            case 'raw_meat': return <RawMeatItemForm {...props} />;
            case 'cooked_meat': return <CookedMeatItemForm {...props} />;
            default: return null;
        }
    };

    const getStockStatus = (item) => {
        if (item.current_stock <= 0) return { label: 'Out of Stock', class: 'danger' };
        if (item.current_stock <= (item.low_stock_threshold || item.min_stock))
            return { label: 'Low Stock', class: 'warning' };
        return { label: 'In Stock', class: 'success' };
    };

    return (
        <div className="page-content">
            {/* Page Header */}
            <div className="page-header">
                <div>
                    <h1 className="page-title">
                        <MdInventory2 style={{ marginRight: 'var(--space-2)' }} />
                        Inventory Items
                    </h1>
                    <p className="page-subtitle">
                        {activeTypeInfo?.icon} {activeTypeInfo?.label} — {filteredItems.length} items
                        {categories.length > 0 ? ` across ${categories.length} categories` : ''}
                    </p>
                </div>
                <div style={{ display: 'flex', gap: 'var(--space-2)', flexShrink: 0 }}>
                    <button
                        className="btn btn-secondary btn-md"
                        onClick={() => setShowCategoryManager(true)}
                    >
                        <MdCategory /> Categories
                    </button>
                    <button
                        className="btn btn-primary btn-md"
                        onClick={() => { setEditingItem(null); setShowItemModal(true); }}
                    >
                        <MdAdd /> Add {activeTypeInfo?.label}
                    </button>
                </div>
            </div>

            {/* Item Type Tabs */}
            <div className="type-tabs">
                {ITEM_TYPES.map(type => (
                    <button
                        key={type.value}
                        className={`type-tab ${activeType === type.value ? 'active' : ''}`}
                        onClick={() => setActiveType(type.value)}
                        style={{
                            '--type-color': type.color,
                        }}
                    >
                        <span className="type-tab-icon">{type.icon}</span>
                        <span className="type-tab-label">{type.label}</span>
                        {/* <span className="type-tab-count">
                            {items.length}
                        </span> */}
                    </button>
                ))}
            </div>

            {/* Sub-category Chips */}
            {categories.length > 0 && (
                <div className="category-chips">
                    <button
                        className={`category-chip ${selectedCategory === 'all' ? 'active' : ''}`}
                        onClick={() => setSelectedCategory('all')}
                    >
                        All
                    </button>
                    {categories.map(cat => (
                        <button
                            key={cat.id}
                            className={`category-chip ${selectedCategory === cat.id ? 'active' : ''}`}
                            onClick={() => setSelectedCategory(cat.id)}
                        >
                            {cat.icon} {cat.name}
                        </button>
                    ))}
                </div>
            )}

            {/* Search + View Controls */}
            <div className="filters-bar">
                <div className="search-input-wrap" style={{ marginBottom: 'var(--space-2)' }}>
                    {/* <MdSearch /> */}
                    <input
                        type="text"
                        className="form-input"
                        placeholder="Search by name or SKU..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                    />
                </div>
                <div style={{ display: 'flex', gap: 'var(--space-1)' }}>
                    <button
                        className={`btn btn-ghost btn-sm ${viewMode === 'table' ? 'active' : ''}`}
                        onClick={() => setViewMode('table')}
                        title="Table view"
                    >
                        <MdViewList />
                    </button>
                    <button
                        className={`btn btn-ghost btn-sm ${viewMode === 'grid' ? 'active' : ''}`}
                        onClick={() => setViewMode('grid')}
                        title="Grid view"
                    >
                        <MdGridView />
                    </button>
                    <button className="btn-refresh"
                        onClick={handleRefresh}
                        title="Refresh"
                    ><MdRefresh /></button>
                </div>
            </div>

            {/* Items Display */}
            {loading ? (
                <div className="data-table-wrapper">
                    <table className="data-table">
                        <thead>
                            <tr>
                                <th>ITEM</th>
                                <th>CATEGORY</th>
                                <th>UNIT</th>
                                <th>STOCK</th>
                                <th>COST</th>
                                <th>SELL</th>
                                <th>VAT</th>
                                {activeType !== 'cooked_meat' && <th>VENDOR</th>}
                                {activeType === 'cooked_meat' && <th>RECIPE</th>}
                                <th>STATUS</th>
                                <th>ACTIONS</th>
                            </tr>
                        </thead>
                        <tbody>
                            {[...Array(5)].map((_, i) => (
                                <tr key={i}>
                                    {[...Array(11)].map((_, j) => (
                                        <td key={j}><div className="skeleton skeleton-text"></div></td>
                                    ))}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            ) : filteredItems.length === 0 ? (
                <div className="empty-state">
                    <MdInventory2 className="empty-state-icon" />
                    <h3>No {activeTypeInfo?.label} Items</h3>
                    <p>
                        {searchQuery
                            ? `No items matching "${searchQuery}"`
                            : `Add your first ${activeTypeInfo?.label.toLowerCase()} item to get started`}
                    </p>
                    {!searchQuery && (
                        <button
                            className="btn btn-primary btn-md"
                            onClick={() => { setEditingItem(null); setShowItemModal(true); }}
                        >
                            <MdAdd /> Add {activeTypeInfo?.label}
                        </button>
                    )}
                </div>
            ) : viewMode === 'table' ? (
                <div className="data-table-wrapper">
                    <table className="data-table">
                        <thead>
                            <tr>
                                <th>ITEM</th>
                                <th>CATEGORY</th>
                                <th>UNIT</th>
                                <th>STOCK</th>
                                <th>COST</th>
                                <th>SELL</th>
                                <th>TOTAL ACTUAL</th>
                                <th>TOTAL SELL</th>
                                <th>VAT</th>
                                {activeType !== 'cooked_meat' && <th>VENDOR</th>}
                                {activeType === 'cooked_meat' && <th>RECIPE</th>}
                                <th>STATUS</th>
                                <th>ACTIONS</th>
                                <th>VISIBLE</th>
                            </tr>
                        </thead>
                        <tbody>
                            {paginatedItems.map(item => {
                                const status = getStockStatus(item);
                                const isEnabled = item.enabled !== false;
                                return (
                                    <tr key={item.id} style={isEnabled ? {} : { opacity: 0.5 }}>
                                        <td>
                                            <div>
                                                <strong style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                                    {item.name.length > 40
                                                        ? <>{item.name.substring(0, 40)}&hellip;<span
                                                            title={item.name}
                                                            style={{
                                                                display: 'inline-flex',
                                                                alignItems: 'center',
                                                                justifyContent: 'center',
                                                                width: 16,
                                                                height: 16,
                                                                borderRadius: '50%',
                                                                background: 'var(--color-primary)',
                                                                color: '#fff',
                                                                fontSize: 10,
                                                                fontWeight: 700,
                                                                cursor: 'help',
                                                                flexShrink: 0,
                                                                lineHeight: 1,
                                                            }}
                                                        >i</span></>
                                                        : item.name
                                                    }
                                                </strong>
                                                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>
                                                    {item.sku}
                                                </div>
                                            </div>
                                        </td>
                                        <td>{item.category_name || '—'}</td>
                                        <td>{unitLabel(item.unit)}</td>
                                        <td>
                                            <strong>{Math.round((item.current_stock || 0) * 100) / 100}</strong>{' '}
                                            <span style={{ fontSize: 'var(--text-xs)' }}>{item.unit}</span>
                                            {item.unit_conversion?.has_conversion && (() => {
                                                const resolved = resolveToBaseUnit(item.current_stock || 0, item);
                                                return <div className="base-unit-equiv">= {resolved.baseQuantity} {resolved.baseUnit}</div>;
                                            })()}
                                        </td>
                                        <td>£{(item.cost_price || 0).toFixed(2)}</td>
                                        <td>£{(item.selling_price || 0).toFixed(2)}</td>
                                        <td style={{ fontWeight: 600 }}>£{((item.current_stock || 0) * (item.cost_price || 0)).toFixed(2)}</td>
                                        <td style={{ fontWeight: 600 }}>£{((item.current_stock || 0) * (item.selling_price || 0)).toFixed(2)}</td>
                                        <td>
                                            {item.vat_exempt ? (
                                                <span className="badge badge-muted">Exempt</span>
                                            ) : (
                                                <span className="badge badge-info">{item.vat_rate ?? 20}%</span>
                                            )}
                                        </td>
                                        {activeType !== 'cooked_meat' && (
                                            <td>{item.vendor || '—'}</td>
                                        )}
                                        {activeType === 'cooked_meat' && (
                                            <td>
                                                {item.recipe?.ingredients?.length > 0 ? (
                                                    <span className="badge badge-info">
                                                        {item.recipe.ingredients.length} ingredients
                                                    </span>
                                                ) : (
                                                    <span className="badge badge-warning">No recipe</span>
                                                )}
                                            </td>
                                        )}
                                        <td>
                                            <span className={`badge badge-${status.class}`}>
                                                {status.label}
                                            </span>
                                        </td>
                                        <td>
                                            <div className="action-btns">
                                                <button
                                                    className="btn-action"
                                                    title="Edit Item"
                                                    onClick={() => {
                                                        setEditingItem(item);
                                                        setShowItemModal(true);
                                                    }}
                                                >
                                                    <MdEdit />
                                                </button>
                                                {deleteConfirm === item.id ? (
                                                    <div style={{ display: 'flex', gap: '4px' }}>
                                                        <button
                                                            className="btn-action delete"
                                                            title="Confirm Delete"
                                                            onClick={() => openDeleteModal(item)}
                                                            style={{ background: 'var(--color-danger)', color: 'white', border: 'none' }}
                                                        >
                                                            <MdCheckCircle />
                                                        </button>
                                                        <button
                                                            className="btn-action"
                                                            title="Cancel"
                                                            onClick={() => setDeleteConfirm(null)}
                                                        >
                                                            <MdClose />
                                                        </button>
                                                    </div>
                                                ) : (
                                                    <button
                                                        className="btn-action delete"
                                                        title="Delete Item"
                                                        onClick={() => setDeleteConfirm(item.id)}
                                                    >
                                                        <MdDelete />
                                                    </button>
                                                )}
                                            </div>
                                        </td>
                                        <td>
                                            <label className={`toggle-switch ${togglingId === item.id ? 'toggle-loading' : ''}`} title={isEnabled ? 'Visible to restaurants' : 'Hidden from restaurants'}>
                                                <input
                                                    type="checkbox"
                                                    disabled={togglingId === item.id}
                                                    checked={isEnabled}
                                                    onChange={async () => {
                                                        try {
                                                            setTogglingId(item.id);
                                                            await toggleItemEnabled(item.id, !isEnabled);
                                                            await loadItems();
                                                        } catch (err) {
                                                            toast.error('Failed to update visibility');
                                                        } finally {
                                                            setTogglingId(null);
                                                        }
                                                    }}
                                                />
                                                <span className="toggle-slider"></span>
                                            </label>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            ) : (
                /* Grid View */
                <div className="inventory-grid">
                    {paginatedItems.map(item => {
                        const status = getStockStatus(item);
                        const isEnabled = item.enabled !== false;
                        return (
                            <div key={item.id} className="inventory-card" style={isEnabled ? {} : { opacity: 0.5 }}>
                                <div className="inventory-card-header">
                                    <span className={`badge badge-${status.class}`}>{status.label}</span>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                                        <label className={`toggle-switch ${togglingId === item.id ? 'toggle-loading' : ''}`} title={isEnabled ? 'Visible to restaurants' : 'Hidden from restaurants'}>
                                            <input
                                                type="checkbox"
                                                disabled={togglingId === item.id}
                                                checked={isEnabled}
                                                onChange={async () => {
                                                    try {
                                                        setTogglingId(item.id);
                                                        await toggleItemEnabled(item.id, !isEnabled);
                                                        await loadItems();
                                                    } catch (err) {
                                                        toast.error('Failed to update visibility');
                                                    } finally {
                                                        setTogglingId(null);
                                                    }
                                                }}
                                            />
                                            <span className="toggle-slider"></span>
                                        </label>
                                        <div className="action-menu-container">
                                            <button
                                                className="btn btn-ghost btn-sm"
                                                onClick={() => setActionMenuId(actionMenuId === item.id ? null : item.id)}
                                            >
                                                •••
                                            </button>
                                            {actionMenuId === item.id && (
                                                <div className="action-menu">
                                                    <button onClick={() => {
                                                        setEditingItem(item);
                                                        setShowItemModal(true);
                                                        setActionMenuId(null);
                                                    }}>
                                                        <MdEdit /> Edit
                                                    </button>
                                                    <button
                                                        onClick={() => openDeleteModal(item)}
                                                        style={{ color: 'var(--color-danger)' }}
                                                    >
                                                        <MdDelete /> Delete
                                                    </button>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </div>
                                <h4 className="inventory-card-name">{item.name}</h4>
                                <p className="inventory-card-sku">{item.sku}</p>
                                <div className="inventory-card-meta">
                                    <span>
                                        {Math.round((item.current_stock || 0) * 100) / 100} {item.unit}
                                        {item.unit_conversion?.has_conversion && (() => {
                                            const resolved = resolveToBaseUnit(item.current_stock || 0, item);
                                            return <div className="base-unit-equiv">= {resolved.baseQuantity} {resolved.baseUnit}</div>;
                                        })()}
                                    </span>
                                    <span>Cost: £{(item.cost_price || 0).toFixed(2)}/{item.unit}</span>
                                    <span>Sell: £{(item.selling_price || 0).toFixed(2)}/{item.unit}</span>
                                    <span style={{ fontWeight: 600, color: 'var(--color-success)' }}>Total: £{((item.current_stock || 0) * (item.cost_price || 0)).toFixed(2)} / £{((item.current_stock || 0) * (item.selling_price || 0)).toFixed(2)}</span>
                                </div>
                                <div className="inventory-card-footer">
                                    <span className="badge badge-muted">{item.category_name}</span>
                                    {item.vat_exempt ? (
                                        <span className="badge badge-muted">VAT Exempt</span>
                                    ) : (
                                        <span className="badge badge-info">{item.vat_rate ?? 20}% VAT</span>
                                    )}
                                </div>
                            </div>
                        );
                    })}
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

            {/* Modals */}
            {showItemModal && renderItemForm()}
            {showCategoryManager && (
                <CategoryManager
                    categories={categories}
                    activeType={activeType}
                    onClose={() => setShowCategoryManager(false)}
                    onUpdate={() => { loadCategories(); loadItems(); }}
                />
            )}

            {/* Delete Confirmation Modal */}
            {deleteModal && (
                <div className="modal-overlay" onClick={() => !deleting && setDeleteModal(null)}>
                    <div className="modal modal-md" onClick={(e) => e.stopPropagation()}>
                        <div className="modal-header">
                            <h2 style={{ color: 'var(--color-danger)' }}>
                                <MdWarning style={{ marginRight: 'var(--space-2)' }} />
                                Delete {deleteModal.item.name}?
                            </h2>
                            <button className="modal-close" onClick={() => !deleting && setDeleteModal(null)}><MdClose /></button>
                        </div>
                        <div className="modal-body">
                            {deleteModal.loading ? (
                                <div style={{ textAlign: 'center', padding: 'var(--space-6)' }}>
                                    <div className="skeleton skeleton-text" style={{ height: 20, width: '80%', margin: '0 auto var(--space-3)' }} />
                                    <div className="skeleton skeleton-text" style={{ height: 14, width: '60%', margin: '0 auto' }} />
                                    <p style={{ color: 'var(--color-text-muted)', marginTop: 'var(--space-3)' }}>Checking dependencies...</p>
                                </div>
                            ) : (
                                <>
                                    <p style={{ color: 'var(--color-text-secondary)', marginBottom: 'var(--space-4)' }}>
                                        <strong style={{ color: 'var(--color-text-primary)' }}>{deleteModal.item.name}</strong>
                                        <br />Type: {deleteModal.item.item_type?.replace('_', ' ')} · Stock: {deleteModal.item.current_stock || 0} {deleteModal.item.unit}
                                    </p>

                                    {/* Batch Warning */}
                                    {deleteModal.dependencies?.batches?.length > 0 && (
                                        <div className="delete-warning-box" style={{
                                            background: 'rgba(245, 158, 11, 0.08)',
                                            border: '1px solid rgba(245, 158, 11, 0.2)',
                                            borderRadius: 'var(--radius-md)',
                                            padding: 'var(--space-3)',
                                            marginBottom: 'var(--space-3)',
                                        }}>
                                            <p style={{ color: '#f59e0b', fontWeight: 600, marginBottom: 'var(--space-1)', fontSize: 'var(--text-sm)' }}>
                                                ⚠️ {deleteModal.dependencies.batches.length} batch{deleteModal.dependencies.batches.length > 1 ? 'es' : ''} will be deleted
                                            </p>
                                            <p style={{ color: 'var(--color-text-muted)', fontSize: 'var(--text-xs)' }}>
                                                {deleteModal.dependencies.batches.filter(b => b.status === 'available').length} active,{' '}
                                                {deleteModal.dependencies.batches.filter(b => b.status !== 'available').length} consumed/expired
                                            </p>
                                        </div>
                                    )}

                                    {/* Recipe Dependency Warning */}
                                    {deleteModal.dependencies?.usedInRecipes?.length > 0 && (
                                        <div className="delete-warning-box" style={{
                                            background: 'rgba(239, 68, 68, 0.08)',
                                            border: '1px solid rgba(239, 68, 68, 0.2)',
                                            borderRadius: 'var(--radius-md)',
                                            padding: 'var(--space-3)',
                                            marginBottom: 'var(--space-3)',
                                        }}>
                                            <p style={{ color: 'var(--color-danger)', fontWeight: 600, marginBottom: 'var(--space-1)', fontSize: 'var(--text-sm)' }}>
                                                🔗 Used as ingredient in {deleteModal.dependencies.usedInRecipes.length} recipe{deleteModal.dependencies.usedInRecipes.length > 1 ? 's' : ''}
                                            </p>
                                            <ul style={{ margin: 'var(--space-1) 0 0 var(--space-4)', padding: 0, fontSize: 'var(--text-xs)', color: 'var(--color-text-secondary)' }}>
                                                {deleteModal.dependencies.usedInRecipes.map(r => (
                                                    <li key={r.id} style={{ marginBottom: 2 }}>{r.name}</li>
                                                ))}
                                            </ul>
                                            <p style={{ color: 'var(--color-text-muted)', fontSize: 'var(--text-xs)', marginTop: 'var(--space-2)' }}>
                                                ⚠️ Deleting this item will cause production errors for the above recipes. Please update their recipes first.
                                            </p>
                                        </div>
                                    )}

                                    {/* No dependencies */}
                                    {deleteModal.dependencies?.batches?.length === 0 && deleteModal.dependencies?.usedInRecipes?.length === 0 && (
                                        <p style={{ color: 'var(--color-text-muted)', fontSize: 'var(--text-sm)' }}>
                                            ✅ No batches or recipe dependencies found. This item can be safely deleted.
                                        </p>
                                    )}
                                </>
                            )}
                        </div>
                        {!deleteModal.loading && (
                            <div className="modal-footer">
                                <button className="btn btn-secondary btn-md" onClick={() => setDeleteModal(null)} disabled={deleting}>Cancel</button>
                                {deleteModal.dependencies?.usedInRecipes?.length > 0 ? (
                                    <button
                                        className="btn btn-danger btn-md"
                                        onClick={() => handleDeleteItem(true)}
                                        disabled={deleting}
                                    >
                                        {deleting ? 'Deleting...' : 'Delete Anyway (Force)'}
                                    </button>
                                ) : deleteModal.dependencies?.batches?.length > 0 ? (
                                    <button
                                        className="btn btn-danger btn-md"
                                        onClick={() => handleDeleteItem(true)}
                                        disabled={deleting}
                                    >
                                        {deleting ? 'Deleting...' : 'Delete Item & Batches'}
                                    </button>
                                ) : (
                                    <button
                                        className="btn btn-danger btn-md"
                                        onClick={() => handleDeleteItem(false)}
                                        disabled={deleting}
                                    >
                                        {deleting ? 'Deleting...' : 'Delete Item'}
                                    </button>
                                )}
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};

export default InventoryItems;
