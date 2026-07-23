import React from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { useSidebar } from '../../contexts/SidebarContext';
import {
    MdDashboard,
    MdInventory2,
    MdShoppingCart,
    MdRestaurant,
    MdLocalShipping,
    MdReceipt,
    MdDelete,
    MdStore,
    MdNotifications,
    MdPeople,
    MdBarChart,
    MdSettings,
    MdMenuBook,
    MdHistory,
    MdOutlineKitchen,
    MdChevronLeft,
    MdChevronRight,
    MdExpandMore,
    MdExpandLess,
    MdPool,
    MdSync,
} from 'react-icons/md';
import { isSouthallBranch } from '../../router/ProtectedRoute';
import './Sidebar.css';

const Sidebar = () => {
    const { userProfile } = useAuth();
    const {
        isCollapsed,
        isMobileOpen,
        activeSubmenu,
        toggleCollapse,
        closeMobile,
        toggleSubmenu,
    } = useSidebar();

    const location = useLocation();
    const role = userProfile?.role || 'admin';

    const getNavItems = () => {
        const isSouthall = isSouthallBranch(userProfile);

        switch (role) {
            case 'admin':
            case 'ck_staff':
                return [
                    { type: 'item', label: 'Dashboard', icon: MdDashboard, path: '/dashboard' },
                    { type: 'divider' },
                    { type: 'section', label: 'Central Kitchen' },
                    {
                        type: 'submenu', label: 'Inventory', icon: MdInventory2, key: 'inventory',
                        children: [
                            { label: 'Items Master', path: '/inventory/items' },
                            { label: 'Current Stock', path: '/inventory/stock' },
                            { label: 'Batches', path: '/inventory/batches' },
                            { label: 'Low Stock Alerts', path: '/inventory/low-stock' },
                            { label: 'Bulk Upload', path: '/inventory/bulk-upload' },
                        ]
                    },
                    {
                        type: 'submenu', label: 'Purchase', icon: MdShoppingCart, key: 'purchase',
                        children: [
                            { label: 'Create Order', path: '/purchase/create' },
                            { label: 'Pending Orders', path: '/purchase/pending' },
                            { label: 'Purchase History', path: '/purchase/history' },
                        ]
                    },
                    {
                        type: 'submenu', label: 'Production', icon: MdOutlineKitchen, key: 'production',
                        children: [
                            { label: 'Start Production', path: '/production/start' },
                            { label: 'In Progress', path: '/production/in-progress' },
                            { label: 'Production History', path: '/production/history' },
                            { label: 'Production Invoices', path: '/production/invoices' },
                        ]
                    },
                    {
                        type: 'submenu', label: 'Orders', icon: MdReceipt, key: 'orders',
                        children: [
                            { label: "Today's Orders", path: '/orders/today' },
                            { label: 'Undelivered Orders', path: '/orders/undelivered' },
                        ]
                    },
                    {
                        type: 'submenu', label: 'Deliveries', icon: MdLocalShipping, key: 'deliveries',
                        children: [
                            { label: 'Delivery Management', path: '/deliveries/manage' },
                            { label: 'Delivery Analytics', path: '/deliveries/analytics' },
                        ]
                    },
                    {
                        type: 'submenu', label: 'Invoices', icon: MdReceipt, key: 'invoices',
                        children: [
                            { label: 'All Invoices', path: '/invoices/all' },
                            { label: 'Consolidated', path: '/invoices/consolidated' },
                        ]
                    },
                    { type: 'item', label: 'Waste Management', icon: MdDelete, path: '/waste' },
                    { type: 'divider' },
                    { type: 'section', label: 'Management' },
                    { type: 'item', label: 'Restaurants', icon: MdStore, path: '/restaurants' },
                    { type: 'item', label: 'Notifications', icon: MdNotifications, path: '/notifications' },
                    ...(role === 'admin' ? [
                        { type: 'item', label: 'User Management', icon: MdPeople, path: '/users' },
                    ] : []),
                    { type: 'item', label: 'Reports & Analytics', icon: MdBarChart, path: '/reports' },
                    { type: 'item', label: 'Item Sales Report', icon: MdReceipt, path: '/reports/item-sales' },
                    ...(role === 'admin' ? [
                        { type: 'item', label: 'Settings', icon: MdSettings, path: '/settings' },
                    ] : []),
                ];

            case 'chef':
                return [
                    { type: 'section', label: 'Central Kitchen' },
                    {
                        type: 'submenu', label: 'Inventory', icon: MdInventory2, key: 'inventory',
                        children: [
                            { label: 'Items Master', path: '/inventory/items' },
                            { label: 'Current Stock', path: '/inventory/stock' },
                            { label: 'Batches', path: '/inventory/batches' },
                            { label: 'Low Stock Alerts', path: '/inventory/low-stock' },
                            { label: 'Bulk Upload', path: '/inventory/bulk-upload' },
                        ]
                    },
                    {
                        type: 'submenu', label: 'Purchase', icon: MdShoppingCart, key: 'purchase',
                        children: [
                            { label: 'Create Order', path: '/purchase/create' },
                            { label: 'Pending Orders', path: '/purchase/pending' },
                            { label: 'Purchase History', path: '/purchase/history' },
                        ]
                    },
                    {
                        type: 'submenu', label: 'Production', icon: MdOutlineKitchen, key: 'production',
                        children: [
                            { label: 'Start Production', path: '/production/start' },
                            { label: 'In Progress', path: '/production/in-progress' },
                            { label: 'Production History', path: '/production/history' },
                        ]
                    },
                    {
                        type: 'submenu', label: 'Orders', icon: MdReceipt, key: 'orders',
                        children: [
                            { label: "Today's Orders", path: '/orders/today' },
                            { label: 'Undelivered Orders', path: '/orders/undelivered' },
                        ]
                    },
                    {
                        type: 'submenu', label: 'Deliveries', icon: MdLocalShipping, key: 'deliveries',
                        children: [
                            { label: 'Delivery Management', path: '/deliveries/manage' },
                        ]
                    },
                    { type: 'divider' },
                    { type: 'item', label: 'Notifications', icon: MdNotifications, path: '/notifications' },
                ];

            case 'restaurant_manager':
                return [
                    ...(isSouthall ? [
                        { type: 'item', label: 'Dashboard', icon: MdDashboard, path: '/restaurant/dashboard' },
                    ] : []),
                    { type: 'divider' },
                    { type: 'section', label: 'Operations' },
                    { type: 'item', label: 'Order from CK', icon: MdShoppingCart, path: '/restaurant/order' },
                    { type: 'item', label: 'My Inventory', icon: MdInventory2, path: '/restaurant/inventory' },
                    { type: 'item', label: 'Order History', icon: MdHistory, path: '/restaurant/orders' },
                    { type: 'item', label: 'Waste Management', icon: MdDelete, path: '/waste' },
                    { type: 'item', label: 'Menu Management', icon: MdMenuBook, path: '/restaurant/menu' },
                    { type: 'item', label: 'EPOS Mapping', icon: MdSync, path: '/restaurant/epos-mapping' },
                    { type: 'divider' },
                    { type: 'item', label: 'Notifications', icon: MdNotifications, path: '/notifications' },
                ];

            case 'restaurant_manager_non_managed':
                return [
                    ...(isSouthall ? [
                        { type: 'item', label: 'Dashboard', icon: MdDashboard, path: '/restaurant/dashboard' },
                    ] : []),
                    { type: 'divider' },
                    { type: 'section', label: 'Operations' },
                    { type: 'item', label: 'Order from CK', icon: MdShoppingCart, path: '/restaurant/order' },
                    { type: 'item', label: 'My Inventory', icon: MdInventory2, path: '/restaurant/inventory' },
                    { type: 'item', label: 'Order History', icon: MdHistory, path: '/restaurant/orders' },
                    { type: 'item', label: 'Waste Management', icon: MdDelete, path: '/waste' },
                    { type: 'divider' },
                    { type: 'item', label: 'Notifications', icon: MdNotifications, path: '/notifications' },
                ];

            case 'delivery_partner':
                return [
                    { type: 'item', label: 'My Deliveries', icon: MdLocalShipping, path: '/delivery/dashboard' },
                    { type: 'item', label: 'Order Pool', icon: MdPool, path: '/delivery/pool' },
                    { type: 'item', label: 'Delivery History', icon: MdHistory, path: '/delivery/history' },
                    { type: 'divider' },
                    { type: 'item', label: 'Notifications', icon: MdNotifications, path: '/notifications' },
                ];

            default:
                return [];
        }
    };

    const isSubmenuActive = (children) => {
        return children?.some(child => location.pathname.startsWith(child.path));
    };

    const navItems = getNavItems();

    // On mobile, always show expanded sidebar when open (ignore isCollapsed)
    const showExpanded = isMobileOpen || !isCollapsed;

    return (
        <aside className={`sidebar ${isCollapsed && !isMobileOpen ? 'collapsed' : ''} ${isMobileOpen ? 'mobile-open' : ''}`}>
            {/* Logo Section */}
            <div className="sidebar-logo">
                <div className="sidebar-logo-icon">
                    <span className="logo-arabic">وطن</span>
                </div>
                {showExpanded && (
                    <div className="sidebar-logo-text">
                        <span className="logo-brand">WATAN</span>
                        <span className="logo-sub">Central Kitchen</span>
                    </div>
                )}
            </div>

            {/* Navigation */}
            <nav className="sidebar-nav">
                {navItems.map((item, index) => {
                    if (item.type === 'divider') {
                        return <div key={`d-${index}`} className="sidebar-divider" />;
                    }

                    if (item.type === 'section') {
                        if (!showExpanded) return null;
                        return (
                            <div key={`s-${index}`} className="sidebar-section-label">
                                {item.label}
                            </div>
                        );
                    }

                    if (item.type === 'submenu') {
                        const isActive = activeSubmenu === item.key || isSubmenuActive(item.children);
                        const isOpen = activeSubmenu === item.key;

                        return (
                            <div key={item.key} className={`sidebar-submenu ${isActive ? 'active' : ''}`}>
                                <button
                                    className={`sidebar-nav-item submenu-trigger ${isActive ? 'active' : ''}`}
                                    onClick={() => toggleSubmenu(item.key)}
                                    title={!showExpanded ? item.label : undefined}
                                >
                                    <item.icon className="nav-icon" />
                                    {showExpanded && (
                                        <>
                                            <span className="nav-label">{item.label}</span>
                                            {isOpen ? <MdExpandLess className="nav-arrow" /> : <MdExpandMore className="nav-arrow" />}
                                        </>
                                    )}
                                </button>
                                {showExpanded && isOpen && (
                                    <div className="submenu-items">
                                        {item.children.map(child => (
                                            <NavLink
                                                key={child.path}
                                                to={child.path}
                                                className={({ isActive }) =>
                                                    `sidebar-nav-item submenu-item ${isActive ? 'active' : ''}`
                                                }
                                                onClick={closeMobile}
                                            >
                                                <span className="submenu-dot" />
                                                <span className="nav-label">{child.label}</span>
                                            </NavLink>
                                        ))}
                                    </div>
                                )}
                            </div>
                        );
                    }

                    // Regular nav item
                    return (
                        <NavLink
                            key={item.path}
                            to={item.path}
                            className={({ isActive }) =>
                                `sidebar-nav-item ${isActive ? 'active' : ''}`
                            }
                            onClick={closeMobile}
                            title={!showExpanded ? item.label : undefined}
                        >
                            <item.icon className="nav-icon" />
                            {showExpanded && <span className="nav-label">{item.label}</span>}
                        </NavLink>
                    );
                })}
            </nav>

            {/* Collapse Toggle */}
            <button
                className="sidebar-toggle hide-mobile"
                onClick={toggleCollapse}
                aria-label={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            >
                {isCollapsed ? <MdChevronRight /> : <MdChevronLeft />}
            </button>
        </aside>
    );
};

export default Sidebar;
