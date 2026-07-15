export enum TransactionType {
  IN = 'IN',
  OUT = 'OUT'
}

export enum UnitType {
  KG = 'KG',
  NOMBRE = 'Nombre',
  LOG = 'LOG',
  SESSION = 'SESSION'
}

export interface Transaction {
  id: string;
  type: TransactionType;
  date: string; // YYYY-MM-DD
  entreprise?: string; 
  client?: string;
  originalClient?: string;
  originalEntreprise?: string;
  lot?: string;
  ngp?: string; // New NGP field
  product: string;
  unit: UnitType;
  qty: number;
  valueDhs?: number; // Optional value for IN transactions
  expiryDate?: string; // Optional expiration date (Echéance max)
}

export interface InventoryItem {
  product: string;
  lot: string;
  ngp?: string;
  unit: UnitType;
  availableQty: number;
  entreprise?: string;
  client?: string;
  totalValueDhs?: number;
  year?: string; // Added for Year grouping
}

export interface DateRange {
  from: string;
  to: string;
}

export interface AuditLog {
  id?: string;
  timestamp: string; // ISO string
  userEmail: string;
  action: string; // "AJOUT" | "MODIFICATION" | "SUPPRESSION" | "AJOUT_PRODUIT" etc.
  details: string;
}