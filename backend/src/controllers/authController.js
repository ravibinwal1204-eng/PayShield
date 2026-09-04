const { randomUUID } = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/User');

function getJwtSecret() {
  return process.env.JWT_SECRET || (process.env.NODE_ENV === 'production' ? null : 'payshield-local-development-secret');
}

function issueToken(user) {
  const secret = getJwtSecret();
  if (!secret) throw new Error('JWT_SECRET is not configured');
  return jwt.sign({ userId: user.userId, email: user.email, role: user.role }, secret, { expiresIn: '8h' });
}

async function register(req, res, next) {
  try {
    if (!getJwtSecret()) return res.status(503).json({ success: false, message: 'JWT_SECRET is not configured' });
    const { name, email, password, country = 'IN' } = req.body;
    if (!name || !email || !password || password.length < 8) {
      return res.status(400).json({ success: false, message: 'name, email and a password of at least 8 characters are required' });
    }
    const normalizedEmail = email.trim().toLowerCase();
    const existing = await User.findOne({ email: normalizedEmail });
    if (existing) return res.status(409).json({ success: false, message: 'An account with this email already exists' });

    const user = await User.create({
      userId: `user_${randomUUID().slice(0, 12)}`,
      name,
      email: normalizedEmail,
      passwordHash: await bcrypt.hash(password, 12),
      country,
      accountAgeDays: 0
    });
    return res.status(201).json({ success: true, data: { token: issueToken(user), user: { userId: user.userId, name: user.name, email: user.email, role: user.role } } });
  } catch (err) {
    next(err);
  }
}

async function login(req, res, next) {
  try {
    if (!getJwtSecret()) return res.status(503).json({ success: false, message: 'JWT_SECRET is not configured' });
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ success: false, message: 'email and password are required' });
    const user = await User.findOne({ email: email.trim().toLowerCase() }).select('+passwordHash');
    if (!user || !user.passwordHash || !(await bcrypt.compare(password, user.passwordHash))) {
      return res.status(401).json({ success: false, message: 'Invalid email or password' });
    }
    return res.json({ success: true, data: { token: issueToken(user), user: { userId: user.userId, name: user.name, email: user.email, role: user.role } } });
  } catch (err) {
    next(err);
  }
}

module.exports = { register, login };