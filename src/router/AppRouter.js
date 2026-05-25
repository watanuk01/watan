import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import ProtectedRoute from './ProtectedRoute';
import { getDashboardPath } from './ProtectedRoute';

// Layout
import DashboardLayout from '../layouts/DashboardLayout';

// Auth Pages
import LoginPage from '../pages/auth/LoginPage';
import ForgotPasswordPage from '../pages/auth/ForgotPasswordPage';

// Dashboard Pages
import AdminDashboard from '../pages/dashboard/AdminDashboard';
import RestaurantDashboard from '../pages/dashboard/RestaurantDashboard';
import DeliveryDashboard from '../pages/dashboard/DeliveryDashboard';

// User Management
import UserManagement from '../pages/users/UserManagement';
import ProfilePage from '../pages/profile/ProfilePage';
import SettingsPage from '../pages/settings/SettingsPage';

// Inventory
import InventoryItems from '../pages/inventory/InventoryItems';
import CurrentStock from '../pages/inventory/CurrentStock';
import Batches from '../pages/inventory/Batches';
import LowStockAlerts from '../pages/inventory/LowStockAlerts';
import BulkUpload from '../pages/inventory/BulkUpload';

// Purchase
import CreatePurchaseOrder from '../pages/purchase/CreatePurchaseOrder';
import PendingOrders from '../pages/purchase/PendingOrders';
import PurchaseHistory from '../pages/purchase/PurchaseHistory';

// Production
import StartProduction from '../pages/production/StartProduction';
import InProgress from '../pages/production/InProgress';
import ProductionHistory from '../pages/production/ProductionHistory';
import ProductionInvoices from '../pages/production/ProductionInvoices';

// Orders (CK)
import TodaysOrders from '../pages/orders/TodaysOrders';
import UndeliveredOrders from '../pages/orders/UndeliveredOrders';

// Restaurant
import PlaceOrder from '../pages/restaurant/PlaceOrder';
import OrderHistory from '../pages/restaurant/OrderHistory';
import RestaurantInventory from '../pages/restaurant/RestaurantInventory';
import RestaurantInvoices from '../pages/restaurant/RestaurantInvoices';
import MenuManagement from '../pages/restaurant/MenuManagement';
import EposMapping from '../pages/restaurant/EposMapping';

// Delivery
import DeliveryOrders from '../pages/delivery/DeliveryOrders';
import AdminDeliveryManagement from '../pages/delivery/AdminDeliveryManagement';
import DeliveryAnalytics from '../pages/delivery/DeliveryAnalytics';

// Invoices
import InvoicesPage from '../pages/invoices/InvoicesPage';

// Waste Management
import WasteManagement from '../pages/waste/WasteManagement';

// Notifications
import NotificationsPage from '../pages/notifications/NotificationsPage';

// Reports & Analytics
import ReportsPage from '../pages/reports/ReportsPage';

// Restaurants Management
import RestaurantsPage from '../pages/restaurants/RestaurantsPage';

// Xero OAuth Callback
import XeroCallback from '../pages/settings/XeroCallback';

// Placeholder page for future modules
const PlaceholderPage = ({ title }) => (
    <div style={{ padding: 'var(--space-8)' }}>
        <h1 style={{
            fontFamily: 'var(--font-heading)',
            color: 'var(--color-text-primary)',
            marginBottom: 'var(--space-4)'
        }}>
            {title}
        </h1>
        <p style={{ color: 'var(--color-text-secondary)' }}>
            This module is under development and will be available soon.
        </p>
    </div>
);

const AppRouter = () => {
    const { currentUser, userProfile } = useAuth();

    return (
        <BrowserRouter>
            <Routes>
                {/* ─── Public Routes ─── */}
                <Route
                    path="/login"
                    element={
                        currentUser ? (
                            <Navigate to={getDashboardPath(userProfile?.role)} replace />
                        ) : (
                            <LoginPage />
                        )
                    }
                />
                <Route
                    path="/forgot-password"
                    element={
                        currentUser ? (
                            <Navigate to={getDashboardPath(userProfile?.role)} replace />
                        ) : (
                            <ForgotPasswordPage />
                        )
                    }
                />

                {/* ─── Xero OAuth Callback (inside protected area, admin only) ─── */}
                <Route
                    path="/callback"
                    element={
                        <ProtectedRoute allowedRoles={['admin']}>
                            <XeroCallback />
                        </ProtectedRoute>
                    }
                />

                {/* ─── Protected Routes (Dashboard Layout) ─── */}
                <Route
                    element={
                        <ProtectedRoute>
                            <DashboardLayout />
                        </ProtectedRoute>
                    }
                >
                    {/* Admin / CK Staff Dashboard */}
                    <Route
                        path="/dashboard"
                        element={
                            <ProtectedRoute allowedRoles={['admin', 'ck_staff']}>
                                <AdminDashboard />
                            </ProtectedRoute>
                        }
                    />

                    {/* ─── Central Kitchen Modules (Admin + CK Staff) ─── */}

                    {/* Inventory Sub-routes */}
                    <Route
                        path="/inventory/items"
                        element={
                            <ProtectedRoute allowedRoles={['admin', 'ck_staff']}>
                                <InventoryItems />
                            </ProtectedRoute>
                        }
                    />
                    <Route
                        path="/inventory/stock"
                        element={
                            <ProtectedRoute allowedRoles={['admin', 'ck_staff']}>
                                <CurrentStock />
                            </ProtectedRoute>
                        }
                    />
                    <Route
                        path="/inventory/batches"
                        element={
                            <ProtectedRoute allowedRoles={['admin', 'ck_staff']}>
                                <Batches />
                            </ProtectedRoute>
                        }
                    />
                    <Route
                        path="/inventory/low-stock"
                        element={
                            <ProtectedRoute allowedRoles={['admin', 'ck_staff']}>
                                <LowStockAlerts />
                            </ProtectedRoute>
                        }
                    />
                    <Route
                        path="/inventory/bulk-upload"
                        element={
                            <ProtectedRoute allowedRoles={['admin', 'ck_staff']}>
                                <BulkUpload />
                            </ProtectedRoute>
                        }
                    />
                    <Route
                        path="/purchase/create"
                        element={
                            <ProtectedRoute allowedRoles={['admin', 'ck_staff']}>
                                <CreatePurchaseOrder />
                            </ProtectedRoute>
                        }
                    />
                    <Route
                        path="/purchase/pending"
                        element={
                            <ProtectedRoute allowedRoles={['admin', 'ck_staff']}>
                                <PendingOrders />
                            </ProtectedRoute>
                        }
                    />
                    <Route
                        path="/purchase/history"
                        element={
                            <ProtectedRoute allowedRoles={['admin', 'ck_staff']}>
                                <PurchaseHistory />
                            </ProtectedRoute>
                        }
                    />
                    <Route
                        path="/production/start"
                        element={
                            <ProtectedRoute allowedRoles={['admin', 'ck_staff']}>
                                <StartProduction />
                            </ProtectedRoute>
                        }
                    />
                    <Route
                        path="/production/in-progress"
                        element={
                            <ProtectedRoute allowedRoles={['admin', 'ck_staff']}>
                                <InProgress />
                            </ProtectedRoute>
                        }
                    />
                    <Route
                        path="/production/history"
                        element={
                            <ProtectedRoute allowedRoles={['admin', 'ck_staff']}>
                                <ProductionHistory />
                            </ProtectedRoute>
                        }
                    />
                    <Route
                        path="/production/invoices"
                        element={
                            <ProtectedRoute allowedRoles={['admin', 'ck_staff']}>
                                <ProductionInvoices />
                            </ProtectedRoute>
                        }
                    />
                    <Route
                        path="/orders/today"
                        element={
                            <ProtectedRoute allowedRoles={['admin', 'ck_staff']}>
                                <TodaysOrders />
                            </ProtectedRoute>
                        }
                    />
                    <Route
                        path="/orders/undelivered"
                        element={
                            <ProtectedRoute allowedRoles={['admin', 'ck_staff']}>
                                <UndeliveredOrders />
                            </ProtectedRoute>
                        }
                    />
                    <Route
                        path="/orders/*"
                        element={
                            <ProtectedRoute allowedRoles={['admin', 'ck_staff']}>
                                <TodaysOrders />
                            </ProtectedRoute>
                        }
                    />
                    <Route
                        path="/deliveries/manage"
                        element={
                            <ProtectedRoute allowedRoles={['admin', 'ck_staff']}>
                                <AdminDeliveryManagement />
                            </ProtectedRoute>
                        }
                    />
                    <Route
                        path="/deliveries/analytics"
                        element={
                            <ProtectedRoute allowedRoles={['admin', 'ck_staff']}>
                                <DeliveryAnalytics />
                            </ProtectedRoute>
                        }
                    />
                    <Route
                        path="/invoices/*"
                        element={
                            <ProtectedRoute allowedRoles={['admin', 'ck_staff']}>
                                <InvoicesPage />
                            </ProtectedRoute>
                        }
                    />
                    <Route
                        path="/waste/*"
                        element={
                            <ProtectedRoute allowedRoles={['admin', 'ck_staff', 'restaurant_manager', 'restaurant_manager_non_managed']}>
                                <WasteManagement />
                            </ProtectedRoute>
                        }
                    />
                    <Route
                        path="/restaurants/*"
                        element={
                            <ProtectedRoute allowedRoles={['admin']}>
                                <RestaurantsPage />
                            </ProtectedRoute>
                        }
                    />
                    <Route
                        path="/restaurants/:id/dashboard"
                        element={
                            <ProtectedRoute allowedRoles={['admin']}>
                                <RestaurantDashboard />
                            </ProtectedRoute>
                        }
                    />
                    <Route
                        path="/notifications/*"
                        element={
                            <NotificationsPage />
                        }
                    />
                    <Route
                        path="/users/*"
                        element={
                            <ProtectedRoute allowedRoles={['admin']}>
                                <UserManagement />
                            </ProtectedRoute>
                        }
                    />
                    <Route
                        path="/reports/*"
                        element={
                            <ProtectedRoute allowedRoles={['admin', 'ck_staff']}>
                                <ReportsPage />
                            </ProtectedRoute>
                        }
                    />
                    <Route
                        path="/settings/*"
                        element={
                            <ProtectedRoute allowedRoles={['admin']}>
                                <SettingsPage />
                            </ProtectedRoute>
                        }
                    />

                    {/* Profile — accessible to all roles */}
                    <Route path="/profile" element={<ProfilePage />} />

                    {/* ─── Restaurant Modules ─── */}
                    <Route
                        path="/restaurant/dashboard"
                        element={
                            <ProtectedRoute allowedRoles={['restaurant_manager', 'restaurant_manager_non_managed']}>
                                <RestaurantDashboard />
                            </ProtectedRoute>
                        }
                    />
                    <Route
                        path="/restaurant/order/*"
                        element={
                            <ProtectedRoute allowedRoles={['restaurant_manager', 'restaurant_manager_non_managed']}>
                                <PlaceOrder />
                            </ProtectedRoute>
                        }
                    />
                    <Route
                        path="/restaurant/inventory/*"
                        element={
                            <ProtectedRoute allowedRoles={['restaurant_manager', 'restaurant_manager_non_managed']}>
                                <RestaurantInventory />
                            </ProtectedRoute>
                        }
                    />
                    <Route
                        path="/restaurant/orders/*"
                        element={
                            <ProtectedRoute allowedRoles={['restaurant_manager', 'restaurant_manager_non_managed']}>
                                <OrderHistory />
                            </ProtectedRoute>
                        }
                    />
                    <Route
                        path="/restaurant/invoices/*"
                        element={
                            <ProtectedRoute allowedRoles={['restaurant_manager', 'restaurant_manager_non_managed']}>
                                <RestaurantInvoices />
                            </ProtectedRoute>
                        }
                    />
                    <Route
                        path="/restaurant/menu/*"
                        element={
                            <ProtectedRoute allowedRoles={['restaurant_manager']}>
                                <MenuManagement />
                            </ProtectedRoute>
                        }
                    />
                    <Route
                        path="/restaurant/epos-mapping"
                        element={
                            <ProtectedRoute allowedRoles={['restaurant_manager']}>
                                <EposMapping />
                            </ProtectedRoute>
                        }
                    />

                    {/* ─── Delivery Partner Modules ─── */}
                    <Route
                        path="/delivery/dashboard"
                        element={
                            <ProtectedRoute allowedRoles={['delivery_partner']}>
                                <DeliveryDashboard />
                            </ProtectedRoute>
                        }
                    />
                    <Route
                        path="/delivery/pool/*"
                        element={
                            <ProtectedRoute allowedRoles={['delivery_partner']}>
                                <DeliveryOrders />
                            </ProtectedRoute>
                        }
                    />
                    <Route
                        path="/delivery/history/*"
                        element={
                            <ProtectedRoute allowedRoles={['delivery_partner']}>
                                <DeliveryOrders />
                            </ProtectedRoute>
                        }
                    />
                </Route>

                {/* ─── Catch-all Redirect ─── */}
                <Route path="*" element={<Navigate to="/login" replace />} />
            </Routes>
        </BrowserRouter>
    );
};

export default AppRouter;
