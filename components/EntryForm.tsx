import React, { useState, useEffect, useRef } from 'react';
import { Transaction, TransactionType, UnitType } from '../types';
import { 
  subscribeProducts, 
  subscribeEntreprises, 
  subscribeClients,
  addToList,
  addAuditLog
} from '../services/storageService';

interface EntryFormProps {
  type: TransactionType;
  initialData?: Transaction;
  onSubmit: (transaction: Omit<Transaction, 'id'> | Omit<Transaction, 'id'>[]) => void;
  onCancel: () => void;
  onDelete?: () => void;
  isMasterAdmin?: boolean;
}

interface ProductItemRow {
  id: string;
  product: string;
  isNewProduct: boolean;
  newProductName: string;
  unit: UnitType;
  qty: number | '';
  valueDhs: number | '';
}

const EntryForm: React.FC<EntryFormProps> = ({ type, initialData, onSubmit, onCancel, onDelete, isMasterAdmin = false }) => {
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
  const [securityCode, setSecurityCode] = useState('');

  const [isNewEntreprise, setIsNewEntreprise] = useState(false);
  const [newEntrepriseName, setNewEntrepriseName] = useState('');
  const [isNewClient, setIsNewClient] = useState(false);
  const [newClientName, setNewClientName] = useState('');

  const [productItems, setProductItems] = useState<ProductItemRow[]>(() => {
    if (initialData) {
      return [{
        id: '1',
        product: initialData.product || '',
        isNewProduct: false,
        newProductName: '',
        unit: initialData.unit || UnitType.KG,
        qty: initialData.qty || '',
        valueDhs: initialData.valueDhs || ''
      }];
    }
    return [{
      id: Date.now().toString(),
      product: '',
      isNewProduct: false,
      newProductName: '',
      unit: UnitType.KG,
      qty: '',
      valueDhs: ''
    }];
  });

  useEffect(() => {
    const unsubProd = subscribeProducts(setProducts);
    const unsubEnt = subscribeEntreprises(setEntreprisesList);
    const unsubCli = subscribeClients(setClientsList);
    
    if (dateInputRef.current) {
      dateInputRef.current.focus();
    }
    
    return () => { unsubProd(); unsubEnt(); unsubCli(); };
  }, []);

  const handleAddProductItem = () => {
    setProductItems(prev => [
      ...prev,
      {
        id: Date.now().toString() + Math.random().toString(36).substring(2, 5),
        product: '',
        isNewProduct: false,
        newProductName: '',
        unit: UnitType.KG,
        qty: '',
        valueDhs: ''
      }
    ]);
  };

  const handleRemoveProductItem = (id: string) => {
    if (productItems.length <= 1) return;
    setProductItems(prev => prev.filter(item => item.id !== id));
  };

  const handleUpdateProductItem = (id: string, updates: Partial<ProductItemRow>) => {
    setProductItems(prev => prev.map(item => item.id === id ? { ...item, ...updates } : item));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (securityCode !== '2026') {
      alert('Code de sécurité incorrect. Accès refusé.');
      return;
    }

    if (!lot.trim()) {
      alert('Le champ DUM Réf est obligatoire.');
      return;
    }

    if (productItems.length === 0) {
      alert('Veuillez ajouter au moins un produit.');
      return;
    }

    // Validate items
    for (let i = 0; i < productItems.length; i++) {
      const item = productItems[i];
      const finalProd = item.isNewProduct ? item.newProductName.trim().toUpperCase() : item.product;
      if (!finalProd) {
        alert(`Veuillez sélectionner ou saisir un produit pour la ligne #${i + 1}.`);
        return;
      }
      if (item.qty === '' || Number(item.qty) <= 0) {
        alert(`Veuillez saisir une quantité valide pour la ligne #${i + 1} (${finalProd}).`);
        return;
      }
    }

    const finalEntreprise = isNewEntreprise ? newEntrepriseName.trim().toUpperCase() : entreprise;
    const finalClient = isNewClient ? newClientName.trim().toUpperCase() : client;

    if (isNewEntreprise && finalEntreprise) {
      await addToList("entreprises", finalEntreprise);
      await addAuditLog("CREATION_ENTREPRISE", `Nouvelle entreprise ajoutée: ${finalEntreprise}`);
    }
    if (isNewClient && finalClient) {
      await addToList("clients", finalClient);
      await addAuditLog("CREATION_CLIENT", `Nouveau client ajouté: ${finalClient}`);
    }

    // Process new products and build payloads
    const payloads: Omit<Transaction, 'id'>[] = [];
    const addedNewProds = new Set<string>();

    for (const item of productItems) {
      const finalProduct = item.isNewProduct ? item.newProductName.trim().toUpperCase() : item.product;
      if (item.isNewProduct && finalProduct && !addedNewProds.has(finalProduct)) {
        addedNewProds.add(finalProduct);
        await addToList("products", finalProduct);
        await addAuditLog("CREATION_PRODUIT", `Nouveau produit ajouté: ${finalProduct}`);
      }

      const payload: any = {
        type,
        date,
        lot: lot.trim().toUpperCase(),
        ngp: ngp.trim(),
        product: finalProduct,
        unit: item.unit,
        qty: Number(item.qty),
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
      
      if (type === TransactionType.IN && item.valueDhs !== '') {
        payload.valueDhs = Number(item.valueDhs);
      }

      payloads.push(payload as Omit<Transaction, 'id'>);
    }

    onSubmit(payloads.length === 1 ? payloads[0] : payloads);
  };

  const inputClass = "w-full border border-gray-300 dark:border-gray-600 rounded-md p-2 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 outline-none focus:ring-2 focus:ring-blue-500 transition-all text-xs";

  return (
    <form onSubmit={handleSubmit} className="space-y-4 text-left">
      {/* HEADER INFO (DUM & Document metadata) */}
      <div className="bg-gray-50 dark:bg-gray-800/60 p-3 rounded-lg border border-gray-200 dark:border-gray-700 space-y-3">
        <div className="text-[11px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider flex items-center gap-1.5 border-b pb-1 border-gray-200 dark:border-gray-700">
          <span>📋</span> Information Document & DUM
        </div>

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
                <button type="button" onClick={() => setIsNewEntreprise(false)} className="absolute right-2 top-2 text-[10px] text-red-500 font-bold">Annuler</button>
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
                <button type="button" onClick={() => setIsNewClient(false)} className="absolute right-2 top-2 text-[10px] text-red-500 font-bold">Annuler</button>
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
            <input type="text" required value={lot} onChange={(e) => setLot(e.target.value)} className={`${inputClass} uppercase font-mono font-bold text-blue-700 dark:text-blue-300`} placeholder="Ex: 12345/2024" />
          </div>
          <div className="flex-1">
            <label className="block text-xs font-semibold mb-1 text-gray-700 dark:text-gray-300">NGP</label>
            <input type="text" value={ngp} onChange={(e) => setNgp(e.target.value)} className={inputClass} placeholder="Ex: 0303441000" />
          </div>
        </div>
      </div>

      {/* MULTI PRODUCTS SECTION */}
      <div className="space-y-3">
        <div className="flex justify-between items-center px-1">
          <span className="text-xs font-bold text-gray-800 dark:text-gray-200 uppercase tracking-wider flex items-center gap-2">
            <span>📦</span> Liste des Produits ({productItems.length})
          </span>
          {productItems.length > 1 && (
            <span className="text-[10px] text-blue-600 dark:text-blue-400 font-semibold">
              Même Réf DUM appliqué à tous les produits
            </span>
          )}
        </div>

        <div className="space-y-3 max-h-[350px] overflow-y-auto pr-1 custom-scrollbar">
          {productItems.map((item, index) => (
            <div key={item.id} className="bg-white dark:bg-gray-800 p-3 rounded-lg border border-gray-200 dark:border-gray-700 shadow-sm relative group space-y-2">
              <div className="flex justify-between items-center border-b border-gray-100 dark:border-gray-750 pb-1.5">
                <span className="text-[10px] font-bold bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300 px-2 py-0.5 rounded-full uppercase">
                  Produit #{index + 1}
                </span>
                {productItems.length > 1 && (
                  <button
                    type="button"
                    onClick={() => handleRemoveProductItem(item.id)}
                    className="text-red-500 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-900/30 p-1 rounded transition-colors text-xs font-bold flex items-center gap-1"
                    title="Supprimer cette ligne"
                  >
                    <span>✕</span> Supprimer
                  </button>
                )}
              </div>

              <div>
                <label className="block text-[11px] font-semibold mb-1 text-gray-700 dark:text-gray-300">Nom du Produit</label>
                {item.isNewProduct ? (
                  <div className="relative">
                    <input
                      type="text"
                      required
                      value={item.newProductName}
                      onChange={(e) => handleUpdateProductItem(item.id, { newProductName: e.target.value })}
                      className={inputClass}
                      autoFocus
                      placeholder="Nouveau nom du produit..."
                    />
                    <button
                      type="button"
                      onClick={() => handleUpdateProductItem(item.id, { isNewProduct: false, newProductName: '' })}
                      className="absolute right-2 top-2 text-[10px] text-red-500 font-bold"
                    >
                      Annuler
                    </button>
                  </div>
                ) : (
                  <select
                    value={item.product}
                    onChange={(e) => e.target.value === 'NEW' ? handleUpdateProductItem(item.id, { isNewProduct: true }) : handleUpdateProductItem(item.id, { product: e.target.value })}
                    className={inputClass}
                    required
                  >
                    <option value="">-- Sélectionner un produit --</option>
                    {products.map(p => <option key={p} value={p}>{p}</option>)}
                    <option value="NEW" className="font-bold text-blue-600 text-xs">+ Ajouter un nouveau produit</option>
                  </select>
                )}
              </div>

              <div className="grid grid-cols-2 md:grid-cols-3 gap-2 pt-1">
                <div>
                  <label className="block text-[10px] font-semibold mb-1 text-gray-600 dark:text-gray-400">Unité</label>
                  <select
                    value={item.unit}
                    onChange={(e) => handleUpdateProductItem(item.id, { unit: e.target.value as UnitType })}
                    className={inputClass}
                  >
                    <option value={UnitType.KG}>KG</option>
                    <option value={UnitType.NOMBRE}>Nombre</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] font-semibold mb-1 text-gray-600 dark:text-gray-400">Quantité</label>
                  <input
                    type="number"
                    required
                    min="0.01"
                    step="0.01"
                    value={item.qty}
                    onChange={(e) => handleUpdateProductItem(item.id, { qty: e.target.value === '' ? '' : Number(e.target.value) })}
                    className={inputClass}
                    placeholder="0,00"
                  />
                </div>
                {type === TransactionType.IN && (
                  <div className="col-span-2 md:col-span-1">
                    <label className="block text-[10px] font-semibold mb-1 text-gray-600 dark:text-gray-400">
                      Valeur (Dhs) <span className="text-[9px] font-normal text-gray-400">(Facultatif)</span>
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      value={item.valueDhs}
                      onChange={(e) => handleUpdateProductItem(item.id, { valueDhs: e.target.value === '' ? '' : Number(e.target.value) })}
                      className={inputClass}
                      placeholder="0,00 Dhs"
                    />
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>

        <button
          type="button"
          onClick={handleAddProductItem}
          className="w-full py-2 border-2 border-dashed border-blue-300 dark:border-blue-700/60 rounded-lg text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 text-xs font-bold transition-all flex items-center justify-center gap-1.5"
        >
          <span>➕</span> Ajouter un autre produit à ce DUM
        </button>
      </div>

      {/* SECURITY CODE */}
      <div className="bg-blue-50 dark:bg-blue-900/20 p-2.5 rounded-lg border border-blue-200 dark:border-blue-800">
        <label className="block text-[10px] font-bold mb-1 text-blue-800 dark:text-blue-300 flex items-center gap-1">
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" /></svg>
          SÉCURITÉ REQUISE
        </label>
        <input 
          type="password" 
          required 
          value={securityCode} 
          onChange={(e) => setSecurityCode(e.target.value)} 
          className="w-full border border-blue-200 dark:border-blue-700 rounded p-1.5 bg-white dark:bg-gray-700 text-xs outline-none focus:ring-1 focus:ring-blue-500 text-gray-900 dark:text-gray-100" 
          placeholder="Entrez le code de sécurité..." 
        />
      </div>

      {/* SUBMIT / CANCEL BUTTONS */}
      <div className="pt-3 flex justify-between items-center border-t border-gray-100 dark:border-gray-700">
        {onDelete && (
          <button type="button" onClick={onDelete} className="text-red-500 hover:text-red-700 text-xs font-bold flex items-center gap-1">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-4v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
            Supprimer
          </button>
        )}
        <div className="flex gap-2 ml-auto">
          <button type="button" onClick={onCancel} className="px-4 py-2 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 rounded text-xs font-medium hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors">
            Annuler
          </button>
          <button type="submit" className="px-6 py-2 bg-blue-600 text-white rounded text-xs font-bold hover:bg-blue-700 shadow shadow-blue-500/20 active:scale-95 transition-all">
            Valider {productItems.length > 1 ? `(${productItems.length} produits)` : ''}
          </button>
        </div>
      </div>
    </form>
  );
};

export default EntryForm;
