import React, { useState, useEffect, useCallback } from 'react';
import {
    getOrders,
    getStatusInfo,
    adminAssignDeliveryPartner,
    ORDER_STATUSES,
    subscribeToOrders,
} from '../../services/orderService';
import { getUsersByRole } from '../../services/userService';
import {
    MdRefresh,
    MdLocalShipping,
    MdCheckCircle,
    MdAccessTime,
    MdShoppingCart,
    MdPerson,
    MdAssignmentInd,
    MdTimeline,
    MdSpeed,
} from 'react-icons/md';
import toast from 'react-hot-toast';
import Pagination from '../../components/common/Pagination';
import '../orders/Orders.css';
import DeliveryDetailModal from './DeliveryDetailModal';

const AdminDeliveryManagement = () => {
    const [activeTab, setActiveTab] = useState('live');
    const [allOrders, setAllOrders] = useState([]);
    const [deliveryPartners, setDeliveryPartners] = useState([]);
    const [loading, setLoading] = useState(true);
    const [assigningId, setAssigningId] = useState(null);
    const [assignModalOrder, setAssignModalOrder] = useState(null);
    const [selectedPartner, setSelectedPartner] = useState('');
    const [filterPartner, setFilterPartner] = useState('');
    const [detailOrder, setDetailOrder] = useState(null);

    // Pagination State
    const [currentPageLive, setCurrentPageLive] = useState(1);
    const [itemsPerPageLive, setItemsPerPageLive] = useState(15);
    const [currentPageDelivered, setCurrentPageDelivered] = useState(1);
    const [itemsPerPageDelivered, setItemsPerPageDelivered] = useState(15);

    // Reset pagination to page 1 on tab or filter change
    useEffect(() => {
        setCurrentPageLive(1);
        setCurrentPageDelivered(1);
    }, [activeTab, filterPartner]);

    const loadData = useCallback(async () => {
        setLoading(true);
        try {
            const [orders, partners] = await Promise.all([
                getOrders(),
                getUsersByRole('delivery_partner'),
            ]);
            setAllOrders(orders);
            setDeliveryPartners(partners);
        } catch (err) {
            console.error('Failed to load delivery management data:', err);
            toast.error('Failed to load data');
        } finally {
            setLoading(false);
        }
    }, []);

    // Real-time subscription for live updates
    useEffect(() => {
        setLoading(true);
        // Load partners once
        getUsersByRole('delivery_partner').then(setDeliveryPartners).catch(console.error);
        // Subscribe to all orders
        const unsubscribe = subscribeToOrders((orders) => {
            setAllOrders(orders);
            setLoading(false);
        });
        return () => unsubscribe();
    }, []);

    // ─── Derived Data ───
    const activeStatuses = ['assigned', 'out_for_delivery', 'ready_for_pickup'];
    const liveOrders = allOrders.filter(o => activeStatuses.includes(o.status));
    const unassignedOrders = allOrders.filter(o => o.status === 'ready_for_pickup');
    const deliveredOrders = allOrders.filter(o => o.status === 'delivered');

    // Filter live orders by partner
    const filteredLiveOrders = filterPartner
        ? liveOrders.filter(o => o.delivery_partner_id === filterPartner)
        : liveOrders;

    const paginatedLiveOrders = filteredLiveOrders.slice(
        (currentPageLive - 1) * itemsPerPageLive,
        currentPageLive * itemsPerPageLive
    );

    const paginatedDeliveredOrders = deliveredOrders.slice(
        (currentPageDelivered - 1) * itemsPerPageDelivered,
        currentPageDelivered * itemsPerPageDelivered
    );

    // ─── Partner Analytics ───
    const partnerAnalytics = deliveryPartners.map(partner => {
        const partnerOrders = allOrders.filter(o => o.delivery_partner_id === partner.id);
        const delivered = partnerOrders.filter(o => o.status === 'delivered');
        const activeCount = partnerOrders.filter(o => ['assigned', 'out_for_delivery'].includes(o.status)).length;

        const today = new Date(); today.setHours(0, 0, 0, 0);
        const todayDeliveries = delivered.filter(o => o.delivered_at && o.delivered_at >= today).length;

        // Avg delivery time
        const times = delivered
            .filter(o => o.dispatched_at && o.delivered_at)
            .map(o => (o.delivered_at - o.dispatched_at) / 60000);
        const avgTime = times.length > 0 ? Math.round(times.reduce((a, b) => a + b, 0) / times.length) : null;

        return {
            ...partner,
            totalDeliveries: delivered.length,
            activeOrders: activeCount,
            todayDeliveries,
            avgTime,
        };
    }).sort((a, b) => b.totalDeliveries - a.totalDeliveries);



    // ─── Admin Assign ───
    const handleAdminAssign = async () => {
        if (!assignModalOrder || !selectedPartner) return;
        const partner = deliveryPartners.find(p => p.id === selectedPartner);
        if (!partner) return;

        setAssigningId(assignModalOrder.id);
        try {
            await adminAssignDeliveryPartner(
                assignModalOrder.id,
                partner.id,
                partner.name || partner.email
            );
            toast.success(`Order assigned to ${partner.name || partner.email}`);
            setAssignModalOrder(null);
            setSelectedPartner('');
        } catch (err) {
            toast.error(err.message || 'Failed to assign');
        } finally {
            setAssigningId(null);
        }
    };

    const formatDateTime = (date) => {
        if (!date) return '—';
        const d = date instanceof Date ? date : new Date(date);
        if (isNaN(d.getTime())) return '—';
        return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
    };

    const getTimeSince = (date) => {
        if (!date) return '';
        const diff = Math.floor((new Date() - date) / 60000);
        if (diff < 60) return `${diff}m ago`;
        if (diff < 1440) return `${Math.floor(diff / 60)}h ago`;
        return `${Math.floor(diff / 1440)}d ago`;
    };

    return (
        <div className="page-content">
            <div className="page-header">
                <div>
                    <h1 className="page-title">Delivery Management</h1>
                    <p className="page-subtitle">Monitor deliveries, assign orders, and track partner performance</p>
                </div>
                <button className="btn-refresh" onClick={loadData} disabled={loading}>
                    <MdRefresh className={loading ? 'spin' : ''} />
                </button>
            </div>

            {/* Summary Stats */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 'var(--space-4)', marginBottom: 'var(--space-6)' }}>
                {[
                    { label: 'Unassigned', value: unassignedOrders.length, icon: <MdShoppingCart />, color: '#f59e0b' },
                    { label: 'Active Deliveries', value: liveOrders.filter(o => ['assigned', 'out_for_delivery'].includes(o.status)).length, icon: <MdLocalShipping />, color: '#3b82f6' },
                    { label: 'Delivered All Time', value: deliveredOrders.length, icon: <MdCheckCircle />, color: '#22c55e' },
                    { label: 'Partners', value: deliveryPartners.length, icon: <MdPerson />, color: '#8b5cf6' },
                ].map((s, i) => (
                    <div key={i} className="stats-card">
                        <div className="stats-card-top">
                            <div className="stats-card-icon" style={{ background: `${s.color}20`, color: s.color }}>{s.icon}</div>
                        </div>
                        <div className="stats-card-value">{loading ? '…' : s.value}</div>
                        <div className="stats-card-label">{s.label}</div>
                    </div>
                ))}
            </div>

            {/* Tabs */}
            <div className="orders-status-tabs">
                <button className={`status-tab ${activeTab === 'live' ? 'active' : ''}`} onClick={() => setActiveTab('live')}>
                    <MdTimeline /> Live Status
                    <span className="tab-count">{liveOrders.length}</span>
                </button>
                <button className={`status-tab ${activeTab === 'unassigned' ? 'active' : ''}`} onClick={() => setActiveTab('unassigned')}>
                    <MdShoppingCart /> Unassigned
                    <span className="tab-count">{unassignedOrders.length}</span>
                </button>
                <button className={`status-tab ${activeTab === 'partners' ? 'active' : ''}`} onClick={() => setActiveTab('partners')}>
                    <MdSpeed /> Partners
                    <span className="tab-count">{deliveryPartners.length}</span>
                </button>
                <button className={`status-tab ${activeTab === 'delivered' ? 'active' : ''}`} onClick={() => setActiveTab('delivered')}>
                    <MdCheckCircle /> Delivered
                    <span className="tab-count">{deliveredOrders.length}</span>
                </button>
            </div>

            {loading ? (
                <div style={{ textAlign: 'center', padding: 60, color: 'var(--color-text-muted)' }}>Loading delivery data...</div>
            ) : activeTab === 'live' ? (
                /* ─── Live Status ─── */
                <>
                    <div style={{ display: 'flex', gap: 'var(--space-3)', marginBottom: 'var(--space-4)', flexWrap: 'wrap' }}>
                        <select
                            className="form-input"
                            value={filterPartner}
                            onChange={e => setFilterPartner(e.target.value)}
                            style={{ maxWidth: 250, padding: '8px 12px' }}
                        >
                            <option value="">All Partners</option>
                            {deliveryPartners.map(p => (
                                <option key={p.id} value={p.id}>{p.name || p.email}</option>
                            ))}
                        </select>
                    </div>
                    {filteredLiveOrders.length === 0 ? (
                        <div style={{ textAlign: 'center', padding: 60, color: 'var(--color-text-muted)' }}>
                            <MdLocalShipping style={{ fontSize: 60, opacity: 0.3, marginBottom: 'var(--space-4)' }} />
                            <h3>No active deliveries</h3>
                        </div>
                    ) : (
                        <>
                            <div className="data-table-wrapper">
                                <table className="data-table">
                                    <thead>
                                        <tr>
                                            <th>Order</th><th>Restaurant</th><th>Items</th><th>Partner</th>
                                            <th>Status</th><th>Time</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {paginatedLiveOrders.map(order => (
                                            <tr key={order.id} onClick={() => setDetailOrder(order)} style={{ cursor: 'pointer' }}>
                                                <td style={{ fontWeight: 600, color: 'var(--color-primary)' }}>{order.order_number}</td>
                                                <td>{order.restaurant_name}</td>
                                                <td>{order.items?.length || 0}</td>
                                                <td>{order.delivery_partner_name || <span style={{ color: 'var(--color-text-muted)' }}>Unassigned</span>}</td>
                                                <td>
                                                    <span className="order-status-badge" style={{
                                                        background: `${getStatusInfo(order.status).color}15`,
                                                        color: getStatusInfo(order.status).color,
                                                    }}>
                                                        {getStatusInfo(order.status).icon} {getStatusInfo(order.status).label}
                                                    </span>
                                                </td>
                                                <td style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)' }}>
                                                    {getTimeSince(order.assigned_at || order.ready_at || order.created_at)}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                            {!loading && filteredLiveOrders.length > 0 && (
                                <Pagination
                                    currentPage={currentPageLive}
                                    totalItems={filteredLiveOrders.length}
                                    itemsPerPage={itemsPerPageLive}
                                    onPageChange={setCurrentPageLive}
                                    onItemsPerPageChange={setItemsPerPageLive}
                                />
                            )}
                        </>
                    )}
                </>
            ) : activeTab === 'unassigned' ? (
                /* ─── Unassigned Orders ─── */
                unassignedOrders.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: 60, color: 'var(--color-text-muted)' }}>
                        <MdCheckCircle style={{ fontSize: 60, opacity: 0.3, marginBottom: 'var(--space-4)', color: '#22c55e' }} />
                        <h3>All orders are assigned!</h3>
                    </div>
                ) : (
                    <div className="data-table-wrapper">
                        <table className="data-table">
                            <thead>
                                <tr>
                                    <th>Order</th><th>Restaurant</th><th>Items</th><th>Ready Since</th><th>Action</th>
                                </tr>
                            </thead>
                            <tbody>
                                {unassignedOrders.map(order => (
                                    <tr key={order.id} onClick={() => setDetailOrder(order)} style={{ cursor: 'pointer' }}>
                                        <td style={{ fontWeight: 600, color: 'var(--color-primary)' }}>{order.order_number}</td>
                                        <td>{order.restaurant_name}</td>
                                        <td>{order.items?.length || 0}</td>
                                        <td style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)' }}>
                                            <MdAccessTime style={{ verticalAlign: 'middle', marginRight: 4 }} />
                                            {getTimeSince(order.ready_at || order.created_at)}
                                        </td>
                                        <td>
                                            <button
                                                className="btn btn-primary btn-sm"
                                                onClick={() => { setAssignModalOrder(order); setSelectedPartner(''); }}
                                                style={{ display: 'flex', alignItems: 'center', gap: 4 }}
                                            >
                                                <MdAssignmentInd /> Assign
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )
            ) : activeTab === 'delivered' ? (
                /* ─── Delivered Orders ─── */
                deliveredOrders.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: 60, color: 'var(--color-text-muted)' }}>
                        <MdCheckCircle style={{ fontSize: 60, opacity: 0.3, marginBottom: 'var(--space-4)' }} />
                        <h3>No delivered orders yet</h3>
                    </div>
                ) : (
                    <>
                        <div className="data-table-wrapper">
                            <table className="data-table">
                                <thead>
                                    <tr>
                                        <th>Order</th><th>Restaurant</th><th>Items</th><th>Partner</th>
                                        <th>Delivery Time</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {paginatedDeliveredOrders.map(order => (
                                        <tr key={order.id} onClick={() => setDetailOrder(order)} style={{ cursor: 'pointer' }}>
                                            <td style={{ fontWeight: 600, color: 'var(--color-primary)' }}>{order.order_number}</td>
                                            <td>{order.restaurant_name}</td>
                                            <td>{order.items?.length || 0}</td>
                                            <td>{order.delivery_partner_name || '—'}</td>
                                            <td style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)' }}>
                                                <MdCheckCircle style={{ color: '#22c55e', verticalAlign: 'middle', marginRight: 4 }} />
                                                {formatDateTime(order.delivered_at)}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                        {!loading && deliveredOrders.length > 0 && (
                            <Pagination
                                currentPage={currentPageDelivered}
                                totalItems={deliveredOrders.length}
                                itemsPerPage={itemsPerPageDelivered}
                                onPageChange={setCurrentPageDelivered}
                                onItemsPerPageChange={setItemsPerPageDelivered}
                            />
                        )}
                    </>
                )
            ) : (
                /* ─── Partner Performance ─── */
                <div className="data-table-wrapper">
                    <table className="data-table">
                        <thead>
                            <tr>
                                <th>Partner</th>
                                <th style={{ textAlign: 'center' }}>Active Now</th>
                                <th style={{ textAlign: 'center' }}>Today</th>
                                <th style={{ textAlign: 'center' }}>Total Deliveries</th>
                                <th style={{ textAlign: 'center' }}>Avg Time</th>
                            </tr>
                        </thead>
                        <tbody>
                            {partnerAnalytics.length === 0 ? (
                                <tr><td colSpan={5} style={{ textAlign: 'center', padding: 40, color: 'var(--color-text-muted)' }}>No delivery partners yet</td></tr>
                            ) : partnerAnalytics.map(p => (
                                <tr key={p.id}>
                                    <td>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                            <div style={{
                                                width: 32, height: 32, borderRadius: '50%',
                                                background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
                                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                color: 'white', fontWeight: 700, fontSize: 12,
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
                                    <td style={{ textAlign: 'center', fontWeight: 600 }}>{p.todayDeliveries}</td>
                                    <td style={{ textAlign: 'center', fontWeight: 600 }}>{p.totalDeliveries}</td>
                                    <td style={{ textAlign: 'center' }}>
                                        {p.avgTime ? (
                                            <span style={{ color: p.avgTime <= 30 ? '#22c55e' : p.avgTime <= 60 ? '#f59e0b' : '#ef4444', fontWeight: 600 }}>
                                                {p.avgTime} min
                                            </span>
                                        ) : (
                                            <span style={{ color: 'var(--color-text-muted)' }}>—</span>
                                        )}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}

            {/* ─── Assign Modal ─── */}
            {assignModalOrder && (
                <div className="modal-overlay" onClick={() => setAssignModalOrder(null)}>
                    <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 440 }}>
                        <div className="modal-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '20px 24px', borderBottom: '1px solid var(--color-border)' }}>
                            <h2 style={{ margin: 0, fontSize: '1.1rem' }}>
                                Assign {assignModalOrder.order_number}
                            </h2>
                            <button className="btn-refresh" onClick={() => setAssignModalOrder(null)} style={{ width: 36, height: 36 }}>×</button>
                        </div>
                        <div className="modal-body" style={{ padding: '24px' }}>
                            <p style={{ color: 'var(--color-text-secondary)', marginBottom: 'var(--space-4)', fontSize: 'var(--text-sm)' }}>
                                Assign to <strong>{assignModalOrder.restaurant_name}</strong> · {assignModalOrder.items?.length || 0} items
                            </p>
                            <div className="form-group">
                                <label style={{ display: 'block', marginBottom: 6, fontWeight: 600, fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)' }}>
                                    Select Delivery Partner *
                                </label>
                                <select
                                    className="form-input"
                                    value={selectedPartner}
                                    onChange={e => setSelectedPartner(e.target.value)}
                                    style={{ width: '100%' }}
                                >
                                    <option value="">Choose a partner...</option>
                                    {deliveryPartners.map(p => (
                                        <option key={p.id} value={p.id}>
                                            {p.name || p.email} {partnerAnalytics.find(pa => pa.id === p.id)?.activeOrders > 0 ? `(${partnerAnalytics.find(pa => pa.id === p.id).activeOrders} active)` : ''}
                                        </option>
                                    ))}
                                </select>
                            </div>
                        </div>
                        <div className="modal-footer" style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-3)', padding: '16px 24px', borderTop: '1px solid var(--color-border)' }}>
                            <button className="btn btn-secondary btn-md" onClick={() => setAssignModalOrder(null)}>Cancel</button>
                            <button
                                className="btn btn-primary btn-md"
                                onClick={handleAdminAssign}
                                disabled={!selectedPartner || assigningId === assignModalOrder.id}
                                style={{ display: 'flex', alignItems: 'center', gap: 6 }}
                            >
                                <MdAssignmentInd /> {assigningId === assignModalOrder.id ? 'Assigning...' : 'Assign Partner'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* ─── Delivery History Detail Modal ─── */}
            {detailOrder && (
                <DeliveryDetailModal
                    detailOrder={detailOrder}
                    onClose={() => setDetailOrder(null)}
                />
            )}
        </div>
    );
};

export default AdminDeliveryManagement;
