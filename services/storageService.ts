import { 
  collection, 
  onSnapshot, 
  addDoc, 
  updateDoc, 
  deleteDoc, 
  doc, 
  getDocs, 
  setDoc,
  query,
  orderBy
} from "firebase/firestore";
import { db } from "./firebase";
import { Transaction } from "../types";
import { 
  INITIAL_PRODUCTS, 
  INITIAL_ENTREPRISES, 
  INITIAL_CLIENTS 
} from "../constants";

// --- Transactions ---
export const subscribeTransactions = (callback: (txs: Transaction[]) => void) => {
  const q = query(collection(db, "transactions"), orderBy("date", "desc"));
  return onSnapshot(q, (snapshot) => {
    const txs = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Transaction));
    callback(txs);
  });
};

export const saveTransaction = async (tx: Omit<Transaction, "id">, id?: string) => {
  if (id) {
    const docRef = doc(db, "transactions", id);
    await updateDoc(docRef, { ...tx });
  } else {
    await addDoc(collection(db, "transactions"), tx);
  }
};

export const deleteTransaction = async (id: string) => {
  await deleteDoc(doc(db, "transactions", id));
};

// --- Generic Lists with Auto-Seeding ---
const handleListSubscription = (collectionName: string, initialData: string[], callback: (list: string[]) => void) => {
  return onSnapshot(collection(db, collectionName), async (snapshot) => {
    if (snapshot.empty) {
      // Seed initial data if collection is empty
      for (const item of initialData) {
        await setDoc(doc(db, collectionName, item.replace(/\//g, '_')), { name: item });
      }
      return;
    }
    const list = snapshot.docs.map(d => d.data().name as string).sort();
    callback(list);
  });
};

export const subscribeProducts = (callback: (list: string[]) => void) => 
  handleListSubscription("products", INITIAL_PRODUCTS, callback);

export const subscribeEntreprises = (callback: (list: string[]) => void) => 
  handleListSubscription("entreprises", INITIAL_ENTREPRISES, callback);

export const subscribeClients = (callback: (list: string[]) => void) => 
  handleListSubscription("clients", INITIAL_CLIENTS, callback);

export const addToList = async (collectionName: string, name: string) => {
  const safeId = name.replace(/\//g, '_').trim().toUpperCase();
  await setDoc(doc(db, collectionName, safeId), { name: name.trim().toUpperCase() });
};
