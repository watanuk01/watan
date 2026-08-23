import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import LoadingSpinner from '../components/ui/LoadingSpinner';

const ProtectedRoute = ({ children, allowedRoles }) => {
    const { currentUser, userProfile, loading } = useAuth();
    const location = useLocation();

    if (loading) {
        return <LoadingSpinner fullScreen />;
    }

    if (!currentUser) {
        return <Navigate to="/login" state={{ from: location }} replace />;
    }

    if (allowedRoles && userProfile && !allowedRoles.includes(userProfile.role)) {
        // Redirect to appropriate dashboard based on role
        const dashboardPath = getDashboardPath(userProfile.role, userProfile.restaurant_id, userProfile);
        return <Navigate to={dashboardPath} replace />;
    }

    return children;
};

export const isSouthallBranch = (profile) => {
    if (!profile) return false;
    const str = `${profile.restaurant_id || ''} ${profile.restaurant_name || ''} ${profile.name || ''}`.toLowerCase();
    return str.includes('southall');
};

export const getDashboardPath = (role, restaurantId, userProfile) => {
    switch (role) {
        case 'admin':
        case 'ck_staff':
            return '/dashboard';
        case 'chef':
            return '/inventory/items';
        case 'butcher':
            return '/butchering/dashboard';
        case 'restaurant_manager':
        case 'restaurant_manager_non_managed':
            if (!isSouthallBranch(userProfile || { restaurant_id: restaurantId })) {
                return '/restaurant/order';
            }
            return '/restaurant/dashboard';
        case 'delivery_partner':
            return '/delivery/dashboard';
        default:
            return '/dashboard';
    }
};

export default ProtectedRoute;
