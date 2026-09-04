const jwt = require('jsonwebtoken');

function getJwtSecret() {
  return process.env.JWT_SECRET || (process.env.NODE_ENV === 'production' ? null : 'payshield-local-development-secret');
}

function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  const secret = getJwtSecret();

  if (!secret) return res.status(503).json({ success: false, message: 'JWT_SECRET is not configured' });
  if (!token) return res.status(401).json({ success: false, message: 'Authentication required' });

  try {
    req.auth = jwt.verify(token, secret);
    next();
  } catch {
    return res.status(401).json({ success: false, message: 'Invalid or expired authentication token' });
  }
}

module.exports = { requireAuth };