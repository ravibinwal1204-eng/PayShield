require('dotenv').config();
const express = require('express');
const cors = require('cors');
const morgan = require('morgan');

const connectDB = require('./config/db');
const healthRoutes = require('./routes/healthRoutes');
const transactionRoutes = require('./routes/transactionRoutes');
const riskRoutes = require('./routes/riskRoutes');
const vectorDbRoutes = require('./routes/vectorDbRoutes');
const auditRoutes = require('./routes/auditRoutes');
const reviewRoutes = require('./routes/reviewRoutes');
const evaluationRoutes = require('./routes/evaluationRoutes');
const webhookRoutes = require('./payments/webhookRoutes');
const profileRoutes = require('./routes/profileRoutes');
const authRoutes = require('./routes/authRoutes');
const errorHandler = require('./middleware/errorHandler');

const app = express();
const PORT = process.env.PORT || 5000;

// No auth/roles/JWT — open MVP dashboard, keep middleware minimal.
// PayShield is a DEFENSE-ONLY system: it analyzes and recommends, it never
// executes payments or performs irreversible financial actions. See README.

// CORS: allow only the configured frontend origin. FRONTEND_URL defaults to
// the local Vite dev server so `npm run dev` works out of the box; in
// production set FRONTEND_URL to the deployed frontend's real origin.
// We deliberately do NOT use a wildcard "*" origin.
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';
app.use(cors({ origin: FRONTEND_URL, credentials: false }));

// express.json()'s `verify` callback captures the exact raw request bytes
// into req.rawBody BEFORE parsing, which the Razorpay webhook handler needs
// for HMAC signature verification (a re-serialized JSON body will not
// reliably match byte-for-byte). This has no effect on any other route.
app.use(
  express.json({
    verify: (req, res, buf) => {
      req.rawBody = buf;
    }
  })
);
app.use(morgan('dev'));

app.use('/api/health', healthRoutes);
app.use('/api/transactions', transactionRoutes);
app.use('/api/risk', riskRoutes);
app.use('/api/vectordb', vectorDbRoutes); // thin adapter over the existing Synapse C++ VectorDB
app.use('/api/audit', auditRoutes);
app.use('/api/review', reviewRoutes); // human-in-the-loop, demo-reviewer identity, no auth
app.use('/api/reviews', reviewRoutes); // alias matching the documented final API shape
app.use('/api/evaluation', evaluationRoutes);
app.use('/api/webhooks', webhookRoutes); // Razorpay TEST MODE only — see payments/
app.use('/api/profiles', profileRoutes);
app.use('/api/auth', authRoutes);

app.use((req, res) => {
  res.status(404).json({ success: false, message: 'Route not found' });
});

app.use(errorHandler);

async function handler(req, res) {
  try {
    await connectDB();
    return app(req, res);
  } catch (err) {
    return res.status(503).json({
      success: false,
      message: 'Database connection unavailable',
      detail: process.env.NODE_ENV === 'production' ? undefined : err.message
    });
  }
}

if (require.main === module) {
  connectDB()
    .then(() => {
      app.listen(PORT, () => {
        console.log(`[PayShield] Backend running on http://localhost:${PORT}`);
        console.log(`[PayShield] Accepting requests from FRONTEND_URL=${FRONTEND_URL}`);
      });
    })
    .catch(() => process.exit(1));
}

module.exports = handler;
