/**
 * riskOrchestrator.js
 *
 * Ties together the existing pieces without reimplementing any of them:
 *   Transaction (Mongo) -> 4 bounded agents -> deterministic decisionEngine
 *   -> stateMachine -> AuditLog -> RiskAssessment (Mongo)
 *
 * This is the only module that:
 *   - drives state transitions for a transaction's risk lifecycle
 *   - decides whether a degraded agent should force a safety floor of
 *     REVIEW_REQUIRED even when the numeric formula would say APPROVED
 *   - persists the final RiskAssessment
 *
 * It never lets an unexpected error crash the process — every path either
 * returns a structured result or moves the transaction to FAILED with an
 * audit record explaining why.
 */

const Transaction = require('../models/Transaction');
const User = require('../models/User');
const Merchant = require('../models/Merchant');
const RiskAssessment = require('../models/RiskAssessment');

const { analyzeFraudRisk } = require('../agents/fraudAgent');
const { analyzeBehaviorRisk } = require('../agents/behaviorAgent');
const { analyzeDeviceRisk } = require('../agents/deviceAgent');
const { analyzePolicyRisk } = require('../agents/policyAgent');

const { computeDecision } = require('../risk/decisionEngine');
const { STATES, transition, InvalidStateTransitionError } = require('../risk/stateMachine');
const { logEvent } = require('./auditService');

const DECISION_TO_STORED = {
  APPROVED: 'APPROVE',
  REVIEW_REQUIRED: 'REVIEW',
  BLOCK_RECOMMENDED: 'BLOCK'
};

const DECISION_TO_TXN_STATUS = {
  APPROVED: 'APPROVED',
  REVIEW_REQUIRED: 'REVIEW',
  BLOCK_RECOMMENDED: 'BLOCKED'
};

/** Wraps stateMachine.transition to also audit-log invalid attempts. */
async function safeTransition(transactionId, from, to) {
  try {
    return transition(from, to);
  } catch (err) {
    if (err instanceof InvalidStateTransitionError) {
      await logEvent(transactionId, 'INVALID_STATE_TRANSITION', {
        previousState: from,
        newState: to,
        reason: err.message
      });
    }
    throw err;
  }
}

/**
 * runRiskAssessment(transactionId)
 * Runs the full guardrail pipeline for one already-created transaction and
 * returns a structured result. Never throws — failures resolve to a FAILED
 * state and an explanatory `error` field.
 */
async function runRiskAssessment(transactionId, options = {}) {
  const { simulateFailure = null } = options;
  let state = STATES.RECEIVED;
  await logEvent(transactionId, 'TRANSACTION_RECEIVED', { newState: state, actor: 'system' });

  try {
    const transaction = await Transaction.findOne({ transactionId });
    if (!transaction) {
      throw new Error(`Transaction ${transactionId} not found`);
    }

    state = await safeTransition(transactionId, state, STATES.VALIDATED);
    await logEvent(transactionId, 'TRANSACTION_VALIDATED', {
      previousState: STATES.RECEIVED,
      newState: state
    });

    state = await safeTransition(transactionId, state, STATES.ANALYZING);
    await logEvent(transactionId, 'RISK_ANALYSIS_STARTED', {
      previousState: STATES.VALIDATED,
      newState: state
    });

    const [user, merchant] = await Promise.all([
      User.findOne({ userId: transaction.userId }).lean(),
      Merchant.findOne({ merchantId: transaction.merchantId }).lean()
    ]);

    // Simple recency window used as a stand-in for full historical profiles
    // (see README "Remaining issues" — a production system would use a
    // longer/richer behavioral baseline than the last 24h).
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const recentTransactions = await Transaction.find({
      userId: transaction.userId,
      transactionId: { $ne: transactionId },
      createdAt: { $gte: since }
    }).lean();

    // --- Bounded agents: fraud, behavior, device (deterministic, synchronous) ---
    const fraudResult = analyzeFraudRisk({ transaction, merchant, recentTransactions });
    await logEvent(transactionId, 'AGENT_COMPLETED', {
      metadata: { agent: 'fraudAgent', riskScore: fraudResult.riskScore, confidence: fraudResult.confidence }
    });

    const behaviorResult = analyzeBehaviorRisk({ transaction, user, userHistory: recentTransactions });
    await logEvent(transactionId, 'AGENT_COMPLETED', {
      metadata: { agent: 'behaviorAgent', riskScore: behaviorResult.riskScore, confidence: behaviorResult.confidence }
    });

    const deviceResult = analyzeDeviceRisk({ transaction, deviceHistory: recentTransactions });
    await logEvent(transactionId, 'AGENT_COMPLETED', {
      metadata: { agent: 'deviceAgent', riskScore: deviceResult.riskScore, confidence: deviceResult.confidence }
    });

    // --- Bounded agent: policy (RAG + Gemini, async, may degrade gracefully) ---
    const policyResult = await analyzePolicyRisk({
      transaction,
      merchant,
      logEvent: (event, metadata) => logEvent(transactionId, event, { metadata }),
      simulateFailure
    });
    await logEvent(transactionId, 'AGENT_COMPLETED', {
      metadata: {
        agent: 'policyAgent',
        riskScore: policyResult.riskScore,
        confidence: policyResult.confidence,
        degraded: policyResult.degraded,
        failureReason: policyResult.failureReason
      }
    });

    state = await safeTransition(transactionId, state, STATES.RISK_ASSESSED);

    let { compositeScore, decision, weights } = computeDecision({
      fraudRisk: fraudResult.riskScore,
      behaviorRisk: behaviorResult.riskScore,
      deviceRisk: deviceResult.riskScore,
      policyRisk: policyResult.riskScore,
      amount: transaction.amount
    });

    await logEvent(transactionId, 'RISK_ASSESSED', {
      previousState: STATES.ANALYZING,
      newState: state,
      metadata: { compositeScore, decision, weights }
    });

    // Safety floor: a degraded agent (VectorDB down, Gemini down, invalid
    // LLM output, or no policy evidence) must never silently result in a
    // clean APPROVE — force at least REVIEW_REQUIRED so a human looks at it.
    const degraded = policyResult.degraded === true;
    let finalDecision = decision;
    if (degraded && decision === 'APPROVED') {
      finalDecision = 'REVIEW_REQUIRED';
    }

    state = await safeTransition(transactionId, state, finalDecision);

    if (finalDecision === 'REVIEW_REQUIRED') {
      await logEvent(transactionId, 'REVIEW_REQUIRED', {
        previousState: STATES.RISK_ASSESSED,
        newState: state,
        reason: degraded
          ? `Forced to review: ${policyResult.failureReason}`
          : 'Composite score fell in the review range'
      });
    } else if (finalDecision === 'BLOCK_RECOMMENDED') {
      await logEvent(transactionId, 'BLOCK_RECOMMENDED', {
        previousState: STATES.RISK_ASSESSED,
        newState: state,
        reason: 'Composite score fell in the block range'
      });
    }

    const reasons = [...fraudResult.reasons, ...behaviorResult.reasons, ...deviceResult.reasons, ...policyResult.reasons];
    const signals = [...fraudResult.signals, ...behaviorResult.signals, ...deviceResult.signals, ...policyResult.signals];

    const confidence = Math.round(
      (fraudResult.confidence + behaviorResult.confidence + deviceResult.confidence + policyResult.confidence) / 4
    );
    const analysisStatus = degraded ? 'DEGRADED' : 'COMPLETE';

    const riskAssessment = await RiskAssessment.findOneAndUpdate(
      { transactionId },
      {
        transactionId,
        riskScore: compositeScore,
        riskLevel: compositeScore <= 30 ? 'LOW' : compositeScore <= 70 ? 'MEDIUM' : 'HIGH',
        decision: DECISION_TO_STORED[finalDecision],
        fraudRisk: fraudResult.riskScore,
        behaviorRisk: behaviorResult.riskScore,
        deviceRisk: deviceResult.riskScore,
        policyRisk: policyResult.riskScore,
        reasons,
        signals,
        citations: policyResult.citations,
        state,
        degraded,
        confidence,
        analysisStatus
      },
      { upsert: true, new: true }
    );

    transaction.status = DECISION_TO_TXN_STATUS[finalDecision];
    await transaction.save();

    return {
      transactionId,
      state,
      compositeScore,
      decision: finalDecision,
      degraded,
      agents: {
        fraud: fraudResult,
        behavior: behaviorResult,
        device: deviceResult,
        policy: policyResult
      },
      riskAssessment
    };
  } catch (err) {
    let failedState = state;
    try {
      failedState = await safeTransition(transactionId, state, STATES.FAILED);
    } catch {
      // FAILED isn't reachable from the current state (e.g. already terminal) —
      // keep the last known state rather than crash.
    }
    await logEvent(transactionId, 'RISK_ANALYSIS_FAILED', {
      previousState: state,
      newState: failedState,
      reason: err.message
    });
    return { transactionId, state: failedState, decision: null, error: err.message };
  }
}

module.exports = { runRiskAssessment };
