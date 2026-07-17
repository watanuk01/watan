const https = require('https');

const API_KEY = 'AIzaSyC9jzSpsomTnfU5nJXx3hynQ94-wc924fE';
const PROJECT_ID = 'watan-e8290';
const EMAIL = 'admin@watan.com';
const PASSWORD = 'Watan@123';

const AUTH_URL = `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${API_KEY}`;
const FIRESTORE_URL = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/invoices?pageSize=1000`;

function postJson(url, bodyObj, headers = {}) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const bodyStr = JSON.stringify(bodyObj);
    
    const options = {
      method: 'POST',
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(bodyStr),
        ...headers
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          resolve({ statusCode: res.statusCode, body: JSON.parse(data) });
        } catch (e) {
          reject(new Error(`Failed to parse response: ${e.message}`));
        }
      });
    });

    req.on('error', (err) => reject(err));
    req.write(bodyStr);
    req.end();
  });
}

function getJson(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    
    const options = {
      method: 'GET',
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      headers: {
        'Accept': 'application/json',
        ...headers
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          resolve({ statusCode: res.statusCode, body: JSON.parse(data) });
        } catch (e) {
          reject(new Error(`Failed to parse response: ${e.message}`));
        }
      });
    });

    req.on('error', (err) => reject(err));
    req.end();
  });
}

async function run() {
  try {
    console.log(`Signing in as ${EMAIL}...`);
    const authResult = await postJson(AUTH_URL, {
      email: EMAIL,
      password: PASSWORD,
      returnSecureToken: true
    });

    if (authResult.statusCode !== 200) {
      console.error("Auth failed:", authResult.body);
      return;
    }

    const idToken = authResult.body.idToken;
    console.log("Successfully authenticated. Fetching invoices...");

    const firestoreResult = await getJson(FIRESTORE_URL, {
      'Authorization': `Bearer ${idToken}`
    });

    if (firestoreResult.statusCode !== 200) {
      console.error("Firestore fetch failed:", firestoreResult.body);
      return;
    }

    const documents = firestoreResult.body.documents || [];
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

  } catch (err) {
    console.error("Execution error:", err);
  }
}

run();
