const express = require('express');
const { health, search } = require('../controllers/vectorDbController');

const router = express.Router();

// Manual verification only — proves Node -> REST -> C++ VectorDB works.
router.get('/health', health);
router.post('/search', search);

module.exports = router;
