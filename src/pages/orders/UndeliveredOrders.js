import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import {
    getUndeliveredOrders,
    assignDeliveryPartner,
    getStatusInfo,
} from '../../services/orderService';
import { MdRefresh, MdLocalShipping, MdAccessTime, MdShoppingCart, MdSearch } from 'react-icons/md';
import toast from 'react-hot-toast';
import '../orders/Orders.css';

const DATE_RANGES = [
    { value: 'all', label: 'All Time' },
    { value: 'today', label: 'Today' },
    { value: '3days', label: 'Last 3 Days' },
    { value: '7days', label: 'Last 7 Days' },
    { value: '30days', label: 'Last 30 Days' },
    { value: 'custom', label: 'Custom Range' },
];

const UndeliveredOrders = () => {
    const { currentUser, userProfile } = useAuth();
    const [orders, setOrders] = useState([]);
    const [loading, setLoading] = useState(true);
    const [assigningId, setAssigningId] = useState(null);
    const isDeliveryPartner = userProfile?.role === 'delivery_partner';

    const [searchQuery, setSearchQuery] = useState('');
    const [dateRange, setDateRange] = useState('today');
    const [customStartDate, setCustomStartDate] = useState('');
    const [customEndDate, setCustomEndDate] = useState('');

    const loadOrders = useCallback(async () => {
        setLoading(true);
        try {
            const data = await getUndeliveredOrders();

            // Apply Date Filters Locally
            const now = new Date();
            let start = new Date(0);
            let end = new Date();

            if (dateRange === 'today') {
                start = new Date();
                start.setHours(0, 0, 0, 0);
            } else if (dateRange === '3days') {
                start = new Date();
                start.setDate(now.getDate() - 3);
                start.setHours(0, 0, 0, 0);
            } else if (dateRange === '7days') {
                start = new Date();
                start.setDate(now.getDate() - 7);
                start.setHours(0, 0, 0, 0);
            } else if (dateRange === '30days') {
                start = new Date();
                start.setDate(now.getDate() - 30);
                start.setHours(0, 0, 0, 0);
            } else if (dateRange === 'custom') {
                if (customStartDate) start = new Date(customStartDate);
                if (customEndDate) {
                    end = new Date(customEndDate);
                    end.setHours(23, 59, 59, 999);
                }
            }

            const filteredData = data.filter(order => {
                const orderDate = new Date(order.ready_at || order.created_at);
                if (dateRange === 'custom' && customStartDate && customEndDate) {
                    return orderDate >= start && orderDate <= end;
                } else if (dateRange !== 'all') {
                    return orderDate >= start;
                }
                return true;
            });

            setOrders(filteredData);
        } catch (err) {
            console.error('Failed to load orders:', err);
            toast.error('Failed to load orders');
        } finally {
            setLoading(false);
        }
    }, [dateRange, customStartDate, customEndDate]);

    useEffect(() => {
        loadOrders();
    }, [loadOrders]);

    const handleAssign = async (orderId) => {
        setAssigningId(orderId);
        try {
            await assignDeliveryPartner(
                orderId,
                currentUser.uid,
                userProfile?.name || 'Delivery Partner'
            );
            toast.success('Order assigned to you successfully!');
            await loadOrders();
        } catch (err) {
            toast.error(err.message || 'Failed to assign order');
        } finally {
            setAssigningId(null);
        }
    };

    const getTimeSince = (date) => {
        if (!date) return '';
        const now = new Date();
        const diff = Math.floor((now - date) / 60000); // minutes
        if (diff < 60) return `${diff}m ago`;
        if (diff < 1440) return `${Math.floor(diff / 60)}h ${diff % 60}m ago`;
        return `${Math.floor(diff / 1440)}d ${Math.floor((diff % 1440) / 60)}h ago`;
    };

    const filteredList = orders.filter(o =>
    (o.order_number?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        o.restaurant_name?.toLowerCase().includes(searchQuery.toLowerCase()))
    );

    return (
        <div className="page-content">
            <div className="page-header">
                <div>
                    <h1 className="page-title">
                        {isDeliveryPartner ? 'Available Deliveries' : 'Undelivered Orders'}
                    </h1>
                    <p className="page-subtitle">
                        {isDeliveryPartner
                            ? 'Pick up orders ready for delivery'
                            : 'Orders ready for pickup by delivery partners'
                        }
                    </p>
                </div>
            </div>

            <div className="orders-toolbar" style={{ marginBottom: 'var(--space-6)' }}>
                <div className="toolbar-left" style={{ flex: 1 }}>
                    <div className="search-box">
                        <MdSearch />
                        <input
                            type="text"
                            placeholder="Search order or restaurant..."
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
                    <button className="btn-refresh" onClick={loadOrders} disabled={loading}><MdRefresh className={loading ? 'spin' : ''} /></button>
                </div>
            </div>

            {loading ? (
                <div className="pool-grid">
                    {Array.from({ length: 4 }).map((_, i) => (
                        <div key={i} className="pool-card" style={{ opacity: 0.5 }}>
                            <div className="skeleton skeleton-text" style={{ width: '60%', height: 20 }} />
                            <div className="skeleton skeleton-text" style={{ width: '80%', height: 14, marginTop: 8 }} />
                            <div className="skeleton skeleton-text" style={{ width: '100%', height: 40, marginTop: 16 }} />
                        </div>
                    ))}
                </div>
            ) : filteredList.length === 0 ? (
                <div style={{
                    textAlign: 'center',
                    padding: 'var(--space-12)',
                    color: 'var(--color-text-tertiary)',
                }}>
                    <MdLocalShipping style={{ fontSize: 60, opacity: 0.3, marginBottom: 'var(--space-4)' }} />
                    <h3 style={{ marginBottom: 'var(--space-2)' }}>No orders ready for pickup</h3>
                    <p>Orders will appear here when the kitchen marks them as ready.</p>
                </div>
            ) : (
                <div className="pool-grid">
                    {filteredList.map(order => (
                        <div key={order.id} className="pool-card">
                            <div className="pool-card-header">
                                <div>
                                    <div className="pool-card-restaurant">
                                        {order.restaurant_name || 'Unknown Restaurant'}
                                    </div>
                                    <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-tertiary)', marginTop: 2 }}>
                                        {order.order_number}
                                    </div>
                                </div>
                                <div className="pool-card-time">
                                    <MdAccessTime style={{ marginRight: 4, verticalAlign: 'middle' }} />
                                    {getTimeSince(order.ready_at || order.created_at)}
                                </div>
                            </div>
                            <div className="pool-card-info">
                                <span>
                                    <MdShoppingCart /> {order.item_count || order.items?.length || 0} items
                                </span>
                                <span>
                                    £{(order.total || 0).toFixed(2)}
                                </span>
                            </div>
                            {order.items && order.items.length > 0 && (
                                <div style={{
                                    fontSize: 'var(--text-xs)',
                                    color: 'var(--color-text-tertiary)',
                                    marginBottom: 'var(--space-3)',
                                    lineHeight: 1.5,
                                }}>
                                    {order.items.map(i => `${i.item_name} (${i.quantity} ${i.unit})`).join(', ')}
                                </div>
                            )}
                            {isDeliveryPartner && (
                                <button
                                    className="btn-assign"
                                    onClick={() => handleAssign(order.id)}
                                    disabled={assigningId === order.id}
                                >
                                    {assigningId === order.id ? 'Assigning...' : (
                                        <><MdLocalShipping style={{ marginRight: 6, verticalAlign: 'middle' }} /> Assign to Me</>
                                    )}
                                </button>
                            )}
                        </div>
                    ))}
                </div>
            )
            }
        </div >
    );
};

export default UndeliveredOrders;
