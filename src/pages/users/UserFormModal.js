import React, { useState, useEffect, useRef } from 'react';
import { ROLE_OPTIONS } from '../../services/userService';
import { MdClose, MdVisibility, MdVisibilityOff } from 'react-icons/md';

const UserFormModal = ({ mode, user, onSubmit, onClose }) => {
    const isEdit = mode === 'edit';
    const [formData, setFormData] = useState({
        name: '',
        email: '',
        password: '',
        role: 'ck_staff',
        phone: '',
        restaurant_id: '',
        restaurant_name: '',
        address: '',
    });
    const [errors, setErrors] = useState({});
    const [loading, setLoading] = useState(false);
    const [showPassword, setShowPassword] = useState(false);
    const nameRef = useRef(null);

    useEffect(() => {
        if (isEdit && user) {
            setFormData({
                id: user.id,
                name: user.name || '',
                email: user.email || '',
                password: user.password || '', // Populate password for visibility
                role: user.role || 'ck_staff',
                phone: user.phone || '',
                restaurant_id: user.restaurant_id || '',
                restaurant_name: user.restaurant_name || '',
                address: user.address || '',
            });
        }
        // Focus name field
        setTimeout(() => nameRef.current?.focus(), 100);
    }, [isEdit, user]);

    const handleChange = (field, value) => {
        setFormData(prev => ({ ...prev, [field]: value }));
        // Clear error when user types
        if (errors[field]) {
            setErrors(prev => ({ ...prev, [field]: '' }));
        }
    };

    const validate = () => {
        const newErrors = {};

        if (!formData.name.trim()) {
            newErrors.name = 'Name is required';
        }

        if (!isEdit) {
            if (!formData.email.trim()) {
                newErrors.email = 'Email is required';
            } else if (!/\S+@\S+\.\S+/.test(formData.email)) {
                newErrors.email = 'Invalid email format';
            }

            if (!formData.password) {
                newErrors.password = 'Password is required';
            } else if (formData.password.length < 6) {
                newErrors.password = 'Password must be at least 6 characters';
            }
        }

        if (!formData.role) {
            newErrors.role = 'Role is required';
        }

        const isRestaurantRole = formData.role === 'restaurant_manager' || formData.role === 'restaurant_manager_non_managed';
        if (isRestaurantRole && !formData.restaurant_name.trim()) {
            newErrors.restaurant_name = 'Restaurant name is required for this role';
        }

        setErrors(newErrors);
        return Object.keys(newErrors).length === 0;
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!validate()) return;

        setLoading(true);
        try {
            // Clean up data
            const submitData = { ...formData };
            if (isEdit) {
                delete submitData.email; // Can't change email
                delete submitData.password; // Not used for edit
            }

            // Remove restaurant fields if not a restaurant role
            const isRestaurantRole = submitData.role === 'restaurant_manager' || submitData.role === 'restaurant_manager_non_managed';
            if (!isRestaurantRole) {
                delete submitData.restaurant_id;
                delete submitData.restaurant_name;
                delete submitData.address;
            } else if (!submitData.restaurant_id) {
                // Auto-generate restaurant_id from name
                submitData.restaurant_id = submitData.restaurant_name
                    .toLowerCase()
                    .replace(/[^a-z0-9]+/g, '_')
                    .replace(/^_|_$/g, '');
            }

            await onSubmit(submitData);
        } catch (err) {
            // Error handled by parent
        } finally {
            setLoading(false);
        }
    };

    const isRestaurantRole = formData.role === 'restaurant_manager' || formData.role === 'restaurant_manager_non_managed';

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal modal-md" onClick={(e) => e.stopPropagation()}>
                <div className="modal-header">
                    <h2>{isEdit ? 'Edit User' : 'Create New User'}</h2>
                    <button className="modal-close" onClick={onClose}>
                        <MdClose />
                    </button>
                </div>

                <form onSubmit={handleSubmit}>
                    <div className="modal-body">
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
                            {/* Name */}
                            <div className="form-group">
                                <label className="form-label" htmlFor="user-name">Full Name *</label>
                                <input
                                    ref={nameRef}
                                    id="user-name"
                                    type="text"
                                    className={`form-input ${errors.name ? 'error' : ''}`}
                                    placeholder="Enter full name"
                                    value={formData.name}
                                    onChange={(e) => handleChange('name', e.target.value)}
                                    disabled={loading}
                                />
                                {errors.name && <span className="form-error">{errors.name}</span>}
                            </div>

                            {/* Email Address */}
                            <div className="form-group">
                                <label className="form-label">Email Address {isEdit ? '' : '*'}</label>
                                <input
                                    type="email"
                                    className={`form-input ${errors.email ? 'error' : ''}`}
                                    placeholder="user@example.com"
                                    value={formData.email}
                                    onChange={(e) => handleChange('email', e.target.value)}
                                    disabled={loading || isEdit}
                                    style={isEdit ? { opacity: 0.6 } : {}}
                                />
                                {errors.email && <span className="form-error">{errors.email}</span>}
                                {isEdit && <span className="form-hint">Email cannot be changed after creation</span>}
                            </div>

                            {/* Password */}
                            <div className="form-group">
                                <label className="form-label">Password {isEdit ? '' : '*'}</label>
                                <div style={{ position: 'relative' }}>
                                    <input
                                        type={showPassword ? 'text' : 'password'}
                                        className={`form-input ${errors.password ? 'error' : ''}`}
                                        placeholder={isEdit && !formData.password ? 'Manual Reset Required' : 'Min 6 characters'}
                                        value={formData.password}
                                        onChange={(e) => handleChange('password', e.target.value)}
                                        disabled={loading || isEdit}
                                        style={isEdit ? { opacity: 0.6 } : {}}
                                    />
                                    <button
                                        type="button"
                                        onClick={() => setShowPassword(!showPassword)}
                                        style={{
                                            position: 'absolute',
                                            right: '12px',
                                            top: '50%',
                                            transform: 'translateY(-50%)',
                                            background: 'transparent',
                                            border: 'none',
                                            color: 'var(--color-text-muted)',
                                            cursor: 'pointer',
                                            display: 'flex',
                                        }}
                                    >
                                        {showPassword ? <MdVisibilityOff /> : <MdVisibility />}
                                    </button>
                                </div>
                                {errors.password && <span className="form-error">{errors.password}</span>}
                                {isEdit && <span className="form-hint">To change the password, use Reset Password in the actions menu</span>}
                            </div>
                            {/* The form rows are adjusted so delete this whole old chunk up to Role */}

                            {/* Role + Phone */}
                            <div className="form-row">
                                <div className="form-group">
                                    <label className="form-label" htmlFor="user-role">Role *</label>
                                    <select
                                        id="user-role"
                                        className={`form-select ${errors.role ? 'error' : ''}`}
                                        value={formData.role}
                                        onChange={(e) => handleChange('role', e.target.value)}
                                        disabled={loading}
                                    >
                                        {ROLE_OPTIONS.map(r => (
                                            <option key={r.value} value={r.value}>{r.label}</option>
                                        ))}
                                    </select>
                                    {errors.role && <span className="form-error">{errors.role}</span>}
                                </div>
                                <div className="form-group">
                                    <label className="form-label" htmlFor="user-phone">Phone Number</label>
                                    <input
                                        id="user-phone"
                                        type="tel"
                                        className="form-input"
                                        placeholder="+44 7000 000000"
                                        value={formData.phone}
                                        onChange={(e) => handleChange('phone', e.target.value)}
                                        disabled={loading}
                                    />
                                </div>
                            </div>

                            {/* Restaurant fields (conditional) */}
                            {isRestaurantRole && (
                                <div className="form-row">
                                    <div className="form-group">
                                        <label className="form-label" htmlFor="user-restaurant-name">Restaurant Name *</label>
                                        <input
                                            id="user-restaurant-name"
                                            type="text"
                                            className={`form-input ${errors.restaurant_name ? 'error' : ''}`}
                                            placeholder="e.g. Watan Southall"
                                            value={formData.restaurant_name}
                                            onChange={(e) => handleChange('restaurant_name', e.target.value)}
                                            disabled={loading}
                                        />
                                        {errors.restaurant_name && <span className="form-error">{errors.restaurant_name}</span>}
                                    </div>
                                    <div className="form-group">
                                        <label className="form-label" htmlFor="user-restaurant-id">Restaurant ID</label>
                                        <input
                                            id="user-restaurant-id"
                                            type="text"
                                            className="form-input"
                                            placeholder="Auto-generated if blank"
                                            value={formData.restaurant_id}
                                            onChange={(e) => handleChange('restaurant_id', e.target.value)}
                                            disabled={loading}
                                        />
                                        <span className="form-hint">Leave blank to auto-generate from restaurant name</span>
                                    </div>
                                </div>
                            )}

                            {/* Address (for restaurant roles) */}
                            {isRestaurantRole && (
                                <div className="form-group">
                                    <label className="form-label" htmlFor="user-address">Restaurant Address</label>
                                    <textarea
                                        id="user-address"
                                        className="form-input"
                                        placeholder="Enter full restaurant address"
                                        rows={3}
                                        value={formData.address}
                                        onChange={(e) => handleChange('address', e.target.value)}
                                        disabled={loading}
                                    />
                                    <span className="form-hint">This address will appear on invoices as the billing address</span>
                                </div>
                            )}
                        </div>
                    </div>

                    <div className="modal-footer">
                        <button type="button" className="btn btn-secondary btn-md" onClick={onClose} disabled={loading}>
                            Cancel
                        </button>
                        <button type="submit" className="btn btn-primary btn-md" disabled={loading}>
                            {loading ? (
                                <>
                                    <span className="btn-spinner" style={{ width: 16, height: 16, borderWidth: 2 }} />
                                    {isEdit ? 'Saving...' : 'Creating...'}
                                </>
                            ) : (
                                isEdit ? 'Save Changes' : 'Create User'
                            )}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

export default UserFormModal;
