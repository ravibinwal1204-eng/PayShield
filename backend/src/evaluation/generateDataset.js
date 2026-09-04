/**
 * generateDataset.js
 *
 * Produces a reproducible synthetic dataset of fictional payment
 * transactions for offline evaluation. No real financial data. Uses a
 * fixed PRNG seed so the exact same dataset.json is produced every time
 * this script is run — that reproducibility is the point: thresholds must
 * not be tuned against a dataset that silently changes between runs.
 *
 * Run with:
 *   cd backend
 *   npm run generate-dataset
 *
 * Writes: backend/src/evaluation/dataset.json
 *
 * Each record has a `split` field ("dev" or "test"). The held-out test
 * split (20%) is what evaluationEngine.js scores — see README for why the
 * dev split is not used to tune the decision thresholds in this MVP.
 */

const fs = require('fs');
const path = require('path');
const { makeRng } = require('./seededRandom');

const SEED = 20260822; // fixed seed -> reproducible dataset
const CATEGORY_COUNTS = {
  legit: 80,
  high_value: 20,
  new_device: 20,
  location_anomaly: 20,
  unusual_time: 20,
  velocity: 20,
  multi_anomaly: 20,
  ambiguous: 20
};

const MERCHANT_CATEGORIES = ['retail', 'electronics', 'groceries', 'travel', 'crypto', 'gambling'];
const HIGH_RISK_CATEGORIES = new Set(['crypto', 'gambling']);
const LOCATIONS = ['Surat, IN', 'Mumbai, IN', 'Delhi, IN', 'Bengaluru, IN', 'Pune, IN', 'Unknown'];

function makeUser(rng, { young = false, flagged = false } = {}) {
  return {
    userId: `user_${rng.int(1000, 9999)}`,
    accountAgeDays: young ? rng.int(0, 6) : rng.int(30, 900),
    riskFlags: flagged ? Array.from({ length: rng.int(1, 3) }, () => 'prior_flag') : []
  };
}

function makeMerchant(rng, { highRisk = false } = {}) {
  const category = highRisk
    ? rng.pick(['crypto', 'gambling'])
    : rng.pick(MERCHANT_CATEGORIES.filter((c) => !HIGH_RISK_CATEGORIES.has(c)));
  return {
    merchantId: `merchant_${rng.int(100, 999)}`,
    category,
    isHighRiskCategory: HIGH_RISK_CATEGORIES.has(category),
    trustScore: highRisk ? rng.int(5, 35) : rng.int(50, 95)
  };
}

function baseTimestamp(rng, { nightHour = false } = {}) {
  const d = new Date();
  d.setDate(d.getDate() - rng.int(0, 30));
  d.setHours(nightHour ? rng.int(1, 4) : rng.int(6, 22), rng.int(0, 59), 0, 0);
  return d.toISOString();
}

function makeHistory(rng, count, { avgAmount = 1000, knownLocations = ['Surat, IN'], knownDevices = ['device_home'] } = {}) {
  return Array.from({ length: count }, () => ({
    amount: Math.max(50, Math.round(avgAmount * (0.7 + rng.next() * 0.6))),
    location: rng.pick(knownLocations),
    deviceId: rng.pick(knownDevices),
    timestamp: baseTimestamp(rng)
  }));
}

function buildRecord(rng, id, category) {
  const knownDevices = [`device_${rng.int(1000, 9999)}`];
  const knownLocations = [rng.pick(LOCATIONS.slice(0, 5))];
  const avgAmount = rng.int(500, 3000);

  const transaction = {
    amount: avgAmount,
    currency: 'INR',
    location: knownLocations[0],
    deviceId: knownDevices[0],
    timestamp: baseTimestamp(rng)
  };
  let user = makeUser(rng);
  let merchant = makeMerchant(rng);
  const userHistory = makeHistory(rng, rng.int(5, 15), { avgAmount, knownLocations, knownDevices });
  const deviceHistory = userHistory;
  let recentTransactions = userHistory.slice(0, rng.int(0, 2)); // low baseline velocity
  let groundTruthLabel = 'LEGIT';

  switch (category) {
    case 'legit': {
      break; // transaction stays close to the established baseline
    }
    case 'high_value': {
      transaction.amount = rng.pick([35000, 60000, 120000, 250000]);
      groundTruthLabel = 'RISK';
      break;
    }
    case 'new_device': {
      transaction.deviceId = `device_new_${rng.int(10000, 99999)}`;
      groundTruthLabel = 'RISK';
      break;
    }
    case 'location_anomaly': {
      transaction.location = rng.pick(LOCATIONS.filter((l) => !knownLocations.includes(l)));
      groundTruthLabel = 'RISK';
      break;
    }
    case 'unusual_time': {
      transaction.timestamp = baseTimestamp(rng, { nightHour: true });
      groundTruthLabel = 'RISK';
      break;
    }
    case 'velocity': {
      recentTransactions = Array.from({ length: rng.int(6, 9) }, () => ({
        amount: avgAmount,
        location: knownLocations[0],
        deviceId: knownDevices[0],
        timestamp: new Date(Date.now() - rng.int(0, 9) * 60 * 1000).toISOString()
      }));
      groundTruthLabel = 'RISK';
      break;
    }
    case 'multi_anomaly': {
      transaction.amount = rng.pick([50000, 90000, 150000]);
      transaction.deviceId = `device_new_${rng.int(10000, 99999)}`;
      transaction.location = rng.pick(LOCATIONS.filter((l) => !knownLocations.includes(l)));
      transaction.timestamp = baseTimestamp(rng, { nightHour: true });
      merchant = makeMerchant(rng, { highRisk: true });
      user = makeUser(rng, { young: true });
      groundTruthLabel = 'RISK';
      break;
    }
    case 'ambiguous': {
      // Mild, borderline signals — genuinely uncertain ground truth, so we
      // assign it via the seeded RNG rather than always calling it risk.
      transaction.amount = rng.int(26000, 40000);
      if (rng.bool(0.5)) transaction.deviceId = `device_new_${rng.int(10000, 99999)}`;
      groundTruthLabel = rng.bool(0.5) ? 'RISK' : 'LEGIT';
      break;
    }
    default:
      break;
  }

  return {
    id,
    category,
    groundTruthLabel,
    transaction,
    user,
    merchant,
    userHistory,
    deviceHistory,
    recentTransactions
  };
}

function generate() {
  const rng = makeRng(SEED);
  const records = [];
  let id = 1;

  for (const [category, count] of Object.entries(CATEGORY_COUNTS)) {
    for (let i = 0; i < count; i++) {
      records.push(buildRecord(rng, id++, category));
    }
  }

  // Deterministic shuffle (Fisher-Yates using the same seeded RNG) so the
  // dev/test split isn't just "all of category X in one split".
  for (let i = records.length - 1; i > 0; i--) {
    const j = Math.floor(rng.next() * (i + 1));
    [records[i], records[j]] = [records[j], records[i]];
  }

  const testSize = Math.round(records.length * 0.2);
  records.forEach((r, idx) => {
    r.split = idx < testSize ? 'test' : 'dev';
  });

  return records;
}

function main() {
  const records = generate();
  const outPath = path.join(__dirname, 'dataset.json');
  fs.writeFileSync(outPath, JSON.stringify(records, null, 2));

  const testCount = records.filter((r) => r.split === 'test').length;
  const devCount = records.length - testCount;
  console.log(`Generated ${records.length} records (seed=${SEED})`);
  console.log(`  dev (tuning):     ${devCount}`);
  console.log(`  test (held-out):  ${testCount}`);
  console.log(`Wrote ${outPath}`);
}

if (require.main === module) {
  main();
}

module.exports = { generate, SEED };
