/**
 * evaluationEngine.js
 *
 * Runs the ACTUAL deterministic agents (fraudAgent, behaviorAgent,
 * deviceAgent) and the ACTUAL decisionEngine against the held-out TEST
 * split of the synthetic dataset, then computes a confusion matrix and
 * standard metrics from those results. Nothing here is hardcoded — every
 * number in the response is derived from running the real code against
 * the dataset at request time.
 *
 * Why not call the real policyAgent (Gemini + RAG) here? That agent is
 * network-dependent and non-deterministic, which would make held-out
 * evaluation results change between runs and depend on an API key/live
 * VectorDB being available. For reproducible evaluation we substitute the
 * deterministic policyRiskProxy (see that file's header comment) — this is
 * a documented limitation, not a hidden one.
 *
 * Binary classification framing (per the confusion matrix requested):
 *   Predicted "Risk"  = decisionEngine says REVIEW_REQUIRED or BLOCK_RECOMMENDED
 *   Predicted "Legit" = decisionEngine says APPROVED
 *   Actual label comes from the dataset's groundTruthLabel ("RISK"/"LEGIT")
 */

const fs = require('fs');
const path = require('path');

const { analyzeFraudRisk } = require('../agents/fraudAgent');
const { analyzeBehaviorRisk } = require('../agents/behaviorAgent');
const { analyzeDeviceRisk } = require('../agents/deviceAgent');
const { computeDecision } = require('../risk/decisionEngine');
const { estimatePolicyRisk } = require('./policyRiskProxy');

const DATASET_PATH = path.join(__dirname, 'dataset.json');

function loadDataset() {
  if (!fs.existsSync(DATASET_PATH)) {
    throw new Error('dataset.json not found. Run `npm run generate-dataset` in backend/ first.');
  }
  return JSON.parse(fs.readFileSync(DATASET_PATH, 'utf-8'));
}

function classify(record) {
  const { transaction, user, merchant, userHistory, deviceHistory, recentTransactions } = record;

  const fraud = analyzeFraudRisk({ transaction, merchant, recentTransactions });
  const behavior = analyzeBehaviorRisk({ transaction, user, userHistory });
  const device = analyzeDeviceRisk({ transaction, deviceHistory });
  const policyRisk = estimatePolicyRisk({ transaction, merchant });

  const { compositeScore, decision } = computeDecision({
    fraudRisk: fraud.riskScore,
    behaviorRisk: behavior.riskScore,
    deviceRisk: device.riskScore,
    policyRisk,
    amount: transaction.amount
  });

  const predictedLabel = decision === 'APPROVED' ? 'LEGIT' : 'RISK';
  return { compositeScore, decision, predictedLabel };
}

/**
 * runEvaluation({ falsePositiveCost })
 * Returns the full metrics object described in the API spec.
 */
function runEvaluation({ falsePositiveCost = 100 } = {}) {
  const dataset = loadDataset();
  const testSet = dataset.filter((r) => r.split === 'test');

  let truePositives = 0;
  let trueNegatives = 0;
  let falsePositives = 0;
  let falseNegatives = 0;

  const results = testSet.map((record) => {
    const { predictedLabel, compositeScore, decision } = classify(record);
    const actual = record.groundTruthLabel;

    if (predictedLabel === 'RISK' && actual === 'RISK') truePositives++;
    else if (predictedLabel === 'LEGIT' && actual === 'LEGIT') trueNegatives++;
    else if (predictedLabel === 'RISK' && actual === 'LEGIT') falsePositives++;
    else if (predictedLabel === 'LEGIT' && actual === 'RISK') falseNegatives++;

    return { id: record.id, category: record.category, actual, predictedLabel, compositeScore, decision };
  });

  const precision = truePositives + falsePositives > 0 ? truePositives / (truePositives + falsePositives) : 0;
  const recall = truePositives + falseNegatives > 0 ? truePositives / (truePositives + falseNegatives) : 0;
  const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;
  const falsePositiveRate =
    falsePositives + trueNegatives > 0 ? falsePositives / (falsePositives + trueNegatives) : 0;
  const cost = falsePositives * falsePositiveCost;

  return {
    datasetSize: dataset.length,
    testSetSize: testSet.length,
    precision: round(precision),
    recall: round(recall),
    f1: round(f1),
    falsePositiveRate: round(falsePositiveRate),
    truePositives,
    trueNegatives,
    falsePositives,
    falseNegatives,
    falsePositiveCost: cost,
    falsePositiveCostAssumption: falsePositiveCost,
    falsePositiveCostLabel: 'Demo business cost assumption — not a real Razorpay or industry figure',
    confusionMatrix: {
      actualLegit: { predictedLegit: trueNegatives, predictedRisk: falsePositives },
      actualRisk: { predictedLegit: falseNegatives, predictedRisk: truePositives }
    },
    perCategoryBreakdown: summarizeByCategory(results)
  };
}

function summarizeByCategory(results) {
  const byCat = {};
  for (const r of results) {
    byCat[r.category] = byCat[r.category] || { count: 0, predictedRisk: 0 };
    byCat[r.category].count++;
    if (r.predictedLabel === 'RISK') byCat[r.category].predictedRisk++;
  }
  return byCat;
}

function round(n) {
  return Math.round(n * 10000) / 10000;
}

module.exports = { runEvaluation, classify };
