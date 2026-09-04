/**
 * decisionEngine.js
 *
 * THE ONLY place in PayShield that computes a final decision. Every agent
 * (including the Gemini-backed policyAgent) only produces a 0-100 risk
 * score plus explanation — this module is what turns four scores into one
 * deterministic outcome, using a fixed formula and fixed thresholds. No
 * LLM call happens in this file.
 *
 * Weighted formula:
 *   riskScore = 0.35*fraudRisk + 0.30*behaviorRisk + 0.15*deviceRisk + 0.20*policyRisk
 *
 * Risk-score thresholds:
 *   0–30   -> APPROVED
 *   31–70  -> REVIEW_REQUIRED
 *   71–100 -> BLOCK_RECOMMENDED
 *
 * Amount policy is final when amount is available:
 *   <= 1 lakh       -> may proceed when the risk score is approved
 *   > 1 lakh–5 lakh -> at least REVIEW_REQUIRED
 *   > 5 lakh        -> BLOCK_RECOMMENDED
 */

const WEIGHTS = Object.freeze({
  fraud: 0.35,
  behavior: 0.3,
  device: 0.15,
  policy: 0.2
});

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

/**
 * computeDecision({ fraudRisk, behaviorRisk, deviceRisk, policyRisk, amount })
 * Returns { compositeScore, decision }.
 * Each input is expected to already be a validated 0-100 number — this
 * function does not validate LLM output itself (see llmOutputValidator).
 */
function computeDecision({ fraudRisk, behaviorRisk, deviceRisk, policyRisk, amount }) {
  const f = clamp(Number(fraudRisk) || 0, 0, 100);
  const b = clamp(Number(behaviorRisk) || 0, 0, 100);
  const d = clamp(Number(deviceRisk) || 0, 0, 100);
  const p = clamp(Number(policyRisk) || 0, 0, 100);

  const compositeScore = Math.round(
    WEIGHTS.fraud * f + WEIGHTS.behavior * b + WEIGHTS.device * d + WEIGHTS.policy * p
  );

  const numericAmount = Number(amount);
  let decision;
  if (Number.isFinite(numericAmount)) {
    if (compositeScore <= 30) decision = 'APPROVED';
    else if (compositeScore <= 70) decision = 'REVIEW_REQUIRED';
    else decision = 'BLOCK_RECOMMENDED';
    if (numericAmount > 500000) {
      decision = 'BLOCK_RECOMMENDED';
    } else if (numericAmount > 100000 && decision === 'APPROVED') {
      decision = 'REVIEW_REQUIRED';
    }
  } else if (compositeScore <= 30) {
    decision = 'APPROVED';
  } else if (compositeScore <= 70) {
    decision = 'REVIEW_REQUIRED';
  } else {
    decision = 'BLOCK_RECOMMENDED';
  }

  return { compositeScore, decision, weights: WEIGHTS };
}

module.exports = { computeDecision, WEIGHTS };
