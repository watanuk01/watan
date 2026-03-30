import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import {
    getMenuItems,
    deleteMenuItem,
    toggleMenuItemActive,
    getMenuStats,
    MENU_CATEGORIES,
    ALLERGEN_CODES,
    getCategoryInfo,
    getAllergenInfo,
} from '../../services/menuService';
import MenuItemForm from './MenuItemForm';
import {
    MdMenuBook,
    MdAdd,
    MdRefresh,
    MdSearch,
    MdClose,
    MdEdit,
    MdDelete,
    MdVisibility,
    MdVisibilityOff,
    MdRestaurantMenu,
} from 'react-icons/md';
import toast from 'react-hot-toast';
import './Menu.css';
import './Restaurant.css';

const MenuManagement = () => {
    const { currentUser } = useAuth();
    const restaurantId = currentUser?.uid;

    const [menuItems, setMenuItems] = useState([]);
    const [loading, setLoading] = useState(true);
    const [stats, setStats] = useState(null);
    const [searchQuery, setSearchQuery] = useState('');
    const [activeCategory, setActiveCategory] = useState('all');

    // Form modal state
    const [showForm, setShowForm] = useState(false);
    const [editItem, setEditItem] = useState(null);

    // Detail modal state
    const [detailItem, setDetailItem] = useState(null);

    // Delete confirm
    const [deleteTarget, setDeleteTarget] = useState(null);
    const [deleting, setDeleting] = useState(false);

    const fetchData = useCallback(async () => {
        if (!restaurantId) return;
        setLoading(true);
        try {
            const [items, menuStats] = await Promise.all([
                getMenuItems(restaurantId, {
                    ...(activeCategory !== 'all' ? { category: activeCategory } : {}),
                }),
                getMenuStats(restaurantId),
            ]);
            setMenuItems(items);
            setStats(menuStats);
        } catch (err) {
            toast.error('Failed to load menu items');
            console.error(err);
        } finally {
            setLoading(false);
        }
    }, [restaurantId, activeCategory]);

    useEffect(() => { fetchData(); }, [fetchData]);

    // Client-side search filter
    const filteredItems = menuItems.filter(item => {
        if (!searchQuery.trim()) return true;
        const q = searchQuery.toLowerCase();
        return (
            item.name?.toLowerCase().includes(q) ||
            item.description?.toLowerCase().includes(q)
        );
    });

    // ── Handlers ──
    const handleEdit = (item) => {
        setEditItem(item);
        setShowForm(true);
    };

    const handleAdd = () => {
        setEditItem(null);
        setShowForm(true);
    };

    const handleToggleActive = async (item) => {
        try {
            const newState = await toggleMenuItemActive(item.id);
            toast.success(`"${item.name}" ${newState ? 'activated' : 'deactivated'}`);
            fetchData();
        } catch (err) {
            toast.error('Failed to toggle status');
        }
    };

    const handleDelete = async () => {
        if (!deleteTarget) return;
        setDeleting(true);
        try {
            await deleteMenuItem(deleteTarget.id);
            toast.success(`"${deleteTarget.name}" deleted`);
            setDeleteTarget(null);
            fetchData();
        } catch (err) {
            toast.error('Failed to delete');
        } finally {
            setDeleting(false);
        }
    };

    const getPriceRange = (portions) => {
        if (!portions?.length) return '—';
        const prices = portions.map(p => Number(p.selling_price ?? p.price) || 0).filter(p => p > 0);
        if (prices.length === 0) return '—';
        const min = Math.min(...prices);
        const max = Math.max(...prices);
        if (min === max) return `£${min.toFixed(2)}`;
        return `£${min.toFixed(2)} – £${max.toFixed(2)}`;
    };

    return (
        <div className="page-content">
            <div className="page-header">
                <div>
                    <h1 className="page-title">
                        <MdMenuBook style={{ marginRight: 'var(--space-2)' }} />
                        Menu Management
                    </h1>
                    <p className="page-subtitle">
                        {stats ? `${stats.totalItems} items · ${stats.activeItems} active · ${stats.categoriesUsed} categories` : 'Loading...'}
                    </p>
                </div>
                <div style={{ display: 'flex', gap: 'var(--space-3)' }}>
                    <button className="btn-refresh" onClick={fetchData} title="Refresh"><MdRefresh /></button>
                    <button className="btn btn-primary btn-md" onClick={handleAdd}>
                        <MdAdd /> Add Menu Item
                    </button>
                </div>
            </div>

            {/* Stats Cards */}
            {stats && (
                <div style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
                    gap: 'var(--space-4)',
                    marginBottom: 'var(--space-5)',
                }}>
                    {[
                        { label: 'Total Items', value: stats.totalItems, color: 'var(--color-text-primary)' },
                        { label: 'Active', value: stats.activeItems, color: '#22c55e' },
                        { label: 'Categories', value: stats.categoriesUsed, color: 'var(--color-primary)' },
                        { label: 'Missing Recipes', value: stats.withoutRecipe, color: stats.withoutRecipe > 0 ? '#f59e0b' : '#22c55e' },
                    ].map((stat, i) => (
                        <div key={i} style={{
                            background: 'var(--color-surface)',
                            border: '1px solid var(--color-border)',
                            borderRadius: 'var(--radius-lg)',
                            padding: 'var(--space-4)',
                        }}>
                            <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 4 }}>
                                {stat.label}
                            </div>
                            <div style={{ fontSize: 'var(--text-2xl)', fontWeight: 700, color: stat.color }}>
                                {stat.value}
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {/* Category Tabs */}
            <div className="type-tabs" style={{ marginBottom: 'var(--space-4)' }}>
                <button
                    className={`type-tab ${activeCategory === 'all' ? 'active' : ''}`}
                    onClick={() => setActiveCategory('all')}
                    style={{ '--type-color': 'var(--color-primary)' }}
                >
                    All ({stats?.totalItems || 0})
                </button>
                {MENU_CATEGORIES.map(cat => (
                    <button
                        key={cat.value}
                        className={`type-tab ${activeCategory === cat.value ? 'active' : ''}`}
                        onClick={() => setActiveCategory(cat.value)}
                        style={{ '--type-color': 'var(--color-primary)' }}
                    >
                        {cat.icon} {cat.label} ({stats?.byCategory?.[cat.value] || 0})
                    </button>
                ))}
            </div>

            {/* Search */}
            <div className="search-bar" style={{ marginBottom: 'var(--space-5)' }}>
                <MdSearch className="search-icon" />
                <input
                    className="search-input"
                    placeholder="Search menu items..."
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                />
                {searchQuery && (
                    <button className="search-clear" onClick={() => setSearchQuery('')}>
                        <MdClose />
                    </button>
                )}
            </div>

            {/* Menu Items Grid */}
            {loading ? (
                <div className="menu-card-grid">
                    {Array.from({ length: 6 }).map((_, i) => (
                        <div key={i} className="menu-card">
                            <div className="skeleton skeleton-text" style={{ width: '40%', height: 14, marginBottom: 8 }} />
                            <div className="skeleton skeleton-text" style={{ width: '80%', height: 20, marginBottom: 12 }} />
                            <div className="skeleton skeleton-text" style={{ width: '60%', height: 14, marginBottom: 16 }} />
                            <div className="skeleton skeleton-text" style={{ width: '50%', height: 14 }} />
                        </div>
                    ))}
                </div>
            ) : filteredItems.length === 0 ? (
                <div className="menu-empty">
                    <div className="menu-empty-icon">
                        <MdRestaurantMenu />
                    </div>
                    <h3 style={{ color: 'var(--color-text-secondary)', marginBottom: 'var(--space-2)' }}>
                        {menuItems.length === 0 ? 'No Menu Items Yet' : 'No items match your search'}
                    </h3>
                    <p style={{ color: 'var(--color-text-muted)', fontSize: 'var(--text-sm)', marginBottom: 'var(--space-4)' }}>
                        {menuItems.length === 0
                            ? 'Start building your restaurant menu by adding items with recipes.'
                            : 'Try adjusting your filters or search query.'}
                    </p>
                    {menuItems.length === 0 && (
                        <button className="btn btn-primary btn-md" onClick={handleAdd}>
                            <MdAdd /> Add First Menu Item
                        </button>
                    )}
                </div>
            ) : (
                <div className="menu-card-grid">
                    {filteredItems.map(item => {
                        const catInfo = getCategoryInfo(item.category);
                        const isActive = item.is_active !== false;
                        const totalIngredients = (item.portions || []).reduce((s, p) =>
                            s + (p.recipe?.length || 0) + (p.sub_items?.length || 0), 0);
                        return (
                            <div key={item.id} className={`menu-card ${!isActive ? 'inactive' : ''}`}>
                                <div className="menu-card-header">
                                    <span className="menu-card-cat">{catInfo.icon} {catInfo.label}</span>
                                    <span className={`menu-active-badge ${isActive ? 'active' : 'inactive'}`}>
                                        {isActive ? 'Active' : 'Inactive'}
                                    </span>
                                </div>

                                <div className="menu-card-name">{item.name}</div>

                                {item.description && (
                                    <div className="menu-card-desc">{item.description}</div>
                                )}

                                {/* Allergens */}
                                {item.allergens?.length > 0 && (
                                    <div className="allergen-row">
                                        {item.allergens.map(code => {
                                            const info = getAllergenInfo(code);
                                            return (
                                                <span key={code} className={`allergen-badge tag-${code}`} title={info.label}>
                                                    {info.icon} {code}
                                                </span>
                                            );
                                        })}
                                    </div>
                                )}

                                {/* Portions with cost & selling price */}
                                {item.portions?.length > 0 && (
                                    <div className="menu-card-portions">
                                        {item.portions.map(p => {
                                            const sell = Number(p.selling_price ?? p.price) || 0;
                                            const cost = Number(p.cost_price) || 0;
                                            return (
                                                <span key={p.id} className="portion-pill" title={cost > 0 ? `Cost: £${cost.toFixed(2)} · Margin: £${(sell - cost).toFixed(2)}` : ''}>
                                                    {p.name}
                                                    <span className="portion-price">£{sell.toFixed(2)}</span>
                                                    {cost > 0 && (
                                                        <span style={{ fontSize: 9, color: 'var(--color-text-muted)', marginLeft: 2 }}>
                                                            (cost £{cost.toFixed(2)})
                                                        </span>
                                                    )}
                                                </span>
                                            );
                                        })}
                                    </div>
                                )}

                                {/* Footer */}
                                <div className="menu-card-footer">
                                    <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>
                                        {item.portions?.length || 0} portion{item.portions?.length !== 1 ? 's' : ''} · {totalIngredients} ingredients
                                    </span>
                                    <div className="menu-card-actions">
                                        <button
                                            className="btn-action"
                                            title={isActive ? 'Deactivate' : 'Activate'}
                                            onClick={() => handleToggleActive(item)}
                                            style={{ color: isActive ? '#f59e0b' : '#22c55e' }}
                                        >
                                            {isActive ? <MdVisibilityOff /> : <MdVisibility />}
                                        </button>
                                        <button
                                            className="btn-action"
                                            title="Edit"
                                            onClick={() => handleEdit(item)}
                                            style={{ color: 'var(--color-primary)' }}
                                        >
                                            <MdEdit />
                                        </button>
                                        <button
                                            className="btn-action delete"
                                            title="Delete"
                                            onClick={() => setDeleteTarget(item)}
                                            style={{ color: 'var(--color-danger)' }}
                                        >
                                            <MdDelete />
                                        </button>
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}

            {/* ══ Add/Edit Modal ══ */}
            <MenuItemForm
                isOpen={showForm}
                onClose={() => { setShowForm(false); setEditItem(null); }}
                onSaved={fetchData}
                editItem={editItem}
                restaurantId={restaurantId}
            />

            {/* ══ Delete Confirmation Modal ══ */}
            {deleteTarget && (
                <div className="modal-overlay" onClick={() => setDeleteTarget(null)}>
                    <div className="modal modal-sm" onClick={e => e.stopPropagation()} style={{ maxWidth: 420 }}>
                        <div className="modal-header">
                            <h2>Delete Menu Item</h2>
                            <button className="modal-close" onClick={() => setDeleteTarget(null)}><MdClose /></button>
                        </div>
                        <div className="modal-body">
                            <p style={{ color: 'var(--color-text-secondary)' }}>
                                Are you sure you want to delete <strong style={{ color: 'var(--color-text-primary)' }}>{deleteTarget.name}</strong>?
                                This action cannot be undone.
                            </p>
                            {deleteTarget.portions?.length > 0 && (
                                <div style={{
                                    marginTop: 'var(--space-3)',
                                    padding: 'var(--space-3)',
                                    background: 'rgba(239, 68, 68, 0.06)',
                                    borderRadius: 'var(--radius-md)',
                                    border: '1px solid rgba(239, 68, 68, 0.15)',
                                    fontSize: 'var(--text-sm)',
                                    color: 'var(--color-text-secondary)',
                                }}>
                                    ⚠️ This item has {deleteTarget.portions.length} portion(s) with recipes. All recipe data will be lost.
                                </div>
                            )}
                        </div>
                        <div className="modal-footer">
                            <button className="btn btn-secondary btn-md" onClick={() => setDeleteTarget(null)}>Cancel</button>
                            <button className="btn btn-danger btn-md" onClick={handleDelete} disabled={deleting}>
                                {deleting ? 'Deleting...' : 'Delete'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default MenuManagement;
