import React, { useState, useEffect, useCallback } from 'react';
import {
    MdBusiness, MdNotifications, MdIntegrationInstructions, MdSecurity,
    MdInventory2, MdSave, MdRefresh, MdVisibility, MdVisibilityOff,
    MdDelete, MdCheckCircle, MdError, MdLink, MdLinkOff, MdInfo,
} from 'react-icons/md';
import {
    getSettings, updateSettings,
    saveXeroCredentials, removeXeroCredentials,
} from '../../services/settingsService';
import toast from 'react-hot-toast';
import './SettingsPage.css';

// ═══════════════════════════════════════════════════════
// TOGGLE SWITCH
// ═══════════════════════════════════════════════════════
const Toggle = ({ checked, onChange, label, disabled }) => (
    <div className="settings-toggle-row">
        <span className="settings-toggle-label">{label}</span>
        <button
            className={`settings-toggle ${checked ? 'active' : ''} ${disabled ? 'disabled' : ''}`}
            onClick={() => !disabled && onChange(!checked)}
            disabled={disabled}
            type="button">
            <span className="settings-toggle-knob" />
        </button>
    </div>
);

// ═══════════════════════════════════════════════════════
// FIELD ROW
// ═══════════════════════════════════════════════════════
const FieldRow = ({ label, value, onChange, type = 'text', placeholder, options, helper, disabled }) => (
    <div className="settings-field-row">
        <label className="settings-field-label">{label}</label>
        <div className="settings-field-input-wrap">
            {type === 'select' ? (
                <select className="settings-field-input" value={value || ''} onChange={e => onChange(e.target.value)} disabled={disabled}>
                    {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
            ) : (
                <input className="settings-field-input" type={type} value={value || ''} placeholder={placeholder}
                    onChange={e => onChange(type === 'number' ? Number(e.target.value) : e.target.value)} disabled={disabled} />
            )}
            {helper && <span className="settings-field-helper">{helper}</span>}
        </div>
    </div>
);

// ═══════════════════════════════════════════════════════
// XERO CREDENTIAL MANAGER
// ═══════════════════════════════════════════════════════
const XeroSection = ({ data, onSaved }) => {
    const [clientId, setClientId] = useState(data.xero_client_id || '');
    const [clientSecret, setClientSecret] = useState(data.xero_client_secret || '');
    const [redirectUri, setRedirectUri] = useState(data.xero_redirect_uri || '');
    const [showSecret, setShowSecret] = useState(false);
    const [saving, setSaving] = useState(false);
    const [removing, setRemoving] = useState(false);
    const [confirmRemove, setConfirmRemove] = useState(false);

    const hasCredentials = !!(data.xero_client_id && data.xero_client_secret);

    const handleSave = async () => {
        if (!clientId.trim() || !clientSecret.trim()) {
            toast.error('Client ID and Client Secret are required');
            return;
        }
        setSaving(true);
        try {
            await saveXeroCredentials({ clientId: clientId.trim(), clientSecret: clientSecret.trim(), redirectUri: redirectUri.trim() });
            toast.success('Xero credentials saved successfully');
            onSaved();
        } catch (e) {
            toast.error('Failed to save Xero credentials');
        } finally {
            setSaving(false);
        }
    };

    const handleRemove = async () => {
        setRemoving(true);
        try {
            await removeXeroCredentials();
            setClientId('');
            setClientSecret('');
            setRedirectUri('');
            setConfirmRemove(false);
            toast.success('Xero credentials removed');
            onSaved();
        } catch (e) {
            toast.error('Failed to remove credentials');
        } finally {
            setRemoving(false);
        }
    };

    const maskValue = (val) => val ? val.substring(0, 6) + '•'.repeat(Math.max(0, val.length - 10)) + val.substring(val.length - 4) : '';

    return (
        <div className="xero-section">
            {/* Status bar */}
            <div className={`xero-status-bar ${hasCredentials ? 'connected' : 'disconnected'}`}>
                {hasCredentials
                    ? <><MdCheckCircle /> <span>Xero credentials configured</span></>
                    : <><MdInfo /> <span>No Xero credentials — add Client ID &amp; Secret below</span></>}
            </div>

            {/* Credential Form */}
            <div className="xero-form">
                <div className="xero-field">
                    <label>Client ID</label>
                    <input
                        type="text"
                        className="settings-field-input"
                        placeholder="Enter Xero Client ID"
                        value={clientId}
                        onChange={e => setClientId(e.target.value)} />
                </div>
                <div className="xero-field">
                    <label>Client Secret</label>
                    <div className="xero-secret-wrap">
                        <input
                            type={showSecret ? 'text' : 'password'}
                            className="settings-field-input"
                            placeholder="Enter Xero Client Secret"
                            value={clientSecret}
                            onChange={e => setClientSecret(e.target.value)} />
                        <button className="xero-eye-btn" onClick={() => setShowSecret(!showSecret)} type="button" title={showSecret ? 'Hide' : 'Show'}>
                            {showSecret ? <MdVisibilityOff /> : <MdVisibility />}
                        </button>
                    </div>
                </div>
                <div className="xero-field">
                    <label>Redirect URI <span style={{ color: 'var(--color-text-muted)', fontWeight: 400 }}>(optional)</span></label>
                    <input
                        type="text"
                        className="settings-field-input"
                        placeholder="e.g. https://us-central1-watan-e8290.cloudfunctions.net/xeroCallback"
                        value={redirectUri}
                        onChange={e => setRedirectUri(e.target.value)} />
                    <span className="settings-field-helper">This is the OAuth callback URL for Xero. Set this after creating a Cloud Function.</span>
                </div>

                <div className="xero-actions">
                    <button style={{ padding: '10px' }} className="btn btn-primary" onClick={handleSave} disabled={saving}>
                        {saving ? 'Saving…' : <><MdLink /> {hasCredentials ? 'Update Credentials' : 'Save Credentials'}</>}
                    </button>

                    {hasCredentials && !confirmRemove && (
                        <button className="btn btn-ghost" onClick={() => setConfirmRemove(true)} style={{ color: '#ef4444' }}>
                            <MdLinkOff /> Remove Credentials
                        </button>
                    )}

                    {confirmRemove && (
                        <div className="xero-confirm-remove">
                            <span style={{ fontSize: 12, color: '#ef4444' }}>Are you sure? This will disconnect Xero.</span>
                            <button className="btn btn-danger btn-sm" onClick={handleRemove} disabled={removing}>
                                {removing ? 'Removing…' : <><MdDelete /> Yes, Remove</>}
                            </button>
                            <button className="btn btn-ghost btn-sm" onClick={() => setConfirmRemove(false)}>Cancel</button>
                        </div>
                    )}
                </div>
            </div>

            {/* Currently stored values (masked) */}
            {hasCredentials && (
                <div className="xero-current">
                    <h5 style={{ fontSize: 11, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>Currently Stored</h5>
                    <div className="xero-stored-row"><span>Client ID:</span> <code>{maskValue(data.xero_client_id)}</code></div>
                    <div className="xero-stored-row"><span>Client Secret:</span> <code>{maskValue(data.xero_client_secret)}</code></div>
                    {data.xero_redirect_uri && <div className="xero-stored-row"><span>Redirect URI:</span> <code>{data.xero_redirect_uri}</code></div>}
                </div>
            )}

            {/* Integration status note */}
            <div className="xero-note">
                <MdInfo style={{ flexShrink: 0, color: 'var(--color-primary)' }} />
                <span>
                    Once credentials are saved, the Xero OAuth flow and invoice sync will be handled via Cloud Functions.
                    You'll need to deploy the <code>xeroAuth</code> and <code>xeroCallback</code> functions to complete the integration.
                </span>
            </div>
        </div>
    );
};

// ═══════════════════════════════════════════════════════
// SETTINGS TABS
// ═══════════════════════════════════════════════════════
const TABS = [
    { id: 'company', label: 'Company', icon: MdBusiness },
    { id: 'notifications', label: 'Notifications', icon: MdNotifications },
    { id: 'inventory', label: 'Inventory', icon: MdInventory2 },
    { id: 'integrations', label: 'Integrations', icon: MdIntegrationInstructions },
    { id: 'security', label: 'Security', icon: MdSecurity },
];

// ═══════════════════════════════════════════════════════
// MAIN SETTINGS PAGE
// ═══════════════════════════════════════════════════════
const SettingsPage = () => {
    const [activeTab, setActiveTab] = useState('company');
    const [settings, setSettings] = useState(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [dirty, setDirty] = useState({});

    const loadSettings = useCallback(async () => {
        setLoading(true);
        try {
            const data = await getSettings();
            setSettings(data);
            setDirty({});
        } catch (e) {
            toast.error('Failed to load settings');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { loadSettings(); }, [loadSettings]);

    const update = (section, field, value) => {
        setSettings(prev => ({
            ...prev,
            [section]: { ...prev[section], [field]: value },
        }));
        setDirty(prev => ({ ...prev, [section]: true }));
    };

    const saveSection = async (section) => {
        setSaving(true);
        try {
            await updateSettings(section, settings[section]);
            setDirty(prev => ({ ...prev, [section]: false }));
            toast.success(`${section.charAt(0).toUpperCase() + section.slice(1)} settings saved`);
        } catch (e) {
            toast.error('Failed to save settings');
        } finally {
            setSaving(false);
        }
    };

    if (loading || !settings) {
        return (
            <div className="settings-page">
                <div className="page-header"><div><h2 className="page-title">Settings</h2></div></div>
                <div style={{ padding: 40, textAlign: 'center', color: 'var(--color-text-muted)' }}>Loading settings…</div>
            </div>
        );
    }

    const s = settings;

    return (
        <div className="settings-page">
            <div className="page-header">
                <div>
                    <h2 className="page-title">Settings</h2>
                    <p className="page-subtitle">Configure system preferences, integrations and security</p>
                </div>
                <button className="btn-refresh" onClick={loadSettings}><MdRefresh /></button>
            </div>

            {/* ─── Tab Bar ─── */}
            <div className="settings-tab-bar">
                {TABS.map(tab => (
                    <button key={tab.id}
                        className={`settings-tab ${activeTab === tab.id ? 'active' : ''}`}
                        onClick={() => setActiveTab(tab.id)}>
                        <tab.icon />
                        <span>{tab.label}</span>
                        {dirty[tab.id] && <span className="settings-tab-dot" />}
                    </button>
                ))}
            </div>

            {/* ─── Tab Content ─── */}
            <div className="settings-content">

                {/* ═══ COMPANY ═══ */}
                {activeTab === 'company' && (
                    <div className="settings-section">
                        <div className="settings-section-header">
                            <div>
                                <h3>Company Information</h3>
                                <p>Your business name, address, VAT details and regional preferences.</p>
                            </div>
                            <button style={{ padding: '10px' }} className="btn btn-primary" onClick={() => saveSection('company')} disabled={saving || !dirty.company}>
                                <MdSave /> {saving ? 'Saving…' : 'Save Changes'}
                            </button>
                        </div>
                        <div className="settings-fields">
                            <FieldRow label="Company Name" value={s.company.company_name} onChange={v => update('company', 'company_name', v)} placeholder="Watan Restaurants" />
                            <FieldRow label="VAT Registration" value={s.company.vat_number} onChange={v => update('company', 'vat_number', v)} placeholder="GB 123 456 789" />
                            <FieldRow label="Address" value={s.company.address} onChange={v => update('company', 'address', v)} placeholder="Central Kitchen, London, UK" />
                            <FieldRow label="Phone" value={s.company.phone} onChange={v => update('company', 'phone', v)} placeholder="+44 20 1234 5678" />
                            <FieldRow label="Email" value={s.company.email} onChange={v => update('company', 'email', v)} placeholder="info@watan.com" type="email" />
                            <FieldRow label="Currency" value={s.company.currency} onChange={v => update('company', 'currency', v)} type="select"
                                options={[{ value: 'GBP', label: '£ GBP — British Pound' }, { value: 'USD', label: '$ USD — US Dollar' }, { value: 'EUR', label: '€ EUR — Euro' }]} />
                            <FieldRow label="Timezone" value={s.company.timezone} onChange={v => update('company', 'timezone', v)} type="select"
                                options={[{ value: 'Europe/London', label: 'Europe/London (GMT)' }, { value: 'Asia/Kolkata', label: 'Asia/Kolkata (IST)' }, { value: 'America/New_York', label: 'America/New_York (EST)' }]} />
                        </div>
                    </div>
                )}

                {/* ═══ NOTIFICATIONS ═══ */}
                {activeTab === 'notifications' && (
                    <div className="settings-section">
                        <div className="settings-section-header">
                            <div>
                                <h3>Notification Preferences</h3>
                                <p>Control which alerts and notifications are sent to admin and restaurant users.</p>
                            </div>
                            <button style={{ padding: '10px' }} className="btn btn-primary" onClick={() => saveSection('notifications')} disabled={saving || !dirty.notifications}>
                                <MdSave /> {saving ? 'Saving…' : 'Save Changes'}
                            </button>
                        </div>
                        <div className="settings-fields">
                            <Toggle label="Low Stock Alerts" checked={s.notifications.low_stock_alerts} onChange={v => update('notifications', 'low_stock_alerts', v)} />
                            <Toggle label="Order Status Updates" checked={s.notifications.order_status_updates} onChange={v => update('notifications', 'order_status_updates', v)} />
                            <Toggle label="Batch Expiry Warnings" checked={s.notifications.batch_expiry_warnings} onChange={v => update('notifications', 'batch_expiry_warnings', v)} />
                            {s.notifications.batch_expiry_warnings && (
                                <FieldRow label="Expiry Warning (hours before)" value={s.notifications.batch_expiry_hours}
                                    onChange={v => update('notifications', 'batch_expiry_hours', v)} type="number" placeholder="24"
                                    helper="Notify this many hours before a batch expires" />
                            )}
                            <Toggle label="Waste Submission Alerts" checked={s.notifications.waste_submission_alerts} onChange={v => update('notifications', 'waste_submission_alerts', v)} />
                            <Toggle label="Web Push Notifications" checked={s.notifications.web_push} onChange={v => update('notifications', 'web_push', v)} />
                        </div>
                    </div>
                )}

                {/* ═══ INVENTORY DEFAULTS ═══ */}
                {activeTab === 'inventory' && (
                    <div className="settings-section">
                        <div className="settings-section-header">
                            <div>
                                <h3>Inventory Defaults</h3>
                                <p>Default thresholds and storage settings for new inventory items.</p>
                            </div>
                            <button style={{ padding: '10px' }} className="btn btn-primary" onClick={() => saveSection('inventory')} disabled={saving || !dirty.inventory}>
                                <MdSave /> {saving ? 'Saving…' : 'Save Changes'}
                            </button>
                        </div>
                        <div className="settings-fields">
                            <FieldRow label="Default Low Stock Threshold (units)" value={s.inventory.default_low_stock_threshold}
                                onChange={v => update('inventory', 'default_low_stock_threshold', v)} type="number" placeholder="10" />
                            <FieldRow label="Default Expiry Warning (hours)" value={s.inventory.default_expiry_warning_hours}
                                onChange={v => update('inventory', 'default_expiry_warning_hours', v)} type="number" placeholder="24" />
                            <FieldRow label="Default Storage Type" value={s.inventory.default_storage_type}
                                onChange={v => update('inventory', 'default_storage_type', v)} type="select"
                                options={[{ value: 'ambient', label: 'Ambient (room temp)' }, { value: 'chilled', label: 'Chilled (0–5°C)' }, { value: 'frozen', label: 'Frozen (below 0°C)' }]} />
                        </div>
                    </div>
                )}

                {/* ═══ INTEGRATIONS ═══ */}
                {activeTab === 'integrations' && (
                    <div className="settings-section">
                        <div className="settings-section-header">
                            <div>
                                <h3>Integrations</h3>
                                <p>Connect external services. Manage API credentials securely.</p>
                            </div>
                        </div>

                        {/* Xero */}
                        <div className="settings-integration-block">
                            <div className="settings-integration-header">
                                <div className="settings-integration-logo xero">X</div>
                                <div>
                                    <h4>Xero Accounting</h4>
                                    <p style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 2 }}>
                                        Sync invoices with Xero for automated accounting.
                                    </p>
                                </div>
                            </div>
                            <XeroSection data={s.integrations} onSaved={loadSettings} />
                        </div>

                        {/* EPOS — on hold */}
                        <div className="settings-integration-block disabled">
                            <div className="settings-integration-header">
                                <div className="settings-integration-logo epos">E</div>
                                <div>
                                    <h4>EPOS System <span className="badge badge-neutral" style={{ marginLeft: 6 }}>On Hold</span></h4>
                                    <p style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 2 }}>
                                        EPOS integration is currently on hold and disabled.
                                    </p>
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {/* ═══ SECURITY ═══ */}
                {activeTab === 'security' && (
                    <div className="settings-section">
                        <div className="settings-section-header">
                            <div>
                                <h3>Security &amp; Access</h3>
                                <p>Manage session policies and audit logging.</p>
                            </div>
                            <button style={{ padding: '10px' }} className="btn btn-primary" onClick={() => saveSection('security')} disabled={saving || !dirty.security}>
                                <MdSave /> {saving ? 'Saving…' : 'Save Changes'}
                            </button>
                        </div>
                        <div className="settings-fields">
                            <FieldRow label="Session Timeout" value={s.security.session_timeout_minutes}
                                onChange={v => update('security', 'session_timeout_minutes', v)} type="select"
                                options={[{ value: 15, label: '15 minutes' }, { value: 30, label: '30 minutes' }, { value: 60, label: '1 hour' }, { value: 120, label: '2 hours' }]} />
                            <Toggle label="Audit Logging" checked={s.security.audit_logging} onChange={v => update('security', 'audit_logging', v)} />
                            <div className="settings-info-box">
                                <MdInfo style={{ flexShrink: 0, color: 'var(--color-primary)' }} />
                                <span>Password policy is managed through Firebase Authentication. Minimum password length is 6 characters. To configure stricter policies (e.g. uppercase, special chars), update Firebase console → Authentication → Password policy.</span>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

export default SettingsPage;
