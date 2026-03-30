import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { getItems, ITEM_TYPES } from '../../services/inventoryService';
import { createOrder, getTodaysPendingOrder, addItemsToOrder } from '../../services/orderService';
import {
    MdSearch,
    MdShoppingCart,
    MdAdd,
    MdRemove,
    MdClose,
    MdSend,
} from 'react-icons/md';
import toast from 'react-hot-toast';
import './Restaurant.css';

const PlaceOrder = () => {
    const { currentUser, userProfile } = useAuth();
    const CART_KEY = `watan_cart_${currentUser?.uid}`;
    const NOTES_KEY = `watan_cart_notes_${currentUser?.uid}`;

    const [items, setItems] = useState([]);
    const [loading, setLoading] = useState(true);
    const [activeType, setActiveType] = useState('grocery');
    const [searchQuery, setSearchQuery] = useState('');
    const [cart, setCart] = useState(() => {
        try {
            const saved = localStorage.getItem(CART_KEY);
            return saved ? JSON.parse(saved) : [];
        } catch { return []; }
    });
    const [quantities, setQuantities] = useState({});
    const [notes, setNotes] = useState(() => {
        try { return localStorage.getItem(NOTES_KEY) || ''; }
        catch { return ''; }
    });
    const [submitting, setSubmitting] = useState(false);

    // Persist cart to localStorage
    useEffect(() => {
        try { localStorage.setItem(CART_KEY, JSON.stringify(cart)); }
        catch { /* quota exceeded — ignore */ }
    }, [cart, CART_KEY]);

    useEffect(() => {
        try { localStorage.setItem(NOTES_KEY, notes); }
        catch { /* quota exceeded — ignore */ }
    }, [notes, NOTES_KEY]);

    // Load items from CK inventory
    const loadItems = useCallback(async () => {
        setLoading(true);
        try {
            const allItems = await getItems({ item_type: activeType });
            // Only show enabled items with stock
            const available = allItems.filter(i => i.enabled !== false);
            setItems(available);
        } catch (err) {
            console.error('Failed to load items:', err);
            toast.error('Failed to load inventory');
        } finally {
            setLoading(false);
        }
    }, [activeType]);

    useEffect(() => {
        loadItems();
    }, [loadItems]);

    // Filter items by search
    const filteredItems = useMemo(() => {
        if (!searchQuery.trim()) return items;
        const q = searchQuery.toLowerCase();
        return items.filter(i =>
            i.name?.toLowerCase().includes(q) ||
            i.category_name?.toLowerCase().includes(q)
        );
    }, [items, searchQuery]);

    // Get stock status info
    const getStockStatus = (item) => {
        const qty = item.current_stock || 0;
        const threshold = item.low_stock_threshold || 5;
        if (qty <= 0) return { label: 'Out of Stock', className: 'out-of-stock' };
        if (qty <= threshold) return { label: 'Low Stock', className: 'low-stock' };
        return { label: 'In Stock', className: 'in-stock' };
    };

    // Add item to cart
    const addToCart = (item) => {
        const qty = parseFloat(quantities[item.id] || 1);
        if (!qty || qty <= 0) {
            toast.error('Enter a valid quantity');
            return;
        }

        setCart(prev => {
            const existing = prev.find(c => c.item_id === item.id);
            if (existing) {
                return prev.map(c =>
                    c.item_id === item.id
                        ? { ...c, quantity: c.quantity + qty }
                        : c
                );
            }
            return [...prev, {
                item_id: item.id,
                item_name: item.name,
                item_type: item.item_type,
                category_name: item.category_name || '',
                unit: item.unit || 'kg',
                cost_price: item.cost_price || 0,
                selling_price: item.selling_price || item.cost_price || 0,
                vat_rate: item.vat_rate || 20,
                vat_exempt: item.vat_exempt || false,
                quantity: qty,
            }];
        });

        setQuantities(prev => ({ ...prev, [item.id]: '' }));
        toast.success(`${item.name} added to cart`);
    };

    // Update cart item quantity
    const updateCartQty = (itemId, delta) => {
        setCart(prev => prev.map(c => {
            if (c.item_id !== itemId) return c;
            const newQty = Math.max(0.5, c.quantity + delta);
            return { ...c, quantity: newQty };
        }));
    };

    // Remove from cart
    const removeFromCart = (itemId) => {
        setCart(prev => prev.filter(c => c.item_id !== itemId));
    };

    // Calculate totals
    const totals = useMemo(() => {
        let subtotal = 0;
        let vat = 0;
        cart.forEach(item => {
            const lineTotal = (item.selling_price || 0) * item.quantity;
            const vatRate = item.vat_exempt ? 0 : (item.vat_rate || 20);
            const itemVat = lineTotal * (vatRate / 100);
            subtotal += lineTotal;
            vat += itemVat;
        });
        return {
            subtotal: Math.round(subtotal * 100) / 100,
            vat: Math.round(vat * 100) / 100,
            total: Math.round((subtotal + vat) * 100) / 100,
        };
    }, [cart]);

    // Place order
    const handlePlaceOrder = async () => {
        if (cart.length === 0) {
            toast.error('Cart is empty');
            return;
        }

        setSubmitting(true);
        try {
            // Check for existing pending order today (single order per day rule)
            const existingOrder = await getTodaysPendingOrder(currentUser.uid);

            if (existingOrder) {
                // Merge items into existing order
                await addItemsToOrder(existingOrder.id, cart);
                toast.success(`Items added to existing order ${existingOrder.order_number}`);
            } else {
                // Create new order
                const result = await createOrder({
                    restaurant_id: currentUser.uid,
                    restaurant_name: userProfile?.restaurant_name || userProfile?.name || '',
                    items: cart,
                    created_by: currentUser.uid,
                    notes,
                });
                toast.success(`Order ${result.order_number} placed successfully!`);
            }

            // Reset cart and clear localStorage
            setCart([]);
            setNotes('');
            try {
                localStorage.removeItem(CART_KEY);
                localStorage.removeItem(NOTES_KEY);
            } catch { /* ignore */ }
        } catch (err) {
            console.error('Failed to place order:', err);
            toast.error('Failed to place order. Please try again.');
        } finally {
            setSubmitting(false);
        }
    };

    // Item types for tabs (only grocery, raw_meat, cooked_meat)
    const orderableTypes = ITEM_TYPES.filter(t =>
        ['grocery', 'raw_meat', 'cooked_meat'].includes(t.value)
    );

    return (
        <div className="page-content">
            <div className="page-header">
                <div>
                    <h1 className="page-title">Order from Central Kitchen</h1>
                    <p className="page-subtitle">Browse items and add to your cart</p>
                </div>
            </div>

            <div className="place-order-layout">
                {/* ─── Left: Item Catalog ─── */}
                <div className="catalog-section">
                    <div className="catalog-header">
                        <div className="type-tabs">
                            {orderableTypes.map(type => (
                                <button
                                    key={type.value}
                                    className={`type-tab ${activeType === type.value ? 'active' : ''}`}
                                    onClick={() => { setActiveType(type.value); setSearchQuery(''); }}
                                    style={activeType === type.value ? { borderColor: type.color, color: type.color } : {}}
                                >
                                    <span>{type.icon}</span> {type.label}
                                </button>
                            ))}
                        </div>
                        <div className="catalog-search" style={{ marginTop: 'var(--space-3)' }}>
                            <MdSearch style={{ color: 'var(--color-text-tertiary)', fontSize: 20, flexShrink: 0 }} />
                            <input
                                type="text"
                                placeholder="Search items..."
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                            />
                        </div>
                    </div>

                    <div className="catalog-items">
                        {loading ? (
                            Array.from({ length: 5 }).map((_, i) => (
                                <div key={i} className="catalog-item" style={{ opacity: 0.5 }}>
                                    <div className="catalog-item-info">
                                        <div className="skeleton skeleton-text" style={{ width: '60%', height: 16 }} />
                                        <div className="skeleton skeleton-text" style={{ width: '40%', height: 12, marginTop: 4 }} />
                                    </div>
                                </div>
                            ))
                        ) : filteredItems.length === 0 ? (
                            <div style={{ textAlign: 'center', padding: 'var(--space-8)', color: 'var(--color-text-tertiary)' }}>
                                No items found
                            </div>
                        ) : (
                            filteredItems.map(item => {
                                const stockStatus = getStockStatus(item);
                                const isOutOfStock = (item.current_stock || 0) <= 0;
                                const isInCart = cart.some(c => c.item_id === item.id);

                                return (
                                    <div key={item.id} className="catalog-item" style={isOutOfStock ? { opacity: 0.5 } : {}}>
                                        <div className="catalog-item-info">
                                            <div className="catalog-item-name">
                                                {item.name}
                                                {isInCart && <span style={{ color: 'var(--color-primary)', marginLeft: 6, fontSize: 'var(--text-xs)' }}>✓ in cart</span>}
                                            </div>
                                            <div className="catalog-item-meta">
                                                <span>{item.category_name || 'Uncategorized'}</span>
                                                <span>•</span>
                                                <span>{item.unit}</span>
                                                {item.current_stock != null && <span>• Stock: {item.current_stock.toFixed(2)}</span>}
                                            </div>
                                        </div>
                                        <span className={`catalog-item-stock ${stockStatus.className}`}>
                                            {stockStatus.label}
                                        </span>
                                        <span className="catalog-item-price">
                                            £{(item.selling_price || item.cost_price || 0).toFixed(2)}/{item.unit}
                                        </span>
                                        <div className="add-qty-control">
                                            <input
                                                type="number"
                                                min="0.5"
                                                step="0.5"
                                                placeholder="Qty"
                                                value={quantities[item.id] || ''}
                                                onChange={(e) => setQuantities(prev => ({ ...prev, [item.id]: e.target.value }))}
                                                disabled={isOutOfStock}
                                            />
                                            <button
                                                className="btn-add-item"
                                                onClick={() => addToCart(item)}
                                                disabled={isOutOfStock}
                                            >
                                                <MdAdd style={{ marginRight: 2 }} /> Add
                                            </button>
                                        </div>
                                    </div>
                                );
                            })
                        )}
                    </div>
                </div>

                {/* ─── Right: Cart Sidebar ─── */}
                <div className="cart-sidebar">
                    <div className="cart-header">
                        <h3><MdShoppingCart style={{ marginRight: 8, verticalAlign: 'middle' }} />Cart</h3>
                        {cart.length > 0 && <span className="cart-badge">{cart.length}</span>}
                    </div>

                    <div className="cart-items">
                        {cart.length === 0 ? (
                            <div className="cart-empty">
                                <MdShoppingCart style={{ fontSize: 40, opacity: 0.3, marginBottom: 8 }} />
                                <p>Your cart is empty</p>
                                <p style={{ fontSize: 'var(--text-xs)' }}>Browse items and add them to your order</p>
                            </div>
                        ) : (
                            cart.map(item => (
                                <div key={item.item_id} className="cart-item">
                                    <div className="cart-item-info">
                                        <div className="cart-item-name">{item.item_name}</div>
                                        <div className="cart-item-detail">
                                            £{item.selling_price.toFixed(2)}/{item.unit}
                                        </div>
                                    </div>
                                    <div className="cart-item-qty">
                                        <button onClick={() => updateCartQty(item.item_id, -0.5)}>
                                            <MdRemove size={14} />
                                        </button>
                                        <span>{item.quantity}</span>
                                        <button onClick={() => updateCartQty(item.item_id, 0.5)}>
                                            <MdAdd size={14} />
                                        </button>
                                    </div>
                                    <div className="cart-item-price">
                                        £{(item.selling_price * item.quantity).toFixed(2)}
                                    </div>
                                    <button
                                        className="btn-remove-item"
                                        onClick={() => removeFromCart(item.item_id)}
                                    >
                                        <MdClose />
                                    </button>
                                </div>
                            ))
                        )}
                    </div>

                    {cart.length > 0 && (
                        <>
                            <div className="cart-summary">
                                <div className="cart-summary-row">
                                    <span>Subtotal</span>
                                    <span>£{totals.subtotal.toFixed(2)}</span>
                                </div>
                                <div className="cart-summary-row">
                                    <span>VAT</span>
                                    <span>£{totals.vat.toFixed(2)}</span>
                                </div>
                                <div className="cart-summary-row total">
                                    <span>Total</span>
                                    <span>£{totals.total.toFixed(2)}</span>
                                </div>
                                <div className="cart-notes">
                                    <textarea
                                        placeholder="Order notes (optional)..."
                                        value={notes}
                                        onChange={(e) => setNotes(e.target.value)}
                                    />
                                </div>
                            </div>
                            <div className="cart-actions">
                                <button
                                    className="btn-place-order"
                                    onClick={handlePlaceOrder}
                                    disabled={submitting || cart.length === 0}
                                >
                                    {submitting ? 'Placing Order...' : (
                                        <><MdSend style={{ marginRight: 8, verticalAlign: 'middle' }} />Place Order (£{totals.total.toFixed(2)})</>
                                    )}
                                </button>
                            </div>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
};

export default PlaceOrder;
