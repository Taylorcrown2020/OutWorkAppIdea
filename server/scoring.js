'use strict';
/* ==========================================================================
   SCORING. The server is the only place points are calculated.

   1. The work.      Distance: miles (or yards, meters) x the category rate.
                     Strength: every rep, scaled by how heavy it is next to your 1 rep max.
                     Bodyweight moves (pull ups, push ups): every rep counts in full.
   2. Effort bonus.  Up to +50% of the work, by how close the workout is to your best:
                     distance: your pace against your PR pace for that sport.
                     strength: the 1 rep max a set works out to, against your 1 rep max.
                     bodyweight: reps in a set against your most reps in a set.
                     Nothing below 50% of your best. From there it climbs evenly to the full bonus at 100%.
   3. Records.       Beat your PR pace or your 1 rep max: +PR_POINTS.
                     Go farther than your longest logged workout in that sport: +FAR_POINTS.
                     More reps in a set than you have logged for that lift: +REP_POINTS.
                     At most RECORD_CAP record points per workout. A first workout sets the mark and earns none.
   4. Streak.        Points for each day in a row.

   Tested or estimated. A player's best can be one they have tested (a mile time, a true 1 rep max) or one
   estimated from another effort (a marathon time, a set of 5). A tested best always wins over an estimate.
   Distance estimates use Riegel's formula: time x (test distance / distance) ^ fade.

   PRs typed into the profile set the pace and 1 rep max marks only. They are not workouts:
   the longest distance and the rep record come only from logged workouts.
   ========================================================================== */
/* per: the unit the rate and the pace are measured in. test: the distance the sport's PR is measured over.
   bench: the shortest workout that can set a pace PR. fade: how much pace drops as distance grows (Riegel). */
const CATS = {
  run:  { label: 'Run',          type: 'dist', unit: 'mi', units: 'miles',  per: 1,   perLabel: 'mile',       rate: 10, max: 200,    bench: 1,   test: 1,   fade: 1.06, prName: 'Fastest mile' },
  walk: { label: 'Walk or hike', type: 'dist', unit: 'mi', units: 'miles',  per: 1,   perLabel: 'mile',       rate: 7,  max: 100,    bench: 1,   test: 1,   fade: 1.06, prName: 'Fastest mile' },
  ride: { label: 'Ride',         type: 'dist', unit: 'mi', units: 'miles',  per: 1,   perLabel: 'mile',       rate: 4,  max: 400,    bench: 10,  test: 10,  fade: 1.05, prName: 'Best average speed over 10 miles', speed: true },
  swim: { label: 'Swim',         type: 'dist', unit: 'yd', units: 'yards',  per: 100, perLabel: '100 yards',  rate: 2,  max: 40000,  bench: 100, test: 100, fade: 1.06, prName: 'Fastest 100 yards' },
  row:  { label: 'Row',          type: 'dist', unit: 'm',  units: 'meters', per: 500, perLabel: '500 meters', rate: 2,  max: 100000, bench: 500, test: 500, fade: 1.07, prName: 'Fastest 500 meters' },
  lift: { label: 'Strength',     type: 'lift', perLabel: 'rep at your 1 rep max', rate: 1 }
};
const CAT_ORDER = ['run', 'walk', 'ride', 'swim', 'row', 'lift'];

/* body: scored on reps alone, against the most reps the player has done in one set. */
const EXERCISES = {
  squat:     { name: 'Squat' },
  bench:     { name: 'Bench press' },
  dead:      { name: 'Deadlift' },
  ohp:       { name: 'Overhead press' },
  brow:      { name: 'Barbell row' },
  legpress:  { name: 'Leg press' },
  lunge:     { name: 'Lunge' },
  hipthrust: { name: 'Hip thrust' },
  pulldown:  { name: 'Lat pulldown' },
  curl:      { name: 'Curl' },
  pullup:    { name: 'Pull up', body: true },
  chinup:    { name: 'Chin up', body: true },
  pushup:    { name: 'Push up', body: true },
  dip:       { name: 'Dip', body: true },
  situp:     { name: 'Sit up', body: true }
};
const EX_ORDER = Object.keys(EXERCISES);
const MAX_LIFT_ROWS = 8;

const EFFORT_BONUS = 0.5;   // up to +50% of the work
const EFFORT_FLOOR = 0.5;   // nothing below 50% of your best
const PR_POINTS = 10;       // new PR pace, new 1 rep max, most bodyweight reps
const FAR_POINTS = 10;      // longest distance yet
const REP_POINTS = 5;       // most reps in a set yet, weighted lifts
const RECORD_CAP = 30;      // most record points one workout can earn
const FAR_MARGIN = 1.05;    // a distance record has to beat the old one by 5%
const STREAK_STEP = 2;
const STREAK_CAP = 10;

const num = (v) => { const n = parseFloat(String(v == null ? '' : v).replace(',', '.')); return Number.isFinite(n) && n > 0 ? n : 0; };
const clamp01 = (x) => Math.max(0, Math.min(1, x));
/* How much of the effort bonus a workout earns: 0 at half your best or less, 1 at your best. */
const effortShare = (ratio) => clamp01((ratio - EFFORT_FLOOR) / (1 - EFFORT_FLOOR));
/* Estimated 1 rep max from a set (Epley). 225 x 5 works out to 262.5. Reps past 12 stop adding. */
const oneRepMax = (w, reps) => (reps <= 1 ? w : w * (1 + Math.min(reps, 12) / 30));

/* The pace (minutes per `per`) a player would hold over the sport's test distance, estimated from another effort.
   A 3:30 marathon works out to about a 6:35 mile. */
function estimatePace(cat, dist, mins) {
  const c = CATS[cat];
  return mins * Math.pow(c.test / dist, c.fade) / (c.test / c.per);
}
/* A player's distance marks: { pace, actual, est: { dist, mins, pace }, far }.
   actual: tested (or logged) PR pace. est: an estimate and the effort it came from. pace: the one in use, actual first.
   Older records held one effort as { dist, mins, pace }: at the test distance that is a tested PR, at any other it becomes the estimate. */
function distRec(cat, data) {
  const c = CATS[cat], d = Object.assign({}, data || {});
  if (d.actual === undefined && d.est === undefined && d.pace) {
    const at = d.dist || c.per;
    if (Math.abs(at - c.per) < c.per * 0.01 || Math.abs(at - c.test) < c.test * 0.01 || !(d.mins > 0)) d.actual = d.pace;
    else d.est = { dist: at, mins: d.mins, pace: estimatePace(cat, at, d.mins) };
  }
  const out = { far: d.far || 0 };
  if (d.actual) out.actual = d.actual;
  if (d.est && d.est.pace) out.est = d.est;
  out.pace = out.actual || (out.est ? out.est.pace : 0);
  return out;
}

// Times arrive as "42:30" or "1:05:00". Returns minutes, or 0 if unreadable.
function parseTime(v) {
  const t = String(v == null ? '' : v).trim();
  if (!t) return 0;
  const p = t.split(':').map(Number);
  if (p.length > 3 || p.some((x) => !Number.isFinite(x) || x < 0)) return 0;
  if (p.length === 1) return p[0];
  if (p.length === 2) return p[0] + p[1] / 60;
  return p[0] * 60 + p[1] + p[2] / 60;
}

/* A player's strength marks: { ex: { squat: { name, orm, act, est, w, r, best, reps } } }.
   act: a tested 1 rep max. est: one estimated from the set w x r. orm: the one in use, tested first.
   best: most bodyweight reps in a set. reps: most reps logged in a set.
   Older accounts stored { squat, bench, dead } as plain weights, or orm with the set it came from. */
function liftRec(data) {
  const d = data || {}, ex = {};
  if (d.ex) {
    Object.assign(ex, JSON.parse(JSON.stringify(d.ex)));
    for (const k of Object.keys(ex)) {
      const m = ex[k];
      if (m.orm && !m.act && !m.est) { if ((m.r || 1) <= 1) m.act = m.orm; else m.est = m.orm; }
    }
  } else for (const k of ['squat', 'bench', 'dead']) if (num(d[k])) ex[k] = { orm: num(d[k]), act: num(d[k]) };
  return { ex };
}
/* The key and name for what was picked: a listed exercise, or one the player named. */
function readExercise(ex, name) {
  if (EXERCISES[ex]) return { k: ex, name: EXERCISES[ex].name, body: !!EXERCISES[ex].body };
  const clean = String(name == null ? '' : name).replace(/[^\p{L}\p{N} '\-]/gu, '').replace(/\s+/g, ' ').trim().slice(0, 30);
  if ((ex === 'other' || /^x_/.test(String(ex || ''))) && clean.length >= 2) return { k: 'x_' + clean.toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 30), name: clean, body: false, custom: true };
  return null;
}

/* Checks and normalises what a player typed. Returns { error } or { m } (plus prs for strength). */
function readWorkout(cat, body, savedPrs) {
  const c = CATS[cat];
  if (!c) return { error: 'Pick a workout category.' };
  if (c.type === 'dist') {
    const dist = num(body.dist), mins = parseTime(body.time);
    if (!(dist > 0 && dist <= c.max)) return { error: `Enter the distance in ${c.units}.` };
    if (!(mins > 0 && mins <= 1440)) return { error: 'Enter your time.' };
    return { m: { dist, mins } };
  }
  const rec = liftRec(savedPrs), lifts = [];
  // Rows come as a list: [{ ex, name, sets, reps, w }]. The older shape { squat: { sets, reps, w, pr } } still works.
  const rows = Array.isArray(body.lifts) ? body.lifts
    : Object.keys(body.lifts || {}).map((k) => Object.assign({ ex: k }, (body.lifts || {})[k]));
  if (rows.length > 20) return { error: 'That is too many exercises for one workout.' };
  for (const row of rows) {
    const r = row || {};
    const sets = Math.round(num(r.sets)), reps = Math.round(num(r.reps)), w = num(r.w), pr = num(r.pr);
    if (!sets && !reps && !w) { const e0 = readExercise(r.ex, r.name); if (e0 && pr) (rec.ex[e0.k] = rec.ex[e0.k] || {}).orm = Math.min(pr, 2000); continue; }
    const e = readExercise(r.ex, r.name);
    if (!e) return { error: r.ex === 'other' ? 'Type the name of the exercise.' : 'Pick the exercise.' };
    if (e.custom && !w) e.body = true;   // a named exercise with no weight is scored as bodyweight
    if (pr && !e.body) (rec.ex[e.k] = rec.ex[e.k] || {}).orm = Math.min(pr, 2000);
    if (!(sets >= 1 && sets <= 20 && reps >= 1 && reps <= 100)) return { error: `Fill in sets and reps for ${e.name}.` };
    if (!e.body && !(w >= 1 && w <= 2000)) return { error: `Enter the weight for ${e.name}.` };
    lifts.push({ k: e.k, name: e.name, sets, reps, w: e.body ? 0 : w, body: e.body });
  }
  if (!lifts.length) return { error: 'Enter sets and reps for at least one exercise.' };
  if (lifts.length > MAX_LIFT_ROWS) return { error: `Log up to ${MAX_LIFT_ROWS} exercises in one workout.` };
  return { m: { lifts }, prs: rec };
}

/* A logged set that works out higher than the player's max becomes their max: tested if it was a single, estimated if not. */
function setMax(mark, l, est) {
  mark.orm = est;
  if (l.reps <= 1) { mark.act = l.w; }
  else { mark.est = est; mark.w = l.w; mark.r = l.reps; delete mark.act; }
}

/* Scores one workout against the player's marks.
   Distance rec: { pace, far }          pace: minutes per unit at the PR. far: longest logged distance.
   Strength rec: see liftRec.
   Returns base (the work), perf (effort bonus), bonuses (records, with points), the updated rec, and rows for display. */
function scoreWorkout(rate, cat, m, rec) {
  const c = CATS[cat];
  const out = { base: 0, perf: 0, prs: [], bonuses: [], rows: [], pace: 0, ratio: 0, rec: null };
  const record = (label, pts) => out.bonuses.push({ label, pts });
  if (c.type === 'dist') {
    rec = distRec(cat, rec);
    const amount = m.dist / c.per, pace = m.mins / amount, counts = m.dist >= c.bench * 0.999;
    out.pace = pace;
    out.base = Math.round(rate * amount);
    out.hasPr = !!rec.pace;
    out.ratio = rec.pace ? Math.min(1, rec.pace / pace) : 0;
    out.perf = Math.round(rate * amount * EFFORT_BONUS * effortShare(out.ratio));
    out.estimated = !!rec.pace && !rec.actual;
    const next = Object.assign({}, rec);
    if (counts && (!rec.pace || pace < rec.pace * 0.999)) {
      if (rec.pace) record('Fastest pace', PR_POINTS);      // with no PR saved, this workout just sets it
      else out.setsPr = true;
      next.actual = pace; next.pace = pace;                 // a pace held over the test distance or longer is a real mark, not an estimate
    }
    if (rec.far && m.dist >= rec.far * FAR_MARGIN) record('Longest ' + c.label.toLowerCase().replace(' or hike', ''), FAR_POINTS);
    out.far = rec.far || 0;
    next.far = Math.max(rec.far || 0, m.dist);
    out.rec = next;
  } else {
    const r = liftRec(rec);
    for (const l of m.lifts) {
      const mark = r.ex[l.k] = r.ex[l.k] || {};
      if (l.name) mark.name = l.name;
      const row = { k: l.k, name: l.name || (EXERCISES[l.k] || {}).name || l.k, sets: l.sets, reps: l.reps, w: l.w, body: !!l.body };
      let load = 1, effort = 0;
      if (l.body) {
        if (mark.best) {
          effort = Math.min(1, l.reps / mark.best);
          if (l.reps > mark.best) { record(row.name + ' reps in a set', PR_POINTS); mark.best = l.reps; }
        } else { mark.best = l.reps; row.setsPr = true; }
        l.q = true;
      } else {
        const est = oneRepMax(l.w, l.reps);
        if (mark.orm) {
          load = Math.min(1, l.w / mark.orm);
          effort = Math.min(1, est / mark.orm);
          if (est > mark.orm * 1.001) { record(row.name + ' 1 rep max', PR_POINTS); setMax(mark, l, est); }
        } else {                                              // no max saved: this set works it out, with no bonus yet
          load = l.w / est; setMax(mark, l, est); row.setsPr = true;
        }
        l.q = l.w >= mark.orm * EFFORT_FLOOR;                 // light sets do not count toward the rep record
        if (l.q) {
          if (mark.reps && l.reps > mark.reps) record(row.name + ' reps in a set', REP_POINTS);
          mark.reps = Math.max(mark.reps || 0, l.reps);
        }
        row.orm = mark.orm; row.estimated = !mark.act;
      }
      row.pts = Math.round(rate * l.sets * l.reps * load);
      row.bonus = Math.round(rate * l.sets * l.reps * load * EFFORT_BONUS * effortShare(effort));
      row.pct = Math.round(load * 100); row.effort = Math.round(effort * 100);
      out.base += row.pts; out.perf += row.bonus;
      out.rows.push(row);
    }
    out.rec = r;
  }
  // Record points are capped for the workout. The cap comes off the last ones listed.
  let left = RECORD_CAP;
  for (const b of out.bonuses) { b.pts = Math.min(b.pts, left); left -= b.pts; }
  out.bonuses = out.bonuses.filter((b) => b.pts > 0);
  out.prs = out.bonuses.map((b) => b.label);
  out.prPts = out.bonuses.reduce((n, b) => n + b.pts, 0);
  out.total = out.base + out.perf + out.prPts;
  return out;
}

const streakPts = (run) => Math.min(STREAK_CAP, Math.max(0, run - 1) * STREAK_STEP);
const dayNum = (s) => Math.round(Date.parse(s + 'T00:00:00Z') / 86400000);
const dayStr = (n) => new Date(n * 86400000).toISOString().slice(0, 10);
const todayStr = () => new Date().toISOString().slice(0, 10);

/* days: { 'YYYY-MM-DD': workoutPoints }. Returns the streak bonus earned on each day. */
function streakByDay(days) {
  const out = {};
  let run = 0, prev = null;
  for (const d of Object.keys(days).sort()) {
    run = prev !== null && dayNum(d) - prev === 1 ? run + 1 : 1;
    out[d] = streakPts(run);
    prev = dayNum(d);
  }
  return out;
}
function streakOn(days, date) { let n = 0, d = dayNum(date); while (days[dayStr(d)] !== undefined) { n++; d--; } return n; }
function currentStreak(days) { const t = todayStr(); return days[t] !== undefined ? streakOn(days, t) : streakOn(days, dayStr(dayNum(t) - 1)); }

module.exports = { CATS, CAT_ORDER, EXERCISES, EX_ORDER, MAX_LIFT_ROWS, EFFORT_BONUS, EFFORT_FLOOR, PR_POINTS, FAR_POINTS, REP_POINTS, RECORD_CAP, FAR_MARGIN, STREAK_STEP, STREAK_CAP,
  num, parseTime, oneRepMax, effortShare, estimatePace, distRec, liftRec, readExercise, readWorkout, scoreWorkout,
  streakPts, streakByDay, streakOn, currentStreak, dayNum, dayStr, todayStr };
