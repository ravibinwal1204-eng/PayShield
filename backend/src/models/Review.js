const mongoose = require('mongoose');

const ReviewSchema = new mongoose.Schema(
  {
    transactionId: { type: String, required: true, index: true },
    riskAssessmentId: { type: String, required: true },
    decision: { type: String, enum: ['APPROVE', 'BLOCK'], required: true },
    reason: { type: String, default: '' },
    reviewer: { type: String, default: 'demo-reviewer' }, // no auth in this MVP
    timestamp: { type: Date, default: Date.now }
  },
  { timestamps: false }
);

module.exports = mongoose.model('Review', ReviewSchema);
