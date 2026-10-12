'use strict';

const mongoose = require('mongoose');

/**
 * Receipt: ONLY the three business fields.
 * (MongoDB's own _id is the technical identifier; versionKey is disabled.)
 */
const receiptSchema = new mongoose.Schema(
  {
    donorName: { type: String, required: true, trim: true, maxlength: 80 },
    // Integer paise (₹501.00 -> 50100). Never a float.
    amount: {
      type: Number,
      required: true,
      min: 1,
      validate: { validator: Number.isSafeInteger, message: 'amount must be an integer number of paise' },
    },
    dateTime: { type: Date, required: true },
  },
  { versionKey: false }
);
receiptSchema.index({ dateTime: 1 });

/**
 * Authorized users (created only by an administrator via the CLI script).
 * Authentication data lives here, completely separate from receipts.
 */
const userSchema = new mongoose.Schema(
  {
    username: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true },
    role: { type: String, enum: ['admin', 'creator'], default: 'creator' },
    active: { type: Boolean, default: true },
  },
  { versionKey: false }
);

/**
 * Technical idempotency keys, used only to stop accidental duplicate
 * submissions (double-click, retry, flaky network). Kept OUT of the receipt
 * documents. Entries expire automatically after 24 hours.
 */
const submissionSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true },
    receiptId: { type: mongoose.Schema.Types.ObjectId, default: null },
    createdAt: { type: Date, default: Date.now, expires: 60 * 60 * 24 },
  },
  { versionKey: false }
);

module.exports = {
  Receipt: mongoose.model('Receipt', receiptSchema),
  User: mongoose.model('User', userSchema),
  Submission: mongoose.model('Submission', submissionSchema),
};
