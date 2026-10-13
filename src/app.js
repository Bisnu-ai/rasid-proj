'use strict';

const path = require('path');
const express = require('express');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');
const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');

const config = require('./config');
const { Receipt, User, Submission } = require('./models');
const { requireAuth, requireXhr, issueSession, clearSession } = require('./auth');
const { parseRupeesToPaise, formatINR, formatDate, formatTime } = require('./format');
const { generateReceiptPdf } = require('./pdf');
const { buildExcelBuffer } = require('./excel');

// A real hash so login takes similar time whether or not the user exists.
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 10);

const NAME_RE = /^[A-Za-z][A-Za-z .'\-]{1,79}$/;
const SUBMISSION_RE = /^[A-Za-z0-9\-]{16,64}$/;

async function getStats() {
  const [agg] = await Receipt.aggregate([
    { $group: { _id: null, totalPaise: { $sum: '$amount' }, count: { $sum: 1 } } },
  ]);
  const totalPaise = agg ? agg.totalPaise : 0;
  return { count: agg ? agg.count : 0, totalPaise, totalFormatted: formatINR(totalPaise) };
}

function receiptView(r) {
  const slug = r.donorName.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return {
    id: String(r._id),
    donorName: r.donorName,
    amountPaise: r.amount,
    amountFormatted: formatINR(r.amount),
    date: formatDate(r.dateTime),
    time: formatTime(r.dateTime),
    filename: `Durga-Puja-Receipt-${slug}.pdf`,
  };
}

function createApp() {
  const app = express();
  app.disable('x-powered-by');
  if (process.env.TRUST_PROXY) app.set('trust proxy', parseInt(process.env.TRUST_PROXY, 10) || 1);

  app.use(helmet());
  app.use(express.json({ limit: '10kb' }));
  app.use(cookieParser());

  // ---------- API ----------
  const api = express.Router();
  api.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });
  api.use(rateLimit({ windowMs: 15 * 60 * 1000, limit: 600, standardHeaders: true, legacyHeaders: false }));
  api.use(requireXhr);

  const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many login attempts. Please try again in 15 minutes.' },
  });

  // Login (no public registration endpoint exists)
  api.post('/auth/login', loginLimiter, async (req, res) => {
    const { username, password } = req.body || {};
    if (typeof username !== 'string' || typeof password !== 'string' || !username || !password || password.length > 200) {
      return res.status(400).json({ error: 'Enter username and password.' });
    }
    const user = await User.findOne({ username: username.trim().toLowerCase() });
    const ok = await bcrypt.compare(password, user ? user.passwordHash : DUMMY_HASH);
    if (!user || !ok || !user.active) {
      return res.status(401).json({ error: 'Invalid username or password.' });
    }
    issueSession(res, user);
    res.json({ username: user.username });
  });

  api.post('/auth/logout', (req, res) => {
    clearSession(res);
    res.json({ ok: true });
  });

  // Everything below requires an authenticated, authorized user
  api.use(requireAuth);

  api.get('/auth/me', (req, res) => res.json({ username: req.user.username }));

  api.get('/stats', async (req, res) => res.json(await getStats()));

  api.post('/receipts', async (req, res) => {
    const body = req.body || {};

    // 1. Validate
    const donorName = typeof body.donorName === 'string' ? body.donorName.trim().replace(/\s+/g, ' ') : '';
    if (!NAME_RE.test(donorName)) {
      return res.status(400).json({
        error: 'Enter the donor name in English (letters, spaces, . \' - only; 2–80 characters).',
        field: 'donorName',
      });
    }
    const amount = parseRupeesToPaise(body.amount);
    if (amount === null || amount < 1) {
      return res.status(400).json({ error: 'Enter a valid amount in rupees (up to 2 decimals).', field: 'amount' });
    }
    if (amount > config.maxAmountRupees * 100) {
      return res.status(400).json({ error: `Amount cannot exceed ₹${config.maxAmountRupees.toLocaleString('en-IN')}.`, field: 'amount' });
    }
    const key = body.submissionId;
    if (typeof key !== 'string' || !SUBMISSION_RE.test(key)) {
      return res.status(400).json({ error: 'Invalid request. Please refresh the page and try again.' });
    }

    // 2. Duplicate-submission guard (idempotency key)
    let sub;
    try {
      sub = await Submission.create({ key });
    } catch (err) {
      if (err && err.code === 11000) {
        const existing = await Submission.findOne({ key }).lean();
        const saved = existing && existing.receiptId ? await Receipt.findById(existing.receiptId).lean() : null;
        if (saved) {
          return res.json({ receipt: receiptView(saved), stats: await getStats(), duplicate: true });
        }
        return res.status(409).json({ error: 'This receipt is already being saved. Please wait a moment.' });
      }
      throw err;
    }

    // 3. Save to MongoDB (server-generated timestamp)
    let saved;
    try {
      saved = await Receipt.create({ donorName, amount, dateTime: new Date() });
    } catch (err) {
      await Submission.deleteOne({ _id: sub._id }).catch(() => {});
      throw err;
    }
    try {
      await Submission.updateOne({ _id: sub._id }, { receiptId: saved._id });
    } catch (err) {
      console.error('Could not link idempotency key:', err.message);
    }

    // 4. Only now return the saved record; the client then downloads the PDF.
    res.status(201).json({ receipt: receiptView(saved), stats: await getStats(), duplicate: false });
  });

  api.get('/receipts/:id/pdf', async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ error: 'Receipt not found.' });
    const r = await Receipt.findById(req.params.id).lean();
    if (!r) return res.status(404).json({ error: 'Receipt not found.' });
    const collectorName = req.user ? req.user.username : '';
    const pdf = await generateReceiptPdf(r, collectorName);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${receiptView(r).filename}"`,
      'Content-Length': pdf.length,
    });
    res.send(pdf);
  });

  api.get('/export/excel', async (req, res) => {
    const { buffer } = await buildExcelBuffer();
    const stamp = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="Durga-Puja-Receipts-${stamp}.xlsx"`,
      'Content-Length': buffer.length,
    });
    res.send(buffer);
  });

  api.use((req, res) => res.status(404).json({ error: 'Not found.' }));
  app.use('/api', api);

  // ---------- Static frontend ----------
  app.use(express.static(path.join(__dirname, '..', 'public'), { index: 'login.html', maxAge: config.isProd ? '1h' : 0 }));

  // ---------- Error handling ----------
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err && err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid request.' });
    console.error(err);
    if (res.headersSent) return;
    if (err && err.name === 'ValidationError') return res.status(400).json({ error: 'Invalid data.' });
    res.status(500).json({ error: 'Something went wrong on the server. Please try again.' });
  });

  return app;
}

module.exports = { createApp };
