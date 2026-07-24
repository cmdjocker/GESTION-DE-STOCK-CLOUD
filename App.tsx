import React, { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Transaction, TransactionType, InventoryItem, DateRange, UnitType, AuditLog } from './types';
import { 
  subscribeTransactions, 
  subscribeProducts, 
  subscribeEntreprises, 
  subscribeClients,
  saveTransaction,
  deleteTransaction,
  addAuditLog,
  subscribeAuditLogs,
  registerUserSession,
  subscribeActiveSessions,
  disconnectUserSession
} from './services/storageService';
import { auth } from './services/firebase';
import { onAuthStateChanged, signInWithPopup, GoogleAuthProvider, User, signOut } from 'firebase/auth';
import { doc, onSnapshot } from "firebase/firestore";
import { db } from './services/firebase';
import Modal from './components/Modal';
import EntryForm from './components/EntryForm';
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";

function App() {
  const [user, setUser] = useState<User | null>(null);
  const [role, setRole] = useState<string | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [loginError, setLoginError] = useState<string | null>(null);
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

  const [isLogsModalOpen, setIsLogsModalOpen] = useState(false);
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [deleteSecurityCode, setDeleteSecurityCode] = useState('');
  const [searchLogQuery, setSearchLogQuery] = useState('');

  const [isSessionsModalOpen, setIsSessionsModalOpen] = useState(false);
  const [activeSessions, setActiveSessions] = useState<any[]>([]);
  const [sessionConfirmKickAll, setSessionConfirmKickAll] = useState(false);
  const [sessionSuccessMessage, setSessionSuccessMessage] = useState('');
  const [selectedStockKey, setSelectedStockKey] = useState<string | null>(null);
  const [selectedEntreeId, setSelectedEntreeId] = useState<string | null>(null);

  useEffect(() => {
    setSelectedEntreeId(null);
  }, [selectedStockKey]);

  const selectedProductInfo = useMemo(() => {
    if (!selectedStockKey) return null;
    const parts = selectedStockKey.split('_');
    return {
      product: parts[0],
      unit: parts[1],
      entreprise: parts[2] === 'NA' ? '' : parts[2],
      client: parts[3] === 'NA' ? '' : parts[3],
      year: parts[4] === '-' ? '' : parts[4]
    };
  }, [selectedStockKey]);

  useEffect(() => {
    if (user?.email === "abdellahpcbureau@gmail.com") {
      const unsubLogs = subscribeAuditLogs(setLogs);
      const unsubSessions = subscribeActiveSessions(setActiveSessions);
      return () => {
        unsubLogs();
        unsubSessions();
      };
    } else {
      setLogs([]);
      setActiveSessions([]);
    }
  }, [user]);

  useEffect(() => {
    if (theme === 'dark') document.documentElement.classList.add('dark');
    else document.documentElement.classList.remove('dark');
    localStorage.setItem('theme', theme);
  }, [theme]);

  const toggleTheme = () => setTheme(prev => prev === 'dark' ? 'light' : 'dark');

  const processedTransactions = useMemo(() => {
    if (!transactions) return [];
    
    // 1. Build a map of DUM -> Owner (client, entreprise) from IN transactions
    const dumOwnerMap = new Map<string, { client: string; entreprise: string }>();
    
    transactions.forEach(t => {
      if (t.type === TransactionType.IN && t.lot) {
        const normalizedLot = t.lot.trim().toUpperCase();
        if (normalizedLot && t.client) {
          if (!dumOwnerMap.has(normalizedLot)) {
            dumOwnerMap.set(normalizedLot, {
              client: t.client,
              entreprise: t.entreprise || ''
            });
          }
        }
      }
    });

    // 2. Adjust OUT transactions if their DUM is the same as an IN transaction for another client
    return transactions.map(t => {
      if (t.type === TransactionType.OUT && t.lot) {
        const normalizedLot = t.lot.trim().toUpperCase();
        const owner = dumOwnerMap.get(normalizedLot);
        if (owner && owner.client && owner.client.toUpperCase() !== (t.client || '').toUpperCase()) {
          return {
            ...t,
            originalClient: t.client,
            originalEntreprise: t.entreprise,
            client: owner.client,
            entreprise: owner.entreprise
          };
        }
      }
      return t;
    });
  }, [transactions]);

  const fifoAllocation = useMemo(() => {
    const inTxAvailableMap = new Map<string, number>();
    const outTxToInTxsMap = new Map<string, { inTxId: string; qtyAllocated: number }[]>();
    const inTxToOutTxsMap = new Map<string, { outTxId: string; qtyAllocated: number }[]>();

    if (!processedTransactions || processedTransactions.length === 0) {
      return { inTxAvailableMap, outTxToInTxsMap, inTxToOutTxsMap };
    }

    const groups = new Map<string, { ins: Transaction[]; outs: Transaction[] }>();

    processedTransactions.forEach(t => {
      const lot = (t.lot || '').trim().toUpperCase();
      const product = (t.product || '').trim().toUpperCase();
      const unit = (t.unit || '').trim();
      const entreprise = (t.entreprise || 'NA').trim().toUpperCase();
      const client = (t.client || 'NA').trim().toUpperCase();
      
      const key = `${lot}_${product}_${unit}_${entreprise}_${client}`;

      if (!groups.has(key)) {
        groups.set(key, { ins: [], outs: [] });
      }

      const group = groups.get(key)!;
      if (t.type === TransactionType.IN) {
        group.ins.push(t);
      } else if (t.type === TransactionType.OUT) {
        group.outs.push(t);
      }
    });

    groups.forEach(({ ins, outs }) => {
      const sortedIns = [...ins].sort((a, b) => {
        const timeDiff = new Date(a.date).getTime() - new Date(b.date).getTime();
        if (timeDiff !== 0) return timeDiff;
        return a.id.localeCompare(b.id);
      });

      const sortedOuts = [...outs].sort((a, b) => {
        const timeDiff = new Date(a.date).getTime() - new Date(b.date).getTime();
        if (timeDiff !== 0) return timeDiff;
        return a.id.localeCompare(b.id);
      });

      const inStates = sortedIns.map(tx => {
        inTxAvailableMap.set(tx.id, tx.qty);
        return {
          id: tx.id,
          originalQty: tx.qty,
          availableQty: tx.qty,
          tx
        };
      });

      sortedOuts.forEach(outTx => {
        let remainingOut = outTx.qty;
        const allocations: { inTxId: string; qtyAllocated: number }[] = [];

        for (const inState of inStates) {
          if (remainingOut <= 0.000001) break;

          if (inState.availableQty > 0.000001) {
            const take = Math.min(inState.availableQty, remainingOut);
            inState.availableQty -= take;
            remainingOut -= take;

            allocations.push({ inTxId: inState.id, qtyAllocated: take });

            if (!inTxToOutTxsMap.has(inState.id)) {
              inTxToOutTxsMap.set(inState.id, []);
            }
            inTxToOutTxsMap.get(inState.id)!.push({ outTxId: outTx.id, qtyAllocated: take });
          }
        }

        outTxToInTxsMap.set(outTx.id, allocations);

        inStates.forEach(inState => {
          inTxAvailableMap.set(inState.id, inState.availableQty);
        });
      });
    });

    return { inTxAvailableMap, outTxToInTxsMap, inTxToOutTxsMap };
  }, [processedTransactions]);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setUser(user);
      setAuthLoading(false);
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!user) return;

    const unsubTx = subscribeTransactions((data) => {
      const realTxs = data.filter(t => t.unit !== "LOG" && t.unit !== "SESSION");
      setTransactions(realTxs);
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
  }, [user]);

  useEffect(() => {
    if (!user) return;

    registerUserSession(user);

    const sessionDocId = `SESSION_${user.uid}`;
    const unsubSession = onSnapshot(doc(db, "transactions", sessionDocId), (docSnapshot) => {
      if (docSnapshot.exists()) {
        const data = docSnapshot.data();
        if (data && data.unit === "SESSION" && data.entreprise === "disconnected") {
          console.log("Session disconnected remotely by admin.");
          signOut(auth);
        }
      }
    }, (error) => {
      console.warn("Session check error: ", error);
    });

    return () => unsubSession();
  }, [user]);

  const handleLogin = async () => {
    setLoginError(null);
    const provider = new GoogleAuthProvider();
    try {
      await signInWithPopup(auth, provider);
    } catch (error: any) {
      console.error("Login failed:", error);
      if (error.code === 'auth/unauthorized-domain') {
        setLoginError("Ce domaine n'est pas autorisé dans la console Firebase. Veuillez ajouter les URLs de l'app aux 'Domaines autorisés' dans Authentication > Settings.");
      } else {
        setLoginError(error.message || "Échec de la connexion.");
      }
    }
  };

  const handleLogout = () => signOut(auth);

  useEffect(() => {
    if (!user) {
      setRole(null);
      return;
    }
    
    // Default admin
    if (user.email === "abdellahpcbureau@gmail.com") {
      setRole('admin');
      return;
    }

    const unsubUser = onSnapshot(doc(db, "users", user.uid), (doc) => {
      if (doc.exists()) {
        setRole(doc.data().role);
      } else {
        setRole('user');
      }
    });
    
    return () => unsubUser();
  }, [user]);

  const isAdmin = role === 'admin';

  const [filterEntreprise, setFilterEntreprise] = useState<string>('ALL');
  const [filterClient, setFilterClient] = useState<string>('ALL');
  const [filterLot, setFilterLot] = useState<string>('');
  
  const todayStr = new Date().toISOString().split('T')[0];
  const [dateRange, setDateRange] = useState<DateRange>({
    from: '',
    to: todayStr
  });

  const [appliedFilters, setAppliedFilters] = useState({
    entreprise: 'ALL',
    client: 'ALL',
    lot: '',
    dateRange: { from: '', to: todayStr }
  });

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalType, setModalType] = useState<TransactionType>(TransactionType.IN);
  const [editingTx, setEditingTx] = useState<Transaction | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  const handleSaveTransaction = async (txData: Omit<Transaction, 'id'> | Omit<Transaction, 'id'>[]) => {
    try {
      const items = Array.isArray(txData) ? txData : [txData];
      if (items.length === 0) return;

      if (editingTx) {
        // First item updates the existing transaction
        await saveTransaction(items[0], editingTx.id);
        // Any additional items added during edit are saved as new transactions
        for (let i = 1; i < items.length; i++) {
          await saveTransaction(items[i]);
        }
        
        const details = `Modification - Réf DUM: ${items[0].lot || '-'} | ${items.length} produit(s) | Client: ${items[0].client || '-'}`;
        await addAuditLog("MODIFICATION", details);
      } else {
        // Save all transactions
        for (const item of items) {
          await saveTransaction(item);
        }
        
        const actionType = items[0].type === TransactionType.IN ? "AJOUT ENTRÉE" : "AJOUT SORTIE";
        const prodsSummary = items.map(i => `${i.product} (${i.qty} ${i.unit})`).join(', ');
        const details = `Ajout Multi-Produits (${items.length}) - Réf DUM: ${items[0].lot || '-'} | Prods: ${prodsSummary} | Client: ${items[0].client || '-'}`;
        await addAuditLog(actionType, details);
      }

      setIsModalOpen(false);
      setEditingTx(null);
    } catch (err) {
      alert("Erreur lors de l'enregistrement : " + err);
    }
  };

  const handleDelete = (id: string) => {
    setDeleteConfirmId(id);
  };

  const confirmDelete = async () => {
    if (!deleteConfirmId) return;

    if (deleteSecurityCode !== "2026") {
      alert("Code de sécurité incorrect. Suppression annulée.");
      return;
    }

    try {
      const txToDelete = transactions.find(t => t.id === deleteConfirmId);
      await deleteTransaction(deleteConfirmId);
      
      if (txToDelete) {
        const details = `Suppression - Réf DUM: ${txToDelete.lot || '-'} | Prod: ${txToDelete.product} | Qty: ${txToDelete.qty} ${txToDelete.unit} | Client: ${txToDelete.client || '-'}`;
        await addAuditLog("SUPPRESSION", details);
      }

      setIsModalOpen(false);
      setEditingTx(null);
      setDeleteConfirmId(null);
      setDeleteSecurityCode('');
    } catch (err) {
      alert("Erreur lors de la suppression : " + err);
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
    setSelectedStockKey(null);
  };

  const resetFilters = () => {
    setFilterEntreprise('ALL');
    setFilterClient('ALL');
    setFilterLot('');
    setDateRange({ from: '', to: todayStr });
    setAppliedFilters({ entreprise: 'ALL', client: 'ALL', lot: '', dateRange: { from: '', to: todayStr } });
    setFiltersApplied(false);
    setSelectedStockKey(null);
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
      const matchesLot = !isLotFiltered || (t.lot || '').trim().toUpperCase() === appliedFilters.lot.trim().toUpperCase();
      return matchesDate && matchesEnt && matchesCli && matchesLot;
    };

    const displayMovements = processedTransactions.filter(filterFn).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    const inTxs = displayMovements.filter(t => t.type === TransactionType.IN);
    const outTxs = displayMovements.filter(t => t.type === TransactionType.OUT);

    // --- STEP 1: Map ALL Entrées to extract Lot Arrival Info ---
    // This must look at ALL transactions to properly attribute OUTs to their IN year.
    const lotArrivalMap = new Map<string, { arrivalYear: string, unitPrice: number, totalIn: number, totalValue: number }>();
    processedTransactions.forEach(t => {
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

    processedTransactions.forEach(t => {
      if (t.date <= appliedFilters.dateRange.to) {
        const matchesEnt = !isEntSelected || t.entreprise === appliedFilters.entreprise;
        const matchesCli = !isCliSelected || t.client === appliedFilters.client;
        const matchesLot = !isLotFiltered || (t.lot || '').trim().toUpperCase() === appliedFilters.lot.trim().toUpperCase();
        
        if (matchesEnt && matchesCli && matchesLot) {
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

    let finalInTxs = inTxs;
    let finalOutTxs = outTxs;

    if (selectedStockKey) {
      const selectedItem = displayInv.find(i => `${i.product}_${i.unit}_${i.entreprise || 'NA'}_${i.client || 'NA'}_${i.year || '-'}` === selectedStockKey);
      if (selectedItem) {
        finalInTxs = inTxs.filter(t => {
          const isProd = t.product === selectedItem.product;
          const isUnit = t.unit === selectedItem.unit;
          const isEnt = (t.entreprise || 'NA') === (selectedItem.entreprise || 'NA');
          const isCli = (t.client || 'NA') === (selectedItem.client || 'NA');
          if (separateByYear && selectedItem.year && selectedItem.year !== '-') {
            const bucketYear = t.date.split('-')[0];
            return isProd && isUnit && isEnt && isCli && bucketYear === selectedItem.year;
          }
          return isProd && isUnit && isEnt && isCli;
        });

        finalOutTxs = outTxs.filter(t => {
          const isProd = t.product === selectedItem.product;
          const isUnit = t.unit === selectedItem.unit;
          const isEnt = (t.entreprise || 'NA') === (selectedItem.entreprise || 'NA');
          const isCli = (t.client || 'NA') === (selectedItem.client || 'NA');
          if (separateByYear && selectedItem.year && selectedItem.year !== '-') {
            const info = lotArrivalMap.get(`${t.lot}_${t.product}_${t.unit}_${t.entreprise || 'NA'}_${t.client || 'NA'}`);
            const bucketYear = info?.arrivalYear || t.date.split('-')[0];
            return isProd && isUnit && isEnt && isCli && bucketYear === selectedItem.year;
          }
          return isProd && isUnit && isEnt && isCli;
        });
      }
    }

    return { inTxs: finalInTxs, outTxs: finalOutTxs, inventory: displayInv };
  }, [processedTransactions, appliedFilters, filtersApplied, separateByYear, selectedStockKey]);

  const displayedOutTxs = useMemo(() => {
    if (selectedEntreeId) {
      const allocs = fifoAllocation.inTxToOutTxsMap.get(selectedEntreeId) || [];
      const outTxIds = new Set(allocs.map(a => a.outTxId));
      return outTxs.filter(t => outTxIds.has(t.id));
    } else {
      return outTxs.filter(t => {
        const allocs = fifoAllocation.outTxToInTxsMap.get(t.id) || [];
        if (allocs.length === 0) return true;
        return allocs.some(a => {
          const avail = fifoAllocation.inTxAvailableMap.get(a.inTxId) ?? 0;
          return avail > 0.001;
        });
      });
    }
  }, [outTxs, selectedEntreeId, fifoAllocation]);

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

  const formatLogTime = (isoString: string) => {
    try {
      const d = new Date(isoString);
      const day = String(d.getDate()).padStart(2, '0');
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const year = d.getFullYear();
      const hours = String(d.getHours()).padStart(2, '0');
      const minutes = String(d.getMinutes()).padStart(2, '0');
      const seconds = String(d.getSeconds()).padStart(2, '0');
      return `${day}/${month}/${year} ${hours}:${minutes}:${seconds}`;
    } catch {
      return isoString;
    }
  };

  const filteredLogs = useMemo(() => {
    if (!logs) return [];
    return logs.filter(log => {
      const q = searchLogQuery.toLowerCase().trim();
      if (!q) return true;
      return (
        log.userEmail.toLowerCase().includes(q) ||
        log.action.toLowerCase().includes(q) ||
        log.details.toLowerCase().includes(q)
      );
    });
  }, [logs, searchLogQuery]);

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

      // If it is an IN transaction, check if it's complete or has been taken from
      const availableQty = isIncoming ? (fifoAllocation.inTxAvailableMap.get(tx.id) ?? tx.qty) : tx.qty;
      const isComplete = isIncoming ? (Math.abs(availableQty - tx.qty) < 0.001) : true;
      const isSelected = selectedEntreeId === tx.id;

      // Click handler for row (only for IN transaction)
      const handleRowClick = () => {
        if (isIncoming) {
          setSelectedEntreeId(prev => prev === tx.id ? null : tx.id);
        }
      };

      let selectedClass = "";
      if (isIncoming) {
        if (isSelected) {
          selectedClass = "bg-green-50/70 dark:bg-green-950/20 border-l-4 border-l-green-600 ring-1 ring-green-600/30 font-semibold";
        } else {
          selectedClass = "cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800/40";
        }
      }

      return (
        <tr 
          key={tx.id} 
          onClick={handleRowClick}
          className={`${rowStyle} ${selectedClass} hover:bg-gray-100 dark:hover:bg-gray-700/50 border-b border-gray-100 dark:border-gray-800/60 group transition-all duration-150`}
        >
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
                  <div className="flex flex-wrap gap-x-2 gap-y-0.5 text-[9px] uppercase font-medium">
                     {tx.lot && <span className="text-gray-500">Réf: {tx.lot}</span>}
                     {tx.ngp && <span className="text-blue-500">NGP: {tx.ngp}</span>}
                     {tx.originalClient && (
                       <span className="text-amber-600 dark:text-amber-400 font-bold" title={`Originalement saisi pour le client: ${tx.originalClient}`}>
                         ↳ Déduit de {tx.client} (saisi pour {tx.originalClient})
                       </span>
                     )}
                  </div>
               </div>
             </div>
          </td>
          <td className="py-1 px-2 text-right align-middle">
            <div className="flex flex-col items-end">
              <div>
                <span className={`font-bold ${isIncoming ? 'text-green-600' : 'text-red-600'}`}>{formatNum(tx.qty, 2)}</span>
                <span className="text-[9px] text-gray-500 ml-1">{tx.unit}</span>
              </div>
              {isIncoming && (
                <div className="mt-0.5">
                  {isComplete ? (
                    <span className="text-[8px] bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300 font-black px-1.5 py-0.5 rounded uppercase tracking-wider">
                      complet
                    </span>
                  ) : (
                    <span className="text-[8px] bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300 font-black px-1.5 py-0.5 rounded uppercase tracking-wider flex items-center gap-1">
                      reste: {formatNum(availableQty, 2)}
                    </span>
                  )}
                </div>
              )}
            </div>
          </td>
          {isIncoming && showValues && <td className="py-1 px-2 text-right font-semibold">{tx.valueDhs ? `${formatNum(tx.valueDhs, 3)}` : '-'}</td>}
          <td className="py-1 px-2 text-center w-14">
            <div className="flex items-center justify-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity" onClick={e => e.stopPropagation()}>
              <button 
                onClick={(e) => {
                  e.stopPropagation();
                  const originalTx = transactions.find(t => t.id === tx.id) || tx;
                  openModal(tx.type, originalTx);
                }} 
                className="text-gray-400 hover:text-blue-600 p-1" 
                title="Modifier"
              >
                ✎
              </button>
              <button 
                onClick={(e) => {
                  e.stopPropagation();
                  handleDelete(tx.id);
                }} 
                className="text-gray-400 hover:text-red-600 p-1" 
                title="Supprimer"
              >
                🗑️
              </button>
            </div>
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

              const itemKey = `${item.product}_${item.unit}_${item.entreprise || 'NA'}_${item.client || 'NA'}_${item.year || '-'}`;
              const isSelected = selectedStockKey === itemKey;

              rows.push(
                <tr 
                  key={`${entName}-${cliName}-${yearName}-${idx}`} 
                  onClick={() => {
                    setSelectedStockKey(prev => prev === itemKey ? null : itemKey);
                    setShowHistoryUI(true);
                  }}
                  className={`border-b border-gray-100 dark:border-gray-800 cursor-pointer transition-all duration-200 ${
                    isSelected 
                      ? 'bg-blue-50/80 dark:bg-blue-900/40 text-blue-900 dark:text-blue-100 ring-2 ring-blue-500/30' 
                      : 'hover:bg-gray-50 dark:hover:bg-gray-700/30'
                  }`}
                >
                  <td className="p-2 pl-6">
                    <div className="flex items-center gap-1.5">
                      {isSelected && (
                        <span className="w-1.5 h-1.5 rounded-full bg-blue-600 dark:bg-blue-400 animate-pulse flex-shrink-0" />
                      )}
                      <div className={`font-bold leading-tight ${isSelected ? 'text-blue-700 dark:text-blue-400' : 'text-gray-800 dark:text-gray-200'}`}>
                        {item.product}
                      </div>
                    </div>
                    {item.ngp && item.ngp !== '-' && <div className="text-[9px] text-blue-500 font-bold uppercase pl-3">NGP: {item.ngp}</div>}
                  </td>
                  <td className={`p-2 text-right font-black ${isSelected ? 'text-blue-800 dark:text-blue-300' : 'text-blue-700 dark:text-blue-400'}`}>
                    {formatNum(item.availableQty, 2)} <span className="text-[9px] font-normal opacity-60">{item.unit}</span>
                  </td>
                  {showValues && (
                    <td className={`p-2 text-right font-bold ${isSelected ? 'text-blue-800 dark:text-blue-300' : 'text-gray-700 dark:text-gray-300'}`}>
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

  if (authLoading) return <div className="h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900 text-blue-600 font-bold uppercase tracking-widest animate-pulse">Initialisation...</div>;

  if (!user) {
    return (
      <div className="h-screen flex flex-col items-center justify-center bg-gray-50 dark:bg-gray-900 p-6">
        <div className="max-w-md w-full bg-white dark:bg-gray-800 rounded-2xl shadow-xl p-8 text-center border border-gray-100 dark:border-gray-700">
          <div className="w-20 h-20 bg-blue-100 dark:bg-blue-900/40 rounded-2xl flex items-center justify-center mx-auto mb-6">
            <svg className="w-10 h-10 text-blue-800 dark:text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
            </svg>
          </div>
          <h1 className="text-2xl font-black text-gray-900 dark:text-white mb-2 uppercase tracking-tight">Gestion d'Entrepôt</h1>
          <p className="text-gray-500 dark:text-gray-400 mb-8 text-sm">Veuillez vous connecter pour accéder à votre inventaire.</p>
          
          {loginError && (
            <div className="mb-6 p-4 bg-red-50 dark:bg-red-900/20 border border-red-100 dark:border-red-800 rounded-xl text-red-600 dark:text-red-400 text-xs text-left leading-relaxed">
              <div className="font-bold mb-1 uppercase flex items-center gap-2">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                Erreur de configuration
              </div>
              {loginError}
            </div>
          )}

          <button 
            onClick={handleLogin}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-6 rounded-xl shadow-lg shadow-blue-500/20 transition-all active:scale-[0.98] flex items-center justify-center gap-3"
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24">
              <path fill="currentColor" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
              <path fill="currentColor" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
              <path fill="currentColor" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" />
              <path fill="currentColor" d="M12 5.38c1.62 0 3.06.56 4.21 1.66l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
            </svg>
            Se connecter avec Google
          </button>
        </div>
      </div>
    );
  }

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
          <div className="flex items-center gap-2">
            <button onClick={toggleTheme} className="p-1.5 rounded-full text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors">
              {theme === 'dark' ? '☀️' : '🌙'}
            </button>
            <button onClick={handleLogout} className="p-1.5 rounded-full text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors" title="Déconnexion">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
              </svg>
            </button>
          </div>
        </div>
        <div className="flex flex-col items-center gap-2 w-full xl:w-auto min-w-[350px] xl:min-w-[450px]">
          <div className="flex flex-none items-center justify-center gap-4 w-full">
            <button onClick={() => openModal(TransactionType.IN)} className="bg-green-600 hover:bg-green-700 text-white px-6 py-2.5 rounded-lg font-black shadow-lg shadow-green-500/20 text-sm transition-all active:scale-95 uppercase tracking-wider">+ ENTRÉE</button>
            <button onClick={() => openModal(TransactionType.OUT)} className="bg-red-600 hover:bg-red-700 text-white px-6 py-2.5 rounded-lg font-black shadow-lg shadow-red-500/20 text-sm transition-all active:scale-95 uppercase tracking-wider">- SORTIE</button>
          </div>
        </div>
        <div className="flex flex-col items-center gap-1 xl:items-end flex-1 w-full xl:w-auto">
           <div className="flex items-center gap-2">
              {user?.email === "abdellahpcbureau@gmail.com" && (
                <>
                  <button onClick={() => setIsSessionsModalOpen(true)} className="flex items-center gap-2 text-amber-700 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-900/20 px-3 py-1.5 rounded-lg text-xs font-bold border border-amber-200 dark:border-amber-800 transition-colors">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                    Utilisateurs ({activeSessions.length})
                  </button>
                  <button onClick={() => setIsLogsModalOpen(true)} className="flex items-center gap-2 text-blue-700 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 px-3 py-1.5 rounded-lg text-xs font-bold border border-blue-200 dark:border-blue-800 transition-colors">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                    Historique d'Activité
                  </button>
                </>
              )}
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
                <div className="flex items-center gap-1.5">
                  <span>ENTRÉES ({inTxs.length})</span>
                  <span className="text-[9px] text-green-200 font-normal lowercase normal-case italic">(cliquez pour filtrer sorties)</span>
                </div>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 14l-7 7m0 0l-7-7m7 7V3" /></svg>
              </div>
              {selectedProductInfo && (
                <div className="bg-green-50 dark:bg-green-950/20 px-2 py-1.5 border-b border-green-100 dark:border-green-900/30 text-[10px] text-green-800 dark:text-green-300 flex items-center justify-between gap-1">
                  <span className="font-bold truncate">Filtre: {selectedProductInfo.product} ({selectedProductInfo.client})</span>
                  <button onClick={() => setSelectedStockKey(null)} className="text-[10px] font-black hover:text-red-500 bg-green-100 dark:bg-green-900/40 w-4 h-4 rounded-full flex items-center justify-center transition-colors">✕</button>
                </div>
              )}
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
                <span>SORTIES ({displayedOutTxs.length})</span>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 10l7-7m0 0l7 7m-7-7v18" /></svg>
              </div>
              {selectedProductInfo && (
                <div className="bg-red-50 dark:bg-red-950/20 px-2 py-1.5 border-b border-red-100 dark:border-red-900/30 text-[10px] text-red-800 dark:text-red-300 flex items-center justify-between gap-1">
                  <span className="font-bold truncate">Filtre: {selectedProductInfo.product} ({selectedProductInfo.client})</span>
                  <button onClick={() => setSelectedStockKey(null)} className="text-[10px] font-black hover:text-red-500 bg-red-100 dark:bg-red-900/40 w-4 h-4 rounded-full flex items-center justify-center transition-colors">✕</button>
                </div>
              )}
              {selectedEntreeId && (() => {
                const selectedEntree = transactions.find(t => t.id === selectedEntreeId);
                const totalSorties = fifoAllocation.inTxToOutTxsMap.get(selectedEntreeId)?.reduce((sum, a) => sum + a.qtyAllocated, 0) || 0;
                return selectedEntree ? (
                  <div className="bg-amber-50 dark:bg-amber-950/20 px-2 py-1.5 border-b border-amber-100 dark:border-amber-900/30 text-[10px] text-amber-800 dark:text-amber-300 flex items-center justify-between gap-1">
                    <div className="flex items-center gap-2 flex-wrap min-w-0 flex-1">
                      <span className="font-bold truncate">Entrée du {formatDate(selectedEntree.date)} ({formatNum(selectedEntree.qty, 2)} {selectedEntree.unit})</span>
                      <span className="bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300 px-1.5 py-0.5 rounded font-black whitespace-nowrap text-[9px] uppercase tracking-wider">
                        Total Sorties: {formatNum(totalSorties, 2)} {selectedEntree.unit}
                      </span>
                    </div>
                    <button onClick={() => setSelectedEntreeId(null)} className="text-[10px] font-black hover:text-red-500 bg-amber-100 dark:bg-amber-900/40 w-4.5 h-4.5 rounded-full flex items-center justify-center transition-colors">✕</button>
                  </div>
                ) : null;
              })()}
              <div className="flex-1 overflow-auto custom-scrollbar">
                <table className={`w-full text-left ${tableFontSize}`}>
                  <thead className="sticky top-0 bg-gray-50 dark:bg-gray-900 text-[10px] text-gray-500 z-10">
                    <tr><th className="p-2">Date</th><th className="p-2">Produit</th><th className="p-2 text-right">Qté</th><th className="p-2"></th></tr>
                  </thead>
                  <tbody>{renderTxRows(displayedOutTxs, false)}</tbody>
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

      <Modal isOpen={isModalOpen} onClose={closeModal} title={editingTx ? "MODIFIER" : "AJOUTER"} maxWidth="max-w-2xl">
        <EntryForm 
          key={editingTx?.id || 'new'}
          type={modalType}
          initialData={editingTx || undefined}
          onSubmit={handleSaveTransaction}
          onCancel={closeModal}
          onDelete={editingTx ? () => handleDelete(editingTx.id) : undefined}
          isMasterAdmin={user?.email === "abdellahpcbureau@gmail.com"}
        />
      </Modal>

      <Modal isOpen={deleteConfirmId !== null} onClose={() => { setDeleteConfirmId(null); setDeleteSecurityCode(''); }} title="CONFIRMATION DE SUPPRESSION">
        <div className="space-y-4 text-left p-1">
          <p className="text-sm text-gray-700 dark:text-gray-300">
            Voulez-vous vraiment supprimer cette entrée ? Cette action est irréversible.
          </p>
          
          <div className="bg-red-50 dark:bg-red-950/20 p-2.5 rounded-lg border border-red-200 dark:border-red-900/40 space-y-1">
            <label className="block text-[10px] font-bold text-red-800 dark:text-red-300 flex items-center gap-1">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" /></svg>
              CODE DE SÉCURITÉ REQUIS
            </label>
            <input 
              type="password" 
              required 
              value={deleteSecurityCode} 
              onChange={(e) => setDeleteSecurityCode(e.target.value)} 
              className="w-full border border-red-300 dark:border-red-800 rounded p-1.5 bg-white dark:bg-gray-800 text-xs outline-none focus:ring-1 focus:ring-red-500 text-gray-900 dark:text-gray-100" 
              placeholder="Entrez le code de sécurité pour valider..." 
            />
          </div>

          <div className="flex gap-2 justify-end pt-2 border-t border-gray-100 dark:border-gray-700">
            <button 
              type="button"
              onClick={() => { setDeleteConfirmId(null); setDeleteSecurityCode(''); }} 
              className="px-4 py-1.5 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 rounded text-xs font-medium"
            >
              Annuler
            </button>
            <button 
              type="button"
              onClick={confirmDelete} 
              className="px-6 py-1.5 bg-red-600 hover:bg-red-700 text-white rounded text-xs font-bold shadow shadow-red-500/20 active:scale-95 transition-all"
            >
              Supprimer
            </button>
          </div>
        </div>
      </Modal>

      <Modal isOpen={isLogsModalOpen} onClose={() => { setIsLogsModalOpen(false); setSearchLogQuery(''); }} title="HISTORIQUE D'ACTIVITÉ">
        <div className="space-y-4 text-left p-1">
          <div className="relative">
            <input 
              type="text" 
              placeholder="Rechercher par utilisateur, action, produit ou lot..." 
              value={searchLogQuery} 
              onChange={(e) => setSearchLogQuery(e.target.value)} 
              className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-xs bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 outline-none focus:ring-1 focus:ring-blue-500" 
            />
            {searchLogQuery && (
              <button 
                onClick={() => setSearchLogQuery('')} 
                className="absolute right-2.5 top-2.5 text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
              >
                ✖
              </button>
            )}
          </div>

          <div className="max-h-[60vh] overflow-y-auto border border-gray-100 dark:border-gray-800 rounded-lg divide-y divide-gray-100 dark:divide-gray-800 bg-white dark:bg-gray-850">
            {filteredLogs.length === 0 ? (
              <div className="p-8 text-center text-gray-400 text-xs">
                Aucune activité enregistrée.
              </div>
            ) : (
              filteredLogs.map(log => {
                let badgeColor = "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200";
                if (log.action.includes("ENTRÉE")) badgeColor = "bg-green-100 text-green-800 dark:bg-green-950/40 dark:text-green-300 font-black";
                else if (log.action.includes("SORTIE")) badgeColor = "bg-red-100 text-red-800 dark:bg-red-950/40 dark:text-red-300 font-black";
                else if (log.action.includes("SUPPRESSION")) badgeColor = "bg-red-600 text-white shadow-sm font-black";
                else if (log.action.includes("MODIFICATION")) badgeColor = "bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300 font-black";
                else if (log.action.includes("CREATION")) badgeColor = "bg-blue-100 text-blue-800 dark:bg-blue-950/40 dark:text-blue-300 font-black";

                return (
                  <div key={log.id} className="p-3 flex flex-col md:flex-row md:items-start justify-between gap-3 text-xs hover:bg-gray-50/50 dark:hover:bg-gray-800/20 transition-colors">
                    <div className="flex-1 space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-bold text-gray-800 dark:text-gray-200">{log.userEmail}</span>
                        <span className={`px-2 py-0.5 rounded text-[10px] uppercase ${badgeColor}`}>
                          {log.action}
                        </span>
                      </div>
                      <p className="text-gray-600 dark:text-gray-300 leading-relaxed font-mono text-[11px]">{log.details}</p>
                    </div>
                    <div className="text-right flex-shrink-0 self-start">
                      <span className="text-[10px] text-gray-400 dark:text-gray-500 font-mono font-bold">{formatLogTime(log.timestamp)}</span>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          <div className="flex justify-end pt-2">
            <button 
              type="button"
              onClick={() => { setIsLogsModalOpen(false); setSearchLogQuery(''); }} 
              className="px-5 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded text-xs font-bold shadow shadow-blue-500/20 active:scale-95 transition-all"
            >
              Fermer
            </button>
          </div>
        </div>
      </Modal>

      {/* Connected Users Modal */}
      <Modal isOpen={isSessionsModalOpen} onClose={() => { setIsSessionsModalOpen(false); setSessionConfirmKickAll(false); setSessionSuccessMessage(''); }} title="UTILISATEURS CONNECTÉS">
        <div className="space-y-4 text-left p-1">
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Voici la liste en temps réel des utilisateurs actuellement connectés à la plateforme. Vous pouvez forcer la déconnexion de n'importe quel utilisateur ou de tous à la fois.
          </p>

          {sessionSuccessMessage && (
            <div className="bg-green-50 dark:bg-green-950/20 text-green-800 dark:text-green-300 p-2.5 rounded-lg border border-green-200 dark:border-green-900/40 text-xs font-bold flex items-center justify-between">
              <span>{sessionSuccessMessage}</span>
              <button onClick={() => setSessionSuccessMessage('')} className="text-[10px] opacity-70 hover:opacity-100">✕</button>
            </div>
          )}

          {sessionConfirmKickAll ? (
            <div className="bg-red-50 dark:bg-red-950/20 p-3 rounded-lg border border-red-200 dark:border-red-900/40 space-y-2">
              <p className="text-xs font-bold text-red-800 dark:text-red-300">
                ⚠️ Êtes-vous sûr de vouloir déconnecter TOUS les autres utilisateurs connectés ?
              </p>
              <div className="flex gap-2 justify-end">
                <button
                  type="button"
                  onClick={() => setSessionConfirmKickAll(false)}
                  className="px-3 py-1 bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-800 dark:text-gray-200 rounded text-[11px] font-bold transition-all"
                >
                  Annuler
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    let count = 0;
                    for (const session of activeSessions) {
                      if (session.uid !== user?.uid) {
                        await disconnectUserSession(session.id);
                        count++;
                      }
                    }
                    setSessionConfirmKickAll(false);
                    setSessionSuccessMessage(`${count} utilisateur(s) ont été déconnectés.`);
                  }}
                  className="px-3 py-1 bg-red-600 hover:bg-red-700 text-white rounded text-[11px] font-bold shadow shadow-red-500/10 transition-all"
                >
                  Oui, déconnecter tout le monde
                </button>
              </div>
            </div>
          ) : (
            activeSessions.length > 1 && (
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={() => setSessionConfirmKickAll(true)}
                  className="px-3 py-1.5 bg-red-50 hover:bg-red-100 dark:bg-red-950/20 dark:hover:bg-red-900/30 text-red-700 dark:text-red-400 border border-red-200 dark:border-red-900/50 rounded-lg text-xs font-bold transition-colors flex items-center gap-1"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" /></svg>
                  Déconnecter tout le monde
                </button>
              </div>
            )
          )}

          <div className="max-h-[50vh] overflow-y-auto border border-gray-100 dark:border-gray-800 rounded-lg divide-y divide-gray-100 dark:divide-gray-800 bg-white dark:bg-gray-850">
            {activeSessions.length === 0 ? (
              <div className="p-8 text-center text-gray-400 text-xs">
                Aucun utilisateur connecté.
              </div>
            ) : (
              activeSessions.map(session => {
                const isMe = session.uid === user?.uid;
                return (
                  <div key={session.id} className="p-3 flex items-center justify-between gap-3 text-xs hover:bg-gray-50/50 dark:hover:bg-gray-800/20 transition-colors">
                    <div className="min-w-0 flex-1 space-y-0.5">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="font-bold text-gray-800 dark:text-gray-200 truncate">{session.email}</span>
                        {isMe && (
                          <span className="bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300 px-1.5 py-0.5 rounded text-[9px] font-black uppercase">
                            Moi (Admin)
                          </span>
                        )}
                        <span className="flex h-2 w-2 relative">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                          <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
                        </span>
                      </div>
                      <p className="text-[10px] text-gray-400 dark:text-gray-500 font-mono">
                        Dernier accès: {session.lastActive ? new Date(session.lastActive).toLocaleTimeString() : 'N/A'}
                      </p>
                    </div>
                    {!isMe && (
                      <button
                        type="button"
                        onClick={async () => {
                          await disconnectUserSession(session.id);
                          setSessionSuccessMessage(`L'utilisateur ${session.email} a été déconnecté.`);
                        }}
                        className="flex-shrink-0 px-2.5 py-1 bg-red-600 hover:bg-red-700 text-white rounded text-[10px] font-bold shadow-sm transition-all hover:scale-105 active:scale-95"
                      >
                        Expulser
                      </button>
                    )}
                  </div>
                );
              })
            )}
          </div>

          <div className="flex justify-end pt-2 border-t border-gray-100 dark:border-gray-700">
            <button 
              type="button"
              onClick={() => { setIsSessionsModalOpen(false); setSessionConfirmKickAll(false); setSessionSuccessMessage(''); }} 
              className="px-5 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded text-xs font-bold shadow shadow-blue-500/20 active:scale-95 transition-all"
            >
              Fermer
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

export default App;