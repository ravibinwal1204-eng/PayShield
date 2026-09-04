const { runEvaluation } = require('../evaluation/evaluationEngine');

// GET /api/evaluation
async function getEvaluation(req, res, next) {
  try {
    const falsePositiveCost = Number(process.env.FALSE_POSITIVE_COST) || 100;
    const metrics = runEvaluation({ falsePositiveCost });
    return res.json({ success: true, data: metrics });
  } catch (err) {
    if (err.message.includes('dataset.json not found')) {
      return res.status(503).json({ success: false, message: err.message });
    }
    next(err);
  }
}

module.exports = { getEvaluation };
