'use strict';

const fs = require('fs');
const path = require('path');
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
  // Direct handling for landing page if routed to function
  if (req.url === '/' || req.url === '' || req.url.startsWith('/?') || req.url === '/index.html') {
    const candidates = [
      path.join(__dirname, '..', 'public', 'login.html'),
      path.join(process.cwd(), 'public', 'login.html'),
      path.join(__dirname, '..', 'index.html'),
      path.join(process.cwd(), 'index.html'),
    ];
    for (const file of candidates) {
      if (fs.existsSync(file)) {
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.end(fs.readFileSync(file, 'utf8'));
        return;
      }
    }
  }

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

  // Normalize route if prefix was stripped
  if (
    req.url.startsWith('/auth') ||
    req.url.startsWith('/stats') ||
    req.url.startsWith('/receipts') ||
    req.url.startsWith('/export')
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
