import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { MdEmail, MdArrowBack, MdCheckCircle } from 'react-icons/md';
import './LoginPage.css';

const ForgotPasswordPage = () => {
    const { resetPassword } = useAuth();
    const [email, setEmail] = useState('');
    const [error, setError] = useState('');
    const [success, setSuccess] = useState(false);
    const [loading, setLoading] = useState(false);

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError('');

        if (!email.trim()) {
            setError('Please enter your email address');
            return;
        }

        setLoading(true);
        try {
            await resetPassword(email);
            setSuccess(true);
        } catch (err) {
            console.error('Reset password error:', err);
            switch (err.code) {
                case 'auth/invalid-email':
                    setError('Invalid email address format');
                    break;
                case 'auth/user-not-found':
                    setError('No account found with this email');
                    break;
                default:
                    setError('Failed to send reset email. Please try again');
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
                <div className="brand-decoration">
                    <div className="decoration-circle circle-1" />
                    <div className="decoration-circle circle-2" />
                    <div className="decoration-circle circle-3" />
                </div>
            </div>

            {/* Right Panel — Reset Form */}
            <div className="login-form-panel">
                <div className="login-form-container">
                    <Link to="/login" className="back-to-login">
                        <MdArrowBack /> Back to Sign In
                    </Link>

                    {success ? (
                        <div className="reset-success">
                            <div className="reset-success-icon">
                                <MdCheckCircle />
                            </div>
                            <h2>Check Your Email</h2>
                            <p>
                                We've sent a password reset link to <strong>{email}</strong>.
                                Please check your inbox and follow the instructions to reset your password.
                            </p>
                            <Link to="/login" className="btn btn-primary btn-lg w-full" style={{ marginTop: 'var(--space-6)' }}>
                                Return to Sign In
                            </Link>
                        </div>
                    ) : (
                        <>
                            <div className="login-form-header">
                                <div className="login-mobile-logo">
                                    <span className="brand-arabic-sm">وطن</span>
                                </div>
                                <h2>Reset Password</h2>
                                <p>Enter your email and we'll send you instructions to reset your password.</p>
                            </div>

                            <form onSubmit={handleSubmit} className="login-form">
                                {error && (
                                    <div className="login-error">
                                        <span>{error}</span>
                                    </div>
                                )}

                                <div className="form-group">
                                    <label className="form-label" htmlFor="reset-email">Email Address</label>
                                    <div className="input-with-icon">
                                        <MdEmail className="input-icon" />
                                        <input
                                            id="reset-email"
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

                                <button
                                    type="submit"
                                    className="btn btn-primary btn-lg w-full login-submit"
                                    disabled={loading}
                                >
                                    {loading ? (
                                        <>
                                            <span className="btn-spinner" />
                                            Sending...
                                        </>
                                    ) : (
                                        'Send Reset Link'
                                    )}
                                </button>
                            </form>
                        </>
                    )}

                    <div className="login-footer">
                        <p>© {new Date().getFullYear()} Watan Restaurants. All rights reserved.</p>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default ForgotPasswordPage;
