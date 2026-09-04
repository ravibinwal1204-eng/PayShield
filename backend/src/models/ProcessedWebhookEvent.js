const mongoose = require('mongoose');

// Idempotency is enforced by the UNIQUE index on eventId: a second insert
// attempt for the same event throws a Mongo duplicate-key error (code
// 11000), which webhookController treats as "already processed" — no
// Redis or other cache needed, MongoDB itself is the dedupe store.
const ProcessedWebhookEventSchema = new mongoose.Schema(
  {
    eventId: { type: String, required: true, unique: true },
    source: { type: String, default: 'razorpay' },
    eventType: { type: String, default: '' },
    transactionId: { type: String, default: null },
    processedAt: { type: Date, default: Date.now }
  },
  { timestamps: false }
);

module.exports = mongoose.model('ProcessedWebhookEvent', ProcessedWebhookEventSchema);
