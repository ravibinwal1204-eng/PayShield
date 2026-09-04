const mongoose = require('mongoose');
let memoryServer = null;

async function connectInMemory() {
  const { MongoMemoryServer } = require('mongodb-memory-server');
  memoryServer = await MongoMemoryServer.create();
  const uri = memoryServer.getUri('payshield');
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 5000 });
  console.log('[MongoDB] Local in-memory database started for development');
  return mongoose.connection;
}

const connectDB = async () => {
  const uri = process.env.MONGODB_URI;

  if (!uri) {
    if (process.env.NODE_ENV !== 'production' && process.env.USE_IN_MEMORY_DB !== 'false') {
      return connectInMemory();
    }
    throw new Error('MONGODB_URI is not configured');
  }

  if (mongoose.connection.readyState === 1) {
    return mongoose.connection;
  }

  if (mongoose.connection.readyState === 2) {
    await mongoose.connection.asPromise();
    return mongoose.connection;
  }

  try {
    await mongoose.connect(uri, { serverSelectionTimeoutMS: 5000 });
    console.log(`[MongoDB] Connected: ${mongoose.connection.host}/${mongoose.connection.name}`);
    return mongoose.connection;
  } catch (err) {
    console.error('[MongoDB] Connection error:', err.message);
    if (process.env.NODE_ENV !== 'production' && process.env.USE_IN_MEMORY_DB !== 'false') {
      console.warn('[MongoDB] Falling back to the local in-memory database');
      return connectInMemory();
    }
    throw err;
  }
};

module.exports = connectDB;
