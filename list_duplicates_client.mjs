import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs } from 'firebase/firestore';

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
  console.log("Analyzing invoices for duplicates using client SDK...");
  try {
    const snap = await getDocs(collection(db, 'invoices'));
    console.log(`Total invoices found: ${snap.docs.length}`);

    const invoiceNumbers = {};
    const orderIds = {};

    snap.docs.forEach(doc => {
      const data = doc.data();
      const num = data.invoice_number;
      const orderId = data.order_id;
      const customerName = data.customer?.restaurant_name || data.customer?.name || 'Unknown';

      if (num) {
        if (!invoiceNumbers[num]) invoiceNumbers[num] = [];
        invoiceNumbers[num].push({ id: doc.id, order_id: orderId, customer: customerName, createdAt: data.created_at?.toDate?.() || data.created_at });
      }

      if (orderId) {
        if (!orderIds[orderId]) orderIds[orderId] = [];
        orderIds[orderId].push({ id: doc.id, num: num, customer: customerName, createdAt: data.created_at?.toDate?.() || data.created_at });
      }
    });

    console.log("\n--- Duplicate Invoice Numbers ---");
    let duplicateNumCount = 0;
    for (const [num, list] of Object.entries(invoiceNumbers)) {
      if (list.length > 1) {
        duplicateNumCount++;
        console.log(`Invoice Number: ${num} (${list.length} docs)`);
        list.forEach(item => {
          console.log(`  - Doc ID: ${item.id}, Order ID: ${item.order_id}, Customer: ${item.customer}, Created: ${item.createdAt}`);
        });
      }
    }
    if (duplicateNumCount === 0) console.log("No duplicate invoice numbers found.");

    console.log("\n--- Duplicate Invoices for the same Order ID ---");
    let duplicateOrderCount = 0;
    for (const [orderId, list] of Object.entries(orderIds)) {
      if (list.length > 1) {
        duplicateOrderCount++;
        console.log(`Order ID: ${orderId} (${list.length} docs)`);
        list.forEach(item => {
          console.log(`  - Doc ID: ${item.id}, Invoice #: ${item.num}, Customer: ${item.customer}, Created: ${item.createdAt}`);
        });
      }
    }
    if (duplicateOrderCount === 0) console.log("No duplicate invoices for the same Order ID found.");

  } catch (err) {
    console.error("Error analyzing:", err);
  }
}

run();
