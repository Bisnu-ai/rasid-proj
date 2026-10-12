'use strict';

/**
 * End-to-end workflow test:
 *   login -> enter donor name + amount -> save -> download PDF -> dashboard totals -> Excel export
 *
 * Run:   npm test                                  (in-memory stand-in for the data layer)
 *        TEST_MONGODB_URI="mongodb+srv://..../durga_test" npm test   (real MongoDB)
 *
 * When TEST_MONGODB_URI is used, the database name must contain "test"; the
 * test wipes its collections, so never point it at your production database.
 */

const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { spawnSync } = require('node:child_process');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-test-secret-test-secret-123456';
const useReal = !!process.env.TEST_MONGODB_URI;
process.env.MONGODB_URI = process.env.TEST_MONGODB_URI || 'mongodb://unused-in-memory-test';
process.env.NODE_ENV = 'test';

const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');
const ExcelJS = require('exceljs');

let fake = null;
if (!useReal) {
  fake = require('./fakeModels');
  const modelsPath = require.resolve('../src/models');
  require.cache[modelsPath] = { id: modelsPath, filename: modelsPath, loaded: true, exports: fake };
}
const { Receipt, User, Submission } = require('../src/models');
const { createApp } = require('../src/app');
const { HEADER_LINES } = require('../src/pdf');

let passed = 0;
async function step(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ✔ ${name}`);
  } catch (err) {
    console.error(`  ✘ ${name}\n    ${err.message}`);
    process.exitCode = 1;
    throw err;
  }
}

async function main() {
  console.log(useReal ? 'Using REAL MongoDB (TEST_MONGODB_URI)' : 'Using in-memory data layer (no MongoDB available)');

  if (useReal) {
    await mongoose.connect(process.env.TEST_MONGODB_URI);
    assert.match(mongoose.connection.name, /test/i, 'Refusing to run: database name must contain "test"');
    await Promise.all([Receipt.deleteMany({}), User.deleteMany({}), Submission.deleteMany({})]);
    await mongoose.connection.syncIndexes();
  }
  const passwordHash = await bcrypt.hash('correct-horse-battery', 10);
  await User.create?.({ username: 'collector', passwordHash, role: 'creator' }) ;
  if (!useReal) fake.store.users.push({ _id: new mongoose.Types.ObjectId(), username: 'collector', passwordHash, role: 'creator', active: true });

  const server = createApp().listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  let cookie = '';

  async function call(method, url, body, { auth = true, headers = {} } = {}) {
    const h = { 'X-Requested-With': 'fetch', ...headers };
    if (body !== undefined) h['Content-Type'] = 'application/json';
    if (auth && cookie) h.Cookie = cookie;
    const res = await fetch(base + url, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
    const setCookie = res.headers.get('set-cookie');
    return { res, setCookie };
  }
  const json = async (r) => r.res.json();

  try {
    console.log('\nAccess control');
    await step('API rejects unauthenticated requests (stats, create, pdf, excel)', async () => {
      for (const [m, u, b] of [['GET', '/api/stats'], ['POST', '/api/receipts', { donorName: 'A B', amount: '5', submissionId: 'x'.repeat(20) }], ['GET', '/api/receipts/507f1f77bcf86cd799439011/pdf'], ['GET', '/api/export/excel']]) {
        const r = await call(m, u, b, { auth: false });
        assert.equal(r.res.status, 401, `${m} ${u}`);
      }
    });
    await step('no public registration endpoint', async () => {
      const r = await call('POST', '/api/auth/register', { username: 'hacker', password: 'hackerhacker1' }, { auth: false });
      assert.ok(![200, 201].includes(r.res.status));
    });
    await step('requests without the X-Requested-With header are refused', async () => {
      const r = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      assert.equal(r.status, 403);
    });
    await step('wrong password is rejected', async () => {
      const r = await call('POST', '/api/auth/login', { username: 'collector', password: 'nope-nope-nope' }, { auth: false });
      assert.equal(r.res.status, 401);
    });

    console.log('\nLogin');
    await step('login succeeds and sets an HttpOnly, SameSite=Strict session cookie', async () => {
      const r = await call('POST', '/api/auth/login', { username: 'Collector', password: 'correct-horse-battery' }, { auth: false });
      assert.equal(r.res.status, 200);
      assert.match(r.setCookie, /HttpOnly/i);
      assert.match(r.setCookie, /SameSite=Strict/i);
      cookie = r.setCookie.split(';')[0];
    });

    console.log('\nDashboard totals (empty)');
    await step('stats start at zero', async () => {
      const s = await json(await call('GET', '/api/stats'));
      assert.deepEqual([s.count, s.totalPaise, s.totalFormatted], [0, 0, '₹0.00']);
    });

    console.log('\nValidation');
    await step('invalid names and amounts are rejected, nothing saved', async () => {
      const key = () => 'k' + Math.random().toString(16).slice(2).padEnd(20, '0');
      const bad = [
        { donorName: '', amount: '100' },
        { donorName: 'R', amount: '100' },
        { donorName: 'Rahul123', amount: '100' },
        { donorName: 'ରାହୁଲ', amount: '100' },
        { donorName: '<script>', amount: '100' },
        { donorName: 'Rahul Kumar', amount: '0' },
        { donorName: 'Rahul Kumar', amount: '-5' },
        { donorName: 'Rahul Kumar', amount: 'abc' },
        { donorName: 'Rahul Kumar', amount: '10.123' },
        { donorName: 'Rahul Kumar', amount: '' },
        { donorName: 'Rahul Kumar', amount: '10000000.01' },
        { donorName: 'Rahul Kumar', amount: '1e3' },
      ];
      for (const b of bad) {
        const r = await call('POST', '/api/receipts', { ...b, submissionId: key() });
        assert.equal(r.res.status, 400, JSON.stringify(b));
      }
      const s = await json(await call('GET', '/api/stats'));
      assert.equal(s.count, 0);
    });

    console.log('\nCreate receipt');
    let first;
    const KEY1 = 'submission-key-0001-abcdef';
    await step('valid receipt is saved (201) and totals update immediately', async () => {
      const r = await call('POST', '/api/receipts', { donorName: '  Rahul   Kumar ', amount: '501', submissionId: KEY1 });
      assert.equal(r.res.status, 201);
      const data = await json(r);
      first = data.receipt;
      assert.equal(first.donorName, 'Rahul Kumar');
      assert.equal(first.amountPaise, 50100);
      assert.equal(first.amountFormatted, '₹501.00');
      assert.equal(data.duplicate, false);
      assert.deepEqual([data.stats.count, data.stats.totalPaise, data.stats.totalFormatted], [1, 50100, '₹501.00']);
    });
    await step('stored record contains ONLY donorName, amount (integer paise), dateTime', async () => {
      const docs = await Receipt.find({}).lean();
      assert.equal(docs.length, 1);
      const keys = Object.keys(docs[0]).filter((k) => !['_id', '__v'].includes(k)).sort();
      assert.deepEqual(keys, ['amount', 'dateTime', 'donorName']);
      assert.ok(Number.isInteger(docs[0].amount) && docs[0].amount === 50100);
      assert.ok(docs[0].dateTime instanceof Date);
      assert.ok(Math.abs(Date.now() - docs[0].dateTime.getTime()) < 60_000, 'server-generated timestamp');
    });
    await step('re-submitting the same key does not create a duplicate', async () => {
      const r = await call('POST', '/api/receipts', { donorName: 'Rahul Kumar', amount: '501', submissionId: KEY1 });
      const data = await json(r);
      assert.equal(r.res.status, 200);
      assert.equal(data.duplicate, true);
      assert.equal(data.receipt.id, first.id);
      assert.equal(data.stats.count, 1);
    });
    await step('5 concurrent submissions with one key create exactly one record', async () => {
      const KEY2 = 'submission-key-0002-abcdef';
      const rs = await Promise.all(Array.from({ length: 5 }, () => call('POST', '/api/receipts', { donorName: 'Sita Devi', amount: '1250.50', submissionId: KEY2 })));
      const statuses = rs.map((r) => r.res.status);
      assert.equal(statuses.filter((s) => s === 201).length, 1, statuses.join());
      assert.ok(statuses.every((s) => [200, 201, 409].includes(s)), statuses.join());
      const s = await json(await call('GET', '/api/stats'));
      assert.equal(s.count, 2);
      assert.equal(s.totalPaise, 50100 + 125050);
      assert.equal(s.totalFormatted, '₹1,751.50');
    });

    console.log('\nPDF receipt');
    await step('PDF downloads, embeds the Odia font, and shows only the allowed fields', async () => {
      const r = await call('GET', `/api/receipts/${first.id}/pdf`);
      assert.equal(r.res.status, 200);
      assert.equal(r.res.headers.get('content-type'), 'application/pdf');
      assert.match(r.res.headers.get('content-disposition'), /attachment; filename="Durga-Puja-Receipt-Rahul-Kumar\.pdf"/);
      const buf = Buffer.from(await r.res.arrayBuffer());
      assert.equal(buf.subarray(0, 5).toString(), '%PDF-');
      const f = path.join(os.tmpdir(), `receipt-${process.pid}.pdf`);
      fs.writeFileSync(f, buf);
      const fonts = spawnSync('pdffonts', [f], { encoding: 'utf8' });
      if (!fonts.error) {
        assert.match(fonts.stdout, /NotoSansOriya/, 'Odia font must be embedded');
        assert.match(fonts.stdout, /yes\s+yes/, 'font must be embedded + subset');
      }
      const txt = spawnSync('pdftotext', ['-layout', f, '-'], { encoding: 'utf8' });
      if (!txt.error) {
        const t = txt.stdout;
        assert.match(t, /Donor Name:\s+Rahul Kumar/);
        assert.match(t, /Amount:\s+₹501\.00/);
        assert.match(t, /Date:\s+\d{1,2} [A-Z][a-z]+ \d{4}/);
        assert.match(t, /Time:\s+\d{1,2}:\d{2} (AM|PM)/);
        assert.ok(!/receipt\s*(no|number)|mobile|phone|address|e-?mail|created by/i.test(t), 'no extra fields');
        const odiaLines = t.split('\n').filter((l) => /[଀-୿]/.test(l));
        console.log('    (extracted Odia text:', JSON.stringify(odiaLines.map((l) => l.trim())), ')');
        // pdftotext splits Indic clusters into fragments, so only check Odia text is present.
        // Visual shaping is verified by rendering the PDF to an image (see README).
        assert.ok(odiaLines.length >= 3, 'Odia header text present');
        assert.ok(odiaLines.join('').includes('୬୧ତମ ସାରଦୀୟ'), 'Odia numerals/text present');
      }
      fs.writeFileSync(path.join(os.tmpdir(), 'durga-sample-receipt.pdf'), buf);
      assert.equal(HEADER_LINES.length, 3);
    });
    await step('unknown / malformed receipt id -> 404', async () => {
      assert.equal((await call('GET', '/api/receipts/507f1f77bcf86cd799439011/pdf')).res.status, 404);
      assert.equal((await call('GET', '/api/receipts/not-an-id/pdf')).res.status, 404);
    });

    console.log('\nExcel export');
    await step('real .xlsx with 4 columns, all records, and a summary section', async () => {
      const r = await call('GET', '/api/export/excel');
      assert.equal(r.res.status, 200);
      assert.match(r.res.headers.get('content-type'), /spreadsheetml\.sheet/);
      assert.match(r.res.headers.get('content-disposition'), /\.xlsx"/);
      const buf = Buffer.from(await r.res.arrayBuffer());
      assert.equal(buf.subarray(0, 2).toString(), 'PK', 'xlsx is a zip container');
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(buf);
      const ws = wb.worksheets[0];
      assert.equal(ws.getCell('A2').value, 'Total Receipts');
      assert.equal(ws.getCell('B2').value, 2);
      assert.equal(ws.getCell('A3').value, 'Total Collection (INR)');
      assert.equal(ws.getCell('B3').value, 1751.5);
      assert.deepEqual([1, 2, 3, 4].map((c) => ws.getRow(5).getCell(c).value), ['Donor Name', 'Amount (INR)', 'Date', 'Time']);
      assert.equal(ws.columnCount, 4);
      const rows = [6, 7].map((n) => [1, 2, 3, 4].map((c) => ws.getRow(n).getCell(c).value));
      assert.deepEqual(rows.map((x) => x[0]).sort(), ['Rahul Kumar', 'Sita Devi']);
      assert.deepEqual(rows.map((x) => x[1]).sort((a, b) => a - b), [501, 1250.5]);
      rows.forEach((x) => {
        assert.match(x[2], /^\d{1,2} [A-Z][a-z]+ \d{4}$/);
        assert.match(x[3], /^\d{1,2}:\d{2} (AM|PM)$/);
      });
      assert.equal(ws.getRow(8).getCell(1).value, null, 'no extra rows');
      fs.writeFileSync(path.join(os.tmpdir(), 'durga-sample-export.xlsx'), buf);
    });

    console.log('\nSession handling');
    await step('deactivated user loses access immediately', async () => {
      const u = useReal ? await User.findOne({ username: 'collector' }) : fake.store.users[0];
      u.active = false;
      if (useReal) await u.save();
      const r = await call('GET', '/api/stats');
      assert.equal(r.res.status, 403);
      u.active = true;
      if (useReal) await u.save();
    });
    await step('logout clears the session', async () => {
      const r = await call('POST', '/api/auth/logout', {});
      assert.equal(r.res.status, 200);
      const saved = cookie;
      cookie = '';
      assert.equal((await call('GET', '/api/stats')).res.status, 401);
      cookie = saved;
    });

    console.log(`\nAll ${passed} checks passed.`);
  } finally {
    server.close();
    if (useReal) await mongoose.disconnect();
  }
}

main().catch((err) => {
  console.error('\nTEST FAILED:', err.message);
  process.exit(1);
});
