const https = require('https');

const url = "https://firestore.googleapis.com/v1/projects/watan-e8290/databases/(default)/documents/invoices?pageSize=1000&key=AIzaSyC9jzSpsomTnfU5nJXx3hynQ94-wc924fE";

console.log("Fetching invoices via REST API...");

https.get(url, (res) => {
  let data = '';

  res.on('data', (chunk) => {
    data += chunk;
  });

  res.on('end', () => {
    try {
      const responseObj = JSON.parse(data);
      if (responseObj.error) {
        console.error("API Error:", responseObj.error);
        return;
      }

      const documents = responseObj.documents || [];
      console.log(`Successfully fetched ${documents.length} invoices.`);

      const invoiceNumbers = {};
      const orderIds = {};

      documents.forEach(doc => {
        const fields = doc.fields || {};
        const pathParts = doc.name.split('/');
        const id = pathParts[pathParts.length - 1];
        
        const num = fields.invoice_number?.stringValue;
        const orderId = fields.order_id?.stringValue;
        const customerName = fields.customer?.mapValue?.fields?.restaurant_name?.stringValue || 
                             fields.customer?.mapValue?.fields?.name?.stringValue || 
                             'Unknown';
        const createdAt = fields.created_at?.timestampValue;

        if (num) {
          if (!invoiceNumbers[num]) invoiceNumbers[num] = [];
          invoiceNumbers[num].push({ id, order_id: orderId, customer: customerName, createdAt });
        }

        if (orderId) {
          if (!orderIds[orderId]) orderIds[orderId] = [];
          orderIds[orderId].push({ id, num, customer: customerName, createdAt });
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

    } catch (e) {
      console.error("Failed to parse JSON response:", e.message);
      console.log("Raw response (truncated):", data.substring(0, 1000));
    }
  });
}).on('error', (err) => {
  console.error("HTTPS request failed:", err.message);
});
