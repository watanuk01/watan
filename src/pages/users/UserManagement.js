import React, { useState, useEffect, useCallback } from 'react';
import Pagination from '../../components/common/Pagination';
import { useAuth } from '../../contexts/AuthContext';
import {
    getAllUsers,
    createUser,
    updateUser,
    disableUser,
    deleteUserDoc,
    getRoleLabel,
    ROLE_OPTIONS,
    resetUserPassword,
    sendResetEmailToUser,
} from '../../services/userService';
import UserFormModal from './UserFormModal';
import {
    MdAdd,
    MdEdit,
    MdDelete,
    MdBlock,
    MdSearch,
    MdFilterList,
    MdRefresh,
    MdCheckCircle,
    MdCancel,
    MdMoreVert,
    MdVisibility,
    MdVisibilityOff,
    MdPassword,
} from 'react-icons/md';
import toast from 'react-hot-toast';
import './UserManagement.css';

const PasswordDisplay = ({ password }) => {
    const [visible, setVisible] = useState(false);
    if (!password) return <span style={{ color: 'var(--color-text-muted)', fontSize: 'var(--text-xs)' }}>Manual Reset Required</span>;
    return (
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{
                fontFamily: 'var(--font-mono, monospace)',
                fontSize: visible ? 'var(--text-sm)' : 'var(--text-lg)',
                letterSpacing: visible ? 'normal' : '2px',
                color: 'var(--color-text-primary)'
            }}>
                {visible ? password : '••••••••'}
            </span>
            <button
                onClick={(e) => { e.stopPropagation(); setVisible(!visible); }}
                className="btn btn-icon btn-sm"
                title={visible ? "Hide Password" : "Show Password"}
                style={{ background: 'transparent', padding: 4, height: 'auto', minHeight: 'auto', color: 'var(--color-text-muted)' }}
            >
                {visible ? <MdVisibilityOff size={16} /> : <MdVisibility size={16} />}
            </button>
        </div>
    );
};

const UserManagement = () => {
    const { userProfile } = useAuth();
    const [users, setUsers] = useState([]);
    const [filteredUsers, setFilteredUsers] = useState([]);
    const [loading, setLoading] = useState(true);
    const [searchQuery, setSearchQuery] = useState('');
    const [roleFilter, setRoleFilter] = useState('all');
    const [statusFilter, setStatusFilter] = useState('all');
    const [showCreateModal, setShowCreateModal] = useState(false);
    const [editingUser, setEditingUser] = useState(null);
    const [deleteConfirm, setDeleteConfirm] = useState(null);
    const [actionMenuUser, setActionMenuUser] = useState(null);
    const [resetPasswordUser, setResetPasswordUser] = useState(null);
    const [newPassword, setNewPassword] = useState('');
    const [resetting, setResetting] = useState(false);
    const [currentPage, setCurrentPage] = useState(1);
    const [itemsPerPage, setItemsPerPage] = useState(10);

    const fetchUsers = useCallback(async () => {
        setLoading(true);
        try {
            const data = await getAllUsers();
            setUsers(data);
        } catch (err) {
            console.error('Error fetching users:', err);
            toast.error('Failed to load users');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchUsers();
    }, [fetchUsers]);

    // Apply filters
    useEffect(() => {
        let result = [...users];

        if (searchQuery) {
            const q = searchQuery.toLowerCase();
            result = result.filter(u =>
                u.name?.toLowerCase().includes(q) ||
                u.email?.toLowerCase().includes(q) ||
                u.phone?.toLowerCase().includes(q)
            );
        }

        if (roleFilter !== 'all') {
            result = result.filter(u => u.role === roleFilter);
        }

        if (statusFilter !== 'all') {
            result = result.filter(u => u.status === statusFilter);
        }

        setFilteredUsers(result);
        setCurrentPage(1); // Reset page on filter change
    }, [users, searchQuery, roleFilter, statusFilter]);

    const paginatedUsers = filteredUsers.slice(
        (currentPage - 1) * itemsPerPage,
        currentPage * itemsPerPage
    );

    const handleCreateUser = async (formData) => {
        try {
            await createUser(formData);
            toast.success(`User ${formData.name} created successfully`);
            setShowCreateModal(false);
            await fetchUsers();
        } catch (err) {
            console.error('Error creating user:', err);
            if (err.code === 'auth/email-already-in-use') {
                toast.error('A user with this email already exists');
            } else if (err.code === 'auth/weak-password') {
                toast.error('Password must be at least 6 characters');
            } else {
                toast.error('Failed to create user: ' + err.message);
            }
            throw err; // Re-throw so modal can handle loading state
        }
    };

    const handleUpdateUser = async (formData) => {
        try {
            const { id, ...updates } = formData;
            await updateUser(id, updates);
            toast.success(`User ${formData.name} updated successfully`);
            setEditingUser(null);
            await fetchUsers();
        } catch (err) {
            console.error('Error updating user:', err);
            toast.error('Failed to update user');
            throw err;
        }
    };

    const handleDisableUser = async (user) => {
        try {
            await disableUser(user.id);
            toast.success(`User ${user.name} has been disabled`);
            setActionMenuUser(null);
            await fetchUsers();
        } catch (err) {
            console.error('Error disabling user:', err);
            toast.error('Failed to disable user');
        }
    };

    const handleEnableUser = async (user) => {
        try {
            await updateUser(user.id, { status: 'active' });
            toast.success(`User ${user.name} has been enabled`);
            setActionMenuUser(null);
            await fetchUsers();
        } catch (err) {
            console.error('Error enabling user:', err);
            toast.error('Failed to enable user');
        }
    };

    const handleDeleteUser = async () => {
        if (!deleteConfirm) return;
        try {
            await deleteUserDoc(deleteConfirm.id);
            toast.success(`User ${deleteConfirm.name} deleted`);
            setDeleteConfirm(null);
            await fetchUsers();
        } catch (err) {
            console.error('Error deleting user:', err);
            toast.error('Failed to delete user');
        }
    };

    const handleResetPasswordSubmit = async (e) => {
        e.preventDefault();
        if (newPassword.length < 6) {
            toast.error('Password must be at least 6 characters');
            return;
        }
        setResetting(true);
        try {
            await resetUserPassword(resetPasswordUser.id, resetPasswordUser.email, resetPasswordUser.password, newPassword);
            toast.success(`Password for ${resetPasswordUser.name} reset successfully`);
            setResetPasswordUser(null);
            setNewPassword('');
            await fetchUsers();
        } catch (err) {
            console.error('Error resetting password:', err);
            toast.error('Failed to reset password. The old password might be incorrect or missing.');
        } finally {
            setResetting(false);
        }
    };

    const handleSendResetEmail = async () => {
        setResetting(true);
        try {
            await sendResetEmailToUser(resetPasswordUser.email);
            toast.success(`Password reset email sent to ${resetPasswordUser.email}`);
            setResetPasswordUser(null);
        } catch (err) {
            console.error('Error sending reset email:', err);
            toast.error('Failed to send reset email');
        } finally {
            setResetting(false);
        }
    };

    const getStatusBadge = (status) => {
        switch (status) {
            case 'active':
                return <span className="badge badge-success"><MdCheckCircle /> Active</span>;
            case 'disabled':
                return <span className="badge badge-danger"><MdCancel /> Disabled</span>;
            default:
                return <span className="badge badge-neutral">{status}</span>;
        }
    };

    const formatDate = (date) => {
        if (!date) return '—';
        return new Date(date).toLocaleDateString('en-GB', {
            day: '2-digit',
            month: 'short',
            year: 'numeric',
        });
    };

    return (
        <div className="user-management-page">
            {/* Page Header */}
            <div className="page-header">
                <div>
                    <h2 className="page-title">User Management</h2>
                    <p className="page-subtitle">
                        Manage users, roles, and access across the platform
                    </p>
                </div>
                <button
                    className="btn btn-primary btn-md"
                    onClick={() => setShowCreateModal(true)}
                >
                    <MdAdd /> Create User
                </button>
            </div>

            {/* Filters Bar */}
            <div className="filters-bar">
                <div className="search-filter">
                    <MdSearch className="filter-icon" />
                    <input
                        type="text"
                        placeholder="Search by name, email, or phone..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="form-input filter-input"
                    />
                </div>

                <div className="filter-group">
                    <MdFilterList className="filter-icon-sm" />
                    <select
                        value={roleFilter}
                        onChange={(e) => setRoleFilter(e.target.value)}
                        className="form-select filter-select"
                    >
                        <option value="all">All Roles</option>
                        {ROLE_OPTIONS.map(r => (
                            <option key={r.value} value={r.value}>{r.label}</option>
                        ))}
                    </select>

                    <select
                        value={statusFilter}
                        onChange={(e) => setStatusFilter(e.target.value)}
                        className="form-select filter-select"
                    >
                        <option value="all">All Status</option>
                        <option value="active">Active</option>
                        <option value="disabled">Disabled</option>
                    </select>

                    <button className="btn-refresh"
                        onClick={fetchUsers}
                        title="Refresh"
                    ><MdRefresh /></button>
                </div>
            </div>

            {/* Stats Summary */}
            <div className="user-stats">
                <div className="user-stat">
                    <span className="stat-value">{users.length}</span>
                    <span className="stat-label">Total Users</span>
                </div>
                <div className="user-stat">
                    <span className="stat-value">{users.filter(u => u.status === 'active').length}</span>
                    <span className="stat-label">Active</span>
                </div>
                <div className="user-stat">
                    <span className="stat-value">{users.filter(u => u.role === 'admin' || u.role === 'ck_staff').length}</span>
                    <span className="stat-label">Kitchen Staff</span>
                </div>
                <div className="user-stat">
                    <span className="stat-value">{users.filter(u => u.role?.includes('restaurant')).length}</span>
                    <span className="stat-label">Restaurant Mgrs</span>
                </div>
                <div className="user-stat">
                    <span className="stat-value">{users.filter(u => u.role === 'delivery_partner').length}</span>
                    <span className="stat-label">Delivery Partners</span>
                </div>
            </div>

            {/* Users Table */}
            <div className="card">
                <div className="data-table-wrapper">
                    <table className="data-table">
                        <thead>
                            <tr>
                                <th>User</th>
                                <th>Role</th>
                                <th>Restaurant</th>
                                <th>Phone</th>
                                <th>Password</th>
                                <th>Status</th>
                                <th>Created</th>
                                <th style={{ width: '80px' }}>Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {loading ? (
                                // Skeleton rows
                                Array.from({ length: 5 }).map((_, i) => (
                                    <tr key={i}>
                                        <td><div className="skeleton skeleton-text" style={{ width: '200px' }} /></td>
                                        <td><div className="skeleton skeleton-text" style={{ width: '150px' }} /></td>
                                        <td><div className="skeleton skeleton-text" style={{ width: '120px' }} /></td>
                                        <td><div className="skeleton skeleton-text" style={{ width: '100px' }} /></td>
                                        <td><div className="skeleton skeleton-text" style={{ width: '80px' }} /></td>
                                        <td><div className="skeleton skeleton-text" style={{ width: '100px' }} /></td>
                                        <td></td>
                                    </tr>
                                ))
                            ) : filteredUsers.length === 0 ? (
                                <tr>
                                    <td colSpan="8">
                                        <div className="empty-state" style={{ padding: 'var(--space-8)' }}>
                                            <div className="empty-state-icon">👤</div>
                                            <div className="empty-state-title">No users found</div>
                                            <div className="empty-state-description">
                                                {searchQuery || roleFilter !== 'all' || statusFilter !== 'all'
                                                    ? 'Try adjusting your search or filters'
                                                    : 'Click "Create User" to add your first user'
                                                }
                                            </div>
                                        </div>
                                    </td>
                                </tr>
                            ) : (
                                paginatedUsers.map(user => (
                                    <tr key={user.id} className={user.status === 'disabled' ? 'row-disabled' : ''}>
                                        <td>
                                            <div className="user-cell">
                                                <div className="user-cell-avatar">
                                                    {user.name?.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2) || 'U'}
                                                </div>
                                                <div className="user-cell-info">
                                                    <span className="user-cell-name">{user.name}</span>
                                                    <span className="user-cell-email">{user.email}</span>
                                                </div>
                                            </div>
                                        </td>
                                        <td>
                                            <span className="badge badge-primary">{getRoleLabel(user.role)}</span>
                                        </td>
                                        <td>
                                            {user.restaurant_name || '—'}
                                        </td>
                                        <td style={{ color: 'var(--color-text-secondary)' }}>
                                            {user.phone || '—'}
                                        </td>
                                        <td>
                                            <PasswordDisplay password={user.password} />
                                        </td>
                                        <td>{getStatusBadge(user.status)}</td>
                                        <td style={{ color: 'var(--color-text-muted)' }}>
                                            {formatDate(user.created_at)}
                                        </td>
                                        <td>
                                            <div className="action-menu-container">
                                                <button
                                                    className="btn btn-ghost btn-sm action-menu-trigger"
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        setActionMenuUser(actionMenuUser === user.id ? null : user.id);
                                                    }}
                                                >
                                                    <MdMoreVert />
                                                </button>
                                                {actionMenuUser === user.id && (
                                                    <div className="action-dropdown">
                                                        <button
                                                            className="action-dropdown-item"
                                                            onClick={() => {
                                                                setEditingUser(user);
                                                                setActionMenuUser(null);
                                                            }}
                                                        >
                                                            <MdEdit /> Edit User
                                                        </button>
                                                        {user.status === 'active' ? (
                                                            <button
                                                                className="action-dropdown-item"
                                                                onClick={() => handleDisableUser(user)}
                                                            >
                                                                <MdBlock /> Disable User
                                                            </button>
                                                        ) : (
                                                            <button
                                                                className="action-dropdown-item"
                                                                onClick={() => handleEnableUser(user)}
                                                            >
                                                                <MdCheckCircle /> Enable User
                                                            </button>
                                                        )}
                                                        <button
                                                            className="action-dropdown-item"
                                                            onClick={() => {
                                                                setResetPasswordUser(user);
                                                                setNewPassword('');
                                                                setActionMenuUser(null);
                                                            }}
                                                        >
                                                            <MdPassword /> Reset Password
                                                        </button>
                                                        {user.id !== userProfile?.id && (
                                                            <button
                                                                className="action-dropdown-item danger"
                                                                onClick={() => {
                                                                    setDeleteConfirm(user);
                                                                    setActionMenuUser(null);
                                                                }}
                                                            >
                                                                <MdDelete /> Delete User
                                                            </button>
                                                        )}
                                                    </div>
                                                )}
                                            </div>
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Pagination */}
            {!loading && filteredUsers.length > 0 && (
                <Pagination
                    currentPage={currentPage}
                    totalItems={filteredUsers.length}
                    itemsPerPage={itemsPerPage}
                    onPageChange={setCurrentPage}
                    onItemsPerPageChange={setItemsPerPage}
                />
            )}

            {/* Create User Modal */}
            {showCreateModal && (
                <UserFormModal
                    mode="create"
                    onSubmit={handleCreateUser}
                    onClose={() => setShowCreateModal(false)}
                />
            )}

            {/* Edit User Modal */}
            {editingUser && (
                <UserFormModal
                    mode="edit"
                    user={editingUser}
                    onSubmit={handleUpdateUser}
                    onClose={() => setEditingUser(null)}
                />
            )}

            {/* Delete Confirmation Modal */}
            {deleteConfirm && (
                <div className="modal-overlay" onClick={() => setDeleteConfirm(null)}>
                    <div className="modal modal-sm" onClick={(e) => e.stopPropagation()}>
                        <div className="modal-header">
                            <h2>Delete User</h2>
                            <button className="modal-close" onClick={() => setDeleteConfirm(null)}>×</button>
                        </div>
                        <div className="modal-body">
                            <p style={{ color: 'var(--color-text-secondary)', marginBottom: 'var(--space-4)' }}>
                                Are you sure you want to delete <strong style={{ color: 'var(--color-text-primary)' }}>{deleteConfirm.name}</strong>?
                            </p>
                            <div style={{
                                padding: 'var(--space-3) var(--space-4)',
                                background: 'var(--color-danger-bg)',
                                borderRadius: 'var(--radius-md)',
                                border: '1px solid rgba(248, 113, 113, 0.2)',
                                fontSize: 'var(--text-sm)',
                                color: 'var(--color-danger)',
                            }}>
                                ⚠ This action cannot be undone. The user's Firestore profile will be permanently deleted.
                            </div>
                        </div>
                        <div className="modal-footer">
                            <button className="btn btn-secondary btn-md" onClick={() => setDeleteConfirm(null)}>
                                Cancel
                            </button>
                            <button className="btn btn-danger btn-md" onClick={handleDeleteUser}>
                                <MdDelete /> Delete User
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Reset Password Modal */}
            {resetPasswordUser && (
                <div className="modal-overlay" onClick={() => setResetPasswordUser(null)}>
                    <div className="modal modal-sm" onClick={(e) => e.stopPropagation()}>
                        <div className="modal-header">
                            <h2>Reset Password</h2>
                            <button className="modal-close" onClick={() => setResetPasswordUser(null)}>×</button>
                        </div>
                        {resetPasswordUser.password ? (
                            <form onSubmit={handleResetPasswordSubmit}>
                                <div className="modal-body">
                                    <p style={{ color: 'var(--color-text-secondary)', marginBottom: 'var(--space-4)' }}>
                                        Enter a new password for <strong style={{ color: 'var(--color-text-primary)' }}>{resetPasswordUser.name}</strong>.
                                    </p>
                                    <div className="form-group">
                                        <label>New Password</label>
                                        <input
                                            type="text"
                                            className="form-input"
                                            placeholder="Min 6 characters"
                                            value={newPassword}
                                            onChange={e => setNewPassword(e.target.value)}
                                            required
                                            minLength={6}
                                            autoFocus
                                        />
                                    </div>
                                </div>
                                <div className="modal-footer">
                                    <button type="button" className="btn btn-secondary btn-md" onClick={() => setResetPasswordUser(null)}>
                                        Cancel
                                    </button>
                                    <button type="submit" className="btn btn-primary btn-md" disabled={resetting}>
                                        {resetting ? 'Resetting...' : 'Reset Password'}
                                    </button>
                                </div>
                            </form>
                        ) : (
                            <div className="modal-body">
                                <div className="empty-state" style={{ padding: '0', textAlign: 'left', background: 'transparent' }}>
                                    <h3 style={{ fontSize: 'var(--text-md)', color: 'var(--color-text-primary)', marginBottom: 'var(--space-2)' }}>
                                        Legacy Account detected
                                    </h3>
                                    <p style={{ color: 'var(--color-text-secondary)', marginBottom: 'var(--space-4)', lineHeight: '1.5' }}>
                                        Because <strong style={{ color: 'var(--color-text-primary)' }}>{resetPasswordUser.name}</strong> was created before secure password tracking was enabled, their original password is unknown to the system.
                                        <br /><br />
                                        You cannot manually set a new password here. Instead, you can send them a secure Firebase Password Reset email.
                                    </p>
                                </div>
                                <div className="modal-footer" style={{ marginTop: 'var(--space-6)' }}>
                                    <button type="button" className="btn btn-secondary btn-md" onClick={() => setResetPasswordUser(null)}>
                                        Cancel
                                    </button>
                                    <button type="button" className="btn btn-primary btn-md" onClick={handleSendResetEmail} disabled={resetting}>
                                        {resetting ? 'Sending Email...' : 'Send Reset Link'}
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};

export default UserManagement;
