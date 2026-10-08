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
var fmtSent = function (iso) { var d = new Date(iso), t = toStr(d); return t === today() ? 'today' : t === yesterday() ? 'yesterday' : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }); };
var fmtShort = function (s) { return toDate(s).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }); };
var plural = function (n, w) { return n + ' ' + w + (n === 1 ? '' : 's'); };
var ordinal = function (n) { var s = ['th', 'st', 'nd', 'rd'], v = n % 100; return s[(v - 20) % 10] || s[v] || s[0]; };
var fmtAmt = function (n) { return (Math.round(n * 1000) / 1000).toLocaleString(undefined, { maximumFractionDigits: 3 }); };
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
  mark: '<svg viewBox="0 0 24 24"><path d="M4 20l6-16 4 9 2-4 4 11z"/></svg>',
  menu: '<svg viewBox="0 0 24 24"><path d="M4 7h16M4 12h16M4 17h16"/></svg>',
  go: '<svg viewBox="0 0 24 24"><path d="M15 6l-6 6 6 6"/></svg>'
};

var toastT;
function toast(msg) {
  toastEl.textContent = msg; toastEl.classList.add('show');
  clearTimeout(toastT); toastT = setTimeout(function () { toastEl.classList.remove('show'); }, 3200);
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
var S = { view: 'board', gid: null, g: null, board: [], invites: [], power: null, feed: null, feedMine: true, notes: [], loading: true };
var F = null;                      // open form state (log workout or create group)
var source = null;

var activeGroups = function () { return ME.groups; };
/* A challenge is running until its last day passes on this person's own calendar, or the admin shuts it down. */
var running = function (g) { return !g.closed && today() <= g.end; };
var liveGroups = function () { return ME.groups.filter(running); };
var pastGroups = function () { return ME.groups.filter(function (g) { return !running(g); }); };
var rateText = function (cat) { var c = SC.cats[cat]; return fmtAmt(S.g.rates[cat]) + ' per ' + c.perLabel; };
var over = function () { return !!S.g && !running(S.g); };
var GROUP_VIEWS = { board: 1, power: 1, activity: 1, group: 1 };

/* ---------- loading ---------- */
function loadMe() {
  return api('GET', '/me').then(function (d) {
    ME = d; SC = d.scoring;
    // Which challenge is open. One running challenge opens by itself. With several, the person picks from My groups.
    // A finished challenge is never opened automatically: it sits under past challenges.
    var live = liveGroups(), saved = null;
    try { saved = localStorage.getItem('ow_group'); } catch (e) {}
    if (!S.gid || !ME.groups.some(function (g) { return g.id === S.gid; })) {
      S.gid = live.some(function (g) { return g.id === saved; }) ? saved : (live.length === 1 ? live[0].id : null);
      if (!S.gid && GROUP_VIEWS[S.view]) S.view = 'groups';
    }
  });
}
function loadGroup() {
  if (!S.gid) { S.g = null; S.board = []; return Promise.resolve(); }
  return api('GET', '/groups/' + S.gid).then(function (d) {
    S.g = d.group; S.board = d.board; S.invites = d.invites || [];
    if (over() && S.view !== 'board' && GROUP_VIEWS[S.view]) S.view = 'board';   // a finished challenge only has its final results
  }).catch(function (e) { if (e.status === 404) { S.gid = null; S.g = null; return loadMe().then(loadGroup); } throw e; });
}
function loadView() {
  if (!S.g || over()) return Promise.resolve();
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
/* The tabs follow what is open. A running challenge has all of them. A finished one only has its final results.
   With no challenge open there is nothing but My groups and Profile. */
function tabs() {
  if (!ME.groups.length) return [['groups', 'Home'], ['profile', 'Profile']];
  if (!S.g) return [['groups', 'My groups'], ['profile', 'Profile']];
  if (over()) return [['board', 'Final results'], ['groups', 'My groups'], ['profile', 'Profile']];
  return [['board', 'Leaderboard'], ['power', 'Power rankings'], ['activity', 'Activity'], ['group', 'Group'], ['groups', 'My groups'], ['profile', 'Profile']];
}
var BRAND = '<a class="brand" href="index.html"><i>' + ICON.mark + '</i>Outwork</a>';
/* Desktop shows the tabs in the bar. Phones and tablets get the menu button instead. */
function barHTML() {
  return '<div class="wrap-w dbar-in">' + BRAND +
    '<nav class="dtabs" aria-label="Dashboard">' + tabs().map(function (t) {
      return '<button class="dtab" data-act="view" data-v="' + t[0] + '"' + (S.view === t[0] ? ' aria-current="page"' : '') + '>' + t[1] + '</button>';
    }).join('') + '</nav><div class="dbar-right">' +
    '<button class="bell" data-act="notes" aria-label="Notifications' + (ME.unread ? ', ' + ME.unread + ' new' : '') + '">' + ICON.bell + (ME.unread ? '<b>' + ME.unread + '</b>' : '') + '</button>' +
    '<button class="dbar-me" data-act="view" data-v="profile" aria-label="Your profile">' + ava({ avatar: ME.user.avatar, name: ME.user.fullName }, 'ava--sm') + '</button>' +
    '<button class="menu-btn" id="menuBtn" data-act="menu" aria-label="Open menu" aria-expanded="' + menuOpen() + '">' + ICON.menu + '</button>' +
    '</div></div>';
}
function renderBar() { var b = $('dbar'); if (b) b.innerHTML = barHTML(); }

/* The menu for phones and tablets: every page, the group switcher and log out. The page blurs behind it. */
function menuHTML() {
  return '<div class="menu-veil" data-act="menuClose"></div>' +
    '<aside class="menu" id="menu" role="dialog" aria-modal="true" aria-label="Menu">' +
    '<div class="menu-top">' + BRAND + '<button class="icon-btn" id="menuX" data-act="menuClose" aria-label="Close menu">' + ICON.x + '</button></div>' +
    (S.g ? '<p class="menu-ctx">' + (over() ? 'Finished challenge' : 'Open challenge') + '<b>' + esc(S.g.name) + '</b></p>' : '') +
    '<div class="menu-links">' + tabs().map(function (t) {
      return '<button data-act="view" data-v="' + t[0] + '"' + (S.view === t[0] ? ' class="on" aria-current="page"' : '') + '>' + t[1] + ICON.go + '</button>';
    }).join('') + '</div>' +
    (liveGroups().length ? '<div class="menu-actions"><button class="btn btn--orange btn--block" data-act="log">' + ICON.plus + 'Log a workout</button></div>' : '') +
    '<div class="menu-acct"><p>' + esc(ME.user.fullName) + '<br>' + esc(ME.user.email) + '</p><button class="btn btn--ghost btn--block" data-act="logout">Log out</button></div></aside>';
}
function menuOpen() { return document.documentElement.classList.contains('menu-open'); }
function openMenu() {
  document.documentElement.classList.add('menu-open');
  var b = $('menuBtn'), x = $('menuX');
  if (b) b.setAttribute('aria-expanded', 'true');
  if (x) x.focus();
}
function closeMenu() {
  if (!menuOpen()) return;
  document.documentElement.classList.remove('menu-open');
  var b = $('menuBtn'); if (b) b.setAttribute('aria-expanded', 'false');
}

/* ---------- views ---------- */
function viewWelcome() {
  return '<main class="wrap-w"><div class="welcome"><h1 class="h-lg">Welcome, ' + esc(ME.user.fullName.split(' ')[0]) + '.</h1>' +
    '<p>You are not in a group yet, so there is no leaderboard to show. Create a group and invite people, or join one with a code.</p>' +
    '<button class="btn btn--orange" data-act="create">' + ICON.plus + 'Create a group</button>' +
    '<p class="or">Have a group code?</p>' +
    joinFormHTML() +
    '</div></main>';
}

var joinFormHTML = function () {
  return '<form class="join-row" id="joinForm" novalidate><input class="input" id="joinCode" maxlength="6" autocomplete="off" autocapitalize="characters" aria-label="Group code" placeholder="CODE" value="' + esc(S.joinCode || '') + '">' +
    '<button class="btn btn--black" type="submit">Join</button></form>';
};
/* Every group this person is in. Each one keeps its own leaderboard, and only counts workouts from its own start date. */
/* Every challenge this person is in, as cards. Running ones first, finished ones under them. */
function viewGroups() {
  var live = liveGroups(), past = pastGroups();
  var card = function (g) {
    var on = running(g), left = dayDiff(g.end, today()), place = g.rank ? g.rank + ordinal(g.rank) : 'Unplaced';
    var when = on ? (today() < g.start ? 'Starts ' + fmtShort(g.start) : left <= 0 ? 'Last day' : plural(left + 1, 'day') + ' left')
      : (g.closed ? 'Shut down by the admin' : 'Ended ' + fmtShort(g.end));
    return '<button class="gcard' + (on ? '' : ' gcard--past') + (g.id === S.gid ? ' gcard--on' : '') + '" data-act="openGroup" data-id="' + g.id + '">' +
      '<span class="gcard-top"><b>' + esc(g.name) + '</b>' + (g.role === 'admin' ? '<span class="tag tag--k">Admin</span>' : '') + (g.id === S.gid ? '<span class="tag">Open now</span>' : '') + '</span>' +
      (on ? '<span class="gcard-rank">' + (g.rank ? g.rank + '<small>' + ordinal(g.rank) + '</small>' : '0') + '</span>' +
            '<span class="gcard-meta">of ' + g.members + ', with ' + plural(g.points, 'point') + '</span>'
          : '<span class="gcard-meta">You finished ' + place + ' of ' + g.members + ' with ' + plural(g.points, 'point') + '</span>' +
            '<span class="gcard-meta">' + (g.leader ? 'Winner: ' + esc(g.leader) : 'Nobody logged a workout') + '</span>') +
      '<span class="gcard-when">' + esc(when) + '</span><span class="gcard-go">' + (on ? 'Open leaderboard' : 'See final results') + ICON.go + '</span></button>';
  };
  return '<main class="wrap-w dmain"><h2 class="sec">My groups</h2>' +
    (live.length
      ? '<p class="rules-p">' + (live.length > 1 ? 'You are in ' + live.length + ' running challenges. Pick one to open its leaderboard. A workout you log counts in every one of them.' : 'Open your challenge to see its leaderboard.') + '</p>' +
        '<div class="gcards">' + live.map(card).join('') + '</div>' +
        '<div class="glog"><button class="btn btn--black" data-act="log">' + ICON.plus + 'Log a workout</button>' + (live.length > 1 ? '<span>Counts in all ' + live.length + ' challenges.</span>' : '') + '</div>'
      : '<div class="empty">You are not in a running challenge. Create a group or join one with a code.</div>') +
    '<div class="block" style="margin-top:36px"><button class="btn btn--orange" data-act="create">' + ICON.plus + 'Create a group</button>' +
    '<p class="or">Have a group code?</p>' + joinFormHTML() + '</div>' +
    (past.length ? '<div class="block"><h2 class="sec">Past challenges</h2><div class="gcards">' + past.map(card).join('') + '</div></div>' : '') +
    '</main>';
}
/* Which challenge the page is about, shown when the person is in more than one. */
var ctxLine = function () { return liveGroups().length > 1 ? '<p class="ctx">' + esc(S.g.name) + '<button class="link" data-act="view" data-v="groups">Switch</button></p>' : ''; };

function viewBoard() {
  var g = S.g, me = S.board.filter(function (r) { return r.id === ME.user.id; })[0] || { points: 0, rank: 0, streak: 0 };
  var left = dayDiff(g.end, today()), ended = over();
  var winner = ended && S.board[0] && S.board[0].points > 0 ? S.board[0] : null;
  var hero = '<header class="band--orange dhero"><div class="wrap-w">' +
    (ended
      ? '<h1 class="h-lg"><span class="h-dim">' + esc(g.name) + ' is over.</span> ' + (winner ? esc(winner.id === ME.user.id ? 'You win.' : winner.name + ' wins.') : 'Nobody logged a workout.') + '</h1>' +
        '<p class="hero-sub"><span>' + (g.closed ? 'The admin shut this challenge down early. These results are final.' : 'It ended ' + esc(fmtDay(g.end)) + '. These results are final.') + '</span></p>'
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
  return hero + '<main class="wrap-w dmain"><h2 class="sec">' + (ended ? 'Final leaderboard' : 'Leaderboard') + '</h2><div class="lb">' + rows + '</div>' +
    (ended
      ? '<div class="block" style="margin-top:40px"><h2 class="sec">This challenge is finished</h2><p class="rules-p">Nothing more can be logged here. You can keep it under past challenges or take it off your list.</p>' +
        '<div class="pop-actions"><button class="btn btn--black" data-act="view" data-v="groups">Back to my groups</button><button class="btn btn--ghost" data-act="leave">Remove from my list</button></div></div>'
      : S.board.length === 1 ? '<p class="note">It is only you so far. Invite people from the Group tab.</p>' : '') + '</main>';
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
    : '<div class="proj"><div class="proj-who">' + ava(top, 'ava--lg') + '<div><small>Projected winner</small><strong>' + esc(top.name) + '</strong>' +
      '<p class="proj-num">' + top.projected + ' points projected, ' + plural(Math.max(0, dayDiff(S.g.end, today())), 'day') + ' left' + '</p></div></div><ul>' +
      why.map(function (w) { return '<li>' + w + '</li>'; }).join('') + '</ul></div>';
  return '<main class="wrap-w dmain">' + ctxLine() + '<h2 class="sec">Power rankings</h2>' +
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
  return '<main class="wrap-w dmain">' + ctxLine() + '<h2 class="sec">Activity</h2><div class="seg" style="margin-bottom:18px">' +
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
  var g = S.g, admin = g.role === 'admin', ended = over();
  if (!S.inv) S.inv = [{ name: '', email: '' }];
  var cats = SC.order.filter(function (k) { return g.rates[k] !== undefined; });
  var waiting = S.invites.filter(function (i) { return !i.joined; });
  var invites = !admin ? '' : ended
    ? ''
    : '<div class="block"><h2 class="sec">Invite people</h2><p class="rules-p">Each person gets an email with a link to sign up and the group code. They are in the group as soon as they use it.</p>' +
      '<form id="invForm" novalidate>' + invRows(S.inv) + '<p class="err" id="invErr"></p><div><button class="btn btn--orange" type="submit">Send invites</button></div></form>' +
      (S.invites.length ? '<div class="inv-head"><h3 class="rules-h">Invites sent</h3>' +
        (waiting.length > 1 ? '<button class="btn btn--ghost btn--sm" data-act="resendAll">Resend to all ' + waiting.length + ' waiting</button>' : '') + '</div>' +
        S.invites.map(function (i) {
          return '<div class="mem"><div class="mem-name">' + esc(i.name) + '<small>' + esc(i.email) + (i.joined ? '' : ', sent ' + esc(fmtSent(i.sent_at)) + (i.sends > 1 ? ' (' + i.sends + ' times)' : '')) + '</small></div>' +
            (i.joined ? '<span class="tag">Joined</span>' : '<button class="btn btn--ghost" data-act="resend" data-id="' + i.id + '">Resend</button>') + '</div>';
        }).join('') : '') + '</div>';
  var left = '<div class="block"><div class="code-box"><div><p>Group code</p><b id="codeText">' + esc(g.code) + '</b></div><button class="btn btn--orange btn--sm" data-act="copy">Copy code</button></div></div>' +
    '<div class="block"><h2 class="sec">Members</h2>' + S.board.map(function (r) {
      return '<div class="mem">' + ava(r) + '<div class="mem-name">' + esc(r.name) + (r.id === ME.user.id ? ' <span class="tag">You</span>' : '') + '</div>' + (r.role === 'admin' ? '<span class="tag tag--k">Admin</span>' : '') + '</div>';
    }).join('') + '</div>' + invites;
  var adminBlocks = '';
  if (admin) {
    adminBlocks = ended
      ? '<div class="block"><h2 class="sec">This challenge is over</h2><p class="rules-p">' + (g.closed ? 'You shut it down. ' : '') + 'The leaderboard is final and nothing more can be logged.</p></div>'
      : '<div class="block"><h2 class="sec">Shut down the challenge</h2><p class="rules-p">Ends the challenge now for everyone. The leaderboard freezes, whoever is in first wins, and nothing more can be logged. This cannot be undone.</p>' +
        '<button class="btn btn--ghost danger" data-act="shut">Shut down challenge</button></div>';
    adminBlocks += S.board.length > 1
      ? '<div class="block"><h2 class="sec">You are the admin</h2><p class="rules-p">The admin cannot leave or be removed while other people are in the group.</p></div>'
      : '<div class="block"><h2 class="sec">Delete this group</h2><p class="rules-p">Nobody else is in it. Deleting removes the group and its leaderboard for good.</p><button class="btn btn--ghost" data-act="leave">Delete group</button></div>';
  }
  var right = '<div class="block"><h2 class="sec">Challenge rules</h2>' +
    '<div class="kv"><span>' + (ended ? 'Ran' : 'Runs') + '</span><span>' + fmtShort(g.start) + ' to ' + fmtShort(g.end) + '</span></div>' +
    '<div class="kv"><span>Workouts that count per day</span><span>' + (g.dailyCap || 'No limit') + '</span></div>' +
    '<h3 class="rules-h">Points for the work</h3>' + cats.map(function (k) { return '<div class="kv"><span>' + SC.cats[k].label + '</span><span>' + esc(rateText(k)) + '</span></div>'; }).join('') +
    '<h3 class="rules-h">Bonuses</h3>' +
    '<div class="kv"><span>Pace on distance workouts, against your PR</span><span>Up to +' + Math.round(SC.paceBonus * 100) + '%</span></div>' +
    '<div class="kv"><span>New PR</span><span>+' + SC.prPoints + '</span></div>' +
    '<div class="kv"><span>Streak, days in a row</span><span>+' + SC.streakStep + ' a day, up to +' + SC.streakCap + '</span></div>' +
    '<p class="rules-p" style="margin-top:14px">The most points when the challenge ends wins. A tie goes to whoever got there first.</p></div>' +
    (admin ? adminBlocks
      : '<div class="block"><h2 class="sec">Leave this group</h2><p class="rules-p">You come off the leaderboard and the rankings adjust.</p><button class="btn btn--ghost" data-act="leave">Leave group</button></div>') +
    '<div class="block"><button class="btn btn--ghost btn--sm" data-act="view" data-v="groups">See all my groups</button></div>';
  return '<main class="wrap-w dmain"><h1 class="gname">' + esc(g.name) + (ended ? '<span class="tag tag--k">Ended</span>' : '') + '</h1><div class="cols"><div>' + left + '</div><div>' + right + '</div></div></main>';
}

/* Time is typed as hours, minutes and seconds in three number boxes, so a phone keypad can enter it exactly. */
var TIME_PARTS = [['th', 'hr', 'Hours'], ['tm', 'min', 'Minutes'], ['ts', 'sec', 'Seconds']];
function timeBoxes(attr, prefix, vals, label) {
  return '<div class="field"><span class="lbl">' + label + '</span><div class="time3">' + TIME_PARTS.map(function (p) {
    return '<label><input class="input" ' + attr + '="' + prefix + p[0] + '" inputmode="numeric" pattern="[0-9]*" maxlength="' + (p[0] === 'tm' ? 3 : 2) + '" placeholder="0" aria-label="' + p[2] + '" value="' + esc(vals[p[0]] || '') + '"><small>' + p[1] + '</small></label>';
  }).join('') + '</div></div>';
}
/* "1:05:30" for the server, or '' when nothing was typed. */
function timeText(o) {
  var n = function (v) { var x = parseInt(String(v || '').replace(/[^0-9]/g, ''), 10); return x > 0 ? x : 0; };
  var h = n(o.th), m = n(o.tm), s = n(o.ts);
  return h || m || s ? h + ':' + pad(m) + ':' + pad(s) : '';
}
function timeParts(mins) {
  var t = Math.round(mins * 60); if (!(t > 0)) return {};
  var h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
  return { th: h ? String(h) : '', tm: String(m), ts: pad(s) };
}
var distText = function (v) { return String(v || '').replace(',', '.').replace(/[^0-9.]/g, ''); };
function prFields() {
  return SC.order.map(function (k) {
    var c = SC.cats[k], r = ME.prs[k] || {};
    var fld = function (key, label, ph, val) { return '<div class="field"><label>' + label + '<input class="input" data-pr="' + k + '|' + key + '" inputmode="decimal" placeholder="' + ph + '" value="' + esc(val) + '"></label></div>'; };
    return '<h3 class="rules-h">' + c.label + '</h3><div class="rec-grid' + (c.type === 'lift' ? ' rec-grid--3' : ' rec-grid--time') + '">' +
      (c.type === 'dist' ? fld('dist', 'Distance, ' + c.units, '', r.dist ? String(Math.round(r.dist * 1000) / 1000) : '') + timeBoxes('data-pr', k + '|', r.pace && r.dist ? timeParts(r.pace * r.dist / c.per) : {}, 'Your best time')
        : Object.keys(SC.lifts).map(function (l) { return fld(l, SC.lifts[l] + ', lb', '', r[l] ? fmtAmt(r[l]).replace(/,/g, '') : ''); }).join('')) + '</div>';
  }).join('');
}
/* The email, password and delete forms are plain HTML forms that post to the server.
   No script on this page reads or sends a password. */
function viewProfile() {
  var u = ME.user;
  return '<main class="wrap-w dmain">' + (S.flash ? '<p class="' + (S.flash.bad ? 'bad-box' : 'ok-box') + '" role="status">' + esc(S.flash.text) + '</p>' : '') + '<div class="cols cols--profile"><div>' +
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
    '<form class="block form-narrow pr-block" id="prForm" novalidate><h2 class="sec">Your PRs</h2><p class="rules-p">Enter these once. For distance, give one distance and your best time for it. They update on their own when you beat them.</p>' +
    prFields() + '<p class="err" id="prErr"></p><button class="btn btn--orange" type="submit">Save PRs</button></form>' +
    '<div class="block"><h2 class="sec">Account</h2><div style="display:flex;gap:10px;flex-wrap:wrap"><button class="btn btn--ghost" data-act="logout">Log out</button>' +
    '<button class="btn btn--ghost danger" data-act="deleteAccount">Delete my account</button></div></div>' +
    '</div></div></main>';
}

function render() {
  var body;
  if (S.g && over() && S.view !== 'board' && GROUP_VIEWS[S.view]) S.view = 'board';
  if (S.view === 'profile') body = viewProfile();
  else if (!ME.groups.length) body = viewWelcome();
  else if (S.view === 'groups' || !S.g) body = viewGroups();
  else if (S.view === 'power') body = viewPower();
  else if (S.view === 'activity') body = viewActivity();
  else if (S.view === 'group') body = viewGroup();
  else body = viewBoard();
  dash.innerHTML = '<div class="dbar" id="dbar">' + barHTML() + '</div>' + body + menuHTML();
}

/* ---------- pop ups ---------- */
function openModal(html, cls, label) {
  modal.className = 'sheet ' + (cls || '');
  modal.setAttribute('aria-label', label || 'Dialog');
  modal.innerHTML = html;
  modalWrap.classList.add('open');
  var first = modal.querySelector('input') || modal.querySelector('button.btn') || modal.querySelector('button');
  if (first) first.focus();
}
function closeModal() { modalWrap.classList.remove('open'); modal.innerHTML = ''; F = null; }
var modalTop = function (title) { return '<div class="sheet-top"><h2 class="h-md">' + title + '</h2><button class="icon-btn" data-act="close" aria-label="Close">' + ICON.x + '</button></div>'; };

function confirmBox(title, text, yes, act) {
  openModal(modalTop(title) + '<p class="rules-p">' + text + '</p>' +
    '<p class="err" id="cfErr"></p><div class="pop-actions"><button class="btn btn--black" data-act="' + act + '">' + yes + '</button><button class="btn btn--ghost" data-act="close">Cancel</button></div>', 'pop', title);
}

/* What happened since the last visit. */
function updateText(u) {
  var d = u.data || {};
  if (u.type === 'workout') return { t: '<b>' + esc(d.name) + '</b> logged ' + esc(d.cat) + (d.prs && d.prs.length ? ' and set a new PR' : ''), v: '+' + d.total };
  if (u.type === 'lead') return { t: '<b>' + esc(d.name) + '</b> took first place', v: d.points };
  if (u.type === 'joined') return { t: '<b>' + esc(d.name) + '</b> joined the group', v: '' };
  if (u.type === 'left') return { t: '<b>' + esc(d.name) + '</b> left the group', v: '' };
  if (u.type === 'closed') return { t: '<b>' + esc(d.name) + '</b> shut the challenge down' + (d.winner ? '. <b>' + esc(d.winner) + '</b> wins' : ''), v: '' };
  return { t: 'Something changed', v: '' };
}
function showUpdates() {
  if (!S.gid) return;
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
  if (n.type === 'member_joined' || n.type === 'join_request') return '<b>' + esc(d.name) + '</b> joined <b>' + esc(d.group) + '</b>.';
  if (n.type === 'challenge_closed') return '<b>' + esc(d.name) + '</b> shut down <b>' + esc(d.group) + '</b>.' + (d.winner ? ' <b>' + esc(d.winner) + '</b> won.' : '');
  if (n.type === 'admitted') return 'You joined <b>' + esc(d.group) + '</b>.';
  if (n.type === 'declined') return 'Your request to join <b>' + esc(d.group) + '</b> was not accepted.';
  if (n.type === 'now_admin') return 'You are now the admin of a group.';
  return 'Notification';
}
/* First time on the dashboard with no PRs saved: send them to enter their PRs. Shown once. */
function showFirstVisit() {
  ME.firstVisit = false; toastEl.classList.remove('show');
  var joined = S.justJoined ? '<p class="ok-box" style="margin-top:8px">You are in ' + esc(S.justJoined) + '.</p>' : '';
  S.justJoined = '';
  api('POST', '/me/welcomed', {}).catch(function () {});
  openModal(modalTop('Start with your PRs') + joined +
    '<p class="rules-p">Your workouts are scored against your own PRs. Enter them once and you earn pace and PR bonus points from your first workout.</p>' +
    '<div class="pop-actions"><button class="btn btn--orange" data-act="goPrs">Enter my PRs</button><button class="btn btn--ghost" data-act="close">Later</button></div>', 'pop', 'Start with your PRs');
}
function goPrs() {
  closeModal(); S.flash = null; S.view = 'profile'; render();
  var f = $('prForm'); if (f) { f.scrollIntoView({ block: 'start' }); var i = f.querySelector('input'); if (i) i.focus({ preventScroll: true }); }
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
    '<p class="rules-p" style="margin-bottom:18px">You will be the admin. Anyone with the group code can join.</p>' +
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
  api('POST', '/groups', { name: F.name, days: F.days, dailyCap: F.cap, rates: rates, invites: F.inv, today: today() }).then(function (d) {
    closeModal(); S.gid = d.id; S.view = 'group'; S.inv = null;
    try { localStorage.setItem('ow_group', d.id); } catch (e) {}
    toast('Group created.' + (d.invitesSent ? ' ' + plural(d.invitesSent, 'invite') + ' sent.' : ''));
    return loadMe().then(refresh).then(connect);
  }).catch(function (e) { if (F) { F.busy = false; F.err = e.message; modal.innerHTML = createHTML(); } });
}

/* ---------- log a workout ---------- */
/* A workout goes into every running challenge it fits, so the form covers all of them. */
function logGroups() { var live = liveGroups(); return S.g && running(S.g) ? live.slice().sort(function (a, b) { return (b.id === S.gid) - (a.id === S.gid); }) : live; }
function logBody() {
  var groups = logGroups(), many = groups.length > 1;
  var cats = SC.order.filter(function (k) { return groups.some(function (g) { return g.rates[k] !== undefined; }); });
  var rateOf = function (k) {   // shown when every challenge with this workout pays the same
    var r = groups.filter(function (g) { return g.rates[k] !== undefined; }).map(function (g) { return g.rates[k]; });
    return r.every(function (x) { return x === r[0]; }) ? r[0] : null;
  };
  var c = F.cat ? SC.cats[F.cat] : null, rec = F.cat ? (ME.prs[F.cat] || {}) : {};
  var fld = function (key, label, ph) { return '<div class="field"><label>' + label + '<input class="input" data-lg="' + key + '" inputmode="decimal" placeholder="' + ph + '" value="' + esc(F[key] || '') + '"></label></div>'; };
  var cell = function (key, ph, lab) { return '<input class="input" data-lg="' + key + '" inputmode="decimal" placeholder="' + ph + '" aria-label="' + lab + '" value="' + esc(F[key] || '') + '">'; };
  var inputs = '';
  if (c && c.type === 'dist') {
    inputs = '<div class="rec-grid rec-grid--time">' + fld('dist', 'Distance, ' + c.units, c.unit === 'mi' ? '3.25' : '') + timeBoxes('data-lg', '', F, 'Time') + '</div><p class="hint rec-line">' +
      (rec.pace ? 'Your PR: ' + fmtAmt(rec.dist) + ' ' + c.unit + ' in ' + fmtTime(rec.pace * rec.dist / c.per) + ' (' + fmtPace(rec.pace) + ' per ' + c.perLabel + ')' : 'No PR saved. Add one in your profile to earn the pace bonus. Otherwise this workout sets it.') + '</p>';
  } else if (c) {
    inputs = '<div class="lift-grid"><span></span><span>Sets</span><span>Reps</span><span>Weight</span><span>Your PR</span>' + Object.keys(SC.lifts).map(function (l) {
      var n = SC.lifts[l];
      return '<b>' + n + '</b>' + cell(l + '_s', '5', n + ' sets') + cell(l + '_r', '5', n + ' reps') + cell(l + '_w', 'lb', n + ' weight in pounds') + cell(l + '_pr', 'lb', n + ' PR in pounds');
    }).join('') + '</div><p class="hint rec-line">Fill in the lifts you did. Your PRs are saved to your profile.</p>';
  }
  var canYest = groups.some(function (g) { return yesterday() >= g.start; });
  return modalTop('Log a workout') +
    (many ? '<p class="ok-box" style="margin:0 0 16px">Counts in ' + esc(groups.map(function (g) { return g.name; }).join(' and ')) + '.</p>' : '') +
    '<div class="field"><span class="lbl">What did you finish?</span><div class="pick">' + cats.map(function (k) {
      var r = rateOf(k), u = SC.cats[k];
      return '<button type="button" data-act="lgCat" data-v="' + k + '" aria-pressed="' + (F.cat === k) + '"><span>' + u.label + '</span>' +
        (r === null ? '' : '<i>' + fmtAmt(r) + '/' + (u.type === 'dist' ? u.unit === 'mi' ? 'mi' : u.perLabel.replace('yards', 'yd').replace('meters', 'm') : 'rep') + '</i>') + '</button>';
    }).join('') + '</div></div>' + inputs + '<div class="prev" id="lgPrev">' + (F.prevHTML || '') + '</div>' +
    (canYest ? '<div class="field"><span class="lbl">When?</span><div class="seg"><button type="button" data-act="lgDate" data-v="' + today() + '" aria-pressed="' + (F.date === today()) + '">Today</button>' +
      '<button type="button" data-act="lgDate" data-v="' + yesterday() + '" aria-pressed="' + (F.date === yesterday()) + '">Yesterday</button></div></div>' : '') +
    '<div class="field"><label for="lgNote">Note, if you want one</label><input class="input" id="lgNote" data-lg="note" maxlength="120" value="' + esc(F.note || '') + '"></div>' +
    '<p class="err" id="lgErr">' + esc(F.err || '') + '</p><button class="btn btn--orange btn--block" data-act="lgSubmit"' + (F.busy ? ' disabled' : '') + '>Log workout</button>';
}
function logPayload() {
  var c = SC.cats[F.cat], body = { cat: F.cat, date: F.date, note: F.note || '', group: S.g && running(S.g) ? S.gid : undefined };
  if (c.type === 'dist') { body.dist = distText(F.dist); body.time = timeText(F); }
  else { body.lifts = {}; Object.keys(SC.lifts).forEach(function (l) { body.lifts[l] = { sets: F[l + '_s'], reps: F[l + '_r'], w: F[l + '_w'], pr: F[l + '_pr'] }; }); }
  return body;
}
function prevHTML(p) {
  var c = SC.cats[F.cat], many = p.groups && p.groups.length > 1;
  var row = function (a, b, cls) { return '<div class="prev-row' + (cls ? ' ' + cls : '') + '"><span>' + a + '</span><b>' + b + '</b></div>'; };
  return (many ? '<p class="prev-in">In ' + esc(p.group) + '</p>' : '') +
    (c.type === 'dist'
      ? row(esc(distText(F.dist)) + ' ' + c.unit + ' in ' + esc(fmtTime(p.pace * (parseFloat(distText(F.dist)) || 0) / c.per)), p.base) + (p.hasPr ? row('Pace bonus, ' + fmtPace(p.pace) + ' per ' + c.perLabel, '+' + p.perf) : row('No PR saved, so no pace bonus yet', '+0'))
      : p.rows.map(function (r) { return row(r.name + ' ' + r.sets + ' x ' + r.reps + ' at ' + r.pct + '% of PR', r.pts); }).join('')) +
    p.prs.map(function (x) { return row('New PR: ' + esc(x.toLowerCase()), '+' + SC.prPoints, 'prev-pr'); }).join('') +
    (p.streak ? row('Streak, day ' + p.streakDay, '+' + p.streak) : '') + row('Total', '+' + p.total, 'prev-total') +
    (many ? p.groups.slice(1).map(function (g) { return row('Also in ' + esc(g.name) + ', at its rates', '+' + g.total); }).join('') : '');
}
var prevT;
function preview() {
  clearTimeout(prevT);
  prevT = setTimeout(function () {
    if (!F || F.kind !== 'log' || !F.cat) return;
    var mine = F;
    api('POST', '/workouts/preview', logPayload()).then(function (p) {
      if (F !== mine) return;
      F.prevHTML = prevHTML(p); var el = $('lgPrev'); if (el) el.innerHTML = F.prevHTML;
    }).catch(function () { if (F === mine) { F.prevHTML = ''; var el = $('lgPrev'); if (el) el.innerHTML = ''; } });
  }, 280);
}
function openLog() {
  F = { kind: 'log', cat: '', date: today(), note: '' };
  openModal(logBody(), '', 'Log a workout');
  var first = modal.querySelector('.pick button'); if (first) first.focus();   // not the note box, so a phone keyboard does not open
}
function submitLog() {
  if (!F.cat) { F.err = 'Pick the workout you finished.'; modal.innerHTML = logBody(); return; }
  F.busy = true; F.err = '';
  api('POST', '/workouts', logPayload()).then(function (p) {
    closeModal();
    toast((p.prs.length ? 'New PR. ' : 'Logged. ') + (p.groups.length > 1
      ? p.groups.map(function (g) { return '+' + g.total + ' in ' + g.name; }).join(', ') + '.'
      : '+' + p.total + ' points.'));
    return loadMe().then(refresh);
  }).catch(function (e) { if (F) { F.busy = false; F.err = e.message; modal.innerHTML = logBody(); } });
}

/* ---------- events ---------- */
function joinGroup(code) {
  return api('POST', '/groups/join', { code: code }).then(function (d) {
    S.joinCode = ''; S.gid = d.id; S.view = 'board'; S.inv = null; S.feed = null; S.power = null;
    try { localStorage.setItem('ow_group', d.id); } catch (e) {}
    S.justJoined = d.group; toast('You are in ' + d.group + '.');
    return loadMe().then(refresh).then(connect);
  });
}
function setView(v) { if (v !== 'profile') S.flash = null; S.view = v; S.feed = null; S.power = S.view === 'power' ? S.power : null; render(); window.scrollTo(0, 0); loadView().then(render).catch(fail); }

document.addEventListener('click', function (e) {
  if (e.target === modalWrap) { closeModal(); return; }
  var el = e.target.closest('[data-act]'); if (!el) return;
  var act = el.getAttribute('data-act'), v = el.getAttribute('data-v'), id = el.getAttribute('data-id'), i = +el.getAttribute('data-i');
  var invList = F && F.kind === 'create' ? F.inv : S.inv;
  if (act !== 'menu') closeMenu();
  switch (act) {
    case 'menu': openMenu(); break;
    case 'menuClose': break;
    case 'goPrs': goPrs(); break;
    case 'view': setView(v); break;
    case 'close': closeModal(); break;
    case 'notes': showNotes(); break;
    case 'create': openCreate(); break;
    case 'openGroup':
      S.gid = id; S.inv = null; S.feed = null; S.power = null; S.view = 'board';
      try { localStorage.setItem('ow_group', id); } catch (err) {}
      refresh().then(connect).then(showUpdates).catch(fail); window.scrollTo(0, 0);
      break;
    case 'log': if (liveGroups().length) openLog(); break;
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
    case 'resend': case 'resendAll':
      el.disabled = true;
      api('POST', '/groups/' + S.gid + '/invites/resend', act === 'resend' ? { id: id } : {}).then(function (d) {
        toast(d.sent === 1 ? 'Invite sent again.' : d.sent + ' invites sent again.'); return refresh();
      }).catch(function (e2) { el.disabled = false; fail(e2); });
      break;
    case 'shut':
      confirmBox('Shut down ' + esc(S.g.name) + '?', 'The challenge ends now for everyone. The leaderboard freezes as it is, whoever is in first wins, and nothing more can be logged. This cannot be undone.', 'Shut down challenge', 'shutYes');
      break;
    case 'shutYes':
      el.disabled = true;
      api('POST', '/groups/' + S.gid + '/close', {}).then(function (d) {
        closeModal(); S.view = 'board'; toast('Challenge shut down.' + (d.winner ? ' ' + d.winner + ' wins.' : ''));
        window.scrollTo(0, 0);
        return loadMe().then(refresh);
      }).catch(function (e2) { el.disabled = false; var x = $('cfErr'); if (x) x.textContent = e2.message; });
      break;
    case 'delWorkout': api('DELETE', '/workouts/' + id, {}).then(function () { toast('Workout removed.'); return refresh(); }).catch(fail); break;
    case 'leave':
      if (over()) confirmBox('Remove ' + esc(S.g.name) + ' from your list?', 'It comes off your past challenges. The final results stay as they are for everyone else.', 'Remove it', 'leaveYes');
      else if (S.g.role === 'admin') confirmBox('Delete ' + esc(S.g.name) + '?', 'This removes the group and its leaderboard for good.', 'Delete group', 'leaveYes');
      else confirmBox('Leave ' + esc(S.g.name) + '?', 'You come off the leaderboard and the rankings adjust. Your workouts in this group stop counting.', 'Leave group', 'leaveYes');
      break;
    case 'leaveYes':
      S.g0admin = S.g.role === 'admin'; S.g0over = over();
      api('POST', '/groups/' + S.gid + '/leave', {}).then(function () {
        closeModal(); S.gid = null; S.g = null; S.view = 'board'; toast(S.g0over ? 'Removed from your list.' : S.g0admin ? 'Group deleted.' : 'You left the group.');
        try { localStorage.removeItem('ow_group'); } catch (err) {}
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
  if (lg && F) {
    if (lg === 'th' || lg === 'tm' || lg === 'ts') { var d = t.value.replace(/[^0-9]/g, ''); if (d !== t.value) t.value = d; }   // digits only
    F[lg] = t.value; if (lg !== 'note') preview();
  }
  var prk = t.getAttribute('data-pr');
  if (prk && /\|t[hms]$/.test(prk)) { var d2 = t.value.replace(/[^0-9]/g, ''); if (d2 !== t.value) t.value = d2; }
});
document.addEventListener('submit', function (e) {
  var id = e.target.id, err;
  if (!id) return;   // forms without an id post straight to the server
  e.preventDefault();
  if (id === 'joinForm') {
    joinGroup($('joinCode').value).then(function () { window.scrollTo(0, 0); }).catch(fail);
  } else if (id === 'invForm') {
    err = $('invErr'); err.textContent = '';
    api('POST', '/groups/' + S.gid + '/invites', { invites: S.inv }).then(function (d) {
      S.inv = null; toast(d.sent ? plural(d.sent, 'invite') + ' sent.' : 'Already invited. Use Resend to send it again.'); return refresh();
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
    Object.keys(prs).forEach(function (k) { if (SC.cats[k].type === 'dist') { prs[k].time = timeText(prs[k]); prs[k].dist = distText(prs[k].dist); } });
    api('PUT', '/me/prs', { prs: prs }).then(function (d) { ME.prs = d.prs; ME.firstVisit = false; toast('PRs saved.'); }).catch(function (e2) { err.textContent = e2.message; });
  }
});
document.addEventListener('keydown', function (e) {
  if (e.key !== 'Escape') return;
  if (modalWrap.classList.contains('open')) closeModal(); else closeMenu();
});

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
  // An invite link joins the group straight away. If the code no longer works, it is left in the box with the reason shown.
  if (!S.joinCode) return refresh();
  return joinGroup(S.joinCode).catch(function (e) {
    if (e.status === 409) S.joinCode = ''; else if (ME.groups.length) S.view = 'groups';
    return refresh().then(function () { if (e.status !== 409) fail(e); });
  });
}).then(function () {
  connect();
  if (ME.firstVisit) showFirstVisit();
  else if (S.view !== 'profile') showUpdates();
}).catch(function (e) {
  dash.innerHTML = '<div class="wrap-w spin">' + esc(e.message || 'Could not load your dashboard.') + '</div>';
});
// Safety net if the live connection drops: refresh the board every minute while the tab is visible.
setInterval(function () {
  if (document.hidden || !S.g || S.view === 'profile' || modalWrap.classList.contains('open')) return;
  var typing = document.activeElement && /INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName);
  if (!typing) refresh().catch(function () {});
}, 60000);
})();
