const User = require('../models/User');
const Merchant = require('../models/Merchant');
const Transaction = require('../models/Transaction');

async function upsertUser(req, res, next) {
  try {
    const { userId, name, email, accountAgeDays, country, riskFlags } = req.body;
    if (!userId || !name || !email) {
      return res.status(400).json({ success: false, message: 'userId, name and email are required' });
    }
    const user = await User.findOneAndUpdate(
      { userId },
      { userId, name, email, accountAgeDays, country, riskFlags },
      { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true }
    );
    return res.json({ success: true, data: user });
  } catch (err) {
    next(err);
  }
}

async function upsertMerchant(req, res, next) {
  try {
    const { merchantId, name, category, country, trustScore, isHighRiskCategory } = req.body;
    if (!merchantId || !name) {
      return res.status(400).json({ success: false, message: 'merchantId and name are required' });
    }
    const merchant = await Merchant.findOneAndUpdate(
      { merchantId },
      { merchantId, name, category, country, trustScore, isHighRiskCategory },
      { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true }
    );
    return res.json({ success: true, data: merchant });
  } catch (err) {
    next(err);
  }
}

async function getUserHistory(req, res, next) {
  try {
    const user = await User.findOne({ userId: req.params.userId }).lean();
    if (!user) return res.status(404).json({ success: false, message: 'User profile not found' });
    const transactions = await Transaction.find({ userId: req.params.userId }).sort({ createdAt: -1 }).lean();
    return res.json({ success: true, data: { user, count: transactions.length, transactions } });
  } catch (err) {
    next(err);
  }
}

module.exports = { upsertUser, upsertMerchant, getUserHistory };