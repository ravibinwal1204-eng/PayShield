import React, { useEffect, useState } from 'react';
import { getTransactions } from '../services/api';

const THRESHOLDS = [
  { label: 'Approve', range: '0–30', copy: 'Low combined risk. The transaction can continue.', className: 'threshold-approve' },
  { label: 'Review required', range: '31–70', copy: 'Unclear or elevated risk. A human must review it.', className: 'threshold-review' },
  { label: 'Block recommended', range: '71–100', copy: 'High risk. Hold the transaction for human action.', className: 'threshold-block' }
];

const WORKFLOW = [
  ['01', 'Intake', 'Transaction and identity context enter the system.'],
  ['02', 'Four signals', 'Fraud, behavior, device, and policy agents score risk.'],
  ['03', 'Decision engine', 'A fixed weighted formula creates one score.'],
  ['04', 'Human review', 'Review and block recommendations wait for an operator.']
];

export default function EvaluationPage() {
  const [transactions, setTransactions] = useState([]);
  const [error, setError] = useState(null);

  useEffect(() => {
    getTransactions()
      .then((result) => setTransactions(result.data || []))
      .catch((err) => setError(err.message));
  }, []);

  const users = Object.entries(
    transactions.reduce((groups, transaction) => {
      const userId = transaction.userId || 'unknown_user';
      groups[userId] = groups[userId] || [];
      groups[userId].push(transaction);
      return groups;
    }, {})
  );

  return (
    <main className="page-shell intelligence-page">
      <header className="dashboard-header intelligence-header">
        <div>
          <p className="eyebrow">RISK INTELLIGENCE / OPERATING MODEL</p>
          <h1>Understand the<br /><span>decision path.</span></h1>
          <p className="subtitle">A practical view of how PayShield turns transaction context into a reviewable recommendation.</p>
        </div>
        <div className="intelligence-summary"><strong>{transactions.length}</strong><span>live transactions<br />being observed</span></div>
      </header>

      <section className="card intelligence-section reveal">
        <div className="section-heading"><div><p className="eyebrow">DECISION LOGIC</p><h2>Risk thresholds</h2></div><span className="section-count">fixed / deterministic</span></div>
        <p className="section-intro">The final score is a weighted combination of four bounded signals. Thresholds are applied after scoring and are independent of Gemini.</p>
        <div className="threshold-grid">
          {THRESHOLDS.map((threshold) => <article className={`threshold-card ${threshold.className}`} key={threshold.label}><span className="threshold-range">{threshold.range}</span><h3>{threshold.label}</h3><p>{threshold.copy}</p></article>)}
        </div>
        <div className="formula-bar"><span>FINAL SCORE</span><strong>35% fraud + 30% behavior + 15% device + 20% policy</strong></div>
      </section>

      <section className="card intelligence-section reveal delay-1">
        <div className="section-heading"><div><p className="eyebrow">CONTROL FLOW</p><h2>From payment to decision</h2></div></div>
        <div className="workflow-grid">
          {WORKFLOW.map(([number, title, copy]) => <article className="workflow-step" key={number}><span>{number}</span><h3>{title}</h3><p>{copy}</p></article>)}
        </div>
      </section>

      <section className="intelligence-section user-pattern-section reveal delay-2">
        <div className="section-heading"><div><p className="eyebrow">LIVE BEHAVIOR MAP</p><h2>User transaction patterns</h2></div><span className="section-count">amount movement / decision state</span></div>
        {error && <div className="error-box">Could not load live transactions: {error}</div>}
        {!error && users.length === 0 && <div className="empty-pattern">No live users yet. Create a transaction in Transactions to see its pattern here.</div>}
        <div className="pattern-grid">
          {users.map(([userId, userTransactions]) => <UserPattern key={userId} userId={userId} transactions={userTransactions} />)}
        </div>
      </section>
    </main>
  );
}

function UserPattern({ userId, transactions }) {
  const amounts = transactions.map((transaction) => Number(transaction.amount) || 0);
  const maxAmount = Math.max(...amounts, 1);

  return (
    <article className="pattern-card">
      <header className="pattern-card-header"><div className="user-avatar">{userId.slice(0, 1).toUpperCase()}</div><div><p className="eyebrow">USER PATTERN</p><h3>{userId}</h3></div><span className="user-transaction-count">{transactions.length} {transactions.length === 1 ? 'transaction' : 'transactions'}</span></header>
      <div className="pattern-chart" aria-label={`Transaction amount pattern for ${userId}`}>
        <div className="chart-axis"><span>AMOUNT</span><span>₹{formatAmount(maxAmount)}</span></div>
        <div className="pattern-line" />
        {transactions.map((transaction, index) => {
          const amount = Number(transaction.amount) || 0;
          const status = transaction.status || 'PENDING';
          return <div className="pattern-event" key={transaction.transactionId}><div className="event-index">{String(index + 1).padStart(2, '0')}</div><div className="event-bar-wrap"><div className={`event-bar ${status.toLowerCase()}`} style={{ width: `${Math.max(7, (amount / maxAmount) * 100)}%` }} /></div><div className="event-amount">₹{formatAmount(amount)}</div><div className={`event-status ${status.toLowerCase()}`}>{status}</div></div>;
        })}
      </div>
    </article>
  );
}

function formatAmount(amount) {
  return new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(amount);
}
