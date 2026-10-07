'use strict';
/* ==========================================================================
   SCORING. The server is the only place points are calculated.
   1. The work.   Distance: miles (or yards, meters) x the category rate.
                  Strength: every rep, scaled by how heavy it is next to your PR.
   2. Pace bonus. Up to +50% on distance workouts, by how close you are to your
                  PR pace. Beating a PR (pace or lift) adds PR_POINTS.
   3. Streak.     Points for each day in a row.
   ========================================================================== */
const CATS = {
  run:  { label: 'Run',          type: 'dist', unit: 'mi', units: 'miles',  per: 1,   perLabel: 'mile',       rate: 10, max: 200 },
  walk: { label: 'Walk or hike', type: 'dist', unit: 'mi', units: 'miles',  per: 1,   perLabel: 'mile',       rate: 7,  max: 100 },
  ride: { label: 'Ride',         type: 'dist', unit: 'mi', units: 'miles',  per: 1,   perLabel: 'mile',       rate: 4,  max: 400 },
  swim: { label: 'Swim',         type: 'dist', unit: 'yd', units: 'yards',  per: 100, perLabel: '100 yards',  rate: 2,  max: 40000 },
  row:  { label: 'Row',          type: 'dist', unit: 'm',  units: 'meters', per: 500, perLabel: '500 meters', rate: 2,  max: 100000 },
  lift: { label: 'Strength',     type: 'lift', perLabel: 'rep at your PR weight', rate: 1 }
};
const CAT_ORDER = ['run', 'walk', 'ride', 'swim', 'row', 'lift'];
const LIFTS = { squat: 'Squat', bench: 'Bench', dead: 'Deadlift' };

const PACE_BONUS = 0.5;
const PR_POINTS = 10;
const STREAK_STEP = 2;
const STREAK_CAP = 10;

const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) && n > 0 ? n : 0; };

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

/* Checks and normalises what a player typed. Returns { error } or { m }. */
function readWorkout(cat, body, savedPrs) {
  const c = CATS[cat];
  if (!c) return { error: 'Pick a workout category.' };
  if (c.type === 'dist') {
    const dist = num(body.dist), mins = parseTime(body.time);
    if (!(dist > 0 && dist <= c.max)) return { error: `Enter the distance in ${c.units}.` };
    if (!(mins > 0 && mins <= 1440)) return { error: 'Enter your time, like 42:30.' };
    return { m: { dist, mins } };
  }
  const lifts = [], prs = Object.assign({}, savedPrs || {});
  for (const k of Object.keys(LIFTS)) {
    const row = (body.lifts || {})[k] || {};
    const sets = Math.round(num(row.sets)), reps = Math.round(num(row.reps)), w = num(row.w), pr = num(row.pr);
    if (pr) prs[k] = Math.min(pr, 2000);
    if (!sets && !reps && !w) continue;
    if (!(sets >= 1 && sets <= 20 && reps >= 1 && reps <= 100 && w >= 1 && w <= 2000)) return { error: `Fill in sets, reps and weight for ${LIFTS[k]}.` };
    if (!prs[k]) return { error: `Add your ${LIFTS[k].toLowerCase()} PR so the reps can be scored.` };
    lifts.push({ k, sets, reps, w });
  }
  if (!lifts.length) return { error: 'Enter sets, reps and weight for at least one lift.' };
  return { m: { lifts }, prs };
}

/* Scores one workout against the player's PRs.
   Distance rec: { dist, mins, pace }   Strength rec: { squat, bench, dead } */
function scoreWorkout(rate, cat, m, rec) {
  const c = CATS[cat];
  rec = rec || {};
  const out = { base: 0, perf: 0, prs: [], rows: [], pace: 0, rec: null };
  if (c.type === 'dist') {
    const amount = m.dist / c.per, pace = m.mins / amount;
    out.pace = pace;
    out.base = Math.round(rate * amount);
    const ratio = rec.pace ? Math.min(1, rec.pace / pace) : 0;
    out.perf = Math.round(rate * amount * PACE_BONUS * ratio);
    out.hasPr = !!rec.pace;
    out.rec = { dist: rec.dist || 0, mins: rec.mins || 0, pace: rec.pace || 0 };
    if (!rec.pace) out.rec = { dist: m.dist, mins: m.mins, pace };                       // no PR saved: this workout sets it
    else if (pace < rec.pace * 0.999 && m.dist >= (rec.dist || 0) * 0.999) {             // faster, over at least the PR distance
      out.prs.push('Pace'); out.rec = { dist: m.dist, mins: m.mins, pace };
    }
  } else {
    out.rec = { squat: rec.squat || 0, bench: rec.bench || 0, dead: rec.dead || 0 };
    for (const l of m.lifts) {
      const pr = rec[l.k] || l.w, ratio = Math.min(1, l.w / pr);
      const pts = Math.round(rate * l.sets * l.reps * ratio);
      out.base += pts;
      out.rows.push({ k: l.k, name: LIFTS[l.k], sets: l.sets, reps: l.reps, w: l.w, pct: Math.round(ratio * 100), pts });
      if (rec[l.k] && l.w > rec[l.k] * 1.001) out.prs.push(LIFTS[l.k]);
      out.rec[l.k] = Math.max(out.rec[l.k], l.w);
    }
  }
  out.prPts = out.prs.length * PR_POINTS;
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

module.exports = { CATS, CAT_ORDER, LIFTS, PACE_BONUS, PR_POINTS, STREAK_STEP, STREAK_CAP, num, parseTime, readWorkout, scoreWorkout,
  streakPts, streakByDay, streakOn, currentStreak, dayNum, dayStr, todayStr };
