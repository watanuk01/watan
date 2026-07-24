import React, { useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { updateUser, getRoleLabel } from '../../services/userService';
import {
    updatePassword,
    EmailAuthProvider,
    reauthenticateWithCredential,
} from 'firebase/auth';
import { auth } from '../../firebase';
import {
    MdPerson,
    MdEmail,
    MdBadge,
    MdPhone,
    MdStore,
    MdLock,
    MdVisibility,
    MdVisibilityOff,
    MdCheckCircle,
    MdSave,
} from 'react-icons/md';
import toast from 'react-hot-toast';
import './ProfilePage.css';

const ProfilePage = () => {
    const { userProfile, currentUser } = useAuth();
    const [isEditing, setIsEditing] = useState(false);
    const [name, setName] = useState(userProfile?.name || '');
    const [phone, setPhone] = useState(userProfile?.phone || '');
    const [saving, setSaving] = useState(false);

    // Password change
    const [showPasswordForm, setShowPasswordForm] = useState(false);
    const [currentPassword, setCurrentPassword] = useState('');
    const [newPassword, setNewPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [showCurrentPwd, setShowCurrentPwd] = useState(false);
    const [showNewPwd, setShowNewPwd] = useState(false);
    const [changingPassword, setChangingPassword] = useState(false);

    const handleSaveProfile = async () => {
        if (!name.trim()) {
            toast.error('Name cannot be empty');
            return;
        }
        setSaving(true);
        try {
            await updateUser(userProfile.id, { name, phone });
            toast.success('Profile updated successfully');
            setIsEditing(false);
        } catch (err) {
            console.error('Error updating profile:', err);
            toast.error('Failed to update profile');
        } finally {
            setSaving(false);
        }
    };

    const handleChangePassword = async (e) => {
        e.preventDefault();

        if (!currentPassword) {
            toast.error('Please enter your current password');
            return;
        }
        if (!newPassword || newPassword.length < 6) {
            toast.error('New password must be at least 6 characters');
            return;
        }
        if (newPassword !== confirmPassword) {
            toast.error('Passwords do not match');
            return;
        }

        setChangingPassword(true);
        try {
            // Re-authenticate
            const credential = EmailAuthProvider.credential(currentUser.email, currentPassword);
            await reauthenticateWithCredential(currentUser, credential);

            // Update password
            await updatePassword(currentUser, newPassword);

            toast.success('Password changed successfully');
            setShowPasswordForm(false);
            setCurrentPassword('');
            setNewPassword('');
            setConfirmPassword('');
        } catch (err) {
            console.error('Error changing password:', err);
            if (err.code === 'auth/wrong-password' || err.code === 'auth/invalid-credential') {
                toast.error('Current password is incorrect');
            } else {
                toast.error('Failed to change password');
            }
        } finally {
            setChangingPassword(false);
        }
    };

    return (
        <div className="profile-page">
            <div className="page-header">
                <div>
                    <h2 className="page-title">My Profile</h2>
                    <p className="page-subtitle">View and manage your account information</p>
                </div>
            </div>

            <div className="profile-layout">
                {/* Profile Card */}
                <div className="profile-card">
                    <div className="profile-card-avatar">
                        {userProfile?.name ? userProfile.name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2) : 'U'}
                    </div>
                    <h3 className="profile-card-name">{userProfile?.name}</h3>
                    <span className="badge badge-primary">{getRoleLabel(userProfile?.role)}</span>
                    <div className="profile-card-meta">
                        <span><MdEmail /> {userProfile?.email}</span>
                        {userProfile?.phone && <span><MdPhone /> {userProfile?.phone}</span>}
                        {userProfile?.restaurant_name && <span><MdStore /> {userProfile?.restaurant_name}</span>}
                    </div>
                </div>

                {/* Details Section */}
                <div className="profile-details">
                    {/* Personal Information */}
                    <div className="card">
                        <div className="card-header">
                            <h3><MdPerson style={{ marginRight: 8, verticalAlign: 'middle' }} /> Personal Information</h3>
                            {!isEditing ? (
                                <button className="btn btn-ghost btn-sm" onClick={() => setIsEditing(true)}>
                                    Edit
                                </button>
                            ) : (
                                <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
                                    <button
                                        className="btn btn-ghost btn-sm"
                                        onClick={() => {
                                            setIsEditing(false);
                                            setName(userProfile?.name || '');
                                            setPhone(userProfile?.phone || '');
                                        }}
                                        disabled={saving}
                                    >
                                        Cancel
                                    </button>
                                    <button className="btn btn-primary btn-sm" onClick={handleSaveProfile} disabled={saving}>
                                        {saving ? 'Saving...' : <><MdSave /> Save</>}
                                    </button>
                                </div>
                            )}
                        </div>
                        <div className="card-body">
                            <div className="profile-fields">
                                <div className="profile-field">
                                    <label className="profile-field-label">Full Name</label>
                                    {isEditing ? (
                                        <input
                                            type="text"
                                            className="form-input"
                                            value={name}
                                            onChange={(e) => setName(e.target.value)}
                                        />
                                    ) : (
                                        <span className="profile-field-value">{userProfile?.name}</span>
                                    )}
                                </div>
                                <div className="profile-field">
                                    <label className="profile-field-label">Email Address</label>
                                    <span className="profile-field-value">{userProfile?.email}</span>
                                </div>
                                <div className="profile-field">
                                    <label className="profile-field-label">Phone Number</label>
                                    {isEditing ? (
                                        <input
                                            type="tel"
                                            className="form-input"
                                            value={phone}
                                            onChange={(e) => setPhone(e.target.value)}
                                            placeholder="+44 7000 000000"
                                        />
                                    ) : (
                                        <span className="profile-field-value">{userProfile?.phone || '—'}</span>
                                    )}
                                </div>
                                <div className="profile-field">
                                    <label className="profile-field-label">Role</label>
                                    <span className="profile-field-value">
                                        <span className="badge badge-primary">{getRoleLabel(userProfile?.role)}</span>
                                    </span>
                                </div>
                                {userProfile?.restaurant_name && (
                                    <div className="profile-field">
                                        <label className="profile-field-label">Restaurant</label>
                                        <span className="profile-field-value">{userProfile?.restaurant_name}</span>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>

                    {/* Change Password */}
                    <div className="card">
                        <div className="card-header">
                            <h3><MdLock style={{ marginRight: 8, verticalAlign: 'middle' }} /> Security</h3>
                        </div>
                        <div className="card-body">
                            {!showPasswordForm ? (
                                <div className="security-info">
                                    <p style={{ color: 'var(--color-text-secondary)', marginBottom: 'var(--space-4)' }}>
                                        Change your password to keep your account secure.
                                    </p>
                                    <button
                                        className="btn btn-secondary btn-md"
                                        onClick={() => setShowPasswordForm(true)}
                                    >
                                        Change Password
                                    </button>
                                </div>
                            ) : (
                                <form onSubmit={handleChangePassword} className="password-form">
                                    <div className="form-group">
                                        <label className="form-label">Current Password</label>
                                        <div style={{ position: 'relative' }}>
                                            <input
                                                type={showCurrentPwd ? 'text' : 'password'}
                                                className="form-input"
                                                value={currentPassword}
                                                onChange={(e) => setCurrentPassword(e.target.value)}
                                                placeholder="Enter current password"
                                                disabled={changingPassword}
                                            />
                                            <button
                                                type="button"
                                                onClick={() => setShowCurrentPwd(!showCurrentPwd)}
                                                className="password-toggle-inline"
                                            >
                                                {showCurrentPwd ? <MdVisibilityOff /> : <MdVisibility />}
                                            </button>
                                        </div>
                                    </div>
                                    <div className="form-group">
                                        <label className="form-label">New Password</label>
                                        <div style={{ position: 'relative' }}>
                                            <input
                                                type={showNewPwd ? 'text' : 'password'}
                                                className="form-input"
                                                value={newPassword}
                                                onChange={(e) => setNewPassword(e.target.value)}
                                                placeholder="Min 6 characters"
                                                disabled={changingPassword}
                                            />
                                            <button
                                                type="button"
                                                onClick={() => setShowNewPwd(!showNewPwd)}
                                                className="password-toggle-inline"
                                            >
                                                {showNewPwd ? <MdVisibilityOff /> : <MdVisibility />}
                                            </button>
                                        </div>
                                    </div>
                                    <div className="form-group">
                                        <label className="form-label">Confirm New Password</label>
                                        <input
                                            type="password"
                                            className="form-input"
                                            value={confirmPassword}
                                            onChange={(e) => setConfirmPassword(e.target.value)}
                                            placeholder="Confirm new password"
                                            disabled={changingPassword}
                                        />
                                    </div>
                                    <div className="form-actions">
                                        <button
                                            type="button"
                                            className="btn btn-ghost btn-md"
                                            onClick={() => {
                                                setShowPasswordForm(false);
                                                setCurrentPassword('');
                                                setNewPassword('');
                                                setConfirmPassword('');
                                            }}
                                            disabled={changingPassword}
                                        >
                                            Cancel
                                        </button>
                                        <button type="submit" className="btn btn-primary btn-md" disabled={changingPassword}>
                                            {changingPassword ? 'Changing...' : 'Update Password'}
                                        </button>
                                    </div>
                                </form>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default ProfilePage;
