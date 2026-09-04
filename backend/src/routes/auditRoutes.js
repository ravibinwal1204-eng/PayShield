const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { getAudit } = require('../controllers/auditController');

const router = express.Router();
router.use(requireAuth);

router.get('/:transactionId', getAudit);

module.exports = router;
