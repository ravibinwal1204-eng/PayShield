const vectorDbClient = require('../vectordb/vectorDbClient');

// GET /api/vectordb/health
async function health(req, res, next) {
  try {
    const stats = await vectorDbClient.healthCheck();
    return res.json({ success: true, vectorDb: stats });
  } catch (err) {
    return res.status(503).json({ success: false, message: err.message });
  }
}

// POST /api/vectordb/search
// body: { vector: number[16], k?: number }
async function search(req, res, next) {
  try {
    const { vector, k } = req.body;
    if (!Array.isArray(vector)) {
      return res.status(400).json({ success: false, message: 'vector (number[]) is required' });
    }
    const result = await vectorDbClient.searchVectors({ vector, k });
    return res.json({ success: true, data: result });
  } catch (err) {
    return res.status(502).json({ success: false, message: err.message });
  }
}

module.exports = { health, search };
