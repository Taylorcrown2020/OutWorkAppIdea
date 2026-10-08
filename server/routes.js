'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const { q, tx, audit } = require('./db');
const auth = require('./auth');
const mail = require('./mail');
const S = require('./scoring');

const router = express.Router();
const wrap = (fn) => (req, res, next) => fn(req, res, next).catch(next);
const str = (v, max) => String(v == null ? '' : v).trim().slice(0, max);
const isEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v) && v.length <= 200;
const isUuid = (v) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(v));
const bad = (res, msg, code) => res.status(code || 400).json({ error: msg });
const MIN_PASSWORD = 10;

/* ---------- live updates (server sent events) ----------
   Each open dashboard holds one connection. When something changes in a group,
   everyone in it is told to refresh. Works on a single server instance;
   running several instances needs a shared channel such as Redis. */
const groupStreams = new Map();   // group id -> Set of responses
const userStreams = new Map();    // user id  -> Set of responses
const addStream = (map, key, res) => { if (!map.has(key)) map.set(key, new Set()); map.get(key).add(res); };
const dropStream = (map, key, res) => { const s = map.get(key); if (s) { s.delete(res); if (!s.size) map.delete(key); } };
const push = (map, key, payload) => { const s = map.get(key); if (s) for (const res of s) res.write(`data: ${JSON.stringify(payload)}\n\n`); };
const tellGroup = (groupId, what) => push(groupStreams, groupId, { type: 'group', what });
const tellUser = (userId, what) => push(userStreams, userId, { type: 'me', what });

async function addEvent(groupId, actorId, type, data) {
  await q('INSERT INTO events (group_id, actor_id, type, data) VALUES ($1,$2,$3,$4)', [groupId, actorId, type, JSON.stringify(data || {})]);
}
async function notify(userId, type, data) {
  await q('INSERT INTO notifications (user_id, type, data) VALUES ($1,$2,$3)', [userId, type, JSON.stringify(data || {})]);
  tellUser(userId, 'notification');
}

/* ---------- shared lookups ---------- */
function avatarList() {
  try {
    return fs.readdirSync(path.join(__dirname, '..', 'public', 'avatars'))
      .filter((f) => /\.(png|jpe?g|webp|svg)$/i.test(f)).sort();
  } catch (e) { return []; }
}
async function loadPrs(userId) {
  const r = await q('SELECT cat, data FROM prs WHERE user_id = $1', [userId]);
  const out = {};
  for (const row of r.rows) out[row.cat] = row.data;
  return out;
}
async function savePr(run, userId, cat, data) {
  await run(`INSERT INTO prs (user_id, cat, data) VALUES ($1,$2,$3)
             ON CONFLICT (user_id, cat) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`, [userId, cat, JSON.stringify(data)]);
}
/* Loads a group the signed in person is an active member of. */
async function loadGroup(req, res, needAdmin) {
  if (!isUuid(req.params.id)) { bad(res, 'Group not found.', 404); return null; }
  const r = await q(`SELECT g.id, g.name, g.code, g.admin_id, g.daily_cap, g.rates,
                            to_char(g.start_date,'YYYY-MM-DD') AS start_date, to_char(g.end_date,'YYYY-MM-DD') AS end_date,
                            g.closed_at, m.role, m.id AS membership_id
                     FROM groups g JOIN memberships m ON m.group_id = g.id
                     WHERE g.id = $1 AND m.user_id = $2 AND m.status = 'active'`, [req.params.id, req.user.id]);
  if (!r.rows.length) { bad(res, 'Group not found.', 404); return null; }
  if (needAdmin && r.rows[0].role !== 'admin') { bad(res, 'Only the group admin can do that.', 403); return null; }
  return r.rows[0];
}

/* Builds the leaderboard for a group, plus per day totals used by the power rankings. */
async function buildBoard(group) {
  const members = (await q(`SELECT u.id, u.full_name, u.avatar, m.role, m.joined_at
                            FROM memberships m JOIN users u ON u.id = m.user_id
                            WHERE m.group_id = $1 AND m.status = 'active'`, [group.id])).rows;
  const logs = (await q(`SELECT user_id, to_char(date,'YYYY-MM-DD') AS date, base + perf + pr_pts AS pts, created_at
                         FROM workouts WHERE group_id = $1 AND date BETWEEN $2 AND $3`, [group.id, group.start_date, group.end_date])).rows;
  const by = {};
  for (const m of members) by[m.id] = { id: m.id, name: m.full_name, avatar: m.avatar, role: m.role, joined: m.joined_at, points: 0, workouts: 0, last: 0, days: {} };
  for (const l of logs) {
    const r = by[l.user_id]; if (!r) continue;
    r.days[l.date] = (r.days[l.date] || 0) + l.pts;
    r.workouts++; r.last = Math.max(r.last, new Date(l.created_at).getTime());
  }
  const rows = Object.values(by).map((r) => {
    const streaks = S.streakByDay(r.days);
    r.totals = {};
    for (const d of Object.keys(r.days)) { r.totals[d] = r.days[d] + streaks[d]; r.points += r.totals[d]; }
    r.streak = S.currentStreak(r.days);
    return r;
  }).sort((a, b) => b.points - a.points || (a.points ? a.last - b.last : new Date(a.joined) - new Date(b.joined)));
  rows.forEach((r, i) => { r.rank = i + 1; r.behind = rows[0].points - r.points; });
  return rows;
}
/* A challenge is over when its last day has passed or the admin shut it down. */
/* The server's day is UTC and a player's day can trail it, so the last day gets one day of grace here.
   The dashboard decides "over" from the player's own calendar. */
const isOver = (g) => !!g.closed_at || S.dayNum(S.todayStr()) - S.dayNum(g.end_date) > 1;
/* A date sent by the browser is trusted only if it is within a day of the server's. */
const clientDay = (v) => { const t = S.todayStr(); return /^\d{4}-\d{2}-\d{2}$/.test(v || '') && Math.abs(S.dayNum(v) - S.dayNum(t)) <= 1 ? v : t; };
const publicRow = (r) => ({ id: r.id, name: r.name, avatar: r.avatar, role: r.role, points: r.points, workouts: r.workouts, streak: r.streak, rank: r.rank, behind: r.behind });

/* ======================= accounts ======================= */
/* Sign up, log in and every password form live in forms.js as plain HTML form posts. */
router.post('/auth/logout', wrap(async (req, res) => { await auth.logout(req, res); res.json({ ok: true }); }));

router.use(auth.requireAuth);   // everything below needs a signed in person

router.get('/me', wrap(async (req, res) => {
  const groups = (await q(`SELECT g.id, g.name, g.code, g.admin_id, g.daily_cap, g.rates, g.closed_at, m.role,
                                  to_char(g.start_date,'YYYY-MM-DD') AS start_date, to_char(g.end_date,'YYYY-MM-DD') AS end_date
                           FROM memberships m JOIN groups g ON g.id = m.group_id
                           WHERE m.user_id = $1 AND m.status = 'active' ORDER BY (g.closed_at IS NOT NULL), g.end_date DESC, m.joined_at DESC`, [req.user.id])).rows;
  const list = [];
  for (const g of groups) {   // where this person stands in each of their groups
    const rows = await buildBoard(g), me = rows.find((r) => r.id === req.user.id);
    list.push({ id: g.id, name: g.name, role: g.role, start: g.start_date, end: g.end_date, closed: !!g.closed_at, rates: g.rates,
      members: rows.length, rank: me ? me.rank : 0, points: me ? me.points : 0, leader: rows[0] && rows[0].points > 0 ? rows[0].name : '' });
  }
  const prs = await loadPrs(req.user.id);
  // First time here and no PRs saved yet: the dashboard sends them to enter their PRs.
  const welcomed = (await q('SELECT welcomed_at FROM users WHERE id = $1', [req.user.id])).rows[0].welcomed_at;
  const unread = (await q('SELECT count(*)::int AS n FROM notifications WHERE user_id = $1 AND read_at IS NULL', [req.user.id])).rows[0].n;
  res.json({
    user: { id: req.user.id, fullName: req.user.full_name, email: req.user.email, avatar: req.user.avatar },
    groups: list, unread, prs, firstVisit: !welcomed && !Object.keys(prs).length, avatars: avatarList(), today: S.todayStr(),
    scoring: { cats: S.CATS, order: S.CAT_ORDER, lifts: S.LIFTS, paceBonus: S.PACE_BONUS, prPoints: S.PR_POINTS, streakStep: S.STREAK_STEP, streakCap: S.STREAK_CAP }
  });
}));

/* Name and icon. Email and password changes go through forms.js because they need the current password. */
router.patch('/me', wrap(async (req, res) => {
  const fullName = str(req.body.fullName, 80), avatar = str(req.body.avatar, 120);
  if (fullName.length < 2) return bad(res, 'Enter your full name.');
  if (avatar && !avatarList().includes(avatar)) return bad(res, 'Pick one of the icons shown.');
  await q('UPDATE users SET full_name = $2, avatar = $3 WHERE id = $1', [req.user.id, fullName, avatar]);
  await audit(req, req.user.id, 'profile_update', {});
  const gs = await q(`SELECT group_id FROM memberships WHERE user_id = $1 AND status = 'active'`, [req.user.id]);
  gs.rows.forEach((g) => tellGroup(g.group_id, 'board'));
  res.json({ ok: true });
}));

/* The "enter your PRs" prompt was shown. It does not appear again. */
router.post('/me/welcomed', wrap(async (req, res) => {
  await q('UPDATE users SET welcomed_at = COALESCE(welcomed_at, now()) WHERE id = $1', [req.user.id]);
  res.json({ ok: true });
}));

router.put('/me/prs', wrap(async (req, res) => {
  const body = req.body.prs || {};
  for (const cat of S.CAT_ORDER) {
    const c = S.CATS[cat], f = body[cat];
    if (!f) continue;
    if (c.type === 'dist') {
      const hasAny = str(f.dist, 20) || str(f.time, 20);
      const dist = Math.min(S.num(f.dist), c.max), mins = S.parseTime(f.time);
      if (hasAny && !(dist && mins)) return bad(res, `For ${c.label}, enter both a distance and a time like 25:00.`);
      if (dist && mins) await savePr(q, req.user.id, cat, { dist, mins, pace: mins / (dist / c.per) });
      else await q('DELETE FROM prs WHERE user_id = $1 AND cat = $2', [req.user.id, cat]);
    } else {
      await savePr(q, req.user.id, cat, { squat: Math.min(S.num(f.squat), 2000), bench: Math.min(S.num(f.bench), 2000), dead: Math.min(S.num(f.dead), 2000) });
    }
  }
  await q('UPDATE users SET welcomed_at = COALESCE(welcomed_at, now()) WHERE id = $1', [req.user.id]);
  res.json({ ok: true, prs: await loadPrs(req.user.id) });
}));

router.get('/notifications', wrap(async (req, res) => {
  const r = await q('SELECT id, type, data, created_at, read_at FROM notifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT 30', [req.user.id]);
  res.json({ notifications: r.rows });
}));
router.post('/notifications/read', wrap(async (req, res) => {
  await q('UPDATE notifications SET read_at = now() WHERE user_id = $1 AND read_at IS NULL', [req.user.id]);
  res.json({ ok: true });
}));

/* ======================= groups ======================= */
function readRates(input) {
  const rates = {};
  for (const cat of S.CAT_ORDER) {
    const v = (input || {})[cat];
    if (v === undefined || v === null || v === false || v === '') continue;
    const n = Math.round(S.num(v) * 100) / 100;
    if (!(n >= 0.1 && n <= 100)) return { error: `Set the ${S.CATS[cat].label} rate between 0.1 and 100.` };
    rates[cat] = n;
  }
  if (!Object.keys(rates).length) return { error: 'Keep at least one workout category switched on.' };
  return { rates };
}
function readInvites(list) {
  const out = [], seen = new Set();
  for (const row of (Array.isArray(list) ? list : []).slice(0, 100)) {
    const name = str(row && row.name, 80), email = str(row && row.email, 200).toLowerCase();
    if (!name && !email) continue;
    if (!name || !isEmail(email)) return { error: 'Each invite needs a name and a valid email.' };
    if (!seen.has(email)) { seen.add(email); out.push({ name, email }); }
  }
  return { invites: out };
}
async function sendInvites(group, inviter, invites) {
  let sent = 0;
  for (const inv of invites) {
    const r = await q(`INSERT INTO invites (group_id, name, email, invited_by) VALUES ($1,$2,$3,$4) ON CONFLICT (group_id, email) DO NOTHING RETURNING id`,
      [group.id, inv.name, inv.email, inviter.id]);
    if (r.rows.length) { sent++; mail.invite(inv.email, inv.name, inviter.full_name, group.name, group.code); }
  }
  return sent;
}
function makeCode() {
  const a = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  return Array.from(crypto.randomBytes(6), (b) => a[b % a.length]).join('');
}

router.post('/groups', wrap(async (req, res) => {
  const name = str(req.body.name, 60);
  if (name.length < 2) return bad(res, 'Give the group a name.');
  const days = Math.round(S.num(req.body.days));
  if (!(days >= 1 && days <= 365)) return bad(res, 'Set how long the challenge runs, from 1 to 365 days.');
  const cap = Math.round(Number(req.body.dailyCap));
  if (!(cap >= 0 && cap <= 10)) return bad(res, 'Pick how many workouts count per day.');
  const rr = readRates(req.body.rates); if (rr.error) return bad(res, rr.error);
  const ri = readInvites(req.body.invites); if (ri.error) return bad(res, ri.error);
  const start = clientDay(req.body.today), end = S.dayStr(S.dayNum(start) + days - 1);   // starts on the creator's own day
  let group;
  for (let attempt = 0; attempt < 5 && !group; attempt++) {
    try {
      group = await tx(async (run) => {
        const g = (await run(`INSERT INTO groups (name, code, admin_id, start_date, end_date, daily_cap, rates, start_local) VALUES ($1,$2,$3,$4,$5,$6,$7,true) RETURNING id, name, code`,
          [name, makeCode(), req.user.id, start, end, cap, JSON.stringify(rr.rates)])).rows[0];
        await run(`INSERT INTO memberships (group_id, user_id, status, role, joined_at) VALUES ($1,$2,'active','admin', now())`, [g.id, req.user.id]);
        return g;
      });
    } catch (e) { if (e.code !== '23505') throw e; }   // code collision: try another
  }
  if (!group) throw new Error('Could not create a unique group code');
  const sent = await sendInvites(group, req.user, ri.invites);
  await audit(req, req.user.id, 'group_created', { groupId: group.id, invites: sent });
  res.status(201).json({ id: group.id, code: group.code, invitesSent: sent });
}));

/* Entering the code puts the person straight into the group. Nobody has to let them in. */
router.post('/groups/join', wrap(async (req, res) => {
  const code = str(req.body.code, 12).toUpperCase();
  if (code.length !== 6) return bad(res, 'Enter the six character group code.');
  const g = (await q(`SELECT g.id, g.name, g.admin_id, (g.end_date < current_date OR g.closed_at IS NOT NULL) AS over, u.email AS admin_email, u.full_name AS admin_name
                      FROM groups g JOIN users u ON u.id = g.admin_id WHERE g.code = $1`, [code])).rows[0];
  if (!g) return bad(res, 'No group uses that code. Check it with whoever invited you.', 404);
  if (g.over) return bad(res, 'That challenge has already ended.');
  const m = (await q('SELECT status FROM memberships WHERE group_id = $1 AND user_id = $2', [g.id, req.user.id])).rows[0];
  if (m && m.status === 'active') return bad(res, 'You are already in that group.', 409);
  await q(`INSERT INTO memberships (group_id, user_id, status, joined_at) VALUES ($1,$2,'active', now())
           ON CONFLICT (group_id, user_id) DO UPDATE SET status = 'active', joined_at = now(), last_seen_at = now(), left_at = NULL`, [g.id, req.user.id]);
  await addEvent(g.id, req.user.id, 'joined', { name: req.user.full_name });
  await notify(g.admin_id, 'member_joined', { groupId: g.id, group: g.name, name: req.user.full_name });
  mail.joined(g.admin_email, g.admin_name, req.user.full_name, g.name);
  mail.welcome(req.user.email, req.user.full_name, g.name);
  tellGroup(g.id, 'board');
  await audit(req, req.user.id, 'group_joined', { groupId: g.id });
  res.json({ ok: true, id: g.id, group: g.name });
}));

router.get('/groups/:id', wrap(async (req, res) => {
  const g = await loadGroup(req, res); if (!g) return;
  const rows = await buildBoard(g);
  const out = {
    group: { id: g.id, name: g.name, code: g.code, start: g.start_date, end: g.end_date, closed: !!g.closed_at, over: isOver(g), dailyCap: g.daily_cap, rates: g.rates, role: g.role, today: S.todayStr() },
    board: rows.map(publicRow)
  };
  if (g.role === 'admin') {
    out.invites = (await q(`SELECT i.id, i.name, i.email, i.created_at, i.sent_at, i.sends,
                              EXISTS (SELECT 1 FROM users u JOIN memberships m ON m.user_id = u.id AND m.group_id = i.group_id
                                      WHERE lower(u.email) = lower(i.email) AND m.status = 'active') AS joined
                            FROM invites i WHERE i.group_id = $1 ORDER BY i.created_at`, [g.id])).rows;
  }
  res.json(out);
}));

/* Power rankings: who is on course to win, and the numbers behind it. */
router.get('/groups/:id/power', wrap(async (req, res) => {
  const g = await loadGroup(req, res); if (!g) return;
  const rows = await buildBoard(g);
  const today = Math.min(S.dayNum(S.todayStr()), S.dayNum(g.end_date)), start = S.dayNum(g.start_date);
  const daysLeft = Math.max(0, S.dayNum(g.end_date) - S.dayNum(S.todayStr()));
  const sumRange = (totals, from, to) => { let n = 0; for (let d = from; d <= to; d++) n += totals[S.dayStr(d)] || 0; return n; };
  const out = rows.map((r) => {
    const first = Math.max(start, S.dayNum(new Date(r.joined).toISOString().slice(0, 10)));
    const elapsed = Math.max(1, today - first + 1);
    const win = Math.min(7, elapsed);
    const recent = sumRange(r.totals, today - win + 1, today) / win;                       // points a day, last 7 days
    const priorDays = Math.min(7, elapsed - win);
    const prior = priorDays > 0 ? sumRange(r.totals, today - win - priorDays + 1, today - win) / priorDays : null;
    const overall = r.points / elapsed;
    const pace = recent * 0.7 + overall * 0.3;                                             // recent form counts most
    const activeDays = Object.keys(r.days).filter((d) => S.dayNum(d) >= first && S.dayNum(d) <= today).length;
    return { id: r.id, name: r.name, avatar: r.avatar, rank: r.rank, points: r.points, streak: r.streak,
      perDay: Math.round(recent * 10) / 10, overallPerDay: Math.round(overall * 10) / 10,
      trend: prior === null ? 'new' : recent > prior * 1.1 ? 'up' : recent < prior * 0.9 ? 'down' : 'steady',
      activeDays, elapsed, projected: Math.round(r.points + pace * daysLeft) };
  }).sort((a, b) => b.projected - a.projected || b.points - a.points);
  out.forEach((r, i) => { r.projectedRank = i + 1; r.projectedBehind = out[0].projected - r.projected; });
  res.json({ daysLeft: g.closed_at ? 0 : daysLeft, over: isOver(g), rankings: out });
}));

/* What happened since this person last looked. Marks it as seen. */
router.get('/groups/:id/updates', wrap(async (req, res) => {
  const g = await loadGroup(req, res); if (!g) return;
  const r = await q(`SELECT e.type, e.data, e.created_at FROM events e JOIN memberships m ON m.id = $2
                     WHERE e.group_id = $1 AND e.created_at > m.last_seen_at AND (e.actor_id IS NULL OR e.actor_id <> $3)
                     ORDER BY e.created_at DESC LIMIT 25`, [g.id, g.membership_id, req.user.id]);
  await q('UPDATE memberships SET last_seen_at = now() WHERE id = $1', [g.membership_id]);
  res.json({ updates: r.rows });
}));

router.get('/groups/:id/feed', wrap(async (req, res) => {
  const g = await loadGroup(req, res); if (!g) return;
  const mine = req.query.mine === '1';
  const r = await q(`SELECT w.id, w.user_id, u.full_name AS name, u.avatar, w.cat, to_char(w.date,'YYYY-MM-DD') AS date, w.dist, w.mins, w.lifts,
                            w.base, w.perf, w.pr_pts, w.prs, w.note, w.created_at
                     FROM workouts w JOIN users u ON u.id = w.user_id
                     JOIN memberships m ON m.group_id = w.group_id AND m.user_id = w.user_id AND m.status = 'active'
                     WHERE w.group_id = $1 ${mine ? 'AND w.user_id = $2' : ''} ORDER BY w.created_at DESC LIMIT 100`, mine ? [g.id, req.user.id] : [g.id]);
  res.json({ workouts: r.rows });
}));

router.post('/groups/:id/invites', wrap(async (req, res) => {
  const g = await loadGroup(req, res, true); if (!g) return;
  if (isOver(g)) return bad(res, 'This challenge has ended, so nobody new can join it.');
  const ri = readInvites(req.body.invites); if (ri.error) return bad(res, ri.error);
  if (!ri.invites.length) return bad(res, 'Add at least one name and email.');
  const sent = await sendInvites(g, req.user, ri.invites);
  await audit(req, req.user.id, 'invites_sent', { groupId: g.id, sent });
  res.json({ ok: true, sent });
}));

/* Send an invite email again: one invite by id, or everyone who has not joined yet.
   The same invite cannot be sent again within a minute. */
const RESEND_WAIT_SECONDS = 60;
router.post('/groups/:id/invites/resend', wrap(async (req, res) => {
  const g = await loadGroup(req, res, true); if (!g) return;
  if (isOver(g)) return bad(res, 'This challenge has ended, so nobody new can join it.');
  const one = req.body.id;
  if (one !== undefined && !isUuid(one)) return bad(res, 'Invite not found.', 404);
  const waiting = (await q(`SELECT i.id, i.name, i.email, i.sent_at > now() - ($3 || ' seconds')::interval AS just_sent
                            FROM invites i WHERE i.group_id = $1 AND ($2::uuid IS NULL OR i.id = $2)
                              AND NOT EXISTS (SELECT 1 FROM users u JOIN memberships m ON m.user_id = u.id AND m.group_id = i.group_id
                                              WHERE lower(u.email) = lower(i.email) AND m.status = 'active')
                            ORDER BY i.created_at`, [g.id, one || null, String(RESEND_WAIT_SECONDS)])).rows;
  if (one && !waiting.length) return bad(res, 'That person has already joined.', 409);
  if (!waiting.length) return bad(res, 'Everyone you invited has already joined.', 409);
  const due = waiting.filter((i) => !i.just_sent);
  if (!due.length) return bad(res, 'That invite was just sent. Wait a minute before sending it again.', 429);
  for (const i of due) {
    await q('UPDATE invites SET sent_at = now(), sends = sends + 1 WHERE id = $1', [i.id]);
    mail.invite(i.email, i.name, req.user.full_name, g.name, g.code);
  }
  await audit(req, req.user.id, 'invites_resent', { groupId: g.id, sent: due.length });
  res.json({ ok: true, sent: due.length });
}));

/* The admin shuts the challenge down early. The standings freeze as they are,
   whoever is in first wins, and nothing more can be logged or removed. */
router.post('/groups/:id/close', wrap(async (req, res) => {
  const g = await loadGroup(req, res, true); if (!g) return;
  if (isOver(g)) return bad(res, 'This challenge has already ended.', 409);
  // The end date moves up to today (or the latest day anyone logged for, if their calendar runs ahead of the server's).
  await q(`UPDATE groups SET closed_at = now(),
             end_date = LEAST(end_date, GREATEST($2::date, COALESCE((SELECT max(date) FROM workouts WHERE group_id = $1), $2::date))) WHERE id = $1`, [g.id, S.todayStr()]);
  const rows = await buildBoard(g);
  const winner = rows[0] && rows[0].points > 0 ? rows[0] : null;
  await addEvent(g.id, req.user.id, 'closed', { name: req.user.full_name, winner: winner ? winner.name : '' });
  const people = (await q(`SELECT u.id, u.full_name, u.email FROM memberships m JOIN users u ON u.id = m.user_id
                           WHERE m.group_id = $1 AND m.status = 'active' AND u.id <> $2`, [g.id, req.user.id])).rows;
  for (const p of people) {
    await notify(p.id, 'challenge_closed', { groupId: g.id, group: g.name, name: req.user.full_name, winner: winner ? winner.name : '' });
    mail.closed(p.email, p.full_name, req.user.full_name, g.name, winner ? winner.name : '', winner ? winner.points : 0);
    tellUser(p.id, 'groups');
  }
  await audit(req, req.user.id, 'challenge_closed', { groupId: g.id });
  tellGroup(g.id, 'board'); tellUser(req.user.id, 'groups');
  res.json({ ok: true, winner: winner ? winner.name : '' });
}));

/* Members can leave. The admin cannot be removed and cannot leave while anyone else is in the group. */
router.post('/groups/:id/leave', wrap(async (req, res) => {
  const g = await loadGroup(req, res); if (!g) return;
  if (g.role === 'admin' && isOver(g)) {   // the challenge is finished: the admin can take it off their own list
    const n = (await q(`SELECT count(*)::int AS n FROM memberships WHERE group_id = $1 AND status = 'active' AND user_id <> $2`, [g.id, req.user.id])).rows[0].n;
    if (n) {
      await q(`UPDATE memberships SET status = 'left', left_at = now() WHERE id = $1`, [g.membership_id]);
      await audit(req, req.user.id, 'group_left', { groupId: g.id });
      return res.json({ ok: true });
    }
  }
  if (g.role === 'admin') {
    const others = (await q(`SELECT count(*)::int AS n FROM memberships WHERE group_id = $1 AND status = 'active' AND user_id <> $2`, [g.id, req.user.id])).rows[0].n;
    if (others) return bad(res, 'You are the admin of this group. The admin cannot leave while other people are in it.', 403);
    await q('DELETE FROM groups WHERE id = $1', [g.id]);   // nobody else is in it, so the group closes
    await audit(req, req.user.id, 'group_closed', { groupId: g.id });
    return res.json({ ok: true, closed: true });
  }
  await q(`UPDATE memberships SET status = 'left', left_at = now() WHERE id = $1`, [g.membership_id]);
  if (!isOver(g)) { await addEvent(g.id, req.user.id, 'left', { name: req.user.full_name }); tellGroup(g.id, 'board'); }
  await audit(req, req.user.id, 'group_left', { groupId: g.id });
  res.json({ ok: true });
}));

/* ======================= workouts ======================= */
/* One logged workout counts in every running challenge the person is in.
   Each challenge scores it with its own rates, daily limit and streak. */
const previewOf = (r) => ({ base: r.sc.base, perf: r.sc.perf, prPts: r.sc.prPts, prs: r.sc.prs, rows: r.sc.rows, pace: r.sc.pace, hasPr: r.sc.hasPr,
  streak: r.streak, streakDay: r.streakDay, total: r.sc.total + r.streak });

/* Scores a workout inside one group: that group's rate, daily limit and streak. */
async function scoreIn(group, userId, x) {
  const sc = S.scoreWorkout(group.rates[x.cat], x.cat, x.m, x.rec);
  const mine = (await q(`SELECT to_char(date,'YYYY-MM-DD') AS date FROM workouts WHERE group_id = $1 AND user_id = $2`, [group.id, userId])).rows;
  const days = {}; let sameDay = 0;
  for (const w of mine) { days[w.date] = 1; if (w.date === x.date) sameDay++; }
  const first = !days[x.date]; days[x.date] = 1;
  const run = S.streakOn(days, x.date);
  return { sc, sameDay, streak: first ? S.streakPts(run) : 0, streakDay: run, capped: !!(group.daily_cap && sameDay >= group.daily_cap) };
}

/* Why this workout cannot go into this group, or '' if it can. */
function blockedIn(g, x, r) {
  if (g.closed_at) return 'This challenge has been shut down. Its results are final.';
  if (!(x.cat in g.rates)) return 'That workout is not part of this challenge.';
  if (x.date < g.start_date) return 'That is before the challenge started.';
  if (x.date > g.end_date) return 'This challenge has ended.';
  if (r && r.capped) return `You already logged ${r.sameDay} for that day. This challenge counts ${g.daily_cap} a day.`;
  return '';
}

/* Reads what was typed and works out which challenges it counts in.
   `only` is set when the request names one group: that group must accept it.
   Otherwise `prefer` is just the challenge the person had open, listed first.
   Returns { x, targets: [{ group, r }] }, or null after sending the reason it cannot be logged. */
async function readLog(req, res, only, prefer) {
  const cat = str(req.body.cat, 10);
  if (!S.CATS[cat]) { bad(res, 'Pick the workout you finished.'); return null; }
  const today = S.todayStr();
  // The player's own calendar day can be a day either side of the server's.
  const date = /^\d{4}-\d{2}-\d{2}$/.test(req.body.date || '') ? req.body.date : today;
  const off = S.dayNum(date) - S.dayNum(today);
  if (off > 1 || off < -2) { bad(res, 'You can log for today or yesterday.'); return null; }
  const groups = (await q(`SELECT g.id, g.name, g.daily_cap, g.rates, g.closed_at, to_char(g.start_date,'YYYY-MM-DD') AS start_date, to_char(g.end_date,'YYYY-MM-DD') AS end_date
                           FROM groups g JOIN memberships m ON m.group_id = g.id
                           WHERE m.user_id = $1 AND m.status = 'active' ORDER BY g.start_date, g.created_at`, [req.user.id])).rows;
  const first = only || prefer;
  groups.sort((a, b) => (b.id === first) - (a.id === first));
  const main = only ? groups.find((g) => g.id === only) : null;
  if (only) { const why = blockedIn(main, { cat, date }); if (why) { bad(res, why); return null; } }
  const open = groups.filter((g) => !blockedIn(g, { cat, date }));
  if (!open.length) {
    const live = groups.filter((g) => !g.closed_at && date <= g.end_date);
    bad(res, !live.length ? 'You are not in a running challenge.'
      : !live.some((g) => cat in g.rates) ? 'That workout is not part of your challenge.'
      : 'That is before the challenge started.');
    return null;
  }
  const prs = await loadPrs(req.user.id);
  const read = S.readWorkout(cat, req.body, prs[cat]);
  if (read.error) { bad(res, read.error); return null; }
  const x = { cat, date, m: read.m, rec: S.CATS[cat].type === 'lift' ? read.prs : prs[cat] };
  const scored = [];
  for (const g of open) scored.push({ group: g, r: await scoreIn(g, req.user.id, x) });
  const targets = scored.filter((t) => !t.r.capped);   // a challenge whose daily limit is used up is skipped
  if (!targets.length || (only && scored[0].r.capped)) { bad(res, blockedIn(scored[0].group, x, scored[0].r)); return null; }
  return { x, targets };
}
const logResult = (targets) => {
  const out = previewOf(targets[0].r);
  out.group = targets[0].group.name;
  out.alsoIn = targets.slice(1).map((t) => t.group.name);
  out.groups = targets.map((t) => ({ id: t.group.id, name: t.group.name, total: t.r.sc.total + t.r.streak }));
  return out;
};

async function saveLog(req, res, found) {
  const { x, targets } = found;
  const before = {};
  for (const t of targets) before[t.group.id] = await buildBoard(t.group);
  const entry = crypto.randomUUID(), note = str(req.body.note, 120);
  await tx(async (run) => {
    for (const t of targets) {
      await run(`INSERT INTO workouts (entry_id, group_id, user_id, cat, date, dist, mins, lifts, base, perf, pr_pts, prs, note) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
        [entry, t.group.id, req.user.id, x.cat, x.date, x.m.dist || 0, x.m.mins || 0, JSON.stringify(x.m.lifts || []), t.r.sc.base, t.r.sc.perf, t.r.sc.prPts, JSON.stringify(t.r.sc.prs), note]);
    }
    if (targets[0].r.sc.rec) await savePr(run, req.user.id, x.cat, targets[0].r.sc.rec);
  });
  for (const t of targets) {
    await addEvent(t.group.id, req.user.id, 'workout', { name: req.user.full_name, cat: S.CATS[x.cat].label, total: t.r.sc.total + t.r.streak, prs: t.r.sc.prs });
    const was = before[t.group.id], now = await buildBoard(t.group);
    if (now.length > 1 && now[0].points > 0 && (!was[0] || was[0].id !== now[0].id || was[0].points === 0)) {
      await addEvent(t.group.id, null, 'lead', { name: now[0].name, points: now[0].points });
    }
    tellGroup(t.group.id, 'board');
  }
  res.status(201).json(logResult(targets));
}

/* Log from anywhere: it goes into every running challenge it fits. `group` is the one that was open, if any. */
const preferOf = (req) => (isUuid(req.body.group) ? req.body.group : null);
router.post('/workouts/preview', wrap(async (req, res) => {
  const found = await readLog(req, res, null, preferOf(req)); if (!found) return;
  res.json(logResult(found.targets));
}));
router.post('/workouts', wrap(async (req, res) => {
  const found = await readLog(req, res, null, preferOf(req)); if (!found) return;
  await saveLog(req, res, found);
}));
/* Log from inside one challenge. That challenge must accept it, and it still counts in the others. */
router.post('/groups/:id/workouts/preview', wrap(async (req, res) => {
  const g = await loadGroup(req, res); if (!g) return;
  const found = await readLog(req, res, g.id); if (!found) return;
  res.json(logResult(found.targets));
}));
router.post('/groups/:id/workouts', wrap(async (req, res) => {
  const g = await loadGroup(req, res); if (!g) return;
  const found = await readLog(req, res, g.id); if (!found) return;
  await saveLog(req, res, found);
}));

/* Removing a workout removes it from every group it counted in. */
router.delete('/workouts/:wid', wrap(async (req, res) => {
  if (!isUuid(req.params.wid)) return bad(res, 'Workout not found.', 404);
  const w = (await q('SELECT id, entry_id FROM workouts WHERE id = $1 AND user_id = $2', [req.params.wid, req.user.id])).rows[0];
  if (!w) return bad(res, 'Workout not found.', 404);
  // Once a challenge is over its results are final.
  const done = await q(`SELECT 1 FROM workouts w JOIN groups g ON g.id = w.group_id
                        WHERE w.user_id = $2 AND (w.id = $1 OR ($3::uuid IS NOT NULL AND w.entry_id = $3)) AND (g.closed_at IS NOT NULL OR g.end_date < current_date - 1) LIMIT 1`,
    [w.id, req.user.id, w.entry_id]);
  if (done.rows.length) return bad(res, 'That challenge has ended. Its results are final.');
  const r = w.entry_id
    ? await q('DELETE FROM workouts WHERE entry_id = $1 AND user_id = $2 RETURNING group_id', [w.entry_id, req.user.id])
    : await q('DELETE FROM workouts WHERE id = $1 RETURNING group_id', [w.id]);
  r.rows.forEach((row) => tellGroup(row.group_id, 'board'));
  res.json({ ok: true });
}));

/* Live connection for the dashboard. */
router.get('/stream', wrap(async (req, res) => {
  const gid = isUuid(req.query.group) ? req.query.group : null;
  if (gid) {
    const m = await q(`SELECT 1 FROM memberships WHERE group_id = $1 AND user_id = $2 AND status = 'active'`, [gid, req.user.id]);
    if (!m.rows.length) return bad(res, 'Group not found.', 404);
  }
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.flushHeaders();
  res.write('retry: 5000\n\n');
  if (gid) addStream(groupStreams, gid, res);
  addStream(userStreams, req.user.id, res);
  const beat = setInterval(() => res.write(': keep alive\n\n'), 25000);
  req.on('close', () => { clearInterval(beat); if (gid) dropStream(groupStreams, gid, res); dropStream(userStreams, req.user.id, res); });
}));

module.exports = router;
