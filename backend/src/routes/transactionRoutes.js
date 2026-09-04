const express = require('express');
const {
  createTransaction,
  getTransactions,
  getTransactionById
} = require('../controllers/transactionController');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

router.post('/', createTransaction);
router.get('/', getTransactions);
router.get('/:id', getTransactionById);

module.exports = router;
