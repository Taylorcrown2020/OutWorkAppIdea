'use strict';
/* Account forms: sign up, log in, forgot password, reset, change password, change email, delete account.

   These are plain HTML forms that post straight to the server. No JavaScript in the
   browser ever reads, holds or sends a password. The server answers with a redirect,
   and a short code in the address tells the page which message to show. */
const crypto = require('crypto');
const express = require('express');
const { q, audit } = require('./db');
const auth = require('./auth');
const mail = require('./mail');

const router = express.Router();
const wrap = (fn) => (req, res, next) => fn(req, res, next).catch(next);
const str = (v, max) => String(v == null ? '' : v).trim().slice(0, max);
const isEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v) && v.length <= 200;
const MIN_PASSWORD = 10;
const RESET_MINUTES = 60;
const goodPassword = (p) => typeof p === 'string' && p.length >= MIN_PASSWORD && p.length <= 200;
const cleanCode = (v) => String(v || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
const go = (res, path) => res.redirect(303, path);

// Forms must be submitted from this site's own pages.
router.use((req, res, next) => {
  if (req.method !== 'POST') return res.status(405).send('Method not allowed');
  const from = req.get('origin') || req.get('referer') || '';
  let host = '';
  try { host = new URL(from).host; } catch (e) { /* ignore */ }
  if (host !== req.get('host')) return res.status(403).send('Request blocked.');
  next();
});

router.post('/signup', wrap(async (req, res) => {
  const fullName = str(req.body.fullName, 80), email = str(req.body.email, 200).toLowerCase(), code = cleanCode(req.body.code);
  const back = (e) => go(res, `/signup.html?e=${e}${code ? '&code=' + code : ''}`);
  if (fullName.length < 2) return back('name');
  if (!isEmail(email)) return back('email');
  if (!goodPassword(req.body.password)) return back('password');
  const exists = await q('SELECT 1 FROM users WHERE lower(email) = $1', [email]);
  if (exists.rows.length) return back('exists');
  const r = await q('INSERT INTO users (email, full_name, password_hash) VALUES ($1,$2,$3) RETURNING id', [email, fullName, auth.hashPassword(req.body.password)]);
  await audit(req, r.rows[0].id, 'signup', {});
  go(res, `/login.html?created=1${code ? '&code=' + code : ''}`);   // no session yet: the person logs in next
}));

router.post('/login', wrap(async (req, res) => {
  const email = str(req.body.email, 200), password = String(req.body.password || '').slice(0, 200), code = cleanCode(req.body.code);
  const tail = code ? '&code=' + code : '';
  if (!email || !password) return go(res, '/login.html?e=bad' + tail);
  const out = await auth.login(req, res, email, password);
  if (out.status === 429) return go(res, '/login.html?e=locked' + tail);
  if (out.status !== 200) return go(res, '/login.html?e=bad' + tail);
  go(res, '/dashboard.html' + (code ? '?code=' + code : ''));
}));

router.post('/logout', wrap(async (req, res) => { await auth.logout(req, res); go(res, '/login.html'); }));

/* Forgot password. The answer is the same whether or not the email has an account. */
router.post('/forgot', wrap(async (req, res) => {
  const email = str(req.body.email, 200).toLowerCase();
  if (isEmail(email)) {
    const u = (await q('SELECT id, full_name, email FROM users WHERE lower(email) = $1', [email])).rows[0];
    if (u) {
      const token = crypto.randomBytes(32).toString('base64url');
      await q('DELETE FROM password_resets WHERE user_id = $1', [u.id]);   // only the newest link works
      await q(`INSERT INTO password_resets (user_id, token_hash, expires_at) VALUES ($1,$2, now() + ($3 || ' minutes')::interval)`,
        [u.id, auth.sha256(token), String(RESET_MINUTES)]);
      mail.reset(u.email, u.full_name, token, RESET_MINUTES);
      await audit(req, u.id, 'password_reset_requested', {});
    } else {
      await audit(req, null, 'password_reset_requested', { unknownEmail: true });
    }
  }
  go(res, '/forgot.html?sent=1');
}));

router.post('/reset', wrap(async (req, res) => {
  const token = str(req.body.token, 200);
  const r = await q(`SELECT id, user_id FROM password_resets WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now()`, [auth.sha256(token)]);
  if (!token || !r.rows.length) return go(res, '/forgot.html?e=expired');
  if (!goodPassword(req.body.password)) return go(res, '/reset.html?e=password#token=' + encodeURIComponent(token));
  const row = r.rows[0];
  await q('UPDATE users SET password_hash = $2, failed_logins = 0, locked_until = NULL WHERE id = $1', [row.user_id, auth.hashPassword(req.body.password)]);
  await q('UPDATE password_resets SET used_at = now() WHERE id = $1', [row.id]);
  await q('DELETE FROM sessions WHERE user_id = $1', [row.user_id]);   // sign out everywhere
  await audit(req, row.user_id, 'password_reset', {});
  go(res, '/login.html?reset=1');
}));

/* ---------- signed in ---------- */
router.use(wrap(async (req, res, next) => {
  req.user = await auth.currentUser(req, res);
  if (!req.user) return go(res, '/login.html');
  next();
}));
const profile = (res, q2) => go(res, '/dashboard.html?tab=profile&' + q2);
const passwordOf = async (id) => (await q('SELECT password_hash FROM users WHERE id = $1', [id])).rows[0].password_hash;

router.post('/password', wrap(async (req, res) => {
  if (!auth.verifyPassword(String(req.body.current || ''), await passwordOf(req.user.id))) return profile(res, 'e=pw_current');
  if (!goodPassword(req.body.next)) return profile(res, 'e=pw_weak');
  await q('UPDATE users SET password_hash = $2 WHERE id = $1', [req.user.id, auth.hashPassword(req.body.next)]);
  await q('DELETE FROM sessions WHERE user_id = $1 AND id <> $2', [req.user.id, req.user.sid]);   // sign out every other device
  await audit(req, req.user.id, 'password_change', {});
  profile(res, 'msg=pw_ok');
}));

router.post('/email', wrap(async (req, res) => {
  const email = str(req.body.email, 200).toLowerCase();
  if (!isEmail(email)) return profile(res, 'e=email_bad');
  if (!auth.verifyPassword(String(req.body.current || ''), await passwordOf(req.user.id))) return profile(res, 'e=email_pw');
  const taken = await q('SELECT 1 FROM users WHERE lower(email) = $1 AND id <> $2', [email, req.user.id]);
  if (taken.rows.length) return profile(res, 'e=email_taken');
  await q('UPDATE users SET email = $2 WHERE id = $1', [req.user.id, email]);
  await audit(req, req.user.id, 'email_change', {});
  profile(res, 'msg=email_ok');
}));

router.post('/delete', wrap(async (req, res) => {
  if (!auth.verifyPassword(String(req.body.password || ''), await passwordOf(req.user.id))) return profile(res, 'e=del_pw');
  // An admin cannot walk away from a running challenge that still has other people in it.
  const stuck = await q(`SELECT 1 FROM groups g WHERE g.admin_id = $1 AND g.end_date >= current_date
                         AND EXISTS (SELECT 1 FROM memberships m WHERE m.group_id = g.id AND m.status = 'active' AND m.user_id <> $1)`, [req.user.id]);
  if (stuck.rows.length) return profile(res, 'e=del_admin');
  const mine = await q('SELECT id FROM groups WHERE admin_id = $1', [req.user.id]);
  for (const g of mine.rows) {
    const next = (await q(`SELECT user_id FROM memberships WHERE group_id = $1 AND status = 'active' AND user_id <> $2 ORDER BY joined_at LIMIT 1`, [g.id, req.user.id])).rows[0];
    if (!next) { await q('DELETE FROM groups WHERE id = $1', [g.id]); continue; }
    await q('UPDATE groups SET admin_id = $2 WHERE id = $1', [g.id, next.user_id]);   // a finished challenge passes to its longest standing member
    await q(`UPDATE memberships SET role = CASE WHEN user_id = $2 THEN 'admin' ELSE 'member' END WHERE group_id = $1`, [g.id, next.user_id]);
  }
  await audit(req, req.user.id, 'account_deleted', {});
  await q('DELETE FROM users WHERE id = $1', [req.user.id]);   // memberships, workouts, PRs and sessions go with it
  auth.clearCookie(res);
  go(res, '/index.html');
}));

module.exports = router;
