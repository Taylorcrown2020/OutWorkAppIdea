/* Outwork dashboard: leaderboard, power rankings, activity, group, profile.
   All data comes from the server API. Points are always calculated on the server. */
(function () {
'use strict';

var $ = function (id) { return document.getElementById(id); };
var dash = $('dash'), modalWrap = $('modalWrap'), modal = $('modal'), toastEl = $('toast');
var esc = function (s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
};
var pad = function (n) { return (n < 10 ? '0' : '') + n; };
var toStr = function (d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); };
var toDate = function (s) { var p = s.split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); };
var today = function () { return toStr(new Date()); };
var yesterday = function () { var d = new Date(); d.setDate(d.getDate() - 1); return toStr(d); };
var dayDiff = function (a, b) { return Math.round((toDate(a) - toDate(b)) / 86400000); };
var fmtDay = function (s) { return toDate(s).toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' }); };
var fmtShort = function (s) { return toDate(s).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }); };
var plural = function (n, w) { return n + ' ' + w + (n === 1 ? '' : 's'); };
var ordinal = function (n) { var s = ['th', 'st', 'nd', 'rd'], v = n % 100; return s[(v - 20) % 10] || s[v] || s[0]; };
var fmtAmt = function (n) { return (Math.round(n * 100) / 100).toLocaleString(); };
var fmtPace = function (p) { var m = Math.floor(p), s = Math.round((p - m) * 60); if (s === 60) { m++; s = 0; } return m + ':' + pad(s); };
var fmtTime = function (mins) {
  var t = Math.round(mins * 60), h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
  return h ? h + ':' + pad(m) + ':' + pad(s) : m + ':' + pad(s);
};
var initials = function (name) { var p = String(name || '?').trim().split(/\s+/); return ((p[0] || '?')[0] + (p.length > 1 ? p[p.length - 1][0] : '')).toUpperCase(); };
var ava = function (p, cls) {
  return p.avatar ? '<img class="ava ' + (cls || '') + '" src="avatars/' + encodeURIComponent(p.avatar) + '" alt="">'
    : '<span class="ava ' + (cls || '') + '" aria-hidden="true">' + esc(initials(p.name || p.fullName)) + '</span>';
};
var ICON = {
  x: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  plus: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
  bell: '<svg viewBox="0 0 24 24"><path d="M6 9a6 6 0 0 1 12 0c0 6 2.5 7.5 2.5 7.5h-17S6 15 6 9zM10 20a2 2 0 0 0 4 0"/></svg>',
  mark: '<svg viewBox="0 0 24 24"><path d="M4 20l6-16 4 9 2-4 4 11z"/></svg>'
};

var toastT;
function toast(msg) {
  toastEl.textContent = msg; toastEl.classList.add('show');
  clearTimeout(toastT); toastT = setTimeout(function () { toastEl.classList.remove('show'); }, 2800);
}

/* ---------- server ---------- */
function api(method, path, body) {
  return fetch('/api' + path, { method: method, credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
    .then(function (res) {
      if (res.status === 401) { location.href = 'login.html'; return new Promise(function () {}); }
      return res.json().catch(function () { return {}; }).then(function (json) {
        if (!res.ok) { var e = new Error(json.error || 'Something went wrong. Try again.'); e.status = res.status; throw e; }
        return json;
      });
    });
}
var fail = function (e) { toast(e.message || 'Something went wrong. Try again.'); };

/* ---------- state ---------- */
var ME = null, SC = null;          // account, scoring settings
var S = { view: 'board', gid: null, g: null, board: [], requests: [], invites: [], power: null, feed: null, feedMine: true, notes: [], loading: true };
var F = null;                      // open form state (log workout or create group)
var source = null;

var activeGroups = function () { return ME.groups.filter(function (g) { return g.status === 'active'; }); };
var pendingGroups = function () { return ME.groups.filter(function (g) { return g.status === 'pending'; }); };
var rateText = function (cat) { var c = SC.cats[cat]; return fmtAmt(S.g.rates[cat]) + ' per ' + c.perLabel; };
var over = function () { return S.g && today() > S.g.end; };

/* ---------- loading ---------- */
function loadMe() {
  return api('GET', '/me').then(function (d) {
    ME = d; SC = d.scoring;
    var act = activeGroups(), saved = null;
    try { saved = localStorage.getItem('ow_group'); } catch (e) {}
    if (!S.gid || !act.some(function (g) { return g.id === S.gid; })) {
      S.gid = act.some(function (g) { return g.id === saved; }) ? saved : (act[0] ? act[0].id : null);
    }
  });
}
function loadGroup() {
  if (!S.gid) { S.g = null; S.board = []; return Promise.resolve(); }
  return api('GET', '/groups/' + S.gid).then(function (d) {
    S.g = d.group; S.board = d.board; S.requests = d.requests || []; S.invites = d.invites || [];
  }).catch(function (e) { if (e.status === 404) { S.gid = null; S.g = null; return loadMe().then(loadGroup); } throw e; });
}
function loadView() {
  if (!S.g) return Promise.resolve();
  if (S.view === 'power') return api('GET', '/groups/' + S.gid + '/power').then(function (d) { S.power = d; });
  if (S.view === 'activity') return api('GET', '/groups/' + S.gid + '/feed' + (S.feedMine ? '?mine=1' : '')).then(function (d) { S.feed = d.workouts; });
  return Promise.resolve();
}
function refresh() { return loadGroup().then(loadView).then(render); }

/* Live updates: the server tells this page when the group changes. */
function connect() {
  if (source) { source.close(); source = null; }
  if (!window.EventSource) return;
  source = new EventSource('/api/stream' + (S.gid ? '?group=' + S.gid : ''));
  source.onmessage = function (ev) {
    var msg = {}; try { msg = JSON.parse(ev.data); } catch (e) {}
    if (msg.type === 'me') { loadMe().then(function () { if (msg.what === 'groups') { return refresh().then(connect); } renderBar(); }); return; }
    var typing = document.activeElement && dash.contains(document.activeElement) && /INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName);
    if (S.view === 'profile' || typing) { loadGroup(); return; }   // keep what the person is typing
    refresh();
  };
}

/* ---------- top bar ---------- */
function barHTML() {
  var tabs = [['board', 'Leaderboard'], ['power', 'Power rankings'], ['activity', 'Activity'], ['group', 'Group'], ['groups', 'My groups'], ['profile', 'Profile']];
  var act = activeGroups();
  return '<div class="wrap-w dbar-in"><a class="brand" href="index.html"><i>' + ICON.mark + '</i>Outwork</a>' +
    '<nav class="dtabs" aria-label="Dashboard">' + tabs.map(function (t) {
      return '<button class="dtab" data-act="view" data-v="' + t[0] + '"' + (S.view === t[0] ? ' aria-current="page"' : '') + '>' + t[1] + '</button>';
    }).join('') + '</nav><div class="dbar-right">' +
    (act.length > 1 ? '<select class="gsel" id="gsel" aria-label="Group">' + act.map(function (g) { return '<option value="' + g.id + '"' + (g.id === S.gid ? ' selected' : '') + '>' + esc(g.name) + '</option>'; }).join('') + '</select>' : '') +
    '<button class="bell" data-act="notes" aria-label="Notifications' + (ME.unread ? ', ' + ME.unread + ' new' : '') + '">' + ICON.bell + (ME.unread ? '<b>' + ME.unread + '</b>' : '') + '</button>' +
    '<button data-act="view" data-v="profile" aria-label="Your profile">' + ava({ avatar: ME.user.avatar, name: ME.user.fullName }, 'ava--sm') + '</button>' +
    '</div></div>';
}
function renderBar() { var b = $('dbar'); if (b) b.innerHTML = barHTML(); }

/* ---------- views ---------- */
function viewWelcome() {
  var pend = pendingGroups();
  return '<main class="wrap-w"><div class="welcome"><h1 class="h-lg">Welcome, ' + esc(ME.user.fullName.split(' ')[0]) + '.</h1>' +
    '<p>You are not in a group yet, so there is no leaderboard to show. Create a group and invite people, or join one with a code.</p>' +
    '<button class="btn btn--orange" data-act="create">' + ICON.plus + 'Create a group</button>' +
    '<p class="or">Have a group code?</p>' +
    joinFormHTML() +
    pend.map(function (g) { return '<div class="wait">You asked to join <b>' + esc(g.name) + '</b>. The admin has been emailed and will admit you.</div>'; }).join('') +
    '</div></main>';
}

var joinFormHTML = function () {
  return '<form class="join-row" id="joinForm" novalidate><input class="input" id="joinCode" maxlength="6" autocomplete="off" aria-label="Group code" placeholder="CODE" value="' + esc(S.joinCode || '') + '">' +
    '<button class="btn btn--black" type="submit">Ask to join</button></form>';
};
/* Every group this person is in. Each one keeps its own leaderboard, and only counts workouts from its own start date. */
function viewGroups() {
  var act = activeGroups(), pend = pendingGroups();
  return '<main class="wrap-w dmain"><h2 class="sec">My groups</h2>' +
    '<p class="rules-p">Pick a group to see its leaderboard. A workout you log counts in every group you are in, from the day that group\'s challenge started.</p>' +
    '<div class="gcards">' + act.map(function (g) {
      var left = dayDiff(g.end, today());
      var when = today() > g.end ? 'Ended ' + fmtShort(g.end) : today() < g.start ? 'Starts ' + fmtShort(g.start) : left <= 0 ? 'Last day' : plural(left + 1, 'day') + ' left';
      return '<button class="gcard' + (g.id === S.gid ? ' gcard--on' : '') + '" data-act="openGroup" data-id="' + g.id + '">' +
        '<span class="gcard-top"><b>' + esc(g.name) + '</b>' + (g.role === 'admin' ? '<span class="tag tag--k">Admin</span>' : '') + (g.id === S.gid ? '<span class="tag">Open now</span>' : '') + '</span>' +
        '<span class="gcard-rank">' + (g.rank ? g.rank + '<small>' + ordinal(g.rank) + '</small>' : '0') + '</span>' +
        '<span class="gcard-meta">of ' + g.members + ', with ' + plural(g.points, 'point') + '</span><span class="gcard-when">' + esc(when) + '</span></button>';
    }).join('') + '</div>' +
    pend.map(function (g) { return '<div class="wait">You asked to join <b>' + esc(g.name) + '</b>. The admin has been emailed and will admit you.</div>'; }).join('') +
    '<div class="block" style="margin-top:36px"><button class="btn btn--orange" data-act="create">' + ICON.plus + 'Create a group</button>' +
    '<p class="or">Have a group code?</p>' + joinFormHTML() + '</div></main>';
}

function viewBoard() {
  var g = S.g, me = S.board.filter(function (r) { return r.id === ME.user.id; })[0] || { points: 0, rank: 0, streak: 0 };
  var left = dayDiff(g.end, today()), ended = over();
  var winner = ended && S.board[0] && S.board[0].points > 0 ? S.board[0] : null;
  var hero = '<header class="band--orange dhero"><div class="wrap-w">' +
    (ended
      ? '<h1 class="h-lg"><span class="h-dim">' + esc(g.name) + ' is over.</span> ' + (winner ? esc(winner.id === ME.user.id ? 'You win.' : winner.name + ' wins.') : 'Nobody logged a workout.') + '</h1>'
      : '<h1 class="h-lg">' + esc(g.name) + '</h1><p class="hero-sub"><span>' + (left <= 0 ? 'Last day' : plural(left + 1, 'day') + ' left') + '. Ends ' + esc(fmtDay(g.end)) + '.</span><span class="live">Live</span></p>') +
    '<div class="stats"><div><b>' + me.points + '</b><span>Your points</span></div>' +
    '<div><b>' + (me.rank ? me.rank + '<small>' + ordinal(me.rank) + '</small>' : '0') + '</b><span>Place, of ' + S.board.length + '</span></div>' +
    '<div><b>' + me.streak + '</b><span>Day streak</span></div></div>' +
    (ended ? '' : '<button class="btn btn--black" data-act="log">' + ICON.plus + 'Log a workout</button>') +
    '</div></header>';
  var rows = S.board.map(function (r, i) {
    var meta = plural(r.workouts, 'workout') + (r.streak > 1 ? ', ' + r.streak + ' day streak' : '') + (r.behind > 0 ? ', ' + r.behind + ' behind' : '');
    return '<div class="lb-row' + (i === 0 && r.points > 0 ? ' lb-row--lead' : '') + '"><div class="lb-rank">' + r.rank + '</div>' + ava(r) +
      '<div><div class="lb-name">' + esc(r.name) + (r.id === ME.user.id ? '<span class="tag">You</span>' : '') + (r.role === 'admin' ? '<span class="tag tag--k">Admin</span>' : '') + '</div>' +
      '<div class="lb-meta">' + meta + '</div></div><div class="lb-pts">' + r.points + '<small>points</small></div></div>';
  }).join('');
  return hero + '<main class="wrap-w dmain"><h2 class="sec">Leaderboard</h2><div class="lb">' + rows + '</div>' +
    (S.board.length === 1 ? '<p class="note">It is only you so far. Invite people from the Group tab.</p>' : '') + '</main>';
}

function viewPower() {
  var p = S.power;
  if (!p) return '<main class="wrap-w spin">Working out the projections</main>';
  var top = p.rankings[0], second = p.rankings[1];
  var why = !top || !top.points ? [] : [
    'Averaging ' + top.perDay + ' points a day over the last week',
    top.streak > 1 ? 'On a ' + top.streak + ' day streak' : 'Active ' + top.activeDays + ' of ' + plural(top.elapsed, 'day'),
    second ? 'Projected to finish ' + (top.projected - second.projected) + ' ahead of ' + esc(second.name) : 'Nobody else is on the board yet'
  ];
  var trend = { up: ['Rising', 'trend--up'], down: ['Slowing', 'trend--down'], steady: ['Steady', ''], 'new': ['New', ''] };
  var head = !top || !top.points
    ? '<div class="proj"><div><small>Power rankings</small><strong>No workouts yet</strong><p class="proj-num">Projections appear once people start logging.</p></div></div>'
    : '<div class="proj"><div class="proj-who">' + ava(top, 'ava--lg') + '<div><small>' + (p.over ? 'Final result' : 'Projected winner') + '</small><strong>' + esc(top.name) + '</strong>' +
      '<p class="proj-num">' + (p.over ? top.points + ' points' : top.projected + ' points projected, ' + plural(p.daysLeft, 'day') + ' left') + '</p></div></div><ul>' +
      why.map(function (w) { return '<li>' + w + '</li>'; }).join('') + '</ul></div>';
  return '<main class="wrap-w dmain"><h2 class="sec">Power rankings</h2>' +
    '<p class="rules-p">Who is on course to win. Each projection is the points a person has now, plus their daily pace for the days left. The last seven days count for most of that pace.</p>' + head +
    '<table class="pw"><thead><tr><th>#</th><th>Player</th><th>Now</th><th>Points a day</th><th>Streak</th><th>Active days</th><th>Form</th><th>Projected</th></tr></thead><tbody>' +
    p.rankings.map(function (r) {
      return '<tr><td>' + r.projectedRank + '</td><td><span class="pw-who">' + ava(r, 'ava--sm') + '<span>' + esc(r.name) + (r.id === ME.user.id ? ' <span class="tag">You</span>' : '') + '</span></span></td>' +
        '<td data-l="Now">' + r.points + '</td><td data-l="Points a day">' + r.perDay + '</td><td data-l="Streak">' + r.streak + '</td>' +
        '<td data-l="Active days">' + r.activeDays + ' of ' + r.elapsed + '</td><td data-l="Form"><span class="trend ' + trend[r.trend][1] + '">' + trend[r.trend][0] + '</span></td>' +
        '<td data-l="Projected" class="pw-proj">' + r.projected + '</td></tr>';
    }).join('') + '</tbody></table></main>';
}

function metrics(w) {
  var c = SC.cats[w.cat];
  if (c && c.type === 'dist') return fmtAmt(w.dist) + ' ' + c.unit + ' in ' + fmtTime(w.mins) + ' (' + fmtPace(w.mins / (w.dist / c.per)) + ' per ' + c.perLabel + ')';
  return (w.lifts || []).map(function (l) { return SC.lifts[l.k] + ' ' + l.sets + ' x ' + l.reps + ' at ' + fmtAmt(l.w) + ' lb'; }).join(', ');
}
function viewActivity() {
  var list = S.feed;
  var body = !list ? '<p class="spin">Loading activity</p>' : !list.length
    ? '<div class="empty">' + (S.feedMine ? 'You have not logged a workout in this group yet.' : 'Nobody has logged a workout yet.') + '</div>'
    : list.map(function (w) {
      var c = SC.cats[w.cat] || { label: w.cat }, total = w.base + w.perf + w.pr_pts;
      var day = w.date === today() ? 'Today' : w.date === yesterday() ? 'Yesterday' : fmtShort(w.date);
      return '<div class="feed-item">' + ava(w, 'ava--sm') + '<div><div class="feed-line"><b>' + esc(w.name) + '</b> finished ' + esc(c.label) + '</div>' +
        '<div class="feed-meta">' + esc(day + ', ' + metrics(w)) + '</div>' +
        '<div class="feed-break">' + w.base + (c.type === 'dist' ? ' for distance' : ' for reps') + (w.perf ? ', +' + w.perf + ' pace bonus' : '') + (w.pr_pts ? ', +' + w.pr_pts + ' new PR' : '') + '</div>' +
        (w.prs && w.prs.length ? '<div class="feed-pr">New PR: ' + esc(w.prs.join(' and ').toLowerCase()) + '</div>' : '') +
        (w.note ? '<div class="feed-note">' + esc(w.note) + '</div>' : '') +
        (w.user_id === ME.user.id && !over() ? '<button class="link" data-act="delWorkout" data-id="' + w.id + '">Remove</button>' : '') +
        '</div><div class="feed-pts">+' + total + '</div></div>';
    }).join('');
  return '<main class="wrap-w dmain"><h2 class="sec">Activity</h2><div class="seg" style="margin-bottom:18px">' +
    '<button data-act="feed" data-v="1" aria-pressed="' + S.feedMine + '">My workouts</button><button data-act="feed" data-v="0" aria-pressed="' + !S.feedMine + '">Everyone</button></div>' +
    '<div style="max-width:760px">' + body + '</div>' +
    (S.feedMine ? '<p class="note">Streak points are added to your total on the leaderboard, once per day.</p>' : '') + '</main>';
}

function invRows(list) {
  return list.map(function (r, i) {
    return '<div class="inv-row"><input class="input" data-inv="name" data-i="' + i + '" maxlength="80" placeholder="Full name" aria-label="Name" value="' + esc(r.name) + '">' +
      '<input class="input" data-inv="email" data-i="' + i + '" type="email" maxlength="200" placeholder="Email" aria-label="Email" value="' + esc(r.email) + '">' +
      '<button type="button" class="icon-btn" data-act="invRm" data-i="' + i + '" aria-label="Remove this row">' + ICON.x + '</button></div>';
  }).join('') + '<button type="button" class="btn btn--ghost btn--sm" data-act="invAdd">' + ICON.plus + 'Add another person</button>';
}
function viewGroup() {
  var g = S.g, admin = g.role === 'admin';
  if (!S.inv) S.inv = [{ name: '', email: '' }];
  var cats = SC.order.filter(function (k) { return g.rates[k] !== undefined; });
  var left = '<div class="block"><div class="code-box"><div><p>Group code</p><b id="codeText">' + esc(g.code) + '</b></div><button class="btn btn--orange btn--sm" data-act="copy">Copy code</button></div></div>' +
    (admin && S.requests.length ? '<div class="block"><h2 class="sec">Waiting to join</h2>' + S.requests.map(function (r) {
      return '<div class="mem">' + ava(r) + '<div class="mem-name">' + esc(r.name) + '<small>' + esc(r.email) + '</small></div>' +
        '<button class="btn btn--orange" data-act="admit" data-id="' + r.id + '">Admit</button><button class="btn btn--ghost" data-act="decline" data-id="' + r.id + '">Decline</button></div>';
    }).join('') + '</div>' : '') +
    '<div class="block"><h2 class="sec">Members</h2>' + S.board.map(function (r) {
      return '<div class="mem">' + ava(r) + '<div class="mem-name">' + esc(r.name) + (r.id === ME.user.id ? ' <span class="tag">You</span>' : '') + '</div>' + (r.role === 'admin' ? '<span class="tag tag--k">Admin</span>' : '') + '</div>';
    }).join('') + '</div>' +
    (admin ? '<div class="block"><h2 class="sec">Invite people</h2><p class="rules-p">Each person gets an email with a link to sign up and the group code. When they enter the code, you admit them here.</p>' +
      '<form id="invForm" novalidate>' + invRows(S.inv) + '<p class="err" id="invErr"></p><div><button class="btn btn--orange" type="submit">Send invites</button></div></form>' +
      (S.invites.length ? '<h3 class="rules-h">Invites sent</h3>' + S.invites.map(function (i) {
        return '<div class="kv"><span>' + esc(i.name) + ' <span style="color:var(--muted)">' + esc(i.email) + '</span></span><span>' + (i.joined ? 'Joined' : 'Invited') + '</span></div>';
      }).join('') : '') + '</div>' : '');
  var right = '<div class="block"><h2 class="sec">Challenge rules</h2>' +
    '<div class="kv"><span>Runs</span><span>' + fmtShort(g.start) + ' to ' + fmtShort(g.end) + '</span></div>' +
    '<div class="kv"><span>Workouts that count per day</span><span>' + (g.dailyCap || 'No limit') + '</span></div>' +
    '<h3 class="rules-h">Points for the work</h3>' + cats.map(function (k) { return '<div class="kv"><span>' + SC.cats[k].label + '</span><span>' + esc(rateText(k)) + '</span></div>'; }).join('') +
    '<h3 class="rules-h">Bonuses</h3>' +
    '<div class="kv"><span>Pace on distance workouts, against your PR</span><span>Up to +' + Math.round(SC.paceBonus * 100) + '%</span></div>' +
    '<div class="kv"><span>New PR</span><span>+' + SC.prPoints + '</span></div>' +
    '<div class="kv"><span>Streak, days in a row</span><span>+' + SC.streakStep + ' a day, up to +' + SC.streakCap + '</span></div>' +
    '<p class="rules-p" style="margin-top:14px">The most points when the challenge ends wins. A tie goes to whoever got there first.</p></div>' +
    (admin
      ? (S.board.length > 1
        ? '<div class="block"><h2 class="sec">You are the admin</h2><p class="rules-p">The admin cannot leave or be removed while other people are in the group.</p></div>'
        : '<div class="block"><h2 class="sec">Close this group</h2><p class="rules-p">Nobody else is in it yet. Closing removes the group for good.</p><button class="btn btn--ghost" data-act="leave">Close group</button></div>')
      : '<div class="block"><h2 class="sec">Leave this group</h2><p class="rules-p">You come off the leaderboard and the rankings adjust.</p><button class="btn btn--ghost" data-act="leave">Leave group</button></div>') +
    '<div class="block"><button class="btn btn--ghost btn--sm" data-act="view" data-v="groups">See all my groups</button></div>';
  return '<main class="wrap-w dmain"><div class="cols"><div>' + left + '</div><div>' + right + '</div></div></main>';
}

function prFields() {
  return SC.order.map(function (k) {
    var c = SC.cats[k], r = ME.prs[k] || {};
    var fld = function (key, label, ph, val) { return '<div class="field"><label>' + label + '<input class="input" data-pr="' + k + '|' + key + '" inputmode="decimal" placeholder="' + ph + '" value="' + esc(val) + '"></label></div>'; };
    return '<h3 class="rules-h">' + c.label + '</h3><div class="rec-grid' + (c.type === 'lift' ? ' rec-grid--3' : '') + '">' +
      (c.type === 'dist' ? fld('dist', 'Distance, ' + c.units, '', r.dist ? fmtAmt(r.dist).replace(/,/g, '') : '') + fld('time', 'Your best time', '25:00', r.pace && r.dist ? fmtTime(r.pace * r.dist / c.per) : '')
        : Object.keys(SC.lifts).map(function (l) { return fld(l, SC.lifts[l] + ', lb', '', r[l] ? fmtAmt(r[l]).replace(/,/g, '') : ''); }).join('')) + '</div>';
  }).join('');
}
/* The email, password and delete forms are plain HTML forms that post to the server.
   No script on this page reads or sends a password. */
function viewProfile() {
  var u = ME.user;
  return '<main class="wrap-w dmain">' + (S.flash ? '<p class="' + (S.flash.bad ? 'bad-box' : 'ok-box') + '" role="status">' + esc(S.flash.text) + '</p>' : '') + '<div class="cols"><div>' +
    '<form class="block form-narrow" id="profileForm" novalidate><h2 class="sec">Profile</h2>' +
    '<div class="field"><span class="lbl">Your icon</span><div class="icons">' + ME.avatars.map(function (a) {
      return '<label><input type="radio" name="avatar" value="' + esc(a) + '"' + (u.avatar === a ? ' checked' : '') + ' aria-label="Icon ' + esc(a.replace(/\.\w+$/, '')) + '"><img src="avatars/' + encodeURIComponent(a) + '" alt=""></label>';
    }).join('') + '</div></div>' +
    '<div class="field"><label for="pfName">Full name</label><input class="input" id="pfName" maxlength="80" autocomplete="name" value="' + esc(u.fullName) + '"></div>' +
    '<p class="err" id="pfErr"></p><button class="btn btn--orange" type="submit">Save profile</button></form>' +

    '<form class="block form-narrow" method="post" action="/account/email"><h2 class="sec">Change email</h2>' +
    '<div class="field"><label for="emNew">Email</label><input class="input" id="emNew" name="email" type="email" maxlength="200" autocomplete="email" required value="' + esc(u.email) + '"></div>' +
    '<div class="field"><label for="emCur">Current password</label><input class="input" id="emCur" name="current" type="password" autocomplete="current-password" required></div>' +
    '<button class="btn btn--black" type="submit">Change email</button></form>' +

    '<form class="block form-narrow" method="post" action="/account/password"><h2 class="sec">Change password</h2>' +
    '<div class="field"><label for="pwCur">Current password</label><input class="input" id="pwCur" name="current" type="password" autocomplete="current-password" required></div>' +
    '<div class="field"><label for="pwNew">New password</label><input class="input" id="pwNew" name="next" type="password" autocomplete="new-password" minlength="10" required><p class="hint">At least 10 characters.</p></div>' +
    '<button class="btn btn--black" type="submit">Change password</button></form>' +
    '</div><div>' +
    '<form class="block form-narrow" id="prForm" novalidate><h2 class="sec">Your PRs</h2><p class="rules-p">Enter these once. For distance, give one distance and your best time for it. They update on their own when you beat them.</p>' +
    prFields() + '<p class="err" id="prErr"></p><button class="btn btn--orange" type="submit">Save PRs</button></form>' +
    '<div class="block"><h2 class="sec">Account</h2><div style="display:flex;gap:10px;flex-wrap:wrap"><button class="btn btn--ghost" data-act="logout">Log out</button>' +
    '<button class="btn btn--ghost danger" data-act="deleteAccount">Delete my account</button></div></div>' +
    '</div></div></main>';
}

function render() {
  var body;
  if (S.view === 'profile') body = viewProfile();
  else if (S.view === 'groups' && ME.groups.length) body = viewGroups();
  else if (!S.g) body = viewWelcome();
  else if (S.view === 'power') body = viewPower();
  else if (S.view === 'activity') body = viewActivity();
  else if (S.view === 'group') body = viewGroup();
  else body = viewBoard();
  dash.innerHTML = '<div class="dbar" id="dbar">' + barHTML() + '</div>' + body;
}

/* ---------- pop ups ---------- */
function openModal(html, cls, label) {
  modal.className = 'sheet ' + (cls || '');
  modal.setAttribute('aria-label', label || 'Dialog');
  modal.innerHTML = html;
  modalWrap.classList.add('open');
  var first = modal.querySelector('input, button.btn, button');
  if (first) first.focus();
}
function closeModal() { modalWrap.classList.remove('open'); modal.innerHTML = ''; F = null; }
var modalTop = function (title) { return '<div class="sheet-top"><h2 class="h-md">' + title + '</h2><button class="icon-btn" data-act="close" aria-label="Close">' + ICON.x + '</button></div>'; };

function confirmBox(title, text, yes, act) {
  openModal(modalTop(title) + '<p class="rules-p">' + text + '</p>' +
    '<p class="err" id="cfErr"></p><div style="display:flex;gap:10px;margin-top:20px;flex-wrap:wrap"><button class="btn btn--black" data-act="' + act + '">' + yes + '</button><button class="btn btn--ghost" data-act="close">Cancel</button></div>', 'pop', title);
}

/* What happened since the last visit. */
function updateText(u) {
  var d = u.data || {};
  if (u.type === 'workout') return { t: '<b>' + esc(d.name) + '</b> logged ' + esc(d.cat) + (d.prs && d.prs.length ? ' and set a new PR' : ''), v: '+' + d.total };
  if (u.type === 'lead') return { t: '<b>' + esc(d.name) + '</b> took first place', v: d.points };
  if (u.type === 'joined') return { t: '<b>' + esc(d.name) + '</b> joined the group', v: '' };
  if (u.type === 'left') return { t: '<b>' + esc(d.name) + '</b> left the group', v: '' };
  return { t: 'Something changed', v: '' };
}
function showUpdates() {
  if (!S.gid) return;
  api('GET', '/groups/' + S.gid + '/updates').then(function (d) {
    if (!d.updates.length || modalWrap.classList.contains('open')) return;
    openModal(modalTop('Since you were last here') + d.updates.map(function (u) {
      var x = updateText(u);
      return '<div class="up"><span>' + x.t + '<small>' + esc(new Date(u.created_at).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' })) + '</small></span>' + (x.v !== '' ? '<i>' + x.v + '</i>' : '') + '</div>';
    }).join('') + '<button class="btn btn--orange btn--block" data-act="close" style="margin-top:18px">Got it</button>', 'pop', 'Since you were last here');
  }).catch(function () {});
}
function noteText(n) {
  var d = n.data || {};
  if (n.type === 'join_request') return '<b>' + esc(d.name) + '</b> wants to join <b>' + esc(d.group) + '</b>. Admit them from the Group tab.';
  if (n.type === 'admitted') return 'You were admitted to <b>' + esc(d.group) + '</b>.';
  if (n.type === 'declined') return 'Your request to join <b>' + esc(d.group) + '</b> was not accepted.';
  if (n.type === 'now_admin') return 'You are now the admin of a group.';
  return 'Notification';
}
function showNotes() {
  api('GET', '/notifications').then(function (d) {
    openModal(modalTop('Notifications') + '<div class="note-list">' + (d.notifications.length ? d.notifications.map(function (n) {
      return '<div class="up"><span>' + noteText(n) + '</span><i>' + esc(new Date(n.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })) + '</i></div>';
    }).join('') : '<p class="rules-p">Nothing yet.</p>') + '</div>', 'pop', 'Notifications');
    if (ME.unread) api('POST', '/notifications/read', {}).then(function () { ME.unread = 0; renderBar(); });
  }).catch(fail);
}

/* ---------- create a group ---------- */
function createHTML() {
  var lens = [[7, '1 week'], [14, '2 weeks'], [30, '30 days']], caps = [[1, '1'], [2, '2'], [3, '3'], [0, 'No limit']];
  return modalTop('Create a group') +
    '<p class="rules-p" style="margin-bottom:18px">You will be the admin. You admit everyone who asks to join.</p>' +
    '<div class="field"><label for="cgName">Group name</label><input class="input" id="cgName" data-cg="name" maxlength="60" placeholder="October grind" value="' + esc(F.name) + '"></div>' +
    '<div class="field"><span class="lbl">How long the challenge runs</span><div class="seg">' + lens.map(function (l) {
      return '<button type="button" data-act="cgDays" data-v="' + l[0] + '" aria-pressed="' + (!F.custom && F.days === l[0]) + '">' + l[1] + '</button>';
    }).join('') + '<button type="button" data-act="cgDays" data-v="0" aria-pressed="' + F.custom + '">Other</button></div>' +
    (F.custom ? '<input class="input" data-cg="days" inputmode="numeric" aria-label="Number of days" placeholder="Number of days" value="' + esc(F.days) + '">' : '') +
    '<p class="hint">Starts today.</p></div>' +
    '<div class="field"><span class="lbl">Workouts that count per person each day</span><div class="seg">' + caps.map(function (c) {
      return '<button type="button" data-act="cgCap" data-v="' + c[0] + '" aria-pressed="' + (F.cap === c[0]) + '">' + c[1] + '</button>';
    }).join('') + '</div></div>' +
    '<div class="field"><span class="lbl">Workouts and their rates</span><div class="cat-list">' + SC.order.map(function (k) {
      var c = SC.cats[k], a = F.rates[k];
      return '<label class="cat-row"><input type="checkbox" data-cg="on" data-k="' + k + '"' + (a.on ? ' checked' : '') + '><span class="cat-name">' + c.label + '<small>Players enter ' + (c.type === 'dist' ? c.units + ' and time' : 'sets, reps and weight') + '</small></span>' +
        '<input class="input" data-cg="rate" data-k="' + k + '" inputmode="decimal" aria-label="' + c.label + ' rate" value="' + esc(a.rate) + '"><span class="cat-per">per ' + (c.type === 'dist' ? c.perLabel : 'rep') + '</span></label>';
    }).join('') + '</div></div>' +
    '<div class="field"><span class="lbl">Invite people</span><p class="hint">Add as many as you like. Each gets an email with the link and the group code. You can invite more later.</p>' + invRows(F.inv) + '</div>' +
    '<p class="err" id="cgErr">' + esc(F.err || '') + '</p><button class="btn btn--orange btn--block" data-act="cgSubmit"' + (F.busy ? ' disabled' : '') + '>Create group</button>';
}
function openCreate() {
  var rates = {}; SC.order.forEach(function (k) { rates[k] = { on: true, rate: String(SC.cats[k].rate) }; });
  F = { kind: 'create', name: '', days: 14, custom: false, cap: 2, rates: rates, inv: [{ name: '', email: '' }] };
  openModal(createHTML(), 'sheet--wide', 'Create a group');
}
function submitCreate() {
  var rates = {}; SC.order.forEach(function (k) { if (F.rates[k].on) rates[k] = F.rates[k].rate; });
  F.busy = true; F.err = '';
  api('POST', '/groups', { name: F.name, days: F.days, dailyCap: F.cap, rates: rates, invites: F.inv }).then(function (d) {
    closeModal(); S.gid = d.id; S.view = 'group'; S.inv = null;
    try { localStorage.setItem('ow_group', d.id); } catch (e) {}
    toast('Group created.' + (d.invitesSent ? ' ' + plural(d.invitesSent, 'invite') + ' sent.' : ''));
    return loadMe().then(refresh).then(connect);
  }).catch(function (e) { if (F) { F.busy = false; F.err = e.message; modal.innerHTML = createHTML(); } });
}

/* ---------- log a workout ---------- */
function logBody() {
  var g = S.g, cats = SC.order.filter(function (k) { return g.rates[k] !== undefined; });
  var c = F.cat ? SC.cats[F.cat] : null, rec = F.cat ? (ME.prs[F.cat] || {}) : {};
  var fld = function (key, label, ph) { return '<div class="field"><label>' + label + '<input class="input" data-lg="' + key + '" inputmode="decimal" placeholder="' + ph + '" value="' + esc(F[key] || '') + '"></label></div>'; };
  var cell = function (key, ph, lab) { return '<input class="input" data-lg="' + key + '" inputmode="decimal" placeholder="' + ph + '" aria-label="' + lab + '" value="' + esc(F[key] || '') + '">'; };
  var inputs = '';
  if (c && c.type === 'dist') {
    inputs = '<div class="rec-grid">' + fld('dist', 'Distance, ' + c.units, '') + fld('time', 'Time', '42:30') + '</div><p class="hint rec-line">' +
      (rec.pace ? 'Your PR: ' + fmtAmt(rec.dist) + ' ' + c.unit + ' in ' + fmtTime(rec.pace * rec.dist / c.per) + ' (' + fmtPace(rec.pace) + ' per ' + c.perLabel + ')' : 'No PR saved. Add one in your profile to earn the pace bonus. Otherwise this workout sets it.') + '</p>';
  } else if (c) {
    inputs = '<div class="lift-grid"><span></span><span>Sets</span><span>Reps</span><span>Weight</span><span>Your PR</span>' + Object.keys(SC.lifts).map(function (l) {
      var n = SC.lifts[l];
      return '<b>' + n + '</b>' + cell(l + '_s', '5', n + ' sets') + cell(l + '_r', '5', n + ' reps') + cell(l + '_w', 'lb', n + ' weight in pounds') + cell(l + '_pr', 'lb', n + ' PR in pounds');
    }).join('') + '</div><p class="hint rec-line">Fill in the lifts you did. Your PRs are saved to your profile.</p>';
  }
  var canYest = yesterday() >= g.start;
  return modalTop('Log a workout') +
    '<div class="field"><span class="lbl">What did you finish?</span><div class="pick">' + cats.map(function (k) {
      return '<button type="button" data-act="lgCat" data-v="' + k + '" aria-pressed="' + (F.cat === k) + '"><span>' + SC.cats[k].label + '</span><i>' + fmtAmt(g.rates[k]) + '/' + (SC.cats[k].type === 'dist' ? SC.cats[k].unit === 'mi' ? 'mi' : SC.cats[k].perLabel.replace('yards', 'yd').replace('meters', 'm') : 'rep') + '</i></button>';
    }).join('') + '</div></div>' + inputs + '<div class="prev" id="lgPrev">' + (F.prevHTML || '') + '</div>' +
    (canYest ? '<div class="field"><span class="lbl">When?</span><div class="seg"><button type="button" data-act="lgDate" data-v="' + today() + '" aria-pressed="' + (F.date === today()) + '">Today</button>' +
      '<button type="button" data-act="lgDate" data-v="' + yesterday() + '" aria-pressed="' + (F.date === yesterday()) + '">Yesterday</button></div></div>' : '') +
    '<div class="field"><label for="lgNote">Note, if you want one</label><input class="input" id="lgNote" data-lg="note" maxlength="120" value="' + esc(F.note || '') + '"></div>' +
    '<p class="err" id="lgErr">' + esc(F.err || '') + '</p><button class="btn btn--orange btn--block" data-act="lgSubmit"' + (F.busy ? ' disabled' : '') + '>Log workout</button>';
}
function logPayload() {
  var c = SC.cats[F.cat], body = { cat: F.cat, date: F.date, note: F.note || '' };
  if (c.type === 'dist') { body.dist = F.dist || ''; body.time = F.time || ''; }
  else { body.lifts = {}; Object.keys(SC.lifts).forEach(function (l) { body.lifts[l] = { sets: F[l + '_s'], reps: F[l + '_r'], w: F[l + '_w'], pr: F[l + '_pr'] }; }); }
  return body;
}
function prevHTML(p) {
  var c = SC.cats[F.cat];
  var row = function (a, b, cls) { return '<div class="prev-row' + (cls ? ' ' + cls : '') + '"><span>' + a + '</span><b>' + b + '</b></div>'; };
  return (c.type === 'dist'
      ? row(esc(F.dist) + ' ' + c.unit + ' at ' + esc(rateText(F.cat)), p.base) + (p.hasPr ? row('Pace bonus, ' + fmtPace(p.pace) + ' per ' + c.perLabel, '+' + p.perf) : row('No PR saved, so no pace bonus yet', '+0'))
      : p.rows.map(function (r) { return row(r.name + ' ' + r.sets + ' x ' + r.reps + ' at ' + r.pct + '% of PR', r.pts); }).join('')) +
    p.prs.map(function (x) { return row('New PR: ' + esc(x.toLowerCase()), '+' + SC.prPoints, 'prev-pr'); }).join('') +
    (p.streak ? row('Streak, day ' + p.streakDay, '+' + p.streak) : '') + row('Total', '+' + p.total, 'prev-total') +
    (p.alsoIn && p.alsoIn.length ? '<p class="hint" style="margin-top:10px">Also counts in ' + esc(p.alsoIn.join(', ')) + ', scored at that group\'s rates.</p>' : '');
}
var prevT;
function preview() {
  clearTimeout(prevT);
  prevT = setTimeout(function () {
    if (!F || F.kind !== 'log' || !F.cat) return;
    var mine = F;
    api('POST', '/groups/' + S.gid + '/workouts/preview', logPayload()).then(function (p) {
      if (F !== mine) return;
      F.prevHTML = prevHTML(p); var el = $('lgPrev'); if (el) el.innerHTML = F.prevHTML;
    }).catch(function () { if (F === mine) { F.prevHTML = ''; var el = $('lgPrev'); if (el) el.innerHTML = ''; } });
  }, 280);
}
function openLog() {
  F = { kind: 'log', cat: '', date: today(), note: '' };
  openModal(logBody(), '', 'Log a workout');
}
function submitLog() {
  if (!F.cat) { F.err = 'Pick the workout you finished.'; modal.innerHTML = logBody(); return; }
  F.busy = true; F.err = '';
  api('POST', '/groups/' + S.gid + '/workouts', logPayload()).then(function (p) {
    closeModal();
    toast((p.prs.length ? 'New PR. ' : 'Logged. ') + '+' + p.total + ' points.' + (p.alsoIn && p.alsoIn.length ? ' Also counted in ' + p.alsoIn.join(', ') + '.' : ''));
    return loadMe().then(refresh);
  }).catch(function (e) { if (F) { F.busy = false; F.err = e.message; modal.innerHTML = logBody(); } });
}

/* ---------- events ---------- */
function setView(v) { if (v !== 'profile') S.flash = null; S.view = v; S.feed = null; S.power = S.view === 'power' ? S.power : null; render(); window.scrollTo(0, 0); loadView().then(render).catch(fail); }

document.addEventListener('click', function (e) {
  if (e.target === modalWrap) { closeModal(); return; }
  var el = e.target.closest('[data-act]'); if (!el) return;
  var act = el.getAttribute('data-act'), v = el.getAttribute('data-v'), id = el.getAttribute('data-id'), i = +el.getAttribute('data-i');
  var invList = F && F.kind === 'create' ? F.inv : S.inv;
  switch (act) {
    case 'view': setView(v); break;
    case 'close': closeModal(); break;
    case 'notes': showNotes(); break;
    case 'create': openCreate(); break;
    case 'openGroup':
      S.gid = id; S.inv = null; S.feed = null; S.power = null; S.view = 'board';
      try { localStorage.setItem('ow_group', id); } catch (err) {}
      refresh().then(connect).then(showUpdates).catch(fail); window.scrollTo(0, 0);
      break;
    case 'log': openLog(); break;
    case 'feed': S.feedMine = v === '1'; S.feed = null; render(); loadView().then(render).catch(fail); break;
    case 'copy':
      (navigator.clipboard && navigator.clipboard.writeText ? navigator.clipboard.writeText(S.g.code) : Promise.reject())
        .then(function () { toast('Code ' + S.g.code + ' copied.'); }, function () { toast('Your code is ' + S.g.code + '.'); });
      break;
    case 'invAdd': invList.push({ name: '', email: '' }); if (F) modal.innerHTML = createHTML(); else render(); break;
    case 'invRm': invList.splice(i, 1); if (!invList.length) invList.push({ name: '', email: '' }); if (F) modal.innerHTML = createHTML(); else render(); break;
    case 'cgDays': F.custom = v === '0'; if (!F.custom) F.days = +v; modal.innerHTML = createHTML(); break;
    case 'cgCap': F.cap = +v; modal.innerHTML = createHTML(); break;
    case 'cgSubmit': submitCreate(); break;
    case 'lgCat':
      F.cat = v; F.err = ''; F.prevHTML = '';
      if (SC.cats[v].type === 'lift') { var r = ME.prs[v] || {}; Object.keys(SC.lifts).forEach(function (l) { if (!F[l + '_pr'] && r[l]) F[l + '_pr'] = String(r[l]); }); }
      modal.innerHTML = logBody(); preview(); break;
    case 'lgDate': F.date = v; modal.innerHTML = logBody(); preview(); break;
    case 'lgSubmit': submitLog(); break;
    case 'admit': case 'decline':
      api('POST', '/groups/' + S.gid + '/requests/' + id, { action: act }).then(function () { toast(act === 'admit' ? 'Admitted. They have been emailed.' : 'Declined.'); return refresh(); }).catch(fail);
      break;
    case 'delWorkout': api('DELETE', '/workouts/' + id, {}).then(function () { toast('Workout removed.'); return refresh(); }).catch(fail); break;
    case 'leave':
      if (S.g.role === 'admin') confirmBox('Close ' + esc(S.g.name) + '?', 'This removes the group for good.', 'Close group', 'leaveYes');
      else confirmBox('Leave ' + esc(S.g.name) + '?', 'You come off the leaderboard and the rankings adjust. Your workouts in this group stop counting.', 'Leave group', 'leaveYes');
      break;
    case 'leaveYes':
      S.g0admin = S.g.role === 'admin';
      api('POST', '/groups/' + S.gid + '/leave', {}).then(function () {
        closeModal(); S.gid = null; S.g = null; S.view = 'board'; toast(S.g0admin ? 'Group closed.' : 'You left the group.');
        return loadMe().then(refresh).then(connect);
      }).catch(function (e2) { var x = $('cfErr'); if (x) x.textContent = e2.message; });
      break;
    case 'logout': api('POST', '/auth/logout', {}).then(function () { location.href = 'login.html'; }).catch(fail); break;
    case 'deleteAccount':
      // A plain form that posts to the server. The password never passes through this script.
      openModal(modalTop('Delete your account?') + '<p class="rules-p">This removes your profile, PRs and workouts for good. It cannot be undone.</p>' +
        '<form method="post" action="/account/delete"><div class="field" style="margin-top:16px"><label for="delPass">Your password</label>' +
        '<input class="input" id="delPass" name="password" type="password" autocomplete="current-password" required></div>' +
        '<div style="display:flex;gap:10px;margin-top:20px;flex-wrap:wrap"><button class="btn btn--black" type="submit">Delete my account</button>' +
        '<button class="btn btn--ghost" type="button" data-act="close">Cancel</button></div></form>', 'pop', 'Delete your account');
      break;
  }
});

document.addEventListener('input', function (e) {
  var t = e.target; if (!t.getAttribute) return;
  var inv = t.getAttribute('data-inv');
  if (inv) { (F && F.kind === 'create' ? F.inv : S.inv)[+t.getAttribute('data-i')][inv] = t.value; return; }
  var cg = t.getAttribute('data-cg');
  if (cg && F) {
    if (cg === 'on') F.rates[t.getAttribute('data-k')].on = t.checked;
    else if (cg === 'rate') F.rates[t.getAttribute('data-k')].rate = t.value;
    else F[cg] = t.value;
    return;
  }
  var lg = t.getAttribute('data-lg');
  if (lg && F) { F[lg] = t.value; if (lg !== 'note') preview(); }
});
document.addEventListener('change', function (e) {
  if (e.target.id === 'gsel') {
    S.gid = e.target.value; S.inv = null; S.feed = null; S.power = null;
    try { localStorage.setItem('ow_group', S.gid); } catch (err) {}
    refresh().then(connect).then(showUpdates).catch(fail);
  }
});

document.addEventListener('submit', function (e) {
  var id = e.target.id, err;
  if (!id) return;   // forms without an id post straight to the server
  e.preventDefault();
  if (id === 'joinForm') {
    api('POST', '/groups/join', { code: $('joinCode').value }).then(function (d) {
      S.joinCode = ''; toast('Request sent. The admin of ' + d.group + ' has been emailed.');
      return loadMe().then(render);
    }).catch(fail);
  } else if (id === 'invForm') {
    err = $('invErr'); err.textContent = '';
    api('POST', '/groups/' + S.gid + '/invites', { invites: S.inv }).then(function (d) {
      S.inv = null; toast(d.sent ? plural(d.sent, 'invite') + ' sent.' : 'Those people were already invited.'); return refresh();
    }).catch(function (e2) { err.textContent = e2.message; });
  } else if (id === 'profileForm') {
    err = $('pfErr'); err.textContent = '';
    var pick = e.target.querySelector('input[name="avatar"]:checked');
    api('PATCH', '/me', { fullName: $('pfName').value, avatar: pick ? pick.value : '' })
      .then(function () { toast('Profile saved.'); S.flash = null; return loadMe().then(loadGroup).then(render); }).catch(function (e2) { err.textContent = e2.message; });
  } else if (id === 'prForm') {
    err = $('prErr'); err.textContent = '';
    var prs = {};
    Array.prototype.forEach.call(e.target.querySelectorAll('[data-pr]'), function (inp) { var p = inp.getAttribute('data-pr').split('|'); (prs[p[0]] = prs[p[0]] || {})[p[1]] = inp.value; });
    api('PUT', '/me/prs', { prs: prs }).then(function (d) { ME.prs = d.prs; toast('PRs saved.'); }).catch(function (e2) { err.textContent = e2.message; });
  }
});
document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && modalWrap.classList.contains('open')) closeModal(); });

/* ---------- start ---------- */
var FLASH = {
  pw_ok: 'Password changed.', email_ok: 'Email changed.',
  pw_current: 'Your current password is not right. Nothing was changed.', pw_weak: 'Use a password with at least 10 characters.',
  email_bad: 'Enter a valid email address.', email_pw: 'Your current password is not right. Your email was not changed.',
  email_taken: 'Another account already uses that email.',
  del_pw: 'That password is not right. Your account was not deleted.',
  del_admin: 'You are the admin of a running challenge with other people in it. The admin cannot be removed until it ends.'
};
(function readAddress() {
  var qs = new URLSearchParams(location.search);
  if (qs.get('tab') === 'profile') S.view = 'profile';
  var msg = qs.get('msg'), bad = qs.get('e');
  if (FLASH[msg]) S.flash = { text: FLASH[msg], bad: false };
  if (FLASH[bad]) S.flash = { text: FLASH[bad], bad: true };
  // An invite link carries the group code through sign up and log in.
  S.joinCode = (qs.get('code') || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
  if (location.search) { try { history.replaceState(null, '', location.pathname); } catch (e) {} }
})();
loadMe().then(function () {
  if (S.joinCode && activeGroups().length) S.view = 'groups';
  return refresh();
}).then(function () { connect(); if (S.view !== 'profile') showUpdates(); }).catch(function (e) {
  dash.innerHTML = '<div class="wrap-w spin">' + esc(e.message || 'Could not load your dashboard.') + '</div>';
});
// Safety net if the live connection drops: refresh the board every minute while the tab is visible.
setInterval(function () {
  if (document.hidden || !S.g || S.view === 'profile' || modalWrap.classList.contains('open')) return;
  var typing = document.activeElement && /INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName);
  if (!typing) refresh().catch(function () {});
}, 60000);
})();
