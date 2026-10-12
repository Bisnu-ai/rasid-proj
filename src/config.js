'use strict';

const fs = require('fs');
const path = require('path');

// Try loading .env from candidate locations (cwd, project root, workspace root)
const envCandidates = [
  path.resolve(process.cwd(), '.env'),
  path.resolve(__dirname, '..', '.env'),
  path.resolve(__dirname, '..', '..', '.env'),
];

for (const envPath of envCandidates) {
  if (fs.existsSync(envPath)) {
    require('dotenv').config({ path: envPath, override: false, quiet: true });
  }
}

const isProd = process.env.NODE_ENV === 'production';

function required(name) {
  const v = process.env[name];
  if (!v || !v.trim()) {
    throw new Error(`Missing required environment variable: ${name}. Please set ${name} in your .env file.`);
  }
  return v.trim();
}

const config = {
  isProd,
  port: parseInt(process.env.PORT, 10) || 3000,
  mongoUri: required('MONGODB_URI'),
  jwtSecret: required('JWT_SECRET'),
  sessionHours: parseInt(process.env.SESSION_HOURS, 10) || 8,
  // Limits
  maxAmountRupees: 10000000, // ₹1 crore per receipt
};

if (config.jwtSecret.length < 32) {
  throw new Error('JWT_SECRET must be at least 32 characters long.');
}

module.exports = config;
