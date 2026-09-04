/**
 * razorpaySignature.js
 *
 * Verifies the `X-Razorpay-Signature` header Razorpay sends on every
 * webhook delivery: HMAC-SHA256 over the RAW request body (not the
 * re-serialized JSON), hex-encoded, keyed with RAZORPAY_WEBHOOK_SECRET.
 * Compared in constant time via crypto.timingSafeEqual to avoid timing
 * side-channels. This matches Razorpay's documented mechanism and the
 * reference implementation in their official Node SDK.
 *
 * IMPORTANT: this requires the RAW request body bytes, not a parsed
 * object — a re-serialized JSON.stringify(req.body) will not reliably
 * match byte-for-byte (key order, whitespace) and signature checks will
 * intermittently fail. server.js captures this via express.json()'s
 * `verify` callback into `req.rawBody`.
 */

const crypto = require('crypto');

/**
 * verifyRazorpaySignature(rawBody, signatureHeader, secret)
 * rawBody must be a Buffer or string of the exact bytes Razorpay sent.
 * Returns boolean. Never throws for a malformed signature — treats it as
 * "not valid" so the caller can reject cleanly rather than 500.
 */
function verifyRazorpaySignature(rawBody, signatureHeader, secret) {
  if (!rawBody || !signatureHeader || !secret) return false;

  try {
    const expected = crypto
      .createHmac('sha256', secret)
      .update(rawBody)
      .digest('hex');

    const expectedBuf = Buffer.from(expected, 'utf8');
    const givenBuf = Buffer.from(String(signatureHeader), 'utf8');

    if (expectedBuf.length !== givenBuf.length) return false;
    return crypto.timingSafeEqual(expectedBuf, givenBuf);
  } catch {
    return false;
  }
}

module.exports = { verifyRazorpaySignature };
