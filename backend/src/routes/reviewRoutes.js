const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { submitReview, getReviews } = require('../controllers/reviewController');

const router = express.Router();
router.use(requireAuth);

router.post('/', submitReview);
// Alias matching the documented final API shape (POST /api/reviews/:transactionId).
// Same controller, just takes transactionId from the path instead of the body.
router.post('/:transactionId', (req, res, next) => {
  req.body = { ...req.body, transactionId: req.params.transactionId };
  return submitReview(req, res, next);
});
router.get('/:transactionId', getReviews);

module.exports = router;
