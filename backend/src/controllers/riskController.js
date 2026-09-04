const RiskAssessment = require('../models/RiskAssessment');
const Transaction = require('../models/Transaction');
const { runRiskAssessment } = require('../services/riskOrchestrator');

// GET /api/risk/summary/stats
// Aggregate counts for the dashboard summary cards. Computed live from
// MongoDB on every request — nothing here is cached or hardcoded.
async function getRiskSummary(req, res, next) {
  try {
    const [total, approved, review, blocked, highRisk] = await Promise.all([
      Transaction.countDocuments(),
      RiskAssessment.countDocuments({ decision: 'APPROVE' }),
      RiskAssessment.countDocuments({ decision: 'REVIEW' }),
      RiskAssessment.countDocuments({ decision: 'BLOCK' }),
      RiskAssessment.countDocuments({ riskLevel: 'HIGH' })
    ]);

    return res.json({
      success: true,
      data: {
        totalTransactions: total,
        approved,
        reviewRequired: review,
        blockRecommended: blocked,
        highRisk
      }
    });
  } catch (err) {
    next(err);
  }
}

// GET /api/risk/:transactionId
async function getRiskByTransactionId(req, res, next) {
  try {
    const riskAssessment = await RiskAssessment.findOne({
      transactionId: req.params.transactionId
    });

    if (!riskAssessment) {
      return res.status(404).json({
        success: false,
        message: 'Risk assessment not found for this transaction'
      });
    }

    return res.json({ success: true, data: riskAssessment });
  } catch (err) {
    next(err);
  }
}

// POST /api/risk/assess
// body: { transactionId }
// Runs the full guardrail pipeline: agents -> Synapse RAG -> Gemini ->
// deterministic decision engine -> state machine -> audit trail.
// Never throws an unhandled error — orchestrator failures resolve to a
// structured { state: 'FAILED', error } response instead of a 500.
async function assessTransaction(req, res, next) {
  try {
    const { transactionId, simulateFailure } = req.body;
    if (!transactionId) {
      return res.status(400).json({ success: false, message: 'transactionId is required' });
    }

    const ALLOWED_SIMULATIONS = ['VECTORDB_FAILURE', 'LLM_FAILURE', 'RAG_NO_EVIDENCE'];
    const safeSimulateFailure = ALLOWED_SIMULATIONS.includes(simulateFailure) ? simulateFailure : null;

    const result = await runRiskAssessment(transactionId, { simulateFailure: safeSimulateFailure });

    if (result.error) {
      return res.status(422).json({ success: false, message: result.error, data: result });
    }

    return res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
}

module.exports = { getRiskByTransactionId, assessTransaction, getRiskSummary };
