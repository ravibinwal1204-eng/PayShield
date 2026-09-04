const express = require('express');
const { handleRazorpayWebhook } = require('./webhookController');

const router = express.Router();

// POST /api/webhooks/razorpay — TEST MODE ONLY. See webhookController.js.
router.post('/razorpay', handleRazorpayWebhook);

module.exports = router;
