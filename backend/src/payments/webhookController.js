/**
 * webhookController.js
 *
 * POST /api/webhooks/razorpay — TEST MODE ONLY.
 *
 * Flow (per spec):
 *   Razorpay Test Mode -> test payment/event -> PayShield receives webhook
 *   -> verify signature -> detect duplicate -> create/update Transaction
 *   -> risk analysis (reuses the SAME riskOrchestrator as everything else)
 *   -> APPROVE/REVIEW_REQUIRED/BLOCK_RECOMMENDED -> MongoDB -> AuditLog
 *
 * This module never moves money and never calls any Razorpay mutation
 * API — it only reads the webhook payload, stores a Transaction, and runs
 * the existing analysis pipeline. Nothing here can approve/capture/refund
 * a payment; PayShield's decision is a recommendation only.
 */

const Transaction = require('../models/Transaction');
const User = require('../models/User');
const Merchant = require('../models/Merchant');
const ProcessedWebhookEvent = require('../models/ProcessedWebhookEvent');
const { verifyRazorpaySignature } = require('./razorpaySignature');
const { runRiskAssessment } = require('../services/riskOrchestrator');
const { logEvent } = require('../services/auditService');
const { RAZORPAY_TEST_MODE } = require('./modeConfig');

function extractEventId(req, body) {
  // Razorpay includes a unique X-Razorpay-Event-Id header on webhook
  // deliveries; fall back to a deterministic id derived from the payload
  // if a given account/version doesn't send it, so dedup still works.
  const headerEventId = req.headers['x-razorpay-event-id'];
  if (headerEventId) return String(headerEventId);

  const paymentId = body?.payload?.payment?.entity?.id;
  const createdAt = body?.created_at || body?.payload?.payment?.entity?.created_at;
  if (paymentId) return `fallback:${body.event || 'unknown'}:${paymentId}:${createdAt || ''}`;
  return null;
}

async function handleRazorpayWebhook(req, res, next) {
  try {
    if (!RAZORPAY_TEST_MODE) {
      return res.status(503).json({
        success: false,
        message: 'Razorpay Test Mode is not enabled/configured on this server'
      });
    }

    const signatureHeader = req.headers['x-razorpay-signature'];
    const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
    const rawBody = req.rawBody; // captured by express.json({ verify }) in server.js

    const validSignature = verifyRazorpaySignature(rawBody, signatureHeader, secret);
    if (!validSignature) {
      await logEvent('webhook:unverified', 'WEBHOOK_SIGNATURE_INVALID', {
        actor: 'razorpay_webhook',
        reason: 'Signature verification failed — request rejected before processing'
        // Never log the secret, the signature, or the raw payload here.
      });
      return res.status(400).json({ success: false, message: 'Invalid webhook signature' });
    }

    const body = req.body;
    const eventId = extractEventId(req, body);
    if (!eventId) {
      return res.status(400).json({ success: false, message: 'Could not determine a unique event id' });
    }

    // --- Idempotency: MongoDB unique index is the dedupe store, no Redis ---
    try {
      await ProcessedWebhookEvent.create({ eventId, source: 'razorpay', eventType: body.event || '' });
    } catch (err) {
      if (err.code === 11000) {
        // Already processed — return success without reprocessing/duplicating.
        return res.status(200).json({ success: true, message: 'Event already processed', duplicate: true });
      }
      throw err;
    }

    const payment = body?.payload?.payment?.entity;
    if (!payment) {
      return res.status(400).json({ success: false, message: 'Webhook payload missing payload.payment.entity' });
    }

    const transactionId = `RZP-${payment.id}`;
    const amount = typeof payment.amount === 'number' ? payment.amount / 100 : 0; // paise -> rupees
    const userId = payment.notes?.userId || 'razorpay_test_user';
    const merchantId = payment.notes?.merchantId || 'razorpay_test_merchant';

    // Ensure a minimal User/Merchant exist so the risk pipeline has context,
    // without overwriting richer records that may already exist.
    await User.findOneAndUpdate(
      { userId },
      { $setOnInsert: { userId, name: 'Razorpay Test User', email: 'razorpay-test@example.com', accountAgeDays: 1 } },
      { upsert: true }
    );
    await Merchant.findOneAndUpdate(
      { merchantId },
      { $setOnInsert: { merchantId, name: 'Razorpay Test Merchant', category: 'retail', trustScore: 60 } },
      { upsert: true }
    );

    await Transaction.findOneAndUpdate(
      { transactionId },
      {
        transactionId,
        userId,
        merchantId,
        amount,
        currency: payment.currency || 'INR',
        location: payment.notes?.location || 'unknown',
        deviceId: payment.notes?.deviceId || 'unknown',
        status: 'PENDING'
      },
      { upsert: true }
    );

    await logEvent(transactionId, 'WEBHOOK_RECEIVED', {
      actor: 'razorpay_webhook',
      metadata: { eventId, eventType: body.event, paymentId: payment.id }
    });

    await ProcessedWebhookEvent.findOneAndUpdate({ eventId }, { transactionId });

    const result = await runRiskAssessment(transactionId);

    return res.status(200).json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
}

module.exports = { handleRazorpayWebhook };
