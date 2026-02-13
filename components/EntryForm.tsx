import React, { useState, useEffect, useRef } from 'react';
import { Transaction, TransactionType, UnitType } from '../types';
import { 
  subscribeProducts, 
  subscribeEntreprises, 
  subscribeClients,
  addToList
} from '../services/storageService';

interface EntryFormProps {
  type: TransactionType;
  initialData?: Transaction;
  onSubmit: (transaction: Omit<Transaction, 'id'>) => void;
  onCancel: () => void;
  onDelete?: () => void;
}

const EntryForm: React.FC<EntryFormProps> = ({ type, initialData, onSubmit, onCancel, onDelete }) => {
  const [products, setProducts] = useState<string[]>([]);
  const [entreprisesList, setEntreprisesList] = useState<string[]>([]);
  const [clientsList, setClientsList] = useState<string[]>([]);
  
  const dateInputRef = useRef<HTMLInputElement>(null);
  const [date, setDate] = useState(initialData?.date || new Date().toISOString().split('T')[0]);
  const [expiryDate, setExpiryDate] = useState(initialData?.expiryDate || '');
  const [entreprise, setEntreprise] = useState(initialData?.entreprise || '');
  const [client, setClient] = useState(initialData?.client || '');
  const [lot, setLot] = useState(initialData?.lot || '');
  const [ngp, setNgp] = useState(initialData?.ngp || '');
  const [product, setProduct] = useState(initialData?.product || '');
  const [unit, setUnit] = useState<UnitType>(initialData?.unit || UnitType.KG);
  const [qty, setQty] = useState<number | ''>(initialData?.qty || '');
  const [valueDhs, setValueDhs] = useState<number | ''>(initialData?.valueDhs || '');
  const [securityCode, setSecurityCode] = useState('');

  const [isNewProduct, setIsNewProduct] = useState(false);
  const [newProductName, setNewProductName] = useState('');
  const [isNewEntreprise, setIsNewEntreprise] = useState(false);
  const [newEntrepriseName, setNewEntrepriseName] = useState('');
  const [isNewClient, setIsNewClient] = useState(false);
  const [newClientName, setNewClientName] = useState('');

  useEffect(() => {
    const unsubProd = subscribeProducts(setProducts);
    const unsubEnt = subscribeEntreprises(setEntreprisesList);
    const unsubCli = subscribeClients(setClientsList);
    
    // Auto focus date field on mount
    if (dateInputRef.current) {
      dateInputRef.current.focus();
    }
    
    return () => { unsubProd(); unsubEnt(); unsubCli(); };
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (securityCode !== '2026') {
      alert('Code de sécurité incorrect. Accès refusé.');
      return;
    }

    const finalProduct = isNewProduct ? newProductName.trim().toUpperCase() : product;
    const finalEntreprise = isNewEntreprise ? newEntrepriseName.trim().toUpperCase() : entreprise;
    const finalClient = isNewClient ? newClientName.trim().toUpperCase() : client;

    if (!finalProduct) {
      alert('Veuillez sélectionner ou ajouter un PRODUIT.');
      return;
    }
    if (qty === '' || Number(qty) <= 0) {
      alert('Veuillez saisir une QUANTITÉ valide.');
      return;
    }
    if (!lot.trim()) {
      alert('Le champ DUM Réf est obligatoire.');
      return;
    }

    if (isNewProduct) await addToList("products", finalProduct);
    if (isNewEntreprise) await addToList("entreprises", finalEntreprise);
    if (isNewClient) await addToList("clients", finalClient);

    const payload: any = {
      type,
      date,
      lot: lot.trim().toUpperCase(),
      ngp: ngp.trim(),
      product: finalProduct,
      unit,
      qty: Number(qty),
    };

    if (type === TransactionType.IN && expiryDate) {
      payload.expiryDate = expiryDate;
    }
    
    if (finalEntreprise) {
      payload.entreprise = finalEntreprise;
    }
    
    if (finalClient) {
      payload.client = finalClient;
    }
    
    if (type === TransactionType.IN && valueDhs !== '') {
      payload.valueDhs = Number(valueDhs);
    }

    onSubmit(payload as Omit<Transaction, 'id'>);
  };

  const inputClass = "w-full border border-gray-300 dark:border-gray-600 rounded-md p-2 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 outline-none focus:ring-2 focus:ring-blue-500 transition-all";

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div className="flex gap-3">
        <div className="flex-1">
          <label className="block text-xs font-semibold mb-1 text-gray-700 dark:text-gray-300">Date d'opération</label>
          <input ref={dateInputRef} type="date" required value={date} onChange={(e) => setDate(e.target.value)} className={inputClass} />
        </div>
        {type === TransactionType.IN && (
          <div className="flex-1">
            <label className="block text-xs font-semibold mb-1 text-gray-700 dark:text-gray-300">Echéance max</label>
            <input type="date" value={expiryDate} onChange={(e) => setExpiryDate(e.target.value)} className={inputClass} />
          </div>
        )}
      </div>

      <div className="flex gap-3">
        <div className="flex-1">
          <label className="block text-xs font-semibold mb-1 text-gray-700 dark:text-gray-300">Entreprise</label>
          {isNewEntreprise ? (
            <div className="relative">
              <input type="text" value={newEntrepriseName} onChange={(e) => setNewEntrepriseName(e.target.value)} className={inputClass} autoFocus placeholder="Nom entreprise..." />
              <button type="button" onClick={() => setIsNewEntreprise(false)} className="absolute right-2 top-2 text-[10px] text-red-500">Annuler</button>
            </div>
          ) : (
            <select value={entreprise} onChange={(e) => e.target.value === 'NEW' ? setIsNewEntreprise(true) : setEntreprise(e.target.value)} className={inputClass}>
              <option value="">-- Aucune --</option>
              {entreprisesList.map(ent => <option key={ent} value={ent}>{ent}</option>)}
              <option value="NEW" className="font-bold text-blue-600 text-xs">+ Ajouter entreprise</option>
            </select>
          )}
        </div>
        <div className="flex-1">
          <label className="block text-xs font-semibold mb-1 text-gray-700 dark:text-gray-300">Client</label>
          {isNewClient ? (
            <div className="relative">
              <input type="text" value={newClientName} onChange={(e) => setNewClientName(e.target.value)} className={inputClass} autoFocus placeholder="Nom client..." />
              <button type="button" onClick={() => setIsNewClient(false)} className="absolute right-2 top-2 text-[10px] text-red-500">Annuler</button>
            </div>
          ) : (
            <select value={client} onChange={(e) => e.target.value === 'NEW' ? setIsNewClient(true) : setClient(e.target.value)} className={inputClass}>
              <option value="">-- Aucun --</option>
              {clientsList.map(cli => <option key={cli} value={cli}>{cli}</option>)}
              <option value="NEW" className="font-bold text-blue-600 text-xs">+ Ajouter client</option>
            </select>
          )}
        </div>
      </div>

      <div className="flex gap-3">
        <div className="flex-1">
          <label className="block text-xs font-semibold mb-1 text-gray-700 dark:text-gray-300">{type === TransactionType.OUT ? 'DUM ENTRÉE Réf' : 'DUM Réf'}</label>
          <input type="text" required value={lot} onChange={(e) => setLot(e.target.value)} className={`${inputClass} uppercase`} placeholder="Ex: 12345/2024" />
        </div>
        <div className="flex-1">
          <label className="block text-xs font-semibold mb-1 text-gray-700 dark:text-gray-300">NGP</label>
          <input type="text" value={ngp} onChange={(e) => setNgp(e.target.value)} className={inputClass} placeholder="Ex: 0303441000" />
        </div>
      </div>

      <div>
        <label className="block text-xs font-semibold mb-1 text-gray-700 dark:text-gray-300">Produit</label>
        {isNewProduct ? (
          <div className="relative">
            <input type="text" required value={newProductName} onChange={(e) => setNewProductName(e.target.value)} className={inputClass} autoFocus placeholder="Nom du produit..." />
            <button type="button" onClick={() => setIsNewProduct(false)} className="absolute right-2 top-2 text-[10px] text-red-500">Annuler</button>
          </div>
        ) : (
          <select value={product} onChange={(e) => e.target.value === 'NEW' ? setIsNewProduct(true) : setProduct(e.target.value)} className={inputClass} required>
            <option value="">-- Sélectionner un produit --</option>
            {products.map(p => <option key={p} value={p}>{p}</option>)}
            <option value="NEW" className="font-bold text-blue-600 text-xs">+ Ajouter un nouveau produit</option>
          </select>
        )}
      </div>

      <div className="flex gap-3">
        <div className="flex-1">
          <label className="block text-xs font-semibold mb-1 text-gray-700 dark:text-gray-300">Unité</label>
          <select value={unit} onChange={(e) => setUnit(e.target.value as UnitType)} className={inputClass}>
            <option value={UnitType.KG}>KG</option>
            <option value={UnitType.NOMBRE}>Nombre</option>
          </select>
        </div>
        <div className="flex-1">
          <label className="block text-xs font-semibold mb-1 text-gray-700 dark:text-gray-300">Quantité</label>
          <input type="number" required min="0.01" step="0.01" value={qty} onChange={(e) => setQty(e.target.value === '' ? '' : Number(e.target.value))} className={inputClass} placeholder="0,00" />
        </div>
      </div>

      {type === TransactionType.IN && (
        <div>
          <label className="block text-xs font-semibold mb-1 text-gray-700 dark:text-gray-300">Valeur totale (Dhs) <span className="text-[10px] font-normal text-gray-400">(Facultatif)</span></label>
          <input type="number" step="0.01" value={valueDhs} onChange={(e) => setValueDhs(e.target.value === '' ? '' : Number(e.target.value))} className={inputClass} placeholder="0,00 Dhs" />
        </div>
      )}

      <div className="bg-blue-50 dark:bg-blue-900/20 p-2 rounded-lg border border-blue-200 dark:border-blue-800">
        <label className="block text-[10px] font-bold mb-1 text-blue-800 dark:text-blue-300 flex items-center gap-1">
          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" /></svg>
          SÉCURITÉ (Code: 2026)
        </label>
        <input 
          type="password" 
          required 
          value={securityCode} 
          onChange={(e) => setSecurityCode(e.target.value)} 
          className="w-full border border-blue-200 dark:border-blue-700 rounded p-1 bg-white dark:bg-gray-700 text-xs outline-none focus:ring-1 focus:ring-blue-500" 
          placeholder="Code" 
        />
      </div>

      <div className="pt-4 flex justify-between items-center border-t border-gray-100 dark:border-gray-700">
        {onDelete && (
          <button type="button" onClick={onDelete} className="text-red-500 hover:text-red-700 text-xs font-bold flex items-center gap-1">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-4v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
            Supprimer
          </button>
        )}
        <div className="flex gap-2 ml-auto">
          <button type="button" onClick={onCancel} className="px-4 py-1.5 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 rounded text-xs font-medium">Annuler</button>
          <button type="submit" className="px-6 py-1.5 bg-blue-600 text-white rounded text-xs font-bold hover:bg-blue-700 shadow shadow-blue-500/20 active:scale-95">Valider</button>
        </div>
      </div>
    </form>
  );
};

export default EntryForm;