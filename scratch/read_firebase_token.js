import { readFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

async function run() {
  try {
    const configPath = join(homedir(), '.config', 'configstore', 'firebase-tools.json');
    const configData = JSON.parse(readFileSync(configPath, 'utf8'));
    const token = configData.tokens?.refresh_token || configData.user?.refreshToken;
    if (!token) {
      console.error("No refresh token found in firebase-tools.json");
      return;
    }
    console.log("Found token! Authenticating to Google OAuth to get access token...");
    
    // Exchange refresh token for an access token
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: '792013146130-433q4444bh150059s79.apps.googleusercontent.com', // Firebase CLI client_id
        grant_type: 'refresh_token',
        refresh_token: token,
      }),
    });
    
    const tokenJson = await tokenResponse.json();
    const accessToken = tokenJson.access_token;
    if (!accessToken) {
      // If client_id is different, let's try with default CLI client credentials or just using the token as is
      console.error("Failed to get access token:", tokenJson);
      return;
    }
    
    console.log("Access token retrieved! Querying Firestore REST API...");
    // Let's get the latest 5 epos_events
    const firestoreUrl = `https://firestore.googleapis.com/v1/projects/watan-e8290/databases/(default)/documents:runQuery`;
    
    const queryPayload = {
      structuredQuery: {
        from: [{ collectionId: 'epos_events' }],
        orderBy: [{
          field: { fieldPath: 'received_at' },
          direction: 'DESCENDING'
        }],
        limit: 15
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
      console.error("Firestore error:", results.error);
      return;
    }
    
    console.log(`Successfully fetched ${results.length} events:`);
    results.forEach((r, idx) => {
      const doc = r.document;
      if (!doc) return;
      const fields = doc.fields || {};
      const name = doc.name;
      const id = name.split('/').pop();
      console.log(`\n--- Event ${idx} (ID: ${id}) ---`);
      console.log(`restaurant_id:`, fields.restaurant_id?.stringValue);
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
