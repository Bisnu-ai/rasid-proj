'use strict';

/**
 * Minimal in-memory stand-in for src/models.js, used by the workflow test when
 * no real MongoDB is available (set TEST_MONGODB_URI to test against MongoDB).
 * It implements only the model calls that the application uses.
 */

const mongoose = require('mongoose');

const newId = () => new mongoose.Types.ObjectId();
const sameId = (a, b) => String(a) === String(b);

function query(getValue) {
  const q = {
    sort() { return q; },
    lean() { return q; },
    cursor() {
      const rows = getValue();
      return (async function* () { for (const r of rows) yield r; })();
    },
    then(res, rej) { return Promise.resolve().then(() => getValue()).then(res, rej); },
  };
  return q;
}

const store = { receipts: [], users: [], submissions: [] };

const Receipt = {
  async create(doc) {
    if (!doc.donorName || !Number.isSafeInteger(doc.amount) || doc.amount < 1 || !(doc.dateTime instanceof Date)) {
      const e = new Error('Validation failed');
      e.name = 'ValidationError';
      throw e;
    }
    // Only the three business fields are stored (like the real schema).
    const rec = { _id: newId(), donorName: doc.donorName.trim(), amount: doc.amount, dateTime: doc.dateTime };
    store.receipts.push(rec);
    return { ...rec };
  },
  async aggregate() {
    if (!store.receipts.length) return [];
    return [{ _id: null, totalPaise: store.receipts.reduce((s, r) => s + r.amount, 0), count: store.receipts.length }];
  },
  find() {
    return query(() => [...store.receipts].sort((a, b) => a.dateTime - b.dateTime).map((r) => ({ ...r })));
  },
  findById(id) {
    return query(() => {
      const r = store.receipts.find((x) => sameId(x._id, id));
      return r ? { ...r } : null;
    });
  },
};

const User = {
  async findOne({ username }) {
    return store.users.find((u) => u.username === username) || null;
  },
  findById(id) {
    return query(() => {
      const u = store.users.find((x) => sameId(x._id, id));
      return u ? { ...u } : null;
    });
  },
};

const Submission = {
  async create({ key }) {
    if (store.submissions.some((s) => s.key === key)) {
      const e = new Error('E11000 duplicate key');
      e.code = 11000;
      throw e;
    }
    const s = { _id: newId(), key, receiptId: null };
    store.submissions.push(s);
    return { ...s };
  },
  findOne({ key }) {
    return query(() => {
      const s = store.submissions.find((x) => x.key === key);
      return s ? { ...s } : null;
    });
  },
  async deleteOne({ _id }) {
    store.submissions = store.submissions.filter((s) => !sameId(s._id, _id));
  },
  async updateOne({ _id }, patch) {
    const s = store.submissions.find((x) => sameId(x._id, _id));
    if (s) Object.assign(s, patch);
  },
};

module.exports = { Receipt, User, Submission, store };
