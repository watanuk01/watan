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
    
    console.log("Checking composite query...");
    const firestoreUrl = `https://firestore.googleapis.com/v1/projects/watan-e8290/databases/(default)/documents:runQuery`;
    
    const queryPayload = {
      structuredQuery: {
        from: [{ collectionId: 'epos_events' }],
        where: {
          fieldFilter: {
            field: { fieldPath: 'restaurant_id' },
            op: 'EQUAL',
            value: { stringValue: 'manager_uid' } // replace with a dummy or real restaurant_id
          }
        },
        orderBy: [{
          field: { fieldPath: 'received_at' },
          direction: 'DESCENDING'
        }],
        limit: 5
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
    console.log("COMPOSITE QUERY RESULTS:", JSON.stringify(results, null, 2));
    
  } catch (err) {
    console.error("Error:", err);
  }
}

run();
