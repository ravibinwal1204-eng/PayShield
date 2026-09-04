const { randomUUID } = require('crypto');
const Transaction = require('../models/Transaction');
const RiskAssessment = require('../models/RiskAssessment');
const User = require('../models/User');
const Merchant = require('../models/Merchant');
const { calculateRisk } = require('../services/riskCalculator');

// POST /api/transactions
async function createTransaction(req, res, next) {
  try {
    const { senderName, receiverName, amount, currency, location, deviceId } = req.body;
    const userId = `user_${String(senderName || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')}`;
    const merchantId = `merchant_${String(receiverName || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')}`;
    if (userId === 'user_' || merchantId === 'merchant_' || amount === undefined) {
      return res.status(400).json({
        success: false,
        message: 'senderName, receiverName and amount are required'
      });
    }

    const transactionId = `TXN-${Date.now()}-${randomUUID().slice(0, 8)}`;

    // First transaction onboarding: create minimal profiles when this is a new
    // user or merchant; existing profiles are never overwritten.
    await Promise.all([
      User.findOneAndUpdate(
        { userId },
        { $setOnInsert: { userId, name: senderName.trim(), email: `${userId}@local.invalid`, accountAgeDays: 0 } },
        { upsert: true, setDefaultsOnInsert: true }
      ),
      Merchant.findOneAndUpdate(
        { merchantId },
        { $setOnInsert: { merchantId, name: receiverName.trim(), category: 'general', trustScore: 50, isHighRiskCategory: false } },
        { upsert: true, setDefaultsOnInsert: true }
      )
    ]);

    const transaction = await Transaction.create({
      transactionId,
      userId,
      merchantId,
      amount,
      currency: currency || 'INR',
      location: location || 'unknown',
      deviceId: deviceId || 'unknown',
      status: 'PENDING'
    });

    const [user, merchant] = await Promise.all([User.findOne({ userId }), Merchant.findOne({ merchantId })]);
    const riskResult = calculateRisk({ amount, location: transaction.location, deviceId: transaction.deviceId, user, merchant });

    const riskAssessment = await RiskAssessment.create({
      transactionId,
      ...riskResult,
      state: riskResult.decision === 'APPROVE'
        ? 'APPROVED'
        : riskResult.decision === 'BLOCK'
          ? 'BLOCK_RECOMMENDED'
          : 'REVIEW_REQUIRED'
    });

    transaction.status = riskResult.decision === 'APPROVE'
      ? 'APPROVED'
      : riskResult.decision === 'BLOCK'
        ? 'BLOCKED'
      : 'REVIEW';
    await transaction.save();

    return res.status(201).json({
      success: true,
      data: { transaction, riskAssessment }
    });
  } catch (err) {
    next(err);
  }
}

// GET /api/transactions
async function getTransactions(req, res, next) {
  try {
    const transactions = await Transaction.find().sort({ createdAt: -1 });
    return res.json({ success: true, count: transactions.length, data: transactions });
  } catch (err) {
    next(err);
  }
}

// GET /api/transactions/:id
async function getTransactionById(req, res, next) {
  try {
    const transaction = await Transaction.findOne({ transactionId: req.params.id });
    if (!transaction) {
      return res.status(404).json({ success: false, message: 'Transaction not found' });
    }
    return res.json({ success: true, data: transaction });
  } catch (err) {
    next(err);
  }
}

module.exports = { createTransaction, getTransactions, getTransactionById };
