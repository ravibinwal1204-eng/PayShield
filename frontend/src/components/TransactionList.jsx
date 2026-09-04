import React, { useState } from 'react';
import RiskBadge from './RiskBadge';
import RiskTimeline from './RiskTimeline';
import { getRiskByTransactionId, assessTransaction, getAuditTrail, submitReview } from '../services/api';

const FAILURE_DEMOS = [
  { key: 'VECTORDB_FAILURE', label: 'Simulate VectorDB Down' },
  { key: 'LLM_FAILURE', label: 'Simulate Gemini Down' },
  { key: 'RAG_NO_EVIDENCE', label: 'Simulate No Policy Evidence' }
];

export default function TransactionList({ transactions, loading, onAssessed }) {
  const [expandedId, setExpandedId] = useState(null);
  const [riskDetails, setRiskDetails] = useState({});
  const [auditTrails, setAuditTrails] = useState({});
  const [busyId, setBusyId] = useState(null);

  async function toggleExpand(transactionId) {
    if (expandedId === transactionId) {
      setExpandedId(null);
      return;
    }
    setExpandedId(transactionId);

    if (!riskDetails[transactionId]) {
      try {
        const result = await getRiskByTransactionId(transactionId);
        setRiskDetails((prev) => ({ ...prev, [transactionId]: result.data }));
      } catch (err) {
        setRiskDetails((prev) => ({ ...prev, [transactionId]: { error: err.message } }));
      }
    }
    loadAudit(transactionId);
  }

  async function runAssessment(transactionId, simulateFailure = null) {
    setBusyId(transactionId);
    try {
      const result = await assessTransaction(transactionId, simulateFailure);
      if (result.data?.error) {
        setRiskDetails((prev) => ({ ...prev, [transactionId]: { error: result.data.error } }));
      } else {
        const refreshed = await getRiskByTransactionId(transactionId);
        setRiskDetails((prev) => ({ ...prev, [transactionId]: refreshed.data }));
      }
      setExpandedId(transactionId);
      await loadAudit(transactionId);
      onAssessed?.();
    } catch (err) {
      setRiskDetails((prev) => ({ ...prev, [transactionId]: { error: err.message } }));
    } finally {
      setBusyId(null);
    }
  }

  async function loadAudit(transactionId) {
    try {
      const result = await getAuditTrail(transactionId);
      setAuditTrails((prev) => ({ ...prev, [transactionId]: result.data }));
    } catch (err) {
      setAuditTrails((prev) => ({ ...prev, [transactionId]: { error: err.message } }));
    }
  }

  async function handleReview(transactionId, decision) {
    setBusyId(transactionId);
    try {
      await submitReview({ transactionId, decision, reason: 'Reviewed via dashboard (demo-reviewer)' });
      const refreshed = await getRiskByTransactionId(transactionId);
      setRiskDetails((prev) => ({ ...prev, [transactionId]: refreshed.data }));
      await loadAudit(transactionId);
      onAssessed?.();
    } catch (err) {
      setRiskDetails((prev) => ({
        ...prev,
        [transactionId]: { ...prev[transactionId], reviewError: err.message }
      }));
    } finally {
      setBusyId(null);
    }
  }

  if (loading) return <div className="card">Loading transactions…</div>;

  if (!transactions.length) {
    return <div className="card">No transactions yet. Submit one above to get started.</div>;
  }

  const transactionsByUser = transactions.reduce((groups, transaction) => {
    const userId = transaction.userId || 'unknown_user';
    groups[userId] = groups[userId] || [];
    groups[userId].push(transaction);
    return groups;
  }, {});

  return (
    <div className="transactions-section">
      <div className="section-heading transactions-heading">
        <div><p className="eyebrow">CUSTOMER ACTIVITY</p><h2>Transactions by user</h2></div>
        <span className="section-count">{Object.keys(transactionsByUser).length} users · {transactions.length} transactions</span>
      </div>
      {Object.entries(transactionsByUser).map(([userId, userTransactions], index) => (
        <section className={`user-card reveal delay-${Math.min(index + 1, 5)}`} key={userId}>
          <header className="user-card-header">
            <div className="user-avatar">{userId.slice(0, 1).toUpperCase()}</div>
            <div>
              <p className="eyebrow">USER PROFILE</p>
              <h3>{userId}</h3>
            </div>
            <span className="user-transaction-count">{userTransactions.length} {userTransactions.length === 1 ? 'transaction' : 'transactions'}</span>
          </header>
          <table>
            <thead>
              <tr><th>Transaction ID</th><th>Merchant</th><th>Amount</th><th>Status</th><th></th></tr>
            </thead>
            <tbody>
              {userTransactions.map((txn) => (
                <React.Fragment key={txn.transactionId}>
                  <tr>
                    <td className="mono">{txn.transactionId}</td>
                    <td>{txn.merchantId}</td>
                    <td>{txn.amount} {txn.currency}</td>
                    <td><StatusIndicator status={txn.status} /></td>
                    <td className="row-actions">
                      <button className="link-btn" onClick={() => toggleExpand(txn.transactionId)}>
                        {expandedId === txn.transactionId ? 'Hide' : 'View Details'}
                      </button>
                    </td>
                  </tr>
                  {expandedId === txn.transactionId && (
                    <tr><td colSpan={5}>
                      <TransactionDetail
                        txn={txn}
                        detail={riskDetails[txn.transactionId]}
                        audit={auditTrails[txn.transactionId]}
                        onReview={(decision) => handleReview(txn.transactionId, decision)}
                        onSimulate={(kind) => runAssessment(txn.transactionId, kind)}
                        busy={busyId === txn.transactionId}
                      />
                    </td></tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </section>
      ))}
    </div>
  );
}

function TransactionDetail({ txn, detail, audit, onReview, onSimulate, busy }) {
  const auditEvents = Array.isArray(audit) ? audit : [];

  return (
    <div className="risk-detail">
      <div className="txn-fields-grid">
        <Field label="Transaction ID" value={txn.transactionId} mono />
        <Field label="Amount" value={`${txn.amount} ${txn.currency}`} />
        <Field label="Merchant" value={txn.merchantId} />
        <Field label="Location" value={txn.location} />
        <Field label="Device" value={txn.deviceId} />
        <Field label="Timestamp" value={new Date(txn.timestamp || txn.createdAt).toLocaleString()} />
      </div>

      {auditEvents.length > 0 && <RiskTimeline auditEvents={auditEvents} />}

      {!detail && <div>Loading the risk assessment details…</div>}

      {detail?.error && <div className="error-box">{detail.error}</div>}

      {detail && !detail.error && (
        <>
          <div className="risk-summary">
            <RiskBadge decision={detail.decision} />
            <span>
              Score: <strong>{detail.riskScore}</strong> / 100 ({detail.riskLevel})
            </span>
            {detail.state && <span className="state-pill">{detail.state}</span>}
            {detail.degraded && <span className="degraded-pill">DEGRADED — see reasons</span>}
          </div>

          <div className="risk-breakdown">
            <span>Fraud: {detail.fraudRisk}</span>
            <span>Behavior: {detail.behaviorRisk}</span>
            <span>Device: {detail.deviceRisk}</span>
            <span>Policy: {detail.policyRisk}</span>
          </div>

          {detail.reasons?.length > 0 && (
            <>
              <strong>Reasons:</strong>
              <ul className="reasons-list">
                {detail.reasons.map((reason, idx) => (
                  <li key={idx}>{reason}</li>
                ))}
              </ul>
            </>
          )}

          {detail.signals?.length > 0 && (
            <div className="signals-row">
              {detail.signals.map((s, idx) => (
                <span key={idx} className="signal-tag">
                  {s}
                </span>
              ))}
            </div>
          )}

          {detail.citations?.length > 0 && (
            <div className="citations-box">
              <strong>Policy evidence / citations:</strong>
              <ul className="reasons-list">
                {detail.citations.map((c, idx) => (
                  <li key={idx}>
                    {c.document} — {c.section || 'n/a'} (page {c.page || 'n/a'}, chunk #{c.chunkId})
                  </li>
                ))}
              </ul>
            </div>
          )}

          {detail.degraded && (
            <div className="degraded-notice">
              Risk analysis could not obtain reliable evidence ({detail.failureReason || 'see reasons above'}).
              The transaction is not silently approved — it was routed to review.
            </div>
          )}

          {(detail.state === 'REVIEW_REQUIRED' || detail.state === 'BLOCK_RECOMMENDED' || detail.decision === 'REVIEW' || detail.decision === 'BLOCK') && (
            <div className="review-actions">
              <strong>Human decision required:</strong>{' '}
              <button className="link-btn" disabled={busy} onClick={() => onReview('APPROVE')}>
                Approve
              </button>{' '}
              <button className="link-btn" disabled={busy} onClick={() => onReview('BLOCK')}>
                Block
              </button>
              {detail.reviewError && <div className="error-box">{detail.reviewError}</div>}
            </div>
          )}
        </>
      )}

      <div className="failure-demo-row">
        <span>Failure demo (controlled, no real outage needed):</span>
        {FAILURE_DEMOS.map((f) => (
          <button key={f.key} className="link-btn" disabled={busy} onClick={() => onSimulate(f.key)}>
            {f.label}
          </button>
        ))}
      </div>

    </div>
  );
}

function StatusIndicator({ status }) {
  const config = {
    APPROVED: { symbol: '✓', label: 'Approved', className: 'status-approved' },
    BLOCKED: { symbol: '×', label: 'Blocked', className: 'status-blocked' },
    REVIEW: { symbol: '!', label: 'Review required', className: 'status-review' }
  }[status] || { symbol: '?', label: status || 'Unknown', className: 'status-unknown' };

  return (
    <span className={`transaction-status ${config.className}`} title={config.label}>
      <span className="status-icon" aria-hidden="true">{config.symbol}</span>
      {status}
    </span>
  );
}

function Field({ label, value, mono }) {
  return (
    <div className="txn-field">
      <div className="txn-field-label">{label}</div>
      <div className={`txn-field-value ${mono ? 'mono' : ''}`}>{value ?? '—'}</div>
    </div>
  );
}
