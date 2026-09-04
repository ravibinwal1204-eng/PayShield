require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const connectDB = require('./config/db');
const User = require('./models/User');
const Merchant = require('./models/Merchant');

async function seed() {
  await connectDB();

  const seedPath = path.join(__dirname, '..', '..', 'data', 'sample_seed.json');
  const raw = fs.readFileSync(seedPath, 'utf-8');
  const { users, merchants } = JSON.parse(raw);

  for (const u of users) {
    await User.findOneAndUpdate({ userId: u.userId }, u, { upsert: true, new: true });
  }
  for (const m of merchants) {
    await Merchant.findOneAndUpdate({ merchantId: m.merchantId }, m, { upsert: true, new: true });
  }

  console.log(`[Seed] Inserted/updated ${users.length} users and ${merchants.length} merchants.`);
  await mongoose.disconnect();
  process.exit(0);
}

seed().catch((err) => {
  console.error('[Seed] Error:', err.message);
  process.exit(1);
});
