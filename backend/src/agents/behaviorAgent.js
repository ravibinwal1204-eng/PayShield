/**
 * behaviorAgent.js
 *
 * BOUNDED RESPONSIBILITY (defense-only):
 *   CAN:    analyze the user's historical transaction behavior and flag
 *           anomalies (amount, location, time-of-day, frequency).
 *   CANNOT: execute financial actions of any kind. Read-only over the
 *           history it's given; returns data only.
 *
 * Deterministic, rule-based, synchronous — no LLM involved.
 *
 * Input:
 *   {
 *     transaction: { amount, location, timestamp },
 *     user: { accountAgeDays, riskFlags } | null,
 *     userHistory: [{ amount, location, timestamp }, ...]  // prior transactions
 *   }
 *
 * Output: { riskScore, confidence, reasons: string[], signals: string[], citations: [] }
 */

function analyzeBehaviorRisk({ transaction, user = null, userHistory = [] }) {
  let score = 0;
  const reasons = [];
  const signals = [];

  const amount = Number(transaction?.amount) || 0;

  // --- New / young account ---
  if (user) {
    if (typeof user.accountAgeDays === 'number') {
      if (user.accountAgeDays < 7) {
        score += 30;
        reasons.push('Account is less than 7 days old');
        signals.push('NEW_ACCOUNT');
      } else if (user.accountAgeDays < 30) {
        score += 10;
        reasons.push('Account is less than 30 days old');
        signals.push('RECENT_ACCOUNT');
      }
    }
    if (Array.isArray(user.riskFlags) && user.riskFlags.length > 0) {
      const flagScore = Math.min(60, user.riskFlags.length * 15);
      score += flagScore;
      reasons.push(`User has ${user.riskFlags.length} unresolved risk flag(s)`);
      signals.push('EXISTING_RISK_FLAGS');
    }
  } else {
    score += 15;
    reasons.push('No user profile found — cannot establish behavioral baseline');
    signals.push('UNKNOWN_USER');
  }

  // --- No history at all ---
  if (userHistory.length === 0) {
    score += 15;
    reasons.push('No transaction history available for this user');
    signals.push('NO_HISTORY');
  } else {
    // --- Amount deviation from historical average ---
    const avgAmount =
      userHistory.reduce((sum, t) => sum + (Number(t.amount) || 0), 0) / userHistory.length;

    if (avgAmount > 0) {
      const ratio = amount / avgAmount;
      if (ratio >= 5) {
        score += 60;
        reasons.push(`Amount is ${ratio.toFixed(1)}x the user's historical average`);
        signals.push('AMOUNT_ANOMALY_SEVERE');
      } else if (ratio >= 3) {
        score += 15;
        reasons.push(`Amount is ${ratio.toFixed(1)}x the user's historical average`);
        signals.push('AMOUNT_ANOMALY');
      }
    }

    // --- Location behavior ---
    const knownLocations = new Set(userHistory.map((t) => t.location).filter(Boolean));
    if (transaction?.location && knownLocations.size > 0 && !knownLocations.has(transaction.location)) {
      score += 15;
      reasons.push(`Location "${transaction.location}" has not been seen before for this user`);
      signals.push('NEW_LOCATION');
    }

    // --- Frequency: transactions per day historically vs today ---
    const dayCounts = new Map();
    for (const t of userHistory) {
      const day = new Date(t.timestamp).toDateString();
      dayCounts.set(day, (dayCounts.get(day) || 0) + 1);
    }
    const avgPerDay =
      dayCounts.size > 0
        ? [...dayCounts.values()].reduce((a, b) => a + b, 0) / dayCounts.size
        : 0;
    const todayKey = new Date(transaction?.timestamp || Date.now()).toDateString();
    const todayCount = (dayCounts.get(todayKey) || 0) + 1; // +1 for this transaction
    if (avgPerDay > 0 && todayCount > avgPerDay * 3) {
      score += 12;
      reasons.push(`${todayCount} transactions today vs a historical average of ${avgPerDay.toFixed(1)}/day`);
      signals.push('FREQUENCY_ANOMALY');
    }
  }

  const riskScore = Math.max(0, Math.min(100, Math.round(score)));
  const confidence = Math.min(100, 50 + (userHistory.length > 0 ? 30 : 0) + (user ? 10 : 0));

  if (reasons.length === 0) {
    reasons.push('No behavioral anomalies detected');
  }

  return { riskScore, confidence, reasons, signals, citations: [] };
}

module.exports = { analyzeBehaviorRisk };
