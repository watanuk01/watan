import { initializeApp } from 'firebase/app';
import { getFirestore, collection, query, getDocs, limit, orderBy } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: "AIzaSyC9jzSpsomTnfU5nJXx3hynQ94-wc924fE",
  authDomain: "watan-e8290.firebaseapp.com",
  projectId: "watan-e8290",
  storageBucket: "watan-e8290.firebasestorage.app",
  messagingSenderId: "759777665562",
  appId: "1:759777665562:web:c4a7827bd5223002bae7a3",
  measurementId: "G-WBEW7Y28C9"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

async function run() {
  console.log("Fetching latest 10 epos_events...");
  try {
    const q = query(
      collection(db, 'epos_events'),
      orderBy('received_at', 'desc'),
      limit(15)
    );
    const snap = await getDocs(q);
    console.log(`Found ${snap.size} events:`);
    snap.docs.forEach((doc, idx) => {
      const data = doc.data();
      console.log(`\n--- Event ${idx} (ID: ${doc.id}) ---`);
      console.log(`restaurant_id: ${data.restaurant_id}`);
      console.log(`processing_status: ${data.processing_status}`);
      console.log(`order_date (raw): ${data.order_date}`);
      console.log(`received_at (timestamp): ${data.received_at?.toDate?.() || data.received_at}`);
      console.log(`received_at ISO: ${data.received_at?.toDate?.() ? data.received_at.toDate().toISOString() : 'N/A'}`);
      console.log(`items count: ${data.payload?.items?.length || 0}`);
    });
  } catch (err) {
    console.error("Error fetching:", err);
  }
}

run();
