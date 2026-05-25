import { readFileSync } from 'fs';

// Since we cannot run Firebase without config easily, let's just grep the local files
// to see if "items" was being rewritten or if "deliveryService" has a pickup function.
