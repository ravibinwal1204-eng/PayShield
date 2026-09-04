const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { getRiskByTransactionId, assessTransaction, getRiskSummary } = require('../controllers/riskController');

const router = express.Router();
router.use(requireAuth);

router.post('/assess', assessTransaction);
// Alias matching the documented final API shape (POST /api/risk/analyze/:transactionId).
// Both routes call the exact same controller function — no duplicated logic.
router.post('/analyze/:transactionId', (req, res, next) => {
  req.body = { ...req.body, transactionId: req.params.transactionId };
  return assessTransaction(req, res, next);
});
// Must come before the generic GET /:transactionId route below.
router.get('/summary/stats', getRiskSummary);
router.get('/:transactionId', getRiskByTransactionId);

module.exports = router;
