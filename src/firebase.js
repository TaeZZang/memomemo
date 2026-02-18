import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
    apiKey: "AIzaSyDTaYsaUOVqBA6H2ExgtIOUXnWTC6tX2PM",
    authDomain: "totolist-d21ef.firebaseapp.com",
    projectId: "totolist-d21ef",
    storageBucket: "totolist-d21ef.firebasestorage.app",
    messagingSenderId: "5810393971",
    appId: "1:5810393971:web:613844d06f9600faf7eb06"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Initialize services
export const auth = getAuth(app);
export const provider = new GoogleAuthProvider();

// Modern Firestore initialization with persistent cache and multi-tab support
import {
    initializeFirestore,
    persistentLocalCache,
    persistentMultipleTabManager
} from "firebase/firestore";

export const db = initializeFirestore(app, {
    localCache: persistentLocalCache({
        tabManager: persistentMultipleTabManager()
    })
});
