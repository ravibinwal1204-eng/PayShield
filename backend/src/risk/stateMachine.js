/**
 * stateMachine.js
 *
 * A small, dependency-free state machine for the risk assessment lifecycle.
 * No LangGraph, no agent framework — just a transition table and a
 * function that throws on invalid transitions.
 *
 * States: RECEIVED, VALIDATED, ANALYZING, RISK_ASSESSED, REVIEW_REQUIRED,
 *         APPROVED, BLOCK_RECOMMENDED, FAILED
 *
 * Transition table (as specified):
 *   RECEIVED        -> VALIDATED, FAILED
 *   VALIDATED       -> ANALYZING, FAILED
 *   ANALYZING       -> RISK_ASSESSED, FAILED
 *   RISK_ASSESSED   -> APPROVED, REVIEW_REQUIRED, BLOCK_RECOMMENDED, FAILED
 *   REVIEW_REQUIRED -> APPROVED, BLOCK_RECOMMENDED, FAILED
 *   BLOCK_RECOMMENDED -> APPROVED, FAILED   (see note below)
 *   APPROVED        -> (terminal)
 *   FAILED          -> (terminal)
 *
 * NOTE / documented deviation: the prompt's human-in-the-loop requirement
 * (section 6) says a reviewer must be able to act on either
 * REVIEW_REQUIRED or BLOCK_RECOMMENDED, choosing APPROVE or BLOCK. The
 * base diagram only shows REVIEW_REQUIRED branching further. To support a
 * human overturning an automatic BLOCK_RECOMMENDED, this module adds
 * BLOCK_RECOMMENDED -> APPROVED as an explicit, intentional extension.
 * BLOCK_RECOMMENDED -> BLOCK_RECOMMENDED (i.e. a reviewer confirming the
 * block) is not a state transition at all — it's just a Review record with
 * no state change, since the transaction is already in BLOCK_RECOMMENDED.
 */

const STATES = Object.freeze({
  RECEIVED: 'RECEIVED',
  VALIDATED: 'VALIDATED',
  ANALYZING: 'ANALYZING',
  RISK_ASSESSED: 'RISK_ASSESSED',
  REVIEW_REQUIRED: 'REVIEW_REQUIRED',
  APPROVED: 'APPROVED',
  BLOCK_RECOMMENDED: 'BLOCK_RECOMMENDED',
  FAILED: 'FAILED'
});

const TRANSITIONS = Object.freeze({
  RECEIVED: ['VALIDATED', 'FAILED'],
  VALIDATED: ['ANALYZING', 'FAILED'],
  ANALYZING: ['RISK_ASSESSED', 'FAILED'],
  RISK_ASSESSED: ['APPROVED', 'REVIEW_REQUIRED', 'BLOCK_RECOMMENDED', 'FAILED'],
  REVIEW_REQUIRED: ['APPROVED', 'BLOCK_RECOMMENDED', 'FAILED'],
  BLOCK_RECOMMENDED: ['APPROVED'], // documented extension, see note above
  APPROVED: [],
  FAILED: []
});

class InvalidStateTransitionError extends Error {
  constructor(from, to) {
    super(`Invalid state transition: ${from} -> ${to}`);
    this.name = 'InvalidStateTransitionError';
    this.from = from;
    this.to = to;
  }
}

function isValidState(state) {
  return Object.prototype.hasOwnProperty.call(TRANSITIONS, state);
}

function canTransition(from, to) {
  if (!isValidState(from) || !isValidState(to)) return false;
  return TRANSITIONS[from].includes(to);
}

/**
 * transition(from, to)
 * Returns `to` if the transition is valid. Throws InvalidStateTransitionError
 * otherwise — callers must catch this rather than the state silently
 * changing to something not on the transition table.
 */
function transition(from, to) {
  if (!isValidState(from)) {
    throw new InvalidStateTransitionError(from, to);
  }
  if (!canTransition(from, to)) {
    throw new InvalidStateTransitionError(from, to);
  }
  return to;
}

module.exports = { STATES, TRANSITIONS, canTransition, transition, InvalidStateTransitionError };
