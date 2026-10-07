'use strict';
/* End to end check of the API against a running server: node test/api.test.js */
const BASE = process.env.BASE || 'http://localhost:3000';
const assert = require('assert');
function client() {
  let cookie = '';
  const keep = (res) => { const set = res.headers.get('set-cookie'); if (set) cookie = set.split(';')[0].endsWith('=') ? '' : set.split(';')[0]; return set; };
  // JSON API call
  const api = async (method, path, body, headers) => {
    const res = await fetch(BASE + path, { method, headers: Object.assign({ 'Content-Type': 'application/json', Cookie: cookie }, headers || {}), body: body ? JSON.stringify(body) : undefined });
    const setCookie = keep(res);
    let json = null; try { json = await res.json(); } catch (e) {}
    return { status: res.status, json, setCookie };
  };
  // Plain HTML form post, the way the browser sends the account forms. Returns where the server redirects to.
  api.form = async (path, fields, origin) => {
    const res = await fetch(BASE + path, { method: 'POST', redirect: 'manual',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: cookie, Origin: origin === undefined ? BASE : origin },
      body: new URLSearchParams(fields).toString() });
    const setCookie = keep(res);
    return { status: res.status, to: res.headers.get('location') || '', setCookie };
  };
  return api;
}
const tag = Date.now().toString(36);
const A = client(), B = client(), C = client();
const emailA = `admin_${tag}@example.com`, emailB = `bea_${tag}@example.com`, emailC = `cy_${tag}@example.com`;
let pass = 0; const ok = (name, cond) => { assert.ok(cond, name); pass++; console.log('  ok  ' + name); };

(async () => {
  let r = await A.form('/account/signup', { fullName: 'Taylor Admin', email: emailA, password: 'short' });
  ok('weak password refused', r.to.startsWith('/signup.html?e=password'));
  r = await A.form('/account/signup', { fullName: 'Taylor Admin', email: emailA, password: 'correct horse 1' });
  ok('signup creates account and sends to log in, not logged in', r.status === 303 && r.to === '/login.html?created=1' && !r.setCookie);
  ok('not logged in after signup', (await A('GET', '/api/me')).status === 401);
  ok('duplicate email refused', (await A.form('/account/signup', { fullName: 'X Y', email: emailA.toUpperCase(), password: 'correct horse 1' })).to.includes('e=exists'));
  ok('wrong password refused', (await A.form('/account/login', { email: emailA, password: 'nope nope nope' })).to === '/login.html?e=bad');
  ok('form from another site blocked', (await A.form('/account/login', { email: emailA, password: 'correct horse 1' }, 'https://evil.example')).status === 403);
  ok('no JSON door for passwords', (await A('POST', '/api/auth/login', { email: emailA, password: 'correct horse 1' })).status === 401);
  r = await A.form('/account/login', { email: emailA, password: 'correct horse 1' });
  ok('login sets an HttpOnly cookie and opens the dashboard', r.to === '/dashboard.html' && /HttpOnly/i.test(r.setCookie) && /SameSite=Lax/i.test(r.setCookie));
  r = await A('GET', '/api/me');
  ok('new account has no groups', r.status === 200 && r.json.groups.length === 0 && r.json.avatars.length > 0);
  const avatar = r.json.avatars[0];

  ok('cross site write blocked', (await A('POST', '/api/groups', { name: 'x' }, { Origin: 'https://evil.example' })).status === 403);
  r = await A('POST', '/api/groups', { name: 'October grind', days: 14, dailyCap: 2, rates: { run: 10, walk: 7, lift: 1 },
    invites: [{ name: 'Bea', email: emailB }, { name: 'Dee', email: `dee_${tag}@example.com` }] });
  ok('group created with invites sent', r.status === 201 && r.json.code.length === 6 && r.json.invitesSent === 2);
  const gid = r.json.id, code = r.json.code;

  r = await B.form('/account/signup', { fullName: 'Bea Runner', email: emailB, password: 'another pass 22', code });
  ok('invite code rides through sign up', r.to === '/login.html?created=1&code=' + code);
  r = await B.form('/account/login', { email: emailB, password: 'another pass 22', code });
  ok('and through log in', r.to === '/dashboard.html?code=' + code);
  ok('bad code refused', (await B('POST', '/api/groups/join', { code: 'ZZZZZZ' })).status === 404);
  ok('new account is flagged as a first visit until the PR prompt is shown', (await B('GET', '/api/me')).json.firstVisit === true);
  ok('prompt marked as shown', (await B('POST', '/api/me/welcomed', {})).status === 200 && (await B('GET', '/api/me')).json.firstVisit === false);
  ok('cannot see the group before joining', (await B('GET', '/api/groups/' + gid)).status === 404);
  r = await B('POST', '/api/groups/join', { code });
  ok('entering the code joins straight away, no admit step', r.status === 200 && r.json.id === gid);
  ok('joining twice refused', (await B('POST', '/api/groups/join', { code })).status === 409);
  ok('group shows on my account', (await B('GET', '/api/me')).json.groups[0].id === gid);
  r = await A('GET', '/api/notifications');
  ok('admin notified in account', r.json.notifications[0].type === 'member_joined');
  ok('the admit door is gone', (await A('POST', `/api/groups/${gid}/requests/${gid}`, { action: 'admit' })).status === 404);
  r = await B('GET', '/api/groups/' + gid);
  ok('joiner sees the board, no admin data', r.status === 200 && r.json.board.length === 2 && r.json.invites === undefined);
  ok('member cannot invite', (await B('POST', `/api/groups/${gid}/invites`, { invites: [{ name: 'Q', email: 'q@example.com' }] })).status === 403);

  // resend invites
  r = await A('GET', '/api/groups/' + gid);
  const invBea = r.json.invites.find((i) => i.email === emailB), invDee = r.json.invites.find((i) => i.email !== emailB);
  ok('admin sees invites and who joined', r.json.invites.length === 2 && invBea.joined === true && invDee.joined === false && invDee.sends === 1);
  ok('member cannot resend', (await B('POST', `/api/groups/${gid}/invites/resend`, { id: invDee.id })).status === 403);
  ok('cannot resend to someone who already joined', (await A('POST', `/api/groups/${gid}/invites/resend`, { id: invBea.id })).status === 409);
  ok('resend right after sending is held back', (await A('POST', `/api/groups/${gid}/invites/resend`, { id: invDee.id })).status === 429);
  if (process.env.DATABASE_URL) {
    const { Client } = require('pg'); const db = new Client({ connectionString: process.env.DATABASE_URL, ssl: false }); await db.connect();
    await db.query(`UPDATE invites SET sent_at = now() - interval '5 minutes' WHERE id = $1`, [invDee.id]); await db.end();
    r = await A('POST', `/api/groups/${gid}/invites/resend`, { id: invDee.id });
    ok('admin resends one invite', r.status === 200 && r.json.sent === 1);
    ok('resend is counted', (await A('GET', '/api/groups/' + gid)).json.invites.find((i) => i.id === invDee.id).sends === 2);
    const { Client: C2 } = require('pg'); const db2 = new C2({ connectionString: process.env.DATABASE_URL, ssl: false }); await db2.connect();
    await db2.query(`UPDATE invites SET sent_at = now() - interval '5 minutes' WHERE id = $1`, [invDee.id]); await db2.end();
    r = await A('POST', `/api/groups/${gid}/invites/resend`, {});
    ok('resend to everyone still waiting skips people who joined', r.status === 200 && r.json.sent === 1);
  } else console.log('  (skipped resend timing checks: set DATABASE_URL to run them)');

  await C.form('/account/signup', { fullName: 'Cy Outsider', email: emailC, password: 'outsider pass 3' });
  await C.form('/account/login', { email: emailC, password: 'outsider pass 3' });
  ok('outsider cannot read the group', (await C('GET', '/api/groups/' + gid)).status === 404);
  ok('outsider cannot log to the group', (await C('POST', `/api/groups/${gid}/workouts`, { cat: 'run', dist: 3, time: '30:00' })).status === 404);

  r = await A('PUT', '/api/me/prs', { prs: { run: { dist: '3.1', time: '25:00' } } });
  ok('PR saved once to profile', r.status === 200 && Math.abs(r.json.prs.run.pace - 25 / 3.1) < 1e-6);
  r = await A('POST', `/api/groups/${gid}/workouts/preview`, { cat: 'run', dist: '5', time: '45:00' });
  ok('preview: 50 for miles, 22 pace bonus', r.json.base === 50 && r.json.perf === 22 && r.json.total === 72);
  ok('category not in challenge refused', (await A('POST', `/api/groups/${gid}/workouts`, { cat: 'swim', dist: '500', time: '10:00' })).status === 400);
  r = await A('POST', `/api/groups/${gid}/workouts`, { cat: 'run', dist: '5', time: '45:00', note: 'before work' });
  ok('run logged', r.status === 201 && r.json.total === 72);
  r = await B('POST', `/api/groups/${gid}/workouts`, { cat: 'lift', lifts: { squat: { sets: 5, reps: 5, w: 240, pr: 300 }, bench: { sets: 3, reps: 8, w: 210, pr: 200 } } });
  ok('strength: 20 + 24 reps, +10 new PR', r.status === 201 && r.json.base === 44 && r.json.prPts === 10 && r.json.total === 54);
  ok('strength PRs saved and raised', (await B('GET', '/api/me')).json.prs.lift.bench === 210);
  await B('POST', `/api/groups/${gid}/workouts`, { cat: 'walk', dist: '2', time: '40:00' });
  ok('daily limit enforced', (await B('POST', `/api/groups/${gid}/workouts`, { cat: 'walk', dist: '1', time: '20:00' })).status === 400);

  r = await A('GET', '/api/groups/' + gid);
  ok('leaderboard ranks by points', r.json.board[0].name === 'Taylor Admin' && r.json.board[0].points === 72 && r.json.board[1].points === 68 && r.json.board[1].behind === 4);
  r = await A('GET', `/api/groups/${gid}/power`);
  ok('power rankings project a finish', r.json.rankings.length === 2 && r.json.rankings[0].projected >= r.json.rankings[0].points && r.json.daysLeft === 13);
  r = await A('GET', `/api/groups/${gid}/updates`);
  ok('updates list what others did', r.json.updates.some((u) => u.type === 'workout' && u.data.name === 'Bea Runner') && r.json.updates.some((u) => u.type === 'joined'));
  ok('updates are shown once', (await A('GET', `/api/groups/${gid}/updates`)).json.updates.length === 0);
  r = await B('GET', `/api/groups/${gid}/feed?mine=1`);
  ok('my activity lists only my workouts', r.json.workouts.length === 2 && r.json.workouts.every((w) => w.name === 'Bea Runner'));
  ok('cannot delete someone else\'s workout', (await A('DELETE', '/api/workouts/' + r.json.workouts[0].id, {})).status === 404);

  r = await A('PATCH', '/api/me', { fullName: 'Taylor A. Admin', avatar });
  ok('profile updated with icon', r.status === 200 && (await A('GET', '/api/groups/' + gid)).json.board[0].avatar === avatar);
  ok('email change needs the current password', (await A.form('/account/email', { email: 'new_' + emailA, current: 'wrong' })).to.includes('e=email_pw'));
  ok('password change needs the current password', (await A.form('/account/password', { current: 'wrong', next: 'brand new pass 9' })).to.includes('e=pw_current'));

  // several groups: a second group only counts workouts from its own start
  r = await A('POST', '/api/groups', { name: 'Second group', days: 7, dailyCap: 2, rates: { run: 10, lift: 1 }, invites: [] });
  const gid2 = r.json.id;
  r = await A('GET', '/api/groups/' + gid2);
  ok('new group starts empty: the earlier run is not carried in', r.json.board.length === 1 && r.json.board[0].points === 0);
  r = await A('POST', `/api/groups/${gid}/workouts`, { cat: 'run', dist: '3.1', time: '24:00' });
  ok('one workout counts in both groups', r.status === 201 && r.json.alsoIn.length === 1 && r.json.alsoIn[0] === 'Second group');
  const pts2 = (await A('GET', '/api/groups/' + gid2)).json.board[0].points;
  ok('second group has only the new workout', pts2 === r.json.total - r.json.streak);
  r = await A('GET', '/api/me');
  ok('my groups lists both with my standing', r.json.groups.length === 2 && r.json.groups.every((g) => g.rank === 1));
  r = await A('GET', `/api/groups/${gid2}/feed?mine=1`);
  ok('second group activity has one workout', r.json.workouts.length === 1);
  await A('DELETE', '/api/workouts/' + r.json.workouts[0].id, {});
  ok('removing a workout removes it from every group', (await A('GET', '/api/groups/' + gid2)).json.board[0].points === 0 && (await A('GET', '/api/groups/' + gid)).json.board[0].points === 72);

  ok('admin cannot leave a group with other people', (await A('POST', `/api/groups/${gid}/leave`, {})).status === 403);
  ok('admin cannot delete their account mid challenge', (await A.form('/account/delete', { password: 'correct horse 1' })).to.includes('e=del_admin'));
  ok('admin can close a group nobody else is in', (await A('POST', `/api/groups/${gid2}/leave`, {})).json.closed === true);

  // shutting a challenge down early
  ok('member cannot shut the challenge down', (await B('POST', `/api/groups/${gid}/close`, {})).status === 403);
  r = await A('POST', `/api/groups/${gid}/close`, {});
  ok('admin shuts the challenge down and the leader wins', r.status === 200 && r.json.winner === 'Taylor A. Admin');
  r = await B('GET', '/api/groups/' + gid);
  ok('standings are frozen and marked over', r.json.group.closed === true && r.json.group.over === true && r.json.board[0].points === 72 && r.json.board[1].points === 68);
  ok('nothing more can be logged', (await A('POST', `/api/groups/${gid}/workouts`, { cat: 'walk', dist: '1', time: '20:00' })).status === 400);
  r = await B('GET', `/api/groups/${gid}/feed?mine=1`);
  ok('logged workouts cannot be removed after the end', (await B('DELETE', '/api/workouts/' + r.json.workouts[0].id, {})).status === 400);
  ok('nobody can join a shut down challenge', (await C('POST', '/api/groups/join', { code })).status === 400);
  ok('invites cannot be sent or resent after the end', (await A('POST', `/api/groups/${gid}/invites/resend`, {})).status === 400 && (await A('POST', `/api/groups/${gid}/invites`, { invites: [{ name: 'Q', email: 'q@example.com' }] })).status === 400);
  ok('cannot shut down twice', (await A('POST', `/api/groups/${gid}/close`, {})).status === 409);
  ok('members are told', (await B('GET', '/api/notifications')).json.notifications[0].type === 'challenge_closed');
  r = await B('GET', `/api/groups/${gid}/updates`);
  ok('it shows in what you missed', r.json.updates.some((u) => u.type === 'closed'));
  ok('power rankings show the final result', (await A('GET', `/api/groups/${gid}/power`)).json.over === true);

  ok('member leaves', (await B('POST', `/api/groups/${gid}/leave`, {})).status === 200);
  r = await A('GET', '/api/groups/' + gid);
  ok('leaderboard re-ranks without them', r.json.board.length === 1 && r.json.board[0].rank === 1);
  ok('left member loses access', (await B('GET', '/api/groups/' + gid)).status === 404);

  // forgot password
  const fs = require('fs'), logFile = process.env.SERVER_LOG || '/tmp/server.log';
  ok('forgot password answers the same for any email', (await B.form('/account/forgot', { email: 'nobody_' + emailB })).to === '/forgot.html?sent=1' && (await B.form('/account/forgot', { email: emailB })).to === '/forgot.html?sent=1');
  await new Promise((res) => setTimeout(res, 300));
  const m = fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf8').match(/reset\.html#token=([\w-]+)[\s\S]*$/) : null;
  if (m) {
    const links = fs.readFileSync(logFile, 'utf8').match(/reset\.html#token=([\w-]+)/g), token = decodeURIComponent(links[links.length - 1].split('=')[1]);
    ok('bad reset token refused', (await B.form('/account/reset', { token: 'x' + token, password: 'a new password 7' })).to === '/forgot.html?e=expired');
    ok('weak new password refused', (await B.form('/account/reset', { token, password: 'short' })).to.startsWith('/reset.html?e=password#token='));
    ok('reset link sets a new password', (await B.form('/account/reset', { token, password: 'a new password 7' })).to === '/login.html?reset=1');
    ok('reset link works once', (await B.form('/account/reset', { token, password: 'another one 123' })).to === '/forgot.html?e=expired');
    ok('old session ended by the reset', (await B('GET', '/api/me')).status === 401);
    ok('old password no longer works', (await B.form('/account/login', { email: emailB, password: 'another pass 22' })).to.includes('e=bad'));
    ok('new password works', (await B.form('/account/login', { email: emailB, password: 'a new password 7' })).to === '/dashboard.html');
  } else console.log('  (skipped reset token checks: server log not readable)');

  ok('logout ends the session', (await B('POST', '/api/auth/logout', {})).status === 200 && (await B('GET', '/api/me')).status === 401);
  ok('account deletion needs password', (await C.form('/account/delete', { password: 'x' })).to.includes('e=del_pw'));
  ok('account deleted', (await C.form('/account/delete', { password: 'outsider pass 3' })).to === '/index.html' && (await C.form('/account/login', { email: emailC, password: 'outsider pass 3' })).to.includes('e=bad'));
  console.log(`\n${pass} checks passed`);
})().catch((e) => { console.error('\nFAILED:', e.message); process.exit(1); });
