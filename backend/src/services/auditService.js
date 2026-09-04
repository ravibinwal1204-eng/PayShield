const AuditLog = require('../models/AuditLog');

/**
 * logEvent(transactionId, event, { previousState, newState, actor, reason, metadata })
 *
 * Writes one AuditLog document. Never throws into the caller's control
 * flow for a logging failure — an audit write failing should not crash a
 * risk assessment, but it IS logged to the console so it isn't silently
 * lost during development.
 */
async function logEvent(transactionId, event, opts = {}) {
  const { previousState = null, newState = null, actor = 'system', reason = '', metadata = {} } = opts;
  try {
    await AuditLog.create({
      transactionId,
      event,
      previousState,
      newState,
      actor,
      reason,
      metadata
    });
  } catch (err) {
    console.error(`[audit] Failed to record event ${event} for ${transactionId}:`, err.message);
  }
}

async function getAuditTrail(transactionId) {
  return AuditLog.find({ transactionId }).sort({ timestamp: 1 });
}

module.exports = { logEvent, getAuditTrail };
