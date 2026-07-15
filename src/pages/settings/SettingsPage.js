import React, { useState, useEffect, useCallback } from 'react';
import {
    MdBusiness, MdNotifications, MdIntegrationInstructions, MdSecurity,
    MdInventory2, MdSave, MdRefresh, MdVisibility, MdVisibilityOff,
    MdDelete, MdCheckCircle, MdError, MdLink, MdLinkOff, MdInfo,
    MdAdd, MdEdit, MdClose, MdStore, MdOpenInNew, MdSync,
    MdContentCopy, MdVpnKey, MdReceipt,
} from 'react-icons/md';
import {
    getSettings, updateSettings,
    getXeroAccounts, addXeroAccount, updateXeroAccount, removeXeroAccount,
    getXeroRestaurantMappings, saveAllXeroRestaurantMappings,
} from '../../services/settingsService';
import { getRestaurantUsers } from '../../services/invoiceService';
import { seedRestaurantInventoryCategories } from '../../services/restaurantInventoryService';
import { getFunctions, httpsCallable } from 'firebase/functions';
import {
    getApiKey, generateApiKey, revokeApiKey, getEposEvents,
    getEposEventStats, getWebhookUrl,
} from '../../services/eposService';
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
// XERO ACCOUNT CARD
// ═══════════════════════════════════════════════════════
const XeroAccountCard = ({ account, onRemove, onRefresh }) => {
    const [editing, setEditing] = useState(false);
    const [name, setName] = useState(account.name || '');
    const [clientId, setClientId] = useState(account.client_id || '');
    const [clientSecret, setClientSecret] = useState(account.client_secret || '');
    const [showSecret, setShowSecret] = useState(false);
    const [saving, setSaving] = useState(false);
    const [disconnecting, setDisconnecting] = useState(false);
    const [confirmRemove, setConfirmRemove] = useState(false);
    const [refreshingOrgs, setRefreshingOrgs] = useState(false);

    const maskValue = (val) => val ? val.substring(0, 6) + '•'.repeat(Math.max(0, val.length - 10)) + val.substring(val.length - 4) : '—';

    const handleSave = async () => {
        if (!clientId.trim() || !clientSecret.trim()) {
            toast.error('Client ID and Client Secret are required');
            return;
        }
        setSaving(true);
        try {
            await updateXeroAccount(account.id, {
                name: name.trim() || 'Unnamed Account',
                client_id: clientId.trim(),
                client_secret: clientSecret.trim(),
            });
            toast.success('Account credentials updated');
            setEditing(false);
            onRefresh();
        } catch (e) {
            toast.error('Failed to update account');
        } finally {
            setSaving(false);
        }
    };

    const handleConnect = () => {
        const cid = account.client_id;
        const redirect = encodeURIComponent(window.location.origin + '/callback');
        const state = encodeURIComponent(account.id);
        // New granular scopes (required for apps created after March 2, 2026)
        const scopes = encodeURIComponent([
            'openid',
            'profile',
            'email',
            'offline_access',
            'accounting.invoices',
            'accounting.payments',
            'accounting.banktransactions',
            'accounting.manualjournals',
            'accounting.settings',
            'accounting.contacts',
        ].join(' '));
        const authUrl = `https://login.xero.com/identity/connect/authorize?response_type=code&client_id=${cid}&redirect_uri=${redirect}&scope=${scopes}&state=${state}`;
        window.location.href = authUrl;
    };

    const handleDisconnect = async () => {
        setDisconnecting(true);
        try {
            const functions = getFunctions();
            const xeroDisconnect = httpsCallable(functions, 'xeroDisconnect');
            await xeroDisconnect({ accountId: account.id });
            toast.success(`${account.name} disconnected`);
            onRefresh();
        } catch (e) {
            toast.error('Failed to disconnect: ' + (e.message || ''));
        } finally {
            setDisconnecting(false);
        }
    };

    const handleRefreshOrgs = async () => {
        setRefreshingOrgs(true);
        try {
            const functions = getFunctions();
            const xeroGetOrgs = httpsCallable(functions, 'xeroGetOrganisations');
            await xeroGetOrgs({ accountId: account.id });
            toast.success('Organisations refreshed');
            onRefresh();
        } catch (e) {
            toast.error('Failed to refresh organisations: ' + (e.message || ''));
        } finally {
            setRefreshingOrgs(false);
        }
    };

    const handleRemove = async () => {
        try {
            await removeXeroAccount(account.id);
            toast.success(`${account.name} removed`);
            onRefresh();
        } catch (e) {
            toast.error('Failed to remove account');
        }
    };

    return (
        <div className={`xero-account-card ${account.connected ? 'connected' : ''}`}>
            {/* Header */}
            <div className="xero-account-card-header">
                <div className="xero-account-card-info">
                    <div className="settings-integration-logo xero" style={{ width: 36, height: 36, fontSize: 15 }}>X</div>
                    <div>
                        <h4 className="xero-account-card-name">{account.name}</h4>
                        <span className={`xero-account-card-status ${account.connected ? 'connected' : 'disconnected'}`}>
                            {account.connected ? '● Connected' : '○ Not Connected'}
                        </span>
                    </div>
                </div>
                <div className="xero-account-card-actions-top">
                    {!editing && (
                        <button className="btn btn-ghost btn-sm" onClick={() => setEditing(true)} title="Edit Credentials">
                            <MdEdit />
                        </button>
                    )}
                </div>
            </div>

            {/* Credential Info / Edit */}
            {editing ? (
                <div className="xero-account-card-edit">
                    <div className="xero-field">
                        <label>Account Name</label>
                        <input className="settings-field-input" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Watan Tooting" />
                    </div>
                    <div className="xero-field">
                        <label>Client ID</label>
                        <input className="settings-field-input" value={clientId} onChange={e => setClientId(e.target.value)} placeholder="Enter Client ID" />
                    </div>
                    <div className="xero-field">
                        <label>Client Secret</label>
                        <div className="xero-secret-wrap">
                            <input className="settings-field-input" type={showSecret ? 'text' : 'password'}
                                value={clientSecret} onChange={e => setClientSecret(e.target.value)} placeholder="Enter Client Secret" />
                            <button className="xero-eye-btn" onClick={() => setShowSecret(!showSecret)} type="button">
                                {showSecret ? <MdVisibilityOff /> : <MdVisibility />}
                            </button>
                        </div>
                    </div>
                    <div className="xero-actions" style={{ marginTop: 8 }}>
                        <button className="btn btn-primary btn-sm" onClick={handleSave} disabled={saving}>
                            {saving ? 'Saving...' : <><MdSave /> Save</>}
                        </button>
                        <button className="btn btn-ghost btn-sm" onClick={() => setEditing(false)}>Cancel</button>
                    </div>
                </div>
            ) : (
                <div className="xero-account-card-details">
                    <div className="xero-stored-row"><span>Client ID:</span> <code>{maskValue(account.client_id)}</code></div>
                    <div className="xero-stored-row"><span>Secret:</span> <code>{maskValue(account.client_secret)}</code></div>
                    {account.connected_at && (
                        <div className="xero-stored-row"><span>Connected:</span> <code>{new Date(account.connected_at).toLocaleDateString('en-GB')}</code></div>
                    )}
                </div>
            )}

            {/* Connected Tenants */}
            {account.connected && account.tenants?.length > 0 && (
                <div className="xero-account-tenants">
                    <div className="xero-account-tenants-header">
                        <h5>Organisations ({account.tenants.length})</h5>
                        <button className="btn btn-ghost btn-sm" onClick={handleRefreshOrgs} disabled={refreshingOrgs} title="Refresh">
                            <MdRefresh className={refreshingOrgs ? 'xero-spin' : ''} />
                        </button>
                    </div>
                    <div className="xero-tenant-list">
                        {account.tenants.map((t, i) => (
                            <div key={i} className="xero-tenant-item">
                                <MdCheckCircle style={{ color: '#22c55e', fontSize: 14, flexShrink: 0 }} />
                                <span>{t.tenant_name}</span>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Action Buttons */}
            <div className="xero-account-card-footer">
                {account.connected ? (
                    <>
                        <button className="btn btn-ghost btn-sm" onClick={handleConnect}>
                            <MdRefresh /> Reconnect
                        </button>
                        <button className="btn btn-ghost btn-sm" onClick={handleDisconnect}
                            disabled={disconnecting} style={{ color: '#f59e0b' }}>
                            <MdLinkOff /> {disconnecting ? 'Disconnecting...' : 'Disconnect'}
                        </button>
                    </>
                ) : (
                    <button className="btn btn-primary btn-sm" onClick={handleConnect}
                        disabled={!account.client_id || !account.client_secret}>
                        <MdLink /> Connect to Xero
                    </button>
                )}

                {!confirmRemove ? (
                    <button className="btn btn-ghost btn-sm" onClick={() => setConfirmRemove(true)} style={{ color: '#ef4444', marginLeft: 'auto' }}>
                        <MdDelete /> Remove
                    </button>
                ) : (
                    <div className="xero-confirm-remove" style={{ marginLeft: 'auto' }}>
                        <span style={{ fontSize: 11, color: '#ef4444' }}>Sure?</span>
                        <button className="btn btn-danger btn-sm" onClick={handleRemove}><MdDelete /> Yes</button>
                        <button className="btn btn-ghost btn-sm" onClick={() => setConfirmRemove(false)}>No</button>
                    </div>
                )}
            </div>
        </div>
    );
};

// ═══════════════════════════════════════════════════════
// XERO RESTAURANT MAPPING TABLE
// ═══════════════════════════════════════════════════════
const XeroMappingSection = ({ xeroAccounts, mappings, onSave }) => {
    const [restaurants, setRestaurants] = useState([]);
    const [localMappings, setLocalMappings] = useState([]);
    const [saving, setSaving] = useState(false);
    const [loading, setLoading] = useState(true);

    // Build flat list of all available Xero tenants from all connected accounts
    const availableTenants = [];
    (xeroAccounts || []).forEach(acc => {
        if (acc.connected && acc.tenants?.length) {
            acc.tenants.forEach(t => {
                availableTenants.push({
                    xero_account_id: acc.id,
                    xero_account_name: acc.name,
                    xero_tenant_id: t.tenant_id,
                    xero_org_name: t.tenant_name,
                });
            });
        }
    });

    useEffect(() => {
        const load = async () => {
            try {
                const rList = await getRestaurantUsers();
                setRestaurants(rList);

                // Build local mapping state — one entry per restaurant
                const mapped = rList.map(r => {
                    const existing = (mappings || []).find(m => m.restaurant_id === r.id);
                    return {
                        restaurant_id: r.id,
                        restaurant_name: r.name,
                        xero_account_id: existing?.xero_account_id || '',
                        xero_tenant_id: existing?.xero_tenant_id || '',
                        xero_org_name: existing?.xero_org_name || '',
                        account_code: existing?.account_code || '',
                        invoice_status: existing?.invoice_status || 'DRAFT',
                    };
                });
                setLocalMappings(mapped);
            } catch (e) {
                toast.error('Failed to load restaurants');
            } finally {
                setLoading(false);
            }
        };
        load();
    }, [mappings]);

    const updateMapping = (restaurantId, tenantKey) => {
        setLocalMappings(prev => prev.map(m => {
            if (m.restaurant_id !== restaurantId) return m;
            if (!tenantKey) {
                return { ...m, xero_account_id: '', xero_tenant_id: '', xero_org_name: '' };
            }
            const tenant = availableTenants.find(t => `${t.xero_account_id}::${t.xero_tenant_id}` === tenantKey);
            if (!tenant) return m;
            return {
                ...m,
                xero_account_id: tenant.xero_account_id,
                xero_tenant_id: tenant.xero_tenant_id,
                xero_org_name: tenant.xero_org_name,
            };
        }));
    };

    const updateInvoiceStatus = (restaurantId, status) => {
        setLocalMappings(prev => prev.map(m =>
            m.restaurant_id === restaurantId ? { ...m, invoice_status: status } : m
        ));
    };

    const handleSave = async () => {
        setSaving(true);
        try {
            // Only save restaurants that have a mapping
            const toSave = localMappings.filter(m => m.xero_tenant_id);
            await saveAllXeroRestaurantMappings(toSave);
            toast.success('Restaurant mappings saved');
            onSave();
        } catch (e) {
            toast.error('Failed to save mappings');
        } finally {
            setSaving(false);
        }
    };

    if (loading) return <div style={{ padding: 20, color: 'var(--color-text-muted)' }}>Loading restaurants...</div>;

    if (restaurants.length === 0) {
        return (
            <div className="xero-mapping-empty">
                <MdStore style={{ fontSize: 24, color: 'var(--color-text-muted)' }} />
                <span>No restaurants found. Add restaurant users first.</span>
            </div>
        );
    }

    if (availableTenants.length === 0) {
        return (
            <div className="xero-mapping-empty">
                <MdInfo style={{ fontSize: 24, color: '#f59e0b' }} />
                <span>Connect at least one Xero account above to map restaurants.</span>
            </div>
        );
    }

    return (
        <div className="xero-mapping-section">
            <div className="xero-mapping-table-wrap">
                <table className="xero-mapping-table">
                    <thead>
                        <tr>
                            <th>Restaurant</th>
                            <th>Xero Organisation</th>
                            <th>Invoice Status</th>
                        </tr>
                    </thead>
                    <tbody>
                        {localMappings.map(m => {
                            const currentKey = m.xero_tenant_id ? `${m.xero_account_id}::${m.xero_tenant_id}` : '';
                            return (
                                <tr key={m.restaurant_id}>
                                    <td>
                                        <div className="xero-mapping-restaurant">
                                            <MdStore style={{ color: 'var(--color-primary)', flexShrink: 0 }} />
                                            <span>{m.restaurant_name}</span>
                                        </div>
                                    </td>
                                    <td>
                                        <select
                                            className="settings-field-input"
                                            value={currentKey}
                                            onChange={e => updateMapping(m.restaurant_id, e.target.value)}
                                        >
                                            <option value="">— Not Mapped —</option>
                                            {xeroAccounts.filter(a => a.connected).map(acc => (
                                                <optgroup key={acc.id} label={acc.name}>
                                                    {(acc.tenants || []).map(t => (
                                                        <option key={t.tenant_id} value={`${acc.id}::${t.tenant_id}`}>
                                                            {t.tenant_name}
                                                        </option>
                                                    ))}
                                                </optgroup>
                                            ))}
                                        </select>
                                    </td>
                                    <td>
                                        <select
                                            className="settings-field-input"
                                            value={m.invoice_status}
                                            onChange={e => updateInvoiceStatus(m.restaurant_id, e.target.value)}
                                            disabled={!m.xero_tenant_id}
                                        >
                                            <option value="DRAFT">Draft</option>
                                            <option value="AUTHORISED">Authorised</option>
                                        </select>
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>

            <div className="xero-mapping-footer">
                <button className="btn btn-primary" onClick={handleSave} disabled={saving} style={{ padding: '10px 20px' }}>
                    <MdSave /> {saving ? 'Saving...' : 'Save Mappings'}
                </button>
            </div>
        </div>
    );
};

// ═══════════════════════════════════════════════════════
// ADD XERO ACCOUNT MODAL
// ═══════════════════════════════════════════════════════
const AddXeroAccountForm = ({ onAdded, onClose }) => {
    const [name, setName] = useState('');
    const [clientId, setClientId] = useState('');
    const [clientSecret, setClientSecret] = useState('');
    const [showSecret, setShowSecret] = useState(false);
    const [saving, setSaving] = useState(false);

    const handleAdd = async () => {
        if (!name.trim()) { toast.error('Account name is required'); return; }
        if (!clientId.trim()) { toast.error('Client ID is required'); return; }
        if (!clientSecret.trim()) { toast.error('Client Secret is required'); return; }

        setSaving(true);
        try {
            await addXeroAccount({
                name: name.trim(),
                client_id: clientId.trim(),
                client_secret: clientSecret.trim(),
            });
            toast.success('Xero account added');
            onAdded();
        } catch (e) {
            toast.error('Failed to add account: ' + (e.message || ''));
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="xero-add-form">
            <div className="xero-add-form-header">
                <h4><MdAdd /> Add Xero Account</h4>
                <button className="btn btn-ghost btn-sm" onClick={onClose}><MdClose /></button>
            </div>
            <div className="xero-field">
                <label>Account Name</label>
                <input className="settings-field-input" value={name} onChange={e => setName(e.target.value)}
                    placeholder="e.g. Watan Tooting, Ahmed Ullah" />
                <span className="settings-field-helper">A friendly label for this Xero connection</span>
            </div>
            <div className="xero-field">
                <label>Client ID</label>
                <input className="settings-field-input" value={clientId} onChange={e => setClientId(e.target.value)}
                    placeholder="From developer.xero.com" />
            </div>
            <div className="xero-field">
                <label>Client Secret</label>
                <div className="xero-secret-wrap">
                    <input className="settings-field-input" type={showSecret ? 'text' : 'password'}
                        value={clientSecret} onChange={e => setClientSecret(e.target.value)}
                        placeholder="From developer.xero.com" />
                    <button className="xero-eye-btn" onClick={() => setShowSecret(!showSecret)} type="button">
                        {showSecret ? <MdVisibilityOff /> : <MdVisibility />}
                    </button>
                </div>
            </div>
            <div className="xero-actions" style={{ marginTop: 12 }}>
                <button className="btn btn-primary" onClick={handleAdd} disabled={saving} style={{ padding: '10px 20px' }}>
                    {saving ? 'Adding...' : <><MdAdd /> Add Account</>}
                </button>
                <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
            </div>
        </div>
    );
};

// ═══════════════════════════════════════════════════════
// FULL XERO INTEGRATION SECTION
// ═══════════════════════════════════════════════════════
const XeroIntegrationSection = () => {
    const [accounts, setAccounts] = useState([]);
    const [mappings, setMappings] = useState([]);
    const [loading, setLoading] = useState(true);
    const [showAddForm, setShowAddForm] = useState(false);

    const loadData = useCallback(async () => {
        setLoading(true);
        try {
            const [accs, maps] = await Promise.all([
                getXeroAccounts(),
                getXeroRestaurantMappings(),
            ]);
            setAccounts(accs);
            setMappings(maps);
        } catch (e) {
            toast.error('Failed to load Xero configuration');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { loadData(); }, [loadData]);

    if (loading) {
        return <div style={{ padding: 20, color: 'var(--color-text-muted)' }}>Loading Xero configuration...</div>;
    }

    return (
        <div className="xero-integration-section">
            {/* ─── Xero Accounts ─── */}
            <div className="xero-accounts-header">
                <div>
                    <h4>Xero Accounts</h4>
                    <p>Add your Xero apps and connect to sync invoices.</p>
                </div>
                <button className="btn btn-primary btn-sm" onClick={() => setShowAddForm(true)} style={{ padding: '8px 14px' }}>
                    <MdAdd /> Add Account
                </button>
            </div>

            {/* Add Form */}
            {showAddForm && (
                <AddXeroAccountForm
                    onAdded={() => { setShowAddForm(false); loadData(); }}
                    onClose={() => setShowAddForm(false)}
                />
            )}

            {/* Account Cards */}
            {accounts.length === 0 ? (
                <div className="xero-no-accounts">
                    <MdInfo style={{ fontSize: 20, color: '#f59e0b' }} />
                    <span>No Xero accounts configured. Click "Add Account" to get started.</span>
                </div>
            ) : (
                <div className="xero-accounts-grid">
                    {accounts.map(acc => (
                        <XeroAccountCard key={acc.id} account={acc} onRemove={loadData} onRefresh={loadData} />
                    ))}
                </div>
            )}

            {/* ─── Restaurant Mapping ─── */}
            <div className="xero-mapping-header">
                <div>
                    <h4>Restaurant → Xero Mapping</h4>
                    <p>Assign each restaurant to a Xero organisation. Invoices will sync to the mapped org.</p>
                </div>
            </div>
            <XeroMappingSection
                xeroAccounts={accounts}
                mappings={mappings}
                onSave={loadData}
            />

            {/* Info Note */}
            <div className="xero-note">
                <MdInfo style={{ flexShrink: 0, color: 'var(--color-primary)' }} />
                <span>
                    After connecting and mapping, use the <strong>"Sync to Xero"</strong> button on individual invoices
                    (Invoices page) to push them to the correct Xero organisation. Invoices are sent as
                    <strong> sales invoices (Accounts Receivable)</strong> with VAT line items.
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
// EPOS INTEGRATION SECTION
// ═══════════════════════════════════════════════════════

const EposIntegrationSection = () => {
    const [restaurants, setRestaurants] = useState([]);
    const [apiKeys, setApiKeys] = useState({});
    const [events, setEvents] = useState([]);
    const [eventStats, setEventStats] = useState(null);
    const [loadingKeys, setLoadingKeys] = useState(true);
    const [generating, setGenerating] = useState(null);
    const [showKey, setShowKey] = useState({});
    const [selectedRestaurant, setSelectedRestaurant] = useState('');

    // Enhanced filters
    const [statusFilter, setStatusFilter] = useState('');
    const [searchQuery, setSearchQuery] = useState('');
    const [dateFrom, setDateFrom] = useState('');
    const [dateTo, setDateTo] = useState('');

    // Pagination
    const [evtPage, setEvtPage] = useState(1);
    const [evtPageSize, setEvtPageSize] = useState(25);

    // Detail modal
    const [detailEvent, setDetailEvent] = useState(null);

    const webhookUrl = getWebhookUrl();

    // Load restaurants
    useEffect(() => {
        const loadRestaurants = async () => {
            try {
                const users = await getRestaurantUsers();
                setRestaurants(users);
            } catch (e) {
                console.error('Failed to load restaurants for EPOS:', e);
            }
        };
        loadRestaurants();
    }, []);

    // Load API keys for all restaurants
    useEffect(() => {
        const load = async () => {
            setLoadingKeys(true);
            const keys = {};
            for (const r of restaurants) {
                try {
                    const key = await getApiKey(r.id);
                    if (key && key.is_active) keys[r.id] = key;
                } catch (e) { /* skip */ }
            }
            setApiKeys(keys);
            setLoadingKeys(false);
        };
        if (restaurants.length > 0) load();
    }, [restaurants]);

    // Helper: convert a date string + time to London timezone boundary
    const toLondonDate = useCallback((dateStr, h, m, s, ms) => {
        const [y, mo, d] = dateStr.split('-').map(Number);
        const guess = new Date(y, mo - 1, d, h, m, s, 0);
        const inTz = new Date(guess.toLocaleString('en-US', { timeZone: 'Europe/London' }));
        return new Date(guess.getTime() + (guess - inTz) + ms);
    }, []);

    // Helper: get event date (prefer order_date — consistent with dashboards)
    const getEventDate = useCallback((ev) => {
        if (ev.order_date) {
            const d = ev.order_date;
            if (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d)) {
                const [y, m, day] = d.split('-').map(Number);
                const guess = new Date(y, m - 1, day, 0, 0, 0, 0);
                const inTz = new Date(guess.toLocaleString('en-US', { timeZone: 'Europe/London' }));
                return new Date(guess.getTime() + (guess - inTz));
            }
            return new Date(d);
        }
        return ev.received_at || null;
    }, []);

    // Load events
    useEffect(() => {
        const loadEvents = async () => {
            try {
                // Pass date range filters if active, otherwise fetch recent events (defaults to limit 300)
                const queryFilters = {};
                if (statusFilter) queryFilters.status = statusFilter;
                if (dateFrom) queryFilters.from = toLondonDate(dateFrom, 0, 0, 0, 0);
                if (dateTo) queryFilters.to = toLondonDate(dateTo, 23, 59, 59, 999);

                const evts = await getEposEvents(selectedRestaurant || null, queryFilters);
                setEvents(evts);
                
                // Calculate stats locally from loaded events to avoid duplicate reads
                const total = evts.length;
                const processed = evts.filter(e => e.processing_status === 'processed').length;
                const failed = evts.filter(e => e.processing_status === 'partial_failure').length;
                const unmapped = evts.filter(e => e.processing_status === 'has_unmapped').length;
                const pending = evts.filter(e => e.processing_status === 'pending').length;
                const lastEvent = evts.length > 0 ? evts[0] : null;
                
                setEventStats({ total, processed, failed, unmapped, pending, lastEvent });
            } catch (e) {
                console.error('Failed to load EPOS events:', e);
            }
        };
        loadEvents();
    }, [selectedRestaurant, dateFrom, dateTo, statusFilter, toLondonDate]);

    // Client-side filtering (uses London timezone, order_date first — consistent with dashboards)
    const filteredEvents = events.filter(ev => {
        if (statusFilter && ev.processing_status !== statusFilter) return false;
        if (searchQuery) {
            const q = searchQuery.toLowerCase();
            if (!(ev.epos_order_id || '').toLowerCase().includes(q) &&
                !(ev.restaurant_name || '').toLowerCase().includes(q)) return false;
        }
        const evDate = getEventDate(ev);
        if (dateFrom) {
            const from = toLondonDate(dateFrom, 0, 0, 0, 0);
            if (!evDate || evDate < from) return false;
        }
        if (dateTo) {
            const to = toLondonDate(dateTo, 23, 59, 59, 999);
            if (!evDate || evDate > to) return false;
        }
        return true;
    });

    // Reset page on filter change
    useEffect(() => { setEvtPage(1); }, [statusFilter, searchQuery, dateFrom, dateTo, selectedRestaurant]);

    const totalPages = Math.ceil(filteredEvents.length / evtPageSize) || 1;
    const pagedEvents = filteredEvents.slice((evtPage - 1) * evtPageSize, evtPage * evtPageSize);

    const handleGenerate = async (rest) => {
        setGenerating(rest.id);
        try {
            const result = await generateApiKey(rest.id, rest.name);
            setApiKeys(prev => ({ ...prev, [rest.id]: result }));
            setShowKey(prev => ({ ...prev, [rest.id]: true }));
            toast.success(`API key generated for ${rest.name}`);
        } catch (err) {
            toast.error('Failed to generate API key');
        } finally {
            setGenerating(null);
        }
    };

    const handleRevoke = async (rest) => {
        if (!window.confirm(`Revoke API key for ${rest.name}? The EPOS vendor will no longer be able to send data.`)) return;
        try {
            await revokeApiKey(rest.id);
            setApiKeys(prev => { const n = { ...prev }; delete n[rest.id]; return n; });
            toast.success('API key revoked');
        } catch (err) {
            toast.error('Failed to revoke');
        }
    };

    const copyToClipboard = (text) => {
        navigator.clipboard.writeText(text);
        toast('Copied to clipboard', { icon: '📋' });
    };

    const statusBadge = (status) => {
        const map = {
            processed: { label: 'Processed', cls: 'badge-success' },
            partial_failure: { label: 'Partial Fail', cls: 'badge-danger' },
            has_unmapped: { label: 'Unmapped Items', cls: 'badge-warning' },
            mapping_broken: { label: 'Mapping Broken', cls: 'badge-danger' },
            no_recipe: { label: 'No Recipe', cls: 'badge-warning' },
            pending: { label: 'Pending', cls: 'badge-neutral' },
        };
        const s = map[status] || { label: status || 'Unknown', cls: 'badge-neutral' };
        return <span className={`badge ${s.cls}`}>{s.label}</span>;
    };

    const rowBgColor = (status) => {
        const map = {
            processed: 'rgba(34,197,94,0.04)',
            partial_failure: 'rgba(239,68,68,0.06)',
            has_unmapped: 'rgba(245,158,11,0.05)',
            pending: 'transparent',
        };
        return map[status] || 'transparent';
    };

    return (
        <div className="settings-integration-block">
            <div className="settings-integration-header">
                <div className="settings-integration-logo epos" style={{ background: 'rgba(139, 92, 246, 0.12)', color: '#8b5cf6' }}>E</div>
                <div>
                    <h4>EPOS System <span className="badge badge-success" style={{ marginLeft: 6 }}>Active</span></h4>
                    <p style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 2 }}>
                        Receives sales data from EPOS vendors and deducts restaurant inventory via recipes.
                    </p>
                </div>
            </div>

            {/* Webhook URL */}
            <div style={{
                margin: '16px 0', padding: '14px 16px',
                background: 'rgba(139, 92, 246, 0.06)', borderRadius: 'var(--radius-lg)',
                border: '1px solid rgba(139, 92, 246, 0.15)',
            }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 6 }}>
                    Webhook Endpoint URL
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <code style={{
                        flex: 1, fontSize: 12, padding: '8px 12px',
                        background: 'var(--color-bg)', borderRadius: 'var(--radius-md)',
                        border: '1px solid var(--color-border)', wordBreak: 'break-all',
                        color: 'var(--color-text-primary)', fontFamily: 'monospace',
                    }}>
                        {webhookUrl}
                    </code>
                    <button className="btn btn-ghost btn-sm" onClick={() => copyToClipboard(webhookUrl)} title="Copy URL">
                        <MdContentCopy />
                    </button>
                </div>
                <p style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 6 }}>
                    Share this URL with the EPOS vendor. They should POST sales data here with the restaurant's API key.
                </p>
            </div>

            {/* Per-Restaurant API Keys */}
            <div style={{ marginBottom: 16 }}>
                <h5 style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text-secondary)', marginBottom: 10 }}>
                    <MdVpnKey style={{ verticalAlign: 'middle', marginRight: 6 }} /> Restaurant API Keys
                </h5>
                {loadingKeys ? (
                    <div style={{ padding: 20, textAlign: 'center', color: 'var(--color-text-muted)' }}>Loading...</div>
                ) : restaurants.length === 0 ? (
                    <div style={{ padding: 20, textAlign: 'center', color: 'var(--color-text-muted)' }}>No restaurants found.</div>
                ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        {restaurants.map(r => {
                            const key = apiKeys[r.id];
                            const isVisible = showKey[r.id];
                            return (
                                <div key={r.id} style={{
                                    display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px',
                                    background: 'var(--color-surface)', border: '1px solid var(--color-border)',
                                    borderRadius: 'var(--radius-md)',
                                }}>
                                    <MdStore style={{ color: 'var(--color-primary)', flexShrink: 0 }} />
                                    <div style={{ flex: 1, minWidth: 0 }}>
                                        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text-primary)' }}>
                                            {r.name}
                                        </div>
                                        {key ? (
                                            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
                                                <code style={{
                                                    fontSize: 11, padding: '2px 8px',
                                                    background: 'var(--color-bg)', borderRadius: 4,
                                                    border: '1px solid var(--color-border)', fontFamily: 'monospace',
                                                    color: 'var(--color-text-secondary)',
                                                }}>
                                                    {isVisible ? key.api_key : '••••••••••••••••'}
                                                </code>
                                                <button className="btn-action" onClick={() => setShowKey(p => ({ ...p, [r.id]: !p[r.id] }))} title={isVisible ? 'Hide' : 'Show'}>
                                                    {isVisible ? <MdVisibilityOff size={14} /> : <MdVisibility size={14} />}
                                                </button>
                                                <button className="btn-action" onClick={() => copyToClipboard(key.api_key)} title="Copy">
                                                    <MdContentCopy size={14} />
                                                </button>
                                            </div>
                                        ) : (
                                            <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 2 }}>No API key generated</div>
                                        )}
                                    </div>
                                    <div style={{ display: 'flex', gap: 6 }}>
                                        {key ? (
                                            <>
                                                <button className="btn btn-ghost btn-sm" onClick={() => handleGenerate(r)}
                                                    disabled={generating === r.id} title="Regenerate key">
                                                    <MdRefresh size={14} /> {generating === r.id ? '...' : 'Regenerate'}
                                                </button>
                                                <button className="btn btn-ghost btn-sm" onClick={() => handleRevoke(r)}
                                                    style={{ color: 'var(--color-danger)' }} title="Revoke key">
                                                    <MdDelete size={14} /> Revoke
                                                </button>
                                            </>
                                        ) : (
                                            <button className="btn btn-primary btn-sm" onClick={() => handleGenerate(r)}
                                                disabled={generating === r.id}>
                                                <MdVpnKey size={14} /> {generating === r.id ? 'Generating...' : 'Generate Key'}
                                            </button>
                                        )}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>

            {/* Event Stats */}
            {eventStats && eventStats.total > 0 && (
                <div style={{
                    display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(100px, 1fr))',
                    gap: 8, marginBottom: 16,
                }}>
                    {[
                        { label: 'Total Events', val: eventStats.total, color: 'var(--color-text-primary)' },
                        { label: 'Processed', val: eventStats.processed, color: '#22c55e' },
                        { label: 'Unmapped', val: eventStats.unmapped, color: '#f59e0b' },
                        { label: 'Failed', val: eventStats.failed, color: '#ef4444' },
                    ].map((s, i) => (
                        <div key={i} style={{
                            padding: '10px 12px', background: 'var(--color-surface)',
                            border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)',
                            textAlign: 'center',
                        }}>
                            <div style={{ fontSize: 10, color: 'var(--color-text-muted)', textTransform: 'uppercase' }}>{s.label}</div>
                            <div style={{ fontSize: 18, fontWeight: 700, color: s.color }}>{s.val}</div>
                        </div>
                    ))}
                </div>
            )}

            {/* ── Events Log ── */}
            <div>
                <h5 style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text-secondary)', margin: '0 0 10px' }}>
                    <MdReceipt style={{ verticalAlign: 'middle', marginRight: 6 }} /> Webhook Events
                    <span style={{ fontWeight: 400, fontSize: 11, color: 'var(--color-text-muted)', marginLeft: 8 }}>
                        ({filteredEvents.length} of {events.length})
                    </span>
                </h5>

                {/* Filter Bar */}
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10, alignItems: 'center' }}>
                    <select className="settings-field-input" style={{ width: 'auto', minWidth: 160 }}
                        value={selectedRestaurant} onChange={e => setSelectedRestaurant(e.target.value)}>
                        <option value="">All Restaurants</option>
                        {restaurants.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                    </select>
                    <select className="settings-field-input" style={{ width: 'auto', minWidth: 140 }}
                        value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
                        <option value="">All Statuses</option>
                        <option value="processed">Processed</option>
                        <option value="has_unmapped">Unmapped</option>
                        <option value="partial_failure">Partial Fail</option>
                        <option value="pending">Pending</option>
                    </select>
                    <input type="date" className="settings-field-input" style={{ width: 'auto' }}
                        value={dateFrom} onChange={e => setDateFrom(e.target.value)} title="From date" />
                    <input type="date" className="settings-field-input" style={{ width: 'auto' }}
                        value={dateTo} onChange={e => setDateTo(e.target.value)} title="To date" />
                    <input className="settings-field-input" style={{ width: 'auto', minWidth: 150 }}
                        placeholder="Search order ID…" value={searchQuery}
                        onChange={e => setSearchQuery(e.target.value)} />
                    {(statusFilter || dateFrom || dateTo || searchQuery) && (
                        <button className="btn btn-ghost btn-sm" onClick={() => { setStatusFilter(''); setDateFrom(''); setDateTo(''); setSearchQuery(''); }}>
                            <MdClose size={14} /> Clear
                        </button>
                    )}
                </div>

                {filteredEvents.length === 0 ? (
                    <div style={{ padding: '30px 20px', textAlign: 'center', color: 'var(--color-text-muted)', background: 'var(--color-surface)', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)' }}>
                        <MdReceipt style={{ fontSize: 28, display: 'block', margin: '0 auto 8px' }} />
                        {events.length === 0 ? 'No EPOS events received yet.' : 'No events match the current filters.'}
                    </div>
                ) : (
                    <>
                        <div style={{ border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', overflow: 'hidden' }}>
                            <table className="data-table" style={{ fontSize: 12 }}>
                                <thead>
                                    <tr>
                                        <th>Time</th><th>Restaurant</th><th>EPOS Order</th>
                                        <th>Items</th><th>Processed</th><th>Unmapped</th><th>Errors</th><th>Status</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {pagedEvents.map(ev => {
                                        const pr = ev.processing_result || {};
                                        const processed = (pr.results || []).filter(r => r.status === 'processed').length;
                                        const unmapped = (pr.results || []).filter(r => r.status === 'unmapped' || r.status === 'mapping_broken').length;
                                        const errCount = (pr.errors || []).length;
                                        return (
                                            <tr key={ev.id} onClick={() => setDetailEvent(ev)}
                                                style={{ cursor: 'pointer', background: rowBgColor(ev.processing_status), transition: 'background 0.15s' }}
                                                onMouseEnter={e => e.currentTarget.style.background = 'rgba(201,169,110,0.08)'}
                                                onMouseLeave={e => e.currentTarget.style.background = rowBgColor(ev.processing_status)}>
                                                <td>{ev.received_at ? ev.received_at.toLocaleString('en-GB', { timeZone: 'Europe/London', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'}</td>
                                                <td>{ev.restaurant_name || '—'}</td>
                                                <td style={{ fontFamily: 'monospace', fontSize: 11 }}>{ev.epos_order_id}</td>
                                                <td>{ev.line_items?.length || 0}</td>
                                                <td style={{ color: '#22c55e', fontWeight: 600 }}>{processed || '—'}</td>
                                                <td style={{ color: unmapped > 0 ? '#f59e0b' : undefined, fontWeight: unmapped > 0 ? 600 : 400 }}>{unmapped || '—'}</td>
                                                <td style={{ color: errCount > 0 ? '#ef4444' : undefined, fontWeight: errCount > 0 ? 600 : 400 }}>{errCount || '—'}</td>
                                                <td>{statusBadge(ev.processing_status)}</td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                        {/* Pagination */}
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 0', fontSize: 12, color: 'var(--color-text-muted)' }}>
                            <span>Showing {(evtPage - 1) * evtPageSize + 1}–{Math.min(evtPage * evtPageSize, filteredEvents.length)} of {filteredEvents.length}</span>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                <select value={evtPageSize} onChange={e => { setEvtPageSize(+e.target.value); setEvtPage(1); }}
                                    style={{ padding: '4px 8px', borderRadius: 4, fontSize: 12, background: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}>
                                    {[25, 50, 100].map(n => <option key={n} value={n}>{n}/page</option>)}
                                </select>
                                <button disabled={evtPage <= 1} onClick={() => setEvtPage(p => p - 1)}
                                    style={{ padding: '4px 10px', borderRadius: 4, cursor: 'pointer', background: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-text)', opacity: evtPage <= 1 ? 0.4 : 1 }}>←</button>
                                <span>{evtPage} / {totalPages}</span>
                                <button disabled={evtPage >= totalPages} onClick={() => setEvtPage(p => p + 1)}
                                    style={{ padding: '4px 10px', borderRadius: 4, cursor: 'pointer', background: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-text)', opacity: evtPage >= totalPages ? 0.4 : 1 }}>→</button>
                            </div>
                        </div>
                    </>
                )}
            </div>

            {/* ── Detail Modal ── */}
            {detailEvent && (() => {
                const classifyError = (errMsg) => {
                    if (!errMsg) return { source: 'Unknown', label: 'Unknown error', color: '#6b7280' };
                    const msg = errMsg.toLowerCase();
                    if (msg.includes('not defined') || msg.includes('cannot read') || msg.includes('typeerror') || msg.includes('referenceerror'))
                        return { source: '🐛 App Bug', label: 'Internal application error — fixed in latest deploy.', color: '#8b5cf6' };
                    if (msg.includes('not found in database') || (msg.includes('menu item') && msg.includes('deleted')))
                        return { source: '🗑️ Deleted Item', label: 'Mapped menu item was deleted. Needs remapping.', color: '#ef4444' };
                    if (msg.includes('no mapping') || msg.includes('unmapped'))
                        return { source: '🔗 No Mapping', label: 'No mapping to menu item. Needs mapping.', color: '#f59e0b' };
                    if (msg.includes('no recipe'))
                        return { source: '📋 No Recipe', label: 'Menu item has no recipe defined.', color: '#f59e0b' };
                    if (msg.includes('inventory') || msg.includes('stock'))
                        return { source: '📦 Inventory', label: 'Inventory item not found or stock error.', color: '#3b82f6' };
                    if (msg.includes('portion'))
                        return { source: '⚙️ Portion', label: 'Could not find the portion on menu item.', color: '#f59e0b' };
                    if (msg.includes('timeout') || msg.includes('network'))
                        return { source: '🌐 Network', label: 'Network or timeout issue.', color: '#6b7280' };
                    return { source: '❓ Other', label: errMsg, color: '#6b7280' };
                };
                const pr = detailEvent.processing_result || {};
                const results = pr.results || [];
                const errors = pr.errors || [];
                const cellPad = { padding: '6px 8px' };
                return (
                    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                        onClick={() => setDetailEvent(null)}>
                        <div style={{ background: 'var(--color-card, #1e1e2e)', borderRadius: 12, width: '90%', maxWidth: 780, maxHeight: '85vh', overflow: 'auto', padding: 24, position: 'relative' }}
                            onClick={e => e.stopPropagation()}>
                            <button onClick={() => setDetailEvent(null)}
                                style={{ position: 'absolute', top: 12, right: 12, background: 'none', border: 'none', color: 'var(--color-text-muted)', cursor: 'pointer', fontSize: 20 }}><MdClose /></button>
                            <div style={{ marginBottom: 16 }}>
                                <h4 style={{ margin: 0, fontSize: 16 }}>Event Detail</h4>
                                <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginTop: 8, fontSize: 13, color: 'var(--color-text-muted)' }}>
                                    <span><strong>Order:</strong> <code style={{ fontSize: 12 }}>{detailEvent.epos_order_id}</code></span>
                                    <span><strong>Restaurant:</strong> {detailEvent.restaurant_name || '—'}</span>
                                    <span><strong>Time:</strong> {detailEvent.received_at?.toLocaleString('en-GB', { timeZone: 'Europe/London' }) || '—'}</span>
                                    <span>{statusBadge(detailEvent.processing_status)}</span>
                                </div>
                                {detailEvent.error_message && (
                                    <div style={{ marginTop: 8, padding: '8px 12px', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 6, fontSize: 12, color: '#ef4444' }}>
                                        ⚠️ {detailEvent.error_message}
                                    </div>
                                )}
                            </div>
                            {results.length > 0 && (
                                <div style={{ marginBottom: 16 }}>
                                    <h5 style={{ fontSize: 13, fontWeight: 600, marginBottom: 8, color: 'var(--color-text-secondary)' }}>📋 Items ({results.length})</h5>
                                    <div style={{ border: '1px solid var(--color-border)', borderRadius: 8, overflowX: 'auto' }}>
                                        <table className="data-table" style={{ fontSize: 11, minWidth: 600 }}>
                                            <thead><tr><th>EPOS Item</th><th>Menu Item</th><th>Portion</th><th>Qty</th><th>Status</th><th>Detail</th></tr></thead>
                                            <tbody>
                                                {results.map((r, i) => (
                                                    <tr key={i} style={{ background: r.status === 'processed' ? 'rgba(34,197,94,0.04)' : r.status === 'unmapped' || r.status === 'mapping_broken' ? 'rgba(245,158,11,0.06)' : 'transparent' }}>
                                                        <td style={{ ...cellPad, fontWeight: 600 }}>{r.epos_item_name || r.epos_item_id}</td>
                                                        <td style={cellPad}>{r.menu_item || '—'}</td>
                                                        <td style={cellPad}>{r.portion || '—'}</td>
                                                        <td style={cellPad}>{r.quantity_sold || '—'}</td>
                                                        <td style={cellPad}>{statusBadge(r.status)}</td>
                                                        <td style={{ ...cellPad, fontSize: 10, color: 'var(--color-text-muted)', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                                                            title={r.message || ''}>{r.message || (r.deductions?.length ? `${r.deductions.length} deductions` : '—')}</td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                </div>
                            )}
                            {errors.length > 0 && (
                                <div style={{ marginBottom: 16 }}>
                                    <h5 style={{ fontSize: 13, fontWeight: 600, marginBottom: 8, color: '#ef4444' }}>❌ Errors ({errors.length})</h5>
                                    <div style={{ border: '1px solid var(--color-border)', borderRadius: 8, overflowX: 'auto' }}>
                                        <table className="data-table" style={{ fontSize: 11, minWidth: 550 }}>
                                            <thead><tr><th>EPOS Item</th><th>Source</th><th>Explanation</th><th>Raw Error</th></tr></thead>
                                            <tbody>
                                                {errors.map((err, i) => {
                                                    const c = classifyError(err.error);
                                                    return (
                                                        <tr key={i} style={{ background: 'rgba(239,68,68,0.04)' }}>
                                                            <td style={{ ...cellPad, fontWeight: 600 }}>{err.epos_item_name || err.epos_item_id}</td>
                                                            <td style={cellPad}><span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 4, fontSize: 10, fontWeight: 600, background: c.color + '18', color: c.color, whiteSpace: 'nowrap' }}>{c.source}</span></td>
                                                            <td style={{ ...cellPad, fontSize: 11, color: 'var(--color-text-secondary)' }}>{c.label}</td>
                                                            <td style={{ ...cellPad, fontSize: 10, fontFamily: 'monospace', color: 'var(--color-text-muted)', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                                                                title={err.error}>{err.error}</td>
                                                        </tr>
                                                    );
                                                })}
                                            </tbody>
                                        </table>
                                    </div>
                                </div>
                            )}
                            {results.some(r => r.deductions?.length > 0) && (
                                <div>
                                    <h5 style={{ fontSize: 13, fontWeight: 600, marginBottom: 8, color: 'var(--color-text-secondary)' }}>📦 Inventory Deductions</h5>
                                    <div style={{ border: '1px solid var(--color-border)', borderRadius: 8, overflowX: 'auto' }}>
                                        <table className="data-table" style={{ fontSize: 11, minWidth: 500 }}>
                                            <thead><tr><th>Item</th><th>Required</th><th>Unit</th><th>Before</th><th>After</th><th>Status</th></tr></thead>
                                            <tbody>
                                                {results.flatMap((r, ri) => (r.deductions || []).map((d, di) => (
                                                    <tr key={`${ri}-${di}`}>
                                                        <td style={{ ...cellPad, fontWeight: 600 }}>{d.item_name}</td>
                                                        <td style={cellPad}>{d.required?.toFixed(3)}</td>
                                                        <td style={cellPad}>{d.unit}</td>
                                                        <td style={cellPad}>{d.previous_stock?.toFixed(2) ?? '—'}</td>
                                                        <td style={{ ...cellPad, color: d.new_stock <= 0 ? '#ef4444' : undefined }}>{d.new_stock?.toFixed(2) ?? '—'}</td>
                                                        <td style={cellPad}>{d.status === 'depleted' ? <span className="badge badge-danger">Depleted</span> : d.status === 'not_in_inventory' ? <span className="badge badge-warning">Not in inventory</span> : <span className="badge badge-success">Deducted</span>}</td>
                                                    </tr>
                                                )))}
                                            </tbody>
                                        </table>
                                    </div>
                                </div>
                            )}
                            {results.length === 0 && errors.length === 0 && (
                                <div style={{ padding: 20, textAlign: 'center', color: 'var(--color-text-muted)', fontSize: 13 }}>No processing details available for this event.</div>
                            )}
                        </div>
                    </div>
                );
            })()}
        </div>
    );
};

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

    // Check for activeTab from navigation state (e.g., after Xero OAuth callback)
    useEffect(() => {
        const state = window.history?.state?.usr;
        if (state?.activeTab) {
            setActiveTab(state.activeTab);
        }
    }, []);

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
                    <>
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

                    {/* Data Maintenance */}
                    <div className="settings-section" style={{ marginTop: 'var(--space-5)' }}>
                        <div className="settings-section-header">
                            <div>
                                <h3>Data Maintenance</h3>
                                <p>One-time utilities to fix or sync data across restaurants.</p>
                            </div>
                        </div>
                        <div className="settings-fields">
                            <div className="settings-field-row">
                                <label className="settings-field-label">Sync Restaurant Categories</label>
                                <div className="settings-field-input-wrap">
                                    <button
                                        className="btn btn-secondary"
                                        style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 16px' }}
                                        onClick={async () => {
                                            try {
                                                toast.loading('Syncing categories...', { id: 'seed-cat' });
                                                const result = await seedRestaurantInventoryCategories();
                                                const msg = typeof result === 'object'
                                                    ? `Categories: ${result.categories} | CK Items: ${result.ckItems} (${result.ckWithCategory} with cat) | Restaurant Items: ${result.restaurantItems} | Updated: ${result.updated} | Already had: ${result.alreadyHad} | No match: ${result.noMatch}`
                                                    : `Updated ${result} items`;
                                                toast.success(msg, { id: 'seed-cat', duration: 10000 });
                                                if (result.noMatch > 0) {
                                                    console.warn('Items with no category match — check browser console for details');
                                                }
                                            } catch (err) {
                                                console.error('Seed error:', err);
                                                toast.error('Failed to sync categories: ' + (err.message || ''), { id: 'seed-cat' });
                                            }
                                        }}
                                    >
                                        <MdSync /> Sync Now
                                    </button>
                                    <span className="settings-field-helper">Updates all restaurant inventory items with the correct category name from Central Kitchen.</span>
                                </div>
                            </div>
                        </div>
                    </div>
                    </>
                )}

                {/* ═══ INTEGRATIONS ═══ */}
                {activeTab === 'integrations' && (
                    <div className="settings-section">
                        <div className="settings-section-header">
                            <div>
                                <h3>Integrations</h3>
                                <p>Connect external services. Manage Xero accounts and map restaurants.</p>
                            </div>
                        </div>

                        {/* Xero Multi-Account Integration */}
                        <div className="settings-integration-block">
                            <div className="settings-integration-header">
                                <div className="settings-integration-logo xero">X</div>
                                <div>
                                    <h4>Xero Accounting</h4>
                                    <p style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 2 }}>
                                        Sync invoices to multiple Xero organisations. One-way sync (app → Xero).
                                    </p>
                                </div>
                            </div>
                            <XeroIntegrationSection />
                        </div>

                        {/* ══ EPOS Integration ══ */}
                        <EposIntegrationSection />

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
