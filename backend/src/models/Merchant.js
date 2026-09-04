const mongoose = require('mongoose');

const MerchantSchema = new mongoose.Schema(
  {
    merchantId: { type: String, required: true, unique: true },
    name: { type: String, required: true },
    category: { type: String, default: 'general' },
    country: { type: String, default: 'IN' },
    trustScore: { type: Number, default: 50 }, // 0-100, higher = more trusted
    isHighRiskCategory: { type: Boolean, default: false }
  },
  { timestamps: true }
);

module.exports = mongoose.model('Merchant', MerchantSchema);
