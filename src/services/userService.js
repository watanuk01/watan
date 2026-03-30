/**
 * User Service — Firebase operations for user management
 * Uses a secondary Firebase app instance to create auth users
 * without affecting the current admin session.
 */

import { initializeApp, deleteApp } from 'firebase/app';
import {
    getAuth,
    createUserWithEmailAndPassword,
    signInWithEmailAndPassword,
    updatePassword,
    sendPasswordResetEmail,
} from 'firebase/auth';
import {
    collection,
    doc,
    getDoc,
    getDocs,
    setDoc,
    updateDoc,
    deleteDoc,
    query,
    orderBy,
    where,
    serverTimestamp,
} from 'firebase/firestore';
import { db } from '../firebase';

// Firebase config for secondary app instance
const firebaseConfig = {
    apiKey: "AIzaSyC9jzSpsomTnfU5nJXx3hynQ94-wc924fE",
    authDomain: "watan-e8290.firebaseapp.com",
    projectId: "watan-e8290",
    storageBucket: "watan-e8290.firebasestorage.app",
    messagingSenderId: "759777665562",
    appId: "1:759777665562:web:c4a7827bd5223002bae7a3",
};

/**
 * Create a new user (Auth + Firestore)
 * Uses a secondary Firebase app so the admin stays logged in
 */
export const createUser = async (userData) => {
    const { email, password, name, role, phone, restaurant_id, restaurant_name } = userData;

    // Create secondary app to avoid signing out admin
    let secondaryApp;
    try {
        secondaryApp = initializeApp(firebaseConfig, `secondary-${Date.now()}`);
        const secondaryAuth = getAuth(secondaryApp);

        // Create user in Firebase Auth
        const credential = await createUserWithEmailAndPassword(secondaryAuth, email, password);
        const uid = credential.user.uid;

        // Sign out from secondary auth immediately
        await secondaryAuth.signOut();

        // Create user profile in Firestore
        const userDocRef = doc(db, 'users', uid);
        const profileData = {
            name,
            email,
            role,
            phone: phone || '',
            status: 'active',
            password, // Store password for admin visibility per requirements
            created_at: serverTimestamp(),
            updated_at: serverTimestamp(),
        };

        if (restaurant_id) {
            profileData.restaurant_id = restaurant_id;
            profileData.restaurant_name = restaurant_name || '';
        }

        await setDoc(userDocRef, profileData);

        return { uid, ...profileData };
    } finally {
        // Clean up secondary app
        if (secondaryApp) {
            await deleteApp(secondaryApp);
        }
    }
};

/**
 * Get all users from Firestore
 */
export const getAllUsers = async () => {
    const usersRef = collection(db, 'users');
    const q = query(usersRef, orderBy('created_at', 'desc'));
    const snapshot = await getDocs(q);

    return snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data(),
        // Convert Firestore timestamps to JS dates
        created_at: doc.data().created_at?.toDate?.() || null,
        updated_at: doc.data().updated_at?.toDate?.() || null,
    }));
};

/**
 * Get a single user by UID
 */
export const getUserById = async (uid) => {
    const userDoc = await getDoc(doc(db, 'users', uid));
    if (!userDoc.exists()) return null;
    return {
        id: userDoc.id,
        ...userDoc.data(),
        created_at: userDoc.data().created_at?.toDate?.() || null,
        updated_at: userDoc.data().updated_at?.toDate?.() || null,
    };
};

/**
 * Update user profile in Firestore
 */
export const updateUser = async (uid, updates) => {
    const userRef = doc(db, 'users', uid);
    const updateData = {
        ...updates,
        updated_at: serverTimestamp(),
    };

    // Remove undefined values
    Object.keys(updateData).forEach(key => {
        if (updateData[key] === undefined) delete updateData[key];
    });

    await updateDoc(userRef, updateData);
    return { id: uid, ...updateData };
};

/**
 * Delete user profile from Firestore
 * Note: Firebase Auth deletion requires Admin SDK (Cloud Function)
 * For now, we mark the user as 'disabled' in Firestore
 */
export const disableUser = async (uid) => {
    const userRef = doc(db, 'users', uid);
    await updateDoc(userRef, {
        status: 'disabled',
        updated_at: serverTimestamp(),
    });
};

/**
 * Permanently delete user from Firestore
 * Note: Auth account remains (requires Admin SDK to delete)
 */
export const deleteUserDoc = async (uid) => {
    await deleteDoc(doc(db, 'users', uid));
};

/**
 * Get users by role
 */
export const getUsersByRole = async (role) => {
    const usersRef = collection(db, 'users');
    const q = query(usersRef, where('role', '==', role));
    const snapshot = await getDocs(q);

    return snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data(),
        created_at: doc.data().created_at?.toDate?.() || null,
        updated_at: doc.data().updated_at?.toDate?.() || null,
    }));
};

/**
 * Role labels for display
 */
export const ROLE_OPTIONS = [
    { value: 'admin', label: 'Super Admin' },
    { value: 'ck_staff', label: 'Central Kitchen Staff' },
    { value: 'restaurant_manager', label: 'Restaurant Manager (Managed)' },
    { value: 'restaurant_manager_non_managed', label: 'Restaurant Manager (Non-Managed)' },
    { value: 'delivery_partner', label: 'Delivery Partner' },
];

export const getRoleLabel = (role) => {
    const found = ROLE_OPTIONS.find(r => r.value === role);
    return found ? found.label : role;
};

/**
 * Reset User Password
 * Uses the secondary app trick to login as the user, change their password, and update Firestore
 */
export const resetUserPassword = async (uid, email, currentPassword, newPassword) => {
    let secondaryApp;
    try {
        secondaryApp = initializeApp(firebaseConfig, `secondary-${Date.now()}`);
        const secondaryAuth = getAuth(secondaryApp);

        // 1. Log in the secondary instance as the target user using their current known password
        const credential = await signInWithEmailAndPassword(secondaryAuth, email, currentPassword);

        // 2. Change their auth password
        await updatePassword(credential.user, newPassword);

        // 3. Sign out of secondary instance
        await secondaryAuth.signOut();

        // 4. Update the password stored in Firestore so admins can continue to see it
        const userRef = doc(db, 'users', uid);
        await updateDoc(userRef, {
            password: newPassword,
            updated_at: serverTimestamp(),
        });

    } finally {
        if (secondaryApp) {
            await deleteApp(secondaryApp);
        }
    }
};

/**
 * Send Password Reset Email (Fallback for Legacy Users)
 */
export const sendResetEmailToUser = async (email) => {
    const auth = getAuth();
    await sendPasswordResetEmail(auth, email);
};
