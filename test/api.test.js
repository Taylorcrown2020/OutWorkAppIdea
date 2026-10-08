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

  r = await A('PUT', '/api/me/prs', { prs: { run: { edist: '26.2', etime: '3:30:00' } } });
  ok('a marathon time works out an estimated mile', r.status === 200 && Math.abs(r.json.prs.run.pace - 210 * Math.pow(1 / 26.2, 1.06)) < 1e-9 && r.json.prs.run.actual === undefined && Math.abs(r.json.prs.run.pace - 6.588) < 0.01);
  r = await A('PUT', '/api/me/prs', { prs: { run: { time: '8:03.87', edist: '26.2', etime: '3:30:00' } } });
  ok('a tested mile wins over the estimate, which is kept', r.status === 200 && Math.abs(r.json.prs.run.pace - 25 / 3.1) < 1e-3 && r.json.prs.run.actual === r.json.prs.run.pace && r.json.prs.run.est.dist === 26.2);
  r = await A('PUT', '/api/me/prs', { prs: { swim: { edist: '1760', etime: '30:00' }, ride: { edist: '40', etime: '2:30:00' } } });
  ok('other sports estimate their own test: 100 yards in the pool, 10 miles on the bike', Math.abs(r.json.prs.swim.pace - 30 * Math.pow(100 / 1760, 1.06)) < 1e-9 && Math.abs(r.json.prs.ride.pace - 150 * Math.pow(10 / 40, 1.05) / 10) < 1e-9);
  await A('PUT', '/api/me/prs', { prs: { swim: {}, ride: {} } });
  r = await A('POST', `/api/groups/${gid}/workouts/preview`, { cat: 'run', dist: '5', time: '45:00' });
  ok('preview: 50 for miles, 20 effort bonus at 90% of PR pace', r.json.base === 50 && r.json.perf === 20 && r.json.total === 70);
  ok('category not in challenge refused', (await A('POST', `/api/groups/${gid}/workouts`, { cat: 'swim', dist: '500', time: '10:00' })).status === 400);
  r = await A('POST', `/api/groups/${gid}/workouts`, { cat: 'run', dist: '5', time: '45:00', note: 'before work' });
  ok('run logged', r.status === 201 && r.json.total === 70);
  // strength: a PR entered as 225 x 5 works out to a 1 rep max of 262.5, and is not a workout
  r = await B('PUT', '/api/me/prs', { prs: { lift: { ex: [{ ex: 'squat', w: 225, r: 5 }, { ex: 'pullup', best: 10 }, { ex: 'bench', act: 200, w: 185, r: 8 }] } } });
  ok('settings still carry the names an older dashboard script reads', (await B('GET', '/api/me')).json.scoring.lifts.squat === 'Squat' && (await B('GET', '/api/me')).json.scoring.exercises.squat.name === 'Squat');
  ok('PR lift works out a 1 rep max', r.status === 200 && Math.abs(r.json.prs.lift.ex.squat.orm - 262.5) < 1e-6 && r.json.prs.lift.ex.squat.act === undefined && r.json.prs.lift.ex.pullup.best === 10);
  ok('a tested 1 rep max wins over a higher estimate', r.json.prs.lift.ex.bench.orm === 200 && Math.abs(r.json.prs.lift.ex.bench.est - 185 * (1 + 8 / 30)) < 1e-6);
  ok('entering a PR does not set a rep record', r.json.prs.lift.ex.squat.reps === undefined);
  r = await B('POST', `/api/groups/${gid}/workouts/preview`, { cat: 'lift', lifts: [{ ex: 'squat', sets: 1, reps: 4, w: 100 }] });
  ok('a set under half the 1 rep max earns no effort bonus', r.status === 200 && r.json.perf === 0 && r.json.base === 2);
  r = await B('POST', `/api/groups/${gid}/workouts`, { cat: 'lift', lifts: [{ ex: 'squat', sets: 5, reps: 4, w: 190 }, { ex: 'pullup', sets: 3, reps: 8 }, { ex: 'other', name: 'Farmer carry', sets: 2, reps: 10, w: 70 }] });
  // squat 20 reps x 190/262.5 = 14, effort 215.3/262.5 = 82% -> 64% of the bonus = +5. pull ups 24, effort 80% -> +7. carry sets its own max: 20 x 0.75 = 15.
  ok('strength: reps scaled by load, effort bonus above 50%, a first set earns no record', r.status === 201 && r.json.base === 53 && r.json.perf === 12 && r.json.prPts === 0 && r.json.total === 65);
  r = await B('GET', '/api/me');
  ok('the logged workout sets the rep record and a max for the new exercise', r.json.prs.lift.ex.squat.reps === 4 && Math.abs(r.json.prs.lift.ex.x_farmer_carry.orm - 70 * (1 + 10 / 30)) < 1e-6);
  r = await B('POST', `/api/groups/${gid}/workouts/preview`, { cat: 'lift', lifts: [{ ex: 'squat', sets: 1, reps: 6, w: 230 }, { ex: 'pullup', sets: 1, reps: 11 }] });
  ok('beating the 1 rep max, the rep record and the bodyweight best all pay', r.json.bonuses.map((x) => x.pts).join() === '10,5,10' && r.json.prPts === 25);
  ok('lift workout needs an exercise', (await B('POST', `/api/groups/${gid}/workouts/preview`, { cat: 'lift', lifts: [{ ex: 'nope', sets: 1, reps: 1, w: 10 }] })).status === 400);
  await B('POST', `/api/groups/${gid}/workouts`, { cat: 'walk', dist: '0.5', time: '10:00' });
  ok('daily limit enforced', (await B('POST', `/api/groups/${gid}/workouts`, { cat: 'walk', dist: '1', time: '20:00' })).status === 400);

  r = await A('GET', '/api/groups/' + gid);
  ok('leaderboard ranks by points', r.json.board[0].name === 'Taylor Admin' && r.json.board[0].points === 70 && r.json.board[1].points === 69 && r.json.board[1].behind === 1);
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
  ok('removing a workout removes it from every group', (await A('GET', '/api/groups/' + gid2)).json.board[0].points === 0 && (await A('GET', '/api/groups/' + gid)).json.board[0].points === 70);

  ok('admin cannot leave a group with other people', (await A('POST', `/api/groups/${gid}/leave`, {})).status === 403);
  ok('admin cannot delete their account mid challenge', (await A.form('/account/delete', { password: 'correct horse 1' })).to.includes('e=del_admin'));
  ok('admin can close a group nobody else is in', (await A('POST', `/api/groups/${gid2}/leave`, {})).json.closed === true);

    // distance records come from logged workouts only, and are worked out again when one is removed
  {
    r = await A('GET', '/api/me');
    ok('the first run set the longest distance, the typed PR did not', r.json.prs.run.far === 5);
    ok('a run a little farther is not a record', (await A('POST', `/api/groups/${gid}/workouts/preview`, { cat: 'run', dist: '5.1', time: '50:00' })).json.prPts === 0);
    ok('a short sprint cannot set the pace PR', (await A('POST', `/api/groups/${gid}/workouts/preview`, { cat: 'run', dist: '0.25', time: '1:00' })).json.prPts === 0);
    r = await A('POST', `/api/groups/${gid}/workouts`, { cat: 'run', dist: '6', time: '45:00' });
    ok('farther and faster: longest run and fastest pace both pay', r.status === 201 && r.json.prs.join() === 'Fastest pace,Longest run' && r.json.prPts === 20 && r.json.perf === 30);
    r = await A('PUT', '/api/me/prs', { prs: { run: { time: '8:03.87' }, ride: { mph: '18.5' }, swim: { time: '1:30' } } });
    ok('PRs use each sport\'s own test and keep the longest distance', r.status === 200 && r.json.prs.run.far === 6 && Math.abs(r.json.prs.ride.pace - 60 / 18.5) < 1e-9 && Math.abs(r.json.prs.swim.pace - 1.5) < 1e-9);
    const w0 = (await A('GET', `/api/groups/${gid}/feed?mine=1`)).json.workouts[0];
    ok('removing it puts the longest distance back', (await A('DELETE', '/api/workouts/' + w0.id, {})).status === 200 && (await A('GET', '/api/me')).json.prs.run.far === 5);
    await A('PUT', '/api/me/prs', { prs: { run: { time: '8:03.87' }, ride: {}, swim: {} } });
  }

  // one log goes into every running challenge, with no group named
  const gidM = (await A('POST', '/api/groups', { name: 'Side challenge', days: 7, dailyCap: 0, rates: { walk: 5 } })).json.id;
  r = await A('POST', '/api/workouts/preview', { cat: 'walk', dist: '2', time: '0:40:00' });
  ok('a workout previews in every running challenge at once', r.status === 200 && r.json.groups.length === 2);
  r = await A('POST', '/api/workouts', { cat: 'walk', dist: '2.375', time: '0:41:07' });
  ok('and is logged in all of them from one entry', r.status === 201 && r.json.groups.length === 2 && r.json.groups.every((g) => g.total > 0));
  r = await A('GET', `/api/groups/${gid}/feed?mine=1`);
  ok('exact distance and time are kept', Math.abs(r.json.workouts[0].dist - 2.375) < 1e-9 && Math.abs(r.json.workouts[0].mins - (41 + 7 / 60)) < 1e-9);
  ok('removing it takes it out of both', (await A('DELETE', '/api/workouts/' + r.json.workouts[0].id, {})).status === 200);
  ok('side challenge removed', (await A('POST', `/api/groups/${gidM}/leave`, {})).status === 200);
  ok('a workout no challenge includes is refused', (await C('POST', '/api/workouts', { cat: 'run', dist: '1', time: '10:00' })).status === 400);
  r = await A('POST', '/api/groups', { name: 'Evening start', days: 7, dailyCap: 0, rates: { run: 10 }, today: new Date(Date.now() - 86400000).toISOString().slice(0, 10) });
  const gidE = r.json.id;
  r = await A('GET', '/api/groups/' + gidE);
  ok('a challenge starts on the creator\'s own calendar day', r.json.group.start === new Date(Date.now() - 86400000).toISOString().slice(0, 10));
  ok('and can be logged in on that day', (await A('POST', `/api/groups/${gidE}/workouts/preview`, { cat: 'run', dist: '1', time: '9:00', date: r.json.group.start })).status === 200);
  ok('admin deletes the empty group', (await A('POST', `/api/groups/${gidE}/leave`, {})).status === 200);

  // a forgotten workout can be logged for an earlier day of the challenge, but not before it began or for a day still to come
  {
    const day = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
    r = await A('POST', '/api/groups', { name: 'Back dated', days: 10, dailyCap: 0, rates: { ride: 4 } });
    const gidD = r.json.id;
    if (process.env.DATABASE_URL) {
      const { Client } = require('pg'); const db = new Client({ connectionString: process.env.DATABASE_URL, ssl: false }); await db.connect();
      await db.query(`UPDATE groups SET start_date = start_date - 6 WHERE id = $1`, [gidD]); await db.end();
      r = await A('POST', `/api/groups/${gidD}/workouts`, { cat: 'ride', dist: '10', time: '0:40:00', date: day(-5) });
      ok('a forgotten workout can be logged for an earlier day of the challenge', r.status === 201);
      ok('and is filed under that day', (await A('GET', `/api/groups/${gidD}/feed?mine=1`)).json.workouts[0].date === day(-5));
      ok('but not for a day before the challenge began', (await A('POST', `/api/groups/${gidD}/workouts`, { cat: 'ride', dist: '10', time: '0:40:00', date: day(-8) })).status === 400);
    }
    ok('or a day that has not happened yet', (await A('POST', `/api/groups/${gidD}/workouts`, { cat: 'ride', dist: '10', time: '0:40:00', date: day(3) })).status === 400);
    await A('POST', `/api/groups/${gidD}/leave`, {});
  }

  // shutting a challenge down early
  ok('member cannot shut the challenge down', (await B('POST', `/api/groups/${gid}/close`, {})).status === 403);
  r = await A('POST', `/api/groups/${gid}/close`, {});
  ok('admin shuts the challenge down and the leader wins', r.status === 200 && r.json.winner === 'Taylor A. Admin');
  r = await B('GET', '/api/groups/' + gid);
  ok('standings are frozen and marked over', r.json.group.closed === true && r.json.board[0].points === 70 && r.json.board[1].points === 69);
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

  // a finished challenge can come off the admin's own list while the others keep it
  r = await A('POST', '/api/groups', { name: 'Short one', days: 3, dailyCap: 0, rates: { run: 10 } });
  const gidF = r.json.id, codeF = (await A('GET', '/api/groups/' + gidF)).json.group.code;
  await B('POST', '/api/groups/join', { code: codeF });
  ok('admin cannot leave a running challenge with people in it', (await A('POST', `/api/groups/${gidF}/leave`, {})).status === 403);
  await A('POST', `/api/groups/${gidF}/close`, {});
  ok('the admin can take a finished challenge off their own list', (await A('POST', `/api/groups/${gidF}/leave`, {})).status === 200 && (await A('GET', '/api/groups/' + gidF)).status === 404);
  ok('everyone else still has the final results', (await B('GET', '/api/groups/' + gidF)).json.group.closed === true);

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
