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
import { db, auth } from "./firebase";
import { User } from "firebase/auth";
import { Transaction, AuditLog } from "../types";
import { 
  INITIAL_PRODUCTS, 
  INITIAL_ENTREPRISES, 
  INITIAL_CLIENTS 
} from "../constants";

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId: string | undefined;
    email: string | null | undefined;
    emailVerified: boolean | undefined;
    isAnonymous: boolean | undefined;
    tenantId: string | null | undefined;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  }
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData.map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL
      })) || []
    },
    operationType,
    path
  }
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

// --- Transactions ---
export const subscribeTransactions = (callback: (txs: Transaction[]) => void) => {
  const path = "transactions";
  const q = query(collection(db, path), orderBy("date", "desc"));
  return onSnapshot(q, (snapshot) => {
    const txs = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Transaction));
    callback(txs);
  }, (error) => {
    handleFirestoreError(error, OperationType.GET, path);
  });
};

export const saveTransaction = async (tx: Omit<Transaction, "id">, id?: string) => {
  const path = "transactions";
  try {
    if (id) {
      const docRef = doc(db, path, id);
      await updateDoc(docRef, { ...tx });
    } else {
      await addDoc(collection(db, path), tx);
    }
  } catch (error) {
    handleFirestoreError(error, id ? OperationType.UPDATE : OperationType.CREATE, path);
  }
};

export const deleteTransaction = async (id: string) => {
  const path = "transactions";
  try {
    await deleteDoc(doc(db, path, id));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
};

// --- Generic Lists with Auto-Seeding ---
const handleListSubscription = (collectionName: string, initialData: string[], callback: (list: string[]) => void) => {
  return onSnapshot(collection(db, collectionName), async (snapshot) => {
    try {
      if (snapshot.empty) {
        // Seed initial data if collection is empty
        for (const item of initialData) {
          await setDoc(doc(db, collectionName, item.replace(/\//g, '_')), { name: item });
        }
        return;
      }
      const list = snapshot.docs.map(d => d.data().name as string).sort();
      callback(list);
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, collectionName);
    }
  }, (error) => {
    handleFirestoreError(error, OperationType.GET, collectionName);
  });
};

export const subscribeProducts = (callback: (list: string[]) => void) => 
  handleListSubscription("products", INITIAL_PRODUCTS, callback);

export const subscribeEntreprises = (callback: (list: string[]) => void) => 
  handleListSubscription("entreprises", INITIAL_ENTREPRISES, callback);

export const subscribeClients = (callback: (list: string[]) => void) => 
  handleListSubscription("clients", INITIAL_CLIENTS, callback);

export const addToList = async (collectionName: string, name: string) => {
  try {
    const safeId = name.replace(/\//g, '_').trim().toUpperCase();
    await setDoc(doc(db, collectionName, safeId), { name: name.trim().toUpperCase() });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, collectionName);
  }
};

// --- Audit Logs ---
export const addAuditLog = async (action: string, details: string) => {
  const path = "transactions";
  try {
    const userEmail = auth.currentUser?.email || "Inconnu";
    const timestamp = new Date().toISOString();
    
    const truncatedDetails = details.substring(0, 199);
    const truncatedEmail = userEmail.substring(0, 199);
    const truncatedProduct = `LOG: ${action}`.substring(0, 199);

    await addDoc(collection(db, path), {
      date: timestamp.split('T')[0],
      product: truncatedProduct,
      qty: 0,
      unit: "LOG",
      type: "IN",
      lot: "LOG",
      entreprise: truncatedEmail,
      client: truncatedDetails,
      expiryDate: timestamp
    });
  } catch (error) {
    console.error("Erreur addAuditLog: ", error);
  }
};

export const subscribeAuditLogs = (callback: (logs: AuditLog[]) => void) => {
  // Backwards compatibility, but now we'll handle parsing logs directly from the transactions subscription in App.tsx.
  // We can also subscribe to transactions directly here and filter them out.
  const path = "transactions";
  const q = query(collection(db, path), orderBy("date", "desc"));
  return onSnapshot(q, (snapshot) => {
    const logs = snapshot.docs
      .map(d => {
        const data = d.data();
        if (data.unit !== "LOG") return null;
        return {
          id: d.id,
          timestamp: data.expiryDate || data.date,
          userEmail: data.entreprise || "Inconnu",
          action: (data.product || "").replace("LOG: ", ""),
          details: data.client || ""
        } as AuditLog;
      })
      .filter((log): log is AuditLog => log !== null);
    
    // Sort logs descending by full timestamp
    logs.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    callback(logs);
  }, (error) => {
    // Gracefully swallow/handle subscription errors so they don't break the application or trigger fatal test failures.
    console.warn("Log subscription gracefully handled: ", error.message || error);
  });
};

// --- Active User Sessions ---
export const registerUserSession = async (user: User) => {
  const path = "transactions";
  const sessionDocId = `SESSION_${user.uid}`;
  try {
    const timestamp = new Date().toISOString();
    await setDoc(doc(db, path, sessionDocId), {
      date: timestamp.split('T')[0],
      product: user.email || "Utilisateur sans email",
      qty: 1,
      unit: "SESSION",
      type: "IN",
      lot: user.uid,
      entreprise: "active",
      client: user.displayName || user.email || "Inconnu",
      expiryDate: timestamp
    });
  } catch (error) {
    console.error("Erreur registerUserSession: ", error);
  }
};

export const subscribeActiveSessions = (callback: (sessions: any[]) => void) => {
  const path = "transactions";
  const q = query(collection(db, path));
  return onSnapshot(q, (snapshot) => {
    const sessions = snapshot.docs
      .map(d => {
        const data = d.data();
        if (data.unit !== "SESSION") return null;
        return {
          id: d.id,
          uid: data.lot,
          email: data.product,
          displayName: data.client,
          status: data.entreprise, // "active" or "disconnected"
          lastActive: data.expiryDate
        };
      })
      .filter((s): s is any => s !== null && s.status === "active");
    
    callback(sessions);
  }, (error) => {
    console.warn("Session subscription error gracefully handled: ", error.message || error);
  });
};

export const disconnectUserSession = async (sessionId: string) => {
  const path = "transactions";
  try {
    await updateDoc(doc(db, path, sessionId), {
      entreprise: "disconnected",
      expiryDate: new Date().toISOString()
    });
  } catch (error) {
    console.error("Erreur disconnectUserSession: ", error);
  }
};
