/**
 * Phase 1 placeholder risk calculator.
 *
 * This is intentionally simple, deterministic, rule-based logic —
 * NOT AI/RAG. It exists so every transaction gets a RiskAssessment
 * record so the persistence + API layer can be fully tested end to end.
 *
 * This function will be replaced by the Gemini/Synapse RAG powered
 * risk engine in a later phase.
 */

function calculateRisk({ amount, location, deviceId, user, merchant }) {
  let fraudRisk = 0;
  let behaviorRisk = 0;
  let deviceRisk = 0;
  let policyRisk = 0;
  const reasons = [];
  const numericAmount = Number(amount) || 0;

  // --- Amount based signal ---
  if (numericAmount > 500000) {
    fraudRisk += 100;
    reasons.push('Transaction amount exceeds ₹5 lakh and is blocked by amount policy');
  } else if (numericAmount >= 100000) {
    fraudRisk += 40;
    reasons.push('Transaction amount exceeds ₹1 lakh and requires review');
  } else if (amount > 25000) {
    fraudRisk += 20;
    reasons.push('High transaction amount (> 25,000)');
  } else if (amount > 5000) {
    fraudRisk += 5;
  }

  // --- User account age signal ---
  if (user && user.accountAgeDays !== undefined) {
    if (user.accountAgeDays < 7) {
      behaviorRisk += 30;
      reasons.push('User account is less than 7 days old');
    } else if (user.accountAgeDays < 30) {
      behaviorRisk += 10;
      reasons.push('User account is less than 30 days old');
    }
  }

  if (user && user.riskFlags && user.riskFlags.length > 0) {
    behaviorRisk += 15 * user.riskFlags.length;
    reasons.push(`User has ${user.riskFlags.length} existing risk flag(s)`);
  }

  // --- Device signal ---
  if (!deviceId || deviceId === 'unknown') {
    deviceRisk += 20;
    reasons.push('Missing or unknown device identifier');
  }

  // --- Merchant / policy signal ---
  if (merchant) {
    if (merchant.isHighRiskCategory) {
      policyRisk += 25;
      reasons.push(`Merchant category "${merchant.category}" flagged as high risk`);
    }
    if (typeof merchant.trustScore === 'number' && merchant.trustScore < 30) {
      policyRisk += 20;
      reasons.push('Merchant trust score is low (< 30)');
    }
  } else {
    policyRisk += 10;
    reasons.push('Merchant not found in database');
  }

  // --- Location signal (simple placeholder) ---
  if (!location || location === 'unknown') {
    policyRisk += 10;
    reasons.push('Transaction location missing');
  }

  const riskScore = Math.min(
    100,
    Math.round(fraudRisk + behaviorRisk + deviceRisk + policyRisk)
  );

  let riskLevel = 'LOW';
  let decision = 'APPROVE';

  if (numericAmount > 500000) {
    riskLevel = 'HIGH';
    decision = 'BLOCK';
  } else if (numericAmount > 100000 && numericAmount <= 500000) {
    riskLevel = 'MEDIUM';
    decision = 'REVIEW';
  } else if (riskScore >= 70) {
    riskLevel = 'HIGH';
    decision = 'BLOCK';
  } else if (riskScore >= 35) {
    riskLevel = 'MEDIUM';
    decision = 'REVIEW';
  } else {
    riskLevel = 'LOW';
    decision = 'APPROVE';
    if (reasons.length === 0) {
      reasons.push('No risk signals detected');
    }
  }

  return {
    riskScore,
    riskLevel,
    decision,
    fraudRisk,
    behaviorRisk,
    deviceRisk,
    policyRisk,
    reasons,
    citations: [] // reserved for Synapse RAG citations in a future phase
  };
}

module.exports = { calculateRisk };
