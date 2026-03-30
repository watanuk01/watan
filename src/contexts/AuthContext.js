import React, { createContext, useContext, useState, useEffect } from 'react';
import {
    signInWithEmailAndPassword,
    signOut,
    sendPasswordResetEmail,
    onAuthStateChanged,
} from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { auth, db } from '../firebase';

const AuthContext = createContext(null);

export const useAuth = () => {
    const context = useContext(AuthContext);
    if (!context) {
        throw new Error('useAuth must be used within an AuthProvider');
    }
    return context;
};

export const AuthProvider = ({ children }) => {
    const [currentUser, setCurrentUser] = useState(null);
    const [userProfile, setUserProfile] = useState(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const unsubscribe = onAuthStateChanged(auth, async (user) => {
            setCurrentUser(user);
            if (user) {
                try {
                    const userDoc = await getDoc(doc(db, 'users', user.uid));
                    if (userDoc.exists()) {
                        setUserProfile({ id: user.uid, ...userDoc.data() });
                    } else {
                        // User exists in auth but not in Firestore
                        setUserProfile({
                            id: user.uid,
                            email: user.email,
                            name: user.displayName || 'User',
                            role: 'restaurant_manager', // default role
                        });
                    }
                } catch (error) {
                    console.error('Error fetching user profile:', error);
                    setUserProfile({
                        id: user.uid,
                        email: user.email,
                        name: user.displayName || 'User',
                        role: 'restaurant_manager',
                    });
                }
            } else {
                setUserProfile(null);
            }
            setLoading(false);
        });

        return unsubscribe;
    }, []);

    const login = async (email, password) => {
        const result = await signInWithEmailAndPassword(auth, email, password);
        return result;
    };

    const logout = async () => {
        await signOut(auth);
        setUserProfile(null);
    };

    const resetPassword = async (email) => {
        await sendPasswordResetEmail(auth, email);
    };

    const hasRole = (roles) => {
        if (!userProfile) return false;
        if (typeof roles === 'string') return userProfile.role === roles;
        return roles.includes(userProfile.role);
    };

    const isAdmin = () => hasRole('admin');
    const isCKStaff = () => hasRole(['admin', 'ck_staff']);
    const isRestaurantManager = () => hasRole(['restaurant_manager', 'restaurant_manager_non_managed']);
    const isDeliveryPartner = () => hasRole('delivery_partner');

    const value = {
        currentUser,
        userProfile,
        loading,
        login,
        logout,
        resetPassword,
        hasRole,
        isAdmin,
        isCKStaff,
        isRestaurantManager,
        isDeliveryPartner,
    };

    return (
        <AuthContext.Provider value={value}>
            {children}
        </AuthContext.Provider>
    );
};

export default AuthContext;
