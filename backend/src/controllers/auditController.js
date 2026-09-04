const { getAuditTrail } = require('../services/auditService');

// GET /api/audit/:transactionId
async function getAudit(req, res, next) {
  try {
    const events = await getAuditTrail(req.params.transactionId);
    return res.json({ success: true, count: events.length, data: events });
  } catch (err) {
    next(err);
  }
}

module.exports = { getAudit };
