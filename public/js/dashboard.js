(function () {
  'use strict';

  var els = {
    who: document.getElementById('who'),
    total: document.getElementById('totalCollection'),
    count: document.getElementById('totalReceipts'),
    form: document.getElementById('receiptForm'),
    name: document.getElementById('donorName'),
    amount: document.getElementById('amount'),
    save: document.getElementById('saveBtn'),
    msg: document.getElementById('msg'),
    exportBtn: document.getElementById('exportBtn'),
    exportMsg: document.getElementById('exportMsg'),
    logout: document.getElementById('logoutBtn')
  };

  var NAME_RE = /^[A-Za-z][A-Za-z .'\-]{1,79}$/;
  var AMOUNT_RE = /^\d{1,9}(\.\d{1,2})?$/;

  // One idempotency key per receipt attempt: prevents duplicate records on
  // double-clicks, retries and flaky networks. Replaced after every success.
  function newKey() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    var a = new Uint8Array(16);
    crypto.getRandomValues(a);
    return Array.prototype.map.call(a, function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
  }
  var submissionId = newKey();
  var submitting = false;

  function api(path, opts) {
    opts = opts || {};
    opts.credentials = 'same-origin';
    opts.headers = Object.assign({ 'X-Requested-With': 'fetch' }, opts.headers || {});
    return fetch(path, opts).then(function (r) {
      if (r.status === 401 || r.status === 403) {
        window.location.replace('/login.html');
        throw new Error('auth');
      }
      return r;
    });
  }

  function show(el, text, kind) {
    el.className = 'msg show ' + kind;
    el.textContent = text;
  }
  function hide(el) { el.className = 'msg'; el.textContent = ''; }

  function renderStats(s) {
    els.total.textContent = s.totalFormatted;
    els.count.textContent = String(s.count);
  }

  function loadStats() {
    return api('/api/stats')
      .then(function (r) { return r.json(); })
      .then(renderStats)
      .catch(function (e) { if (e.message !== 'auth') show(els.msg, 'Could not load totals. Please refresh.', 'error'); });
  }

  function saveBlob(blob, filename) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
  }

  function downloadReceipt(receipt) {
    return api('/api/receipts/' + encodeURIComponent(receipt.id) + '/pdf')
      .then(function (r) {
        if (!r.ok) throw new Error('pdf');
        return r.blob();
      })
      .then(function (blob) { saveBlob(blob, receipt.filename); });
  }

  function showSavedWithRetry(receipt) {
    els.msg.className = 'msg show ok';
    els.msg.textContent = 'Receipt saved for ' + receipt.donorName + ' (' + receipt.amountFormatted + '). ';
    var again = document.createElement('button');
    again.type = 'button';
    again.className = 'secondary small';
    again.textContent = 'Download receipt again';
    again.addEventListener('click', function () {
      again.disabled = true;
      downloadReceipt(receipt)
        .catch(function () { show(els.msg, 'Receipt is saved, but the PDF could not be downloaded. Try again.', 'error'); })
        .then(function () { again.disabled = false; });
    });
    els.msg.appendChild(document.createElement('br'));
    els.msg.appendChild(again);
  }

  els.form.addEventListener('submit', function (e) {
    e.preventDefault();
    if (submitting) return;
    hide(els.msg);

    var name = els.name.value.trim().replace(/\s+/g, ' ');
    var amount = els.amount.value.trim().replace(/,/g, '');
    if (!NAME_RE.test(name)) {
      els.name.focus();
      return show(els.msg, "Enter the donor name in English (letters, spaces, . ' - only).", 'error');
    }
    if (!AMOUNT_RE.test(amount) || parseFloat(amount) <= 0) {
      els.amount.focus();
      return show(els.msg, 'Enter a valid amount in rupees, e.g. 501 or 501.50.', 'error');
    }

    submitting = true;
    els.save.disabled = true;
    els.save.textContent = 'Saving…';

    var keepKey = false;
    api('/api/receipts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ donorName: name, amount: amount, submissionId: submissionId })
    })
      .then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (data) { return { status: r.status, ok: r.ok, data: data }; });
      })
      .then(function (res) {
        if (!res.ok) {
          // Keep the same key for server/in-progress errors so a retry cannot create a duplicate.
          keepKey = res.status >= 500 || res.status === 409;
          throw new Error(res.data.error || 'Could not save the receipt.');
        }
        // Saved in MongoDB -> update totals now, then download the PDF.
        renderStats(res.data.stats);
        submissionId = newKey();
        els.form.reset();
        els.name.focus();
        return downloadReceipt(res.data.receipt)
          .then(function () {
            show(els.msg, 'Receipt saved and downloaded for ' + res.data.receipt.donorName + ' (' + res.data.receipt.amountFormatted + ').', 'ok');
          })
          .catch(function () { showSavedWithRetry(res.data.receipt); });
      })
      .catch(function (err) {
        if (err.message === 'auth') return;
        if (err instanceof TypeError) { keepKey = true; err = new Error('Network error. Nothing was lost — tap Save again to retry.'); }
        if (!keepKey) submissionId = newKey();
        show(els.msg, err.message, 'error');
      })
      .then(function () {
        submitting = false;
        els.save.disabled = false;
        els.save.textContent = 'Save & Download Receipt';
      });
  });

  els.exportBtn.addEventListener('click', function () {
    hide(els.exportMsg);
    els.exportBtn.disabled = true;
    var label = els.exportBtn.textContent;
    els.exportBtn.textContent = 'Preparing Excel…';
    api('/api/export/excel')
      .then(function (r) {
        if (!r.ok) throw new Error('export');
        var cd = r.headers.get('Content-Disposition') || '';
        var m = /filename="([^"]+)"/.exec(cd);
        return r.blob().then(function (b) { saveBlob(b, m ? m[1] : 'Durga-Puja-Receipts.xlsx'); });
      })
      .catch(function (e) { if (e.message !== 'auth') show(els.exportMsg, 'Could not generate the Excel file. Please try again.', 'error'); })
      .then(function () {
        els.exportBtn.disabled = false;
        els.exportBtn.textContent = label;
      });
  });

  els.logout.addEventListener('click', function () {
    api('/api/auth/logout', { method: 'POST' })
      .catch(function () {})
      .then(function () { window.location.replace('/login.html'); });
  });

  api('/api/auth/me')
    .then(function (r) { return r.json(); })
    .then(function (u) { els.who.textContent = u.username; })
    .then(loadStats)
    .catch(function () {});
})();
