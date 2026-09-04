import React, { useEffect, useState, useCallback } from 'react';
import TransactionForm from '../components/TransactionForm';
import { getHealth, getRiskSummary } from '../services/api';

export default function Dashboard({ user }) {
  const [health, setHealth] = useState(null);
  const [summary, setSummary] = useState(null);

  const loadSummary = useCallback(async () => {
    try {
      const result = await getRiskSummary();
      setSummary(result.data);
    } catch (err) {
      console.error('Failed to load risk summary:', err.message);
    }
  }, []);

  useEffect(() => {
    loadSummary();
    getHealth()
      .then((h) => setHealth(h))
      .catch(() => setHealth(null));
  }, [loadSummary]);

  function handleCreated() {
    loadSummary();
  }

  const mode = health?.mode || 'DEMO_MODE';

  return (
    <main className="page-shell dashboard">
      <header className="dashboard-header">
        <div>
          <p className="eyebrow">PAYMENT RISK CONTROL CENTER</p>
          <h1>See the signal.<br /><span>Keep the decision human.</span></h1>
          <p className="subtitle hero-subtitle">A live command surface for safer payment operations, designed around explainable scoring and deliberate review.</p>
        </div>
        <div className="header-pills">
          <span className={`mode-pill ${mode === 'RAZORPAY_TEST_MODE' ? 'razorpay' : 'demo'}`}>
            {mode === 'RAZORPAY_TEST_MODE' ? 'RAZORPAY TEST MODE' : 'DEMO MODE'}
          </span>
        </div>
      </header>

      <div className="hero-strip reveal">
        <div><span className="hero-number">04</span><span>bounded agents</span></div>
        <div><span className="hero-number">01</span><span>deterministic decision engine</span></div>
        <div><span className="hero-number">100%</span><span>auditable outcomes</span></div>
      </div>

      <SummaryCards summary={summary} />

      <TransactionForm user={user} onCreated={handleCreated} />
    </main>
  );
}

function SummaryCards({ summary }) {
  if (!summary) return null;
  const cards = [
    { label: 'Total Transactions', value: summary.totalTransactions },
    { label: 'Approved', value: summary.approved, cls: 'sc-approved' },
    { label: 'Review Required', value: summary.reviewRequired, cls: 'sc-review' },
    { label: 'Block Recommended', value: summary.blockRecommended, cls: 'sc-block' },
    { label: 'High Risk', value: summary.highRisk, cls: 'sc-highrisk' }
  ];
  return (
    <div className="summary-cards">
      {cards.map((c, index) => (
        <div key={c.label} className={`summary-card reveal delay-${index + 1} ${c.cls || ''}`}>
          <div className="summary-value">{c.value}</div>
          <div className="summary-label">{c.label}</div>
        </div>
      ))}
    </div>
  );
}
