const mongoose = require('mongoose');

const TransactionSchema = new mongoose.Schema(
  {
    transactionId: { type: String, required: true, unique: true },
    userId: { type: String, required: true },
    merchantId: { type: String, required: true },
    amount: { type: Number, required: true },
    currency: { type: String, default: 'INR' },
    location: { type: String, default: 'unknown' },
    deviceId: { type: String, default: 'unknown' },
    timestamp: { type: Date, default: Date.now },
    status: {
      type: String,
      enum: ['PENDING', 'APPROVED', 'REVIEW', 'BLOCKED'],
      default: 'PENDING'
    }
  },
  { timestamps: true }
);

module.exports = mongoose.model('Transaction', TransactionSchema);
