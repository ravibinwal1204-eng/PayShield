const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema(
  {
    userId: { type: String, required: true, unique: true },
    name: { type: String, required: true },
    email: { type: String, required: true },
    passwordHash: { type: String, select: false },
    role: { type: String, enum: ['user', 'reviewer', 'admin'], default: 'user' },
    accountAgeDays: { type: Number, default: 0 },
    country: { type: String, default: 'IN' },
    riskFlags: { type: [String], default: [] }
  },
  { timestamps: true }
);

module.exports = mongoose.model('User', UserSchema);
