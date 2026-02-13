export enum TransactionType {
  IN = 'IN',
  OUT = 'OUT'
}

export enum UnitType {
  KG = 'KG',
  NOMBRE = 'Nombre'
}

export interface Transaction {
  id: string;
  type: TransactionType;
  date: string; // YYYY-MM-DD
  entreprise?: string; 
  client?: string;
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