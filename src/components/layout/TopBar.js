import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { useSidebar } from '../../contexts/SidebarContext';
import {
    MdMenu,
    MdNotifications,
    MdNotificationsNone,
    MdSearch,
    MdKeyboardArrowDown,
    MdLogout,
    MdPerson,
    MdSettings,
    MdDoneAll,
    MdOpenInNew,
} from 'react-icons/md';
import {
    getNotifications,
    markAsRead,
    markAllAsRead,
    getNotificationType,
} from '../../services/notificationService';
import './TopBar.css';

const timeAgo = (date) => {
    if (!date) return '';
    const diff = Math.floor((new Date() - date) / 1000);
    if (diff < 60) return 'Just now';
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return `${Math.floor(diff / 86400)}d ago`;
};

const TopBar = () => {
    const { userProfile, logout } = useAuth();
    const { toggleMobile } = useSidebar();
    const navigate = useNavigate();
    const location = useLocation();

    const [showUserMenu, setShowUserMenu] = useState(false);
    const [showNotifMenu, setShowNotifMenu] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [notifications, setNotifications] = useState([]);
    const [unreadCount, setUnreadCount] = useState(0);

    const userMenuRef = useRef(null);
    const notifMenuRef = useRef(null);

    // ─── Load notifications ───
    const loadNotifications = useCallback(async () => {
        if (!userProfile?.id) return;
        try {
            const data = await getNotifications(userProfile.id);
            setNotifications(data.slice(0, 5)); // Only 5 in dropdown
            setUnreadCount(data.filter(n => !n.is_read).length);
        } catch (err) {
            console.error('Failed to load notifications:', err);
        }
    }, [userProfile?.id]);

    useEffect(() => {
        loadNotifications();
        // Poll every 60 seconds for new notifications
        const interval = setInterval(loadNotifications, 60000);
        return () => clearInterval(interval);
    }, [loadNotifications]);

    // Expose refresh so usePushNotifications can trigger it
    useEffect(() => {
        window.__refreshTopBarNotifications = loadNotifications;
        return () => { delete window.__refreshTopBarNotifications; };
    }, [loadNotifications]);

    // ─── Close on outside click ───
    useEffect(() => {
        const handler = (e) => {
            if (userMenuRef.current && !userMenuRef.current.contains(e.target)) setShowUserMenu(false);
            if (notifMenuRef.current && !notifMenuRef.current.contains(e.target)) setShowNotifMenu(false);
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, []);

    const handleLogout = async () => {
        try { await logout(); navigate('/login'); }
        catch (err) { console.error('Logout error:', err); }
    };

    const handleNotifClick = async (notif) => {
        if (!notif.is_read) {
            await markAsRead(notif.id);
            setNotifications(prev => prev.map(n => n.id === notif.id ? { ...n, is_read: true } : n));
            setUnreadCount(c => Math.max(0, c - 1));
        }
    };

    const handleMarkAllRead = async () => {
        await markAllAsRead(userProfile.id);
        setNotifications(prev => prev.map(n => ({ ...n, is_read: true })));
        setUnreadCount(0);
    };

    const getPageTitle = () => {
        const path = location.pathname;
        const titles = {
            '/dashboard': 'Dashboard',
            '/inventory': 'Inventory Management',
            '/purchase': 'Purchase Inventory',
            '/production': 'Production Management',
            '/orders': 'Orders',
            '/deliveries': 'Deliveries',
            '/invoices': 'Invoices',
            '/waste': 'Waste Management',
            '/restaurants': 'Restaurants',
            '/notifications': 'Notifications',
            '/users': 'User Management',
            '/reports': 'Reports & Analytics',
            '/settings': 'Settings',
            '/profile': 'My Profile',
            '/restaurant/dashboard': 'Restaurant Dashboard',
            '/restaurant/order': 'Order from Central Kitchen',
            '/restaurant/inventory': 'My Inventory',
            '/restaurant/orders': 'Order History',
            '/restaurant/menu': 'Menu Management',
            '/delivery/dashboard': 'My Deliveries',
            '/delivery/pool': 'Order Pool',
            '/delivery/history': 'Delivery History',
        };
        const matchedPath = Object.keys(titles)
            .filter(key => path.startsWith(key))
            .sort((a, b) => b.length - a.length)[0];
        return matchedPath ? titles[matchedPath] : 'Dashboard';
    };

    const getRoleLabel = (role) => {
        const labels = {
            admin: 'Super Admin',
            ck_staff: 'Kitchen Staff',
            restaurant_manager: 'Restaurant Manager',
            restaurant_manager_non_managed: 'Restaurant Manager',
            delivery_partner: 'Delivery Partner',
        };
        return labels[role] || 'User';
    };

    const getInitials = (name) => {
        if (!name) return 'U';
        return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
    };

    return (
        <header className="topbar">
            <div className="topbar-left">
                <button className="topbar-menu-btn show-mobile-only" onClick={toggleMobile} aria-label="Toggle menu">
                    <MdMenu />
                </button>
                <div className="topbar-title">
                    <h1>{getPageTitle()}</h1>
                </div>
            </div>

            <div className="topbar-center hide-mobile">
                <div className="topbar-search">
                    <MdSearch className="search-icon" />
                    <input
                        type="text"
                        placeholder="Search anything..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="search-input"
                    />
                    <kbd className="search-shortcut">⌘K</kbd>
                </div>
            </div>

            <div className="topbar-right">
                {/* ─── Bell Button + Dropdown ─── */}
                <div className="notif-wrapper" ref={notifMenuRef}>
                    <button
                        className="topbar-icon-btn"
                        aria-label="Notifications"
                        onClick={() => { setShowNotifMenu(v => !v); setShowUserMenu(false); }}
                    >
                        {unreadCount > 0 ? <MdNotifications style={{ color: 'var(--color-primary)' }} /> : <MdNotificationsNone />}
                        {unreadCount > 0 && (
                            <span className="notification-badge">{unreadCount > 99 ? '99+' : unreadCount}</span>
                        )}
                    </button>

                    {showNotifMenu && (
                        <div className="notif-dropdown">
                            {/* Dropdown Header */}
                            <div className="notif-dropdown-header">
                                <span className="notif-dropdown-title">
                                    Notifications {unreadCount > 0 && <span className="notif-count-badge">{unreadCount} new</span>}
                                </span>
                                {unreadCount > 0 && (
                                    <button className="notif-mark-all" onClick={handleMarkAllRead} title="Mark all as read">
                                        <MdDoneAll /> All read
                                    </button>
                                )}
                            </div>

                            {/* Notification Items */}
                            <div className="notif-dropdown-list">
                                {notifications.length === 0 ? (
                                    <div className="notif-dropdown-empty">
                                        <span>🔔</span>
                                        <p>No notifications yet</p>
                                    </div>
                                ) : (
                                    notifications.map(notif => {
                                        const typeInfo = getNotificationType(notif.type);
                                        return (
                                            <div
                                                key={notif.id}
                                                className={`notif-dropdown-item ${notif.is_read ? '' : 'unread'}`}
                                                onClick={() => handleNotifClick(notif)}
                                            >
                                                <div className="notif-dropdown-icon" style={{ background: `${typeInfo.color}20` }}>
                                                    {typeInfo.icon}
                                                </div>
                                                <div className="notif-dropdown-body">
                                                    <div className="notif-dropdown-item-title">{notif.title}</div>
                                                    <div className="notif-dropdown-item-msg">
                                                        {notif.message?.length > 80 ? notif.message.substring(0, 80) + '…' : notif.message}
                                                    </div>
                                                    <div className="notif-dropdown-item-time">{timeAgo(notif.created_at)}</div>
                                                </div>
                                                {!notif.is_read && <div className="notif-dot" />}
                                            </div>
                                        );
                                    })
                                )}
                            </div>

                            {/* View All Footer */}
                            <button
                                className="notif-dropdown-footer"
                                onClick={() => { setShowNotifMenu(false); navigate('/notifications'); }}
                            >
                                <MdOpenInNew style={{ fontSize: 14 }} /> View all notifications
                            </button>
                        </div>
                    )}
                </div>

                {/* ─── User Menu ─── */}
                <div className="topbar-user" ref={userMenuRef}>
                    <button className="topbar-user-btn" onClick={() => { setShowUserMenu(!showUserMenu); setShowNotifMenu(false); }}>
                        <div className="user-avatar">{getInitials(userProfile?.name)}</div>
                        <div className="user-info hide-mobile">
                            <span className="user-name">{userProfile?.name || 'User'}</span>
                            <span className="user-role">{getRoleLabel(userProfile?.role)}</span>
                        </div>
                        <MdKeyboardArrowDown className={`user-arrow hide-mobile ${showUserMenu ? 'rotated' : ''}`} />
                    </button>

                    {showUserMenu && (
                        <div className="user-dropdown">
                            <div className="dropdown-header">
                                <div className="user-avatar lg">{getInitials(userProfile?.name)}</div>
                                <div>
                                    <div className="dropdown-name">{userProfile?.name || 'User'}</div>
                                    <div className="dropdown-email">{userProfile?.email}</div>
                                </div>
                            </div>
                            <div className="dropdown-divider" />
                            <button className="dropdown-item" onClick={() => { setShowUserMenu(false); navigate('/profile'); }}>
                                <MdPerson /> Profile
                            </button>
                            <button className="dropdown-item" onClick={() => { setShowUserMenu(false); navigate('/settings'); }}>
                                <MdSettings /> Settings
                            </button>
                            <div className="dropdown-divider" />
                            <button className="dropdown-item danger" onClick={handleLogout}>
                                <MdLogout /> Sign Out
                            </button>
                        </div>
                    )}
                </div>
            </div>
        </header>
    );
};

export default TopBar;
