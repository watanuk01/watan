/**
 * Settings Service
 * CRUD for Firestore `settings` collection.
 * Each section is its own document: company, notifications, inventory, integrations, security
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
        xero_connected: false,
        xero_client_id: '',
        xero_client_secret: '',
        xero_redirect_uri: '',
        xero_tenant_id: '',
        xero_connected_at: null,
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

/**
 * Xero-specific helpers
 */
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
