'use strict';

const mongoose = require('mongoose');
const config = require('./config');
const { createApp } = require('./app');

async function main() {
  await mongoose.connect(config.mongoUri, { serverSelectionTimeoutMS: 15000 });
  console.log('Connected to MongoDB.');

  // Make sure unique indexes (users, idempotency keys) exist.
  await mongoose.connection.syncIndexes();

  const app = createApp();
  const server = app.listen(config.port, () => {
    console.log(`Receipt system running on http://localhost:${config.port}`);
  });

  const shutdown = () => {
    server.close(() => mongoose.disconnect().finally(() => process.exit(0)));
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((err) => {
  console.error('Failed to start server:', err.message);
  if (err.message.includes('MONGODB_URI') || err.message.includes('JWT_SECRET')) {
    console.error('Please configure your .env file with valid settings.');
  } else if (err.name === 'MongooseServerSelectionError' || err.name === 'MongoServerSelectionError') {
    console.error('Could not connect to MongoDB. Please ensure:');
    console.error(' 1. Your MONGODB_URI in .env is correct.');
    console.error(' 2. If using MongoDB Atlas, your current IP is whitelisted under "Network Access".');
    console.error(' 3. If using local MongoDB, ensure your mongod service is running.');
  }
  process.exit(1);
});
