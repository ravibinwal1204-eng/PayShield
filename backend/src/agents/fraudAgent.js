/**
 * fraudAgent.js
 *
 * BOUNDED RESPONSIBILITY (defense-only):
 *   CAN:    analyze transaction-level fraud signals, identify suspicious
 *           patterns, return a risk score + reasons/signals.
 *   CANNOT: execute payments, modify transactions, delete data, or
 *           approve/block anything. This module only returns data; it has
 *           no side effects and no access to money-movement APIs.
 *
 * Deterministic, rule-based, synchronous — no LLM involved, so its output
 * is reproducible and safe to use directly in offline evaluation.
 *
 * Input:
 *   {
 *     transaction: { amount, currency, location, deviceId, timestamp },
 *     merchant: { category, isHighRiskCategory, trustScore } | null,
 *     recentTransactions: [{ timestamp, userId }, ...]  // same user, last ~24h
 *   }
 *
 * Output: { riskScore, confidence, reasons: string[], signals: string[], citations: [] }
 */

function analyzeFraudRisk({ transaction, merchant = null, recentTransactions = [] }) {
  let score = 0;
  const reasons = [];
  const signals = [];

  const amount = Number(transaction?.amount) || 0;
  const ts = transaction?.timestamp ? new Date(transaction.timestamp) : new Date();

  // --- Amount ---
  if (amount >= 10000000) {
    score += 100;
    reasons.push('Transaction amount is at least 10,000,000 — extreme value requires immediate review');
    signals.push('EXTREME_VALUE_TRANSACTION');
  } else if (amount > 100000) {
    score += 40;
    reasons.push('Transaction amount exceeds 100,000 — very high value');
    signals.push('HIGH_VALUE_TRANSACTION');
  } else if (amount > 25000) {
    score += 20;
    reasons.push('Transaction amount exceeds 25,000 — elevated value');
    signals.push('ELEVATED_VALUE_TRANSACTION');
  }

  // --- Velocity: same user, last 10 minutes ---
  const windowMs = 10 * 60 * 1000;
  const recentCount = recentTransactions.filter((t) => {
    const tTime = new Date(t.timestamp).getTime();
    return !Number.isNaN(tTime) && Math.abs(ts.getTime() - tTime) <= windowMs;
  }).length;

  if (recentCount > 5) {
    score += 30;
    reasons.push(`${recentCount} transactions from this user within a 10-minute window`);
    signals.push('VELOCITY_ABUSE');
  } else if (recentCount >= 3) {
    score += 12;
    reasons.push(`${recentCount} transactions from this user within a 10-minute window`);
    signals.push('ELEVATED_VELOCITY');
  }

  // --- Time of day (1am-5am local to the transaction timestamp) ---
  const hour = ts.getHours();
  const isNightWindow = hour >= 1 && hour < 5;
  if (isNightWindow) {
    score += 12;
    reasons.push('Transaction occurred between 1:00 AM and 5:00 AM');
    signals.push('OFF_HOURS_TRANSACTION');
  }

  // --- Merchant ---
  if (merchant?.isHighRiskCategory) {
    score += 15;
    reasons.push(`Merchant category "${merchant.category}" is high-risk`);
    signals.push('HIGH_RISK_MERCHANT_CATEGORY');
  }
  if (!merchant) {
    score += 10;
    reasons.push('Merchant could not be identified for this transaction');
    signals.push('UNKNOWN_MERCHANT');
  }

  // --- Suspicious characteristics ---
  if (!transaction?.location || transaction.location === 'unknown') {
    score += 8;
    reasons.push('Transaction location is missing');
    signals.push('MISSING_LOCATION');
  }
  if (!transaction?.deviceId || transaction.deviceId === 'unknown') {
    score += 8;
    reasons.push('Transaction device identifier is missing');
    signals.push('MISSING_DEVICE_ID');
  }

  const riskScore = Math.max(0, Math.min(100, Math.round(score)));
  const confidence = Math.min(100, 60 + (recentTransactions.length > 0 ? 15 : 0) + (merchant ? 15 : 0));

  if (reasons.length === 0) {
    reasons.push('No fraud signals detected');
  }

  return { riskScore, confidence, reasons, signals, citations: [] };
}

module.exports = { analyzeFraudRisk };
