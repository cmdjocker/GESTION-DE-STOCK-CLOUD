import React, { useState, useEffect } from 'react';
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
  
  const [date, setDate] = useState(initialData?.date || new Date().toISOString().split('T')[0]);
  const [entreprise, setEntreprise] = useState(initialData?.entreprise || '');
  const [client, setClient] = useState(initialData?.client || '');
  const [lot, setLot] = useState(initialData?.lot || '');
  const [product, setProduct] = useState(initialData?.product || '');
  const [unit, setUnit] = useState<UnitType>(initialData?.unit || UnitType.KG);
  const [qty, setQty] = useState<number | ''>(initialData?.qty || '');
  const [valueDhs, setValueDhs] = useState<number | ''>(initialData?.valueDhs || '');

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
    return () => { unsubProd(); unsubEnt(); unsubCli(); };
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    let finalProduct = product;
    let finalEntreprise = entreprise;
    let finalClient = client;

    if (isNewProduct) {
      finalProduct = newProductName.trim().toUpperCase();
      await addToList("products", finalProduct);
    }
    if (isNewEntreprise) {
      finalEntreprise = newEntrepriseName.trim().toUpperCase();
      await addToList("entreprises", finalEntreprise);
    }
    if (isNewClient) {
      finalClient = newClientName.trim().toUpperCase();
      await addToList("clients", finalClient);
    }

    if (!finalProduct || qty === '' || !lot.trim()) {
      alert('Champs obligatoires manquants.');
      return;
    }

    onSubmit({
      type,
      date,
      entreprise: finalEntreprise || undefined,
      client: finalClient || undefined,
      lot: lot.trim().toUpperCase(),
      product: finalProduct,
      unit,
      qty: Number(qty),
      valueDhs: type === TransactionType.IN && valueDhs !== '' ? Number(valueDhs) : undefined,
    });
  };

  const inputClass = "w-full border border-gray-300 dark:border-gray-600 rounded-md p-2 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 outline-none";

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="block text-sm font-semibold mb-1">Date</label>
        <input type="date" required value={date} onChange={(e) => setDate(e.target.value)} className={inputClass} />
      </div>

      <div className="flex gap-4">
        <div className="flex-1">
          <label className="block text-sm font-semibold mb-1">Entreprise</label>
          {isNewEntreprise ? (
            <input type="text" value={newEntrepriseName} onChange={(e) => setNewEntrepriseName(e.target.value)} className={inputClass} autoFocus />
          ) : (
            <select value={entreprise} onChange={(e) => e.target.value === 'NEW' ? setIsNewEntreprise(true) : setEntreprise(e.target.value)} className={inputClass}>
              <option value="">-- Aucune --</option>
              {entreprisesList.map(ent => <option key={ent} value={ent}>{ent}</option>)}
              <option value="NEW">+ Ajouter...</option>
            </select>
          )}
        </div>
        <div className="flex-1">
          <label className="block text-sm font-semibold mb-1">Client</label>
          {isNewClient ? (
            <input type="text" value={newClientName} onChange={(e) => setNewClientName(e.target.value)} className={inputClass} autoFocus />
          ) : (
            <select value={client} onChange={(e) => e.target.value === 'NEW' ? setIsNewClient(true) : setClient(e.target.value)} className={inputClass}>
              <option value="">-- Aucun --</option>
              {clientsList.map(cli => <option key={cli} value={cli}>{cli}</option>)}
              <option value="NEW">+ Ajouter...</option>
            </select>
          )}
        </div>
      </div>

      <div>
        <label className="block text-sm font-semibold mb-1">{type === TransactionType.OUT ? 'DUM ENTRÉE Réf' : 'DUM Réf'}</label>
        <input type="text" required value={lot} onChange={(e) => setLot(e.target.value)} className={`${inputClass} uppercase`} />
      </div>

      <div>
        <label className="block text-sm font-semibold mb-1">Produit</label>
        {isNewProduct ? (
          <input type="text" required value={newProductName} onChange={(e) => setNewProductName(e.target.value)} className={inputClass} autoFocus />
        ) : (
          <select value={product} onChange={(e) => e.target.value === 'NEW' ? setIsNewProduct(true) : setProduct(e.target.value)} className={inputClass}>
            {products.map(p => <option key={p} value={p}>{p}</option>)}
            <option value="NEW">+ Ajouter...</option>
          </select>
        )}
      </div>

      <div className="flex gap-4">
        <div className="flex-1">
          <label className="block text-sm font-semibold mb-1">Unité</label>
          <select value={unit} onChange={(e) => setUnit(e.target.value as UnitType)} className={inputClass}>
            <option value={UnitType.KG}>KG</option>
            <option value={UnitType.NOMBRE}>Nombre</option>
          </select>
        </div>
        <div className="flex-1">
          <label className="block text-sm font-semibold mb-1">Quantité</label>
          <input type="number" required step="0.01" value={qty} onChange={(e) => setQty(e.target.value === '' ? '' : Number(e.target.value))} className={inputClass} />
        </div>
      </div>

      {type === TransactionType.IN && (
        <div>
          <label className="block text-sm font-semibold mb-1">Valeur en Dhs</label>
          <input type="number" step="0.01" value={valueDhs} onChange={(e) => setValueDhs(e.target.value === '' ? '' : Number(e.target.value))} className={inputClass} />
        </div>
      )}

      <div className="pt-4 flex justify-between">
        {onDelete && <button type="button" onClick={onDelete} className="text-red-600 font-bold">Supprimer</button>}
        <div className="flex gap-2 ml-auto">
          <button type="button" onClick={onCancel} className="px-4 py-2 bg-gray-100 rounded">Annuler</button>
          <button type="submit" className="px-4 py-2 bg-blue-600 text-white rounded font-bold">Valider</button>
        </div>
      </div>
    </form>
  );
};

export default EntryForm;