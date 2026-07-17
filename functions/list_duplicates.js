const admin = require('firebase-admin');
if (admin.apps.length === 0) {
  admin.initializeApp({
    projectId: 'watan-e8290'
  });
}
const db = admin.firestore();

async function run() {
  console.log("Analyzing invoices for duplicates...");
  try {
    const snap = await db.collection('invoices').get();
    console.log(`Total invoices found: ${snap.size}`);

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
