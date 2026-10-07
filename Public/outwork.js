(function () {
'use strict';

/* ==========================================================================
   ==========================================================================

   HERO BACKGROUND VIDEO  >>>  PUT YOUR VIDEO HERE  <<<

   Set HERO_VIDEO to the path or URL of your video file, for example:

       var HERO_VIDEO = 'hero.mp4';                      (file next to this page)
       var HERO_VIDEO = 'https://yoursite.com/hero.mp4'; (hosted file)

   HERO_POSTER is optional: a still image shown while the video loads.
   Leave HERO_VIDEO empty ('') to show the animated orange backdrop instead.

   The video plays muted, looped, behind the hero text and the demo card,
   with an orange wash on top. To change how strong the wash is, search this
   file for:  HERO VIDEO WASH

   ==========================================================================
   ========================================================================== */
var HERO_VIDEO = '';
var HERO_POSTER = '';

/* ---------- helpers ---------- */
var esc = function (s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
};
var pad = function (n) { return (n < 10 ? '0' : '') + n; };
var toStr = function (d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); };
var toDate = function (s) { var p = s.split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); };
var today = function () { return toStr(new Date()); };
var addDays = function (s, n) { var d = toDate(s); d.setDate(d.getDate() + n); return toStr(d); };
var diffDays = function (a, b) {
  var x = a.split('-'), y = b.split('-');
  return Math.round((Date.UTC(+x[0], +x[1] - 1, +x[2]) - Date.UTC(+y[0], +y[1] - 1, +y[2])) / 86400000);
};
var fmt = function (s) { return toDate(s).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }); };
var fmtLong = function (s) { return toDate(s).toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' }); };
var rid = function () { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); };
var makeCode = function () {
  var a = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789', c = '';
  for (var i = 0; i < 6; i++) c += a[Math.floor(Math.random() * a.length)];
  return c;
};
var ordinal = function (n) {
  var s = ['th', 'st', 'nd', 'rd'], v = n % 100;
  return s[(v - 20) % 10] || s[v] || s[0];
};
var initials = function (name) {
  var p = String(name || '?').trim().split(/\s+/);
  return ((p[0] || '?')[0] + (p.length > 1 ? p[p.length - 1][0] : '')).toUpperCase();
};
var plural = function (n, w) { return n + ' ' + w + (n === 1 ? '' : 's'); };

var ICON = {
  back: '<svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg>',
  plus: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
  x: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  menu: '<svg viewBox="0 0 24 24"><path d="M4 7h16M4 12h16M4 17h16"/></svg>',
  mark: '<svg viewBox="0 0 24 24"><path d="M4 20l6-16 4 9 2-4 4 11z"/></svg>'
};
var BRAND = '<span class="brand"><i>' + ICON.mark + '</i>Outwork</span>';

var signedIn = function () { return !!(S.profile && S.profile.signedIn); };
var myName = function () { return S.profile.nick || S.profile.name || store.suggestedName || ''; };

/* ==========================================================================
   SCORING
   Three ways to score:
   1. The work.   Distance: miles (or yards, meters) x the category rate.
                  Strength: every rep, scaled by how heavy it is next to your PR.
   2. Pace bonus. Up to +50% for distance workouts, by how close you are to your PR pace.
                  Beat a PR (pace or lift) and you also get PR_POINTS.
   3. Streak.     Points for each day in a row.
   Players enter their PRs once. They are saved to the profile and update when beaten.
   ========================================================================== */
var CATS = {
  run:  { label: 'Run',          type: 'dist', unit: 'mi', units: 'miles',  per: 1,   perLabel: 'mile',       short: 'mi',     rate: 10, max: 200,    ph: '5.0',  prPh: '3.1' },
  walk: { label: 'Walk or hike', type: 'dist', unit: 'mi', units: 'miles',  per: 1,   perLabel: 'mile',       short: 'mi',     rate: 7,  max: 100,    ph: '3.0',  prPh: '1.0' },
  ride: { label: 'Ride',         type: 'dist', unit: 'mi', units: 'miles',  per: 1,   perLabel: 'mile',       short: 'mi',     rate: 4,  max: 400,    ph: '15',   prPh: '10' },
  swim: { label: 'Swim',         type: 'dist', unit: 'yd', units: 'yards',  per: 100, perLabel: '100 yards',  short: '100 yd', rate: 2,  max: 40000,  ph: '1500', prPh: '500' },
  row:  { label: 'Row',          type: 'dist', unit: 'm',  units: 'meters', per: 500, perLabel: '500 meters', short: '500 m',  rate: 2,  max: 100000, ph: '5000', prPh: '2000' },
  lift: { label: 'Strength',     type: 'lift', perLabel: 'rep at your PR weight', short: 'rep', rate: 1 }
};
var CAT_ORDER = ['run', 'walk', 'ride', 'swim', 'row', 'lift'];
var LIFTS = [['squat', 'Squat'], ['bench', 'Bench'], ['dead', 'Deadlift']];

var PACE_BONUS = 0.5;   // distance workouts: up to +50% at your PR pace
var PR_POINTS = 10;     // bonus for beating a PR
var STREAK_STEP = 2;    // streak bonus grows this much for each day in a row
var STREAK_CAP = 10;    // most streak points a single day can earn

var num = function (v) { var n = parseFloat(v); return isFinite(n) && n > 0 ? n : 0; };
var round1 = function (n) { return Math.round(n * 10) / 10; };
var fmtPace = function (p) { var m = Math.floor(p), sec = Math.round((p - m) * 60); if (sec === 60) { m++; sec = 0; } return m + ':' + pad(sec); };
/* Times are typed as 42:30 or 1:05:00. Internally they are minutes. */
var parseTime = function (v) {
  var t = String(v || '').trim();
  if (!t) return 0;
  var q = t.split(':').map(function (x) { return parseFloat(x); });
  if (q.some(function (x) { return !isFinite(x) || x < 0; })) return 0;
  if (q.length === 1) return q[0];
  if (q.length === 2) return q[0] + q[1] / 60;
  return q[0] * 60 + q[1] + q[2] / 60;
};
var fmtTime = function (mins) {
  var total = Math.round(mins * 60), h = Math.floor(total / 3600), m = Math.floor((total % 3600) / 60), sec = total % 60;
  return h ? h + ':' + pad(m) + ':' + pad(sec) : m + ':' + pad(sec);
};
var fmtAmt = function (n) { return (Math.round(n * 100) / 100).toLocaleString(); };
var rateText = function (a) { var c = CATS[a.cat]; return c ? fmtAmt(a.rate) + ' per ' + c.perLabel : (a.points || 0) + ' per workout'; };
var myRec = function (a) { return (S.profile.records || {})[a.cat] || {}; };
var streakPts = function (run) { return Math.min(STREAK_CAP, Math.max(0, run - 1) * STREAK_STEP); };

/* Scores one workout.
   Distance: m = { dist, mins }                 rec = { dist, mins, pace }   (the PR effort)
   Strength: m = { lifts: [{ k, sets, reps, w }] }   rec = { squat, bench, dead }   (PR weights)
   Returns base (the work), perf (pace bonus), prPts, prs, total, the updated rec, and rows for display. */
function scoreWorkout(g, act, m, rec) {
  var c = CATS[act.cat];
  if (!c) { var flat = act.points || 0; return { base: flat, perf: 0, prPts: 0, prs: [], total: flat, rec: null, rows: [] }; }
  rec = rec || {};
  var out = { base: 0, perf: 0, prs: [], rows: [], pace: 0, ratio: 0 };
  if (c.type === 'dist') {
    var amount = m.dist / c.per, pace = m.mins / amount;
    out.pace = pace;
    out.base = Math.round(act.rate * amount);
    out.ratio = rec.pace ? Math.min(1, rec.pace / pace) : 0;
    out.perf = Math.round(act.rate * amount * PACE_BONUS * out.ratio);
    out.rec = { dist: rec.dist || 0, mins: rec.mins || 0, pace: rec.pace || 0 };
    if (!rec.pace) out.rec = { dist: m.dist, mins: m.mins, pace: pace };   // no PR saved: this workout sets it
    else if (pace < rec.pace * 0.999 && m.dist >= (rec.dist || 0) * 0.999) {   // faster, over at least the PR distance
      out.prs.push('Pace'); out.rec = { dist: m.dist, mins: m.mins, pace: pace };
    }
  } else {
    out.rec = { squat: rec.squat || 0, bench: rec.bench || 0, dead: rec.dead || 0 };
    (m.lifts || []).forEach(function (l) {
      var pr = rec[l.k] || l.w, reps = l.sets * l.reps, ratio = Math.min(1, l.w / pr);
      var pts = Math.round(act.rate * reps * ratio);
      out.base += pts;
      out.rows.push({ k: l.k, sets: l.sets, reps: l.reps, w: l.w, pct: Math.round(ratio * 100), pts: pts });
      if (rec[l.k] && l.w > rec[l.k] * 1.001) out.prs.push(l.k === 'dead' ? 'Deadlift' : l.k.charAt(0).toUpperCase() + l.k.slice(1));
      out.rec[l.k] = Math.max(out.rec[l.k], l.w);
    });
  }
  out.prPts = out.prs.length * PR_POINTS;
  out.total = out.base + out.perf + out.prPts;
  return out;
}
var logTotal = function (l) { return (l.points || 0) + (l.perf || 0) + (l.prPts || 0); };
/* Streaks: days in a row with at least one workout. Day 2 earns STREAK_STEP, growing each day up to STREAK_CAP. */
function streakBonus(days, g) {
  if (!g.bonus) return 0;
  var run = 0, prev = null, total = 0;
  Object.keys(days).sort().forEach(function (d) {
    run = prev && diffDays(d, prev) === 1 ? run + 1 : 1;
    total += streakPts(run);
    prev = d;
  });
  return total;
}
function streakOn(days, date) { var n = 0, d = date; while (days[d]) { n++; d = addDays(d, -1); } return n; }
function currentStreak(days) { var t = today(); return days[t] ? streakOn(days, t) : streakOn(days, addDays(t, -1)); }
function myDays(g) {
  var days = {};
  S.logs.forEach(function (l) { if (l.uid === store.uid && l.date >= g.start && l.date <= g.end) days[l.date] = 1; });
  return days;
}
function liftName(k) { for (var i = 0; i < LIFTS.length; i++) if (LIFTS[i][0] === k) return LIFTS[i][1]; return k; }
function metricsText(l) {
  var c = CATS[l.cat];
  if (c && c.type === 'dist' && l.dist && l.mins) return fmtAmt(l.dist) + ' ' + c.unit + ' in ' + fmtTime(l.mins) + ' (' + fmtPace(l.mins / (l.dist / c.per)) + ' per ' + c.perLabel + ')';
  if (l.lifts && l.lifts.length) return l.lifts.map(function (x) { return liftName(x.k) + ' ' + x.sets + ' x ' + x.reps + ' at ' + round1(x.w) + ' lb'; }).join(', ');
  return '';
}

/* ---------- storage: shared when signed in, this device otherwise ---------- */
function cloudStore(db, uid, name) {
  var profileRef = db.doc('data/users/' + uid + '/profile');
  return {
    mode: 'cloud', uid: uid, suggestedName: name,
    loadProfile: function () {
      return profileRef.get().then(function (s) { return s.exists ? s.data() : null; });
    },
    saveProfile: function (p) { return profileRef.set(p); },
    watchGroups: function (cb) {
      return db.collection('groups').onSnapshot(function (s) {
        cb(s.docs.map(function (d) { return Object.assign({ id: d.id }, d.data()); }));
      }, function () { cb(null); });
    },
    watchGroup: function (gid, cb) {
      var u1 = db.collection('groups/' + gid + '/members').onSnapshot(function (s) {
        cb({ members: s.docs.map(function (d) { return d.data(); }) });
      }, function () {});
      var u2 = db.collection('groups/' + gid + '/logs').onSnapshot(function (s) {
        cb({ logs: s.docs.map(function (d) { return Object.assign({ id: d.id }, d.data()); }) });
      }, function () {});
      return function () { u1(); u2(); };
    },
    createGroup: function (g) {
      var ref = db.collection('groups').doc();
      return ref.set(g).then(function () { return ref.id; });
    },
    setMember: function (gid, m) { return db.doc('groups/' + gid + '/members/' + uid).set(m); },
    removeMember: function (gid) { return db.doc('groups/' + gid + '/members/' + uid).delete(); },
    addLog: function (gid, log) { return db.collection('groups/' + gid + '/logs').add(log); },
    deleteLog: function (gid, id) { return db.doc('groups/' + gid + '/logs/' + id).delete(); }
  };
}

function localStore() {
  var KEY = 'outwork:v1';
  var data = { profile: null, groups: {}, members: {}, logs: {} };
  try { var raw = localStorage.getItem(KEY); if (raw) data = JSON.parse(raw); } catch (e) {}
  var gCb = null, grpCb = null, grpId = null;
  var save = function () { try { localStorage.setItem(KEY, JSON.stringify(data)); } catch (e) {} };
  var emitGroups = function () {
    if (gCb) gCb(Object.keys(data.groups).map(function (id) { return Object.assign({ id: id }, data.groups[id]); }));
  };
  var emitGroup = function () {
    if (!grpCb) return;
    var m = data.members[grpId] || {}, l = data.logs[grpId] || {};
    grpCb({
      members: Object.keys(m).map(function (k) { return m[k]; }),
      logs: Object.keys(l).map(function (k) { return Object.assign({ id: k }, l[k]); })
    });
  };
  var ok = function (v) { return Promise.resolve(v); };
  return {
    mode: 'local', uid: 'me', suggestedName: '',
    loadProfile: function () { return ok(data.profile); },
    saveProfile: function (p) { data.profile = p; save(); return ok(); },
    watchGroups: function (cb) { gCb = cb; emitGroups(); return function () { gCb = null; }; },
    watchGroup: function (gid, cb) { grpId = gid; grpCb = cb; emitGroup(); return function () { grpCb = null; }; },
    createGroup: function (g) { var id = rid(); data.groups[id] = g; save(); emitGroups(); return ok(id); },
    setMember: function (gid, m) { (data.members[gid] = data.members[gid] || {}).me = m; save(); emitGroup(); return ok(); },
    removeMember: function (gid) { if (data.members[gid]) delete data.members[gid].me; save(); emitGroup(); return ok(); },
    addLog: function (gid, log) { (data.logs[gid] = data.logs[gid] || {})[rid()] = log; save(); emitGroup(); return ok(); },
    deleteLog: function (gid, id) { if (data.logs[gid]) delete data.logs[gid][id]; save(); emitGroup(); return ok(); }
  };
}

function initStore() {
  if (!window.claude || typeof window.claude.use !== 'function') return Promise.resolve(localStore());
  return Promise.all([window.claude.use('db'), window.claude.use('user')]).then(function (r) {
    var db = r[0], user = r[1];
    if (!db || !user) return localStore();
    return user.me().then(function (me) {
      return me && me.id ? cloudStore(db, me.id, me.name || '') : localStore();
    });
  }).catch(function () { return localStore(); });
}

/* ---------- state ---------- */
var store = null;
var S = {
  view: 'loading', tab: 'standings',
  profile: { nick: '', groups: [], records: {} },
  groups: [], gid: null, members: [], logs: [], confirmLeave: false, err: ''
};
var F = null;      // create form
var J = null;      // join form
var A = null;      // log in and sign up form
var afterAuth = null;
var L = null;      // log sheet
var R = null;      // personal records form
var unsubGroup = null;

var app = document.getElementById('app');
var sheetWrap = document.getElementById('sheetWrap');
var sheet = document.getElementById('sheet');
var toastEl = document.getElementById('toast');
var toastT = null;

function toast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  clearTimeout(toastT);
  toastT = setTimeout(function () { toastEl.classList.remove('show'); }, 2600);
}
function fail(e) {
  var code = e && e.code;
  if (code === 'invalid_argument' || code === 'not_granted') toast('You can view this page but not change it. Ask the owner for Contributor access.');
  else if (code === 'quota_exceeded') toast('Storage is full. Remove old challenges to make room.');
  else toast('That did not save. Check your connection and try again.');
}

var cur = function () { return S.groups.filter(function (g) { return g.id === S.gid; })[0] || null; };
var myGroups = function () {
  var ids = S.profile.groups || [];
  return S.groups.filter(function (g) { return ids.indexOf(g.id) >= 0; })
    .sort(function (a, b) { return (b.createdAt || 0) - (a.createdAt || 0); });
};
function status(g) {
  var t = today();
  if (t > g.end) return { over: true, label: 'Ended ' + fmt(g.end) };
  var left = diffDays(g.end, t);
  return { over: false, left: left, label: left === 0 ? 'Last day' : plural(left + 1, 'day') + ' left' };
}
function standings(g) {
  var by = {};
  S.members.forEach(function (m) {
    by[m.uid] = { uid: m.uid, nick: m.nick, pts: 0, count: 0, last: 0, joined: m.joinedAt || 0, days: {}, streak: 0, streakPts: 0 };
  });
  S.logs.forEach(function (l) {
    var r = by[l.uid];
    if (!r || l.date < g.start || l.date > g.end) return;
    r.pts += logTotal(l); r.count++; r.last = Math.max(r.last, l.at || 0); r.days[l.date] = 1;
  });
  return Object.keys(by).map(function (k) {
    var r = by[k];
    r.streakPts = streakBonus(r.days, g); r.pts += r.streakPts; r.streak = g.bonus ? currentStreak(r.days) : 0;
    return r;
  }).sort(function (a, b) {
    return b.pts - a.pts || (a.pts ? a.last - b.last : a.joined - b.joined);
  });
}

/* ---------- views ---------- */
var TRACK = '<div class="ptsec-bg" aria-hidden="true"><svg viewBox="0 0 1600 1400" preserveAspectRatio="xMidYMid slice"><g transform="translate(1180 520) rotate(-18)"><rect class="field" x="-310" y="-125" width="620" height="250" rx="125"/><rect class="lane" x="-310" y="-125" width="620" height="250" rx="125"/><rect class="lane" x="-425" y="-240" width="850" height="480" rx="240"/><rect class="lane lane--k" x="-540" y="-355" width="1080" height="710" rx="355"/><rect class="lane" x="-655" y="-470" width="1310" height="940" rx="470"/><rect class="lane" x="-770" y="-585" width="1540" height="1170" rx="585"/><rect class="lane lane--k" x="-885" y="-700" width="1770" height="1400" rx="700"/><rect class="lane" x="-1000" y="-815" width="2000" height="1630" rx="815"/><rect class="lane" x="-1115" y="-930" width="2230" height="1860" rx="930"/><rect class="runner " pathLength="1000" x="-425" y="-240" width="850" height="480" rx="240"/><rect class="runner runner--k" pathLength="1000" x="-770" y="-585" width="1540" height="1170" rx="585"/><rect class="runner " pathLength="1000" x="-1000" y="-815" width="2000" height="1630" rx="815"/></g></svg></div>';

function chCards() {
  var list = signedIn() ? myGroups() : [];
  if (!list.length) return '';
  return '<section class="mine"><div class="wrap-w"><h2 class="section-title">Your challenges</h2><div class="ch-list">' + list.map(function (g) {
    var st = status(g);
    return '<button class="ch-card" data-act="open" data-id="' + esc(g.id) + '"><div><b>' + esc(g.name) + '</b>' +
      '<span>' + fmt(g.start) + ' to ' + fmt(g.end) + '</span></div>' +
      '<em class="' + (st.over ? 'done' : '') + '">' + esc(st.over ? 'Ended' : st.label) + '</em></button>';
  }).join('') + '</div></div></section>';
}
function mRow(n, name, pts, w) {
  return '<div class="m-row"><em>' + n + '</em><div>' + name + '<div class="m-bar"><i style="width:' + w + '%"></i></div></div><b>' + pts + '</b></div>';
}
function acc(items) {
  return '<div class="show-acc" data-accordion>' + items.map(function (it, i) {
    return '<div class="acc-item' + (i === 0 ? ' open' : '') + '"><button type="button" class="acc-btn" data-act="acc" aria-expanded="' + (i === 0) + '">' + it[0] + '</button>' +
      '<div class="acc-panel"><div class="acc-panel-in">' + it[1] + '</div></div></div>';
  }).join('') + '</div>';
}
function viewHome(page) {
  page = page || 'home';
  var right = signedIn()
    ? '<span class="av av--sm" title="' + esc(S.profile.name) + '">' + esc(initials(S.profile.name)) + '</span><button class="nav-link" data-act="logout">Log out</button>'
    : '<button class="nav-link" data-act="login">Log in</button><button class="btn btn--orange btn--sm" data-act="signup">Sign up</button>';
  var nl = function (v, label) { return '<button data-act="page" data-v="' + v + '"' + (page === v ? ' class="on" aria-current="page"' : '') + '>' + label + '</button>'; };
  var nav = '<nav class="nav"><div class="wrap-w nav-in"><button data-act="page" data-v="home" aria-label="Outwork home">' + BRAND + '</button>' +
    '<div class="nav-links">' + nl('how', 'How it works') + nl('scoring', 'Scoring') + nl('compete', 'Compete') + nl('rules', 'The rules') + '</div>' +
    '<div class="nav-right">' + right + '<button class="menu-btn" id="menuBtn" data-act="menu" aria-label="Open menu" aria-expanded="false">' + ICON.menu + '</button></div></div></nav>' +
    '<div class="menu-veil" data-act="menuClose"></div>' +
    '<aside class="menu" id="menu" role="dialog" aria-modal="true" aria-label="Menu">' +
    '<div class="menu-top">' + BRAND + '<button class="icon-btn" id="menuX" data-act="menuClose" aria-label="Close menu">' + ICON.x + '</button></div>' +
    '<div class="menu-links">' + [['home', 'Home'], ['how', 'How it works'], ['scoring', 'Scoring'], ['compete', 'Compete'], ['rules', 'The rules']].map(function (l) {
      return '<button data-act="page" data-v="' + l[0] + '"' + (page === l[0] ? ' class="on" aria-current="page"' : '') + '>' + l[1] + ICON.back + '</button>';
    }).join('') + '</div>' +
    '<div class="menu-actions"><button class="btn btn--black btn--block" data-act="new">Start a challenge</button>' +
    '<button class="btn btn--ghost btn--block" data-act="join">Join with a code</button></div>' +
    '<div class="menu-acct">' + (signedIn()
      ? '<p>Signed in as ' + esc(S.profile.name || 'you') + '</p><button class="btn btn--ghost btn--block" data-act="logout">Log out</button>'
      : '<button class="btn btn--orange btn--block" data-act="signup">Sign up</button><button class="btn btn--ghost btn--block" data-act="login">Log in</button>') +
    '</div></aside>';

  var reel = '<div class="hero-media" id="heroMedia" aria-hidden="true"><div class="tilt" id="tilt"><div class="ghost"></div><div class="stage">' +
    '<div class="hscene is-on" data-s="0">' +
      '<div class="hp"><div class="m-title">Log a workout</div><div class="m-sub">October grind, day 11 of 14</div></div>' +
      '<div class="m-chips hp" style="--hd:.15s"><div class="m-chip sel">Run<i>10/mi</i></div><div class="m-chip">Walk<i>7/mi</i></div>' +
      '<div class="m-chip">Ride<i>4/mi</i></div><div class="m-chip">Swim<i>2/100 yd</i></div>' +
      '<div class="m-chip">Row<i>2/500 m</i></div><div class="m-chip">Strength<i>1/rep</i></div></div>' +
      '<div class="m-btn hp">Log workout</div><div class="tap"></div></div>' +
    '<div class="hscene" data-s="1">' +
      '<div class="hp"><div class="m-title">October grind</div><div class="m-sub">3 days left</div></div>' +
      '<div class="hp" style="--hd:.15s">' + raceHTML(['Maya', 'Jordan', 'Chris', 'Sam']) + '</div></div>' +
    '<div class="hscene hscene--over" data-s="2">' + confetti(18, ['#000', '#fff', '#FFD2A8']) +
      '<div class="m-win hp"><span>October grind is over.</span>Maya wins.</div>' +
      '<div class="m-big hp" style="--hd:.2s"><b data-count="112">112</b><small>points from 13 workouts</small></div>' +
      '<div class="m-podium hp" style="--hd:.4s"><div class="m-row"><em>2</em><div>Jordan</div><b>108</b></div><div class="m-row"><em>3</em><div>Chris</div><b>79</b></div></div></div>' +
    '<div class="reel"><i class="is-on" data-s="0"></i><i data-s="1"></i><i data-s="2"></i></div></div>' +
    '<div class="fp is-on" data-s="0" style="top:-3cqw;right:-2cqw;--hd:2.6s">+77 points</div>' +
    '<div class="fp fp--white is-on" data-s="0" style="bottom:20cqw;left:-5cqw;--hd:3s">New record</div>' +
    '<div class="fp fp--live" data-s="1" style="top:-3cqw;right:-2cqw;--hd:.6s">Live standings</div>' +
    '<div class="fp fp--white" data-s="2" style="bottom:12cqw;left:-4cqw;--hd:.9s">One winner</div>' +
    '</div></div>';

  var bg = HERO_VIDEO
    ? '<div class="hero-bg" id="heroBg"><video class="is-on" muted playsinline preload="auto" src="' + esc(HERO_VIDEO) + '"' + (HERO_POSTER ? ' poster="' + esc(HERO_POSTER) + '"' : '') + '></video>' +
      '<video muted playsinline preload="auto" src="' + esc(HERO_VIDEO) + '"></video></div>'
    : '<div class="hero-bg no-video" aria-hidden="true"><i></i><i></i></div>';
  var hero = '<header class="band--orange lp-hero">' + bg + '<div class="wrap-w lp-hero-in"><div>' +
    '<h1 class="h-xl"><span class="h-dim">Every workout scores.</span> One person wins.</h1>' +
    '<p class="hero-accent">Group workout challenges with a real finish line.</p>' +
    '<p class="lede">Start a group and log what you finish. Every mile and every rep scores, with a bonus for pace against your own PR and for streaks. When time runs out, the top score takes it.</p>' +
    '<div class="home-cta"><button class="btn btn--black" data-act="new">Start a challenge</button>' +
    '<button class="btn btn--white" data-act="join">Join with a code</button></div>' +
    '</div>' + reel + '</div></header>';

  var feat = function (art, title, text, sticker, pos, extra) {
    return '<div class="feat"><div class="feat-art" aria-hidden="true">' + (extra || '') +
      (sticker ? '<span class="sticker' + (sticker === 'Live' ? ' sticker--live' : '') + '" style="' + pos + '">' + sticker + '</span>' : '') +
      '<div class="mini">' + art + '</div></div><h3>' + title + '</h3><p>' + text + '</p></div>';
  };
  var check = '<svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
  var pt = function (n, v, d) { return '<div class="mini-pt"><span>' + n + '</span><div><i style="--w:' + (v * 10) + '%;--d:' + d + 's"></i></div><b>' + v + '</b></div>'; };

  var setup = '<section class="part" id="setup"><div class="wrap-w"><div class="sec-head">' +
    '<h2 class="h-lg">Your group, your rules, and a challenge everyone will finish.</h2>' +
    '<button class="text-link" data-act="new">Start a challenge</button></div><div class="feat-grid">' +
    feat('<div class="mini-t">How long it runs</div><div class="mini-seg" data-cycle><span class="on">1 week</span><span>2 weeks</span><span>30 days</span></div><div class="mini-bar"><i></i></div><div class="mini-t" style="margin:0">Ends at midnight on the last day</div>',
      'Pick the length', 'Run it for a week, two weeks, 30 days, or choose your own end date.', 'Starts today', 'top:18px;right:18px') +
    feat('<div class="mini-kv"><span>Run</span><b>10 per mile</b></div><div class="mini-kv"><span>Walk</span><b>7 per mile</b></div><div class="mini-kv"><span>Swim</span><b>2 per 100 yd</b></div><div class="mini-kv"><span>Strength</span><b>1 per rep</b></div>',
      'Choose what counts', 'Every category has its own rate. Keep the defaults or set your own. Rates lock once the challenge starts.', 'You set the rates', 'bottom:18px;left:18px') +
    feat('<div class="mini-code"><div><small>Challenge code</small><b data-scramble="K7M2QX">K7M2QX</b></div><span>Copy code</span></div>',
      'Invite with a code', 'Send the six character code to your group and they are in.', '6 characters', 'top:22px;left:22px') +
    '</div></div></section>';

  var kinds = [['Run', 10, 'tile--black', 'per mile'], ['Row', 2, 'tile--sm tile--white', 'per 500 m'], ['Strength', 1, '', 'per rep'], ['Swim', 2, 'tile--lg tile--white', 'per 100 yards'],
    ['Ride', 4, 'tile--black tile--sm', 'per mile'], ['Walk', 7, '', 'per mile']];
  var workouts = '<section class="part" id="workouts"><div class="wrap-w"><div class="kinds-head">' +
    '<h2 class="h-lg">Every kind of workout counts.</h2>' +
    '<p class="lede">Each category scores in its own unit. Running by the mile, swimming by the 100 yards, lifting by the rep.</p>' +
    '<button class="text-link" data-act="page" data-v="scoring">See every rate</button></div>' +
    '<div class="tiles" aria-hidden="true">' + kinds.map(function (k) {
      return '<div class="tile ' + k[2] + '"><b>' + k[0] + '</b><span>' + k[1] + '<small>' + k[3] + '</small></span></div>';
    }).join('') + '</div></div></section>';

  var qk = function (v, t, d) { return '<div class="quick"><b>' + v + '</b><h3>' + t + '</h3><p>' + d + '</p></div>'; };
  var pointsBrief = '<section class="part part--orange ptsec" id="points">' + TRACK + '<div class="wrap-w">' +
    '<h2 class="h-xl"><span class="h-dim">Three ways to score.</span> One way to win.</h2>' +
    '<div class="quick-grid quick-grid--3">' +
    qk('Rate', 'Do the work', 'Every mile and every rep scores.') +
    qk('+' + Math.round(PACE_BONUS * 100) + '%', 'Push your pace', 'A bonus for how close you are to your own PR.') +
    qk('+' + STREAK_CAP, 'Keep your streak', 'Up to ' + STREAK_CAP + ' a day for days in a row.') +
    '</div><div class="quick-end"><p>Most points when time runs out wins.</p>' +
    '<button class="btn btn--black" data-act="page" data-v="scoring">See how scoring works</button></div>' +
    '</div></section>';

  /* ======================= PAGES ======================= */
  var heroBtns = '<button class="btn btn--black" data-act="new">Start a challenge</button><button class="btn btn--white" data-act="join">Join with a code</button>';
  var phero = function (title, lede, art, btns) {
    return '<header class="band--orange phero ptsec">' + TRACK + '<div class="wrap-w phero-in"><div class="phero-text"><h1 class="h-xxl">' + title + '</h1>' +
      '<p class="lede">' + lede + '</p><div class="home-cta">' + (btns || heroBtns) + '</div></div><div class="phero-art">' + art + '</div></div></header>';
  };
  var prow = function (a, b, cls) { return '<div class="prev-row' + (cls ? ' ' + cls : '') + '"><span>' + a + '</span><b>' + b + '</b></div>'; };
  var pct = Math.round(PACE_BONUS * 100);

  /* ---------- How it works ---------- */
  var howPage = '';
  if (page === 'how') {
    var howArt = '<div class="bigcard" aria-hidden="true"><div class="mini-t">New challenge</div><div class="bc-name">October grind</div>' +
      '<div class="mini-seg" data-cycle><span class="on">1 week</span><span>2 weeks</span><span>30 days</span></div>' +
      '<div class="bc-rows"><div class="mini-kv"><span>Run</span><b>10 per mile</b></div><div class="mini-kv"><span>Walk or hike</span><b>7 per mile</b></div><div class="mini-kv"><span>Strength</span><b>1 per rep</b></div></div>' +
      '<div class="mini-code"><div><small>Challenge code</small><b data-scramble="K7M2QX">K7M2QX</b></div><span>Copy code</span></div></div>';
    var tl = function (when, title, text, art) {
      return '<li><div class="tl-when">' + when + '</div><div class="tl-body"><h3>' + title + '</h3><p>' + text + '</p></div><div class="tl-art" aria-hidden="true"><div class="mini">' + art + '</div></div></li>';
    };
    howPage = phero('<span class="h-dim">Set it up tonight.</span> Compete tomorrow.',
      'A challenge takes about a minute to create. Here is everything that happens between the first invite and the final day.', howArt) +
      '<section class="part"><div class="wrap-w"><h2 class="h-lg sec-title">The life of a challenge</h2><ol class="tl">' +
      tl('Before day one', 'Set the terms', 'Name it, choose one week, two weeks or 30 days, and pick which workout categories count. Every category comes with a rate you can adjust. Once the challenge starts, the rates lock.',
        '<div class="mini-kv"><span>Run</span><b>10 per mile</b></div><div class="mini-kv"><span>Swim</span><b>2 per 100 yd</b></div><div class="mini-kv"><span>Strength</span><b>1 per rep</b></div>') +
      tl('Before day one', 'Bring your people', 'Each challenge has a six character code. Anyone with the code joins under the name they want on the leaderboard and enters their PRs once.',
        '<div class="mini-code"><div><small>Challenge code</small><b>K7M2QX</b></div><span>Copy code</span></div>') +
      tl('Every day', 'Log what you finish', 'Pick the category and enter your numbers: distance and time for a run, walk, ride, swim or row, and sets, reps and weight for strength. You see the points before you submit.',
        prow('5 mi at 10 per mile', '50') + prow('Pace bonus, 9:00 per mile', '+23') + prow('Streak, day 3', '+4') + prow('Total', '+77', 'prev-total')) +
      tl('All challenge long', 'Watch the board move', 'Standings update for everyone the moment a workout is logged. The feed shows each workout with its math, so nobody wonders where the points came from.',
        raceHTML(['Maya', 'Jordan', 'Chris'])) +
      tl('Final day, midnight', 'One winner', 'Logging closes and the top score wins. A tie goes to whoever reached that score first.',
        '<div class="mini-lead shine" style="margin:0"><div><small>Winner</small><strong>Maya</strong></div><b>412</b></div>') +
      '</ol></div></section>' +
      '<section class="part"><div class="wrap-w faq"><h2 class="h-lg sec-title">Before you start</h2>' + acc([
        ['Do I need a watch or a fitness tracker?', 'No. You enter your own distance and time, or your sets, reps and weight.'],
        ['What if someone in our group cannot run?', 'They walk, ride, swim, row or lift. Every category has its own rate, and the pace bonus is measured against each person\'s own PR. A walker near their best pace earns the same bonus as a runner near theirs.'],
        ['Do I enter my PRs every time?', 'No. Once. They are saved to your profile and update when you beat them.'],
        ['Can we change the rates after we start?', 'No. Rates and categories lock when the challenge begins so nobody can move the goalposts.'],
        ['What happens if I miss a day?', 'Your streak resets and starts again with your next workout. Points you already earned stay.'],
        ['How many workouts count per day?', 'Two by default. Whoever creates the challenge can set it to one, three or no limit.']
      ]) + '</div></section>';
  }

  /* ---------- Scoring ---------- */
  var scoringPage = '';
  if (page === 'scoring') {
    var ex = function (who, title, rows, total) {
      return '<div class="ex"><div class="ex-who">' + who + '</div><h3>' + title + '</h3>' + rows + '<div class="prev-row prev-total"><span>Total</span><b>' + total + '</b></div></div>';
    };
    scoringPage = phero('<span class="h-dim">Three ways to score.</span> That is it.',
      'Do the work. Push your pace. Keep your streak. The most points when time runs out wins.',
      '<div class="bigcard bigcard--sum" aria-hidden="true"><div class="mini-t">Thursday</div><div class="bc-name">Run, 5 miles</div>' +
      prow('5 miles at 10 per mile', '50') + prow('Pace bonus', '+23') + prow('Streak, day 3', '+4') + prow('This workout', '77', 'prev-total') + '</div>') +

      '<section class="part"><div class="wrap-w"><div class="trio">' +
      '<div><b>1</b><h3>Do the work</h3><p>Every mile and every rep scores.</p><div class="rate-list">' +
      CAT_ORDER.map(function (k) { var c = CATS[k]; return '<div class="kv"><span>' + c.label + '</span><span>' + (c.type === 'dist' ? c.rate + ' per ' + c.perLabel : c.rate + ' per rep') + '</span></div>'; }).join('') +
      '</div><p class="fine">Strength reps are scaled by weight. A rep at 80% of your PR is worth 0.8.</p></div>' +
      '<div><b>2</b><h3>Push your pace</h3><p>Distance workouts earn up to +' + pct + '% for pace, measured against your own PR.</p>' +
      '<div class="rate-list"><div class="kv"><span>At your PR pace</span><span>+' + pct + '%</span></div><div class="kv"><span>At 80% of that speed</span><span>+' + Math.round(pct * 0.8) + '%</span></div><div class="kv"><span>Beat a PR, pace or lift</span><span>+' + PR_POINTS + '</span></div></div></div>' +
      '<div><b>3</b><h3>Keep your streak</h3><p>+' + STREAK_STEP + ' for each day in a row, up to +' + STREAK_CAP + ' a day. Miss a day and it restarts.</p>' +
      '<div class="days days--static" aria-hidden="true">' + [0, 1, 2, 3, 4, 5, 5].map(function (n) { return '<i>' + (n ? '+' + streakPts(n + 1) : '') + '</i>'; }).join('') + '</div></div>' +
      '</div></div></section>' +

      '<section class="part"><div class="wrap-w split split--mid"><div><h2 class="h-lg">Enter your PRs once</h2>' +
      '<p class="body">For running, walking, riding, swimming and rowing, give one distance and your best time for it. For strength, your best squat, bench and deadlift. They are saved to your profile and update whenever you beat them.</p></div>' +
      '<div class="ex-grid ex-grid--2">' +
      ex('Distance example', 'Run, 5 miles in 45:00', prow('5 miles at 10 per mile', '50') + prow('Pace at 90% of PR', '+23') + prow('Streak, day 3', '+4'), 77) +
      ex('Strength example', 'Squat and bench', prow('Squat 5 x 5 at 80% of PR', '20') + prow('Bench 3 x 8 at 75% of PR', '18') + prow('Streak, day 2', '+2'), 40) +
      '</div></div></section>';
  }

  /* ---------- Compete ---------- */
  var competePage = '';
  if (page === 'compete') {
    var bx = function (i) { return 90 + i * 105; }, by = function (r) { return 48 + (r - 1) * 68; };
    var lines = [['Sam', '#C9C7C1', [4, 4, 3, 4, 4, 4, 4], 244, 4], ['Chris', '#8F8F8F', [3, 3, 4, 3, 3, 3, 3], 301, 4], ['Jordan', '#000', [1, 2, 2, 1, 2, 2, 2], 398, 5], ['Maya', '#FF6A00', [2, 1, 1, 2, 1, 1, 1], 412, 7]];
    var bump = '<svg viewBox="0 0 900 320" role="img" aria-label="Rank by day for four players across one week. Maya and Jordan trade the lead and Maya finishes first.">' +
      ['1st', '2nd', '3rd', '4th'].map(function (t, i) { return '<text x="14" y="' + (by(i + 1) + 5) + '" class="bp-axis">' + t + '</text>'; }).join('') +
      ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(function (t, i) { return '<text x="' + bx(i) + '" y="308" text-anchor="middle" class="bp-axis">' + t + '</text>'; }).join('') +
      lines.map(function (l, n) {
        var d = 'M' + bx(0) + ' ' + by(l[2][0]);
        for (var i = 1; i < 7; i++) d += ' C' + (bx(i - 1) + 52) + ' ' + by(l[2][i - 1]) + ' ' + (bx(i) - 52) + ' ' + by(l[2][i]) + ' ' + bx(i) + ' ' + by(l[2][i]);
        return '<path class="bp-line" pathLength="1" style="--d:' + (n * 0.25) + 's" d="' + d + '" stroke="' + l[1] + '" stroke-width="' + l[4] + '"/>' +
          l[2].map(function (r, i) { return '<circle cx="' + bx(i) + '" cy="' + by(r) + '" r="' + (l[4] + 2) + '" fill="#fff" stroke="' + l[1] + '" stroke-width="3"/>'; }).join('') +
          '<text x="' + (bx(6) + 22) + '" y="' + (by(l[2][6]) + 5) + '" class="bp-name">' + l[0] + ' <tspan class="bp-pts">' + l[3] + '</tspan></text>';
      }).join('') + '</svg>';
    var fi = function (ini, who, what, meta, brk, pr, pts) {
      return '<div class="feed-item"><div class="av">' + ini + '</div><div><div class="feed-line"><b>' + who + '</b> finished ' + what + '</div><div class="feed-meta">' + meta + '</div><div class="feed-break">' + brk + '</div>' +
        (pr ? '<div class="feed-pr">New PR: ' + pr + '</div>' : '') + '</div><div class="feed-pts">+' + pts + '</div></div>';
    };
    competePage = phero('<span class="h-dim">Know exactly</span> where you stand.',
      'The board updates the moment anyone logs a workout. So does the pressure.',
      '<div class="bigcard bigcard--board" aria-hidden="true"><span class="sticker sticker--live" style="top:-14px;right:20px">Live</span><div class="bc-name">October grind</div><div class="mini-t">3 days left</div>' + raceHTML(['Maya', 'Jordan', 'Chris', 'Sam']) + '</div>') +
      '<section class="part"><div class="wrap-w"><h2 class="h-lg sec-title">Seven days, four people, and a lead that kept changing</h2>' +
      '<div class="bump">' + bump + '</div><div class="notes">' +
      '<div class="note"><b>Tuesday</b><p>Maya logs a six mile run and takes first from Jordan.</p></div>' +
      '<div class="note"><b>Thursday</b><p>Jordan beats his swim PR and goes back on top.</p></div>' +
      '<div class="note"><b>Friday to Sunday</b><p>Maya has not missed a day. Her streak bonus settles it.</p></div>' +
      '</div></div></section>' +
      '<section class="part"><div class="wrap-w split split--mid"><div><h2 class="h-lg">Every workout shows its math</h2>' +
      '<p class="body">The feed lists each workout as it is logged, with the numbers behind it and how the points broke down. If somebody jumps 60 points overnight, you can see exactly why.</p></div>' +
      '<div class="feedcard" aria-hidden="true">' +
      fi('MA', 'Maya', 'Run', 'Today, 5 mi in 45:00 (9:00 per mile)', '50 for distance, +23 pace bonus', '', 73) +
      fi('JO', 'Jordan', 'Swim', 'Today, 1,800 yd in 36:00 (2:00 per 100 yards)', '36 for distance, +18 pace bonus, +10 new PR', 'pace', 64) +
      fi('SA', 'Sam', 'Strength', 'Today, Squat 5 x 5 at 240 lb, Bench 3 x 8 at 150 lb', '38 for reps', '', 38) +
      '</div></div></section>' +
      '<section class="part"><div class="wrap-w"><div class="sees">' +
      '<div><h3>Everyone in the challenge sees</h3><ul><li>The standings, with each total and how far it trails the leader</li><li>Every workout logged and its point breakdown</li><li>Current streaks</li><li>The rates and rules for the challenge</li></ul></div>' +
      '<div><h3>Only you see</h3><ul><li>Your PRs</li><li>Your points preview before you log a workout</li></ul></div>' +
      '</div></div></section>';
  }

  /* ---------- The rules ---------- */
  var rulesPage = '';
  if (page === 'rules') {
    var rn = 0;
    var rg = function (title, items) {
      return '<div class="rb-group"><h2>' + title + '</h2><ol>' + items.map(function (x) { rn++; return '<li><b>' + rn + '</b><span>' + x + '</span></li>'; }).join('') + '</ol></div>';
    };
    rulesPage = phero('<span class="h-dim">Ten rules.</span> No fine print.',
      'Short enough to read before your first workout.',
      '<div class="rule-one" aria-hidden="true"><b>1</b><span>winner. Every time.</span></div>') +
      '<section class="part"><div class="wrap-w rb">' +
      rg('Winning', ['The most points when the challenge ends wins.', 'A tie goes to whoever reached that score first.']) +
      rg('Logging', ['Log each workout yourself, with your real numbers.', 'You can log for today or yesterday. Nothing older.', 'Only your daily limit of workouts counts. The default is two a day.']) +
      rg('Scoring', ['Every category scores at its own rate, set when the challenge is created.', 'Rates and categories lock once the challenge starts.', 'Pace bonuses and strength points are measured against your own PRs.']) +
      rg('Fair play', ['Enter honest PRs. Setting them low on purpose is cheating your friends.', 'Removing a workout removes its points. A PR it set stays, so log carefully.']) +
      '</div></section>';
  }
  var up = page === 'signup';
  var authBody = (page === 'login' || page === 'signup') && A ? '<main class="auth-page"><div class="auth-side band--orange ptsec">' + TRACK +
    '<div><h1 class="h-xl">' + (up ? 'Join the challenge.' : 'Welcome back.') + '</h1>' +
    '<p class="lede">' + (up ? 'Create an account to start a challenge or join one with a code.' : 'Your challenges are waiting.') + '</p></div></div>' +
    '<div class="auth-main"><form class="auth" id="authForm" novalidate>' +
    '<h2 class="h-md">' + (up ? 'Sign up' : 'Log in') + '</h2>' +
    (up ? '<div class="field"><label for="a-name">Name</label><input class="input" id="a-name" data-a="name" maxlength="40" autocomplete="name" value="' + esc(A.name) + '"></div>' : '') +
    '<div class="field"><label for="a-email">Email</label><input class="input" id="a-email" data-a="email" type="email" inputmode="email" autocomplete="email" maxlength="120" value="' + esc(A.email) + '"></div>' +
    '<div class="field"><label for="a-pass">Password</label><input class="input" id="a-pass" data-a="pass" type="password" maxlength="100" autocomplete="' + (up ? 'new-password' : 'current-password') + '" value="' + esc(A.pass) + '">' +
    (up ? '<p class="hint">Use 8 characters or more.</p>' : '') + '</div>' +
    '<p class="err" id="formErr">' + esc(S.err) + '</p>' +
    '<button class="btn btn--orange btn--block" type="submit">' + (up ? 'Sign up' : 'Log in') + '</button>' +
    '<p class="auth-switch">' + (up ? 'Already have an account? <button type="button" data-act="login">Log in</button>' : 'New to Outwork? <button type="button" data-act="signup">Sign up</button>') + '</p>' +
    '<p class="auth-note">Preview build. Passwords are not checked or stored yet.</p>' +
    '</form></div></main>' : '';

  var competeFeats = feat('<div class="mini-chips mini-chips--plain" data-cycle><span class="on">Run</span><span>Swim</span><span>Strength</span><span>Walk</span></div>',
      'Log in seconds', 'Pick the category, enter your numbers, and see the points before you submit.', 'Two taps', 'top:20px;right:20px') +
    feat(raceHTML(['Maya', 'Jordan', 'Chris']),
      'Live standings', 'Everyone sees the same leaderboard and how far they trail the leader.', 'Live', 'top:16px;left:18px') +
    feat('<div class="mini-feed" style="--d:0s"><div class="av">MA</div><div><b>Maya</b> finished Run</div><b>+62</b></div><div class="mini-feed" style="--d:.45s"><div class="av">JO</div><div><b>Jordan</b> finished Swim</div><b>+41</b></div><div class="mini-feed" style="--d:.9s"><div class="av">SA</div><div><b>Sam</b> finished Walk</div><b>+55</b></div>',
      'See who is training', 'The feed shows every workout as it is logged, so you know who got up early.', '6:02 am', 'bottom:18px;right:20px');

  var compete = '<section class="part" id="compete"><div class="wrap-w"><div class="part-head">' +
    '<h2 class="h-xl">Log it. Watch the board move.</h2>' +
    '<button class="btn btn--orange" data-act="new">Start a challenge</button></div><div class="feat-grid">' +
    competeFeats +
    '</div></div></section>';

  var rules = '<section class="part" id="rules"><div class="wrap-w"><div class="part-head">' +
    '<h2 class="h-xl"><span class="h-dim">One challenge.</span> One winner.</h2>' +
    '<button class="btn btn--orange" data-act="join">Join with a code</button></div><div class="feat-grid">' +
    feat('<div class="mini-lead shine" style="margin:0"><div><small>Winner</small><strong>Maya</strong></div><b data-count="112" data-loop>112</b></div>',
      'A clear finish', 'When the last day ends, logging closes and the most points wins.', '', '', confetti(12, ['#FF6A00', '#000', '#FFB26B'])) +
    feat('<div class="mini-t">Today</div><div class="mini-dots"><i style="--d:0s">' + check + '</i><i style="--d:.5s">' + check + '</i><i class="off"></i><span>Third workout does not count</span></div>',
      'A daily limit keeps it fair', 'Two workouts count per person each day unless you change the limit.', '2 per day', 'top:20px;right:20px') +
    feat('<div class="mini-tie"><div><span>Maya<span class="mini-tag">Wins</span></span><b>98</b></div><div class="bar"><i></i></div></div><div class="mini-tie b"><div><span>Jordan</span><b>98</b></div><div class="bar"><i></i></div></div>',
      'Ties are settled', 'If two people finish level, whoever reached that score first takes it.', 'First to 98', 'bottom:18px;left:20px') +
    '</div></div></section>';

  var cta = '<section class="band--orange final"><div class="wrap-w final-in"><div>' +
    '<h2 class="h-xl">Ready to find out who wins?</h2>' +
    '<p>Set up a challenge in about a minute, send the code, and start logging today.</p>' +
    '<button class="btn btn--white" data-act="new">Start a challenge</button></div>' +
    '<div class="final-mark" aria-hidden="true"><svg viewBox="0 0 200 200"><path d="M22 178L84 22l40 86 20-38 34 108z" fill="#E65C00" stroke="#fff" stroke-width="10" stroke-linejoin="round"/><path d="M84 22l40 86-26 70H22z" fill="#FF8A1F" stroke="#fff" stroke-width="10" stroke-linejoin="round"/></svg></div>' +
    '</div></section>';

  var fl = function (label, act, v) { return '<button data-act="' + act + '"' + (v ? ' data-v="' + v + '"' : '') + '>' + label + '</button>'; };
  var foot = '<footer class="foot"><div class="wrap-w"><div class="foot-top">' +
    '<div class="foot-brand"><span class="brand brand--lg"><i>' + ICON.mark + '</i>Outwork</span>' +
    '<p>Group workout challenges where every finished workout scores and one person wins.</p></div>' +
    '<div class="foot-cols">' +
    '<div class="foot-col"><h3>Product</h3>' + fl('How it works', 'page', 'how') + fl('Scoring', 'page', 'scoring') + fl('Compete', 'page', 'compete') + fl('The rules', 'page', 'rules') + '</div>' +
    '<div class="foot-col"><h3>Get started</h3>' + fl('Start a challenge', 'new') + fl('Join with a code', 'join') + '</div>' +
    '<div class="foot-col"><h3>Account</h3>' + (signedIn() ? fl('Log out', 'logout') : fl('Sign up', 'signup') + fl('Log in', 'login')) + '</div>' +
    '</div></div>' +
    '<div class="foot-bottom"><span>&copy; ' + new Date().getFullYear() + ' Outwork. All rights reserved.</span>' +
    '<span>' + (store.mode === 'local' && !SERVER ? 'Challenges are saved on this device only right now.' : 'Workouts are self reported. Play fair.') + '</span></div>' +
    '</div></footer>';

  /* ---------- phone and tablet sections ---------- */
  var mHow = '<section class="m-sec"><div class="wrap-w"><h2 class="m-h">How it works</h2><ol class="m-steps">' +
    [['Start a challenge', 'Pick the length and the points.'], ['Invite your group', 'Send the six character code.'],
     ['Log what you finish', 'Enter your numbers, collect points.'], ['Take the win', 'Most points when time runs out.']].map(function (x, i) {
      return '<li><b>' + (i + 1) + '</b><div><h3>' + x[0] + '</h3><p>' + x[1] + '</p></div></li>';
    }).join('') + '</ol></div></section>';
  var mWorkouts = '<section class="m-sec"><div class="wrap-w"><h2 class="m-h">Every workout counts</h2></div><div class="m-scroll" aria-hidden="true">' +
    kinds.map(function (k) { return '<div class="tile ' + k[2].replace(/tile--(sm|lg)/g, '') + '"><b>' + k[0] + '</b><span>' + k[1] + '<small>' + k[3] + '</small></span></div>'; }).join('') +
    '</div><p class="m-hint">Each category has its own rate. You can change any of them.</p></section>';
  var mw = function (t, d, v) { return '<div><div><h3>' + t + '</h3><p>' + d + '</p></div><b>' + v + '</b></div>'; };
  var mScore = function (link) {
    return '<section class="m-sec m-sec--orange part--orange ptsec">' + TRACK + '<div class="wrap-w"><h2 class="m-h"><span class="h-dim">Three ways to score.</span> One way to win.</h2><div class="m-ways">' +
      mw('Do the work', 'Every mile and every rep', 'Rate') + mw('Push your pace', 'Against your own PR', '+' + Math.round(PACE_BONUS * 100) + '%') +
      mw('Keep your streak', 'Per day, for days in a row', '+' + STREAK_CAP) +
      '</div><p class="m-win">Most points when time runs out wins.</p>' +
      (link ? '<button class="btn btn--black" data-act="page" data-v="scoring">See how scoring works</button>' : '') + '</div></section>';
  };
  var mCompete = '<section class="m-sec"><div class="wrap-w"><h2 class="m-h">Log it. Watch the board move.</h2></div>' +
    '<div class="m-scroll">' + competeFeats + '</div></section>';
  var mRules = '<section class="m-sec"><div class="wrap-w"><h2 class="m-h"><span class="h-dim">One challenge.</span> One winner.</h2><ul class="m-checks">' +
    ['Top score when time runs out wins.', 'Two workouts count per day.', 'Ties go to whoever got there first.'].map(function (x) { return '<li><i>' + check + '</i><span>' + x + '</span></li>'; }).join('') +
    '</ul></div></section>';
  var D = function (x) { return '<div class="only-d">' + x + '</div>'; };
  var Mb = function (x) { return '<div class="only-m">' + x + '</div>'; };

  if (page === 'how') return nav + howPage + cta + foot;
  if (page === 'scoring') return nav + scoringPage + cta + foot;
  if (page === 'compete') return nav + competePage + cta + foot;
  if (page === 'rules') return nav + rulesPage + cta + foot;
  if (authBody) return nav + authBody + foot;
  return nav + hero + '<div id="myCh">' + chCards() + '</div>' +
    D(setup + workouts + pointsBrief + compete + rules) +
    Mb(mHow + mWorkouts + mScore(true) + mCompete + mRules) + cta + foot;
}

/* ---------- home page motion ---------- */
var RACE = [
  { Maya: 72, Jordan: 70, Chris: 58, Sam: 41 }, { Maya: 72, Jordan: 80, Chris: 58, Sam: 46 },
  { Maya: 82, Jordan: 80, Chris: 66, Sam: 46 }, { Maya: 82, Jordan: 90, Chris: 66, Sam: 56 },
  { Maya: 96, Jordan: 90, Chris: 74, Sam: 56 }
];
function raceHTML(names) {
  return '<div class="race" data-race style="--n:' + names.length + '">' + names.map(function (n, i) {
    return '<div class="race-row" data-n="' + n + '" style="transform:translateY(calc(var(--rh) * ' + i + '))"><em>' + (i + 1) + '</em><div>' + n +
      '<div class="race-bar"><i></i></div></div><b>' + RACE[0][n] + '</b><u class="race-pop"></u></div>';
  }).join('') + '</div>';
}
function raceStep(el, f, prev) {
  var rows = Array.prototype.slice.call(el.querySelectorAll('.race-row'));
  var order = rows.map(function (r) { return r.getAttribute('data-n'); }).sort(function (a, b) { return f[b] - f[a]; });
  rows.forEach(function (r) {
    var n = r.getAttribute('data-n'), idx = order.indexOf(n);
    r.style.transform = 'translateY(calc(var(--rh) * ' + idx + '))';
    r.classList.toggle('lead', idx === 0);
    r.querySelector('em').textContent = idx + 1;
    r.querySelector('b').textContent = f[n];
    r.querySelector('.race-bar i').style.width = Math.round(f[n]) + '%';
    var pop = r.querySelector('.race-pop');
    if (prev && f[n] > prev[n]) { pop.textContent = '+' + (f[n] - prev[n]); pop.classList.remove('go'); void pop.offsetWidth; pop.classList.add('go'); }
  });
}
function confetti(n, colors) {
  var out = '<div class="confetti">';
  for (var i = 0; i < n; i++) {
    out += '<i style="--x:' + ((i * 37 + 11) % 96) + '%;--c:' + colors[i % colors.length] + ';--d:' + (((i * 7) % 10) / 10 + (i % 3) * 0.35).toFixed(2) + 's"></i>';
  }
  return out + '</div>';
}
function countTo(el, to, ms) {
  var t0 = null;
  var step = function (t) {
    if (!el.isConnected) return;
    if (t0 === null) t0 = t;
    var k = Math.min(1, (t - t0) / ms);
    el.textContent = Math.round(to * (1 - Math.pow(1 - k, 3)));
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}
function scramble(el) {
  var goal = el.getAttribute('data-scramble'), abc = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789', tick = 0;
  var btn = el.parentNode.parentNode.querySelector('span');
  if (btn) { btn.textContent = 'Copy code'; btn.classList.remove('ok'); }
  var t = setInterval(function () {
    tick++;
    var done = Math.floor(tick / 3), out = '';
    for (var i = 0; i < goal.length; i++) out += i < done ? goal[i] : abc[Math.floor(Math.random() * abc.length)];
    el.textContent = out;
    if (done >= goal.length) {
      clearInterval(t);
      if (btn) setTimeout(function () { if (btn.isConnected) { btn.textContent = 'Copied'; btn.classList.add('ok'); } }, 500);
    }
  }, 55);
  homeTimers.push(t);
}
var homeTimers = [];
var tiltOff = null;
function stopHome() {
  homeTimers.forEach(function (t) { clearInterval(t); });
  homeTimers = [];
  if (tiltOff) { tiltOff(); tiltOff = null; }
}
function startHome() {
  stopHome();
  var media = document.getElementById('heroMedia');
  var calm = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var races = Array.prototype.slice.call(document.querySelectorAll('[data-race]'));
  races.forEach(function (el) { raceStep(el, RACE[0], null); });
  if (calm) { if (media) showScene(media, 1); return; }
  loopHeroVideo();

  var scene = 0;
  if (media) homeTimers.push(setInterval(function () { scene = (scene + 1) % 3; showScene(media, scene); }, 4400));

  var frame = 0;
  homeTimers.push(setInterval(function () {
    var prev = RACE[frame];
    frame = (frame + 1) % RACE.length;
    races.forEach(function (el) { raceStep(el, RACE[frame], frame === 0 ? null : prev); });
  }, 1500));

  var cyc = Array.prototype.slice.call(document.querySelectorAll('[data-cycle]'));
  homeTimers.push(setInterval(function () {
    cyc.forEach(function (box) {
      var kids = box.children, on = 0;
      for (var i = 0; i < kids.length; i++) if (kids[i].classList.contains('on')) on = i;
      kids[on].classList.remove('on');
      kids[(on + 1) % kids.length].classList.add('on');
    });
  }, 1300));

  var loops = function () {
    Array.prototype.forEach.call(document.querySelectorAll('[data-scramble]'), scramble);
    Array.prototype.forEach.call(document.querySelectorAll('[data-count][data-loop]'), function (el) { countTo(el, +el.getAttribute('data-count'), 1400); });
  };
  loops();
  homeTimers.push(setInterval(loops, 4200));

  // Card tilts toward the pointer on screens with a mouse.
  var hero = media && media.closest('.lp-hero'), tilt = document.getElementById('tilt');
  if (hero && tilt && window.matchMedia && window.matchMedia('(hover: hover) and (min-width: 960px)').matches) {
    var move = function (e) {
      var r = media.getBoundingClientRect();
      var dx = (e.clientX - (r.left + r.width / 2)) / r.width, dy = (e.clientY - (r.top + r.height / 2)) / r.height;
      tilt.style.setProperty('--ry', Math.max(-14, Math.min(14, dx * 16)).toFixed(1) + 'deg');
      tilt.style.setProperty('--rx', Math.max(-10, Math.min(10, -dy * 14)).toFixed(1) + 'deg');
    };
    var leave = function () { tilt.style.removeProperty('--ry'); tilt.style.removeProperty('--rx'); };
    hero.addEventListener('pointermove', move); hero.addEventListener('pointerleave', leave);
    tiltOff = function () { hero.removeEventListener('pointermove', move); hero.removeEventListener('pointerleave', leave); };
  }
}
/* Seamless hero video loop. Two copies of the video are stacked. Just before one ends,
   the other starts from the beginning and fades in over it, so there is never a pause
   or a black frame at the loop point. HERO_VIDEO_FADE is the overlap in seconds. */
var HERO_VIDEO_FADE = 0.6;
function loopHeroVideo() {
  var box = document.getElementById('heroBg');
  if (!box) return;
  var vs = box.querySelectorAll('video'), cur = 0, busy = false;
  var play = function (v) { var pr = v.play(); if (pr && pr.catch) pr.catch(function () {}); };
  play(vs[0]);
  var swap = function () {
    if (busy) return;
    busy = true;
    var out = vs[cur], inn = vs[1 - cur];
    try { inn.currentTime = 0; } catch (e) {}
    inn.style.zIndex = 2; out.style.zIndex = 1;
    play(inn); inn.classList.add('is-on');
    cur = 1 - cur;
    setTimeout(function () { out.classList.remove('is-on'); out.pause(); busy = false; }, HERO_VIDEO_FADE * 1000 + 80);
  };
  homeTimers.push(setInterval(function () {
    var v = vs[cur];
    if (v.duration && v.duration > HERO_VIDEO_FADE * 3 && v.currentTime >= v.duration - HERO_VIDEO_FADE) swap();
    else if (v.ended) { v.currentTime = 0; play(v); }
  }, 40));
}
function openMenu() {
  document.documentElement.classList.add('menu-open');
  var b = document.getElementById('menuBtn'), x = document.getElementById('menuX');
  if (b) b.setAttribute('aria-expanded', 'true');
  if (x) x.focus();
}
function closeMenu() {
  if (!document.documentElement.classList.contains('menu-open')) return;
  document.documentElement.classList.remove('menu-open');
  var b = document.getElementById('menuBtn');
  if (b) { b.setAttribute('aria-expanded', 'false'); if (b.offsetParent) b.focus(); }
}
function showScene(media, n) {
  Array.prototype.forEach.call(media.querySelectorAll('[data-s]'), function (el) {
    el.classList.toggle('is-on', +el.getAttribute('data-s') === n);
  });
  var big = media.querySelector('.hscene.is-on [data-count]');
  if (big) countTo(big, +big.getAttribute('data-count'), 1600);
}

function viewCreate() {
  var lens = [[7, '1 week'], [14, '2 weeks'], [30, '30 days'], [0, 'Pick an end date']];
  var caps = [[1, '1'], [2, '2'], [3, '3'], [0, 'No limit']];
  return '<div class="wrap"><div class="bar"><button class="back" data-act="home">' + ICON.back + 'Challenges</button></div>' +
    '<form class="form" id="createForm" novalidate>' +
    '<h1 class="h-md">Start a challenge</h1>' +
    '<p class="lede">Points are locked once the challenge starts, so nobody can change the rules halfway through.</p>' +
    '<div class="field"><label for="f-name">Challenge name</label>' +
    '<input class="input" id="f-name" data-f="name" maxlength="40" placeholder="October grind" value="' + esc(F.name) + '"></div>' +
    '<div class="field"><label for="f-nick">Your name on the leaderboard</label>' +
    '<input class="input" id="f-nick" data-f="nick" maxlength="24" value="' + esc(F.nick) + '"></div>' +
    '<div class="field"><span class="lbl">How long it runs</span><div class="seg">' +
    lens.map(function (l) { return '<button type="button" data-act="len" data-v="' + l[0] + '" aria-pressed="' + (F.len === l[0]) + '">' + l[1] + '</button>'; }).join('') +
    '</div>' + (F.len === 0 ? '<input class="input" type="date" data-f="end" aria-label="End date" min="' + today() + '" value="' + esc(F.end) + '">' : '') +
    '<p class="hint">Starts today. Ends at midnight on ' + esc(fmtLong(endOf(F))) + '.</p></div>' +
    '<div class="field"><span class="lbl">Workouts that count per person each day</span><div class="seg">' +
    caps.map(function (c) { return '<button type="button" data-act="cap" data-v="' + c[0] + '" aria-pressed="' + (F.cap === c[0]) + '">' + c[1] + '</button>'; }).join('') +
    '</div></div>' +
    '<div class="field"><span class="lbl">Workouts and their rates</span>' +
    '<p class="hint">Switch a category off or change its rate. Rates lock once the challenge starts.</p>' +
    '<div class="cat-list">' + F.acts.map(function (a, i) {
      var c = CATS[a.cat];
      return '<label class="cat-row"><input type="checkbox" data-f="act-on" data-i="' + i + '"' + (a.on ? ' checked' : '') + '><span class="cat-name">' + c.label + '<small>Players enter ' + (c.type === 'dist' ? c.units + ' and time' : 'sets, reps and weight') + '</small></span>' +
        '<input class="input" data-f="act-rate" data-i="' + i + '" inputmode="decimal" aria-label="' + c.label + ' points per ' + c.perLabel + '" value="' + esc(a.rate) + '"><span class="cat-per">per ' + c.perLabel + '</span></label>';
    }).join('') + '</div></div>' +
    '<div class="bonus-box"><b>Bonuses in every challenge</b><ul><li>Pace: up to +' + Math.round(PACE_BONUS * 100) + '% on distance workouts, measured against each player\'s own PR.</li>' +
    '<li>New PR: +' + PR_POINTS + '.</li><li>Streak: +' + STREAK_STEP + ' for each day in a row, up to +' + STREAK_CAP + ' a day.</li></ul></div>' +
    '<p class="err" id="formErr">' + esc(S.err) + '</p>' +
    '<button class="btn btn--orange btn--block" type="submit">Start challenge</button>' +
    '</form></div>';
}
function endOf(f) {
  if (f.len > 0) return addDays(today(), f.len - 1);
  return f.end && f.end >= today() ? f.end : today();
}

function viewJoin() {
  return '<div class="wrap"><div class="bar"><button class="back" data-act="home">' + ICON.back + 'Challenges</button></div>' +
    '<form class="form" id="joinForm" novalidate>' +
    '<h1 class="h-md">Join with a code</h1>' +
    '<p class="lede">Ask whoever started the challenge for its six character code.</p>' +
    '<div class="field"><label for="j-code">Challenge code</label>' +
    '<input class="input input--code" id="j-code" data-j="code" maxlength="6" autocomplete="off" autocapitalize="characters" value="' + esc(J.code) + '"></div>' +
    '<div class="field"><label for="j-nick">Your name on the leaderboard</label>' +
    '<input class="input" id="j-nick" data-j="nick" maxlength="24" value="' + esc(J.nick) + '"></div>' +
    '<p class="err" id="formErr">' + esc(S.err) + '</p>' +
    '<button class="btn btn--orange btn--block" type="submit">Join challenge</button>' +
    '</form></div>';
}

function viewGroup() {
  var g = cur();
  if (!g) return '<div class="wrap loading">Loading challenge</div>';
  var st = status(g), table = standings(g), uid = store.uid;
  var meIdx = -1;
  table.forEach(function (r, i) { if (r.uid === uid) meIdx = i; });
  var me = meIdx >= 0 ? table[meIdx] : { pts: 0, count: 0, streak: 0 };
  var total = diffDays(g.end, g.start) + 1;
  var elapsed = Math.min(total, Math.max(0, diffDays(today(), g.start) + 1));
  var winner = st.over && table.length && table[0].pts > 0 ? table[0] : null;

  var hero;
  if (st.over) {
    hero = '<header class="band--orange hero"><div class="wrap">' +
      '<div class="bar"><button class="back" data-act="home">' + ICON.back + 'Challenges</button></div>' +
      '<h1 class="h-lg"><span class="h-dim">' + esc(g.name) + ' is over.</span> ' +
      (winner ? esc(winner.uid === uid ? 'You win.' : winner.nick + ' wins.') : 'Nobody logged a workout, so nobody wins.') + '</h1>' +
      (winner ? '<p class="hero-sub">' + winner.pts + ' points from ' + plural(winner.count, 'workout') + '</p>' : '') +
      '</div></header>';
  } else {
    hero = '<header class="band--orange hero"><div class="wrap">' +
      '<div class="bar"><button class="back" data-act="home">' + ICON.back + 'Challenges</button></div>' +
      '<h1 class="h-lg">' + esc(g.name) + '</h1>' +
      '<p class="hero-sub">' + esc(st.label) + '. Ends ' + esc(fmtLong(g.end)) + '.</p>' +
      '<div class="timebar" role="img" aria-label="Day ' + elapsed + ' of ' + total + '"><i style="width:' + Math.round(elapsed / total * 100) + '%"></i></div>' +
      '<div class="stats">' +
      '<div><b>' + me.pts + '</b><span>Your points</span></div>' +
      '<div><b>' + (meIdx >= 0 ? (meIdx + 1) + '<small>' + ordinal(meIdx + 1) + '</small>' : '0') + '</b><span>Place, of ' + table.length + '</span></div>' +
      (g.bonus ? '<div><b>' + (me.streak || 0) + '</b><span>Day streak</span></div></div>' : '<div><b>' + me.count + '</b><span>Workouts</span></div></div>') +
      '<button class="btn btn--black btn--block" data-act="log">' + ICON.plus + 'Log a workout</button>' +
      '</div></header>';
  }

  var tabs = [['standings', 'Standings'], ['feed', 'Feed'], ['rules', 'Rules']];
  if ((g.acts || []).some(function (a) { return CATS[a.cat]; })) tabs.splice(2, 0, ['records', 'My PRs']);
  var meta = function (r) { return plural(r.count, 'workout') + (r.streak > 1 ? ', ' + r.streak + ' day streak' : ''); };
  var tabBar = '<div class="tabs" role="tablist">' + tabs.map(function (t) {
    return '<button class="tab" role="tab" data-act="tab" data-v="' + t[0] + '" aria-selected="' + (S.tab === t[0]) + '">' + t[1] + '</button>';
  }).join('') + '</div>';

  var panel = '';
  if (S.tab === 'standings') {
    if (!table.length) panel = '<div class="empty">Loading standings</div>';
    else {
      var top = table[0].pts || 1;
      panel = '<div class="board">' + table.map(function (r, i) {
        var youTag = r.uid === uid ? '<em class="you">You</em>' : '';
        if (i === 0 && r.pts > 0) {
          return '<div class="row row--lead"><div class="who"><div class="lead-tag">' + (st.over ? 'Winner' : 'Leading') + '</div>' +
            '<div class="who-name"><span>' + esc(r.nick) + '</span>' + youTag + '</div>' +
            '<div class="who-meta">' + meta(r) + '</div></div>' +
            '<div class="pts">' + r.pts + '<small>points</small></div></div>';
        }
        var gap = table[0].pts - r.pts;
        return '<div class="row"><div class="rank">' + (i + 1) + '</div><div class="who">' +
          '<div class="who-name"><span>' + esc(r.nick) + '</span>' + youTag + '</div>' +
          '<div class="track"><i style="width:' + Math.round(r.pts / top * 100) + '%"></i></div>' +
          '<div class="who-meta">' + meta(r) + (gap > 0 ? ', ' + gap + ' behind' : '') + '</div></div>' +
          '<div class="pts">' + r.pts + '<small>pts</small></div></div>';
      }).join('') + '</div>';
      if (table.length === 1 && !st.over) {
        panel += '<p class="note">It is only you so far. Send code <b>' + esc(g.code) + '</b> to the people you want to beat.</p>';
      }
    }
  } else if (S.tab === 'feed') {
    var names = {};
    S.members.forEach(function (m) { names[m.uid] = m.nick; });
    var logs = S.logs.slice().sort(function (a, b) { return (b.at || 0) - (a.at || 0); });
    panel = logs.length ? logs.map(function (l) {
      var nick = names[l.uid] || 'Someone';
      var day = l.date === today() ? 'Today' : l.date === addDays(today(), -1) ? 'Yesterday' : fmt(l.date);
      return '<div class="feed-item"><div class="av" aria-hidden="true">' + esc(initials(nick)) + '</div><div>' +
        '<div class="feed-line"><b>' + esc(nick) + '</b> finished ' + esc(l.activity) + '</div>' +
        '<div class="feed-meta">' + esc(day) + (metricsText(l) ? ', ' + esc(metricsText(l)) : '') + '</div>' +
        ((l.perf || l.prPts) ? '<div class="feed-break">' + l.points + (CATS[l.cat] && CATS[l.cat].type === 'dist' ? ' for distance' : ' for reps') + (l.perf ? ', +' + l.perf + ' pace bonus' : '') + (l.prPts ? ', +' + l.prPts + ' new PR' : '') + '</div>' : '') +
        ((l.prs && l.prs.length) ? '<div class="feed-pr">New PR: ' + esc(l.prs.join(' and ').toLowerCase()) + '</div>' : '') +
        (l.note ? '<div class="feed-note">' + esc(l.note) + '</div>' : '') +
        (l.uid === uid && !st.over ? '<button class="link" data-act="delLog" data-id="' + esc(l.id) + '">Remove</button>' : '') +
        '</div><div class="feed-pts">+' + logTotal(l) + '</div></div>';
    }).join('') : '<div class="empty">No workouts logged yet. The first one puts somebody in the lead.</div>';
  } else if (S.tab === 'records') {
    if (!R) R = recordsForm(g);
    var rf = function (key, field, label, ph) {
      return '<div class="field"><label>' + label + '<input class="input" data-r="' + esc(key) + '|' + field + '" inputmode="decimal" placeholder="' + ph + '" value="' + esc((R[key] || {})[field] || '') + '"></label></div>';
    };
    var blocks = (g.acts || []).filter(function (a) { return CATS[a.cat]; }).map(function (a) {
      var c = CATS[a.cat], k = a.cat;
      return '<div class="rec-block"><h3 class="rules-h">' + esc(a.name) + '</h3><div class="rec-grid' + (c.type === 'lift' ? ' rec-grid--3' : '') + '">' +
        (c.type === 'dist' ? rf(k, 'dist', 'Distance, ' + c.units, c.prPh) + rf(k, 'time', 'Your best time', '25:00')
          : LIFTS.map(function (l) { return rf(k, l[0], l[1] + ', lb', '225'); }).join('')) +
        '</div></div>';
    }).join('');
    panel = '<p class="rules-p">Enter your PRs once. For distance, give one distance and your best time for it. For strength, your best single lift. They are saved to your profile and update when you beat them.</p>' +
      blocks + '<p class="err" id="formErr">' + esc(S.err) + '</p><button class="btn btn--orange" data-act="saveRecords">Save PRs</button>';
  } else {
    panel = '<div class="code-box"><div><p>Challenge code</p><b id="codeText">' + esc(g.code) + '</b></div>' +
      '<button class="btn btn--orange btn--sm" data-act="copy">Copy code</button></div>' +
      '<h3 class="rules-h">How it works</h3>' +
      '<div class="kv"><span>Runs</span><span>' + fmt(g.start) + ' to ' + fmt(g.end) + '</span></div>' +
      '<div class="kv"><span>Workouts that count per day</span><span>' + (g.cap ? g.cap : 'No limit') + '</span></div>' +
      '<div class="kv"><span>Players</span><span>' + S.members.length + '</span></div>' +
      '<h3 class="rules-h">Rates</h3>' +
      (g.acts || []).map(function (a) { return '<div class="kv"><span>' + esc(a.name) + '</span><span>' + esc(rateText(a)) + '</span></div>'; }).join('') +
      (g.bonus ? '<h3 class="rules-h">Bonuses</h3>' +
        '<div class="kv"><span>Pace on distance workouts, against your PR</span><span>Up to +' + Math.round(PACE_BONUS * 100) + '%</span></div>' +
        '<div class="kv"><span>New PR</span><span>+' + PR_POINTS + '</span></div>' +
        '<div class="kv"><span>Streak, days in a row</span><span>+' + STREAK_STEP + ' a day, up to +' + STREAK_CAP + '</span></div>' : '') +
      '<h3 class="rules-h">Who wins</h3>' +
      '<p class="rules-p">The player with the most points when the challenge ends wins. If two players finish level, the one who reached that score first takes it, so there is always a single winner.</p>' +
      '<div class="leave"><button class="btn btn--ghost btn--sm" data-act="leave">' + (S.confirmLeave ? 'Tap again to leave' : 'Leave challenge') + '</button></div>';
  }
  return hero + '<main class="wrap">' + tabBar + '<div class="panel" role="tabpanel">' + panel + '</div></main>';
}

function render() {
  var html;
  if (SITE[S.view] !== undefined) html = viewHome(S.view);
  else if (S.view === 'create') html = viewCreate();
  else if (S.view === 'join') html = viewJoin();
  else if (S.view === 'group') html = viewGroup();
  else html = '<div class="wrap loading">Loading your challenges</div>';
  app.innerHTML = html;
  if (SITE[S.view] !== undefined) startHome(); else stopHome();
}
/* Site pages and their addresses, for example  yoursite.com/#/scoring */
/* In the multi-file build each page is its own HTML file (index.html, scoring.html, ...).
   Those files set window.OUTWORK_MULTI and window.OUTWORK_PAGE before this script runs. */
var OW_PAGE = window.OUTWORK_PAGE || document.documentElement.getAttribute('data-ow-page') || '';
var MULTI = !!window.OUTWORK_MULTI || !!OW_PAGE;
/* On the server build, accounts and challenges live in the database. The marketing
   pages hand off to login.html, signup.html and dashboard.html. */
var SERVER = document.documentElement.getAttribute('data-ow-server') === '1';
var SERVER_GO = { 'new': 'dashboard.html', join: 'dashboard.html', tpl: 'dashboard.html', login: 'login.html', signup: 'signup.html' };
var FILES = { home: 'index.html', how: 'how-it-works.html', scoring: 'scoring.html', compete: 'compete.html', rules: 'rules.html', login: 'login.html', signup: 'signup.html' };
var SITE = { home: '', how: 'how-it-works', scoring: 'scoring', compete: 'compete', rules: 'rules', login: 'login', signup: 'signup' };
function viewFromHash() {
  var h = (location.hash || '').replace(/^#\/?/, '');
  for (var k in SITE) if (SITE[k] === h) return k;
  return 'home';
}
function go(view, quiet) {
  if (MULTI && !quiet && SITE[view] !== undefined && view !== S.view) { location.href = FILES[view]; return; }
  if ((view === 'login' || view === 'signup') && !A) A = { name: (store && store.suggestedName) || '', email: '', pass: '' };
  S.view = view; S.err = ''; S.confirmLeave = false;
  if (!MULTI && !quiet && SITE[view] !== undefined) { try { history.pushState(null, '', '#/' + SITE[view]); } catch (e) {} }
  render(); window.scrollTo(0, 0);
}
window.addEventListener('popstate', function () {
  if (!store || MULTI) return;
  if (unsubGroup) { unsubGroup(); unsubGroup = null; }
  closeSheet(); closeMenu(); S.gid = null;
  go(viewFromHash(), true);
});

/* ---------- log sheet ---------- */
function sheetMetrics(a) {
  var c = CATS[a.cat];
  if (!c) return {};
  if (c.type === 'dist') {
    var m = { dist: num(L.dist), mins: parseTime(L.time) };
    if (!(m.dist > 0 && m.dist <= c.max)) return 'Enter the distance in ' + c.units + '.';
    if (!(m.mins > 0 && m.mins <= 1440)) return 'Enter your time, like 42:30.';
    return m;
  }
  var lifts = [], prs = {}, err = '';
  LIFTS.forEach(function (l) {
    var k = l[0], sets = num(L[k + '_s']), reps = num(L[k + '_r']), w = num(L[k + '_w']), pr = num(L[k + '_pr']);
    if (pr) prs[k] = Math.min(pr, 2000);
    if (!sets && !reps && !w) return;
    if (!(sets >= 1 && sets <= 20 && reps >= 1 && reps <= 100 && w >= 1 && w <= 2000)) { err = 'Fill in sets, reps and weight for ' + l[1] + '.'; return; }
    if (!pr) { err = 'Add your ' + l[1].toLowerCase() + ' PR so the reps can be scored.'; return; }
    lifts.push({ k: k, sets: Math.round(sets), reps: Math.round(reps), w: w });
  });
  if (err) return err;
  if (!lifts.length) return 'Enter sets, reps and weight for at least one lift.';
  return { lifts: lifts, prs: prs };
}
function sheetPreview() {
  var g = cur(), a = g && (g.acts || [])[L.act];
  if (!a) return '';
  var c = CATS[a.cat];
  if (!c) return '<div class="prev-row prev-total"><span>This workout</span><b>+' + (a.points || 0) + '</b></div>';
  var m = sheetMetrics(a);
  if (typeof m === 'string') return '<p class="hint">' + (c.type === 'dist' ? esc(a.name) + ' earns ' + esc(rateText(a)) + ', plus a bonus for pace.' : 'Each rep scores by how heavy it is next to your PR.') + '</p>';
  var rec = c.type === 'lift' ? Object.assign({}, myRec(a), m.prs) : myRec(a);
  var sc = scoreWorkout(g, a, m, rec), days = myDays(g), first = !days[L.date];
  days[L.date] = 1;
  var run = streakOn(days, L.date), sb = first ? streakPts(run) : 0;
  var row = function (x, y, cls) { return '<div class="prev-row' + (cls ? ' ' + cls : '') + '"><span>' + x + '</span><b>' + y + '</b></div>'; };
  return (c.type === 'dist'
      ? row(fmtAmt(m.dist) + ' ' + c.unit + ' at ' + esc(rateText(a)), sc.base) +
        (myRec(a).pace ? row('Pace bonus, ' + fmtPace(sc.pace) + ' per ' + c.perLabel, '+' + sc.perf) : row('No PR saved, so no pace bonus yet', '+0'))
      : sc.rows.map(function (r) { return row(liftName(r.k) + ' ' + r.sets + ' x ' + r.reps + ' at ' + r.pct + '% of PR', r.pts); }).join('')) +
    sc.prs.map(function (x) { return row('New PR: ' + x.toLowerCase(), '+' + PR_POINTS, 'prev-pr'); }).join('') +
    (sb ? row('Streak, day ' + run, '+' + sb) : '') +
    row('Total', '+' + (sc.total + sb), 'prev-total');
}
function renderSheet() {
  var g = cur();
  if (!g || !L) return;
  var yest = addDays(today(), -1), canYest = yest >= g.start;
  var a = (g.acts || [])[L.act], c = a ? CATS[a.cat] : null, rec = a ? myRec(a) : {};
  var fld = function (key, label, ph) {
    return '<div class="field"><label>' + label + '<input class="input" data-l="' + key + '" inputmode="decimal" placeholder="' + ph + '" value="' + esc(L[key] || '') + '"></label></div>';
  };
  var cell = function (key, ph, lab) { return '<input class="input" data-l="' + key + '" inputmode="decimal" placeholder="' + ph + '" aria-label="' + lab + '" value="' + esc(L[key] || '') + '">'; };
  var metrics = '';
  if (c && c.type === 'dist') {
    metrics = '<div class="rec-grid">' + fld('dist', 'Distance, ' + c.units, c.ph) + fld('time', 'Time', '42:30') + '</div><p class="hint rec-line">' +
      (rec.pace ? 'Your PR: ' + fmtAmt(rec.dist) + ' ' + c.unit + ' in ' + fmtTime(rec.pace * rec.dist / c.per) + ' (' + fmtPace(rec.pace) + ' per ' + c.perLabel + ')' : 'No PR saved. Add one under My PRs to earn the pace bonus. Otherwise this workout sets it.') + '</p>';
  } else if (c) {
    if (L._liftCat !== a.cat) { L._liftCat = a.cat; LIFTS.forEach(function (l) { if (!L[l[0] + '_pr'] && rec[l[0]]) L[l[0] + '_pr'] = String(round1(rec[l[0]])); }); }
    metrics = '<div class="lift-grid"><span></span><span>Sets</span><span>Reps</span><span>Weight</span><span>Your PR</span>' +
      LIFTS.map(function (l) {
        return '<b>' + l[1] + '</b>' + cell(l[0] + '_s', '5', l[1] + ' sets') + cell(l[0] + '_r', '5', l[1] + ' reps') + cell(l[0] + '_w', 'lb', l[1] + ' weight in pounds') + cell(l[0] + '_pr', 'lb', l[1] + ' PR in pounds');
      }).join('') + '</div><p class="hint rec-line">Fill in the lifts you did. Your PRs are saved to your profile.</p>';
  }
  sheet.innerHTML = '<div class="sheet-top"><h2 class="h-md">Log a workout</h2>' +
    '<button class="icon-btn" data-act="closeSheet" aria-label="Close">' + ICON.x + '</button></div>' +
    '<div class="field"><span class="lbl">What did you finish?</span><div class="pick">' +
    (g.acts || []).map(function (x, i) {
      var xc = CATS[x.cat];
      return '<button type="button" data-act="pickAct" data-i="' + i + '" aria-pressed="' + (L.act === i) + '"><span>' + esc(x.name) + '</span><i>' + (xc ? fmtAmt(x.rate) + '/' + xc.short : '+' + (x.points || 0)) + '</i></button>';
    }).join('') + '</div></div>' + metrics + '<div class="prev" id="l-prev">' + sheetPreview() + '</div>' +
    (canYest ? '<div class="field"><span class="lbl">When?</span><div class="seg">' +
      '<button type="button" data-act="pickWhen" data-v="' + today() + '" aria-pressed="' + (L.date === today()) + '">Today</button>' +
      '<button type="button" data-act="pickWhen" data-v="' + yest + '" aria-pressed="' + (L.date === yest) + '">Yesterday</button></div></div>' : '') +
    '<div class="field"><label for="l-note">Note, if you want one</label>' +
    '<input class="input" id="l-note" maxlength="80" placeholder="5 miles before work" value="' + esc(L.note) + '"></div>' +
    '<p class="err">' + esc(L.err) + '</p>' +
    '<button class="btn btn--orange btn--block" data-act="submitLog"' + (L.busy ? ' disabled' : '') + '>Log workout</button>';
}
function openSheet() {
  L = { act: -1, date: today(), note: '', dist: '', time: '', err: '', busy: false };
  renderSheet();
  sheetWrap.classList.add('open');
  var first = sheet.querySelector('.pick button');
  if (first) first.focus();
}
function closeSheet() { sheetWrap.classList.remove('open'); L = null; }
function keepNote() { var n = document.getElementById('l-note'); if (n && L) L.note = n.value; }

/* ---------- actions ---------- */
function openGroup(gid) {
  if (unsubGroup) unsubGroup();
  S.gid = gid; S.members = []; S.logs = []; S.tab = 'standings';
  go('group');
  unsubGroup = store.watchGroup(gid, function (part) {
    if (part.members) S.members = part.members;
    if (part.logs) S.logs = part.logs;
    var typing = S.tab === 'records' && document.activeElement && document.activeElement.getAttribute('data-r');
    if (S.view === 'group' && !typing) render();
  });
}
function recordsForm(g) {
  var f = {};
  (g.acts || []).forEach(function (a) {
    var c = CATS[a.cat]; if (!c) return;
    var r = myRec(a);
    f[a.cat] = c.type === 'dist'
      ? { dist: r.dist ? String(round1(r.dist)) : '', time: r.pace && r.dist ? fmtTime(r.pace * r.dist / c.per) : '' }
      : { squat: r.squat ? String(round1(r.squat)) : '', bench: r.bench ? String(round1(r.bench)) : '', dead: r.dead ? String(round1(r.dead)) : '' };
  });
  return f;
}
function saveRecords() {
  var g = cur(); if (!g || !R) return;
  var recs = Object.assign({}, S.profile.records || {}), bad = '';
  (g.acts || []).forEach(function (a) {
    var c = CATS[a.cat]; if (!c) return;
    var f = R[a.cat] || {};
    if (c.type === 'dist') {
      var d = Math.min(num(f.dist), c.max), t = parseTime(f.time);
      if ((String(f.dist || '').trim() || String(f.time || '').trim()) && !(d && t)) { bad = 'For ' + a.name + ', enter both a distance and a time like 25:00.'; return; }
      recs[a.cat] = d && t ? { dist: d, mins: t, pace: t / (d / c.per) } : {};
    } else {
      recs[a.cat] = { squat: Math.min(num(f.squat), 2000), bench: Math.min(num(f.bench), 2000), dead: Math.min(num(f.dead), 2000) };
    }
  });
  if (bad) { S.err = bad; render(); return; }
  S.profile.records = recs;
  saveProfile().then(function () { S.err = ''; R = null; render(); toast('PRs saved.'); }).catch(fail);
}
function saveProfile() {
  return store.saveProfile({ nick: S.profile.nick || '', groups: S.profile.groups || [], name: S.profile.name || '', email: S.profile.email || '', signedIn: !!S.profile.signedIn, records: S.profile.records || {} });
}
function newForm(name, len) {
  F = { name: name || '', nick: myName(), len: len || 14, end: '', cap: 2,
    acts: CAT_ORDER.map(function (k) { return { cat: k, on: true, rate: String(CATS[k].rate) }; }) };
  go('create');
}
function joinForm() { J = { code: '', nick: myName() }; go('join'); }
function needAuth(fn) {
  if (signedIn()) { fn(); return; }
  afterAuth = fn;
  A = { name: store.suggestedName || '', email: '', pass: '' };
  go('signup');
}
function submitAuth() {
  var up = S.view === 'signup';
  var name = A.name.trim(), email = A.email.trim().toLowerCase();
  var okEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  var err = (up && !name) ? 'Add your name.' :
    !okEmail ? 'Enter a valid email address.' :
    (up && A.pass.length < 8) ? 'Use a password with 8 characters or more.' :
    (!up && !A.pass) ? 'Enter your password.' :
    (!up && (!S.profile.email || S.profile.email !== email)) ? 'No account uses that email. Sign up instead.' : '';
  if (err) { S.err = err; render(); return; }
  if (up) { S.profile.name = name; S.profile.email = email; if (!S.profile.nick) S.profile.nick = name; }
  S.profile.signedIn = true;
  saveProfile().then(function () {
    var next = afterAuth; afterAuth = null; A = null;
    if (next) next(); else go('home');
    toast(up ? 'Signed up. Welcome to Outwork.' : 'Logged in.');
  }).catch(function (e) { S.profile.signedIn = false; fail(e); });
}

function submitCreate() {
  var name = F.name.trim(), nick = F.nick.trim();
  var acts = F.acts.filter(function (a) { return a.on; }).map(function (a) {
    return { name: CATS[a.cat].label, cat: a.cat, rate: Math.round(num(a.rate) * 100) / 100 };
  });
  var bad = acts.filter(function (a) { return !(a.rate >= 0.1 && a.rate <= 100); })[0];
  var err = !name ? 'Give the challenge a name.' :
    !nick ? 'Add the name you want on the leaderboard.' :
    !acts.length ? 'Keep at least one workout category switched on.' :
    bad ? 'Set the ' + bad.name + ' rate between 0.1 and 100.' :
    (F.len === 0 && (!F.end || F.end < today())) ? 'Pick an end date that is today or later.' : '';
  if (err) { S.err = err; render(); return; }
  var g = { name: name, code: makeCode(), start: today(), end: endOf(F), cap: F.cap, acts: acts, bonus: true, v: 3, createdBy: store.uid, createdAt: Date.now() };
  var gid;
  store.createGroup(g).then(function (id) {
    gid = id;
    return store.setMember(gid, { uid: store.uid, nick: nick, joinedAt: Date.now() });
  }).then(function () {
    S.profile.nick = nick;
    S.profile.groups = (S.profile.groups || []).concat(gid);
    if (!cur() && !S.groups.some(function (x) { return x.id === gid; })) S.groups.push(Object.assign({ id: gid }, g));
    return saveProfile();
  }).then(function () {
    openGroup(gid);
    S.tab = 'rules'; render();
    toast('Challenge started. Share the code to bring people in.');
  }).catch(fail);
}

function submitJoin() {
  var code = J.code.trim().toUpperCase(), nick = J.nick.trim();
  var g = S.groups.filter(function (x) { return x.code === code; })[0];
  var err = code.length !== 6 ? 'Enter the six character code.' :
    !nick ? 'Add the name you want on the leaderboard.' :
    !g ? 'No challenge uses that code. Check it with whoever invited you.' :
    status(g).over ? 'That challenge has already ended.' : '';
  if (err) { S.err = err; render(); return; }
  if ((S.profile.groups || []).indexOf(g.id) >= 0) { openGroup(g.id); return; }
  store.setMember(g.id, { uid: store.uid, nick: nick, joinedAt: Date.now() }).then(function () {
    S.profile.nick = nick;
    S.profile.groups = (S.profile.groups || []).concat(g.id);
    return saveProfile();
  }).then(function () {
    openGroup(g.id);
    toast('Joined ' + g.name + '.');
  }).catch(fail);
}

function submitLog() {
  var g = cur();
  if (!g || !L || L.busy) return;
  keepNote();
  if (status(g).over) { L.err = 'This challenge has ended.'; renderSheet(); return; }
  var a = (g.acts || [])[L.act];
  if (!a) { L.err = 'Pick the workout you finished.'; renderSheet(); return; }
  if (g.cap) {
    var n = S.logs.filter(function (l) { return l.uid === store.uid && l.date === L.date; }).length;
    if (n >= g.cap) {
      L.err = 'You already logged ' + plural(n, 'workout') + ' for that day. This challenge counts ' + g.cap + ' per day.';
      renderSheet(); return;
    }
  }
  var m = sheetMetrics(a);
  if (typeof m === 'string') { L.err = m; renderSheet(); return; }
  var c = CATS[a.cat], isLift = c && c.type === 'lift';
  var sc = scoreWorkout(g, a, m, isLift ? Object.assign({}, myRec(a), m.prs) : myRec(a));
  var days = myDays(g), first = !days[L.date];
  days[L.date] = 1;
  var sb = g.bonus && first ? streakPts(streakOn(days, L.date)) : 0;
  L.busy = true; renderSheet();
  store.addLog(g.id, { uid: store.uid, activity: a.name, cat: a.cat || '', points: sc.base, perf: sc.perf, prPts: sc.prPts, prs: sc.prs,
    dist: m.dist || 0, mins: m.mins || 0, lifts: m.lifts || [], date: L.date, note: L.note.trim(), at: Date.now() })
    .then(function () {
      closeSheet();
      toast((sc.prs.length ? 'New PR. ' : 'Logged. ') + '+' + (sc.total + sb) + ' points.');
      if (sc.rec) {
        S.profile.records = S.profile.records || {};
        S.profile.records[a.cat] = sc.rec;
        return saveProfile();
      }
    })
    .catch(function (e) { if (L) { L.busy = false; renderSheet(); } fail(e); });
}

function leave() {
  if (!S.confirmLeave) { S.confirmLeave = true; render(); return; }
  var gid = S.gid;
  store.removeMember(gid).then(function () {
    S.profile.groups = (S.profile.groups || []).filter(function (x) { return x !== gid; });
    return saveProfile();
  }).then(function () {
    if (unsubGroup) { unsubGroup(); unsubGroup = null; }
    S.gid = null; go('home'); toast('You left the challenge.');
  }).catch(fail);
}

function copyCode() {
  var g = cur();
  if (!g) return;
  var done = function () { toast('Code ' + g.code + ' copied.'); };
  var legacy = function () {
    var ok = false;
    try {
      var ta = document.createElement('textarea');
      ta.value = g.code; ta.setAttribute('readonly', '');
      ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0;font-size:16px';
      document.body.appendChild(ta); ta.focus(); ta.select(); ta.setSelectionRange(0, 99);
      ok = document.execCommand('copy');
      document.body.removeChild(ta);
    } catch (e) {}
    if (ok) { done(); return; }
    var el = document.getElementById('codeText');
    if (el) { var r = document.createRange(); r.selectNodeContents(el); var sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(r); }
    toast('Copying is blocked here. The code is selected, so press and hold or use Ctrl C.');
  };
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(g.code).then(done, legacy);
    else legacy();
  } catch (e) { legacy(); }
}

/* ---------- events ---------- */
document.addEventListener('click', function (e) {
  if (e.target === sheetWrap) { closeSheet(); return; }
  var el = e.target.closest('[data-act]');
  if (!el) return;
  var act = el.getAttribute('data-act'), v = el.getAttribute('data-v'), i = +el.getAttribute('data-i');
  if (act === 'menu') { openMenu(); return; }
  closeMenu();
  if (act === 'menuClose') return;
  if (SERVER && SERVER_GO[act]) { location.href = SERVER_GO[act]; return; }
  if (act !== 'leave') S.confirmLeave = false;
  switch (act) {
    case 'home':
      if (unsubGroup) { unsubGroup(); unsubGroup = null; }
      S.gid = null; afterAuth = null; go('home'); break;
    case 'new': needAuth(function () { newForm('', 14); }); break;
    case 'tpl': (function (nm, ln) { needAuth(function () { newForm(nm, ln); }); })(el.getAttribute('data-name'), +v); break;
    case 'signup': case 'login':
      if (!A) A = { name: store.suggestedName || '', email: '', pass: '' };
      go(act); break;
    case 'logout':
      S.profile.signedIn = false;
      saveProfile().then(function () { go('home'); toast('Logged out.'); }).catch(fail);
      break;
    case 'page': go(v); break;

    case 'scroll':
      var sec = document.getElementById(v);
      if (sec) sec.scrollIntoView({ behavior: 'smooth', block: 'start' });
      break;
    case 'acc':
      var item = el.parentNode, group = item.parentNode;
      Array.prototype.forEach.call(group.children, function (c) {
        var on = c === item;
        c.classList.toggle('open', on);
        c.querySelector('.acc-btn').setAttribute('aria-expanded', on);
      });
      break;
    case 'join': needAuth(joinForm); break;
    case 'open': openGroup(el.getAttribute('data-id')); break;
    case 'tab': S.tab = v; S.err = ''; R = null; render(); break;
    case 'saveRecords': saveRecords(); break;
    case 'len': F.len = +v; if (F.len === 0 && !F.end) F.end = addDays(today(), 20); render(); break;
    case 'cap': F.cap = +v; render(); break;
    case 'addAct': F.acts.push({ name: '', points: 10, kind: 'time' }); render();
      var rows = app.querySelectorAll('[data-f="act-name"]'); if (rows.length) rows[rows.length - 1].focus(); break;
    case 'rmAct': F.acts.splice(i, 1); render(); break;
    case 'log': openSheet(); break;
    case 'closeSheet': closeSheet(); break;
    case 'pickAct': keepNote(); L.act = i; L.err = ''; renderSheet(); break;
    case 'pickWhen': keepNote(); L.date = v; L.err = ''; renderSheet(); break;
    case 'submitLog': submitLog(); break;
    case 'delLog': store.deleteLog(S.gid, el.getAttribute('data-id')).then(function () { toast('Workout removed.'); }).catch(fail); break;
    case 'copy': copyCode(); break;
    case 'leave': leave(); break;
  }
});
document.addEventListener('input', function (e) {
  var t = e.target, f = t.getAttribute && t.getAttribute('data-f'), j = t.getAttribute && t.getAttribute('data-j');
  if (f && F) {
    if (f === 'act-name') F.acts[+t.getAttribute('data-i')].name = t.value;
    else if (f === 'act-points') F.acts[+t.getAttribute('data-i')].points = t.value;
    else if (f === 'act-rate') F.acts[+t.getAttribute('data-i')].rate = t.value;
    else if (f === 'act-on') F.acts[+t.getAttribute('data-i')].on = t.checked;
    else if (f.indexOf('act-') !== 0) F[f] = t.value;
    if (f === 'end') render();
  }
  if (j && J) J[j] = t.value;
  var lk = t.getAttribute && t.getAttribute('data-l');
  if (lk && L) { L[lk] = t.value; var pv = document.getElementById('l-prev'); if (pv) pv.innerHTML = sheetPreview(); }
  var rk = t.getAttribute && t.getAttribute('data-r');
  if (rk && R) { var parts = rk.split('|'); (R[parts[0]] = R[parts[0]] || {})[parts[1]] = t.value; }
  var a = t.getAttribute && t.getAttribute('data-a');
  if (a && A) A[a] = t.value;
});
document.addEventListener('submit', function (e) {
  e.preventDefault();
  if (e.target.id === 'createForm') submitCreate();
  if (e.target.id === 'joinForm') submitJoin();
  if (e.target.id === 'authForm') submitAuth();
});
document.addEventListener('keydown', function (e) {
  if (e.key === 'Escape' && L) closeSheet();
  if (e.key === 'Escape') closeMenu();
});

/* ---------- start ---------- */
initStore().then(function (s) {
  store = s;
  return store.loadProfile().catch(function () { return null; });
}).then(function (p) {
  if (p) S.profile = { nick: p.nick || '', groups: Array.isArray(p.groups) ? p.groups : [], name: p.name || '', email: p.email || '', signedIn: !!p.signedIn, records: (p.records && typeof p.records === 'object') ? p.records : {} };
  go(MULTI ? (FILES[OW_PAGE] ? OW_PAGE : 'home') : viewFromHash(), true);
  store.watchGroups(function (list) {
    if (!list) return;
    S.groups = list;
    if (S.view === 'home') { var box = document.getElementById('myCh'); if (box) box.innerHTML = chCards(); else render(); }
    else if (S.view === 'group') render();
  });
});
})();
