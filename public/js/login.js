(function () {
  'use strict';

  var form = document.getElementById('loginForm');
  var btn = document.getElementById('loginBtn');
  var msg = document.getElementById('msg');

  function showError(text) {
    msg.textContent = text;
    msg.classList.add('show');
  }

  // Already logged in? Go straight to the dashboard.
  fetch('/api/auth/me', { credentials: 'same-origin' })
    .then(function (r) { if (r.ok) window.location.replace('/dashboard.html'); })
    .catch(function () {});

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    msg.classList.remove('show');
    var username = document.getElementById('username').value.trim();
    var password = document.getElementById('password').value;
    if (!username || !password) return showError('Enter username and password.');

    btn.disabled = true;
    btn.textContent = 'Logging in…';
    fetch('/api/auth/login', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'fetch' },
      body: JSON.stringify({ username: username, password: password })
    })
      .then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (data) { return { ok: r.ok, data: data }; });
      })
      .then(function (res) {
        if (res.ok) return window.location.replace('/dashboard.html');
        showError(res.data.error || 'Login failed.');
      })
      .catch(function () { showError('Network error. Check your connection and try again.'); })
      .then(function () {
        btn.disabled = false;
        btn.textContent = 'Log in';
      });
  });
})();
