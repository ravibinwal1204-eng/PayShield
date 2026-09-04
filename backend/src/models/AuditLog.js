const mongoose = require('mongoose');

const AuditLogSchema = new mongoose.Schema(
  {
    transactionId: { type: String, required: true, index: true },
    event: { type: String, required: true },
    previousState: { type: String, default: null },
    newState: { type: String, default: null },
    actor: { type: String, default: 'system' }, // e.g. "system", "gemini", "demo-reviewer"
    reason: { type: String, default: '' },
    timestamp: { type: Date, default: Date.now },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} }
  },
  { timestamps: false }
);

module.exports = mongoose.model('AuditLog', AuditLogSchema);
