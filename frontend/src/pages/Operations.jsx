import React, { useCallback, useEffect, useState } from 'react';
import TransactionList from '../components/TransactionList';
import { getTransactions } from '../services/api';

export default function Operations() {
  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await getTransactions();
      setTransactions(result.data);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <main className="page-shell operations-page">
      <header className="operations-header"><p className="eyebrow">OPERATIONS / HISTORY</p><h1>One customer, one record.</h1><p className="subtitle">Every persisted transaction is grouped by user so reviewers can see the full behavioral trail before acting.</p></header>
      <TransactionList transactions={transactions} loading={loading} onAssessed={load} />
    </main>
  );
}