const { initializeApp } = require('firebase/app');
const { getFirestore, collection, getDocs, orderBy, limit, query } = require('firebase/firestore');

const firebaseConfig = {
    apiKey: "AIzaSyDa-...", // I'll read from firebase.js
};
