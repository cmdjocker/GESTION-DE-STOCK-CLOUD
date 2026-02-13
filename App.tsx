import React, { useState, useEffect, useMemo } from 'react';
import { Transaction, TransactionType, InventoryItem, DateRange, UnitType } from './types';
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
  const [showHistoryUI, setShowHistoryUI] = useState(false); 
  const [includeHistoryPdf, setIncludeHistoryPdf] = useState(false);
  const [separateByYear, setSeparateByYear] = useState(false);
  const [theme, setTheme] = useState(localStorage.getItem('theme') || 'light');
  const [filtersApplied, setFiltersApplied] = useState(false);

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
    setFiltersApplied(true);
  };

  const resetFilters = () => {
    setFilterEntreprise('ALL');
    setFilterClient('ALL');
    setFilterLot('');
    setDateRange({ from: '', to: todayStr });
    setAppliedFilters({ entreprise: 'ALL', client: 'ALL', lot: '', dateRange: { from: '', to: todayStr } });
    setFiltersApplied(false);
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

  const { inTxs, outTxs, inventory } = useMemo(() => {
    if (!filtersApplied) {
      return { inTxs: [], outTxs: [], inventory: [] };
    }

    const isEntSelected = appliedFilters.entreprise !== 'ALL';
    const isCliSelected = appliedFilters.client !== 'ALL';
    const isLotFiltered = appliedFilters.lot.trim() !== '';

    // Historical movements tables
    const filterFn = (t: Transaction) => {
      const matchesDate = (!appliedFilters.dateRange.from || t.date >= appliedFilters.dateRange.from) && t.date <= appliedFilters.dateRange.to;
      const matchesEnt = !isEntSelected || t.entreprise === appliedFilters.entreprise;
      const matchesCli = !isCliSelected || t.client === appliedFilters.client;
      const matchesLot = !isLotFiltered || (t.lot || '').toUpperCase().includes(appliedFilters.lot.trim().toUpperCase());
      return matchesDate && matchesEnt && matchesCli && matchesLot;
    };

    const displayMovements = transactions.filter(filterFn).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    const inTxs = displayMovements.filter(t => t.type === TransactionType.IN);
    const outTxs = displayMovements.filter(t => t.type === TransactionType.OUT);

    // --- STEP 1: Map ALL Entrées to extract Lot Arrival Info ---
    // This must look at ALL transactions to properly attribute OUTs to their IN year.
    const lotArrivalMap = new Map<string, { arrivalYear: string, unitPrice: number, totalIn: number, totalValue: number }>();
    transactions.forEach(t => {
      if (t.type === TransactionType.IN) {
        const key = `${t.lot}_${t.product}_${t.unit}_${t.entreprise || 'NA'}_${t.client || 'NA'}`;
        const existing = lotArrivalMap.get(key) || { arrivalYear: t.date.split('-')[0], unitPrice: 0, totalIn: 0, totalValue: 0 };
        const newTotalIn = existing.totalIn + t.qty;
        const newTotalValue = existing.totalValue + (t.valueDhs || 0);
        lotArrivalMap.set(key, {
          arrivalYear: existing.arrivalYear, // Earliest arrival year
          totalIn: newTotalIn,
          totalValue: newTotalValue,
          unitPrice: newTotalIn > 0 ? newTotalValue / newTotalIn : 0
        });
      }
    });

    // --- STEP 2: Aggregate Inventory by Year Bucket ---
    const invDataMap = new Map<string, {
      product: string;
      unit: string;
      ngp: string;
      entreprise: string;
      client: string;
      year: string;
      currentQty: number;
      currentValue: number;
      sumInQty: number;
    }>();

    transactions.forEach(t => {
      if (t.date <= appliedFilters.dateRange.to) {
        const matchesEnt = !isEntSelected || t.entreprise === appliedFilters.entreprise;
        const matchesCli = !isCliSelected || t.client === appliedFilters.client;
        
        if (matchesEnt && matchesCli) {
          const lotKey = `${t.lot}_${t.product}_${t.unit}_${t.entreprise || 'NA'}_${t.client || 'NA'}`;
          const info = lotArrivalMap.get(lotKey);
          
          let bucketYear = '-';
          if (separateByYear) {
            // CRITICAL FIX: Attribution to Arrival Year. 
            // If OUT, find its IN year from lotArrivalMap. Fallback to its own year if data is missing.
            bucketYear = (t.type === TransactionType.IN) ? t.date.split('-')[0] : (info?.arrivalYear || t.date.split('-')[0]);
          }

          const key = `${t.product}_${t.unit}_${t.entreprise || 'NA'}_${t.client || 'NA'}_${t.ngp || 'NA'}${separateByYear ? `_${bucketYear}` : ''}`;

          if (!invDataMap.has(key)) {
            invDataMap.set(key, {
              product: t.product,
              unit: t.unit,
              ngp: t.ngp || '-',
              entreprise: t.entreprise || '-',
              client: t.client || '-',
              year: separateByYear ? bucketYear : '-',
              currentQty: 0,
              currentValue: 0,
              sumInQty: 0
            });
          }
          
          const entry = invDataMap.get(key)!;
          if (t.type === TransactionType.IN) {
            entry.currentQty += t.qty;
            entry.currentValue += (t.valueDhs || 0);
            entry.sumInQty += t.qty;
          } else {
            entry.currentQty -= t.qty;
            if (info) {
              entry.currentValue -= (t.qty * info.unitPrice);
            }
          }
        }
      }
    });

    const displayInv = Array.from(invDataMap.values())
      .map(entry => ({
        product: entry.product,
        lot: '-', 
        ngp: entry.ngp,
        unit: entry.unit as UnitType,
        availableQty: entry.currentQty,
        entreprise: entry.entreprise,
        client: entry.client,
        totalValueDhs: entry.currentValue,
        year: entry.year,
        sumInQty: entry.sumInQty
      }))
      // Filter out empty buckets or years with only sorties (requested logic)
      .filter(i => Math.abs(i.availableQty) > 0.001 && i.sumInQty > 0)
      .sort((a, b) => {
        if (a.unit === UnitType.KG && b.unit !== UnitType.KG) return -1;
        if (a.unit !== UnitType.KG && b.unit === UnitType.KG) return 1;
        if (separateByYear && a.year && b.year && a.year !== b.year) {
          return b.year.localeCompare(a.year);
        }
        return a.product.localeCompare(b.product);
      });

    return { inTxs, outTxs, inventory: displayInv };
  }, [transactions, appliedFilters, filtersApplied, separateByYear]);

  const formatNum = (num: number, decimals: number = 2) => {
    const safeNum = Math.abs(num) < 0.000001 ? 0 : num;
    const parts = safeNum.toFixed(decimals).split('.');
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
    csvContent += `=== STOCK DISPONIBLE ${separateByYear ? '(PAR ANNÉE)' : ''} ===\nPRODUIT;NGP;ENTREPRISE;CLIENT;ANNÉE;QUANTITE;UNITE;VALEUR RESTANTE (DHS)\n`;
    inventory.forEach(item => { 
      csvContent += `${item.product}${sep}${item.ngp || ''}${sep}${item.entreprise || ''}${sep}${item.client || ''}${sep}${item.year || ''}${sep}${formatNum(item.availableQty, 2)}${sep}${item.unit}${sep}${item.totalValueDhs !== undefined ? formatNum(item.totalValueDhs, 3) : ''}\n`; 
    });
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `Rapport_Stock_${new Date().toISOString().split('T')[0]}.csv`;
    link.click();
  };

  const handleExportPDF = () => {
    const doc = new jsPDF();
    const dateStr = new Date().toISOString().split('T')[0];
    const pageWidth = doc.internal.pageSize.getWidth();
    
    doc.setFillColor(30, 64, 175);
    doc.rect(14, 14, pageWidth - 28, 24, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(22);
    doc.setFont("helvetica", "bold");
    doc.text("RAPPORT DE STOCK", pageWidth / 2, 31, { align: "center" });
    doc.setTextColor(100, 100, 100);
    doc.setFontSize(10);
    doc.setFont("helvetica", "normal");
    doc.text(`Généré le : ${formatDate(dateStr)}`, pageWidth / 2, 46, { align: "center" });
    doc.setTextColor(0, 0, 0);
    
    let currentY = 55;
    const pdfFontSize = showValues ? 7 : 8.5;

    const headers = ['Produit', 'NGP', 'Client', 'Entreprise', ...(separateByYear ? ['Année'] : []), 'Quantité', 'Unité', ...(showValues ? ['Valeur (Dhs)'] : [])];
    let body: any[] = [];
    let grandTotalValue = 0;

    const nestedGroups: Record<string, Record<string, Record<string, InventoryItem[]>>> = {};
    inventory.forEach(item => {
      const ent = item.entreprise || 'SANS ENTREPRISE';
      const cli = item.client || 'SANS CLIENT';
      const yr = separateByYear ? (item.year || 'SANS ANNÉE') : 'ALL';
      
      if (!nestedGroups[ent]) nestedGroups[ent] = {};
      if (!nestedGroups[ent][cli]) nestedGroups[ent][cli] = {};
      if (!nestedGroups[ent][cli][yr]) nestedGroups[ent][cli][yr] = [];
      nestedGroups[ent][cli][yr].push(item);
    });

    Object.entries(nestedGroups).forEach(([entName, clients]) => {
      body.push([{ 
        content: `ENTREPRISE: ${entName}`, 
        colSpan: headers.length, 
        styles: { fillColor: [30, 64, 175], fontStyle: 'bold', textColor: [255, 255, 255], fontSize: pdfFontSize + 1.5 } 
      }]);

      let entrepriseTotalVal = 0;

      Object.entries(clients).forEach(([cliName, years]) => {
        body.push([{ 
          content: `CLIENT: ${cliName}`, 
          colSpan: headers.length, 
          styles: { fillColor: [235, 245, 255], fontStyle: 'bold', textColor: [30, 64, 175], fontSize: pdfFontSize + 0.8 } 
        }]);
        
        body.push(headers.map(h => ({ 
          content: h, 
          styles: { fillColor: [241, 245, 249], textColor: [51, 65, 85], fontStyle: 'bold', fontSize: pdfFontSize - 1 } 
        })));

        let clientTotalVal = 0;
        const productSummaryMap = new Map<string, { qty: number, unit: string, value: number }>();
        const yearEntries = Object.entries(years);
        const hasMultipleYears = yearEntries.length > 1;

        yearEntries.forEach(([yearName, items]) => {
          if (separateByYear && yearName !== 'ALL') {
            body.push([{ 
              content: `ANNÉE: ${yearName}`, 
              colSpan: headers.length, 
              styles: { fillColor: [248, 250, 252], fontStyle: 'bold', textColor: [71, 85, 105], fontSize: pdfFontSize + 0.5, halign: 'left' } 
            }]);
          }

          items.forEach(i => {
            const val = i.totalValueDhs || 0;
            clientTotalVal += val;
            entrepriseTotalVal += val;
            grandTotalValue += val;

            const sumKey = `${i.product}_${i.unit}`;
            const existing = productSummaryMap.get(sumKey) || { qty: 0, unit: i.unit, value: 0 };
            productSummaryMap.set(sumKey, { 
              qty: existing.qty + i.availableQty, 
              unit: i.unit, 
              value: existing.value + val 
            });

            body.push([
              i.product, i.ngp || '-', i.client || '-', i.entreprise || '-', 
              ...(separateByYear ? [i.year || '-'] : []),
              formatNum(i.availableQty, 2), i.unit, 
              ...(showValues ? [formatNum(val, 3)] : [])
            ]);
          });
        });

        if (separateByYear && hasMultipleYears && productSummaryMap.size > 0) {
          body.push([{ 
            content: `RÉCAPITULATIF PRODUITS - ${cliName}`, 
            colSpan: headers.length, 
            styles: { fillColor: [240, 240, 240], fontStyle: 'bold', textColor: [0, 0, 0], fontSize: pdfFontSize - 1, halign: 'center' } 
          }]);
          
          Array.from(productSummaryMap.entries()).forEach(([prodKey, data]) => {
            const productName = prodKey.split('_')[0];
            body.push([
              { content: productName, styles: { fontStyle: 'bold' } },
              '-', cliName, entName,
              ...(separateByYear ? ['TOTAL'] : []),
              formatNum(data.qty, 2), data.unit,
              ...(showValues ? [formatNum(data.value, 3)] : [])
            ]);
          });
        }

        if (showValues || separateByYear) {
          body.push([
            { 
              content: `TOTAL CLIENT: ${cliName}`, 
              colSpan: headers.length - (showValues ? 1 : 0), 
              styles: { fontStyle: 'bold', halign: 'right', fontSize: pdfFontSize + 1, fillColor: [224, 231, 255] } 
            },
            ...(showValues ? [{ content: formatNum(clientTotalVal, 3), styles: { fontStyle: 'bold', halign: 'right', fontSize: pdfFontSize + 1, fillColor: [224, 231, 255] } }] : [])
          ]);
        }
      });

      if (showValues) {
        body.push([
          { content: `TOTAL ENTREPRISE: ${entName}`, colSpan: headers.length - 1, styles: { fontStyle: 'bold', halign: 'right', fontSize: pdfFontSize + 1.5, fillColor: [220, 230, 255] } },
          { content: formatNum(entrepriseTotalVal, 3), styles: { fontStyle: 'bold', halign: 'right', fontSize: pdfFontSize + 1.5, fillColor: [220, 230, 255] } }
        ]);
      }
    });

    doc.setFontSize(14);
    doc.setFont("helvetica", "bold");
    doc.text("STOCK DISPONIBLE", 14, currentY);
    
    autoTable(doc, {
      startY: currentY + 5,
      head: [], 
      body: body,
      foot: showValues ? [[
        { content: 'TOTAL GÉNÉRAL', colSpan: headers.length - 1, styles: { halign: 'right', fontSize: pdfFontSize + 2, fontStyle: 'bold' } },
        { content: formatNum(grandTotalValue, 3), styles: { halign: 'right', fontSize: pdfFontSize + 2, fontStyle: 'bold' } }
      ]] : undefined,
      theme: 'grid',
      styles: { fontSize: pdfFontSize, cellPadding: 2 }
    });
    
    if (includeHistoryPdf) {
      currentY = (doc as any).lastAutoTable.finalY + 15;
      doc.setFontSize(13);
      doc.text("HISTORIQUE DES ENTRÉES", 14, currentY);
      autoTable(doc, {
        startY: currentY + 5,
        head: [['Date', 'Produit', 'NGP', 'Qté', 'Unité', 'DUM Réf', 'Entreprise', 'Client', ...(showValues ? ['Valeur (Dhs)'] : [])]],
        body: inTxs.map(t => [formatDate(t.date), t.product, t.ngp || '-', formatNum(t.qty, 2), t.unit, t.lot || '-', t.entreprise || '-', t.client || '-', ...(showValues ? [formatNum(t.valueDhs || 0, 3)] : [])]),
        theme: 'grid',
        headStyles: { fillColor: [21, 128, 61] },
        styles: { fontSize: pdfFontSize - 1 }
      });

      currentY = (doc as any).lastAutoTable.finalY + 15;
      doc.setFontSize(13);
      doc.text("HISTORIQUE DES SORTIES", 14, currentY);
      autoTable(doc, {
        startY: currentY + 5,
        head: [['Date', 'Produit', 'NGP', 'Qté', 'Unité', 'DUM Entrée Réf', 'Entreprise', 'Client']],
        body: outTxs.map(t => [formatDate(t.date), t.product, t.ngp || '-', formatNum(t.qty, 2), t.unit, t.lot || '-', t.entreprise || '-', t.client || '-']),
        theme: 'grid',
        headStyles: { fillColor: [185, 28, 28] },
        styles: { fontSize: pdfFontSize - 1 }
      });
    }
    doc.save(`Rapport_Stock_${dateStr}.pdf`);
  };

  const tableFontSize = showValues ? "text-[10px]" : "text-sm";

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
                <span className={`font-bold ${expiryStatus === 'red' ? 'text-red-600' : 'text-yellow-600'}`} style={{fontSize: '9px'}}>
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
                  <div className="flex gap-2 text-[9px] uppercase font-medium">
                     {tx.lot && <span className="text-gray-500">Réf: {tx.lot}</span>}
                     {tx.ngp && <span className="text-blue-500">NGP: {tx.ngp}</span>}
                  </div>
               </div>
             </div>
          </td>
          <td className="py-1 px-2 text-right align-middle">
            <span className={`font-bold ${isIncoming ? 'text-green-600' : 'text-red-600'}`}>{formatNum(tx.qty, 2)}</span>
            <span className="text-[9px] text-gray-500 ml-1">{tx.unit}</span>
          </td>
          {isIncoming && showValues && <td className="py-1 px-2 text-right font-semibold">{tx.valueDhs ? `${formatNum(tx.valueDhs, 3)}` : '-'}</td>}
          <td className="py-1 px-2 text-center w-8">
            <button onClick={() => openModal(tx.type, tx)} className="text-gray-400 hover:text-blue-600 opacity-0 group-hover:opacity-100 p-1">✎</button>
          </td>
        </tr>
      );
    });
  };

  const renderStockItems = () => {
    if (inventory.length === 0) {
      return <tr><td colSpan={showValues ? 3 : 2} className="p-8 text-center text-gray-400 italic">Aucun mouvement</td></tr>;
    }

    const isEntSelected = appliedFilters.entreprise !== 'ALL';

    const nestedGroups: Record<string, Record<string, Record<string, InventoryItem[]>>> = {};
    inventory.forEach(item => {
      const ent = item.entreprise || 'SANS ENTREPRISE';
      const cli = item.client || 'SANS CLIENT';
      const yr = separateByYear ? (item.year || 'SANS ANNÉE') : 'ALL';
      
      if (!nestedGroups[ent]) nestedGroups[ent] = {};
      if (!nestedGroups[ent][cli]) nestedGroups[ent][cli] = {};
      if (!nestedGroups[ent][cli][yr]) nestedGroups[ent][cli][yr] = [];
      nestedGroups[ent][cli][yr].push(item);
    });

    const rows: React.ReactNode[] = [];
    let grandTotalVal = 0;

    Object.entries(nestedGroups).forEach(([entName, clients]) => {
      if (!isEntSelected || entName === appliedFilters.entreprise) {
        rows.push(
          <tr key={`ent-header-${entName}`} className="bg-blue-800 text-white font-black text-[11px] uppercase tracking-wider">
            <td colSpan={showValues ? 3 : 2} className="p-2 border-b border-blue-900 shadow-inner">
              ENTREPRISE: {entName}
            </td>
          </tr>
        );

        let entTotalVal = 0;

        Object.entries(clients).forEach(([cliName, years]) => {
          rows.push(
            <tr key={`cli-header-${entName}-${cliName}`} className="bg-blue-50/70 dark:bg-blue-900/10 text-blue-900 dark:text-blue-300 font-bold text-[10px] uppercase">
              <td colSpan={showValues ? 3 : 2} className="p-2 pl-4 border-b border-blue-100 dark:border-blue-800/40 italic">
                CLIENT: {cliName}
              </td>
            </tr>
          );

          let cliTotalVal = 0;
          const productSummaryMap = new Map<string, { qty: number, unit: string, value: number }>();
          const yearEntries = Object.entries(years);
          const hasMultipleYears = yearEntries.length > 1;

          yearEntries.forEach(([yearName, items]) => {
            if (separateByYear && yearName !== 'ALL') {
              rows.push(
                <tr key={`yr-header-${entName}-${cliName}-${yearName}`} className="bg-gray-100/50 dark:bg-gray-800/50 text-gray-600 dark:text-gray-400 font-black text-[9px] uppercase">
                  <td colSpan={showValues ? 3 : 2} className="p-1.5 pl-6 border-b border-gray-200 dark:border-gray-700">
                    ANNÉE: {yearName}
                  </td>
                </tr>
              );
            }

            items.forEach((item, idx) => {
              const val = item.totalValueDhs || 0;
              cliTotalVal += val;
              entTotalVal += val;
              grandTotalVal += val;

              const sumKey = `${item.product}_${item.unit}`;
              const existing = productSummaryMap.get(sumKey) || { qty: 0, unit: item.unit, value: 0 };
              productSummaryMap.set(sumKey, { 
                qty: existing.qty + item.availableQty, 
                unit: item.unit, 
                value: existing.value + val 
              });

              rows.push(
                <tr key={`${entName}-${cliName}-${yearName}-${idx}`} className="border-b border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700/30 transition-colors">
                  <td className="p-2 pl-6">
                    <div className="font-bold text-gray-800 dark:text-gray-200 leading-tight">{item.product}</div>
                    {item.ngp && item.ngp !== '-' && <div className="text-[9px] text-blue-500 font-bold uppercase">NGP: {item.ngp}</div>}
                  </td>
                  <td className="p-2 text-right font-black text-blue-700 dark:text-blue-400">
                    {formatNum(item.availableQty, 2)} <span className="text-[9px] font-normal opacity-60">{item.unit}</span>
                  </td>
                  {showValues && (
                    <td className="p-2 text-right font-bold text-gray-700 dark:text-gray-300">
                      {formatNum(val, 3)}
                    </td>
                  )}
                </tr>
              );
            });
          });

          if (separateByYear && hasMultipleYears && productSummaryMap.size > 0) {
            rows.push(
              <tr key={`cli-summary-header-${entName}-${cliName}`} className="bg-gray-100 dark:bg-gray-800 text-[9px] font-black border-y border-gray-200 dark:border-gray-700">
                <td colSpan={showValues ? 3 : 2} className="p-1.5 text-center text-gray-500 uppercase tracking-widest">
                  RÉCAPITULATIF PRODUITS - {cliName}
                </td>
              </tr>
            );
            Array.from(productSummaryMap.entries()).forEach(([prodKey, data]) => {
              const productName = prodKey.split('_')[0];
              rows.push(
                <tr key={`summary-${entName}-${cliName}-${prodKey}`} className="bg-gray-50/50 dark:bg-gray-800/20 text-[10px] border-b border-gray-100 dark:border-gray-800">
                  <td className="p-1.5 pl-8 font-bold text-blue-800 dark:text-blue-400">{productName} (TOTAL)</td>
                  <td className="p-1.5 text-right font-black">{formatNum(data.qty, 2)} <span className="text-[8px] opacity-60 uppercase">{data.unit}</span></td>
                  {showValues && <td className="p-1.5 text-right font-bold">{formatNum(data.value, 3)}</td>}
                </tr>
              );
            });
          }

          if (showValues || separateByYear) {
            rows.push(
              <tr key={`cli-subtotal-${entName}-${cliName}`} className="bg-blue-50/30 dark:bg-blue-900/10 text-[10px] font-black border-b border-gray-100 dark:border-gray-700">
                <td className="p-1.5 pl-8 italic text-gray-600 dark:text-gray-400 uppercase">TOTAL GÉNÉRAL CLIENT {cliName}</td>
                <td></td>
                <td className="p-1.5 text-right text-blue-900 dark:text-blue-300">{showValues ? formatNum(cliTotalVal, 3) : ''}</td>
              </tr>
            );
          }
        });

        if (showValues) {
          rows.push(
            <tr key={`ent-total-${entName}`} className="bg-blue-100/30 dark:bg-blue-900/20 text-[11px] font-black border-b border-blue-200 dark:border-blue-700">
              <td className="p-2 pl-4 text-blue-900 dark:text-blue-200 uppercase">TOTAL ENTREPRISE {entName}</td>
              <td></td>
              <td className="p-2 text-right text-blue-900 dark:text-blue-200">{formatNum(entTotalVal, 3)}</td>
            </tr>
          );
        }
      }
    });

    if (showValues) {
      rows.push(
        <tr key="grand-total" className="bg-blue-600 text-white sticky bottom-0 z-10 shadow-lg">
          <td className="p-3 font-black text-xs uppercase">TOTAL GÉNÉRAL VALEUR</td>
          <td></td>
          <td className="p-3 text-right font-black text-sm border-t-2 border-white/20">
            {formatNum(grandTotalVal, 3)} <span className="text-[10px] font-normal">DHS</span>
          </td>
        </tr>
      );
    }

    return rows;
  };

  const inputClass = "w-full border border-gray-300 dark:border-gray-600 rounded px-2 py-1.5 text-xs outline-none bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:ring-1 focus:ring-blue-500 transition-colors";

  if (loading) return <div className="h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900 text-blue-600 font-bold">CHARGEMENT DE LA BASE DE DONNÉES...</div>;

  return (
    <div className="flex flex-col h-full w-full bg-gray-50 dark:bg-gray-900 font-sans transition-colors duration-200">
      <header className="bg-white dark:bg-gray-800 shadow-sm px-6 py-3 flex flex-col xl:flex-row items-center justify-between border-b border-gray-200 dark:border-gray-700 z-20 gap-3 transition-colors">
        <div className="flex items-center gap-4 flex-1 justify-between xl:justify-start w-full xl:w-auto">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-100 dark:bg-blue-900/40 rounded-lg">
              <svg className="w-6 h-6 text-blue-800 dark:text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
              </svg>
            </div>
            <div>
              <h1 className="text-xl font-black tracking-tight mb-0.5">
                <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-700 via-blue-900 to-indigo-800 dark:from-blue-400 dark:via-blue-300 dark:to-indigo-400 uppercase">
                  GESTION DE STOCK
                </span>
              </h1>
              <p className="text-[10px] font-bold italic text-brand-green uppercase">Le stock sous contrôle</p>
            </div>
          </div>
          <button onClick={toggleTheme} className="p-1.5 rounded-full text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors">
            {theme === 'dark' ? '☀️' : '🌙'}
          </button>
        </div>
        <div className="flex flex-none items-center justify-center gap-4 w-full xl:w-auto">
          <button onClick={() => openModal(TransactionType.IN)} className="bg-green-600 hover:bg-green-700 text-white px-6 py-2.5 rounded-lg font-black shadow-lg shadow-green-500/20 text-sm transition-all active:scale-95 uppercase tracking-wider">+ ENTRÉE</button>
          <button onClick={() => openModal(TransactionType.OUT)} className="bg-red-600 hover:bg-red-700 text-white px-6 py-2.5 rounded-lg font-black shadow-lg shadow-red-500/20 text-sm transition-all active:scale-95 uppercase tracking-wider">- SORTIE</button>
        </div>
        <div className="flex flex-col items-center gap-1 xl:items-end flex-1 w-full xl:w-auto">
           <div className="flex items-center gap-2">
              <button onClick={handleExportPDF} className="flex items-center gap-2 text-red-700 hover:bg-red-50 px-3 py-1.5 rounded-lg text-xs font-bold border border-red-200 transition-colors">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" /></svg>
                PDF
              </button>
              <button onClick={handleExportExcel} className="flex items-center gap-2 text-green-700 hover:bg-green-100 px-3 py-1.5 rounded-lg text-xs font-bold border border-green-200 transition-colors">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                Excel
              </button>
           </div>
           <div className="flex flex-wrap justify-end gap-x-3 gap-y-1 mt-1">
             <label className="flex items-center gap-1.5 text-[10px] font-bold text-gray-500 cursor-pointer hover:text-blue-600 transition-colors">
                <input type="checkbox" checked={includeHistoryPdf} onChange={e => setIncludeHistoryPdf(e.target.checked)} className="rounded h-3 w-3" />
                <span>Inclure Historique PDF</span>
             </label>
             <label className="flex items-center gap-1.5 text-[10px] font-bold text-gray-500 cursor-pointer hover:text-blue-600 transition-colors">
                <input type="checkbox" checked={separateByYear} onChange={e => setSeparateByYear(e.target.checked)} className="rounded h-3 w-3" />
                <span>Séparer par Année</span>
             </label>
           </div>
        </div>
      </header>

      <div className="bg-white dark:bg-gray-800 px-6 py-3 shadow-sm border-b border-gray-200 dark:border-gray-700 z-10 flex-none transition-colors">
        <div className="flex flex-col md:flex-row md:items-end gap-3">
          <div className="flex-1">
            <label className="block text-[10px] font-bold text-gray-600 dark:text-gray-400 mb-1 uppercase">Entreprise</label>
            <select value={filterEntreprise} onChange={(e) => setFilterEntreprise(e.target.value)} className={inputClass}>
              <option value="ALL">-- Toutes --</option>
              {entreprisesList.map(ent => <option key={ent} value={ent}>{ent}</option>)}
            </select>
          </div>
          <div className="flex-1">
            <label className="block text-[10px] font-bold text-gray-600 dark:text-gray-400 mb-1 uppercase">Client</label>
            <select value={filterClient} onChange={(e) => setFilterClient(e.target.value)} className={inputClass}>
              <option value="ALL">-- Tous --</option>
              {clientsList.map(cli => <option key={cli} value={cli}>{cli}</option>)}
            </select>
          </div>
          <div className="flex-1">
            <label className="block text-[10px] font-bold text-gray-600 dark:text-gray-400 mb-1 uppercase">DUM Réf</label>
            <input type="text" placeholder="Recherche..." value={filterLot} onChange={(e) => setFilterLot(e.target.value)} className={`${inputClass} uppercase`} />
          </div>
          <div className="flex-none flex items-center gap-1">
             <input type="date" value={dateRange.from} onChange={(e) => setDateRange(prev => ({ ...prev, from: e.target.value }))} className={inputClass} />
             <input type="date" value={dateRange.to} onChange={(e) => setDateRange(prev => ({ ...prev, to: e.target.value }))} className={inputClass} />
          </div>
          <div className="flex-none flex flex-col items-center gap-1.5 justify-end">
             <div className="flex gap-2 w-full">
               <button onClick={handleApplyFilters} className="px-3 py-1.5 text-xs font-bold text-white bg-blue-600 rounded flex-1">Filtrer</button>
               <button onClick={resetFilters} className="px-3 py-1.5 text-xs font-medium text-gray-600 bg-gray-100 rounded flex-1">Réinit.</button>
             </div>
             <div className="flex gap-3 items-center">
                <label className="flex items-center space-x-1 text-[10px] font-bold text-gray-500 cursor-pointer">
                  <input type="checkbox" checked={showValues} onChange={e => setShowValues(e.target.checked)} className="rounded h-3 w-3" />
                  <span>Valeurs (Dhs)</span>
                </label>
                <label className="flex items-center space-x-1 text-[10px] font-bold text-gray-500 cursor-pointer">
                  <input type="checkbox" checked={showHistoryUI} onChange={e => setShowHistoryUI(e.target.checked)} className="rounded h-3 w-3" />
                  <span>Afficher Mouvements</span>
                </label>
             </div>
          </div>
        </div>
      </div>

      <main className="flex-1 p-4 flex flex-col lg:flex-row gap-4 overflow-hidden min-h-0">
        {showHistoryUI && (
          <>
            <div className="w-full lg:w-1/3 flex flex-col bg-white dark:bg-gray-800 rounded-xl shadow border border-green-200 overflow-hidden relative transition-all duration-300">
              <div className={`bg-green-700 text-white p-2 text-xs font-bold flex justify-between items-center uppercase`}>
                <span>ENTRÉES ({inTxs.length})</span>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 14l-7 7m0 0l-7-7m7 7V3" /></svg>
              </div>
              <div className="flex-1 overflow-auto custom-scrollbar">
                <table className={`w-full text-left ${tableFontSize}`}>
                  <thead className="sticky top-0 bg-gray-50 dark:bg-gray-900 text-[10px] text-gray-500 z-10">
                    <tr><th className="p-2">Date/Exp</th><th className="p-2">Produit</th><th className="p-2 text-right">Qté</th>{showValues && <th className="p-2 text-right">Valeur</th>}<th className="p-2"></th></tr>
                  </thead>
                  <tbody>{renderTxRows(inTxs, true)}</tbody>
                </table>
              </div>
            </div>
            <div className="w-full lg:w-1/3 flex flex-col bg-white dark:bg-gray-800 rounded-xl shadow border border-red-200 overflow-hidden relative transition-all duration-300">
              <div className="bg-red-700 text-white p-2 text-xs font-bold flex justify-between items-center uppercase">
                <span>SORTIES ({outTxs.length})</span>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 10l7-7m0 0l7 7m-7-7v18" /></svg>
              </div>
              <div className="flex-1 overflow-auto custom-scrollbar">
                <table className={`w-full text-left ${tableFontSize}`}>
                  <thead className="sticky top-0 bg-gray-50 dark:bg-gray-900 text-[10px] text-gray-500 z-10">
                    <tr><th className="p-2">Date</th><th className="p-2">Produit</th><th className="p-2 text-right">Qté</th><th className="p-2"></th></tr>
                  </thead>
                  <tbody>{renderTxRows(outTxs, false)}</tbody>
                </table>
              </div>
            </div>
          </>
        )}
        <div className={`flex flex-col bg-white dark:bg-gray-800 rounded-xl shadow border border-blue-200 overflow-hidden relative transition-all duration-300 ${showHistoryUI ? 'w-full lg:w-1/3' : 'w-full'}`}>
          <div className="bg-blue-800 text-white p-2 text-xs font-bold flex justify-between items-center uppercase">
            <span>STOCK DISPO ({inventory.length} LIGNES)</span>
            <div className="flex items-center gap-2">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" /></svg>
            </div>
          </div>
          <div className="flex-1 overflow-auto custom-scrollbar">
            <table className={`w-full text-left ${tableFontSize}`}>
              <thead className="sticky top-0 bg-gray-50 dark:bg-gray-900 text-[10px] text-gray-500 z-10">
                <tr><th className="p-2">PRODUIT</th><th className="p-2 text-right">DISPO</th>{showValues && <th className="p-2 text-right">VALEUR</th>}</tr>
              </thead>
              <tbody>
                {renderStockItems()}
              </tbody>
            </table>
          </div>
        </div>
      </main>

      <footer className="bg-white dark:bg-gray-800 border-t py-1 text-center text-[9px] font-bold">
        <span className="text-gray-400">
          © 2026 Abdellah – Software Developer. All rights reserved.
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