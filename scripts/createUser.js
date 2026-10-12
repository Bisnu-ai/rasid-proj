'use strict';

/**
 * Administrator tool: create (or reset the password of) an authorized receipt creator.
 * There is deliberately NO public registration in the web app.
 *
 * Usage:
 *   npm run create-user -- <username> <password> [creator|admin]
 *   npm run create-user -- --deactivate <username>
 */

const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');

function printUsage() {
  console.log(`
Administrator Tool: Create or Reset Authorized Users
===================================================

Usage:
  npm run create-user -- <username> <password> [creator|admin]
  npm run create-user -- --deactivate <username>

Options:
  <username>            3-32 characters (letters, digits, dot, underscore, dash)
  <password>            At least 10 characters
  [creator|admin]       Role (default: "creator")
  --deactivate <user>   Deactivate an existing user account
`);
}

async function main() {
  const args = process.argv.slice(2);

  // 1. Check for help flag or empty arguments
  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    printUsage();
    process.exitCode = args.length === 0 ? 1 : 0;
    return;
  }

  // 2. Validate arguments BEFORE connecting to MongoDB
  let isDeactivate = false;
  let username = '';
  let password = '';
  let role = 'creator';

  if (args[0] === '--deactivate') {
    isDeactivate = true;
    username = (args[1] || '').trim().toLowerCase();
    if (!username) {
      console.error('Error: Please specify the username to deactivate.');
      console.error('Usage: npm run create-user -- --deactivate <username>');
      process.exitCode = 1;
      return;
    }
  } else {
    const [usernameRaw, passwordRaw, roleRaw = 'creator'] = args;
    if (!usernameRaw || !passwordRaw) {
      console.error('Error: Both username and password are required.');
      printUsage();
      process.exitCode = 1;
      return;
    }
    username = usernameRaw.trim().toLowerCase();
    password = passwordRaw;
    role = roleRaw.trim().toLowerCase();

    if (!/^[a-z0-9._-]{3,32}$/.test(username)) {
      console.error('Error: Username must be 3-32 characters: letters, digits, dot, underscore or dash.');
      process.exitCode = 1;
      return;
    }
    if (password.length < 10) {
      console.error('Error: Password must be at least 10 characters.');
      process.exitCode = 1;
      return;
    }
    if (!['creator', 'admin'].includes(role)) {
      console.error('Error: Role must be "creator" or "admin".');
      process.exitCode = 1;
      return;
    }
  }

  // 3. Load configuration and models
  let config;
  try {
    config = require('../src/config');
  } catch (err) {
    console.error('Configuration error:', err.message);
    console.error('Please make sure MONGODB_URI and JWT_SECRET are set in your .env file.');
    process.exitCode = 1;
    return;
  }
  const { User } = require('../src/models');

  // 4. Connect to MongoDB
  try {
    await mongoose.connect(config.mongoUri, { serverSelectionTimeoutMS: 15000 });
  } catch (err) {
    console.error(`Failed to connect to MongoDB: ${err.message}`);
    console.error('Troubleshooting:');
    console.error(' 1. Check your MONGODB_URI in .env');
    console.error(' 2. If using MongoDB Atlas, check that your IP address is whitelisted in "Network Access".');
    console.error(' 3. If using local MongoDB, ensure MongoDB service is running.');
    process.exitCode = 1;
    return;
  }

  await User.init();

  if (isDeactivate) {
    const r = await User.updateOne({ username }, { active: false });
    console.log(r.matchedCount ? `Deactivated "${username}".` : `No such user "${username}".`);
    return;
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const existing = await User.findOne({ username });
  if (existing) {
    existing.passwordHash = passwordHash;
    existing.role = role;
    existing.active = true;
    await existing.save();
    console.log(`Updated user "${username}" (${role}).`);
  } else {
    await User.create({ username, passwordHash, role });
    console.log(`Created user "${username}" (${role}).`);
  }
}

main()
  .catch((err) => {
    console.error('Error:', err.message);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
