/**
 * policyRiskProxy.js
 *
 * Evaluation-only. The real policyAgent.js calls Gemini + the live C++
 * VectorDB, which makes it slow, network-dependent, and non-deterministic
 * across runs — unsuitable for scoring a 200-record held-out test set
 * reproducibly. This module is a small deterministic, rule-based stand-in
 * for the "policy risk" component so the evaluation's decision engine call
 * has all four inputs it expects.
 *
 * This is NOT used anywhere in the live transaction path — only in
 * evaluationEngine.js. It intentionally mirrors a few rules from the demo
 * policy PDFs (large-amount and high-risk-category minimums) so the
 * synthetic scores are in a realistic range, but it is explicitly a proxy,
 * not the real RAG pipeline.
 */

function estimatePolicyRisk({ transaction, merchant }) {
  let score = 0;
  const amount = Number(transaction?.amount) || 0;

  if (amount > 100000) score += 40;
  else if (amount > 25000) score += 20;

  if (merchant?.isHighRiskCategory) score += 25;
  if (merchant && typeof merchant.trustScore === 'number' && merchant.trustScore < 30) score += 20;
  if (!merchant) score += 10;

  return Math.max(0, Math.min(100, score));
}

module.exports = { estimatePolicyRisk };
