import React, { useState, useEffect, useCallback } from 'react';
import {
    MdNotifications, MdDoneAll, MdRefresh, MdDelete,
    MdAdd, MdSearch, MdFilterList, MdPriorityHigh, MdSend,
    MdSchedule, MdMarkEmailRead, MdMarkEmailUnread,
} from 'react-icons/md';
import { useAuth } from '../../contexts/AuthContext';
import {
    getNotifications,
    markAsRead,
    markAsUnread,
    markAllAsRead,
    deleteNotification,
    getNotificationType,
    createBroadcastNotification,
    getPriorityColor,
    NOTIFICATION_TYPES,
} from '../../services/notificationService';
import { getAllUsers, getUsersByRole } from '../../services/userService';
import toast from 'react-hot-toast';
import './Notifications.css';

// ─── Helpers ───
const timeAgo = (date) => {
    if (!date) return '';
    const diff = Math.floor((new Date() - date) / 1000);
    if (diff < 60) return 'Just now';
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
    return date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
};

const FILTER_TABS = [
    { key: 'all', label: 'All' },
    { key: 'unread', label: 'Unread' },
    { key: 'announcement', label: 'Announcements' },
    { key: 'alert', label: 'Alerts' },
    { key: 'waste', label: 'Waste' },
    { key: 'order', label: 'Orders' },
];

const ALERT_TYPES = ['low_stock', 'expiry_warning', 'system']; // epos_error removed — on hold
const WASTE_TYPES = ['waste_updated', 'waste_deleted', 'waste_submitted'];
const ORDER_TYPES = ['order_update', 'delivery_update'];

// ═══════════════════════════════════════════
// CREATE NOTIFICATION FORM
// ═══════════════════════════════════════════

const CreateNotificationForm = ({ onCreated, adminUser }) => {
    const [users, setUsers] = useState([]);
    const [form, setForm] = useState({
        title: '',
        message: '',
        type: 'announcement',
        priority: 'normal',
        recurring: 'none',
        targetType: 'all_restaurants',
        targetUsers: [],
        scheduledAt: '',
    });
    const [sending, setSending] = useState(false);

    useEffect(() => {
        getAllUsers().then(all => setUsers(all)).catch(() => { });
    }, []);

    const restaurants = users.filter(u =>
        u.role === 'restaurant_manager' || u.role === 'restaurant_manager_non_managed'
    );
    const deliveryPartners = users.filter(u => u.role === 'delivery_partner');

    const getRecipientIds = () => {
        switch (form.targetType) {
            case 'all_restaurants':
                return restaurants.map(u => u.id);
            case 'all_delivery':
                return deliveryPartners.map(u => u.id);
            case 'all_users':
                return users.map(u => u.id);
            case 'specific':
                return form.targetUsers;
            default:
                return [];
        }
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!form.title.trim() || !form.message.trim()) {
            toast.error('Title and message are required');
            return;
        }
        const recipientIds = getRecipientIds();
        if (!recipientIds.length) {
            toast.error('No recipients found for selected target');
            return;
        }
        setSending(true);
        try {
            await createBroadcastNotification({
                type: form.type,
                title: form.title,
                message: form.message,
                priority: form.priority,
                recurring: form.recurring,
                scheduledAt: form.scheduledAt ? new Date(form.scheduledAt) : null,
                metadata: { source: 'admin_created' },
                createdBy: { uid: adminUser.uid || adminUser.id, name: adminUser.name || adminUser.email },
            }, recipientIds);

            toast.success(`📢 Notification sent to ${recipientIds.length} recipient${recipientIds.length !== 1 ? 's' : ''}`);
            setForm({ title: '', message: '', type: 'announcement', priority: 'normal', recurring: 'none', targetType: 'all_restaurants', targetUsers: [], scheduledAt: '' });
            if (onCreated) onCreated();
        } catch (err) {
            toast.error('Failed to send notification');
            console.error(err);
        } finally {
            setSending(false);
        }
    };

    const priorityColors = { normal: '#6b7280', high: '#f59e0b', urgent: '#ef4444' };

    return (
        <form className="create-notif-form" onSubmit={handleSubmit}>
            <div className="create-notif-grid">
                {/* Left column */}
                <div className="create-notif-col">
                    <div className="notif-form-group">
                        <label>Title *</label>
                        <input type="text" placeholder="Notification title" value={form.title}
                            onChange={e => setForm(p => ({ ...p, title: e.target.value }))} required />
                    </div>
                    <div className="notif-form-group">
                        <label>Message *</label>
                        <textarea placeholder="Notification message..." value={form.message} rows={4}
                            onChange={e => setForm(p => ({ ...p, message: e.target.value }))} required />
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                        <div className="notif-form-group">
                            <label>Type</label>
                            <select value={form.type} onChange={e => setForm(p => ({ ...p, type: e.target.value }))}>
                                {Object.entries(NOTIFICATION_TYPES).map(([k, v]) => (
                                    <option key={k} value={k}>{v.icon} {v.label}</option>
                                ))}
                            </select>
                        </div>
                        <div className="notif-form-group">
                            <label>Priority</label>
                            <select value={form.priority} onChange={e => setForm(p => ({ ...p, priority: e.target.value }))}
                                style={{ borderLeft: `3px solid ${priorityColors[form.priority]}` }}>
                                <option value="normal">🔵 Normal</option>
                                <option value="high">🟡 High</option>
                                <option value="urgent">🔴 Urgent</option>
                            </select>
                        </div>
                    </div>
                </div>

                {/* Right column */}
                <div className="create-notif-col">
                    <div className="notif-form-group">
                        <label>Target Recipients</label>
                        <select value={form.targetType} onChange={e => setForm(p => ({ ...p, targetType: e.target.value, targetUsers: [] }))}>
                            <option value="all_restaurants">All Restaurants ({restaurants.length})</option>
                            <option value="all_delivery">All Delivery Partners ({deliveryPartners.length})</option>
                            <option value="all_users">All Users ({users.length})</option>
                            <option value="specific">Specific User(s)</option>
                        </select>
                    </div>

                    {form.targetType === 'specific' && (
                        <div className="notif-form-group">
                            <label>Select Users</label>
                            <div className="notif-user-list">
                                {users.map(u => (
                                    <label key={u.id} className="notif-user-option">
                                        <input type="checkbox" checked={form.targetUsers.includes(u.id)}
                                            onChange={e => {
                                                const updated = e.target.checked
                                                    ? [...form.targetUsers, u.id]
                                                    : form.targetUsers.filter(id => id !== u.id);
                                                setForm(p => ({ ...p, targetUsers: updated }));
                                            }} />
                                        <span>{u.name || u.email}</span>
                                        <span className="notif-user-role">{u.role?.replace(/_/g, ' ')}</span>
                                    </label>
                                ))}
                            </div>
                        </div>
                    )}

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                        <div className="notif-form-group">
                            <label>Recurring</label>
                            <select value={form.recurring} onChange={e => setForm(p => ({ ...p, recurring: e.target.value }))}>
                                <option value="none">None</option>
                                <option value="daily">Daily</option>
                                <option value="weekly">Weekly</option>
                                <option value="monthly">Monthly</option>
                            </select>
                        </div>
                        <div className="notif-form-group">
                            <label>Schedule For</label>
                            <input type="datetime-local" value={form.scheduledAt}
                                onChange={e => setForm(p => ({ ...p, scheduledAt: e.target.value }))} />
                        </div>
                    </div>

                    {/* Preview */}
                    {form.title && (
                        <div className="notif-preview">
                            <div className="notif-preview-label">Preview</div>
                            <div className="notif-preview-card">
                                <div className="notif-preview-icon" style={{ background: `${NOTIFICATION_TYPES[form.type]?.color}20` }}>
                                    {NOTIFICATION_TYPES[form.type]?.icon || '🔔'}
                                </div>
                                <div>
                                    <div style={{ fontWeight: 600, fontSize: 13 }}>{form.title}</div>
                                    <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 2 }}>{form.message}</div>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            </div>

            <div className="create-notif-footer">
                <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
                    Will send to {form.targetType === 'specific'
                        ? `${form.targetUsers.length} selected user${form.targetUsers.length !== 1 ? 's' : ''}`
                        : form.targetType === 'all_restaurants' ? `${restaurants.length} restaurants`
                            : form.targetType === 'all_delivery' ? `${deliveryPartners.length} delivery partners`
                                : `${users.length} users`}
                </span>
                <button type="submit" className="btn btn-primary btn-md" disabled={sending}
                    style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    {sending ? 'Sending...' : <><MdSend /> Send Notification</>}
                </button>
            </div>
        </form>
    );
};

// ═══════════════════════════════════════════
// MAIN NOTIFICATIONS PAGE
// ═══════════════════════════════════════════

const NotificationsPage = () => {
    const { userProfile, isAdmin, isCKStaff } = useAuth();
    const isAdminUser = isAdmin?.() || isCKStaff?.();

    const [notifications, setNotifications] = useState([]);
    const [loading, setLoading] = useState(true);
    const [activeTab, setActiveTab] = useState('inbox'); // 'inbox' | 'create'
    const [filterTab, setFilterTab] = useState('all');
    const [search, setSearch] = useState('');
    const [expandedId, setExpandedId] = useState(null);

    const fetchData = useCallback(async () => {
        if (!userProfile?.id) return;
        setLoading(true);
        try {
            const data = await getNotifications(userProfile.id);
            setNotifications(data);
        } catch (err) {
            console.error('Failed to load notifications:', err);
            toast.error('Failed to load notifications');
        } finally {
            setLoading(false);
        }
    }, [userProfile?.id]);

    useEffect(() => { fetchData(); }, [fetchData]);

    const unreadCount = notifications.filter(n => !n.is_read).length;

    // ─── Filter ───
    const filteredNotifs = notifications.filter(n => {
        if (filterTab === 'unread' && n.is_read) return false;
        if (filterTab === 'announcement' && n.type !== 'announcement') return false;
        if (filterTab === 'alert' && !ALERT_TYPES.includes(n.type)) return false;
        if (filterTab === 'waste' && !WASTE_TYPES.includes(n.type)) return false;
        if (filterTab === 'order' && !ORDER_TYPES.includes(n.type)) return false;
        if (search) {
            const q = search.toLowerCase();
            return (n.title || '').toLowerCase().includes(q) || (n.message || '').toLowerCase().includes(q);
        }
        return true;
    });

    // ─── Actions ───
    const handleToggleRead = async (notif, e) => {
        e.stopPropagation();
        try {
            if (notif.is_read) {
                await markAsUnread(notif.id);
                setNotifications(prev => prev.map(n => n.id === notif.id ? { ...n, is_read: false } : n));
            } else {
                await markAsRead(notif.id);
                setNotifications(prev => prev.map(n => n.id === notif.id ? { ...n, is_read: true } : n));
            }
        } catch (err) { toast.error('Failed to update notification'); }
    };

    const handleDelete = async (notifId, e) => {
        e.stopPropagation();
        try {
            await deleteNotification(notifId);
            setNotifications(prev => prev.filter(n => n.id !== notifId));
            toast.success('Notification deleted');
        } catch (err) { toast.error('Failed to delete notification'); }
    };

    const handleMarkAllRead = async () => {
        try {
            await markAllAsRead(userProfile.id);
            setNotifications(prev => prev.map(n => ({ ...n, is_read: true })));
            toast.success('All notifications marked as read');
        } catch (err) { toast.error('Failed to mark all as read'); }
    };

    const handleClick = async (notif) => {
        if (!notif.is_read) {
            await markAsRead(notif.id).catch(console.error);
            setNotifications(prev => prev.map(n => n.id === notif.id ? { ...n, is_read: true } : n));
        }
        setExpandedId(prev => prev === notif.id ? null : notif.id);
    };

    return (
        <div className="notifications-page">
            {/* Page Header */}
            <div className="notifications-header">
                <h1>
                    <MdNotifications style={{ color: 'var(--color-primary)' }} />
                    Notifications
                    {unreadCount > 0 && <span className="unread-count">{unreadCount}</span>}
                </h1>

                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                    {isAdminUser && (
                        <>
                            <button
                                className={`btn btn-md ${activeTab === 'inbox' ? 'btn-primary' : 'btn-secondary'}`}
                                onClick={() => setActiveTab('inbox')}
                                style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                <MdNotifications /> Inbox
                            </button>
                            <button
                                className={`btn btn-md ${activeTab === 'create' ? 'btn-primary' : 'btn-secondary'}`}
                                onClick={() => setActiveTab('create')}
                                style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                <MdAdd /> Create
                            </button>
                        </>
                    )}
                    <button className="btn-refresh" onClick={fetchData}
                        style={{ display: 'flex', alignItems: 'center', gap: 6 }}><MdRefresh /></button>
                    {unreadCount > 0 && activeTab === 'inbox' && (
                        <button className="btn btn-primary btn-md" onClick={handleMarkAllRead}
                            style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <MdDoneAll /> Mark All Read
                        </button>
                    )}
                </div>
            </div>

            {/* ─── CREATE FORM (admin only) ─── */}
            {activeTab === 'create' && isAdminUser && (
                <div className="create-notif-container">
                    <h2 style={{ marginBottom: 20, fontSize: 16, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8 }}>
                        <MdSend style={{ color: 'var(--color-primary)' }} /> Create & Send Notification
                    </h2>
                    <CreateNotificationForm
                        onCreated={() => { setActiveTab('inbox'); fetchData(); }}
                        adminUser={{ uid: userProfile?.id, ...userProfile }}
                    />
                </div>
            )}

            {/* ─── INBOX ─── */}
            {activeTab === 'inbox' && (
                <>
                    {/* Filter Tabs + Search */}
                    <div className="notif-filter-bar">
                        <div className="notif-filter-tabs">
                            {FILTER_TABS.map(tab => (
                                <button
                                    key={tab.key}
                                    className={`notif-filter-tab ${filterTab === tab.key ? 'active' : ''}`}
                                    onClick={() => setFilterTab(tab.key)}>
                                    {tab.label}
                                    {tab.key === 'unread' && unreadCount > 0 && (
                                        <span className="notif-tab-badge">{unreadCount}</span>
                                    )}
                                </button>
                            ))}
                        </div>
                        <div className="notif-search">
                            <MdSearch style={{ color: 'var(--color-text-muted)', flexShrink: 0 }} />
                            <input type="text" placeholder="Search notifications..."
                                value={search} onChange={e => setSearch(e.target.value)} />
                        </div>
                    </div>

                    {/* Notification List */}
                    {loading ? (
                        <div style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--color-text-muted)' }}>
                            Loading notifications...
                        </div>
                    ) : filteredNotifs.length === 0 ? (
                        <div className="notifications-empty">
                            <div className="empty-icon">🔔</div>
                            <p style={{ fontWeight: 600, fontSize: 16 }}>
                                {search ? 'No results found' : 'No notifications'}
                            </p>
                            <p>{search ? `No notifications matching "${search}"` : "You're all caught up!"}</p>
                        </div>
                    ) : (
                        filteredNotifs.map(notif => {
                            const typeInfo = getNotificationType(notif.type);
                            const isExpanded = expandedId === notif.id;
                            const priorityColor = getPriorityColor(notif.priority);

                            return (
                                <div
                                    key={notif.id}
                                    className={`notification-card ${notif.is_read ? '' : 'unread'}`}
                                    onClick={() => handleClick(notif)}>

                                    {/* Priority indicator */}
                                    {notif.priority && notif.priority !== 'normal' && (
                                        <div className="notif-priority-strip" style={{ background: priorityColor }} />
                                    )}

                                    <div className="notif-icon" style={{ background: `${typeInfo.color}20` }}>
                                        {typeInfo.icon}
                                    </div>

                                    <div className="notif-body">
                                        <div className="notif-title">
                                            <span className="notif-badge" style={{ background: `${typeInfo.color}22`, color: typeInfo.color }}>
                                                {typeInfo.label}
                                            </span>
                                            {notif.priority === 'urgent' && (
                                                <span className="notif-badge" style={{ background: '#ef444422', color: '#ef4444', marginLeft: 4 }}>
                                                    🔴 URGENT
                                                </span>
                                            )}
                                            {notif.priority === 'high' && (
                                                <span className="notif-badge" style={{ background: '#f59e0b22', color: '#f59e0b', marginLeft: 4 }}>
                                                    ⚡ HIGH
                                                </span>
                                            )}
                                            <span style={{ marginLeft: 6 }}>{notif.title}</span>
                                        </div>

                                        <div className="notif-message">
                                            {isExpanded ? notif.message : (notif.message?.length > 120 ? notif.message.substring(0, 120) + '...' : notif.message)}
                                        </div>

                                        {/* Expanded metadata */}
                                        {isExpanded && notif.metadata && Object.keys(notif.metadata).length > 0 && (
                                            <div style={{ marginTop: 8, padding: '8px 12px', background: 'var(--color-surface-hover)', borderRadius: 8, fontSize: 12 }}>
                                                {notif.metadata.reason && <div><strong>Reason:</strong> {notif.metadata.reason}</div>}
                                                {notif.metadata.action && <div><strong>Action:</strong> <span style={{ textTransform: 'capitalize' }}>{notif.metadata.action}</span></div>}
                                                {notif.metadata.changes && Object.keys(notif.metadata.changes).length > 0 && (
                                                    <div style={{ marginTop: 4 }}>
                                                        <strong>Changes:</strong>
                                                        {Object.entries(notif.metadata.changes).map(([f, v]) => (
                                                            <div key={f} style={{ marginLeft: 12 }}>
                                                                {f}: <s>{String(v.from)}</s> → <strong>{String(v.to)}</strong>
                                                            </div>
                                                        ))}
                                                    </div>
                                                )}
                                                {notif.created_by && <div style={{ marginTop: 4 }}><strong>By:</strong> {notif.created_by.name}</div>}
                                                {notif.recurring && notif.recurring !== 'none' && (
                                                    <div><strong>Recurring:</strong> <span style={{ textTransform: 'capitalize' }}>{notif.recurring}</span></div>
                                                )}
                                            </div>
                                        )}

                                        <div className="notif-time">{timeAgo(notif.created_at)}</div>
                                    </div>

                                    {/* Actions */}
                                    <div className="notif-actions" onClick={e => e.stopPropagation()}>
                                        <button
                                            className="notif-action-btn"
                                            title={notif.is_read ? 'Mark as unread' : 'Mark as read'}
                                            onClick={e => handleToggleRead(notif, e)}>
                                            {notif.is_read ? <MdMarkEmailUnread /> : <MdMarkEmailRead />}
                                        </button>
                                        <button
                                            className="notif-action-btn danger"
                                            title="Delete"
                                            onClick={e => handleDelete(notif.id, e)}>
                                            <MdDelete />
                                        </button>
                                    </div>

                                    {!notif.is_read && <div className="notif-unread-dot" />}
                                </div>
                            );
                        })
                    )}
                </>
            )}
        </div>
    );
};

export default NotificationsPage;
