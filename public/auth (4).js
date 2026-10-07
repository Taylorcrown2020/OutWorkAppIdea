/* Log in, sign up, forgot password and reset pages.
   The forms on these pages post straight to the server. This script never reads,
   holds or sends a password. It only shows the right message, carries an invite
   code along, and hands the emailed reset token to the form. */
(function () {
  'use strict';
  var qs = new URLSearchParams(location.search);
  var ERR = {
    name: 'Enter your full name.',
    email: 'Enter a valid email address.',
    password: 'Use a password with at least 10 characters.',
    exists: 'An account already uses that email. Log in instead.',
    bad: 'That email and password do not match.',
    locked: 'Too many attempts. Try again in 15 minutes.',
    expired: 'That reset link has expired or was already used. Ask for a new one.'
  };
  var OK = {
    created: 'Account created. Log in with your new email and password.',
    reset: 'Password changed. Log in with your new password.',
    sent: 'If that email has an account, a reset link is on its way. It works for one hour.'
  };
  var errBox = document.getElementById('formErr'), okBox = document.getElementById('formOk');
  if (errBox && ERR[qs.get('e')]) errBox.textContent = ERR[qs.get('e')];
  if (okBox) Object.keys(OK).forEach(function (k) { if (qs.get(k)) { okBox.textContent = OK[k]; okBox.hidden = false; } });

  // An invite link looks like signup.html?code=ABC123. Pass the code along with the form.
  var code = (qs.get('code') || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
  var codeInput = document.querySelector('input[name="code"]');
  if (codeInput) codeInput.value = code;
  Array.prototype.forEach.call(document.querySelectorAll('a[data-keep-code]'), function (a) { if (code) a.href += '?code=' + code; });

  // The reset link carries its token after the #, so it is never sent in an address. Move it into the form.
  var tokenInput = document.querySelector('input[name="token"]');
  if (tokenInput) {
    var m = /token=([^&]+)/.exec(location.hash);
    if (!m) { location.replace('forgot.html?e=expired'); return; }
    tokenInput.value = decodeURIComponent(m[1]);
  }

  // Tidy the address bar so codes and tokens do not linger in history.
  try { history.replaceState(null, '', location.pathname + (code ? '?code=' + code : '')); } catch (e) {}

  // Already logged in: go straight to the dashboard.
  if (document.body.getAttribute('data-page') === 'login' && !qs.get('created') && !qs.get('reset') && !qs.get('e')) {
    fetch('/api/me', { credentials: 'same-origin' }).then(function (r) { if (r.ok) location.replace('dashboard.html' + (code ? '?code=' + code : '')); }).catch(function () {});
  }
})();
