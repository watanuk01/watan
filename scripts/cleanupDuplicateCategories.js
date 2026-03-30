/**
 * Cleanup script — removes duplicate inventory categories from Firestore.
 * Run with: node scripts/cleanupDuplicateCategories.js
 */

const { initializeApp } = require('firebase/app');
const {
    getFirestore,
    collection,
    getDocs,
    deleteDoc,
    doc,
    query,
    orderBy,
} = require('firebase/firestore');

const firebaseConfig = {
    apiKey: "AIzaSyC9jzSpsomTnfU5nJXx3hynQ94-wc924fE",
    authDomain: "watan-e8290.firebaseapp.com",
    projectId: "watan-e8290",
    storageBucket: "watan-e8290.firebasestorage.app",
    messagingSenderId: "759777665562",
    appId: "1:759777665562:web:c4a7827bd5223002bae7a3",
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

async function cleanup() {
    console.log('Fetching categories...');
    const q = query(collection(db, 'inventory_categories'), orderBy('sort_order', 'asc'));
    const snap = await getDocs(q);
    const categories = snap.docs.map(d => ({ id: d.id, ...d.data() }));

    console.log(`Found ${categories.length} categories:`);
    categories.forEach(c => console.log(`  - ${c.name} (${c.type}) [${c.id}]`));

    // Find duplicates by name
    const seen = new Map();
    const toDelete = [];

    for (const cat of categories) {
        if (seen.has(cat.name)) {
            toDelete.push(cat);
        } else {
            seen.set(cat.name, cat);
        }
    }

    if (toDelete.length === 0) {
        console.log('\n✅ No duplicates found.');
        process.exit(0);
    }

    console.log(`\n⚠ Found ${toDelete.length} duplicate(s) to delete:`);
    toDelete.forEach(c => console.log(`  - ${c.name} [${c.id}]`));

    for (const cat of toDelete) {
        await deleteDoc(doc(db, 'inventory_categories', cat.id));
        console.log(`  ✓ Deleted ${cat.name} [${cat.id}]`);
    }

    console.log('\n✅ Cleanup complete.');
    process.exit(0);
}

cleanup().catch(err => {
    console.error('Cleanup failed:', err);
    process.exit(1);
});
