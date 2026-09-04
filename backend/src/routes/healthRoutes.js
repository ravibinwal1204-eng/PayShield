const express = require('express');
const mongoose = require('mongoose');
const { healthCheck } = require('../vectordb/vectorDbClient');
const { currentMode } = require('../payments/modeConfig');

const router = express.Router();

// GET /api/health
// Aggregates backend + MongoDB + C++ VectorDB status. Never exposes
// credentials, connection strings, or secrets — only up/down status.
router.get('/', async (req, res) => {
  const dbStates = ['disconnected', 'connected', 'connecting', 'disconnecting'];
  const mongoState = dbStates[mongoose.connection.readyState] || 'unknown';
  const mongoHealthy = mongoose.connection.readyState === 1;

  let vectordbHealthy = false;
  let vectordbDetail = 'unreachable';
  try {
    await healthCheck(); // GET /stats on the C++ VectorDB — see vectorDbClient.js
    vectordbHealthy = true;
    vectordbDetail = 'reachable';
  } catch (err) {
    vectordbDetail = 'unreachable';
  }

  // VectorDB is optional for deployment: policy analysis degrades safely when
  // the separately hosted C++ service is unavailable, while MongoDB is required.
  const overallHealthy = mongoHealthy;

  res.status(overallHealthy ? 200 : 503).json({
    success: true,
    service: 'payshield',
    status: overallHealthy ? 'healthy' : 'degraded',
    mode: currentMode(),
    timestamp: new Date().toISOString(),
    dependencies: {
      mongodb: mongoHealthy ? 'healthy' : mongoState,
      vectordb: vectordbHealthy ? 'healthy' : vectordbDetail
    }
  });
});

module.exports = router;
