const mongoose = require('mongoose');

const RiskAssessmentSchema = new mongoose.Schema(
  {
    transactionId: { type: String, required: true, unique: true },
    riskScore: { type: Number, required: true }, // 0-100
    riskLevel: {
      type: String,
      enum: ['LOW', 'MEDIUM', 'HIGH'],
      required: true
    },
    decision: {
      type: String,
      enum: ['APPROVE', 'REVIEW', 'BLOCK'],
      required: true
    },
    fraudRisk: { type: Number, default: 0 },
    behaviorRisk: { type: Number, default: 0 },
    deviceRisk: { type: Number, default: 0 },
    policyRisk: { type: Number, default: 0 },
    reasons: { type: [String], default: [] },
    signals: { type: [String], default: [] }, // agent-emitted UPPER_SNAKE_CASE tags
    citations: { type: [mongoose.Schema.Types.Mixed], default: [] }, // {document, section, page, chunkId}
    state: { type: String, default: null }, // final stateMachine state for this assessment
    degraded: { type: Boolean, default: false }, // true if any agent hit a graceful-failure path
    confidence: { type: Number, default: 0 }, // average of the 4 agents' confidence, 0-100
    analysisStatus: { type: String, default: 'COMPLETE' }, // COMPLETE | DEGRADED | FAILED
    createdAt: { type: Date, default: Date.now }
  },
  { timestamps: false }
);

module.exports = mongoose.model('RiskAssessment', RiskAssessmentSchema);
