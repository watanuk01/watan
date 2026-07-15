const admin = require('firebase-admin');

// Initialize Firebase Admin (assuming default credentials or local emulator)
// We'll use the service account if needed, but functions/index.js might have one.
// Let's just require the db from their code or init it.
const serviceAccount = require('./firebase.json'); // Might not be service account.
// Let's just use the functions/index.js db if possible.

// We can just create a simple script that imports the firebase-admin and initializes it using GOOGLE_APPLICATION_CREDENTIALS, which is usually set in this environment.
admin.initializeApp({
  projectId: 'watan-e8290' // check .firebaserc for actual project id
});

const db = admin.firestore();

async function checkRecentEvents() {
    const snap = await db.collection('epos_events')
        .orderBy('received_at', 'desc')
        .limit(5)
        .get();
        
    snap.forEach(doc => {
        const data = doc.data();
        console.log(`Event ID: ${doc.id}`);
        console.log(`Restaurant: ${data.restaurant_name}`);
        console.log(`order_date: ${data.order_date}`);
        console.log(`received_at: ${data.received_at?.toDate()?.toISOString()}`);
        console.log('---');
    });
}

checkRecentEvents().catch(console.error);
