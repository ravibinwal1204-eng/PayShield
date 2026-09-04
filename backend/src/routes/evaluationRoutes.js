const express = require('express');
const { getEvaluation } = require('../controllers/evaluationController');

const router = express.Router();

router.get('/', getEvaluation);

module.exports = router;
