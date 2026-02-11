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
  product: string;
  unit: UnitType;
  qty: number;
  valueDhs?: number; // Optional value for IN transactions
}

export interface InventoryItem {
  product: string;
  lot: string;
  unit: UnitType;
  availableQty: number;
  client?: string;
  totalValueDhs?: number; // Added to store calculated remaining value
}

export interface DateRange {
  from: string;
  to: string;
}