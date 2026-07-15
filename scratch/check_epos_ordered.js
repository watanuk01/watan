const fs = require('fs');
const path = require('path');
const os = require('os');

async function run() {
  try {
    const configPath = path.join(os.homedir(), '.config', 'configstore', 'firebase-tools.json');
    const configData = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    const accessToken = configData.tokens?.access_token;
    if (!accessToken) {
      console.error("No access token found");
      return;
    }
    
    console.log("Checking ordered query on epos_events...");
    const firestoreUrl = `https://firestore.googleapis.com/v1/projects/watan-e8290/databases/(default)/documents:runQuery`;
    
    const queryPayload = {
      structuredQuery: {
        from: [{ collectionId: 'epos_events' }],
        orderBy: [{
          field: { fieldPath: 'received_at' },
          direction: 'DESCENDING'
        }],
        limit: 10
      }
    };
    
    const res = await fetch(firestoreUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(queryPayload)
    });
    
    const results = await res.json();
    if (results.error) {
      console.error("Query failed:", results.error);
      return;
    }
    
    console.log(`SUCCESS! Found ${results.length} ordered events:`);
    results.forEach((r, idx) => {
      const doc = r.document;
      if (!doc) return;
      const fields = doc.fields || {};
      const name = doc.name;
      const id = name.split('/').pop();
      console.log(`\n--- Event ${idx} (ID: ${id}) ---`);
      console.log(`restaurant_name:`, fields.restaurant_name?.stringValue);
      console.log(`processing_status:`, fields.processing_status?.stringValue);
      console.log(`order_date:`, fields.order_date?.stringValue);
      console.log(`received_at:`, fields.received_at?.timestampValue);
    });
    
  } catch (err) {
    console.error("Error:", err);
  }
}

run();
