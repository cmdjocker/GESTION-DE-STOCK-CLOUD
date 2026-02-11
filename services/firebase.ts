import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";

// Live Firebase configuration for gestion-stock-app-d640f
const firebaseConfig = {
  apiKey: "AIzaSyDfzr9oglf3nj_evID_bXSbRIw5stTnbU8",
  authDomain: "gestion-stock-app-d640f.firebaseapp.com",
  projectId: "gestion-stock-app-d640f",
  storageBucket: "gestion-stock-app-d640f.firebasestorage.app",
  messagingSenderId: "665749210645",
  appId: "1:665749210645:web:7770f6f743f4f2fb05f01c"
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);