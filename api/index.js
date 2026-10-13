'use strict';

const mongoose = require('mongoose');
const config = require('../src/config');
const { createApp } = require('../src/app');

// Ensure trust proxy is enabled for Vercel's proxy environment
process.env.TRUST_PROXY = process.env.TRUST_PROXY || '1';

let cachedDbPromise = null;
let appInstance = null;

/**
 * Cache and reuse MongoDB connection across serverless function invocations.
 */
async function connectToDatabase() {
  if (mongoose.connection.readyState === 1) {
    return mongoose.connection;
  }
  if (!cachedDbPromise) {
    cachedDbPromise = mongoose
      .connect(config.mongoUri, {
        serverSelectionTimeoutMS: 15000,
      })
      .then(async (conn) => {
        try {
          await mongoose.connection.syncIndexes();
        } catch (err) {
          console.warn('MongoDB syncIndexes notice:', err.message);
        }
        return conn;
      })
      .catch((err) => {
        cachedDbPromise = null;
        throw err;
      });
  }
  return cachedDbPromise;
}

/**
 * Vercel Serverless Function handler wrapping the Express application.
 */
module.exports = async (req, res) => {
  try {
    await connectToDatabase();
  } catch (err) {
    console.error('Serverless database connection error:', err.message);
    res.status(500).json({ error: 'Database connection failed. Please check MONGODB_URI.' });
    return;
  }

  if (!appInstance) {
    appInstance = createApp();
  }

  // Normalize route if Vercel rewrite strips the /api prefix
  if (
    !req.url.startsWith('/api') &&
    !req.url.startsWith('/login') &&
    !req.url.startsWith('/dashboard') &&
    !req.url.startsWith('/css') &&
    !req.url.startsWith('/js')
  ) {
    req.url = '/api' + (req.url.startsWith('/') ? req.url : '/' + req.url);
  }

  return new Promise((resolve, reject) => {
    res.on('finish', resolve);
    res.on('close', resolve);
    res.on('error', reject);
    appInstance(req, res);
  });
};
