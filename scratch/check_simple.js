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
    
    console.log("Checking if Firestore is readable...");
    const url = `https://firestore.googleapis.com/v1/projects/watan-e8290/databases/(default)/documents/users?pageSize=1`;
    const res = await fetch(url, {
      headers: { 'Authorization': `Bearer ${accessToken}` }
    });
    
    const data = await res.json();
    if (data.error) {
      console.log("Status:", data.error.code, data.error.message);
    } else {
      console.log("SUCCESS! Firestore is now active and readable.");
      console.log("First user:", data.documents?.[0]?.name);
    }
  } catch (err) {
    console.error(err);
  }
}

run();
