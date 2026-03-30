/**
 * Seed Script — Create test users for all roles via Firebase Auth REST API
 * 
 * Usage: node scripts/seedUsers.js
 * 
 * This script creates users in Firebase Auth and corresponding
 * Firestore documents using the REST APIs (no Admin SDK needed).
 */

const API_KEY = 'AIzaSyC9jzSpsomTnfU5nJXx3hynQ94-wc924fE';
const PROJECT_ID = 'watan-e8290';

const AUTH_URL = `https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${API_KEY}`;
const FIRESTORE_URL = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;

const TEST_USERS = [
    {
        email: 'admin@watan.com',
        password: 'Watan@123',
        name: 'Admin User',
        role: 'admin',
        phone: '+44 7000 000001',
    },
    {
        email: 'chef@watan.com',
        password: 'Watan@123',
        name: 'Head Chef',
        role: 'ck_staff',
        phone: '+44 7000 000002',
    },
    {
        email: 'manager@watan.com',
        password: 'Watan@123',
        name: 'Southall Manager',
        role: 'restaurant_manager',
        phone: '+44 7000 000003',
        restaurant_id: 'watan_southall',
        restaurant_name: 'Watan Southall',
    },
    {
        email: 'manager2@watan.com',
        password: 'Watan@123',
        name: 'Hounslow Manager',
        role: 'restaurant_manager_non_managed',
        phone: '+44 7000 000004',
        restaurant_id: 'watan_hounslow',
        restaurant_name: 'Watan Hounslow',
    },
    {
        email: 'driver@watan.com',
        password: 'Watan@123',
        name: 'Delivery Driver',
        role: 'delivery_partner',
        phone: '+44 7000 000005',
    },
];

async function createAuthUser(email, password) {
    const res = await fetch(AUTH_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            email,
            password,
            returnSecureToken: true,
        }),
    });

    const data = await res.json();
    if (data.error) {
        if (data.error.message === 'EMAIL_EXISTS') {
            console.log(`  ⚠ User ${email} already exists, skipping auth creation`);
            // Sign in to get the UID
            const signInUrl = `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${API_KEY}`;
            const signInRes = await fetch(signInUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, password, returnSecureToken: true }),
            });
            const signInData = await signInRes.json();
            if (signInData.error) {
                console.error(`  ✗ Could not sign in as ${email}:`, signInData.error.message);
                return null;
            }
            return { localId: signInData.localId, idToken: signInData.idToken };
        }
        console.error(`  ✗ Error creating ${email}:`, data.error.message);
        return null;
    }

    return { localId: data.localId, idToken: data.idToken };
}

function toFirestoreValue(val) {
    if (val === null || val === undefined) return { nullValue: null };
    if (typeof val === 'string') return { stringValue: val };
    if (typeof val === 'number') return { integerValue: String(val) };
    if (typeof val === 'boolean') return { booleanValue: val };
    if (val instanceof Date) return { timestampValue: val.toISOString() };
    return { stringValue: String(val) };
}

async function createFirestoreDoc(uid, userData, idToken) {
    const now = new Date().toISOString();
    const fields = {
        name: toFirestoreValue(userData.name),
        email: toFirestoreValue(userData.email),
        role: toFirestoreValue(userData.role),
        phone: toFirestoreValue(userData.phone || ''),
        status: toFirestoreValue('active'),
        created_at: { timestampValue: now },
        updated_at: { timestampValue: now },
    };

    if (userData.restaurant_id) {
        fields.restaurant_id = toFirestoreValue(userData.restaurant_id);
        fields.restaurant_name = toFirestoreValue(userData.restaurant_name);
    }

    const url = `${FIRESTORE_URL}/users/${uid}`;

    const res = await fetch(url, {
        method: 'PATCH',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${idToken}`,
        },
        body: JSON.stringify({ fields }),
    });

    const data = await res.json();
    if (data.error) {
        console.error(`  ✗ Firestore error for ${userData.email}:`, data.error.message);
        return false;
    }
    return true;
}

async function main() {
    console.log('🌱 Seeding Watan test users...\n');

    for (const user of TEST_USERS) {
        console.log(`Creating ${user.role}: ${user.email}`);

        const authResult = await createAuthUser(user.email, user.password);
        if (!authResult) {
            console.log('  ⏭ Skipping Firestore document\n');
            continue;
        }

        const success = await createFirestoreDoc(authResult.localId, user, authResult.idToken);
        if (success) {
            console.log(`  ✓ Created successfully (uid: ${authResult.localId})\n`);
        } else {
            console.log(`  ✗ Firestore document creation failed\n`);
        }
    }

    console.log('✅ Seed complete!\n');
    console.log('Test accounts (all password: Watan@123):');
    console.log('  admin@watan.com     — Super Admin');
    console.log('  chef@watan.com      — Kitchen Staff');
    console.log('  manager@watan.com   — Restaurant Manager (Managed)');
    console.log('  manager2@watan.com  — Restaurant Manager (Non-Managed)');
    console.log('  driver@watan.com    — Delivery Partner');
}

main().catch(console.error);
