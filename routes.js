'use strict';
const crypto = require('crypto');
const { q, audit } = require('./db');

const COOKIE = 'ow_session';
const SESSION_DAYS = 14;          // a session ends after this long without use
const MAX_FAILED = 8;             // failed sign ins before the account is locked
const LOCK_MINUTES = 15;
const PROD = process.env.NODE_ENV === 'production';

/* Passwords are stored as salted scrypt hashes, never in readable form. */
function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$16384$${salt.toString('hex')}$${hash.toString('hex')}`;
}
function verifyPassword(password, stored) {
  const p = String(stored || '').split('$');
  if (p.length !== 4 || p[0] !== 'scrypt') return false;
  const expected = Buffer.from(p[3], 'hex');
  const got = crypto.scryptSync(password, Buffer.from(p[2], 'hex'), expected.length, { N: Number(p[1]), r: 8, p: 1 });
  return crypto.timingSafeEqual(expected, got);
}
// Used to spend the same time on unknown emails as on real ones.
const DUMMY_HASH = hashPassword(crypto.randomBytes(12).toString('hex'));

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

function readCookie(req, name) {
  const raw = req.headers.cookie || '';
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return '';
}
function setCookie(res, token) {
  res.cookie(COOKIE, token, { httpOnly: true, secure: PROD, sameSite: 'lax', path: '/', maxAge: SESSION_DAYS * 86400000 });
}
function clearCookie(res) {
  res.clearCookie(COOKIE, { httpOnly: true, secure: PROD, sameSite: 'lax', path: '/' });
}

async function startSession(req, res, userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  await q(`INSERT INTO sessions (user_id, token_hash, ip, user_agent, expires_at)
           VALUES ($1,$2,$3,$4, now() + ($5 || ' days')::interval)`,
    [userId, sha256(token), req.ip, String(req.get('user-agent') || '').slice(0, 300), String(SESSION_DAYS)]);
  setCookie(res, token);
}

/* Finds the signed in user from the session cookie, or null. */
async function currentUser(req, res) {
  const token = readCookie(req, COOKIE);
  if (!token) return null;
  const r = await q(`SELECT s.id AS sid, u.id, u.email, u.full_name, u.avatar
                     FROM sessions s JOIN users u ON u.id = s.user_id
                     WHERE s.token_hash = $1 AND s.expires_at > now()`, [sha256(token)]);
  if (!r.rows.length) { clearCookie(res); return null; }
  // Sliding expiry: each visit pushes the end of the session back.
  q(`UPDATE sessions SET last_seen_at = now(), expires_at = now() + ($2 || ' days')::interval
     WHERE id = $1 AND last_seen_at < now() - interval '10 minutes'`, [r.rows[0].sid, String(SESSION_DAYS)]).catch(() => {});
  return r.rows[0];
}
/* For the API: loads req.user or answers 401. */
async function requireAuth(req, res, next) {
  try {
    req.user = await currentUser(req, res);
    if (!req.user) return res.status(401).json({ error: 'Please log in.' });
    next();
  } catch (e) { next(e); }
}

async function login(req, res, email, password) {
  const r = await q('SELECT id, password_hash, failed_logins, locked_until FROM users WHERE lower(email) = lower($1)', [email]);
  const u = r.rows[0];
  const generic = { status: 401, error: 'That email and password do not match.' };
  if (!u) { verifyPassword(password, DUMMY_HASH); await audit(req, null, 'login_failed', { reason: 'unknown_email' }); return generic; }
  if (u.locked_until && new Date(u.locked_until) > new Date()) {
    await audit(req, u.id, 'login_blocked', {});
    return { status: 429, error: `Too many attempts. Try again in ${LOCK_MINUTES} minutes.` };
  }
  if (!verifyPassword(password, u.password_hash)) {
    const fails = u.failed_logins + 1;
    await q(`UPDATE users SET failed_logins = $2::int, locked_until = CASE WHEN $2::int >= $3::int THEN now() + ($4 || ' minutes')::interval ELSE NULL END WHERE id = $1`,
      [u.id, fails, MAX_FAILED, String(LOCK_MINUTES)]);
    await audit(req, u.id, 'login_failed', { fails });
    return generic;
  }
  await q('UPDATE users SET failed_logins = 0, locked_until = NULL, last_login_at = now() WHERE id = $1', [u.id]);
  await startSession(req, res, u.id);
  await audit(req, u.id, 'login', {});
  return { status: 200 };
}

async function logout(req, res) {
  const token = readCookie(req, COOKIE);
  if (token) await q('DELETE FROM sessions WHERE token_hash = $1', [sha256(token)]);
  clearCookie(res);
}

module.exports = { hashPassword, verifyPassword, currentUser, requireAuth, login, logout, startSession, clearCookie, sha256 };
