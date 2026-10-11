/* Family Quest Board v2 — domain logic (no DOM): points, quests, streaks, groceries,
   calendar expansion, to-dos, dinner, countdowns. Ported from v1 so behaviour matches. */
'use strict';

/* ---------- points ---------- */
function balance(name) {
  let approved = 0, pending = 0;
  for (const k of (S.state.queue || [])) {
    if (k.member !== name) continue;
    const p = parseInt(k.points || '0', 10) || 0;
    if (k.status === 'approved') approved += p; else if (k.status === 'pending' && p > 0) pending += p;
  }
  return { approved, pending };
}
function recentDecisions() {
  return (S.state.queue || []).filter(k => k.status === 'approved' || k.status === 'rejected')
    .sort((a, b) => (b.reviewed_at || b.submitted_at || '') < (a.reviewed_at || a.submitted_at || '') ? -1 : 1);
}

/* ---------- quests ---------- */
function everyDays(r) { const m = /^(?:every[:\s]*)?(\d+)(?:\s*days?)?$/i.exec(String(r || '').trim()); return m ? Math.max(1, +m[1]) : 0; }
const pendingEntry = (q, m) => (S.state.queue || []).find(k => k.type === 'quest' && k.ref_id === q.id && k.member === m && k.status === 'pending');
const helpAsked = (q, m) => (S.state.queue || []).some(k => k.type === 'help' && k.ref_id === q.id && k.member === m && k.status === 'pending');
const questOn = (q) => q.title && (q.active === '' || q.active === undefined || isTrue(q.active));
function questStatus(quest, memberName) {
  const monday = isTrue(cfg('week_starts_monday', 'TRUE')), now = new Date();
  const period = (quest.repeat || 'daily').toLowerCase();
  for (const k of (S.state.queue || [])) {
    if (k.type !== 'quest' || k.ref_id !== quest.id || k.member !== memberName || k.status === 'rejected' || k.status === 'undone') continue;
    const t = toDate(k.submitted_at); let same = true;
    if (period === 'daily' || period === 'weekdays') same = dayKey(t) === dayKey(now);
    else if (period === 'weekly') same = weekKey(t, monday) === weekKey(now, monday);
    else if (period === 'biweekly') same = (now - t) < 14 * 86400000;
    else if (period === 'monthly') same = t.getFullYear() === now.getFullYear() && t.getMonth() === now.getMonth();
    else if (everyDays(period)) { const d0 = startOfDay(t), d1 = startOfDay(now); same = Math.round((d1 - d0) / 86400000) < everyDays(period); }
    if (same) return k.status === 'pending' ? 'pending' : 'done';
  }
  return 'available';
}
function kidQuests(member) {
  return (S.state.quests || []).filter(questOn)
    .filter(q => { const a = (q.assigned_to || 'Anyone').trim().toLowerCase(); return a === 'anyone' || a === '' || a.split(',').map(s => s.trim()).includes(member.toLowerCase()); });
}
const QREPEATS = [['once', 'One time'], ['daily', 'Every day'], ['weekdays', 'School days (Mon–Fri)'], ['weekly', 'Weekly'], ['biweekly', 'Every 2 weeks'], ['monthly', 'Monthly']];
const QHINTS = { once: 'Disappears for that kid after it’s approved once.', daily: 'Comes back every morning.', weekdays: 'Comes back every morning, hidden on Saturday and Sunday.', weekly: 'Can be done once per week.', biweekly: 'Can be done again 14 days after the last time.', monthly: 'Can be done once per calendar month.' };
const questRepeatLabel = (r) => { const n = everyDays(r); if (n) return n === 1 ? 'Every day' : `Every ${n} days`; const f = QREPEATS.find(x => x[0] === String(r || 'daily').toLowerCase()); return f ? f[1] : String(r); };
const questOpts = (q) => (X.get('questOpts', {})[q.id] || {});

/* ---------- streaks ---------- */
const streakCfg = () => Object.assign({ milestones: [{ n: 7, off: 10 }, { n: 14, off: 25 }], shield: true, pauses: [] }, X.get('streak', {}));
const epochDay = (d) => Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86400000);
function periodKey(rep, d) {
  const n = everyDays(rep);
  if (n) return 'e' + Math.floor(epochDay(d) / n);
  if (rep === 'weekly') return 'w' + weekKey(d, isTrue(cfg('week_starts_monday', 'TRUE')));
  if (rep === 'biweekly') return 'b' + Math.floor(epochDay(d) / 14);
  if (rep === 'monthly') return 'm' + d.getFullYear() + '-' + d.getMonth();
  return dayKey(d);
}
function periodLen(rep) { const n = everyDays(rep); return n || ({ weekly: 7, biweekly: 14, monthly: 30 }[rep] || 1); }
function stepBack(rep, d) {
  const n = everyDays(rep);
  if (n) return addDays(d, -n);
  if (rep === 'weekly') return addDays(d, -7);
  if (rep === 'biweekly') return addDays(d, -14);
  if (rep === 'monthly') return new Date(d.getFullYear(), d.getMonth() - 1, Math.min(d.getDate(), 28));
  return addDays(d, -1);
}
function isPausedDay(d) { const k = dayKey(d), today = dayKey(new Date()); return (streakCfg().pauses || []).some(p => p.from && p.from <= k && k <= (p.to || today)); }
function questStreak(q, member) {
  const rep = String(q.repeat || 'daily').toLowerCase();
  if (rep === 'once') return { cur: 0, start: null };
  const done = new Set(); let earliest = null;
  for (const k of (S.state.queue || [])) {
    if (k.type !== 'quest' || k.ref_id !== q.id || k.member !== member || k.status === 'rejected' || k.status === 'undone') continue;
    const t = toDate(k.submitted_at); done.add(periodKey(rep, t)); if (!earliest || t < earliest) earliest = t;
  }
  if (!earliest) return { cur: 0, start: null };
  const c = streakCfg(), shieldOK = c.shield && periodLen(rep) <= 3, stop = startOfDay(earliest);
  let d = startOfDay(new Date()), count = 0, start = null, first = true, lastShield = null, guard = 0;
  while (guard++ < 500 && d >= stop) {
    if (rep === 'weekdays' && (d.getDay() === 0 || d.getDay() === 6)) { d = addDays(d, -1); continue; }
    if (isPausedDay(d)) { d = stepBack(rep, d); first = false; continue; }
    const key = periodKey(rep, d);
    if (done.has(key)) { count++; start = key; }
    else if (first) { /* current period not over yet */ }
    else if (shieldOK && (lastShield === null || (lastShield - d) / 86400000 >= 7)) { lastShield = d; }
    else break;
    first = false; d = stepBack(rep, d);
  }
  return { cur: count, start };
}
const bestKey = (m, q) => m + '|' + q;
const bestStreak = (m, q) => +(X.get('bests', {})[bestKey(m, q)] || 0);
const questStreakOpt = (q) => (questOpts(q).streak) || { mode: 'default', milestones: [] };
function milestonesFor(q) {
  const o = questStreakOpt(q);
  if (o.mode === 'off') return [];
  if (o.mode === 'custom') return (o.milestones || []).filter(m => m && +m.n > 0);
  return (streakCfg().milestones || []).map(m => ({ n: +m.n, type: 'coupon', value: +m.off, legacy: true }));
}
const prizeText = (m) => m.type === 'points' ? `+${m.value} bonus pts` : m.type === 'coupon' ? `🎟️ −${m.value} pts coupon` : `🏆 ${m.text || 'a prize'}`;
const prizeShort = (m) => m.type === 'points' ? `+${m.value} pts` : m.type === 'coupon' ? `🎟️ −${m.value}` : `🏆 ${m.text || 'prize'}`;
function nextPrize(q, cur) {
  let best = null;
  for (const m of milestonesFor(q)) { const n = +m.n, target = m.every ? (Math.floor(cur / n) + 1) * n : n; if (target <= cur) continue; if (!best || target < best.target) best = { target, m }; }
  return best;
}
const prizesFor = (member) => (X.get('prizes', []) || []).filter(p => p && (!member || p.member === member) && !p.given);
const couponsFor = (m) => (X.get('coupons', []) || []).filter(c => c && c.member === m && !c.used);
let awarding = false;
async function checkStreaks() {
  if (!S.state || awarding) return; awarding = true;
  try {
    const awarded = new Set(X.get('awarded', [])), bests = X.get('bests', {}), newBests = {};
    for (const kid of members('kid')) for (const q of kidQuests(kid.name)) {
      const s = questStreak(q, kid.name); if (!s.cur) continue;
      if (s.cur > (+bests[bestKey(kid.name, q.id)] || 0)) newBests[bestKey(kid.name, q.id)] = s.cur;
      for (const m of milestonesFor(q)) {
        const n = +m.n; if (s.cur < n) continue;
        const tier = m.every ? Math.floor(s.cur / n) : 1;
        const key = m.legacy ? `${kid.name}|${q.id}|${n}|${s.start}` : `${kid.name}|${q.id}|${n}|${m.type}|${m.value || m.text || ''}|${tier}|${s.start}`;
        if (awarded.has(key)) continue;
        const label = `🔥${m.every ? n * tier : n} × ${q.title}`, at = new Date().toISOString();
        const value = m.type === 'points' ? { id: xuid(), kind: 'points', member: kid.name, pts: +m.value, label, at }
          : m.type === 'prize' ? { id: xuid(), kind: 'prize', member: kid.name, text: m.text || 'a prize', label, at }
          : { id: xuid(), member: kid.name, off: +m.value, label, at };
        const changed = await X.op({ op: 'award', key, value });
        if (!changed) continue;
        awarded.add(key);
        if (m.type === 'points') { try { await api('/api/do', { action: 'adjustPoints', member: kid.name, points: +m.value, reason: `Streak bonus ${label}`, pin: cfg('pin', '') }); } catch (_) {} toast(`🔥 ${kid.name}: ${label} — +${m.value} bonus points!`); }
        else if (m.type === 'prize') toast(`🏆 ${kid.name} earned: ${m.text} (${label})`);
        else toast(`🎟️ ${kid.name} earned a coupon: −${m.value} pts (${label})`);
        api('/api/notify', { kind: 'streak', title: `🔥 ${kid.name} hit a streak!`, message: `${label} → ${prizeText(m)}` }).catch(() => {});
      }
    }
    if (Object.keys(newBests).length) await X.merge('bests', newBests);
  } catch (e) { console.warn('streak check failed', e); }
  awarding = false;
}
/* streak-locked rewards */
function lockStatus(r, member) {
  const lock = X.get('locks', {})[r.id];
  if (!lock) return { locked: false };
  let met = false, text = '';
  if (lock.type === 'quest') {
    const q = (S.state.quests || []).find(x => x.id === lock.quest); const cur = q ? questStreak(q, member).cur : 0;
    met = cur >= lock.n; text = q ? `${esc(q.icon || '⭐')} ${esc(q.title)} 🔥${Math.min(cur, lock.n)}/${lock.n}` : 'quest removed';
  } else {
    const have = kidQuests(member).filter(q => (+q.points || 0) >= (+lock.min || 0) && questStreak(q, member).cur >= lock.n).length;
    met = have >= lock.count; text = `${Math.min(have, lock.count)} of ${lock.count} different quests at 🔥${lock.n}+`;
  }
  const key = member + '|' + r.id, stored = !!X.get('unlocked', {})[key];
  if (met && !stored) X.merge('unlocked', { [key]: new Date().toISOString() }).catch(() => {});
  return { locked: !(met || stored), text, unlockedNow: met || stored };
}
function lockLabel(lock) {
  if (!lock) return '';
  if (lock.type === 'quest') { const q = (S.state.quests || []).find(x => x.id === lock.quest); return `🔒 ${q ? q.title : 'a quest'} 🔥${lock.n} in a row`; }
  return `🔒 ${lock.count} different quests at 🔥${lock.n}+`;
}
function goalFor(member) {
  const rid = X.get('goals', {})[member]; if (!rid) return null;
  const r = (S.state.rewards || []).find(x => x.id === rid); if (!r) return null;
  const cps = couponsFor(member);
  const cost = Math.max(0, parseInt(r.cost || 0, 10) - (cps.length ? Math.max(...cps.map(c => +c.off || 0)) : 0));
  const have = balance(member).approved;
  return { r, cost, have, pct: cost ? Math.min(100, Math.round(have / cost * 100)) : 100 };
}
const goalBar = (g) => g ? `<div class="goal"><div class="gl">🎯 ${esc(g.r.icon || '🎁')} ${esc(g.r.title)} <b>${Math.min(g.have, g.cost)}/${g.cost}</b></div><div class="gb"><i style="width:${g.pct}%"></i></div></div>` : '';

/* ---------- groceries ---------- */
const gStatus = (g) => { const s = String(g.status || '').toLowerCase(); return s === 'needed' || s === 'true' ? 'needed' : s === 'cart' ? 'cart' : ''; };
const gLetter = (g) => { const c = (g.item || '').trim().charAt(0).toUpperCase(); return /[A-Z]/.test(c) ? c : '#'; };
const byName = (a, b) => a.item.localeCompare(b.item, undefined, { sensitivity: 'base' });
const storesOf = (g) => String(g.store || '').split(',').map(x => x.trim()).filter(Boolean);
const isNice = (g) => String(g.priority || '').toLowerCase() === 'nice';
const gRepeat = (g) => String(g.repeat || '').trim();
function groupByStore(items) {
  const map = {};
  items.forEach(g => { const st = storesOf(g)[0] || 'Any store', k = st.toLowerCase(); (map[k] = map[k] || { store: st, items: [] }).items.push(g); });
  const keys = Object.keys(map).sort((a, b) => a === 'any store' ? 1 : b === 'any store' ? -1 : a.localeCompare(b));
  return keys.map(k => { map[k].items.sort((a, b) => (isNice(a) ? 1 : 0) - (isNice(b) ? 1 : 0) || byName(a, b)); return map[k]; });
}
function allStores() {
  const seen = {}, out = [];
  (S.state.groceries || []).forEach(g => storesOf(g).forEach(x => { if (!seen[x.toLowerCase()]) { seen[x.toLowerCase()] = 1; out.push(x); } }));
  return out.sort((a, b) => a.localeCompare(b));
}

/* ---------- repeats / to-dos ---------- */
const REPEATS = [['', 'Doesn’t repeat'], ['daily', 'Daily'], ['weekly', 'Weekly'], ['biweekly', 'Every 2 weeks'], ['monthly', 'Monthly'], ['every:3', 'Every 3 days']];
function repeatLabel(r) {
  r = String(r || '').toLowerCase(); if (!r) return '';
  const f = REPEATS.find(x => x[0] === r); if (f) return f[1];
  if (r === 'yearly') return 'Yearly';
  if (r.startsWith('every:')) { const n = parseInt(r.slice(6), 10) || 1; return n === 1 ? 'Daily' : `Every ${n} days`; }
  return r;
}
function stepDue(fromKey, repeat) {
  const d = new Date(fromKey + 'T12:00:00'), r = String(repeat).toLowerCase();
  if (r === 'daily') d.setDate(d.getDate() + 1); else if (r === 'weekly') d.setDate(d.getDate() + 7); else if (r === 'biweekly') d.setDate(d.getDate() + 14);
  else if (r === 'monthly') d.setMonth(d.getMonth() + 1); else if (r === 'yearly') d.setFullYear(d.getFullYear() + 1);
  else if (r.startsWith('every:')) d.setDate(d.getDate() + Math.max(1, parseInt(r.slice(6), 10) || 1)); else d.setDate(d.getDate() + 7);
  return dayKey(d);
}
function nextDue(due, repeat) {
  const today = dayKey(new Date());
  let k = /^\d{4}-\d{2}-\d{2}$/.test(String(due)) && due >= today ? due : today;
  k = stepDue(k, repeat); let guard = 0; while (k <= today && guard++ < 400) k = stepDue(k, repeat);
  return k;
}
const tagList = (t) => String(t.tags || '').split(',').map(s => s.trim().replace(/^#/, '')).filter(Boolean);
const tagKey = (s) => s.toLowerCase();
function extractHashtags(text) { const tags = []; const clean = text.replace(/(^|\s)#([\w-]+)/g, (m, sp, tag) => { tags.push(tag); return sp; }).replace(/\s{2,}/g, ' ').trim(); return { clean, tags }; }
function dueLabel(due) {
  if (!due) return '';
  const today = dayKey(new Date()), tmr = dayKey(addDays(new Date(), 1));
  if (due === today) return 'Today'; if (due === tmr) return 'Tomorrow';
  const d = new Date(due + 'T12:00:00'), diff = Math.round((d - new Date(today + 'T12:00:00')) / 86400000);
  if (diff < 0) return `${-diff} day${diff === -1 ? '' : 's'} overdue`;
  if (diff < 7) return DAYS[d.getDay()];
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}
function todosOn(date) {
  const k = dayKey(date), today = dayKey(new Date()), out = [];
  for (const t of (S.state.todos || [])) {
    if (!t.task || isTrue(t.done) || !/^\d{4}-\d{2}-\d{2}$/.test(String(t.due || ''))) continue;
    if (t.due === k) { out.push(t); continue; }
    if (k === today && t.due < today) { out.push(t); continue; }
    if (t.repeat && t.due < k) { let d = t.due, g = 0; while (d < k && g++ < 120) d = stepDue(d, t.repeat); if (d === k) out.push(t); }
  }
  return out;
}
const subtasksOf = (t) => { try { const a = JSON.parse(t.subtasks || '[]'); return Array.isArray(a) ? a.filter(x => x && x.t) : []; } catch (_) { return []; } };

/* ---------- calendar ---------- */
function localEventsOn(date) {
  const k = dayKey(date), out = [];
  for (const ev of (S.state.local_events || [])) {
    if (!ev.title || !/^\d{4}-\d{2}-\d{2}$/.test(String(ev.date || ''))) continue;
    let hit = ev.date === k;
    if (!hit && ev.repeat && ev.date < k) { let d = ev.date, g = 0; while (d < k && g++ < 400) d = stepDue(d, ev.repeat); hit = d === k; }
    if (!hit) continue;
    const allDay = !ev.time, t = allDay ? '00:00' : ev.time;
    const start = new Date(k + 'T' + t + ':00'), end = new Date(start.getTime() + (allDay ? 86400000 : 3600000));
    const rem = String(ev.kind || '').toLowerCase() === 'reminder';
    out.push({ title: (rem ? '🔔 ' : '') + ev.title + (ev.who ? ' · ' + ev.who : ''), start: start.toISOString(), end: end.toISOString(), allDay, color: rem ? '#a78bfa' : '#fbbf24', local: true, id: ev.id, kind: rem ? 'reminder' : 'event' });
  }
  return out;
}
function eventsOn(date) {
  const k = dayKey(date);
  return (S.state.events || []).filter(ev => {
    const s = toDate(ev.start), e = toDate(ev.end);
    if (ev.allDay) { const endK = dayKey(new Date(e.getTime() - 1)); return dayKey(s) <= k && k <= endK; }
    return dayKey(s) === k;
  }).concat(localEventsOn(date)).sort((a, b) => (b.allDay ? 1 : 0) - (a.allDay ? 1 : 0) || (a.start < b.start ? -1 : 1));
}
function dinnerFor(date) { const k = dayKey(date); const row = (S.state.dinner || []).filter(d => String(d.date).slice(0, 10) === k).pop(); return row && row.meal ? row : null; }
const evKey = (ev) => (ev.title || '') + '|' + ev.start;
const claimOf = (ev) => X.get('claims', {})[evKey(ev)] || '';
const evTime = (ev) => ev.allDay ? 'All day' : `${fmtTime(toDate(ev.start))}–${fmtTime(toDate(ev.end))}`;

/* ---------- countdowns ---------- */
function countdowns() {
  const today = startOfDay(new Date()), out = [];
  for (const c of (X.get('countdowns', []) || [])) { if (!c || !c.date) continue; const d = new Date(c.date + 'T00:00:00'); if (d >= today) out.push({ title: c.title, emoji: c.emoji || '⏳', d, id: c.id }); }
  for (const ev of (S.state.events || [])) {
    if (!/⏳|#countdown/i.test(ev.title || '')) continue;
    const d = startOfDay(toDate(ev.start)); if (d < today) continue;
    const title = ev.title.replace(/#countdown/ig, '').replace('⏳', '').trim();
    if (!out.some(o => o.title === title && dayKey(o.d) === dayKey(d))) out.push({ title, emoji: '⏳', d });
  }
  return out.sort((a, b) => a.d - b.d).map(o => Object.assign(o, { days: Math.round((o.d - today) / 86400000) }));
}

/* ---------- weather ---------- */
const WMO = [[0, '☀️', 'Clear'], [1, '🌤️', 'Mostly clear'], [2, '⛅', 'Partly cloudy'], [3, '☁️', 'Overcast'], [45, '🌫️', 'Fog'], [48, '🌫️', 'Fog'],
  [51, '🌦️', 'Drizzle'], [53, '🌦️', 'Drizzle'], [55, '🌦️', 'Drizzle'], [56, '🌧️', 'Freezing drizzle'], [57, '🌧️', 'Freezing drizzle'],
  [61, '🌧️', 'Light rain'], [63, '🌧️', 'Rain'], [65, '🌧️', 'Heavy rain'], [66, '🌧️', 'Freezing rain'], [67, '🌧️', 'Freezing rain'],
  [71, '🌨️', 'Light snow'], [73, '🌨️', 'Snow'], [75, '❄️', 'Heavy snow'], [77, '🌨️', 'Snow grains'], [80, '🌦️', 'Showers'], [81, '🌧️', 'Showers'], [82, '⛈️', 'Heavy showers'],
  [85, '🌨️', 'Snow showers'], [86, '🌨️', 'Snow showers'], [95, '⛈️', 'Thunderstorm'], [96, '⛈️', 'Thunderstorm'], [99, '⛈️', 'Thunderstorm']];
const wmo = (c) => (WMO.find(w => w[0] === c) || [0, '🌡️', '']);
const wxFor = (d) => { const w = S.weather; if (!w || !w.days) return null; const k = dayKey(d); return w.days.find(x => x.t === k) || null; };
const wxHtml = (d) => { const x = wxFor(d); return x ? `<span>${wmo(x.code)[1]}</span> ${x.hi}°/${x.lo}°` : ''; };
async function loadWeather() {
  const lat = cfg('lat', '34.05'), lon = cfg('lon', '-118.24');
  const unit = String(cfg('weather_units', 'F')).toUpperCase() === 'C' ? 'celsius' : 'fahrenheit';
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weather_code,apparent_temperature&daily=temperature_2m_max,temperature_2m_min,weather_code,precipitation_probability_max,uv_index_max&temperature_unit=${unit}&timezone=auto&forecast_days=16`;
  try {
    const r = await fetch(url); const j = await r.json();
    S.weather = { temp: Math.round(j.current.temperature_2m), feels: Math.round(j.current.apparent_temperature), code: j.current.weather_code,
      days: j.daily.time.map((t, i) => ({ t, hi: Math.round(j.daily.temperature_2m_max[i]), lo: Math.round(j.daily.temperature_2m_min[i]), code: j.daily.weather_code[i], pp: (j.daily.precipitation_probability_max || [])[i] || 0, uv: (j.daily.uv_index_max || [])[i] || 0 })) };
  } catch (e) { console.warn('weather failed', e); }
  renderWeather();
}
function wxTip() {
  const w = S.weather; if (!w || !w.days || !w.days.length) return '';
  const late = new Date().getHours() >= 17, d = late ? w.days[1] : w.days[0]; if (!d) return '';
  const pfx = late ? 'Tomorrow: ' : '', C = String(cfg('weather_units', 'F')).toUpperCase() === 'C';
  const hot2 = C ? 35 : 95, hot = C ? 31 : 88, cold = C ? 4 : 40;
  if (d.pp >= 60) return `☔ ${pfx}Rain likely (${d.pp}%) — grab umbrellas`;
  if (d.pp >= 35) return `🌦️ ${pfx}Chance of rain (${d.pp}%)`;
  if (d.hi >= hot2) return `🥵 ${pfx}Very hot (${d.hi}°) — water and shade`;
  if (d.hi >= hot) return `☀️ ${pfx}Hot day (${d.hi}°) — bring water`;
  if (d.lo <= cold) return `🧥 ${pfx}Cold morning (${d.lo}°) — jackets`;
  if (d.uv >= 8) return `🧴 ${pfx}Strong sun (UV ${Math.round(d.uv)}) — sunscreen`;
  return '';
}

/* ---------- display schedule ---------- */
const MODES = [['photos', '🖼 Photos + board'], ['clock', '🕐 Dim clock only'], ['off', '⏻ Screen off']];
const modeLabel = (m) => (MODES.find(x => x[0] === m) || ['', m])[1];
const DAYSETS = [['all', 'Every day'], ['weekdays', 'Weekdays'], ['weekends', 'Weekends']];
const daysLabel = (d) => (DAYSETS.find(x => x[0] === String(d || 'all').toLowerCase()) || ['', d])[1];
function dayMatches(days, date) {
  const d = String(days || 'all').toLowerCase().trim(), dow = date.getDay();
  if (!d || d === 'all') return true;
  if (d === 'weekdays') return dow >= 1 && dow <= 5;
  if (d === 'weekends') return dow === 0 || dow === 6;
  return d.split(',').map(x => x.trim().slice(0, 3).toLowerCase()).includes(DAYS[dow].toLowerCase());
}
function displayPeriods() {
  const rows = ((S.state && S.state.display) || []).filter(r => /^\d{1,2}:\d{2}$/.test(String(r.start || '')));
  if (rows.length) return rows.slice().sort((a, b) => parseHM(a.start, 0) - parseHM(b.start, 0));
  return [{ id: '_legacy_on', start: '06:00', mode: 'photos', days: 'all' }, { id: '_legacy_off', start: '21:30', mode: 'off', days: 'all' }];
}
function periodAt(when) {
  const all = displayPeriods(), mins = when.getHours() * 60 + when.getMinutes();
  let cur = null; for (const p of all.filter(p => dayMatches(p.days, when))) if (parseHM(p.start, 0) <= mins) cur = p;
  if (cur) return cur;
  for (let back = 1; back <= 7; back++) { const d = addDays(when, -back); const prev = all.filter(p => dayMatches(p.days, d)); if (prev.length) return prev[prev.length - 1]; }
  return { mode: 'photos', start: '00:00', days: 'all' };
}
function nextChange(when) {
  const all = displayPeriods(), mins = when.getHours() * 60 + when.getMinutes();
  const later = all.filter(p => dayMatches(p.days, when) && parseHM(p.start, 0) > mins);
  if (later.length) return { at: later[0].start, mode: later[0].mode, tomorrow: false };
  for (let f = 1; f <= 7; f++) { const d = addDays(when, f); const nx = all.filter(p => dayMatches(p.days, d)); if (nx.length) return { at: nx[0].start, mode: nx[0].mode, tomorrow: f === 1, days: f }; }
  return null;
}
