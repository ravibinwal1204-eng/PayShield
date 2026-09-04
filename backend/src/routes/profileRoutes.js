const express = require('express');
const { upsertUser, upsertMerchant, getUserHistory } = require('../controllers/profileController');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

router.post('/users', upsertUser);
router.post('/merchants', upsertMerchant);
router.get('/users/:userId/history', getUserHistory);

module.exports = router;