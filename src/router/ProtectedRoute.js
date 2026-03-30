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
        const dashboardPath = getDashboardPath(userProfile.role);
        return <Navigate to={dashboardPath} replace />;
    }

    return children;
};

export const getDashboardPath = (role) => {
    switch (role) {
        case 'admin':
            return '/dashboard';
        case 'ck_staff':
            return '/dashboard';
        case 'restaurant_manager':
        case 'restaurant_manager_non_managed':
            return '/restaurant/dashboard';
        case 'delivery_partner':
            return '/delivery/dashboard';
        default:
            return '/dashboard';
    }
};

export default ProtectedRoute;
