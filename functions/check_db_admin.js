const admin = require('firebase-admin');
admin.initializeApp({
  projectId: 'watan-e8290'
});
const db = admin.firestore();

async function run() {
  console.log("Fetching latest 25 epos_events...");
  try {
    const q = db.collection('epos_events')
      .orderBy('received_at', 'desc')
      .limit(25);
    const snap = await q.get();
    console.log(`Found ${snap.size} events:`);
    snap.docs.forEach((doc, idx) => {
      const data = doc.data();
      console.log(`\n--- Event ${idx} (ID: ${doc.id}) ---`);
      console.log(`restaurant_id: ${data.restaurant_id}`);
      console.log(`restaurant_name: ${data.restaurant_name}`);
      console.log(`processing_status: ${data.processing_status}`);
      console.log(`order_date (raw): ${data.order_date}`);
      console.log(`received_at (timestamp): ${data.received_at?.toDate?.() || data.received_at}`);
      console.log(`received_at ISO: ${data.received_at?.toDate?.() ? data.received_at.toDate().toISOString() : 'N/A'}`);
      console.log(`items count: ${data.line_items?.length || 0}`);
    });
  } catch (err) {
    console.error("Error fetching:", err);
  }
}

run();
