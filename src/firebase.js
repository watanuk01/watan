import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';
import { getAnalytics } from 'firebase/analytics';
import { getMessaging, isSupported } from 'firebase/messaging';

const firebaseConfig = {
  apiKey: "AIzaSyC9jzSpsomTnfU5nJXx3hynQ94-wc924fE",
  authDomain: "watan-e8290.firebaseapp.com",
  projectId: "watan-e8290",
  storageBucket: "watan-e8290.firebasestorage.app",
  messagingSenderId: "759777665562",
  appId: "1:759777665562:web:c4a7827bd5223002bae7a3",
  measurementId: "G-WBEW7Y28C9"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);
export const analytics = typeof window !== 'undefined' ? getAnalytics(app) : null;

// FCM messaging — only initialise in browser environments that support it
let messagingInstance = null;
export const getFirebaseMessaging = async () => {
  if (messagingInstance) return messagingInstance;
  try {
    const supported = await isSupported();
    if (supported) {
      messagingInstance = getMessaging(app);
    }
  } catch (e) {
    console.log('FCM not supported in this environment:', e.message);
  }
  return messagingInstance;
};

export default app;

