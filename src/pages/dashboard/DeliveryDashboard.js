import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import {
    getDeliveryPartnerOrders,
    getUndeliveredOrders,
    getStatusInfo,
} from '../../services/orderService';
import {
    MdLocalShipping,
    MdCheckCircle,
    MdSchedule,
    MdArrowForward,
    MdHistory,
    MdRefresh,
    MdShoppingCart,
} from 'react-icons/md';
import './Dashboard.css';

const DeliveryDashboard = () => {
    const { currentUser, userProfile } = useAuth();
    const navigate = useNavigate();
    const [loading, setLoading] = useState(true);
    const [stats, setStats] = useState({ assigned: 0, completedToday: 0, poolAvailable: 0, avgTime: '—' });
    const [assignedOrders, setAssignedOrders] = useState([]);

    const loadData = useCallback(async () => {
        setLoading(true);
        try {
            const [allPartnerOrders, pool] = await Promise.all([
                getDeliveryPartnerOrders(currentUser.uid),
                getUndeliveredOrders(),
            ]);

            const active = allPartnerOrders.filter(o => ['assigned', 'out_for_delivery'].includes(o.status));
            const today = new Date(); today.setHours(0, 0, 0, 0);
            const completedToday = allPartnerOrders.filter(o =>
                o.status === 'delivered' && o.delivered_at && o.delivered_at >= today
            );

            // Calculate avg delivery time from completed orders
            const deliveryTimes = allPartnerOrders
                .filter(o => o.status === 'delivered' && o.dispatched_at && o.delivered_at)
                .map(o => (o.delivered_at - o.dispatched_at) / 60000);
            const avgMinutes = deliveryTimes.length > 0
                ? Math.round(deliveryTimes.reduce((a, b) => a + b, 0) / deliveryTimes.length)
                : null;

            setStats({
                assigned: active.length,
                completedToday: completedToday.length,
                poolAvailable: pool.length,
                avgTime: avgMinutes ? `${avgMinutes} min` : '—',
            });
            setAssignedOrders(active.slice(0, 5));
        } catch (err) {
            console.error('Failed to load delivery dashboard data:', err);
        } finally {
            setLoading(false);
        }
    }, [currentUser.uid]);

    useEffect(() => { loadData(); }, [loadData]);

    const statsCards = [
        { id: 'assigned', label: 'Assigned Orders', value: stats.assigned, icon: MdLocalShipping, color: 'primary' },
        { id: 'completed-today', label: 'Completed Today', value: stats.completedToday, icon: MdCheckCircle, color: 'success' },
        { id: 'pool-available', label: 'Available in Pool', value: stats.poolAvailable, icon: MdShoppingCart, color: 'info' },
        { id: 'avg-time', label: 'Avg Delivery Time', value: stats.avgTime, icon: MdSchedule, color: 'warning' },
    ];

    const quickActions = [
        { label: 'My Deliveries', icon: MdLocalShipping, path: '/delivery/orders' },
        { label: 'Order Pool', icon: MdShoppingCart, path: '/delivery/orders' },
        { label: 'Delivery History', icon: MdHistory, path: '/delivery/orders' },
    ];

    const getStatusClass = (status) => {
        switch (status) {
            case 'assigned': return 'badge-info';
            case 'out_for_delivery': return 'badge-warning';
            case 'delivered': return 'badge-success';
            default: return 'badge-neutral';
        }
    };

    const formatDateTime = (date) => {
        if (!date) return '—';
        const d = date instanceof Date ? date : new Date(date);
        if (isNaN(d.getTime())) return '—';
        return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
    };

    return (
        <div className="dashboard-page">
            {/* Welcome Banner */}
            <div className="dashboard-welcome">
                <div>
                    <h2 className="welcome-title">My Deliveries 🚚</h2>
                    <p className="welcome-subtitle">Pick up and deliver orders to restaurants.</p>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
                    <div className="welcome-date">
                        {new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
                    </div>
                    <button className="btn-refresh" onClick={loadData} disabled={loading}>
                        <MdRefresh className={loading ? 'spin' : ''} />
                    </button>
                </div>
            </div>

            {/* Stats Grid */}
            <div className="stats-grid">
                {statsCards.map(stat => (
                    <div key={stat.id} className="stats-card">
                        <div className="stats-card-top">
                            <div className={`stats-card-icon ${stat.color}`}>
                                <stat.icon />
                            </div>
                        </div>
                        <div className="stats-card-value">{loading ? '…' : stat.value}</div>
                        <div className="stats-card-label">{stat.label}</div>
                    </div>
                ))}
            </div>

            {/* Quick Actions */}
            <div className="quick-actions">
                <h3 className="section-title">Quick Actions</h3>
                <div className="actions-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
                    {quickActions.map(action => (
                        <button key={action.label} className="action-card" onClick={() => navigate(action.path)}>
                            <action.icon className="action-icon" />
                            <span className="action-label">{action.label}</span>
                            <MdArrowForward className="action-arrow" />
                        </button>
                    ))}
                </div>
            </div>

            {/* Assigned Orders */}
            <div className="card">
                <div className="card-header">
                    <h3>My Active Orders</h3>
                    <span className="badge badge-primary">{assignedOrders.length} orders</span>
                </div>
                <div className="card-body" style={{ padding: 0 }}>
                    {loading ? (
                        <div style={{ textAlign: 'center', padding: 40, color: 'var(--color-text-muted)' }}>Loading...</div>
                    ) : assignedOrders.length === 0 ? (
                        <div style={{ textAlign: 'center', padding: 40, color: 'var(--color-text-muted)' }}>
                            <MdLocalShipping style={{ fontSize: 40, opacity: 0.3, marginBottom: 8 }} />
                            <p>No active orders. Check the order pool!</p>
                        </div>
                    ) : (
                        <div className="data-table-wrapper" style={{ border: 'none', borderRadius: 0 }}>
                            <table className="data-table">
                                <thead>
                                    <tr>
                                        <th>Order ID</th>
                                        <th>Restaurant</th>
                                        <th>Items</th>
                                        <th>Status</th>
                                        <th>Assigned</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {assignedOrders.map(order => (
                                        <tr key={order.id} style={{ cursor: 'pointer' }} onClick={() => navigate('/delivery/orders')}>
                                            <td style={{ fontWeight: 'var(--font-semibold)', color: 'var(--color-primary)' }}>{order.order_number}</td>
                                            <td>{order.restaurant_name}</td>
                                            <td>{order.items?.length || 0}</td>
                                            <td>
                                                <span className={`badge ${getStatusClass(order.status)}`}>
                                                    {getStatusInfo(order.status).icon} {getStatusInfo(order.status).label}
                                                </span>
                                            </td>
                                            <td style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)' }}>
                                                {formatDateTime(order.assigned_at || order.dispatched_at)}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default DeliveryDashboard;
