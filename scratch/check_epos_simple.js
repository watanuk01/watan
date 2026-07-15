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
    
    console.log("Checking epos_events readability...");
    const url = `https://firestore.googleapis.com/v1/projects/watan-e8290/databases/(default)/documents/epos_events?pageSize=5`;
    const res = await fetch(url, {
      headers: { 'Authorization': `Bearer ${accessToken}` }
    });
    
    const data = await res.json();
    if (data.error) {
      console.log("Status:", data.error.code, data.error.message);
    } else {
      console.log("SUCCESS! epos_events is readable.");
      const docs = data.documents || [];
      console.log(`Found ${docs.length} documents.`);
      docs.forEach((doc, idx) => {
        const fields = doc.fields || {};
        console.log(`\nDoc ${idx}:`);
        console.log(`restaurant_name:`, fields.restaurant_name?.stringValue);
        console.log(`processing_status:`, fields.processing_status?.stringValue);
        console.log(`order_date:`, fields.order_date?.stringValue);
        console.log(`received_at:`, fields.received_at?.timestampValue);
      });
    }
  } catch (err) {
    console.error(err);
  }
}

run();
