/**
 * Watan Central Kitchen — Cloud Functions
 *
 * sendInvoiceEmail: Generates a PDF from invoice HTML and emails it to the restaurant.
 * xeroTokenExchange: Exchanges OAuth auth code for access/refresh tokens.
 * xeroSyncInvoice: Pushes an invoice to the correct Xero organisation.
 * xeroGetOrganisations: Fetches connected Xero tenants for an account.
 * eposWebhook: Receives EPOS sales webhooks and deducts restaurant inventory.
 */

const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { onRequest } = require('firebase-functions/v2/https');
const admin = require('firebase-admin');
const nodemailer = require('nodemailer');
const axios = require('axios');

admin.initializeApp();

const db = admin.firestore();

// ─── GMAIL SMTP CONFIG ───
const GMAIL_USER = 'watanuk01@gmail.com';
const GMAIL_APP_PASSWORD = 'rkzs qgyc jdsi wjmh';

const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: GMAIL_USER,
        pass: GMAIL_APP_PASSWORD,
    },
});

// ═══════════════════════════════════════════════════════
//  XERO CONSTANTS
// ═══════════════════════════════════════════════════════

const XERO_TOKEN_URL = 'https://identity.xero.com/connect/token';
const XERO_CONNECTIONS_URL = 'https://api.xero.com/connections';
const XERO_INVOICES_URL = 'https://api.xero.com/api.xro/2.0/Invoices';
const XERO_ACCOUNTS_URL = 'https://api.xero.com/api.xro/2.0/Accounts';
const XERO_TRACKING_URL = 'https://api.xero.com/api.xro/2.0/TrackingCategories';

// ═══════════════════════════════════════════════════════
//  XERO HELPERS
// ═══════════════════════════════════════════════════════

/**
 * Read a specific Xero account from settings/integrations
 */
const getXeroAccount = async (accountId) => {
    const snap = await db.collection('settings').doc('integrations').get();
    if (!snap.exists) throw new HttpsError('not-found', 'Integration settings not found');
    const data = snap.data();
    const accounts = data.xero_accounts || [];
    const account = accounts.find(a => a.id === accountId);
    if (!account) throw new HttpsError('not-found', `Xero account ${accountId} not found`);
    return { account, accounts, data };
};

/**
 * Save updated Xero accounts array back to Firestore
 */
const saveXeroAccounts = async (accounts) => {
    await db.collection('settings').doc('integrations').set({
        xero_accounts: accounts,
        updated_at: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
};

/**
 * Refresh the Xero access token if expired
 * Returns the valid access_token
 */
const ensureValidToken = async (accountId) => {
    const { account, accounts } = await getXeroAccount(accountId);

    if (!account.refresh_token) {
        throw new HttpsError('failed-precondition', 'No refresh token. Please reconnect this Xero account.');
    }

    // Check if token is still valid (with 60s buffer)
    const expiresAt = account.token_expires_at;
    const now = Date.now();
    if (expiresAt && typeof expiresAt === 'number' && expiresAt > now + 60000 && account.access_token) {
        return account.access_token;
    }

    // Token expired or about to expire — refresh it
    console.log(`Refreshing Xero token for account: ${account.name}`);
    try {
        const response = await axios.post(XERO_TOKEN_URL, new URLSearchParams({
            grant_type: 'refresh_token',
            refresh_token: account.refresh_token,
            client_id: account.client_id,
            client_secret: account.client_secret,
        }).toString(), {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        });

        const { access_token, refresh_token, expires_in } = response.data;

        // Update account in the array
        const idx = accounts.findIndex(a => a.id === accountId);
        accounts[idx] = {
            ...accounts[idx],
            access_token,
            refresh_token: refresh_token || account.refresh_token,
            token_expires_at: Date.now() + (expires_in * 1000),
            updated_at: new Date().toISOString(),
        };

        await saveXeroAccounts(accounts);
        console.log(`Token refreshed for account: ${account.name}`);
        return access_token;
    } catch (err) {
        console.error('Token refresh failed:', err.response?.data || err.message);
        // Mark account as disconnected
        const idx = accounts.findIndex(a => a.id === accountId);
        accounts[idx] = { ...accounts[idx], connected: false, access_token: '', refresh_token: '' };
        await saveXeroAccounts(accounts);
        throw new HttpsError('unauthenticated', 'Xero token refresh failed. Please reconnect the account.');
    }
};

/**
 * Get the Xero restaurant mapping for an invoice
 */
const getRestaurantMapping = async (restaurantId) => {
    const snap = await db.collection('settings').doc('integrations').get();
    if (!snap.exists) return null;
    const data = snap.data();
    const mappings = data.xero_restaurant_mappings || [];
    return mappings.find(m => m.restaurant_id === restaurantId) || null;
};

// ═══════════════════════════════════════════════════════
//  1. SEND INVOICE EMAIL (existing)
// ═══════════════════════════════════════════════════════

exports.sendInvoiceEmail = onCall({ maxInstances: 10 }, async (request) => {
    const { invoiceId, recipientEmail, invoiceHtml } = request.data;

    if (!recipientEmail || !invoiceHtml) {
        throw new HttpsError('invalid-argument', 'recipientEmail and invoiceHtml are required');
    }

    // Fetch invoice data from Firestore for subject line
    let invoiceNumber = 'Invoice';
    let restaurantName = '';
    if (invoiceId) {
        try {
            const invoiceDoc = await db.collection('invoices').doc(invoiceId).get();
            if (invoiceDoc.exists) {
                const data = invoiceDoc.data();
                invoiceNumber = data.invoice_number || invoiceNumber;
                restaurantName = data.customer?.restaurant_name || data.customer?.name || '';
            }
        } catch (err) {
            console.warn('Could not fetch invoice data:', err.message);
        }
    }

    // Wrap the invoice HTML in a complete email template
    const emailHtml = `
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <style>
                body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; margin: 0; padding: 0; background: #f5f5f5; }
                .email-wrapper { max-width: 900px; margin: 0 auto; background: #ffffff; }
                .email-header { background: #1a1a2e; color: #d4af37; padding: 24px 40px; }
                .email-header h1 { margin: 0; font-size: 22px; font-weight: 800; }
                .email-header p { margin: 4px 0 0; color: #ccc; font-size: 14px; }
                .email-body { padding: 0; }
                .email-footer { background: #f9fafb; padding: 20px 40px; text-align: center; font-size: 12px; color: #6b7280; border-top: 1px solid #e5e7eb; }
                table { width: 100%; border-collapse: collapse; }
                th, td { padding: 10px 12px; text-align: left; }
                th { background: #f9fafb; color: #374151; font-weight: 600; border-bottom: 2px solid #e5e7eb; }
                td { border-bottom: 1px solid #f3f4f6; color: #111; }
                .text-right { text-align: right; }
            </style>
        </head>
        <body>
            <div class="email-wrapper">
                <div class="email-header">
                    <h1>📄 ${invoiceNumber}</h1>
                    <p>VAT Invoice from Watan Central Kitchen</p>
                </div>
                <div class="email-body">
                    ${invoiceHtml}
                </div>
                <div class="email-footer">
                    <p>This is a VAT invoice issued under UK regulations.</p>
                    <p>If you have any questions, please reply to this email.</p>
                </div>
            </div>
        </body>
        </html>
    `;

    try {
        await transporter.sendMail({
            from: `"Watan Central Kitchen" <${GMAIL_USER}>`,
            to: recipientEmail,
            subject: `Invoice ${invoiceNumber}${restaurantName ? ` — ${restaurantName}` : ''}`,
            html: emailHtml,
        });

        console.log(`Invoice email sent to ${recipientEmail} for ${invoiceNumber}`);

        // Update invoice to track email sent
        if (invoiceId) {
            try {
                await db.collection('invoices').doc(invoiceId).update({
                    email_sent_to: recipientEmail,
                    email_sent_at: admin.firestore.FieldValue.serverTimestamp(),
                });
            } catch (updateErr) {
                console.warn('Could not update invoice email tracking:', updateErr.message);
            }
        }

        return { success: true, message: `Invoice emailed to ${recipientEmail}` };
    } catch (err) {
        console.error('Email send failed:', err);
        throw new HttpsError('internal', `Failed to send email: ${err.message}`);
    }
});

// ═══════════════════════════════════════════════════════
//  2. XERO TOKEN EXCHANGE
// ═══════════════════════════════════════════════════════

/**
 * xeroTokenExchange — Exchange an OAuth authorization code for tokens
 *
 * Accepts: { code, accountId, redirectUri }
 * Returns: { success, tenants }
 */
exports.xeroTokenExchange = onCall({ maxInstances: 5 }, async (request) => {
    const { code, accountId, redirectUri } = request.data;

    if (!code || !accountId) {
        throw new HttpsError('invalid-argument', 'code and accountId are required');
    }

    // 1. Load the Xero account credentials
    const { account, accounts } = await getXeroAccount(accountId);

    if (!account.client_id || !account.client_secret) {
        throw new HttpsError('failed-precondition', 'Client ID and Secret are not configured for this account');
    }

    const finalRedirectUri = redirectUri || account.redirect_uri || 'http://localhost:3000/callback';

    try {
        // 2. Exchange the auth code for tokens
        console.log(`Exchanging auth code for account: ${account.name}`);
        const tokenResponse = await axios.post(XERO_TOKEN_URL, new URLSearchParams({
            grant_type: 'authorization_code',
            code,
            redirect_uri: finalRedirectUri,
            client_id: account.client_id,
            client_secret: account.client_secret,
        }).toString(), {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        });

        const { access_token, refresh_token, expires_in } = tokenResponse.data;
        console.log(`Token obtained for account: ${account.name}, expires in ${expires_in}s`);

        // 3. Fetch connected tenants (organisations)
        let tenants = [];
        try {
            const connectionsResponse = await axios.get(XERO_CONNECTIONS_URL, {
                headers: { Authorization: `Bearer ${access_token}` },
            });
            tenants = (connectionsResponse.data || []).map(t => ({
                tenant_id: t.tenantId,
                tenant_name: t.tenantName,
                tenant_type: t.tenantType,
            }));
            console.log(`Discovered ${tenants.length} tenants for account: ${account.name}`);
        } catch (connErr) {
            console.warn('Could not fetch Xero connections:', connErr.message);
        }

        // 4. Update account in Firestore
        const idx = accounts.findIndex(a => a.id === accountId);
        accounts[idx] = {
            ...accounts[idx],
            access_token,
            refresh_token,
            token_expires_at: Date.now() + (expires_in * 1000),
            connected: true,
            connected_at: new Date().toISOString(),
            tenants,
            redirect_uri: finalRedirectUri,
            updated_at: new Date().toISOString(),
        };

        await saveXeroAccounts(accounts);

        return { success: true, tenants };
    } catch (err) {
        const errMsg = err.response?.data?.error_description || err.response?.data?.error || err.message;
        console.error('Xero token exchange failed:', errMsg, err.response?.data);
        throw new HttpsError('internal', `Xero token exchange failed: ${errMsg}`);
    }
});

// ═══════════════════════════════════════════════════════
//  3. XERO GET ORGANISATIONS
// ═══════════════════════════════════════════════════════

/**
 * xeroGetOrganisations — Fetch connected tenants for a Xero account
 *
 * Accepts: { accountId }
 * Returns: { tenants }
 */
exports.xeroGetOrganisations = onCall({ maxInstances: 5 }, async (request) => {
    const { accountId } = request.data;

    if (!accountId) {
        throw new HttpsError('invalid-argument', 'accountId is required');
    }

    const accessToken = await ensureValidToken(accountId);

    try {
        const response = await axios.get(XERO_CONNECTIONS_URL, {
            headers: { Authorization: `Bearer ${accessToken}` },
        });

        const tenants = (response.data || []).map(t => ({
            tenant_id: t.tenantId,
            tenant_name: t.tenantName,
            tenant_type: t.tenantType,
        }));

        // Update stored tenants
        const { accounts } = await getXeroAccount(accountId);
        const idx = accounts.findIndex(a => a.id === accountId);
        accounts[idx] = {
            ...accounts[idx],
            tenants,
            updated_at: new Date().toISOString(),
        };
        await saveXeroAccounts(accounts);

        return { success: true, tenants };
    } catch (err) {
        console.error('Failed to fetch Xero organisations:', err.response?.data || err.message);
        throw new HttpsError('internal', `Failed to fetch organisations: ${err.message}`);
    }
});

// ═══════════════════════════════════════════════════════
//  4. XERO GET ACCOUNT CODES
// ═══════════════════════════════════════════════════════

/**
 * xeroGetAccountCodes — Fetch chart of accounts for a Xero tenant
 *
 * Accepts: { accountId, tenantId }
 * Returns: { accounts: [{ code, name, type }] }
 */
exports.xeroGetAccountCodes = onCall({ maxInstances: 5 }, async (request) => {
    const { accountId, tenantId } = request.data;

    if (!accountId || !tenantId) {
        throw new HttpsError('invalid-argument', 'accountId and tenantId are required');
    }

    const accessToken = await ensureValidToken(accountId);

    try {
        const response = await axios.get(XERO_ACCOUNTS_URL, {
            headers: {
                Authorization: `Bearer ${accessToken}`,
                'xero-tenant-id': tenantId,
                Accept: 'application/json',
            },
        });

        const accounts = (response.data?.Accounts || [])
            .filter(a => a.Status === 'ACTIVE' && a.Type === 'REVENUE')
            .map(a => ({
                code: a.Code,
                name: a.Name,
                type: a.Type,
                description: a.Description || '',
            }));

        return { success: true, accounts };
    } catch (err) {
        console.error('Failed to fetch Xero accounts:', err.response?.data || err.message);
        throw new HttpsError('internal', `Failed to fetch account codes: ${err.message}`);
    }
});

// ═══════════════════════════════════════════════════════
//  5. XERO GET TRACKING CATEGORIES
// ═══════════════════════════════════════════════════════

/**
 * xeroGetTrackingCategories — Fetch tracking categories for a Xero tenant
 *
 * Accepts: { accountId, tenantId }
 * Returns: { categories: [...] }
 */
exports.xeroGetTrackingCategories = onCall({ maxInstances: 5 }, async (request) => {
    const { accountId, tenantId } = request.data;

    if (!accountId || !tenantId) {
        throw new HttpsError('invalid-argument', 'accountId and tenantId are required');
    }

    const accessToken = await ensureValidToken(accountId);

    try {
        const response = await axios.get(XERO_TRACKING_URL, {
            headers: {
                Authorization: `Bearer ${accessToken}`,
                'xero-tenant-id': tenantId,
                Accept: 'application/json',
            },
        });

        const categories = (response.data?.TrackingCategories || []).map(tc => ({
            id: tc.TrackingCategoryID,
            name: tc.Name,
            status: tc.Status,
            options: (tc.Options || []).map(o => ({
                id: o.TrackingOptionID,
                name: o.Name,
                status: o.Status,
            })),
        }));

        return { success: true, categories };
    } catch (err) {
        console.error('Failed to fetch tracking categories:', err.response?.data || err.message);
        throw new HttpsError('internal', `Failed to fetch tracking categories: ${err.message}`);
    }
});

// ═══════════════════════════════════════════════════════
//  6. XERO SYNC INVOICE
// ═══════════════════════════════════════════════════════

/**
 * Map UK VAT rate to Xero tax type
 */
const mapVatToXeroTaxType = (vatRate, vatExempt) => {
    if (vatExempt) return 'EXEMPTOUTPUT';
    if (vatRate === 0) return 'ZERORATEDOUTPUT';
    if (vatRate === 5) return 'RROUTPUT';
    if (vatRate === 20) return 'OUTPUT2';
    return 'OUTPUT2'; // default to standard rate
};

/**
 * xeroSyncInvoice — Push a single invoice to the correct Xero organisation
 *
 * Accepts: { invoiceId }
 * Returns: { success, xeroInvoiceId, xeroInvoiceNumber }
 */
exports.xeroSyncInvoice = onCall({ maxInstances: 10 }, async (request) => {
    const { invoiceId } = request.data;

    if (!invoiceId) {
        throw new HttpsError('invalid-argument', 'invoiceId is required');
    }

    // 1. Read the invoice
    const invoiceSnap = await db.collection('invoices').doc(invoiceId).get();
    if (!invoiceSnap.exists) {
        throw new HttpsError('not-found', 'Invoice not found');
    }
    const invoice = invoiceSnap.data();

    // Check if already synced
    if (invoice.xero_invoice_id) {
        return {
            success: true,
            xeroInvoiceId: invoice.xero_invoice_id,
            xeroInvoiceNumber: invoice.xero_invoice_number || '',
            message: 'Invoice already synced to Xero',
            alreadySynced: true,
        };
    }

    // 2. Find the restaurant mapping
    const restaurantId = invoice.customer?.restaurant_id;
    if (!restaurantId) {
        throw new HttpsError('failed-precondition', 'Invoice has no restaurant_id in customer data');
    }

    const mapping = await getRestaurantMapping(restaurantId);
    if (!mapping) {
        throw new HttpsError('failed-precondition', `Restaurant ${restaurantId} is not mapped to any Xero account. Please configure the mapping in Settings → Integrations.`);
    }

    // 3. Get a valid access token
    const accessToken = await ensureValidToken(mapping.xero_account_id);

    // 4. Build the Xero invoice payload
    const xeroLineItems = (invoice.line_items || []).map(li => {
        const lineItem = {
            Description: li.description || li.item_name || 'Item',
            Quantity: li.quantity || 1,
            UnitAmount: li.unit_price || 0,
            TaxType: mapVatToXeroTaxType(li.vat_rate, li.vat_exempt),
        };

        // Account code is required by Xero — use mapping's code or default to '200' (Sales)
        lineItem.AccountCode = mapping.account_code || '200';

        return lineItem;
    });

    // Build the contact name
    const contactName = invoice.customer?.restaurant_name || invoice.customer?.name || 'Unknown Restaurant';

    // Parse the invoice date
    const invoiceDate = invoice.invoice_date?.toDate?.()
        || (invoice.invoice_date?.seconds ? new Date(invoice.invoice_date.seconds * 1000) : null)
        || new Date();

    const supplyDate = invoice.supply_date?.toDate?.()
        || (invoice.supply_date?.seconds ? new Date(invoice.supply_date.seconds * 1000) : null)
        || invoiceDate;

    const formatDate = (d) => d.toISOString().split('T')[0];

    const xeroInvoice = {
        Type: 'ACCREC', // Accounts Receivable (Sales Invoice)
        Contact: { Name: contactName },
        Date: formatDate(invoiceDate),
        DueDate: formatDate(supplyDate),
        Reference: invoice.invoice_number || '',
        Status: mapping.invoice_status || 'DRAFT',
        LineAmountTypes: 'Exclusive', // Prices are net (ex-VAT)
        LineItems: xeroLineItems,
        CurrencyCode: 'GBP',
    };

    // Apply discount if present
    if (invoice.discount_amount && invoice.discount_amount > 0) {
        xeroInvoice.LineItems.push({
            Description: `Discount (${invoice.discount_type === 'percentage' ? invoice.discount_value + '%' : '£' + invoice.discount_value})`,
            Quantity: 1,
            UnitAmount: -Math.abs(invoice.discount_amount),
            TaxType: 'NONE',
            AccountCode: mapping.account_code || '200',
        });
    }

    // 5. POST to Xero
    console.log(`Syncing invoice ${invoice.invoice_number} to Xero tenant: ${mapping.xero_org_name}`);
    console.log('Xero payload:', JSON.stringify(xeroInvoice, null, 2));
    try {
        const response = await axios.post(XERO_INVOICES_URL, {
            Invoices: [xeroInvoice],
        }, {
            headers: {
                Authorization: `Bearer ${accessToken}`,
                'xero-tenant-id': mapping.xero_tenant_id,
                'Content-Type': 'application/json',
                Accept: 'application/json',
            },
        });

        const createdInvoice = response.data?.Invoices?.[0];

        // Check if Xero returned the invoice but with validation errors
        if (createdInvoice?.HasValidationErrors) {
            const valErrors = (createdInvoice.ValidationErrors || [])
                .map(e => e.Message).join('; ');
            // Also check line item validation errors
            const lineErrors = (createdInvoice.LineItems || [])
                .flatMap(li => (li.ValidationErrors || []).map(e => e.Message))
                .join('; ');
            const allErrors = [valErrors, lineErrors].filter(Boolean).join(' | ');
            console.error('Xero validation errors:', allErrors);

            await db.collection('invoices').doc(invoiceId).update({
                xero_sync_error: allErrors || 'Xero returned validation errors',
                xero_sync_attempted_at: admin.firestore.FieldValue.serverTimestamp(),
            });

            throw new HttpsError('invalid-argument', `Xero validation: ${allErrors}`);
        }

        if (!createdInvoice) {
            throw new Error('No invoice returned from Xero');
        }

        const xeroInvoiceId = createdInvoice.InvoiceID;
        const xeroInvoiceNumber = createdInvoice.InvoiceNumber;

        console.log(`Invoice ${invoice.invoice_number} synced to Xero as ${xeroInvoiceNumber} (${xeroInvoiceId})`);

        // 6. Update our invoice doc with Xero data
        await db.collection('invoices').doc(invoiceId).update({
            xero_invoice_id: xeroInvoiceId,
            xero_invoice_number: xeroInvoiceNumber,
            xero_status: createdInvoice.Status,
            xero_tenant_id: mapping.xero_tenant_id,
            xero_org_name: mapping.xero_org_name,
            xero_synced_at: admin.firestore.FieldValue.serverTimestamp(),
            xero_sync_error: null,
        });

        return {
            success: true,
            xeroInvoiceId,
            xeroInvoiceNumber,
            message: `Invoice synced to ${mapping.xero_org_name}`,
        };
    } catch (err) {
        // If it's already an HttpsError we threw above, re-throw it
        if (err instanceof HttpsError) throw err;

        const errData = err.response?.data;

        // Extract all possible validation error messages from Xero's response
        let errMsg = '';
        if (errData?.Elements?.[0]?.ValidationErrors?.length > 0) {
            errMsg = errData.Elements[0].ValidationErrors.map(e => e.Message).join('; ');
        } else if (errData?.Message) {
            errMsg = errData.Message;
        } else if (errData?.Detail) {
            errMsg = errData.Detail;
        } else {
            errMsg = err.message;
        }

        // Also check for line-item level validation errors
        const lineItemErrors = (errData?.Elements?.[0]?.LineItems || [])
            .flatMap(li => (li.ValidationErrors || []).map(e => e.Message));
        if (lineItemErrors.length > 0) {
            errMsg += ' | Line items: ' + lineItemErrors.join('; ');
        }

        console.error('Xero invoice sync failed:', errMsg, JSON.stringify(errData, null, 2));

        // Store error on the invoice
        await db.collection('invoices').doc(invoiceId).update({
            xero_sync_error: errMsg,
            xero_sync_attempted_at: admin.firestore.FieldValue.serverTimestamp(),
        });

        throw new HttpsError('internal', `Xero sync failed: ${errMsg}`);
    }
});

// ═══════════════════════════════════════════════════════
//  7. XERO DISCONNECT ACCOUNT
// ═══════════════════════════════════════════════════════

/**
 * xeroDisconnect — Disconnect a Xero account (revoke tokens)
 *
 * Accepts: { accountId }
 */
exports.xeroDisconnect = onCall({ maxInstances: 5 }, async (request) => {
    const { accountId } = request.data;

    if (!accountId) {
        throw new HttpsError('invalid-argument', 'accountId is required');
    }

    const { account, accounts } = await getXeroAccount(accountId);

    // Try to revoke Xero connections
    if (account.access_token) {
        try {
            const connections = await axios.get(XERO_CONNECTIONS_URL, {
                headers: { Authorization: `Bearer ${account.access_token}` },
            });
            // Delete each connection
            for (const conn of (connections.data || [])) {
                try {
                    await axios.delete(`${XERO_CONNECTIONS_URL}/${conn.id}`, {
                        headers: { Authorization: `Bearer ${account.access_token}` },
                    });
                } catch (delErr) {
                    console.warn(`Could not revoke connection ${conn.id}:`, delErr.message);
                }
            }
        } catch (connErr) {
            console.warn('Could not fetch Xero connections for revocation:', connErr.message);
        }
    }

    // Clear tokens and mark as disconnected
    const idx = accounts.findIndex(a => a.id === accountId);
    accounts[idx] = {
        ...accounts[idx],
        connected: false,
        connected_at: null,
        access_token: '',
        refresh_token: '',
        token_expires_at: null,
        tenants: [],
        updated_at: new Date().toISOString(),
    };

    await saveXeroAccounts(accounts);

    return { success: true, message: `Account ${account.name} disconnected from Xero` };
});

// ═══════════════════════════════════════════════════════
//  8. EPOS WEBHOOK — Receives sales data from EPOS vendors
// ═══════════════════════════════════════════════════════

/**
 * eposWebhook — HTTP endpoint that EPOS vendors POST sales events to.
 *
 * Auth: x-api-key header or Authorization: Bearer <key>
 * Payload: {
 *   order_id: string,
 *   order_date: ISO string,
 *   line_items: [{ epos_item_id, epos_item_name, portion, quantity }],
 *   order_total: number (optional)
 * }
 *
 * Flow:
 *  1. Validate API key → resolve restaurant_id
 *  2. Idempotency check (skip duplicates by order_id)
 *  3. For each line item → lookup mapping → lookup menu recipe → deduct ingredients
 *  4. Store event for audit
 *  5. Return 200 with result summary
 */
exports.eposWebhook = onRequest({
    maxInstances: 20,
    cors: true,
}, async (req, res) => {
    // ── Only accept POST ──
    if (req.method !== 'POST') {
        res.status(405).json({ error: 'Method not allowed. Use POST.' });
        return;
    }

    // ── 1. Validate API Key ──
    const apiKey = req.headers['x-api-key']
        || (req.headers.authorization || '').replace(/^Bearer\s+/i, '')
        || req.query.api_key;

    if (!apiKey) {
        res.status(401).json({ error: 'Missing API key. Include x-api-key header or Authorization: Bearer <key>.' });
        return;
    }

    // Look up the API key in Firestore
    let restaurantId, restaurantName;
    try {
        const keySnap = await db.collection('epos_api_keys')
            .where('api_key', '==', apiKey)
            .where('is_active', '==', true)
            .limit(1)
            .get();

        if (keySnap.empty) {
            res.status(401).json({ error: 'Invalid or revoked API key.' });
            return;
        }

        const keyDoc = keySnap.docs[0].data();
        restaurantId = keyDoc.restaurant_id;
        restaurantName = keyDoc.restaurant_name || restaurantId;
    } catch (err) {
        console.error('API key lookup failed:', err);
        res.status(500).json({ error: 'Internal error during authentication.' });
        return;
    }

    // ── 2. Parse & Validate Payload ──
    const payload = req.body;
    const eposOrderId = payload.order_id || payload.orderId || payload.epos_order_id;
    const lineItems = payload.line_items || payload.lineItems || payload.items || [];

    if (!eposOrderId) {
        res.status(400).json({ error: 'Missing order_id in payload.' });
        return;
    }

    if (!Array.isArray(lineItems) || lineItems.length === 0) {
        res.status(400).json({ error: 'Missing or empty line_items array.' });
        return;
    }

    // ── 3. Idempotency Check ──
    try {
        const dupSnap = await db.collection('epos_events')
            .where('restaurant_id', '==', restaurantId)
            .where('epos_order_id', '==', String(eposOrderId))
            .limit(1)
            .get();

        if (!dupSnap.empty) {
            const existing = dupSnap.docs[0].data();
            console.log(`Duplicate EPOS event skipped: ${eposOrderId} for ${restaurantName}`);
            res.status(200).json({
                success: true,
                message: 'Duplicate event — already processed.',
                epos_order_id: eposOrderId,
                processing_status: existing.processing_status,
            });
            return;
        }
    } catch (err) {
        console.warn('Idempotency check failed, proceeding:', err.message);
    }

    // ── 4. Store the Raw Event ──
    const eventRef = db.collection('epos_events').doc();
    const normalizedItems = lineItems.map(li => ({
        epos_item_id: String(li.epos_item_id || li.item_id || li.id || ''),
        epos_item_name: li.epos_item_name || li.item_name || li.name || 'Unknown',
        portion: li.portion || li.size || null,
        quantity: Number(li.quantity || li.qty) || 1,
    }));

    const eventData = {
        restaurant_id: restaurantId,
        restaurant_name: restaurantName,
        epos_order_id: String(eposOrderId),
        epos_event_type: payload.event_type || 'order_completed',
        order_date: payload.order_date || payload.orderDate || new Date().toISOString(),
        order_total: Number(payload.order_total || payload.orderTotal) || 0,
        line_items: normalizedItems,
        raw_payload: payload,
        processing_status: 'pending',
        processing_result: null,
        error_message: null,
        received_at: admin.firestore.FieldValue.serverTimestamp(),
        processed_at: null,
    };

    await eventRef.set(eventData);

    // ── 5. Process Each Line Item ──
    const results = [];
    const errors = [];
    let hasUnmapped = false;

    for (const item of normalizedItems) {
        try {
            // 5a. Look up the EPOS → Menu Item mapping
            const mappingSnap = await db.collection('epos_item_mappings')
                .where('restaurant_id', '==', restaurantId)
                .where('epos_item_id', '==', item.epos_item_id)
                .where('is_active', '==', true)
                .limit(1)
                .get();

            if (mappingSnap.empty) {
                // No mapping — store the item for admin to map later
                hasUnmapped = true;
                results.push({
                    epos_item_id: item.epos_item_id,
                    epos_item_name: item.epos_item_name,
                    status: 'unmapped',
                    message: 'No mapping found. Item stored for admin mapping.',
                });

                // Upsert into epos_unmapped_items for the mapping UI
                const unmappedRef = db.collection('epos_unmapped_items').doc(`${restaurantId}_${item.epos_item_id}`);
                await unmappedRef.set({
                    restaurant_id: restaurantId,
                    epos_item_id: item.epos_item_id,
                    epos_item_name: item.epos_item_name,
                    portion: item.portion,
                    last_seen_at: admin.firestore.FieldValue.serverTimestamp(),
                    occurrence_count: admin.firestore.FieldValue.increment(1),
                }, { merge: true });

                continue;
            }

            const mapping = mappingSnap.docs[0].data();

            // 5b. Look up the menu item and its recipe
            const menuSnap = await db.collection('menu_items').doc(mapping.mapped_menu_item_id).get();
            if (!menuSnap.exists) {
                // Menu item was deleted — deactivate the broken mapping
                console.warn(`Mapped menu item ${mapping.mapped_menu_item_id} deleted. Deactivating mapping for EPOS item ${item.epos_item_id}`);
                await mappingSnap.docs[0].ref.update({
                    is_active: false,
                    broken_reason: 'menu_item_deleted',
                    broken_at: admin.firestore.FieldValue.serverTimestamp(),
                });

                // Re-add to unmapped items so admin can remap
                hasUnmapped = true;
                const unmappedRef = db.collection('epos_unmapped_items').doc(`${restaurantId}_${item.epos_item_id}`);
                await unmappedRef.set({
                    restaurant_id: restaurantId,
                    epos_item_id: item.epos_item_id,
                    epos_item_name: item.epos_item_name,
                    portion: item.portion,
                    last_seen_at: admin.firestore.FieldValue.serverTimestamp(),
                    occurrence_count: admin.firestore.FieldValue.increment(1),
                    remap_reason: `Previously mapped to "${mapping.mapped_menu_item_name || mapping.mapped_menu_item_id}" which was deleted`,
                }, { merge: true });

                results.push({
                    epos_item_id: item.epos_item_id,
                    epos_item_name: item.epos_item_name,
                    status: 'mapping_broken',
                    message: `Mapped menu item "${mapping.mapped_menu_item_name || mapping.mapped_menu_item_id}" was deleted. Item moved to unmapped for remapping.`,
                });
                continue;
            }

            const menuItem = menuSnap.data();

            // 5c. Find the correct portion's recipe
            let targetPortion = null;
            if (mapping.mapped_portion_id) {
                targetPortion = (menuItem.portions || []).find(p => p.id === mapping.mapped_portion_id);
            }
            // Fallback: match by portion name from EPOS data
            if (!targetPortion && item.portion) {
                targetPortion = (menuItem.portions || []).find(p =>
                    p.name.toLowerCase() === item.portion.toLowerCase()
                );
            }
            // Fallback: use first portion
            if (!targetPortion && menuItem.portions?.length > 0) {
                targetPortion = menuItem.portions[0];
            }

            if (!targetPortion || (!targetPortion.recipe?.length && !targetPortion.sub_items?.length)) {
                results.push({
                    epos_item_id: item.epos_item_id,
                    epos_item_name: item.epos_item_name,
                    status: 'no_recipe',
                    message: `Menu item "${menuItem.name}" has no recipe defined for the portion.`,
                });
                continue;
            }

            // 5d. Recursively resolve all ingredients (recipe[] + sub_items[]) into
            // a flat deduplicated map keyed by item_id. This prevents double-deduction
            // when the same inventory item appears in both direct recipe and a sub-item recipe.
            //
            // ingredientMap: { [item_id]: { item_id, item_name, master_unit, totalQty } }
            const ingredientMap = {};

            /**
             * Recursively collects all inventory ingredient quantities from a portion.
             * @param {Object} portion - the portion object { recipe[], sub_items[] }
             * @param {number} multiplier - qty multiplier (e.g., 2 for 2× parent portions)
             */
            const collectIngredients = async (portion, multiplier) => {
                // Direct recipe ingredients
                for (const ing of (portion.recipe || [])) {
                    const reqQty = (Number(ing.quantity) || 0)
                        * (Number(ing.conversion_to_master) || 1)
                        * multiplier;
                    if (reqQty <= 0) continue;
                    if (!ingredientMap[ing.item_id]) {
                        ingredientMap[ing.item_id] = {
                            item_id: ing.item_id,
                            item_name: ing.item_name,
                            master_unit: ing.master_unit || ing.unit || '',
                            totalQty: 0,
                        };
                    }
                    ingredientMap[ing.item_id].totalQty += reqQty;
                }
                // Sub-menu-item components (combos / platters)
                for (const sub of (portion.sub_items || [])) {
                    try {
                        const subMenuSnap = await db.collection('menu_items')
                            .doc(sub.menu_item_id).get();
                        if (!subMenuSnap.exists) continue;
                        const subMenuData = subMenuSnap.data();
                        // Find the correct sub-portion
                        let subPortion = sub.portion_id
                            ? (subMenuData.portions || []).find(p => p.id === sub.portion_id)
                            : null;
                        if (!subPortion) subPortion = (subMenuData.portions || [])[0];
                        if (!subPortion) continue;
                        // Recurse: multiply by sub.quantity (e.g., 2 Cokes per combo)
                        await collectIngredients(subPortion, multiplier * (Number(sub.quantity) || 1));
                    } catch (subErr) {
                        console.warn(`Failed to resolve sub_item ${sub.menu_item_id}:`, subErr.message);
                    }
                }
            };

            // Collect all ingredients for (item.quantity) sold
            await collectIngredients(targetPortion, item.quantity);

            // Track deductions for this item
            const deductions = [];

            // Deduct each unique ingredient exactly once
            for (const ingEntry of Object.values(ingredientMap)) {
                const { item_id, item_name, master_unit, totalQty } = ingEntry;
                const requiredQty = Math.round(totalQty * 1000) / 1000;
                if (requiredQty <= 0) continue;

                // Find the ingredient in restaurant_inventory
                const invSnap = await db.collection('restaurant_inventory')
                    .where('restaurant_id', '==', restaurantId)
                    .where('item_id', '==', item_id)
                    .limit(1)
                    .get();

                if (invSnap.empty) {
                    deductions.push({
                        item_id, item_name, required: requiredQty,
                        unit: master_unit, status: 'not_in_inventory',
                    });
                    continue;
                }

                const invDoc = invSnap.docs[0];
                const invData = invDoc.data();
                const currentStock = invData.current_stock || 0;
                const newStock = Math.max(0, currentStock - requiredQty);

                await invDoc.ref.update({
                    current_stock: newStock,
                    last_updated: admin.firestore.FieldValue.serverTimestamp(),
                });

                deductions.push({
                    item_id, item_name,
                    required: requiredQty,
                    previous_stock: currentStock,
                    new_stock: newStock,
                    unit: master_unit,
                    cost_price: invData.cost_price || 0,
                    selling_price: invData.selling_price || 0,
                    category_name: invData.category_name || '',
                    item_type: invData.item_type || '',
                    status: newStock <= 0 ? 'depleted' : 'deducted',
                });

                // Check low-stock threshold
                const threshold = invData.low_stock_threshold || 5;
                if (newStock <= threshold && currentStock > threshold) {
                    try {
                        const adminSnap = await db.collection('users')
                            .where('role', '==', 'admin').get();
                        for (const adminDoc of adminSnap.docs) {
                            await db.collection('notifications').add({
                                user_id: adminDoc.id,
                                type: 'low_stock', priority: 'high',
                                title: `Low Stock: ${item_name}`,
                                message: `${item_name} at ${restaurantName} dropped to ${newStock.toFixed(1)} ${master_unit}. Triggered by EPOS sale.`,
                                is_read: false,
                                metadata: { restaurant_id: restaurantId, item_id, current_stock: newStock, threshold },
                                created_at: admin.firestore.FieldValue.serverTimestamp(),
                            });
                        }
                    } catch (notifErr) {
                        console.warn('Failed to create low-stock notification:', notifErr.message);
                    }
                }
            }

            results.push({
                epos_item_id: item.epos_item_id,
                epos_item_name: item.epos_item_name,
                menu_item: menuItem.name,
                menu_item_id: mapping.mapped_menu_item_id,
                menu_item_category: menuItem.category || '',
                menu_item_model: menuItem.model_type || '',
                portion: targetPortion.name,
                portion_selling_price: targetPortion.selling_price || 0,
                portion_cost_price: targetPortion.cost_price || 0,
                quantity_sold: item.quantity,
                deductions,
                status: 'processed',
            });

        } catch (itemErr) {
            console.error(`Error processing EPOS item ${item.epos_item_id}:`, itemErr);
            errors.push({
                epos_item_id: item.epos_item_id,
                epos_item_name: item.epos_item_name,
                error: itemErr.message,
            });
        }
    }

    // ── 6. Update Event Status ──
    const finalStatus = errors.length > 0 ? 'partial_failure'
        : hasUnmapped ? 'has_unmapped'
        : 'processed';

    await eventRef.update({
        processing_status: finalStatus,
        processing_result: { results, errors },
        error_message: errors.length > 0 ? `${errors.length} item(s) failed` : null,
        processed_at: admin.firestore.FieldValue.serverTimestamp(),
    });

    console.log(`EPOS webhook processed for ${restaurantName}: ${results.length} items, ${errors.length} errors`);

    // ── 7. Respond ──
    res.status(200).json({
        success: true,
        epos_order_id: eposOrderId,
        restaurant: restaurantName,
        processing_status: finalStatus,
        items_processed: results.filter(r => r.status === 'processed').length,
        items_unmapped: results.filter(r => r.status === 'unmapped').length,
        items_failed: errors.length,
        results,
        errors: errors.length > 0 ? errors : undefined,
    });
});

// ═══════════════════════════════════════════════════════
//  9. EPOS — Reprocess Unmapped Items After New Mapping
// ═══════════════════════════════════════════════════════
/**
 * Called after an admin creates a new EPOS item mapping.
 * Finds all past events that had this item as "unmapped",
 * processes them (deducts stock), and updates the event records.
 *
 * This ensures that orders received BEFORE a mapping was created
 * are retroactively processed and appear on the dashboard.
 *
 * IMPORTANT: Only processes items that are still 'unmapped' in the
 * event result. Already-processed items from previous mappings are
 * NOT modified — this preserves historical accuracy.
 */
exports.reprocessAfterMapping = onCall({ maxInstances: 5 }, async (request) => {
    const { restaurant_id, epos_item_id } = request.data;

    if (!restaurant_id || !epos_item_id) {
        throw new HttpsError('invalid-argument', 'restaurant_id and epos_item_id are required');
    }

    // 1. Get the current active mapping for this item
    const mappingSnap = await db.collection('epos_item_mappings')
        .where('restaurant_id', '==', restaurant_id)
        .where('epos_item_id', '==', epos_item_id)
        .where('is_active', '==', true)
        .limit(1).get();

    if (mappingSnap.empty) {
        throw new HttpsError('not-found', 'No active mapping found for this item');
    }

    const mapping = mappingSnap.docs[0].data();

    // 2. Get the menu item and its recipe
    const menuSnap = await db.collection('menu_items').doc(mapping.mapped_menu_item_id).get();
    if (!menuSnap.exists) {
        throw new HttpsError('not-found', `Menu item ${mapping.mapped_menu_item_id} not found`);
    }

    const menuItem = menuSnap.data();

    // Find the correct portion
    let targetPortion = null;
    if (mapping.mapped_portion_id) {
        targetPortion = (menuItem.portions || []).find(p => p.id === mapping.mapped_portion_id);
    }
    if (!targetPortion && menuItem.portions?.length > 0) {
        targetPortion = menuItem.portions[0];
    }

    if (!targetPortion || (!targetPortion.recipe?.length && !targetPortion.sub_items?.length)) {
        return { success: true, events_updated: 0, message: 'Menu item has no recipe. No stock deductions made.' };
    }

    // 3. Find all events for this restaurant that have unmapped results
    const eventsSnap = await db.collection('epos_events')
        .where('restaurant_id', '==', restaurant_id)
        .where('processing_status', 'in', ['has_unmapped', 'pending'])
        .get();

    let eventsUpdated = 0;
    let totalDeductions = 0;

    for (const eventDoc of eventsSnap.docs) {
        const event = eventDoc.data();
        const results = event.processing_result?.results || [];
        const errors = event.processing_result?.errors || [];
        let modified = false;

        const updatedResults = [];
        for (const r of results) {
            if (r.status === 'unmapped' && r.epos_item_id === epos_item_id) {
                const lineItem = (event.line_items || []).find(li => li.epos_item_id === epos_item_id);
                const qty = lineItem?.quantity || 1;

                // Recursively collect deduplicated ingredients (same as webhook handler)
                const reprocessIngMap = {};
                const reprocessCollect = async (portion, mult) => {
                    for (const ing of (portion.recipe || [])) {
                        const reqQty = (Number(ing.quantity) || 0)
                            * (Number(ing.conversion_to_master) || 1) * mult;
                        if (reqQty <= 0) continue;
                        if (!reprocessIngMap[ing.item_id]) {
                            reprocessIngMap[ing.item_id] = {
                                item_id: ing.item_id, item_name: ing.item_name,
                                master_unit: ing.master_unit || ing.unit || '', totalQty: 0,
                            };
                        }
                        reprocessIngMap[ing.item_id].totalQty += reqQty;
                    }
                    for (const sub of (portion.sub_items || [])) {
                        try {
                            const subSnap = await db.collection('menu_items').doc(sub.menu_item_id).get();
                            if (!subSnap.exists) continue;
                            const subData = subSnap.data();
                            let subPortion = sub.portion_id
                                ? (subData.portions || []).find(p => p.id === sub.portion_id)
                                : null;
                            if (!subPortion) subPortion = (subData.portions || [])[0];
                            if (subPortion) await reprocessCollect(subPortion, mult * (Number(sub.quantity) || 1));
                        } catch (e) { console.warn('sub_item resolve error:', e.message); }
                    }
                };
                await reprocessCollect(targetPortion, qty);

                const deductions = [];
                for (const ingEntry of Object.values(reprocessIngMap)) {
                    const { item_id, item_name, master_unit, totalQty } = ingEntry;
                    const requiredQty = Math.round(totalQty * 1000) / 1000;
                    if (requiredQty <= 0) continue;

                    const invSnap = await db.collection('restaurant_inventory')
                        .where('restaurant_id', '==', restaurant_id)
                        .where('item_id', '==', item_id).limit(1).get();

                    if (invSnap.empty) {
                        deductions.push({ item_id, item_name, required: requiredQty, unit: master_unit, status: 'not_in_inventory' });
                        continue;
                    }

                    const invDoc = invSnap.docs[0];
                    const invData = invDoc.data();
                    const currentStock = invData.current_stock || 0;
                    const newStock = Math.max(0, currentStock - requiredQty);
                    await invDoc.ref.update({
                        current_stock: newStock,
                        last_updated: admin.firestore.FieldValue.serverTimestamp(),
                    });

                    deductions.push({
                        item_id, item_name, required: requiredQty,
                        previous_stock: currentStock, new_stock: newStock,
                        unit: master_unit,
                        cost_price: invData.cost_price || 0,
                        selling_price: invData.selling_price || 0,
                        category_name: invData.category_name || '',
                        item_type: invData.item_type || '',
                        status: newStock <= 0 ? 'depleted' : 'deducted',
                    });
                    totalDeductions++;
                }

                updatedResults.push({
                    epos_item_id: r.epos_item_id,
                    epos_item_name: r.epos_item_name,
                    menu_item: menuItem.name,
                    menu_item_id: mapping.mapped_menu_item_id,
                    menu_item_category: menuItem.category || '',
                    menu_item_model: menuItem.model_type || '',
                    portion: targetPortion.name,
                    portion_selling_price: targetPortion.selling_price || 0,
                    portion_cost_price: targetPortion.cost_price || 0,
                    quantity_sold: qty,
                    deductions,
                    status: 'processed',
                    reprocessed_at: new Date().toISOString(),
                });
                modified = true;
            } else {
                updatedResults.push(r);
            }
        }

        if (modified) {
            const hasRemaining = updatedResults.some(r => r.status === 'unmapped');
            const hasErrors = errors.length > 0;
            const newStatus = hasErrors ? 'partial_failure'
                : hasRemaining ? 'has_unmapped'
                : 'processed';

            await eventDoc.ref.update({
                processing_status: newStatus,
                processing_result: { results: updatedResults, errors },
                processed_at: admin.firestore.FieldValue.serverTimestamp(),
            });
            eventsUpdated++;
        }
    }

    console.log(`Reprocessed ${eventsUpdated} events for epos_item_id=${epos_item_id} at restaurant ${restaurant_id}`);

    return {
        success: true,
        events_updated: eventsUpdated,
        total_deductions: totalDeductions,
        message: eventsUpdated > 0
            ? `${eventsUpdated} past order(s) updated. Stock deducted for ${totalDeductions} ingredient(s).`
            : 'No unmapped events found for this item.',
    };
});

// ═══════════════════════════════════════════════════════
//  10. EPOS — Reprocess a Single Failed Event
// ═══════════════════════════════════════════════════════

exports.eposReprocessEvent = onCall({ maxInstances: 5 }, async (request) => {
    const { eventId } = request.data;
    if (!eventId) throw new HttpsError('invalid-argument', 'eventId is required');

    const eventSnap = await db.collection('epos_events').doc(eventId).get();
    if (!eventSnap.exists) throw new HttpsError('not-found', 'EPOS event not found');

    // Reset status so it can be re-evaluated
    await eventSnap.ref.update({
        processing_status: 'pending',
        processing_result: null,
        error_message: null,
        processed_at: null,
    });

    return { success: true, message: 'Event reset to pending.' };
});

