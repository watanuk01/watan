import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    MdStore, MdEmail, MdPhone, MdShoppingCart, MdDelete,
    MdArrowForward, MdPerson, MdCalendarToday, MdRefresh,
    MdSearch, MdCheckCircle, MdWarning, MdOpenInNew,
} from 'react-icons/md';
import {
    fetchRestaurantDirectory,
    clearCache,
    formatCurrency,
} from '../../services/analyticsService';
import { createNotification } from '../../services/notificationService';
import { useAuth } from '../../contexts/AuthContext';
import toast from 'react-hot-toast';
import '../dashboard/Dashboard.css';

// ─── Status badge styles ───
const roleBadge = (role) => role === 'restaurant_manager'
    ? { label: 'Managed', bg: '#22c55e22', color: '#22c55e' }
    : { label: 'Non-Managed', bg: '#f59e0b22', color: '#f59e0b' };

const timeSince = (d) => {
    if (!d) return '—';
    const diff = Date.now() - d.getTime();
    const days = Math.floor(diff / 86400000);
    if (days === 0) return 'Today';
    if (days === 1) return 'Yesterday';
    if (days < 30) return `${days} days ago`;
    return d.toLocaleDateString('en-GB');
};

// ═══════════════════════════════════════════════════════════
// RESTAURANT DETAIL PANEL (slide-over)
// ═══════════════════════════════════════════════════════════
const RestaurantDetailPanel = ({ restaurant, onClose, onNavigate }) => {
    const { userProfile } = useAuth();
    const [sending, setSending] = useState(false);

    const sendQuickNotification = async (title, message) => {
        setSending(true);
        try {
            await createNotification({
                title,
                message,
                type: 'announcement',
                priority: 'normal',
                target_type: 'specific_user',
                target_user_id: restaurant.id,
                target_user_name: restaurant.name,
                created_by: userProfile?.uid,
                created_by_name: userProfile?.name || 'Admin',
            });
            toast.success('Notification sent!');
        } catch (e) {
            toast.error('Failed to send notification');
        } finally {
            setSending(false);
        }
    };

    const badge = roleBadge(restaurant.role);

    return (
        <div className="rest-panel-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
            <div className="rest-panel">
                {/* Header */}
                <div className="rest-panel-header">
                    <div className="rest-panel-avatar">
                        {restaurant.restaurant_name?.charAt(0) || '?'}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                        <h2 className="rest-panel-title">{restaurant.restaurant_name}</h2>
                        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: 4 }}>
                            <span className="badge" style={{ background: badge.bg, color: badge.color }}>{badge.label}</span>
                            <span className={`badge ${restaurant.status === 'active' ? 'badge-success' : 'badge-danger'}`}>
                                {restaurant.status === 'active' ? '● Active' : '● Inactive'}
                            </span>
                        </div>
                    </div>
                    <button className="btn btn-ghost btn-sm" onClick={onClose}>✕</button>
                </div>

                {/* Manager info */}
                <div className="rest-panel-section">
                    <h4 className="rest-panel-section-title">Manager</h4>
                    <div className="rest-info-grid">
                        <div className="rest-info-item"><MdPerson className="rest-info-icon" /><span>{restaurant.name}</span></div>
                        <div className="rest-info-item"><MdEmail className="rest-info-icon" /><a href={`mailto:${restaurant.email}`} style={{ color: 'var(--color-primary)' }}>{restaurant.email}</a></div>
                        {restaurant.phone && <div className="rest-info-item"><MdPhone className="rest-info-icon" /><span>{restaurant.phone}</span></div>}
                        <div className="rest-info-item"><MdCalendarToday className="rest-info-icon" /><span>Since {restaurant.created_at?.toLocaleDateString('en-GB') || '—'}</span></div>
                    </div>
                </div>

                {/* KPI summary */}
                <div className="rest-panel-section">
                    <h4 className="rest-panel-section-title">All-Time Performance</h4>
                    <div className="rest-kpi-grid">
                        <div className="rest-kpi-card">
                            <div className="rest-kpi-val" style={{ color: '#c9a96e' }}>{restaurant.totalOrders}</div>
                            <div className="rest-kpi-label">Total Orders</div>
                        </div>
                        <div className="rest-kpi-card">
                            <div className="rest-kpi-val" style={{ color: '#22c55e' }}>{formatCurrency(restaurant.totalOrderValue)}</div>
                            <div className="rest-kpi-label">Order Value</div>
                        </div>
                        <div className="rest-kpi-card">
                            <div className="rest-kpi-val" style={{ color: '#f59e0b' }}>{restaurant.pendingOrders}</div>
                            <div className="rest-kpi-label">Pending</div>
                        </div>
                        <div className="rest-kpi-card">
                            <div className="rest-kpi-val" style={{ color: '#ef4444' }}>{formatCurrency(restaurant.totalWasteValue)}</div>
                            <div className="rest-kpi-label">Waste Value</div>
                        </div>
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 8 }}>
                        Last order: <strong>{timeSince(restaurant.lastOrderDate)}</strong>
                    </div>
                </div>

                {/* Recent orders mini table */}
                {restaurant.recentOrders?.length > 0 && (
                    <div className="rest-panel-section">
                        <h4 className="rest-panel-section-title">Recent Orders</h4>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                            <thead>
                                <tr style={{ borderBottom: '1px solid var(--color-border)' }}>
                                    <th style={{ padding: '6px 8px', textAlign: 'left', color: 'var(--color-text-muted)', fontWeight: 600 }}>Order</th>
                                    <th style={{ padding: '6px 8px', textAlign: 'left', color: 'var(--color-text-muted)', fontWeight: 600 }}>Date</th>
                                    <th style={{ padding: '6px 8px', textAlign: 'right', color: 'var(--color-text-muted)', fontWeight: 600 }}>Value</th>
                                </tr>
                            </thead>
                            <tbody>
                                {restaurant.recentOrders.map(o => (
                                    <tr key={o.id} style={{ borderBottom: '1px solid var(--color-border-light)' }}>
                                        <td style={{ padding: '8px', fontWeight: 600, color: 'var(--color-primary)' }}>{o.order_number}</td>
                                        <td style={{ padding: '8px', color: 'var(--color-text-muted)' }}>{o.created_at?.toLocaleDateString('en-GB') || '—'}</td>
                                        <td style={{ padding: '8px', textAlign: 'right', fontWeight: 700 }}>{formatCurrency(o.total)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}

                {/* Actions */}
                <div className="rest-panel-section">
                    <h4 className="rest-panel-section-title">Quick Actions</h4>
                    <div className="rest-action-grid">
                        <button className="btn btn-primary btn-sm" onClick={() => onNavigate(`/orders/today`)}>
                            <MdShoppingCart /> View Orders
                        </button>
                        <button className="btn btn-ghost btn-sm" onClick={() => onNavigate('/inventory/low-stock')}>
                            <MdWarning /> Low Stock
                        </button>
                        <button className="btn btn-ghost btn-sm" onClick={() => onNavigate('/waste')}>
                            <MdDelete /> Waste Log
                        </button>
                        <button className="btn btn-ghost btn-sm" disabled={sending}
                            onClick={() => sendQuickNotification('Message from Admin', `Hi ${restaurant.name}, please check your dashboard for important updates.`)}>
                            {sending ? 'Sending…' : '📢 Send Notification'}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

// ═══════════════════════════════════════════════════════════
// MAIN PAGE
// ═══════════════════════════════════════════════════════════
const RestaurantsPage = () => {
    const navigate = useNavigate();
    const [restaurants, setRestaurants] = useState([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');
    const [selected, setSelected] = useState(null);
    const [filterStatus, setFilterStatus] = useState('all'); // all | active | inactive

    const load = useCallback(async (refresh = false) => {
        setLoading(true);
        if (refresh) clearCache();
        try {
            const data = await fetchRestaurantDirectory();
            setRestaurants(data);
        } catch (e) {
            toast.error('Failed to load restaurants');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { load(); }, [load]);

    const filtered = restaurants.filter(r => {
        const q = search.toLowerCase();
        if (q && !(r.restaurant_name?.toLowerCase().includes(q) || r.name?.toLowerCase().includes(q) || r.email?.toLowerCase().includes(q))) return false;
        if (filterStatus === 'active' && r.status !== 'active') return false;
        if (filterStatus === 'inactive' && r.status === 'active') return false;
        return true;
    });

    const totalOrders = restaurants.reduce((s, r) => s + r.totalOrders, 0);
    const totalValue = restaurants.reduce((s, r) => s + r.totalOrderValue, 0);
    const totalWaste = restaurants.reduce((s, r) => s + r.totalWasteValue, 0);

    return (
        <div className="reports-page">
            <div className="page-header">
                <div>
                    <h2 className="page-title">Restaurants</h2>
                    <p className="page-subtitle">All restaurant outlets — performance, orders, and management.</p>
                </div>
                <button className="btn btn-ghost btn-sm" onClick={() => load(true)}><MdRefresh /> Refresh</button>
            </div>

            {/* ─── Summary KPIs ─── */}
            {!loading && (
                <div className="kpi-row">
                    <div className="kpi-card"><div className="kpi-value">{restaurants.length}</div><div className="kpi-label">Total Restaurants</div></div>
                    <div className="kpi-card"><div className="kpi-value">{totalOrders}</div><div className="kpi-label">Total Orders</div></div>
                    <div className="kpi-card"><div className="kpi-value" style={{ color: '#c9a96e' }}>{formatCurrency(totalValue)}</div><div className="kpi-label">Total Order Value</div></div>
                    <div className="kpi-card"><div className="kpi-value" style={{ color: '#ef4444' }}>{formatCurrency(totalWaste)}</div><div className="kpi-label">Total Waste Value</div></div>
                </div>
            )}

            {/* ─── Filter / Search Bar ─── */}
            <div className="rest-list-toolbar">
                <div className="search-box" style={{ flex: 1, maxWidth: 340 }}>
                    <MdSearch className="search-icon" />
                    <input
                        className="search-input"
                        placeholder="Search by name, manager or email…"
                        value={search}
                        onChange={e => setSearch(e.target.value)} />
                </div>
                <div className="dash-filter-presets">
                    {['all', 'active', 'inactive'].map(s => (
                        <button key={s} className={`dash-filter-btn ${filterStatus === s ? 'active' : ''}`}
                            onClick={() => setFilterStatus(s)}>
                            {s === 'all' ? 'All' : s.charAt(0).toUpperCase() + s.slice(1)}
                        </button>
                    ))}
                </div>
            </div>

            {/* ─── Restaurant Cards Grid ─── */}
            {loading ? (
                <div className="rest-grid">
                    {Array.from({ length: 4 }).map((_, i) => (
                        <div key={i} className="rest-card"><div className="skeleton" style={{ height: 160, borderRadius: 12 }} /></div>
                    ))}
                </div>
            ) : filtered.length === 0 ? (
                <div className="empty-state" style={{ padding: 80 }}>
                    <div className="empty-state-icon">🏪</div>
                    <div className="empty-state-title">{search ? 'No restaurants match your search' : 'No restaurants yet'}</div>
                    <div className="empty-state-description">Restaurant managers will appear here once they are registered.</div>
                </div>
            ) : (
                <div className="rest-grid">
                    {filtered.map(r => {
                        const badge = roleBadge(r.role);
                        const hasIssues = r.pendingOrders > 0;
                        return (
                            <div key={r.id} className={`rest-card ${hasIssues ? 'rest-card-alert' : ''}`}
                                onClick={() => setSelected(r)}>
                                <div className="rest-card-header">
                                    <div className="rest-card-avatar">{r.restaurant_name?.charAt(0) || '?'}</div>
                                    <div style={{ flex: 1, minWidth: 0 }}>
                                        <div className="rest-card-name">{r.restaurant_name}</div>
                                        <div className="rest-card-manager">{r.name}</div>
                                    </div>
                                    <span className="badge" style={{ background: badge.bg, color: badge.color, fontSize: 10, flexShrink: 0 }}>
                                        {badge.label}
                                    </span>
                                </div>

                                <div className="rest-card-stats">
                                    <div className="rest-card-stat">
                                        <span className="rest-card-stat-val" style={{ color: '#c9a96e' }}>{r.totalOrders}</span>
                                        <span className="rest-card-stat-label">Orders</span>
                                    </div>
                                    <div className="rest-card-stat">
                                        <span className="rest-card-stat-val" style={{ color: '#22c55e' }}>{formatCurrency(r.totalOrderValue)}</span>
                                        <span className="rest-card-stat-label">Value</span>
                                    </div>
                                    <div className="rest-card-stat">
                                        <span className="rest-card-stat-val" style={{ color: '#ef4444' }}>{formatCurrency(r.totalWasteValue)}</span>
                                        <span className="rest-card-stat-label">Waste</span>
                                    </div>
                                    <div className="rest-card-stat">
                                        <span className="rest-card-stat-val" style={{ color: r.pendingOrders > 0 ? '#f59e0b' : 'var(--color-text-muted)' }}>{r.pendingOrders}</span>
                                        <span className="rest-card-stat-label">Pending</span>
                                    </div>
                                </div>

                                <div className="rest-card-footer">
                                    <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>
                                        Last order: {timeSince(r.lastOrderDate)}
                                    </span>
                                    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                                        {r.status === 'active'
                                            ? <MdCheckCircle style={{ color: '#22c55e', fontSize: 14 }} />
                                            : <MdWarning style={{ color: '#ef4444', fontSize: 14 }} />}
                                        <MdArrowForward style={{ color: 'var(--color-text-muted)', fontSize: 14 }} />
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}

            {/* ─── Detail Panel ─── */}
            {selected && (
                <RestaurantDetailPanel
                    restaurant={selected}
                    onClose={() => setSelected(null)}
                    onNavigate={(path) => { setSelected(null); navigate(path); }} />
            )}
        </div>
    );
};

export default RestaurantsPage;
