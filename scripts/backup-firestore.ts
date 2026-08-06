import { initializeApp } from "firebase/app";
import { getFirestore, collection, getDocs } from "firebase/firestore";
import { getAuth, signInAnonymously } from "firebase/auth";
import * as fs from 'fs';
import * as path from 'path';
import firebaseConfig from '../firebase-applet-config.json';

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

async function exportData() {
  console.log("Starting Firestore data backup...");
  
  try {
    const userCred = await signInAnonymously(auth);
    console.log("Authenticated anonymously as:", userCred.user.uid);
  } catch (err: any) {
    console.warn("Anonymous auth failed, attempting unauthenticated fetch...", err.message || err);
  }

  const collectionsToBackup = ["transactions", "products", "entreprises", "clients"];
  const backupData: Record<string, any[]> = {};

  for (const colName of collectionsToBackup) {
    try {
      const snap = await getDocs(collection(db, colName));
      const items = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      backupData[colName] = items;
      console.log(`Exported ${items.length} items from '${colName}'`);
    } catch (err: any) {
      console.error(`Error backing up collection ${colName}:`, err.message || err);
      backupData[colName] = [];
    }
  }

  const backupDir = path.join(process.cwd(), '_backups');
  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupFilePath = path.join(backupDir, `firestore_backup_${timestamp}.json`);
  const latestBackupPath = path.join(backupDir, `firestore_backup_latest.json`);

  fs.writeFileSync(backupFilePath, JSON.stringify(backupData, null, 2), 'utf-8');
  fs.writeFileSync(latestBackupPath, JSON.stringify(backupData, null, 2), 'utf-8');

  console.log(`Backup completed! Saved to: ${latestBackupPath}`);
  process.exit(0);
}

exportData();
