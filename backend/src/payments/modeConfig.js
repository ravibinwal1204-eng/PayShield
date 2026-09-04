/**
 * modeConfig.js
 *
 * Single source of truth for which transaction-intake mode PayShield is
 * running in. This is read by the dashboard (via GET /api/health) and by
 * the webhook route to decide whether Razorpay signature verification is
 * even relevant.
 *
 *   DEMO_MODE=true (default)   -> synthetic transactions via POST /api/transactions
 *   RAZORPAY_TEST_MODE=true    -> also accept POST /api/webhooks/razorpay (TEST MODE ONLY)
 *
 * Both can technically be true at once (synthetic transactions still work
 * even when Razorpay test mode is enabled) — PayShield never depends on
 * Razorpay being configured to function, per the "must not block the core
 * demo" requirement.
 */

const DEMO_MODE = process.env.DEMO_MODE !== 'false'; // default true
const RAZORPAY_TEST_MODE =
  process.env.RAZORPAY_TEST_MODE === 'true' &&
  Boolean(process.env.RAZORPAY_KEY_ID) &&
  Boolean(process.env.RAZORPAY_KEY_SECRET);

function currentMode() {
  if (RAZORPAY_TEST_MODE) return 'RAZORPAY_TEST_MODE';
  return 'DEMO_MODE';
}

module.exports = { DEMO_MODE, RAZORPAY_TEST_MODE, currentMode };
