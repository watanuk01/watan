import React from 'react';
import { Outlet } from 'react-router-dom';
import Sidebar from '../components/layout/Sidebar';
import TopBar from '../components/layout/TopBar';
import { useSidebar, SidebarProvider } from '../contexts/SidebarContext';
import { useAuth } from '../contexts/AuthContext';
import usePushNotifications from '../hooks/usePushNotifications';
import './DashboardLayout.css';

const DashboardLayoutInner = () => {
    const { isCollapsed, isMobileOpen, closeMobile } = useSidebar();
    const { userProfile } = useAuth();

    // Initialise FCM push notifications for the logged-in user
    const handleNewNotif = React.useCallback(() => {
        if (window.__refreshTopBarNotifications) window.__refreshTopBarNotifications();
    }, []);
    usePushNotifications(userProfile?.id, handleNewNotif);

    return (
        <div className={`dashboard-layout ${isCollapsed ? 'sidebar-collapsed' : ''}`}>
            <Sidebar />
            {isMobileOpen && <div className="sidebar-backdrop" onClick={closeMobile} />}
            <div className="dashboard-main">
                <TopBar />
                <main className="dashboard-content">
                    <Outlet />
                </main>
            </div>
        </div>
    );
};

const DashboardLayout = () => (
    <SidebarProvider>
        <DashboardLayoutInner />
    </SidebarProvider>
);

export default DashboardLayout;
