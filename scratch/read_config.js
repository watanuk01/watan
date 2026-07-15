const fs = require('fs');
const path = require('path');
const os = require('os');

const configPath = path.join(os.homedir(), '.config', 'configstore', 'firebase-tools.json');
try {
  const configData = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  console.log("Keys in firebase-tools.json:", Object.keys(configData));
  if (configData.user) {
    console.log("Keys in configData.user:", Object.keys(configData.user));
  }
  if (configData.tokens) {
    console.log("Keys in configData.tokens:", Object.keys(configData.tokens));
  }
  // Let's print the token type or format
  const keys = Object.keys(configData.tokens || {});
  console.log("Tokens keys:", keys);
} catch (err) {
  console.error("Error reading config:", err);
}
