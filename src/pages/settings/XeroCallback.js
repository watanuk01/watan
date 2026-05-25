import React, { useEffect, useState, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { MdCheckCircle, MdError, MdSync } from 'react-icons/md';
import './SettingsPage.css';

/**
 * XeroCallback — Handles the OAuth2 redirect from Xero
 *
 * URL: /callback?code=xxx&state=accountId
 * 
 * Flow:
 *  1. Captures the auth code and account ID from URL params
 *  2. Calls xeroTokenExchange Cloud Function
 *  3. Shows success/error with discovered tenants
 *  4. Redirects to Settings → Integrations
 */
const XeroCallback = () => {
    const [searchParams] = useSearchParams();
    const navigate = useNavigate();
    const [status, setStatus] = useState('processing'); // processing | success | error
    const [message, setMessage] = useState('Connecting to Xero...');
    const [tenants, setTenants] = useState([]);
    const hasRun = useRef(false);

    useEffect(() => {
        // Prevent double-run in React StrictMode
        if (hasRun.current) return;
        hasRun.current = true;

        const code = searchParams.get('code');
        const state = searchParams.get('state'); // accountId
        const error = searchParams.get('error');

        if (error) {
            setStatus('error');
            setMessage(`Xero authorization denied: ${error}`);
            return;
        }

        if (!code || !state) {
            setStatus('error');
            setMessage('Missing authorization code or account reference. Please try connecting again from Settings.');
            return;
        }

        const exchangeToken = async () => {
            try {
                setMessage('Exchanging authorization code for access tokens...');
                const functions = getFunctions();
                const xeroTokenExchange = httpsCallable(functions, 'xeroTokenExchange');

                const result = await xeroTokenExchange({
                    code,
                    accountId: state,
                    redirectUri: window.location.origin + '/callback',
                });

                if (result.data?.success) {
                    setStatus('success');
                    setTenants(result.data.tenants || []);
                    setMessage(`Successfully connected! Found ${result.data.tenants?.length || 0} organisation(s).`);

                    // Auto-redirect after 3 seconds
                    setTimeout(() => {
                        navigate('/settings', { state: { activeTab: 'integrations' } });
                    }, 3000);
                } else {
                    setStatus('error');
                    setMessage('Token exchange returned an unexpected response.');
                }
            } catch (err) {
                setStatus('error');
                const errorMsg = err.message || 'Unknown error';
                setMessage(`Failed to connect: ${errorMsg}`);
                console.error('Xero token exchange error:', err);
            }
        };

        exchangeToken();
    }, [searchParams, navigate]);

    return (
        <div className="xero-callback-page">
            <div className="xero-callback-card">
                {/* Logo */}
                <div className="xero-callback-logo">
                    <span className="settings-integration-logo xero" style={{ width: 56, height: 56, fontSize: 24 }}>X</span>
                </div>

                {/* Status Icon */}
                <div className={`xero-callback-status ${status}`}>
                    {status === 'processing' && <MdSync className="xero-callback-spinner" />}
                    {status === 'success' && <MdCheckCircle />}
                    {status === 'error' && <MdError />}
                </div>

                {/* Title */}
                <h2 className="xero-callback-title">
                    {status === 'processing' && 'Connecting to Xero...'}
                    {status === 'success' && 'Connected!'}
                    {status === 'error' && 'Connection Failed'}
                </h2>

                {/* Message */}
                <p className="xero-callback-message">{message}</p>

                {/* Tenant List */}
                {status === 'success' && tenants.length > 0 && (
                    <div className="xero-callback-tenants">
                        <h4>Discovered Organisations:</h4>
                        <ul>
                            {tenants.map((t, i) => (
                                <li key={i}>
                                    <MdCheckCircle style={{ color: '#22c55e', fontSize: 14 }} />
                                    <span>{t.tenant_name}</span>
                                    <span className="xero-callback-tenant-type">{t.tenant_type}</span>
                                </li>
                            ))}
                        </ul>
                    </div>
                )}

                {/* Actions */}
                <div className="xero-callback-actions">
                    {status === 'success' && (
                        <p style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
                            Redirecting to Settings in 3 seconds...
                        </p>
                    )}
                    <button
                        className="btn btn-primary"
                        onClick={() => navigate('/settings', { state: { activeTab: 'integrations' } })}
                    >
                        {status === 'success' ? 'Go to Settings Now' : 'Back to Settings'}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default XeroCallback;
