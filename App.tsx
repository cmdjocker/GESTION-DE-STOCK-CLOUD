import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Transaction, TransactionType, InventoryItem, DateRange } from './types';
import { 
  subscribeTransactions, 
  subscribeProducts, 
  subscribeEntreprises, 
  subscribeClients,
  saveTransaction,
  deleteTransaction
} from './services/storageService';
import Modal from './components/Modal';
import EntryForm from './components/EntryForm';
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";

function App() {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [entreprisesList, setEntreprisesList] = useState<string[]>([]);
  const [clientsList, setClientsList] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  
  const [showValues, setShowValues] = useState(false);
  const [theme, setTheme] = useState(localStorage.getItem('theme') || 'light');

  useEffect(() => {
    if (theme === 'dark') document.documentElement.classList.add('dark');
    else document.documentElement.classList.remove('dark');
    localStorage.setItem('theme', theme);
  }, [theme]);

  const toggleTheme = () => setTheme(prev => prev === 'dark' ? 'light' : 'dark');
  
  useEffect(() => {
    const unsubTx = subscribeTransactions((data) => {
      setTransactions(data);
      setLoading(false);
    });
    const unsubProd = subscribeProducts(() => {}); 
    const unsubEnt = subscribeEntreprises(setEntreprisesList);
    const unsubCli = subscribeClients(setClientsList);

    return () => {
      unsubTx();
      unsubEnt();
      unsubCli();
    };
  }, []);

  const [filterEntreprise, setFilterEntreprise] = useState<string>('ALL');
  const [filterClient, setFilterClient] = useState<string>('ALL');
  const [filterLot, setFilterLot] = useState<string>('');
  
  const todayStr = new Date().toISOString().split('T')[0];
  const firstDayOfMonth = new Date();
  firstDayOfMonth.setDate(1);
  const [dateRange, setDateRange] = useState<DateRange>({
    from: firstDayOfMonth.toISOString().split('T')[0],
    to: todayStr
  });

  const [appliedFilters, setAppliedFilters] = useState({
    entreprise: 'ALL',
    client: 'ALL',
    lot: '',
    dateRange: { from: firstDayOfMonth.toISOString().split('T')[0], to: todayStr }
  });

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalType, setModalType] = useState<TransactionType>(TransactionType.IN);
  const [editingTx, setEditingTx] = useState<Transaction | null>(null);

  const handleSaveTransaction = async (txData: Omit<Transaction, 'id'>) => {
    try {
      await saveTransaction(txData, editingTx?.id);
      setIsModalOpen(false);
      setEditingTx(null);
    } catch (err) {
      alert("Erreur lors de l'enregistrement : " + err);
    }
  };

  const handleDelete = async (id: string) => {
    if (window.confirm('Voulez-vous vraiment supprimer cette entrée ?')) {
      try {
        await deleteTransaction(id);
        setIsModalOpen(false);
        setEditingTx(null);
      } catch (err) {
        alert("Erreur lors de la suppression : " + err);
      }
    }
  };

  const openModal = (type: TransactionType, txToEdit: Transaction | null = null) => {
    setModalType(type);
    setEditingTx(txToEdit);
    setIsModalOpen(true);
  };

  const closeModal = () => {
    setIsModalOpen(false);
    setEditingTx(null);
  };

  const handleApplyFilters = () => {
    setAppliedFilters({ entreprise: filterEntreprise, client: filterClient, lot: filterLot, dateRange: dateRange });
  };

  const resetFilters = () => {
    const start = firstDayOfMonth.toISOString().split('T')[0];
    setFilterEntreprise('ALL');
    setFilterClient('ALL');
    setFilterLot('');
    setDateRange({ from: start, to: todayStr });
    setAppliedFilters({ entreprise: 'ALL', client: 'ALL', lot: '', dateRange: { from: start, to: todayStr } });
  };

  const getExpiryStatus = (expiryDate?: string) => {
    if (!expiryDate) return null;
    const now = new Date();
    now.setHours(0,0,0,0);
    const exp = new Date(expiryDate);
    exp.setHours(0,0,0,0);
    const diffDays = Math.ceil((exp.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    
    if (diffDays < 30) return 'red';
    if (diffDays <= 45) return 'yellow';
    return 'ok';
  };

  const { inTxs, outTxs, inventory, headerAlert } = useMemo(() => {
    let txs = transactions;
    if (appliedFilters.entreprise !== 'ALL') txs = txs.filter(t => t.entreprise === appliedFilters.entreprise);
    if (appliedFilters.client !== 'ALL') txs = txs.filter(t => t.client === appliedFilters.client);
    if (appliedFilters.lot.trim() !== '') {
      const searchLot = appliedFilters.lot.trim().toUpperCase();
      txs = txs.filter(t => (t.lot || '').toUpperCase().includes(searchLot));
    }

    const invMap = new Map<string, InventoryItem & { unitPrice?: number }>();
    txs.forEach(t => {
      if (t.date <= appliedFilters.dateRange.to) {
        const invKey = `${t.product}_${t.unit}_${t.client || 'AUCUN'}_${t.lot || 'AUCUN'}_${t.entreprise || 'AUCUNE'}`;
        if (!invMap.has(invKey)) {
          invMap.set(invKey, { 
            product: t.product, 
            lot: t.lot || '', 
            unit: t.unit, 
            availableQty: 0, 
            client: t.client,
            entreprise: t.entreprise
          });
        }
        const item = invMap.get(invKey)!;
        if (t.type === TransactionType.IN) {
          item.availableQty += t.qty;
          if (t.valueDhs !== undefined && t.qty > 0) item.unitPrice = t.valueDhs / t.qty;
        } else {
          item.availableQty -= t.qty;
        }
      }
    });

    const displayTxs = txs
      .filter(t => t.date >= appliedFilters.dateRange.from && t.date <= appliedFilters.dateRange.to)
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    const inTxs = displayTxs.filter(t => t.type === TransactionType.IN);
    const outTxs = displayTxs.filter(t => t.type === TransactionType.OUT);
    
    const allIn = transactions.filter(t => t.type === TransactionType.IN);
    let hasRed = false;
    let hasYellow = false;
    allIn.forEach(t => {
      const status = getExpiryStatus(t.expiryDate);
      if (status === 'red') hasRed = true;
      if (status === 'yellow') hasYellow = true;
    });
    const headerAlert = hasRed ? 'red' : (hasYellow ? 'yellow' : null);

    const displayInv = Array.from(invMap.values())
      .filter(item => item.availableQty !== 0)
      .map(item => {
         if (item.unitPrice !== undefined) item.totalValueDhs = item.unitPrice * item.availableQty;
         return item;
      })
      .sort((a, b) => a.product.localeCompare(b.product));

    return { inTxs, outTxs, inventory: displayInv, headerAlert };
  }, [transactions, appliedFilters]);

  const formatNum = (num: number) => {
    const parts = num.toFixed(2).split('.');
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, " ");
    return parts.join(',');
  };

  const formatDate = (dateStr: string) => {
    if (!dateStr) return '-';
    const [y, m, d] = dateStr.split('-');
    return `${d}/${m}/${y}`;
  };

  const handleExportExcel = () => {
    let csvContent = "\uFEFF"; 
    const sep = ";";
    csvContent += "=== STOCK DISPONIBLE ===\nPRODUIT;ENTREPRISE;CLIENT;QUANTITE;UNITE;VALEUR RESTANTE (DHS)\n";
    inventory.forEach(item => { csvContent += `${item.product}${sep}${item.entreprise || ''}${sep}${item.client || ''}${sep}${formatNum(item.availableQty)}${sep}${item.unit}${sep}${item.totalValueDhs !== undefined ? formatNum(item.totalValueDhs) : ''}\n`; });
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `Rapport_Stock_${new Date().toISOString().split('T')[0]}.csv`;
    link.click();
  };

  const handleExportPDF = () => {
    const includeHistory = window.confirm("Inclure l'historique des ENTRÉES et SORTIES ?");
    const doc = new jsPDF();
    const dateStr = new Date().toISOString().split('T')[0];
    const pageWidth = doc.internal.pageSize.getWidth();
    
    doc.setFillColor(30, 64, 175);
    doc.rect(14, 14, pageWidth - 28, 24, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(24);
    doc.setFont("helvetica", "bold");
    doc.text("RAPPORT DE STOCK", pageWidth / 2, 31, { align: "center" });
    doc.setTextColor(100, 100, 100);
    doc.setFontSize(11);
    doc.setFont("helvetica", "normal");
    doc.text(`Édité le : ${formatDate(dateStr)}`, pageWidth / 2, 46, { align: "center" });
    doc.setTextColor(0, 0, 0);
    
    let currentY = 55;
    doc.setFontSize(14);
    doc.setFont("helvetica", "bold");
    doc.text("STOCK DISPONIBLE", 14, currentY);
    autoTable(doc, {
      startY: currentY + 5,
      head: [['Produit', 'Client', 'Entreprise', 'Quantité', 'Unité', ...(showValues ? ['Valeur (Dhs)'] : [])]],
      body: inventory.map(i => [i.product, i.client || '-', i.entreprise || '-', formatNum(i.availableQty), i.unit, ...(showValues ? [i.totalValueDhs !== undefined ? formatNum(i.totalValueDhs) : '-'] : [])]),
      theme: 'grid',
      headStyles: { fillColor: [30, 64, 175] }
    });
    
    if (includeHistory) {
      currentY = (doc as any).lastAutoTable.finalY + 15;
      doc.text("ENTRÉES", 14, currentY);
      autoTable(doc, {
        startY: currentY + 5,
        head: [['Date', 'Produit', 'Qté', 'Unité', 'Entreprise', 'Client', 'DUM Réf', ...(showValues ? ['Valeur (Dhs)'] : [])]],
        body: inTxs.map(t => [formatDate(t.date), t.product, formatNum(t.qty), t.unit, t.entreprise || '-', t.client || '-', t.lot || '-', ...(showValues ? [t.valueDhs !== undefined ? formatNum(t.valueDhs) : '-'] : [])]),
        theme: 'grid',
        headStyles: { fillColor: [21, 128, 61] }
      });
      currentY = (doc as any).lastAutoTable.finalY + 15;
      doc.text("SORTIES", 14, currentY);
      autoTable(doc, {
        startY: currentY + 5,
        head: [['Date', 'Produit', 'Qté', 'Unité', 'Entreprise', 'Client', 'DUM Entrée Réf']],
        body: outTxs.map(t => [formatDate(t.date), t.product, formatNum(t.qty), t.unit, t.entreprise || '-', t.client || '-', t.lot || '-']),
        theme: 'grid',
        headStyles: { fillColor: [185, 28, 28] }
      });
    }
    doc.save(`Rapport_Stock_${dateStr}.pdf`);
  };

  const renderTxRows = (txs: Transaction[], isIncoming: boolean) => {
    if (txs.length === 0) return <tr><td colSpan={isIncoming && showValues ? 5 : 4} className="p-8 text-center text-gray-400 italic">Aucun mouvement</td></tr>;
    return txs.map((tx) => {
      const expiryStatus = isIncoming ? getExpiryStatus(tx.expiryDate) : null;
      let rowStyle = "";
      if (expiryStatus === 'red') rowStyle = "bg-red-50 dark:bg-red-900/20";
      if (expiryStatus === 'yellow') rowStyle = "bg-yellow-50 dark:bg-yellow-900/10";

      return (
        <tr key={tx.id} className={`${rowStyle} hover:bg-gray-100 dark:hover:bg-gray-700/50 border-b border-gray-100 dark:border-gray-800/60 group transition-colors`}>
          <td className="py-1 px-2 text-gray-600 dark:text-gray-400 align-middle whitespace-nowrap">
            <div className="flex flex-col">
              <span>{formatDate(tx.date)}</span>
              {isIncoming && tx.expiryDate && (
                <span className={`text-[9px] font-bold ${expiryStatus === 'red' ? 'text-red-600' : 'text-yellow-600'}`}>
                   Exp: {formatDate(tx.expiryDate)}
                </span>
              )}
            </div>
          </td>
          <td className="py-1 px-2 align-middle">
             <div className="flex items-center gap-2">
               <div className={`flex-shrink-0 flex items-center justify-center w-5 h-5 rounded-full ${isIncoming ? 'bg-green-100 text-green-600' : 'bg-red-100 text-red-600'}`}>{isIncoming ? '↓' : '↑'}</div>
               <div className="flex flex-col">
                  <div className="font-bold text-gray-800 dark:text-gray-200 leading-tight truncate">{tx.product}</div>
                  {tx.lot && <div className="text-[10px] text-gray-500 font-medium">Réf: {tx.lot}</div>}
               </div>
             </div>
          </td>
          <td className="py-1 px-2 text-right align-middle">
            <span className={`font-bold ${isIncoming ? 'text-green-600' : 'text-red-600'}`}>{formatNum(tx.qty)}</span>
            <span className="text-[10px] text-gray-500 ml-1">{tx.unit}</span>
          </td>
          {isIncoming && showValues && <td className="py-1 px-2 text-right text-xs font-semibold">{tx.valueDhs ? `${formatNum(tx.valueDhs)} Dhs` : '-'}</td>}
          <td className="py-1 px-2 text-center w-8">
            <button onClick={() => openModal(tx.type, tx)} className="text-gray-400 hover:text-blue-600 opacity-0 group-hover:opacity-100 p-1">✎</button>
          </td>
        </tr>
      );
    });
  };

  const inputClass = "w-full border border-gray-300 dark:border-gray-600 rounded px-3 py-2 text-sm outline-none bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-blue-500 transition-colors";

  if (loading) return <div className="h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900 text-blue-600 font-bold">CHARGEMENT DE LA BASE DE DONNÉES...</div>;

  return (
    <div className="flex flex-col h-full w-full bg-gray-50 dark:bg-gray-900 font-sans transition-colors duration-200">
      <header className="bg-white dark:bg-gray-800 shadow-sm px-6 py-4 flex flex-col xl:flex-row items-center justify-between border-b border-gray-200 dark:border-gray-700 z-10 gap-4 transition-colors">
        <div className="flex items-center gap-4 flex-1 justify-between xl:justify-start w-full xl:w-auto">
          <div className="flex items-center gap-3">
            {/* Header Main Logo */}
            <div className="p-2 bg-blue-100 dark:bg-blue-900/40 rounded-lg">
              <svg className="w-8 h-8 text-blue-800 dark:text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
              </svg>
            </div>
            <div>
              <h1 className="text-2xl font-black tracking-tight mb-0.5 relative group inline-block">
                <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-700 via-blue-900 to-indigo-800 dark:from-blue-400 dark:via-blue-300 dark:to-indigo-400 border-b-4 border-blue-900 dark:border-blue-400 pb-0.5">
                  GESTION DE STOCK
                </span>
              </h1>
              <p className="text-sm font-bold italic block">
                <span className="text-brand-green border-b border-brand-green pb-0.5">Le stock sous contrôle</span>
              </p>
            </div>
          </div>
          <button onClick={toggleTheme} className="p-2 rounded-full text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors">
            {theme === 'dark' ? '☀️' : '🌙'}
          </button>
        </div>
        <div className="flex flex-none items-center justify-center gap-6 w-full xl:w-auto">
          <button onClick={() => openModal(TransactionType.IN)} className="bg-green-600 hover:bg-green-700 text-white px-10 py-4 rounded-xl font-black shadow-lg shadow-green-500/20 text-lg transition-all active:scale-95 uppercase tracking-wider">+ ENTRÉE</button>
          <button onClick={() => openModal(TransactionType.OUT)} className="bg-red-600 hover:bg-red-700 text-white px-10 py-4 rounded-xl font-black shadow-lg shadow-red-500/20 text-lg transition-all active:scale-95 uppercase tracking-wider">- SORTIE</button>
        </div>
        <div className="flex items-center gap-4 flex-1 justify-center xl:justify-end w-full xl:w-auto">
          <button onClick={handleExportPDF} className="flex items-center gap-2 text-red-700 hover:bg-red-50 px-6 py-3 rounded-lg text-base font-bold border-2 border-red-200 transition-colors">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" /></svg>
            PDF
          </button>
          <button onClick={handleExportExcel} className="flex items-center gap-2 text-green-700 hover:bg-green-100 px-6 py-3 rounded-lg text-base font-bold border-2 border-green-200 transition-colors">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
            Excel
          </button>
        </div>
      </header>

      <div className="bg-white dark:bg-gray-800 px-6 py-4 shadow-sm border-b border-gray-200 dark:border-gray-700 z-0 flex-none transition-colors">
        <div className="flex flex-col md:flex-row md:items-end gap-4">
          <div className="flex-1">
            <label className="block text-xs font-bold text-gray-600 dark:text-gray-400 mb-1 uppercase">Entreprise</label>
            <select value={filterEntreprise} onChange={(e) => setFilterEntreprise(e.target.value)} className={inputClass}>
              <option value="ALL">-- Toutes --</option>
              {entreprisesList.map(ent => <option key={ent} value={ent}>{ent}</option>)}
            </select>
          </div>
          <div className="flex-1">
            <label className="block text-xs font-bold text-gray-600 dark:text-gray-400 mb-1 uppercase">Client</label>
            <select value={filterClient} onChange={(e) => setFilterClient(e.target.value)} className={inputClass}>
              <option value="ALL">-- Tous --</option>
              {clientsList.map(cli => <option key={cli} value={cli}>{cli}</option>)}
            </select>
          </div>
          <div className="flex-1">
            <label className="block text-xs font-bold text-gray-600 dark:text-gray-400 mb-1 uppercase">DUM Réf</label>
            <input type="text" placeholder="Rechercher..." value={filterLot} onChange={(e) => setFilterLot(e.target.value)} className={`${inputClass} uppercase`} />
          </div>
          <div className="flex-none flex items-center gap-2">
             <input type="date" value={dateRange.from} onChange={(e) => setDateRange(prev => ({ ...prev, from: e.target.value }))} className={inputClass} />
             <input type="date" value={dateRange.to} onChange={(e) => setDateRange(prev => ({ ...prev, to: e.target.value }))} className={inputClass} />
          </div>
          <div className="flex-none flex flex-col items-center gap-2 justify-end">
             <div className="flex gap-2 w-full">
               <button onClick={handleApplyFilters} className="px-4 py-2 text-sm font-bold text-white bg-blue-600 rounded flex-1">Filtrer</button>
               <button onClick={resetFilters} className="px-4 py-2 text-sm font-medium text-gray-600 bg-gray-100 rounded flex-1">Réinit.</button>
             </div>
             <label className="flex items-center space-x-2 text-xs font-semibold text-gray-500 cursor-pointer">
               <input type="checkbox" checked={showValues} onChange={e => setShowValues(e.target.checked)} className="rounded h-3 w-3" />
               <span>Afficher Valeurs (Dhs)</span>
             </label>
          </div>
        </div>
      </div>

      <main className="flex-1 p-6 flex flex-col lg:flex-row gap-6 overflow-hidden min-h-0">
        <div className="w-full lg:w-1/3 flex flex-col bg-white dark:bg-gray-800 rounded-xl shadow-md border border-green-200 overflow-hidden relative">
          <div className={`bg-green-700 text-white p-3 font-bold flex justify-between items-center uppercase relative`}>
            <div className="flex items-center gap-2">
              {/* ENTRÉES Table Logo (Arrow Down) */}
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 14l-7 7m0 0l-7-7m7 7V3" />
              </svg>
              <span>ENTRÉES</span>
            </div>
            <div className="flex items-center gap-2">
              {headerAlert && (
                <div className={`w-3 h-3 rounded-full animate-pulse shadow-md ${headerAlert === 'red' ? 'bg-red-500' : 'bg-yellow-400'}`} title={`Alerte péremption: ${headerAlert === 'red' ? '< 30 jours' : 'Proche 30 jours'}`}></div>
              )}
              <span>{inTxs.length}</span>
            </div>
          </div>
          <div className="flex-1 overflow-auto custom-scrollbar">
            <table className="w-full text-left text-sm">
              <thead className="sticky top-0 bg-gray-50 dark:bg-gray-900 text-xs text-gray-500">
                <tr><th className="p-2">Date/Exp</th><th className="p-2">Produit</th><th className="p-2 text-right">Qté</th>{showValues && <th className="p-2 text-right">Valeur</th>}<th className="p-2"></th></tr>
              </thead>
              <tbody>{renderTxRows(inTxs, true)}</tbody>
            </table>
          </div>
        </div>
        <div className="w-full lg:w-1/3 flex flex-col bg-white dark:bg-gray-800 rounded-xl shadow-md border border-red-200 overflow-hidden relative">
          <div className="bg-red-700 text-white p-3 font-bold flex justify-between uppercase">
            <div className="flex items-center gap-2">
              {/* SORTIES Table Logo (Arrow Up) */}
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 10l7-7m0 0l7 7m-7-7v18" />
              </svg>
              <span>SORTIES</span>
            </div>
            <span>{outTxs.length}</span>
          </div>
          <div className="flex-1 overflow-auto custom-scrollbar">
            <table className="w-full text-left text-sm">
              <thead className="sticky top-0 bg-gray-50 dark:bg-gray-900 text-xs text-gray-500">
                <tr><th className="p-2">Date</th><th className="p-2">Produit</th><th className="p-2 text-right">Qté</th><th className="p-2"></th></tr>
              </thead>
              <tbody>{renderTxRows(outTxs, false)}</tbody>
            </table>
          </div>
        </div>
        <div className="w-full lg:w-1/3 flex flex-col bg-white dark:bg-gray-800 rounded-xl shadow-md border border-blue-200 overflow-hidden relative">
          <div className="bg-blue-800 text-white p-3 font-bold flex justify-between uppercase">
            <div className="flex items-center gap-2">
              {/* STOCK Table Logo */}
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" />
              </svg>
              <span>STOCK DISPONIBLE</span>
            </div>
            <span>{inventory.length} réf</span>
          </div>
          <div className="flex-1 overflow-auto custom-scrollbar">
            <table className="w-full text-left text-sm">
              <thead className="sticky top-0 bg-gray-50 dark:bg-gray-900 text-xs text-gray-500">
                <tr><th className="p-2">PRODUIT</th><th className="p-2 text-right">DISPO</th>{showValues && <th className="p-2 text-right">VALEUR</th>}</tr>
              </thead>
              <tbody>
                {inventory.map((item, idx) => (
                  <tr key={`${item.product}_${item.lot}_${idx}`} className="border-b border-gray-100 dark:border-gray-800 hover:bg-blue-50/50 dark:hover:bg-blue-900/10 transition-colors">
                    <td className="p-2">
                      <div className="font-bold text-gray-800 dark:text-gray-200">{item.product}</div>
                      {item.entreprise && <div className="text-[10px] text-gray-500 uppercase font-medium">{item.entreprise}</div>}
                    </td>
                    <td className="p-2 text-right font-black text-blue-700 dark:text-blue-400">{formatNum(item.availableQty)} <span className="text-xs font-normal opacity-60">{item.unit}</span></td>
                    {showValues && <td className="p-2 text-right font-bold text-gray-700 dark:text-gray-300">{item.totalValueDhs ? formatNum(item.totalValueDhs) : '-'}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </main>

      <footer className="bg-white dark:bg-gray-800 border-t py-2 text-center text-xs font-semibold transition-colors">
        <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-600 via-green-600 to-indigo-600 dark:from-blue-400 dark:via-green-400 dark:to-indigo-400">
          © 2026 Abdellah. All rights reserved.
        </span>
      </footer>

      <Modal isOpen={isModalOpen} onClose={closeModal} title={editingTx ? "MODIFIER" : "AJOUTER"}>
        <EntryForm 
          key={editingTx?.id || 'new'}
          type={modalType}
          initialData={editingTx || undefined}
          onSubmit={handleSaveTransaction}
          onCancel={closeModal}
          onDelete={editingTx ? () => handleDelete(editingTx.id) : undefined}
        />
      </Modal>
    </div>
  );
}

export default App;