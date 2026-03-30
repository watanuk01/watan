import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { getOrders, getStatusInfo, subscribeToOrders } from '../../services/orderService';
import { getUsersByRole } from '../../services/userService';
import {
    MdRefresh,
    MdLocalShipping,
    MdCheckCircle,
    MdAccessTime,
    MdTrendingUp,
    MdPerson,
    MdStore,
    MdSpeed,
    MdCalendarToday,
    MdFilterList,
} from 'react-icons/md';
import toast from 'react-hot-toast';
import '../orders/Orders.css';

const DeliveryAnalytics = () => {
    const [orders, setOrders] = useState([]);
    const [partners, setPartners] = useState([]);
    const [loading, setLoading] = useState(true);
    const [dateRange, setDateRange] = useState('30days');
    const [customStart, setCustomStart] = useState('');
    const [customEnd, setCustomEnd] = useState('');
    const [filterPartner, setFilterPartner] = useState('');
    const [filterRestaurant, setFilterRestaurant] = useState('');

    const loadData = useCallback(async () => {
        setLoading(true);
        try {
            const [allOrders, allPartners] = await Promise.all([
                getOrders(),
                getUsersByRole('delivery_partner'),
            ]);
            setOrders(allOrders);
            setPartners(allPartners);
        } catch (err) {
            console.error('Failed to load analytics:', err);
            toast.error('Failed to load analytics data');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { loadData(); }, [loadData]);

    // Real-time subscription for live updates
    useEffect(() => {
        setLoading(true);
        getUsersByRole('delivery_partner').then(setPartners).catch(console.error);
        const unsubscribe = subscribeToOrders((allOrders) => {
            setOrders(allOrders);
            setLoading(false);
        });
        return () => unsubscribe();
    }, []);

    // Date-filtered orders
    const filteredOrders = useMemo(() => {
        let result = orders;
        const now = new Date();
        const start = new Date();

        if (dateRange === '7days') {
            start.setDate(now.getDate() - 7); start.setHours(0, 0, 0, 0);
            result = result.filter(o => o.created_at >= start);
        } else if (dateRange === '30days') {
            start.setDate(now.getDate() - 30); start.setHours(0, 0, 0, 0);
            result = result.filter(o => o.created_at >= start);
        } else if (dateRange === '90days') {
            start.setDate(now.getDate() - 90); start.setHours(0, 0, 0, 0);
            result = result.filter(o => o.created_at >= start);
        } else if (dateRange === 'custom' && customStart && customEnd) {
            const s = new Date(customStart);
            const e = new Date(customEnd); e.setHours(23, 59, 59, 999);
            result = result.filter(o => o.created_at >= s && o.created_at <= e);
        }

        if (filterPartner) result = result.filter(o => o.delivery_partner_id === filterPartner);
        if (filterRestaurant) result = result.filter(o => o.restaurant_name === filterRestaurant);

        return result;
    }, [orders, dateRange, customStart, customEnd, filterPartner, filterRestaurant]);

    const deliveredOrders = filteredOrders.filter(o => o.status === 'delivered');

    // Overview stats
    const totalOrders = filteredOrders.length;
    const totalDelivered = deliveredOrders.length;
    const totalPending = filteredOrders.filter(o => o.status === 'pending').length;
    const totalInTransit = filteredOrders.filter(o => ['assigned', 'out_for_delivery'].includes(o.status)).length;
    const totalRevenue = deliveredOrders.reduce((s, o) => s + (o.total || o.total_amount || 0), 0);

    const deliveryTimes = deliveredOrders
        .filter(o => o.dispatched_at && o.delivered_at)
        .map(o => (o.delivered_at - o.dispatched_at) / 60000);
    const avgDeliveryTime = deliveryTimes.length > 0
        ? Math.round(deliveryTimes.reduce((a, b) => a + b, 0) / deliveryTimes.length) : null;

    const deliveryRate = totalOrders > 0 ? Math.round((totalDelivered / totalOrders) * 100) : 0;

    // Partner performance table
    const partnerStats = useMemo(() => {
        return partners.map(p => {
            const pOrders = filteredOrders.filter(o => o.delivery_partner_id === p.id);
            const pDelivered = pOrders.filter(o => o.status === 'delivered');
            const pActive = pOrders.filter(o => ['assigned', 'out_for_delivery'].includes(o.status)).length;
            const times = pDelivered.filter(o => o.dispatched_at && o.delivered_at)
                .map(o => (o.delivered_at - o.dispatched_at) / 60000);
            const avg = times.length ? Math.round(times.reduce((a, b) => a + b, 0) / times.length) : null;
            const revenue = pDelivered.reduce((s, o) => s + (o.total || o.total_amount || 0), 0);
            return {
                ...p,
                totalDeliveries: pDelivered.length,
                activeOrders: pActive,
                avgTime: avg,
                revenue,
                rate: pOrders.length ? Math.round((pDelivered.length / pOrders.length) * 100) : 0,
            };
        }).sort((a, b) => b.totalDeliveries - a.totalDeliveries);
    }, [partners, filteredOrders]);

    // Restaurant analytics
    const restaurantStats = useMemo(() => {
        const map = {};
        deliveredOrders.forEach(o => {
            const name = o.restaurant_name || 'Unknown';
            if (!map[name]) map[name] = { name, orders: 0, revenue: 0, times: [] };
            map[name].orders++;
            map[name].revenue += (o.total || o.total_amount || 0);
            if (o.dispatched_at && o.delivered_at)
                map[name].times.push((o.delivered_at - o.dispatched_at) / 60000);
        });
        return Object.values(map).map(r => ({
            ...r,
            avgTime: r.times.length ? Math.round(r.times.reduce((a, b) => a + b, 0) / r.times.length) : null,
        })).sort((a, b) => b.orders - a.orders);
    }, [deliveredOrders]);

    const uniqueRestaurants = [...new Set(orders.map(o => o.restaurant_name).filter(Boolean))].sort();

    const timeColor = (t) => !t ? 'var(--color-text-muted)' : t <= 30 ? '#22c55e' : t <= 60 ? '#f59e0b' : '#ef4444';

    return (
        <div className="page-content">
            <div className="page-header">
                <div>
                    <h1 className="page-title">Delivery Analytics</h1>
                    <p className="page-subtitle">Performance metrics, trends, and partner analytics</p>
                </div>
                <button className="btn-refresh" onClick={loadData} disabled={loading}>
                    <MdRefresh className={loading ? 'spin' : ''} />
                </button>
            </div>

            {/* Filters */}
            <div style={{ display: 'flex', gap: 'var(--space-3)', marginBottom: 'var(--space-6)', flexWrap: 'nowrap', alignItems: 'center', overflowX: 'auto', paddingBottom: 4 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <MdFilterList style={{ color: 'var(--color-text-muted)' }} />
                </div>
                <select
                    className="form-input"
                    value={dateRange}
                    onChange={e => setDateRange(e.target.value)}
                    style={{ padding: '8px 14px', minWidth: 140 }}
                >
                    <option value="7days">Last 7 Days</option>
                    <option value="30days">Last 30 Days</option>
                    <option value="90days">Last 90 Days</option>
                    <option value="all">All Time</option>
                    <option value="custom">Custom Range</option>
                </select>
                {dateRange === 'custom' && (
                    <>
                        <input type="date" className="form-input" value={customStart} onChange={e => setCustomStart(e.target.value)} style={{ padding: '8px 12px' }} />
                        <span style={{ color: 'var(--color-text-muted)' }}>to</span>
                        <input type="date" className="form-input" value={customEnd} onChange={e => setCustomEnd(e.target.value)} style={{ padding: '8px 12px' }} />
                    </>
                )}
                <select
                    className="form-input"
                    value={filterPartner}
                    onChange={e => setFilterPartner(e.target.value)}
                    style={{ padding: '8px 14px', minWidth: 160 }}
                >
                    <option value="">All Partners</option>
                    {partners.map(p => (
                        <option key={p.id} value={p.id}>{p.name || p.email}</option>
                    ))}
                </select>
                <select
                    className="form-input"
                    value={filterRestaurant}
                    onChange={e => setFilterRestaurant(e.target.value)}
                    style={{ padding: '8px 14px', minWidth: 160 }}
                >
                    <option value="">All Restaurants</option>
                    {uniqueRestaurants.map(r => (
                        <option key={r} value={r}>{r}</option>
                    ))}
                </select>
            </div>

            {/* KPIs */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 'var(--space-4)', marginBottom: 'var(--space-6)' }}>
                {[
                    { label: 'Total Orders', value: loading ? '…' : totalOrders, icon: <MdLocalShipping />, color: '#3b82f6' },
                    { label: 'Delivered', value: loading ? '…' : totalDelivered, icon: <MdCheckCircle />, color: '#22c55e' },
                    { label: 'Pending', value: loading ? '…' : totalPending, icon: <MdCalendarToday />, color: '#8b5cf6' },
                    { label: 'Avg Delivery Time', value: loading ? '…' : avgDeliveryTime ? `${avgDeliveryTime} min` : '—', icon: <MdSpeed />, color: avgDeliveryTime ? (avgDeliveryTime <= 30 ? '#22c55e' : avgDeliveryTime <= 60 ? '#f59e0b' : '#ef4444') : '#94a3b8' },
                    { label: 'Delivery Rate', value: loading ? '…' : `${deliveryRate}%`, icon: <MdTrendingUp />, color: deliveryRate >= 90 ? '#22c55e' : deliveryRate >= 70 ? '#f59e0b' : '#ef4444' },
                    { label: 'Total Revenue', value: loading ? '…' : `£${totalRevenue.toFixed(2)}`, icon: <MdStore />, color: '#10b981' },
                ].map((s, idx) => (
                    <div key={idx} className="stats-card">
                        <div className="stats-card-top">
                            <div className="stats-card-icon" style={{ background: `${s.color}20`, color: s.color }}>{s.icon}</div>
                        </div>
                        <div className="stats-card-value">{s.value}</div>
                        <div className="stats-card-label">{s.label}</div>
                    </div>
                ))}
            </div>

            {/* Partner Performance */}
            <h3 style={{ marginBottom: 'var(--space-4)', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8 }}>
                <MdPerson style={{ color: 'var(--color-primary)' }} /> Partner Performance
            </h3>
            <div className="data-table-wrapper" style={{ marginBottom: 'var(--space-8)' }}>
                <table className="data-table">
                    <thead>
                        <tr>
                            <th>Partner</th>
                            <th style={{ textAlign: 'center' }}>Active</th>
                            <th style={{ textAlign: 'center' }}>Delivered</th>
                            <th style={{ textAlign: 'center' }}>Delivery Rate</th>
                            <th style={{ textAlign: 'center' }}>Avg Time</th>
                            <th style={{ textAlign: 'right' }}>Revenue</th>
                        </tr>
                    </thead>
                    <tbody>
                        {loading ? (
                            <tr><td colSpan={6} style={{ textAlign: 'center', padding: 40, color: 'var(--color-text-muted)' }}>Loading...</td></tr>
                        ) : partnerStats.length === 0 ? (
                            <tr><td colSpan={6} style={{ textAlign: 'center', padding: 40, color: 'var(--color-text-muted)' }}>No delivery partners</td></tr>
                        ) : partnerStats.map(p => (
                            <tr key={p.id}>
                                <td>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                        <div style={{
                                            width: 32, height: 32, borderRadius: '50%',
                                            background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
                                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                                            color: 'white', fontWeight: 700, fontSize: 12, flexShrink: 0,
                                        }}>
                                            {(p.name || p.email || '?')[0].toUpperCase()}
                                        </div>
                                        <div>
                                            <div style={{ fontWeight: 600 }}>{p.name || p.email}</div>
                                            <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>{p.email}</div>
                                        </div>
                                    </div>
                                </td>
                                <td style={{ textAlign: 'center' }}>
                                    {p.activeOrders > 0 ? (
                                        <span className="badge badge-info">{p.activeOrders}</span>
                                    ) : (
                                        <span style={{ color: 'var(--color-text-muted)' }}>0</span>
                                    )}
                                </td>
                                <td style={{ textAlign: 'center', fontWeight: 600 }}>{p.totalDeliveries}</td>
                                <td style={{ textAlign: 'center' }}>
                                    <span style={{
                                        color: p.rate >= 90 ? '#22c55e' : p.rate >= 70 ? '#f59e0b' : '#ef4444',
                                        fontWeight: 600,
                                    }}>
                                        {p.rate}%
                                    </span>
                                </td>
                                <td style={{ textAlign: 'center' }}>
                                    <span style={{ color: timeColor(p.avgTime), fontWeight: 600 }}>
                                        {p.avgTime ? `${p.avgTime} min` : '—'}
                                    </span>
                                </td>
                                <td style={{ textAlign: 'right', fontWeight: 600, color: '#22c55e' }}>£{p.revenue.toFixed(2)}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            {/* Restaurant Analytics */}
            <h3 style={{ marginBottom: 'var(--space-4)', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8 }}>
                <MdStore style={{ color: 'var(--color-primary)' }} /> Restaurant Analytics
            </h3>
            <div className="data-table-wrapper">
                <table className="data-table">
                    <thead>
                        <tr>
                            <th>Restaurant</th>
                            <th style={{ textAlign: 'center' }}>Orders Delivered</th>
                            <th style={{ textAlign: 'right' }}>Total Revenue</th>
                            <th style={{ textAlign: 'center' }}>Avg Delivery Time</th>
                        </tr>
                    </thead>
                    <tbody>
                        {loading ? (
                            <tr><td colSpan={4} style={{ textAlign: 'center', padding: 40, color: 'var(--color-text-muted)' }}>Loading...</td></tr>
                        ) : restaurantStats.length === 0 ? (
                            <tr><td colSpan={4} style={{ textAlign: 'center', padding: 40, color: 'var(--color-text-muted)' }}>No delivered orders for this period</td></tr>
                        ) : restaurantStats.map((r, idx) => (
                            <tr key={idx}>
                                <td>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                        <MdStore style={{ fontSize: 20, color: 'var(--color-primary)', flexShrink: 0 }} />
                                        <span style={{ fontWeight: 600 }}>{r.name}</span>
                                    </div>
                                </td>
                                <td style={{ textAlign: 'center', fontWeight: 600 }}>{r.orders}</td>
                                <td style={{ textAlign: 'right', fontWeight: 600, color: '#22c55e' }}>£{r.revenue.toFixed(2)}</td>
                                <td style={{ textAlign: 'center' }}>
                                    <span style={{ color: timeColor(r.avgTime), fontWeight: 600 }}>
                                        {r.avgTime ? `${r.avgTime} min` : '—'}
                                    </span>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
};

export default DeliveryAnalytics;
