/**
 * Settings Service
 * CRUD for Firestore `settings` collection.
 * Each section is its own document: company, notifications, inventory, integrations, security
 *
 * Xero Multi-Account Architecture:
 *   settings/integrations → {
 *     xero_accounts: [ { id, name, client_id, client_secret, ... } ],
 *     xero_restaurant_mappings: [ { restaurant_id, xero_account_id, xero_tenant_id, ... } ]
 *   }
 */

import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from '../firebase';

const COLLECTION = 'settings';

// ─── Defaults (used when doc doesn't exist yet) ───
const DEFAULTS = {
    company: {
        company_name: 'Watan Restaurants',
        vat_number: '',
        address: '',
        phone: '',
        email: '',
        currency: 'GBP',
        timezone: 'Europe/London',
    },
    notifications: {
        low_stock_alerts: true,
        order_status_updates: true,
        batch_expiry_warnings: true,
        batch_expiry_hours: 24,
        waste_submission_alerts: true,
        web_push: false,
    },
    inventory: {
        default_low_stock_threshold: 10,
        default_expiry_warning_hours: 24,
        default_storage_type: 'ambient',
    },
    integrations: {
        // Legacy single-account fields kept for backward compat
        xero_connected: false,
        xero_client_id: '',
        xero_client_secret: '',
        xero_redirect_uri: '',
        xero_tenant_id: '',
        xero_connected_at: null,
        // Multi-account fields
        xero_accounts: [],
        xero_restaurant_mappings: [],
    },
    security: {
        session_timeout_minutes: 30,
        audit_logging: true,
    },
};

/**
 * Get a settings section (or all sections if no key given)
 */
export const getSettings = async (section) => {
    if (section) {
        const snap = await getDoc(doc(db, COLLECTION, section));
        return snap.exists() ? { ...DEFAULTS[section], ...snap.data() } : { ...DEFAULTS[section] };
    }
    // All sections
    const result = {};
    for (const key of Object.keys(DEFAULTS)) {
        const snap = await getDoc(doc(db, COLLECTION, key));
        result[key] = snap.exists() ? { ...DEFAULTS[key], ...snap.data() } : { ...DEFAULTS[key] };
    }
    return result;
};

/**
 * Update (merge) a settings section
 */
export const updateSettings = async (section, data) => {
    await setDoc(doc(db, COLLECTION, section), {
        ...data,
        updated_at: new Date(),
    }, { merge: true });
};

// ═══════════════════════════════════════════════════════
//  XERO — Legacy single-credential helpers (backward compat)
// ═══════════════════════════════════════════════════════

export const saveXeroCredentials = async ({ clientId, clientSecret, redirectUri }) => {
    await setDoc(doc(db, COLLECTION, 'integrations'), {
        xero_client_id: clientId,
        xero_client_secret: clientSecret,
        xero_redirect_uri: redirectUri || '',
        xero_connected: false,
        xero_connected_at: null,
        xero_tenant_id: '',
        updated_at: new Date(),
    }, { merge: true });
};

export const removeXeroCredentials = async () => {
    await setDoc(doc(db, COLLECTION, 'integrations'), {
        xero_client_id: '',
        xero_client_secret: '',
        xero_redirect_uri: '',
        xero_connected: false,
        xero_connected_at: null,
        xero_tenant_id: '',
        updated_at: new Date(),
    }, { merge: true });
};

// ═══════════════════════════════════════════════════════
//  XERO — Multi-Account Management
// ═══════════════════════════════════════════════════════

/**
 * Generate a simple unique ID for Xero accounts
 */
const generateId = () => {
    return `xero_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
};

/**
 * Get all Xero accounts from settings/integrations
 */
export const getXeroAccounts = async () => {
    const snap = await getDoc(doc(db, COLLECTION, 'integrations'));
    if (!snap.exists()) return [];
    const data = snap.data();
    return data.xero_accounts || [];
};

/**
 * Add a new Xero account
 * @param {{ name: string, client_id: string, client_secret: string, redirect_uri?: string }} account
 * @returns {string} the generated account ID
 */
export const addXeroAccount = async ({ name, client_id, client_secret, redirect_uri }) => {
    const accounts = await getXeroAccounts();
    const id = generateId();

    const newAccount = {
        id,
        name: name || 'Unnamed Account',
        client_id: client_id || '',
        client_secret: client_secret || '',
        redirect_uri: redirect_uri || 'http://localhost:3000/callback',
        connected: false,
        connected_at: null,
        access_token: '',
        refresh_token: '',
        token_expires_at: null,
        tenants: [],
        created_at: new Date().toISOString(),
    };

    accounts.push(newAccount);

    await setDoc(doc(db, COLLECTION, 'integrations'), {
        xero_accounts: accounts,
        updated_at: new Date(),
    }, { merge: true });

    return id;
};

/**
 * Update an existing Xero account
 * @param {string} accountId
 * @param {Object} updates — partial fields to merge
 */
export const updateXeroAccount = async (accountId, updates) => {
    const accounts = await getXeroAccounts();
    const idx = accounts.findIndex(a => a.id === accountId);
    if (idx === -1) throw new Error(`Xero account ${accountId} not found`);

    accounts[idx] = { ...accounts[idx], ...updates, updated_at: new Date().toISOString() };

    await setDoc(doc(db, COLLECTION, 'integrations'), {
        xero_accounts: accounts,
        updated_at: new Date(),
    }, { merge: true });
};

/**
 * Remove a Xero account and its restaurant mappings
 * @param {string} accountId
 */
export const removeXeroAccount = async (accountId) => {
    const snap = await getDoc(doc(db, COLLECTION, 'integrations'));
    if (!snap.exists()) return;
    const data = snap.data();

    const accounts = (data.xero_accounts || []).filter(a => a.id !== accountId);
    const mappings = (data.xero_restaurant_mappings || []).filter(m => m.xero_account_id !== accountId);

    await setDoc(doc(db, COLLECTION, 'integrations'), {
        xero_accounts: accounts,
        xero_restaurant_mappings: mappings,
        updated_at: new Date(),
    }, { merge: true });
};

// ═══════════════════════════════════════════════════════
//  XERO — Restaurant ↔ Xero Organisation Mapping
// ═══════════════════════════════════════════════════════

/**
 * Get all restaurant → Xero mappings
 */
export const getXeroRestaurantMappings = async () => {
    const snap = await getDoc(doc(db, COLLECTION, 'integrations'));
    if (!snap.exists()) return [];
    const data = snap.data();
    return data.xero_restaurant_mappings || [];
};

/**
 * Set (create or update) a restaurant → Xero mapping
 * @param {Object} mapping — {
 *   restaurant_id, restaurant_name,
 *   xero_account_id, xero_tenant_id, xero_org_name,
 *   account_code, invoice_status
 * }
 */
export const setXeroRestaurantMapping = async (mapping) => {
    const mappings = await getXeroRestaurantMappings();
    const idx = mappings.findIndex(m => m.restaurant_id === mapping.restaurant_id);

    const newMapping = {
        ...mapping,
        invoice_status: mapping.invoice_status || 'DRAFT',
        updated_at: new Date().toISOString(),
    };

    if (idx >= 0) {
        mappings[idx] = { ...mappings[idx], ...newMapping };
    } else {
        mappings.push(newMapping);
    }

    await setDoc(doc(db, COLLECTION, 'integrations'), {
        xero_restaurant_mappings: mappings,
        updated_at: new Date(),
    }, { merge: true });
};

/**
 * Remove a restaurant → Xero mapping
 * @param {string} restaurantId
 */
export const removeXeroRestaurantMapping = async (restaurantId) => {
    const mappings = await getXeroRestaurantMappings();
    const filtered = mappings.filter(m => m.restaurant_id !== restaurantId);

    await setDoc(doc(db, COLLECTION, 'integrations'), {
        xero_restaurant_mappings: filtered,
        updated_at: new Date(),
    }, { merge: true });
};

/**
 * Save all restaurant mappings at once (bulk save from the mapping UI)
 * @param {Array} mappings — full array of mapping objects
 */
export const saveAllXeroRestaurantMappings = async (mappings) => {
    await setDoc(doc(db, COLLECTION, 'integrations'), {
        xero_restaurant_mappings: mappings.map(m => ({
            ...m,
            invoice_status: m.invoice_status || 'DRAFT',
            updated_at: new Date().toISOString(),
        })),
        updated_at: new Date(),
    }, { merge: true });
};

/**
 * Get the Xero mapping for a specific restaurant
 * Returns null if not mapped
 * @param {string} restaurantId
 */
export const getXeroMappingForRestaurant = async (restaurantId) => {
    const mappings = await getXeroRestaurantMappings();
    return mappings.find(m => m.restaurant_id === restaurantId) || null;
};

/**
 * Get Xero account details by account ID
 * @param {string} accountId
 */
export const getXeroAccountById = async (accountId) => {
    const accounts = await getXeroAccounts();
    return accounts.find(a => a.id === accountId) || null;
};
