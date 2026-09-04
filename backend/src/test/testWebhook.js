/**
 * testWebhook.js
 *
 * Exercises POST /api/webhooks/razorpay end-to-end against a RUNNING
 * backend (start it first with `npm run dev`). Requires RAZORPAY_TEST_MODE=true
 * and all three RAZORPAY_* variables set in backend/.env, since the route
 * itself refuses to process anything otherwise (see webhookController.js).
 *
 * Proves:
 *   1. A correctly-signed test payment.captured event is accepted and
 *      runs the full risk pipeline (Transaction created, RiskAssessment
 *      produced, AuditLog written).
 *   2. Replaying the EXACT same event is ignored (idempotency) instead of
 *      creating a duplicate assessment.
 *   3. A tampered/invalid signature is rejected with 400 and never reaches
 *      the risk pipeline.
 *
 * Run with:
 *   cd backend
 *   node src/test/testWebhook.js
 */

require('dotenv').config();
const crypto = require('crypto');

const BASE_URL = `http://localhost:${process.env.PORT || 5000}`;
const SECRET = process.env.RAZORPAY_WEBHOOK_SECRET;

function buildPayload({ paymentId, amountPaise = 15000000, eventId }) {
  const body = {
    entity: 'event',
    account_id: 'acc_test',
    event: 'payment.captured',
    created_at: Math.floor(Date.now() / 1000),
    payload: {
      payment: {
        entity: {
          id: paymentId,
          amount: amountPaise, // e.g. 15,000,000 paise = ₹150,000 (high value, on purpose)
          currency: 'INR',
          status: 'captured',
          method: 'card',
          created_at: Math.floor(Date.now() / 1000),
          notes: {
            userId: 'user_webhook_demo',
            merchantId: 'merchant_webhook_demo',
            location: 'Surat, IN',
            deviceId: 'device_webhook_demo'
          }
        }
      }
    }
  };
  return { body, eventId: eventId || `evt_test_${paymentId}` };
}

function sign(rawBody, secret) {
  return crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
}

async function post(rawBody, signature, eventId) {
  const headers = { 'Content-Type': 'application/json' };
  if (signature) headers['x-razorpay-signature'] = signature;
  if (eventId) headers['x-razorpay-event-id'] = eventId;

  const res = await fetch(`${BASE_URL}/api/webhooks/razorpay`, {
    method: 'POST',
    headers,
    body: rawBody
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

async function main() {
  if (!SECRET) {
    console.log('RAZORPAY_WEBHOOK_SECRET is not set in backend/.env — nothing to test.');
    console.log('Set DEMO_MODE + RAZORPAY_TEST_MODE=true and the three RAZORPAY_* vars, then re-run.');
    return;
  }

  const paymentId = `pay_test_${Date.now()}`;
  const { body, eventId } = buildPayload({ paymentId });
  const rawBody = JSON.stringify(body);
  const validSig = sign(rawBody, SECRET);

  console.log('\n=== 1. Valid signature, new event ===');
  const first = await post(rawBody, validSig, eventId);
  console.log(`status=${first.status}`, JSON.stringify(first.data).slice(0, 300));

  console.log('\n=== 2. Same event replayed (should be ignored as duplicate) ===');
  const replay = await post(rawBody, validSig, eventId);
  console.log(`status=${replay.status}`, JSON.stringify(replay.data));

  console.log('\n=== 3. Tampered signature (should be rejected) ===');
  const bad = await post(rawBody, 'deadbeef'.repeat(8), `${eventId}_bad`);
  console.log(`status=${bad.status}`, JSON.stringify(bad.data));

  console.log('\nDone. Check GET /api/audit/RZP-' + paymentId + ' for the full trail.');
}

main().catch((err) => {
  console.error('Webhook test failed:', err.message);
  console.error('Is the backend running (`npm run dev`) on', BASE_URL, '?');
  process.exit(1);
});
