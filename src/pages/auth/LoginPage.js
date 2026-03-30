import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { MdEmail, MdLock, MdVisibility, MdVisibilityOff } from 'react-icons/md';
import './LoginPage.css';

const LoginPage = () => {
    const { login } = useAuth();
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError('');

        if (!email.trim()) {
            setError('Please enter your email address');
            return;
        }
        if (!password) {
            setError('Please enter your password');
            return;
        }

        setLoading(true);
        try {
            await login(email, password);
        } catch (err) {
            console.error('Login error:', err);
            switch (err.code) {
                case 'auth/invalid-email':
                    setError('Invalid email address format');
                    break;
                case 'auth/user-disabled':
                    setError('This account has been disabled');
                    break;
                case 'auth/user-not-found':
                case 'auth/wrong-password':
                case 'auth/invalid-credential':
                    setError('Invalid email or password');
                    break;
                case 'auth/too-many-requests':
                    setError('Too many failed attempts. Please try again later');
                    break;
                default:
                    setError('Failed to sign in. Please try again');
            }
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="login-page">
            {/* Left Panel — Branding */}
            <div className="login-brand-panel">
                <div className="brand-content">
                    <div className="brand-logo">
                        <span className="brand-arabic">وطن</span>
                    </div>
                    <h1 className="brand-title">WATAN</h1>
                    <p className="brand-subtitle">RESTAURANT</p>
                    <div className="brand-divider" />
                    <p className="brand-tagline">Central Kitchen Management System</p>
                    <p className="brand-description">
                        Streamline your kitchen operations, manage inventory, and deliver excellence across all your restaurants.
                    </p>
                </div>

                {/* Decorative elements */}
                <div className="brand-decoration">
                    <div className="decoration-circle circle-1" />
                    <div className="decoration-circle circle-2" />
                    <div className="decoration-circle circle-3" />
                </div>
            </div>

            {/* Right Panel — Login Form */}
            <div className="login-form-panel">
                <div className="login-form-container">
                    <div className="login-form-header">
                        <div className="login-mobile-logo">
                            <span className="brand-arabic-sm">وطن</span>
                        </div>
                        <h2>Welcome Back</h2>
                        <p>Sign in to your account to continue</p>
                    </div>

                    <form onSubmit={handleSubmit} className="login-form">
                        {error && (
                            <div className="login-error">
                                <span>{error}</span>
                            </div>
                        )}

                        <div className="form-group">
                            <label className="form-label" htmlFor="email">Email Address</label>
                            <div className="input-with-icon">
                                <MdEmail className="input-icon" />
                                <input
                                    id="email"
                                    type="email"
                                    className="form-input"
                                    placeholder="you@example.com"
                                    value={email}
                                    onChange={(e) => setEmail(e.target.value)}
                                    disabled={loading}
                                    autoComplete="email"
                                    autoFocus
                                />
                            </div>
                        </div>

                        <div className="form-group">
                            <div className="label-row">
                                <label className="form-label" htmlFor="password">Password</label>
                                <Link to="/forgot-password" className="forgot-link">
                                    Forgot password?
                                </Link>
                            </div>
                            <div className="input-with-icon">
                                <MdLock className="input-icon" />
                                <input
                                    id="password"
                                    type={showPassword ? 'text' : 'password'}
                                    className="form-input"
                                    placeholder="Enter your password"
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                    disabled={loading}
                                    autoComplete="current-password"
                                />
                                <button
                                    type="button"
                                    className="password-toggle"
                                    onClick={() => setShowPassword(!showPassword)}
                                    tabIndex={-1}
                                >
                                    {showPassword ? <MdVisibilityOff /> : <MdVisibility />}
                                </button>
                            </div>
                        </div>

                        <button
                            type="submit"
                            className="btn btn-primary btn-lg w-full login-submit"
                            disabled={loading}
                        >
                            {loading ? (
                                <>
                                    <span className="btn-spinner" />
                                    Signing in...
                                </>
                            ) : (
                                'Sign In'
                            )}
                        </button>
                    </form>

                    <div className="login-footer">
                        <p>© {new Date().getFullYear()} Watan Restaurants. All rights reserved.</p>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default LoginPage;
