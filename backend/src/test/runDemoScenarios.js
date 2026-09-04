/**
 * runDemoScenarios.js
 *
 * Creates three demo transactions (Scenario A/B/C from the final spec) and
 * runs each through the ACTUAL guardrail pipeline (riskOrchestrator.js —
 * same code path as POST /api/risk/assess and the Razorpay webhook). The
 * decision for each is whatever the real deterministic decision engine
 * computes — nothing here is hardcoded to "look right".
 *
 * Requires a running MongoDB (set MONGODB_URI in backend/.env) and,
 * ideally, the C++ VectorDB + GEMINI_API_KEY for full-fidelity results —
 * if either of those is unavailable, the policyAgent degrades gracefully
 * (see policyAgent.js) and the scenario still completes, just with a
 * `degraded: true` policy component.
 *
 * Run with:
 *   cd backend
 *   npm run demo-scenarios
 */

require('dotenv').config();
const mongoose = require('mongoose');
const Transaction = require('../models/Transaction');
const User = require('../models/User');
const Merchant = require('../models/Merchant');
const { runRiskAssessment } = require('../services/riskOrchestrator');

async function upsertUser(userId, fields) {
  await User.findOneAndUpdate({ userId }, { userId, ...fields }, { upsert: true });
}
async function upsertMerchant(merchantId, fields) {
  await Merchant.findOneAndUpdate({ merchantId }, { merchantId, ...fields }, { upsert: true });
}
async function createTxn(fields) {
  const transactionId = `DEMO-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
  await Transaction.create({ transactionId, status: 'PENDING', ...fields });
  return transactionId;
}

async function runScenario(label, expectedHint, setup) {
  console.log(`\n${'='.repeat(70)}\nScenario ${label} — expected (informational only): ${expectedHint}\n${'='.repeat(70)}`);
  const transactionId = await setup();
  const result = await runRiskAssessment(transactionId);
  console.log(`transactionId=${transactionId}`);
  console.log(`compositeScore=${result.compositeScore}  decision=${result.decision}  state=${result.state}  degraded=${result.degraded}`);
  if (result.error) console.log(`error=${result.error}`);
  return result;
}

async function main() {
  const uri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/payshield';
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 5000 });
  console.log(`Connected to MongoDB at ${uri}`);

  await upsertUser('demo_user_a', { name: 'Regular User', email: 'a@example.com', accountAgeDays: 500 });
  await upsertMerchant('demo_merchant_a', { name: 'TrustedMart', category: 'retail', trustScore: 90, isHighRiskCategory: false });

  await upsertUser('demo_user_b', { name: 'Brand New User', email: 'b@example.com', accountAgeDays: 0, riskFlags: ['prior_chargeback'] });
  await upsertMerchant('demo_merchant_b', { name: 'QuickCrypto', category: 'crypto', trustScore: 10, isHighRiskCategory: true });

  // Scenario A: Normal — low value, trusted merchant, old account, known device
  await runScenario('A (Normal)', 'LOW RISK / APPROVED', () =>
    createTxn({
      userId: 'demo_user_a',
      merchantId: 'demo_merchant_a',
      amount: 1500,
      currency: 'INR',
      location: 'Surat, IN',
      deviceId: 'device_a_known'
    })
  );

  // Scenario B: Suspicious — high value, new device, high-risk merchant, brand-new flagged account
  await runScenario('B (Suspicious)', 'HIGH RISK / BLOCK_RECOMMENDED / HUMAN REVIEW', () =>
    createTxn({
      userId: 'demo_user_b',
      merchantId: 'demo_merchant_b',
      amount: 180000,
      currency: 'INR',
      location: 'Unknown',
      deviceId: 'device_b_brand_new'
    })
  );

  // Scenario C: Ambiguous — borderline amount, otherwise normal profile
  await runScenario('C (Ambiguous)', 'MEDIUM RISK / REVIEW_REQUIRED', () =>
    createTxn({
      userId: 'demo_user_a',
      merchantId: 'demo_merchant_a',
      amount: 29000,
      currency: 'INR',
      location: 'Surat, IN',
      deviceId: 'device_a_known'
    })
  );

  await mongoose.disconnect();
  console.log('\nDone. Results above are from the real decision engine, not hardcoded.');
}

main().catch((err) => {
  console.error('Demo scenarios failed:', err.message);
  console.error('Make sure MongoDB is running and MONGODB_URI is set in backend/.env');
  process.exit(1);
});
