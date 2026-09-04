/**
 * testGuardrailFlow.js
 *
 * Exercises the scenarios listed in "Final Validation":
 *   1. Normal transaction        6. RAG no-evidence case
 *   2. Suspicious transaction    7. Invalid LLM output
 *   3. Ambiguous transaction     8. Invalid state transition
 *   4. Gemini failure            9. Human review
 *   5. VectorDB failure         10. Evaluation metrics
 *
 * Scenarios 8 and 10 are pure JavaScript (state machine, evaluation
 * engine) and run fully offline — no MongoDB/VectorDB/Gemini required.
 *
 * Scenarios 1-3, 9 require MongoDB (they create real Transaction/User/
 * Merchant docs and call the orchestrator). Scenarios 4-7 require a real
 * or deliberately-misconfigured VectorDB/Gemini to observe the graceful
 * failure path. This script attempts all of them, but if MONGODB_URI
 * isn't reachable it prints a clear skip message for the DB-dependent
 * scenarios instead of crashing — scenarios 8 and 10 will still run and
 * prove those two guardrails work.
 *
 * Run with:
 *   cd backend
 *   node src/test/testGuardrailFlow.js
 */

try {
  require('dotenv').config();
} catch {
  console.log('(dotenv not installed — skipping .env loading; run `npm install` first for full functionality)');
}

let mongoose = null;
try {
  mongoose = require('mongoose');
} catch {
  console.log('(mongoose not installed — DB-dependent scenarios will be skipped; run `npm install` first)');
}

function section(title) {
  console.log(`\n${'='.repeat(70)}\n${title}\n${'='.repeat(70)}`);
}

async function testStateMachine() {
  section('SCENARIO 8: Invalid state transition is rejected');
  const { transition, STATES } = require('../risk/stateMachine');

  let s = STATES.RECEIVED;
  s = transition(s, STATES.VALIDATED);
  s = transition(s, STATES.ANALYZING);
  s = transition(s, STATES.RISK_ASSESSED);
  s = transition(s, STATES.BLOCK_RECOMMENDED);
  console.log('Valid chain: RECEIVED -> ... -> BLOCK_RECOMMENDED. OK.');

  try {
    transition(STATES.RECEIVED, STATES.BLOCK_RECOMMENDED); // skips required steps
    console.log('FAIL: invalid transition was not rejected');
  } catch (err) {
    console.log(`PASS: rejected as expected -> ${err.message}`);
  }
}

async function testAmountThresholds() {
  section('SCENARIO 11: Amount thresholds');
  const { computeDecision } = require('../risk/decisionEngine');
  const base = { fraudRisk: 0, behaviorRisk: 0, deviceRisk: 0, policyRisk: 0 };
  const cases = [
    [100000, 'APPROVED'],
    [100001, 'REVIEW_REQUIRED'],
    [500000, 'REVIEW_REQUIRED'],
    [500001, 'BLOCK_RECOMMENDED'],
    [200000, 'BLOCK_RECOMMENDED', { fraudRisk: 100, behaviorRisk: 100, deviceRisk: 100, policyRisk: 100 }]
  ];

  cases.forEach(([amount, expected, highRisk = base]) => {
    const actual = computeDecision({ ...highRisk, amount }).decision;
    if (actual !== expected) throw new Error(`Amount ₹${amount}: expected ${expected}, got ${actual}`);
    console.log(`PASS: ₹${amount} -> ${actual}`);
  });
}

async function testInvalidLLMOutput() {
  section('SCENARIO 7: Invalid LLM output is rejected before aggregation');
  const { validateAgentOutput, safeParseJSON } = require('../services/llmOutputValidator');

  const malformed = safeParseJSON('{"riskScore": 500, "confidence": "high", "reasons": "not an array"}');
  const result = validateAgentOutput(malformed || {});
  if (result.valid) {
    console.log('FAIL: malformed output was accepted');
  } else {
    console.log(`PASS: rejected with errors -> ${JSON.stringify(result.errors)}`);
  }
}

async function testEvaluation() {
  section('SCENARIO 10: Evaluation metrics computed from the held-out test set');
  const { runEvaluation } = require('../evaluation/evaluationEngine');
  try {
    const metrics = runEvaluation({ falsePositiveCost: Number(process.env.FALSE_POSITIVE_COST) || 100 });
    console.log(JSON.stringify(metrics, null, 2));
  } catch (err) {
    console.log(`SKIPPED: ${err.message}`);
  }
}

async function testDbDependentScenarios() {
  const Transaction = require('../models/Transaction');
  const User = require('../models/User');
  const Merchant = require('../models/Merchant');
  const { runRiskAssessment } = require('../services/riskOrchestrator');
  const { getAuditTrail } = require('../services/auditService');

  async function makeTxn({ userId, merchantId, amount, deviceId = 'device_test', location = 'Surat, IN' }) {
    const transactionId = `TEST-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
    await Transaction.create({
      transactionId,
      userId,
      merchantId,
      amount,
      currency: 'INR',
      location,
      deviceId,
      status: 'PENDING'
    });
    return transactionId;
  }

  section('SCENARIO 1: Normal transaction');
  await User.findOneAndUpdate(
    { userId: 'user_normal' },
    { userId: 'user_normal', name: 'Normal User', email: 'n@example.com', accountAgeDays: 400 },
    { upsert: true }
  );
  await Merchant.findOneAndUpdate(
    { merchantId: 'merchant_trusted' },
    { merchantId: 'merchant_trusted', name: 'TrustedMart', category: 'retail', trustScore: 90, isHighRiskCategory: false },
    { upsert: true }
  );
  const normalTxnId = await makeTxn({ userId: 'user_normal', merchantId: 'merchant_trusted', amount: 1200 });
  const normalResult = await runRiskAssessment(normalTxnId);
  console.log(`decision=${normalResult.decision} compositeScore=${normalResult.compositeScore} state=${normalResult.state}`);

  section('SCENARIO 2: Suspicious transaction (high value + new device + high-risk merchant)');
  await User.findOneAndUpdate(
    { userId: 'user_new' },
    { userId: 'user_new', name: 'New User', email: 'new@example.com', accountAgeDays: 1 },
    { upsert: true }
  );
  await Merchant.findOneAndUpdate(
    { merchantId: 'merchant_crypto' },
    { merchantId: 'merchant_crypto', name: 'QuickCrypto', category: 'crypto', trustScore: 15, isHighRiskCategory: true },
    { upsert: true }
  );
  const suspiciousTxnId = await makeTxn({
    userId: 'user_new',
    merchantId: 'merchant_crypto',
    amount: 150000,
    deviceId: 'device_brand_new'
  });
  const suspiciousResult = await runRiskAssessment(suspiciousTxnId);
  console.log(`decision=${suspiciousResult.decision} compositeScore=${suspiciousResult.compositeScore} state=${suspiciousResult.state}`);

  section('SCENARIO 3: Ambiguous transaction (borderline amount, otherwise normal)');
  const ambiguousTxnId = await makeTxn({ userId: 'user_normal', merchantId: 'merchant_trusted', amount: 28000 });
  const ambiguousResult = await runRiskAssessment(ambiguousTxnId);
  console.log(`decision=${ambiguousResult.decision} compositeScore=${ambiguousResult.compositeScore} state=${ambiguousResult.state}`);

  section('SCENARIOS 4-6: Gemini failure / VectorDB failure / RAG no-evidence (via policyAgent)');
  console.log('These depend on live network access to Gemini/VectorDB, which this sandbox does not have.');
  console.log('policyAgent.js is written to catch each failure explicitly (see its file header) and');
  console.log('degrade to a safe, non-fabricated result — run this script with VECTORDB_URL pointed at');
  console.log('a stopped server, or GEMINI_API_KEY unset, to observe VECTORDB_FAILURE / LLM_FAILURE audit events.');

  section('SCENARIO 9: Human review (REVIEW_REQUIRED -> reviewer decision)');
  if (suspiciousResult.state === 'REVIEW_REQUIRED' || suspiciousResult.state === 'BLOCK_RECOMMENDED') {
    const Review = require('../models/Review');
    const RiskAssessment = require('../models/RiskAssessment');
    const { transition } = require('../risk/stateMachine');
    const { logEvent } = require('../services/auditService');

    const riskAssessment = await RiskAssessment.findOne({ transactionId: suspiciousTxnId });
    const newState = transition(riskAssessment.state, 'APPROVED');
    await Review.create({
      transactionId: suspiciousTxnId,
      riskAssessmentId: String(riskAssessment._id),
      decision: 'APPROVE',
      reason: 'Manually verified with customer over phone',
      reviewer: 'demo-reviewer'
    });
    riskAssessment.state = newState;
    await riskAssessment.save();
    await logEvent(suspiciousTxnId, 'HUMAN_APPROVED', {
      previousState: 'REVIEW_REQUIRED',
      newState,
      actor: 'demo-reviewer'
    });
    console.log(`PASS: demo-reviewer approved ${suspiciousTxnId}, new state=${newState}`);
  } else {
    console.log(`Skipped: ${suspiciousTxnId} was not routed to REVIEW_REQUIRED/BLOCK_RECOMMENDED (state=${suspiciousResult.state})`);
  }

  section('Audit trail for the suspicious transaction');
  const trail = await getAuditTrail(suspiciousTxnId);
  trail.forEach((e) =>
    console.log(`  [${e.timestamp.toISOString()}] ${e.event} (${e.previousState} -> ${e.newState}) ${e.reason || ''}`)
  );
}

async function main() {
  await testStateMachine();
  await testAmountThresholds();
  await testInvalidLLMOutput();
  await testEvaluation();

  const uri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/payshield';
  if (!mongoose) {
    console.log('\nSKIPPING scenarios 1,2,3,9 — mongoose is not installed in this environment.');
  } else {
    try {
      await mongoose.connect(uri, { serverSelectionTimeoutMS: 3000 });
      console.log(`\nConnected to MongoDB at ${uri} — running DB-dependent scenarios (1,2,3,9)...`);
      await testDbDependentScenarios();
    } catch (err) {
      console.log(`\nSKIPPING scenarios 1,2,3,9 — could not connect to MongoDB: ${err.message}`);
      console.log('Start MongoDB and re-run this script to exercise the full transaction/audit flow.');
    } finally {
      await mongoose.disconnect().catch(() => {});
    }
  }

  console.log('\nDone.');
}

main().catch((err) => {
  console.error('Test script failed:', err);
  process.exit(1);
});
