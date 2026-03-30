import React, { useState, useEffect, useCallback } from 'react';
import {
    getLowStockItems,
    getItems,
    updateItem,
    ITEM_TYPES,
    resolveToBaseUnit,
} from '../../services/inventoryService';
import {
    placeReplenishmentOrder,
    getTodaysPendingOrder,
} from '../../services/orderService';
import { getUsersByRole } from '../../services/userService';
import { createNotification } from '../../services/notificationService';
import { useAuth } from '../../contexts/AuthContext';
import {
    MdWarning, MdRefresh, MdShoppingCart, MdTrendingDown,
    MdEdit, MdSave, MdClose, MdCheckCircle, MdStore,
    MdInventory2, MdAdd, MdRemove, MdSend, MdInfo,
} from 'react-icons/md';
import toast from 'react-hot-toast';
import './Inventory.css';
import './LowStock.css';

// ─── Urgency helper ───
const getUrgency = (item) => {
    const threshold = item.low_stock_threshold || item.min_stock || 0;
    if (item.current_stock <= 0)
        return { level: 'critical', label: 'Out of Stock', color: '#ef4444', bg: '#ef444415' };
    if (threshold > 0 && item.current_stock <= threshold * 0.5)
        return { level: 'high', label: 'Critical Low', color: '#ef4444', bg: '#ef444415' };
    return { level: 'medium', label: 'Below Minimum', color: '#f59e0b', bg: '#f59e0b15' };
};

const getTypeInfo = (type) => ITEM_TYPES.find(t => t.value === type);

const getSuggestedQty = (item) => {
    const threshold = item.low_stock_threshold || item.min_stock || 0;
    // Suggest 2x the threshold minus current stock as a sensible reorder
    const suggested = Math.ceil(threshold * 2 - item.current_stock);
    return Math.max(suggested, 1);
};

// ─── Inline Threshold Editor ───
const ThresholdEditor = ({ item, onSaved }) => {
    const [val, setVal] = useState(item.low_stock_threshold || item.min_stock || 0);
    const [saving, setSaving] = useState(false);

    const handleSave = async () => {
        setSaving(true);
        try {
            await updateItem(item.id, { low_stock_threshold: Number(val), min_stock: Number(val) });
            toast.success(`Threshold updated for ${item.name}`);
            onSaved(item.id, Number(val));
        } catch (err) {
            toast.error('Failed to update threshold');
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="threshold-editor">
            <input
                type="number" min={0} step={0.5}
                value={val}
                onChange={e => setVal(e.target.value)}
                className="threshold-input"
            />
            <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>{item.unit}</span>
            <button className="btn btn-primary btn-sm" onClick={handleSave} disabled={saving}>
                <MdSave /> {saving ? '…' : 'Save'}
            </button>
        </div>
    );
};

// ─── Replenishment Panel (per restaurant) ───
const ReplenishmentPanel = ({ restaurant, ckItems, onOrderPlaced, adminUser }) => {
    const [quantities, setQuantities] = useState({});
    const [placing, setPlacing] = useState(false);
    const [todayOrder, setTodayOrder] = useState(null);

    useEffect(() => {
        // Check if this restaurant already has a pending order today
        getTodaysPendingOrder(restaurant.id)
            .then(o => setTodayOrder(o))
            .catch(() => { });

        // Pre-fill suggested quantities for items below threshold for this restaurant
        const init = {};
        ckItems.forEach(item => { init[item.id] = getSuggestedQty(item); });
        setQuantities(init);
    }, [restaurant.id, ckItems]);

    const handlePlace = async () => {
        const selectedItems = ckItems
            .map(item => ({
                item_id: item.id,
                item_name: item.name,
                item_type: item.item_type,
                category_name: item.category_name,
                unit: item.unit,
                quantity: Number(quantities[item.id] || 0),
                cost_price: item.cost_price || 0,
                selling_price: item.selling_price || 0,
                vat_rate: item.vat_rate || 20,
                vat_exempt: item.vat_exempt || false,
            }))
            .filter(i => i.quantity > 0);

        if (!selectedItems.length) {
            toast.error('Enter quantity for at least one item');
            return;
        }
        setPlacing(true);
        try {
            const result = await placeReplenishmentOrder({
                restaurant_id: restaurant.id,
                restaurant_name: restaurant.name || restaurant.restaurant_name,
                items: selectedItems,
                adminUser,
            });

            // Notify the restaurant
            await createNotification({
                recipientId: restaurant.id,
                type: 'order_update',
                priority: 'normal',
                title: result.merged
                    ? 'Your order has been updated with additional items'
                    : 'Admin placed an order on your behalf',
                message: result.merged
                    ? `Admin added ${selectedItems.length} item(s) to your existing order ${result.orderNumber}.`
                    : `Admin created a replenishment order (${result.orderNumber}) on your behalf with ${selectedItems.length} item(s).`,
                metadata: { order_id: result.orderId, order_number: result.orderNumber },
                createdBy: { uid: adminUser?.id, name: adminUser?.name || 'Admin' },
            });

            toast.success(
                result.merged
                    ? `✅ Items merged into existing order ${result.orderNumber}`
                    : `✅ New order ${result.orderNumber} created for ${restaurant.name}`
            );
            onOrderPlaced();
        } catch (err) {
            toast.error('Failed to place replenishment order');
            console.error(err);
        } finally {
            setPlacing(false);
        }
    };

    return (
        <div className="replenish-panel">
            {todayOrder && (
                <div className="replenish-existing-order">
                    <MdInfo style={{ color: '#3b82f6' }} />
                    <span>
                        This restaurant has a pending order today (<strong>{todayOrder.order_number}</strong>).
                        New items will be <strong>merged</strong> into it.
                    </span>
                </div>
            )}
            <table className="replenish-table">
                <thead>
                    <tr>
                        <th>Item</th>
                        <th>Current Stock</th>
                        <th>Min Level</th>
                        <th>Deficit</th>
                        <th>Order Qty</th>
                    </tr>
                </thead>
                <tbody>
                    {ckItems.map(item => {
                        const threshold = item.low_stock_threshold || item.min_stock || 0;
                        const deficitVal = Math.max(0, threshold - item.current_stock);
                        const deficit = Math.round(deficitVal * 100) / 100;
                        const urgency = getUrgency(item);
                        return (
                            <tr key={item.id}>
                                <td>
                                    <div style={{ fontWeight: 600, fontSize: 13 }}>{item.name}</div>
                                    <div style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>
                                        {getTypeInfo(item.item_type)?.icon} {item.category_name}
                                    </div>
                                </td>
                                <td>
                                    <span style={{ fontWeight: 700, color: urgency.color }}>
                                        {item.current_stock} {item.unit}
                                    </span>
                                    {item.unit_conversion?.has_conversion && (
                                        <div className="base-unit-equiv">= {resolveToBaseUnit(item.current_stock, item).baseQuantity} {item.base_unit}</div>
                                    )}
                                </td>
                                <td style={{ color: 'var(--color-text-muted)' }}>{threshold} {item.unit}</td>
                                <td>
                                    <span style={{ color: '#ef4444', fontWeight: 600 }}>
                                        {deficit > 0 ? `↓ ${Math.round(deficit * 100) / 100} ${item.unit}` : '—'}
                                    </span>
                                    {deficit > 0 && item.unit_conversion?.has_conversion && (
                                        <div className="base-unit-equiv">= {resolveToBaseUnit(deficit, item).baseQuantity} {item.base_unit}</div>
                                    )}
                                </td>
                                <td>
                                    <div className="qty-input-group">
                                        <button className="qty-btn" onClick={() => setQuantities(p => ({ ...p, [item.id]: Math.max(0, (Number(p[item.id]) || 0) - 1) }))}>
                                            <MdRemove />
                                        </button>
                                        <input
                                            type="number" min={0} step={0.5}
                                            value={quantities[item.id] || 0}
                                            onChange={e => setQuantities(p => ({ ...p, [item.id]: e.target.value }))}
                                            className="qty-input"
                                        />
                                        <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>{item.unit}</span>
                                        <button className="qty-btn" onClick={() => setQuantities(p => ({ ...p, [item.id]: (Number(p[item.id]) || 0) + 1 }))}>
                                            <MdAdd />
                                        </button>
                                    </div>
                                </td>
                            </tr>
                        );
                    })}
                </tbody>
            </table>
            <div className="replenish-footer">
                <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
                    {ckItems.filter(i => (quantities[i.id] || 0) > 0).length} of {ckItems.length} items selected
                </span>
                <button
                    className="btn btn-primary btn-md"
                    style={{ display: 'flex', alignItems: 'center', gap: 6 }}
                    onClick={handlePlace}
                    disabled={placing}>
                    {placing ? 'Placing…' : <><MdSend /> Place Order on Behalf</>}
                </button>
            </div>
        </div>
    );
};

// ═══════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════

const LowStockAlerts = () => {
    const { userProfile } = useAuth();
    const [ckLowStock, setCkLowStock] = useState([]);
    const [allCkItems, setAllCkItems] = useState([]);
    const [restaurants, setRestaurants] = useState([]);
    const [loading, setLoading] = useState(true);
    const [activeTab, setActiveTab] = useState('ck');   // 'ck' | 'restaurant'
    const [filterType, setFilterType] = useState('all');
    const [editThreshold, setEditThreshold] = useState(null);   // item.id being edited
    const [selRestaurant, setSelRestaurant] = useState('');      // for restaurant panel
    const [selItems, setSelItems] = useState([]);      // CK items for panel
    const [showPanel, setShowPanel] = useState(false);

    const fetchData = useCallback(async () => {
        setLoading(true);
        try {
            const [low, all, rests] = await Promise.all([
                getLowStockItems(),
                getItems({ status: 'active' }),
                getUsersByRole('restaurant_manager')
                    .then(r => r.concat(getUsersByRole('restaurant_manager_non_managed')))
                    .then(async arr => {
                        const flat = (await Promise.all(arr)).flat();
                        // Deduplicate
                        const seen = new Set();
                        return flat.filter(u => { if (seen.has(u.id)) return false; seen.add(u.id); return true; });
                    }),
            ]);
            setCkLowStock(low.sort((a, b) =>
                (a.current_stock / (a.low_stock_threshold || a.min_stock || 1)) -
                (b.current_stock / (b.low_stock_threshold || b.min_stock || 1))
            ));
            setAllCkItems(all);
            setRestaurants(rests);
        } catch (err) {
            toast.error('Failed to load low stock data');
            console.error(err);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { fetchData(); }, [fetchData]);

    // Filter CK items
    const ckFiltered = filterType === 'all'
        ? ckLowStock
        : ckLowStock.filter(i => i.item_type === filterType);

    // Stats
    const outOfStock = ckLowStock.filter(i => i.current_stock <= 0).length;
    const criticalLow = ckLowStock.filter(i => i.current_stock > 0 && i.current_stock <= (i.low_stock_threshold || i.min_stock) * 0.5).length;
    const belowMin = ckLowStock.length;

    const handleThresholdSaved = (itemId, newVal) => {
        setCkLowStock(prev => prev.map(i => i.id === itemId ? { ...i, low_stock_threshold: newVal, min_stock: newVal } : i));
        setEditThreshold(null);
    };

    const handleOpenReplenish = (restaurant) => {
        setSelRestaurant(restaurant);
        // All items below threshold suitable for ordering
        setSelItems(ckLowStock.filter(i => i.item_type !== 'cooked_meat'));
        setShowPanel(true);
    };

    return (
        <div className="inventory-page">
            {/* ─── Header ─── */}
            <div className="page-header">
                <div>
                    <h2 className="page-title">Low Stock Monitoring</h2>
                    <p className="page-subtitle">
                        {belowMin > 0
                            ? `⚠ ${belowMin} item${belowMin > 1 ? 's' : ''} below minimum — ${outOfStock} out of stock`
                            : '✅ All items above minimum stock levels'}
                    </p>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                    <button className="btn-refresh" onClick={fetchData}><MdRefresh /></button>
                </div>
            </div>

            {/* ─── Stat Cards ─── */}
            {!loading && (
                <div className="low-stock-stats">
                    <div className="ls-stat" style={{ borderColor: '#ef4444' }}>
                        <div className="ls-stat-val" style={{ color: '#ef4444' }}>{outOfStock}</div>
                        <div className="ls-stat-label">Out of Stock</div>
                    </div>
                    <div className="ls-stat" style={{ borderColor: '#f59e0b' }}>
                        <div className="ls-stat-val" style={{ color: '#f59e0b' }}>{criticalLow}</div>
                        <div className="ls-stat-label">Critical Low</div>
                    </div>
                    <div className="ls-stat" style={{ borderColor: 'var(--color-border)' }}>
                        <div className="ls-stat-val">{belowMin}</div>
                        <div className="ls-stat-label">Total Alerts</div>
                    </div>
                    <div className="ls-stat" style={{ borderColor: 'var(--color-border)' }}>
                        <div className="ls-stat-val">{restaurants.length}</div>
                        <div className="ls-stat-label">Restaurants</div>
                    </div>
                </div>
            )}

            {/* ─── Tab Bar ─── */}
            <div className="ls-tabs">
                <button className={`ls-tab ${activeTab === 'ck' ? 'active' : ''}`} onClick={() => setActiveTab('ck')}>
                    <MdInventory2 /> CK Inventory Alerts
                    {belowMin > 0 && <span className="ls-tab-badge">{belowMin}</span>}
                </button>
                <button className={`ls-tab ${activeTab === 'restaurant' ? 'active' : ''}`} onClick={() => setActiveTab('restaurant')}>
                    <MdStore /> Restaurant Replenishment
                </button>
            </div>

            {loading ? (
                <div style={{ textAlign: 'center', padding: 60, color: 'var(--color-text-muted)' }}>
                    Loading stock data...
                </div>
            ) : (
                <>
                    {/* ═══ CK Inventory Tab ═══ */}
                    {activeTab === 'ck' && (
                        <div className="ls-section">
                            {/* Type Filter */}
                            <div className="ls-filter-bar">
                                {[{ value: 'all', label: 'All Types' }, ...ITEM_TYPES].map(t => (
                                    <button key={t.value}
                                        className={`ls-filter-btn ${filterType === t.value ? 'active' : ''}`}
                                        onClick={() => setFilterType(t.value)}>
                                        {t.icon || ''} {t.label}
                                    </button>
                                ))}
                            </div>

                            {ckFiltered.length === 0 ? (
                                <div className="card">
                                    <div className="empty-state">
                                        <div className="empty-state-icon" style={{ fontSize: '3.5rem' }}>✅</div>
                                        <div className="empty-state-title">No Low Stock Alerts</div>
                                        <div className="empty-state-description">
                                            All selected item types are above minimum levels.
                                        </div>
                                    </div>
                                </div>
                            ) : (
                                <div className="card">
                                    <div className="data-table-wrapper">
                                        <table className="data-table">
                                            <thead>
                                                <tr>
                                                    <th>Priority</th>
                                                    <th>Item</th>
                                                    <th>Type</th>
                                                    <th>Current Stock</th>
                                                    <th>Min Threshold</th>
                                                    <th>Deficit</th>
                                                    <th>Suggested Order</th>
                                                    <th>Actions</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {ckFiltered.map(item => {
                                                    const urgency = getUrgency(item);
                                                    const threshold = item.low_stock_threshold || item.min_stock || 0;
                                                    const deficitVal = Math.max(0, threshold - item.current_stock);
                                                    const deficit = Math.round(deficitVal * 100) / 100;
                                                    const suggested = getSuggestedQty(item);
                                                    const typeInfo = getTypeInfo(item.item_type);

                                                    return (
                                                        <tr key={item.id} style={{ background: urgency.bg }}>
                                                            <td>
                                                                <span className="ls-priority-badge" style={{ color: urgency.color, background: urgency.bg, border: `1px solid ${urgency.color}40` }}>
                                                                    <MdWarning /> {urgency.label}
                                                                </span>
                                                            </td>
                                                            <td>
                                                                <div style={{ fontWeight: 600 }}>{item.name}</div>
                                                                <div style={{ fontSize: 11, color: 'var(--color-text-muted)', fontFamily: 'monospace' }}>{item.sku}</div>
                                                            </td>
                                                            <td>
                                                                <span className="badge badge-neutral">
                                                                    {typeInfo?.icon} {typeInfo?.label}
                                                                </span>
                                                            </td>
                                                            <td>
                                                                <span style={{ fontWeight: 700, color: urgency.color }}>
                                                                    {item.current_stock} {item.unit}
                                                                </span>
                                                                {item.unit_conversion?.has_conversion && (
                                                                    <div className="base-unit-equiv">= {resolveToBaseUnit(item.current_stock, item).baseQuantity} {item.base_unit}</div>
                                                                )}
                                                            </td>
                                                            <td>
                                                                {editThreshold === item.id ? (
                                                                    <ThresholdEditor
                                                                        item={item}
                                                                        onSaved={handleThresholdSaved}
                                                                    />
                                                                ) : (
                                                                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                                                        <span>{threshold} {item.unit}</span>
                                                                        <button
                                                                            className="btn btn-ghost btn-sm"
                                                                            style={{ padding: '2px 6px', fontSize: 11 }}
                                                                            onClick={() => setEditThreshold(item.id)}
                                                                            title="Edit threshold">
                                                                            <MdEdit />
                                                                        </button>
                                                                    </div>
                                                                )}
                                                            </td>
                                                            <td>
                                                                <span style={{ display: 'flex', alignItems: 'center', gap: 4, color: '#ef4444', fontWeight: 600 }}>
                                                                    <MdTrendingDown /> {Math.round(deficit * 100) / 100} {item.unit}
                                                                </span>
                                                                {item.unit_conversion?.has_conversion && (
                                                                    <div className="base-unit-equiv">= {resolveToBaseUnit(deficit, item).baseQuantity} {item.base_unit}</div>
                                                                )}
                                                            </td>
                                                            <td>
                                                                <span style={{ color: '#3b82f6', fontWeight: 600 }}>{suggested} {item.unit}</span>
                                                            </td>
                                                            <td>
                                                                <button
                                                                    className="btn btn-secondary btn-sm"
                                                                    style={{ display: 'flex', alignItems: 'center', gap: 4 }}
                                                                    onClick={() => {
                                                                        setActiveTab('restaurant');
                                                                    }}>
                                                                    <MdShoppingCart /> Replenish
                                                                </button>
                                                            </td>
                                                        </tr>
                                                    );
                                                })}
                                            </tbody>
                                        </table>
                                    </div>
                                </div>
                            )}
                        </div>
                    )}

                    {/* ═══ Restaurant Replenishment Tab ═══ */}
                    {activeTab === 'restaurant' && (
                        <div className="ls-section">
                            {restaurants.length === 0 ? (
                                <div className="card">
                                    <div className="empty-state">
                                        <div className="empty-state-icon">🏪</div>
                                        <div className="empty-state-title">No Restaurants Found</div>
                                        <div className="empty-state-description">No restaurant managers are registered in the system.</div>
                                    </div>
                                </div>
                            ) : (
                                <>
                                    <p style={{ fontSize: 13, color: 'var(--color-text-muted)', marginBottom: 16 }}>
                                        Select a restaurant to review low-stock items and place an order on their behalf. The single-order-per-day rule applies — items will automatically merge into any existing today's order.
                                    </p>

                                    {/* Restaurant Grid */}
                                    <div className="restaurant-grid">
                                        {restaurants.map(r => (
                                            <div key={r.id} className="restaurant-card" onClick={() => {
                                                setSelRestaurant(r);
                                                setSelItems(ckLowStock.filter(i => i.item_type !== 'cooked_meat'));
                                                setShowPanel(true);
                                            }}>
                                                <div className="restaurant-card-avatar">
                                                    {(r.name || r.restaurant_name || 'R').charAt(0).toUpperCase()}
                                                </div>
                                                <div>
                                                    <div style={{ fontWeight: 700, fontSize: 14 }}>{r.name || r.restaurant_name}</div>
                                                    <div style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>{r.email}</div>
                                                </div>
                                                <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>
                                                    <span style={{ fontSize: 11, color: '#f59e0b' }}>
                                                        {ckLowStock.filter(i => i.item_type !== 'cooked_meat').length} items low
                                                    </span>
                                                    <MdShoppingCart style={{ color: 'var(--color-primary)' }} />
                                                </div>
                                            </div>
                                        ))}
                                    </div>

                                    {/* Replenishment Panel Modal */}
                                    {showPanel && selRestaurant && (
                                        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setShowPanel(false)}>
                                            <div className="modal modal-xl">
                                                <div className="modal-header">
                                                    <h2>
                                                        <MdShoppingCart style={{ color: 'var(--color-primary)' }} />
                                                        Place Order for {selRestaurant.name || selRestaurant.restaurant_name}
                                                    </h2>
                                                    <button className="modal-close" onClick={() => setShowPanel(false)}>
                                                        <MdClose />
                                                    </button>
                                                </div>
                                                <div className="modal-body">
                                                    {selItems.length === 0 ? (
                                                        <div className="empty-state">
                                                            <div className="empty-state-icon">✅</div>
                                                            <div className="empty-state-title">No Low Stock Items</div>
                                                            <div className="empty-state-description">
                                                                All orderable items are currently above minimum levels.
                                                            </div>
                                                        </div>
                                                    ) : (
                                                        <ReplenishmentPanel
                                                            restaurant={selRestaurant}
                                                            ckItems={selItems}
                                                            adminUser={{ id: userProfile?.id, name: userProfile?.name, email: userProfile?.email }}
                                                            onOrderPlaced={() => {
                                                                setShowPanel(false);
                                                                fetchData();
                                                            }}
                                                        />
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                    )}
                                </>
                            )}
                        </div>
                    )}
                </>
            )}
        </div>
    );
};

export default LowStockAlerts;
