const Review = require('../models/Review');
const Transaction = require('../models/Transaction');
const RiskAssessment = require('../models/RiskAssessment');
const { STATES, transition, InvalidStateTransitionError } = require('../risk/stateMachine');
const { logEvent } = require('../services/auditService');

// POST /api/review
// body: { transactionId, decision: 'APPROVE'|'BLOCK', reason?, reviewer? }
// No authentication in this MVP — reviewer defaults to "demo-reviewer".
// Performs an irreversible-action-safe handoff: the reviewer's decision is
// recorded and the state machine is advanced, but this endpoint does not
// itself move money or call any payment execution API.
async function submitReview(req, res, next) {
  try {
    const { transactionId, decision, reason = '', reviewer = 'demo-reviewer' } = req.body;

    if (!transactionId || !['APPROVE', 'BLOCK'].includes(decision)) {
      return res.status(400).json({
        success: false,
        message: 'transactionId and decision ("APPROVE" or "BLOCK") are required'
      });
    }

    const riskAssessment = await RiskAssessment.findOne({ transactionId });
    if (!riskAssessment) {
      return res.status(404).json({ success: false, message: 'No risk assessment found for this transaction' });
    }

    const currentState = riskAssessment.state || (
      riskAssessment.decision === 'BLOCK'
        ? STATES.BLOCK_RECOMMENDED
        : riskAssessment.decision === 'REVIEW'
          ? STATES.REVIEW_REQUIRED
          : riskAssessment.decision === 'APPROVE'
            ? STATES.APPROVED
            : null
    );
    if (![STATES.REVIEW_REQUIRED, STATES.BLOCK_RECOMMENDED].includes(currentState)) {
      return res.status(409).json({
        success: false,
        message: `Transaction is in state ${currentState}, which is not eligible for human review`
      });
    }

    const targetState = decision === 'APPROVE' ? STATES.APPROVED : STATES.BLOCK_RECOMMENDED;

    // If it's already BLOCK_RECOMMENDED and the reviewer confirms BLOCK,
    // that's not a state transition — just an audit record.
    let newState = currentState;
    if (targetState !== currentState) {
      try {
        newState = transition(currentState, targetState);
      } catch (err) {
        if (err instanceof InvalidStateTransitionError) {
          await logEvent(transactionId, 'INVALID_STATE_TRANSITION', {
            previousState: currentState,
            newState: targetState,
            reason: err.message,
            actor: reviewer
          });
        }
        return res.status(409).json({ success: false, message: err.message });
      }
    }

    const review = await Review.create({
      transactionId,
      riskAssessmentId: String(riskAssessment._id),
      decision,
      reason,
      reviewer
    });

    riskAssessment.state = newState;
    await riskAssessment.save();

    await Transaction.findOneAndUpdate(
      { transactionId },
      { status: decision === 'APPROVE' ? 'APPROVED' : 'BLOCKED' }
    );

    await logEvent(transactionId, decision === 'APPROVE' ? 'HUMAN_APPROVED' : 'HUMAN_BLOCKED', {
      previousState: currentState,
      newState,
      actor: reviewer,
      reason,
      metadata: { reviewId: review._id }
    });

    return res.status(201).json({ success: true, data: { review, state: newState } });
  } catch (err) {
    next(err);
  }
}

// GET /api/review/:transactionId
async function getReviews(req, res, next) {
  try {
    const reviews = await Review.find({ transactionId: req.params.transactionId }).sort({ timestamp: 1 });
    return res.json({ success: true, count: reviews.length, data: reviews });
  } catch (err) {
    next(err);
  }
}

module.exports = { submitReview, getReviews };
