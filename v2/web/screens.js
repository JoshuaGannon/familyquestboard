/* Family Quest Board v2 — screens: Home, Calendar, Groceries, Quests, To-do */
'use strict';

/* ======================================================================
   render everything
   ====================================================================== */
function render() {
  updatePill();
  if (!S.state) return;
  document.body.classList.toggle('phone', isPhone());
  $('#family-name').textContent = cfg('family_name', '');
  renderHome();
  if (S.screen === 'calendar') renderCalendar();
  if (S.screen === 'groceries') renderGroceries();
  if (S.screen === 'quests') renderQuests();
  if (S.screen === 'todo') renderTodos();
  if (S.screen === 'parent') renderParent();
  if (S.screen === 'messages') renderMessages();
  Msg.badge(); Msg.check();
  $('#nav-msg').style.display = Msg.enabled() ? '' : 'none';
  const today = dayKey(new Date());
  const dueNow = (S.state.todos || []).filter(t => !isTrue(t.done) && t.due && t.due <= today).length;
  badge('#badge-todo', dueNow);
  const pending = (S.state.queue || []).filter(k => k.status === 'pending').length;
  badge('#badge-queue', pending); $('#ptab-queue-n').textContent = pending || '';
  badge('#badge-groc', (S.state.groceries || []).filter(g => gStatus(g) === 'needed').length);
}
function badge(sel, n) { const b = $(sel); b.textContent = n; b.classList.toggle('on', n > 0); }
function updatePill() {
  const p = $('#mode-pill');
  if (!S.state) { p.textContent = ''; return; }
  if (!S.online) { p.textContent = 'OFFLINE'; p.className = 'pill off'; return; }
  if (S.state.demo) { p.textContent = 'DEMO'; p.className = 'pill demo'; return; }
  p.textContent = 'LIVE'; p.className = 'pill live';
}
function tickClock() {
  const now = new Date(); let h = now.getHours(); const ampm = h >= 12 ? 'PM' : 'AM'; h = h % 12 || 12;
  $('#clock-time').innerHTML = `${h}:${pad(now.getMinutes())}<small>${ampm}</small>`;
  $('#clock-date').textContent = now.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
  $('#sleep-time').textContent = `${h}:${pad(now.getMinutes())}`; $('#sleep-date').textContent = $('#clock-date').textContent;
}

/* ======================================================================
   HOME
   ====================================================================== */
function evRow(ev) { return `<div class="row"><span class="dot" style="background:${esc(ev.color || '#60a5fa')}"></span><span class="t">${esc(ev.allDay ? 'all day' : fmtTime(toDate(ev.start)))}</span><span>${esc(ev.title)}</span></div>`; }
function taskRow(t, refDay) { const late = t.due && t.due < refDay; return `<div class="row task"><span class="dot" style="background:${late ? 'var(--bad)' : 'var(--info)'}"></span><span class="t">${late ? '⚠️ late' : '📝 task'}</span><span>${esc(t.task)}${t.assigned_to ? ` <span class="muted">· ${esc(t.assigned_to)}</span>` : ''}${t.repeat ? ' <span class="muted">↻</span>' : ''}</span></div>`; }
function agendaRows(date, evs, max) {
  const key = dayKey(date), tasks = todosOn(date).sort((a, b) => (a.due || '') < (b.due || '') ? -1 : 1);
  const rows = evs.map(evRow).concat(tasks.map(t => taskRow(t, key))), extra = rows.length - max;
  return { html: rows.slice(0, max).join('') + (extra > 0 ? `<div class="row muted"><span class="dot" style="background:transparent"></span><span class="t"></span><span>+${extra} more</span></div>` : ''), count: evs.length + tasks.length };
}
function renderHome() {
  const now = new Date(), mins = now.getHours() * 60 + now.getMinutes();
  const schoolDays = String(cfg('school_days', 'Mon,Tue,Wed,Thu,Fri')).split(',').map(s => s.trim().slice(0, 3).toLowerCase());
  const isSchoolDay = schoolDays.includes(DAYS[now.getDay()].toLowerCase());
  const dep = parseHM(cfg('school_departure', '07:45'), 465), from = parseHM(cfg('school_countdown_from', '06:00'), 360);
  const upcoming = eventsOn(now).filter(ev => ev.allDay || toDate(ev.end) > now), dinner = dinnerFor(now);
  const tomorrow = addDays(now, 1), tmrEvents = eventsOn(tomorrow);
  let html = '';
  if (isSchoolDay && mins >= from && mins < dep + 15) {
    const left = dep - mins;
    html += `<div class="kicker">🎒 School morning</div>`;
    html += left > 0 ? `<div class="big huge">${left} min</div><div class="sub">until it's time to leave (${esc(cfg('school_departure', '07:45'))})</div>` : `<div class="big huge">Time to go! 🚗</div><div class="sub">Shoes, backpacks, water bottles</div>`;
    const ag = agendaRows(now, upcoming, 3); if (ag.count) html += `<div class="rows">${ag.html}</div>`;
  } else if (now.getHours() < 15) {
    html += `<div class="kicker">📋 Today</div>`;
    const ag = agendaRows(now, upcoming, 5);
    html += ag.count ? `<div class="big">${ag.count} thing${ag.count === 1 ? '' : 's'} on the agenda</div><div class="rows">${ag.html}</div>` : `<div class="big">Nothing scheduled 🎉</div><div class="sub">Enjoy the free day</div>`;
    const tm = agendaRows(tomorrow, tmrEvents, 3); if (tm.count) html += `<div class="subk">Tomorrow · ${esc(DAYS[tomorrow.getDay()])}</div><div class="rows">${tm.html}</div>`;
    const nb = (S.state.groceries || []).filter(g => gStatus(g) === 'needed').length, nt = (S.state.todos || []).filter(t => !isTrue(t.done) && t.due && t.due <= dayKey(now)).length;
    html += `<div class="chips">${dinner && mins < 18 * 60 + 30 ? `<span class="chip">🍽️ Dinner: ${esc(dinner.meal)}</span>` : ''}${nb ? `<span class="chip">🛒 ${nb} to buy</span>` : ''}${nt ? `<span class="chip">📝 ${nt} to-do${nt === 1 ? '' : 's'} due</span>` : ''}</div>`;
  } else {
    html += `<div class="kicker">🌙 Tonight</div>`;
    const showDinner = dinner && mins < 18 * 60 + 30, left = agendaRows(now, upcoming, 3), tm = agendaRows(tomorrow, tmrEvents, 4);
    if (showDinner) html += `<div class="big">🍽️ ${esc(dinner.meal)}</div>${dinner.note ? `<div class="sub">${esc(dinner.note)}</div>` : ''}`;
    else if (!left.count && !tm.count) html += `<div class="big">All clear</div><div class="sub">Nothing left today, nothing yet tomorrow</div>`;
    if (left.count) html += `<div class="subk">Still today</div><div class="rows">${left.html}</div>`;
    if (tm.count) html += `<div class="subk">Tomorrow · ${esc(DAYS[tomorrow.getDay()])}</div><div class="rows">${tm.html}</div>`;
  }
  $('#smart').innerHTML = html;
  const kids = members('kid');
  let lh = `<div class="kicker">🏆 Quest points</div>`;
  if (!kids.length) lh += `<div class="muted">Add kids under Parents → Family</div>`;
  else lh += `<div class="lkids">` + kids.map(k => ({ k, b: balance(k.name) })).sort((a, b) => b.b.approved - a.b.approved).map(({ k, b }) =>
    `<div class="lkid"><div class="lrow"><span class="av" style="background:${esc(k.color || '#334')}">${esc(k.emoji || '⭐')}</span><span class="ln">${esc(k.name)}</span><span class="pts">${b.approved}${b.pending ? `<span class="pend">+${b.pending} pending</span>` : ''}</span></div>${goalBar(goalFor(k.name))}</div>`).join('') + `</div>`;
  $('#leader').innerHTML = lh;
  renderHomeSide(); renderWeather();
}
function renderWeather() {
  const w = S.weather, el = $('#weather');
  if (!w) { el.innerHTML = `<div class="desc muted">weather loading…</div>`; return; }
  const [, icon, desc] = wmo(w.code), d0 = w.days[0] || {};
  el.innerHTML = `<div class="now"><span>${icon}</span><span>${w.temp}°</span></div><div class="desc">${desc} · feels ${w.feels}°</div><div class="hilo">H ${d0.hi}° · L ${d0.lo}°</div>${wxTip() ? `<div class="wtip">${esc(wxTip())}</div>` : ''}
    <div class="days">${w.days.slice(1, 4).map(d => { const dt = new Date(d.t + 'T12:00:00'); return `<div><div>${DAYS[dt.getDay()]}</div><div class="i">${wmo(d.code)[1]}</div><div>${d.hi}°/${d.lo}°</div></div>`; }).join('')}</div>`;
}
const NOTE_COLORS = ['#fde68a', '#bbf7d0', '#bfdbfe', '#fbcfe8'];
function renderHomeSide() {
  const el = $('#homeside');
  const cds = countdowns().slice(0, 3), notes = (X.get('notes', []) || []).filter(Boolean).slice().reverse();
  const prev = el.querySelector('.notes'), keep = prev ? prev.scrollTop : 0;
  el.innerHTML = cds.map(c => `<div class="cdown"><span class="ce">${esc(c.emoji)}</span><span class="cn">${c.days === 0 ? 'Today!' : c.days === 1 ? '1 sleep' : c.days + ' days'}</span><span class="ct">${esc(c.title)}</span></div>`).join('')
    + `<button class="note-add" data-act="note-add">＋ Note${notes.length ? ` <span style="opacity:.7">· ${notes.length}</span>` : ''}</button>`
    + `<div class="notes">${notes.map((n, i) => `<button class="note-card" data-act="note-open" data-id="${esc(n.id)}" style="background:${esc(n.color || NOTE_COLORS[i % 4])};transform:rotate(${i % 2 ? 1.2 : -1.4}deg)">${esc(n.text)}${n.by ? `<small>— ${esc(n.by)}</small>` : ''}</button>`).join('')}</div><div class="notes-more">↓ more notes — swipe</div>`;
  const box = el.querySelector('.notes'); box.scrollTop = keep;
  const upd = () => { const more = box.scrollHeight - box.clientHeight - box.scrollTop > 8; box.classList.toggle('more', more); el.querySelector('.notes-more').classList.toggle('on', more); };
  box.addEventListener('scroll', upd, { passive: true }); requestAnimationFrame(upd);
}
async function addNote() {
  const v = await KB.open({ title: 'Leave a note on the board', placeholder: 'e.g. Soccer cleats are in the car ❤️', multi: true });
  if (!v || !v.trim()) return;
  const list = X.get('notes', []) || [];
  try { await X.op({ op: 'push', key: 'notes', value: { id: xuid(), text: v.trim().slice(0, 200), color: NOTE_COLORS[list.length % 4], by: Me.name() || '', at: new Date().toISOString() } }); renderHomeSide(); toast('Note posted 📌'); }
  catch (e) { toast('Could not save the note: ' + e.message, true); }
}
async function removeNote(id) {
  const n = (X.get('notes', []) || []).find(x => x && x.id === id); if (!n) return;
  if (!await Modal.confirm({ icon: '📌', title: 'Take this note down?', body: esc(n.text), ok: 'Done ✓' })) return;
  try { await X.op({ op: 'remove', key: 'notes', id }); renderHomeSide(); } catch (e) { toast('Could not remove: ' + e.message, true); }
}

/* ======================================================================
   CALENDAR
   ====================================================================== */
const Cal = { view: ls.get('fqb2_calview', 'week'), offset: 0, hidden: ls.get('fqb2_calhide', []), save() { ls.set('fqb2_calview', this.view); ls.set('fqb2_calhide', this.hidden); } };
const calEvents = (d) => eventsOn(d).filter(ev => !Cal.hidden.includes(ev.calendar || ''));
const evRef = (ev) => { S.calIndex.push(ev); return S.calIndex.length - 1; };
function renderCalendar() {
  if (!S.state) return;
  S.calIndex = [];
  const now = new Date(), today = startOfDay(now), todayK = dayKey(now), wrap = $('#cal-wrap');
  $$('#cal-bar [data-calview]').forEach(b => b.classList.toggle('on', b.dataset.calview === Cal.view));
  const cals = {}; (S.state.events || []).forEach(ev => { const n = ev.calendar || ''; if (n && !cals[n]) cals[n] = ev.color || '#60a5fa'; });
  const names = Object.keys(cals).sort();
  $('#cal-cals').innerHTML = names.length > 1 ? names.map(n => `<button class="${Cal.hidden.includes(n) ? 'off' : ''}" data-calname="${esc(n)}"><i style="background:${esc(cals[n])}"></i>${esc(n)}</button>`).join('') : '';
  $('#cal-cals').style.display = names.length > 1 ? '' : 'none';
  const errs = S.state.calendar_errors || [];
  if (Cal.view === 'month') {
    const m = new Date(now.getFullYear(), now.getMonth() + Cal.offset, 1), monday = isTrue(cfg('week_starts_monday', 'FALSE'));
    const first = addDays(m, -((m.getDay() - (monday ? 1 : 0) + 7) % 7));
    let html = Array.from({ length: 7 }, (_, i) => `<div class="mhd">${DAYS[(i + (monday ? 1 : 0)) % 7]}</div>`).join('');
    for (let i = 0; i < 42; i++) {
      const d = addDays(first, i), k = dayKey(d), evs = calEvents(d), tds = todosOn(d), din = dinnerFor(d);
      const items = evs.map(ev => `<div class="mev ${ev.allDay ? 'all' : ''} ${ev.local ? 'local' : ''}" style="border-color:${esc(ev.color || '#60a5fa')}">${ev.allDay ? '' : `<b>${esc(fmtTime(toDate(ev.start)).replace(':00', '').replace(/\s?([AP])M/i, (x, a) => a.toLowerCase()))}</b> `}${esc(ev.title)}</div>`).concat(tds.map(t => `<div class="mev task">📝 ${esc(t.task)}</div>`));
      html += `<button class="mcell ${d.getMonth() !== m.getMonth() ? 'other' : ''} ${k === todayK ? 'today' : ''} ${k < todayK ? 'past' : ''}" data-day="${k}"><div class="mtop"><span class="mnum">${d.getDate()}</span><span class="mw">${wxHtml(d)}</span></div>${items.slice(0, 3).join('')}${items.length > 3 ? `<div class="mmore">+${items.length - 3} more</div>` : ''}${din ? `<div class="mdin">🍽️ ${esc(din.meal)}</div>` : ''}</button>`;
    }
    wrap.className = 'cal-month'; wrap.innerHTML = html;
    $('#cal-title').textContent = `📅 ${MONTHS[m.getMonth()]} ${m.getFullYear()}`;
    const loaded = +cfg('calendar_days', '14'), lastDay = new Date(m.getFullYear(), m.getMonth() + 1, 0);
    $('#cal-sub').textContent = errs.length ? '⚠️ ' + errs[0] : addDays(today, loaded) < lastDay ? `calendar feeds load ${loaded} days ahead — raise it under Settings` : '';
    return;
  }
  const startD = addDays(today, Cal.offset * 7); let html = '';
  for (let i = 0; i < 7; i++) {
    const d = addDays(startD, i), k = dayKey(d), evs = calEvents(d), dinner = dinnerFor(d), tds = todosOn(d);
    const rel = k === todayK ? 'Today' : k === dayKey(addDays(today, 1)) ? 'Tomorrow' : DAYS[d.getDay()];
    html += `<div class="cal-day ${k === todayK ? 'today' : ''} ${k < todayK ? 'past' : ''}" data-day="${k}"><div class="dh"><div class="dn">${rel}</div><div class="dd">${d.getDate()}</div><div class="dw">${wxHtml(d) || '&nbsp;'}</div></div><div class="evs">`;
    if (!evs.length && !tds.length) html += `<div class="muted" style="text-align:center;font-size:15px;padding:10px 0">—</div>`;
    for (const ev of evs) { const past = !ev.allDay && toDate(ev.end) < now; const c = claimOf(ev); html += `<button class="ev ${ev.allDay ? 'allday' : ''} ${past ? 'past' : ''} ${ev.local ? 'local ' + ev.kind : ''}" data-ev="${evRef(ev)}" style="border-color:${esc(ev.color || '#60a5fa')}"><div class="et">${ev.allDay ? 'All day' : esc(fmtTime(toDate(ev.start)))}</div><div class="en">${esc(ev.title)}</div>${ev.location ? `<div class="el">📍 ${esc(ev.location)}</div>` : ''}${c ? `<div class="el claim">${esc(memberOf(c).emoji || '👤')} ${esc(c)} has it</div>` : ''}</button>`; }
    for (const t of tds) { const late = k === todayK && t.due < todayK; html += `<button class="ev task ${late ? 'late' : ''}" data-todo="${esc(t.id)}"><div class="et">${late ? '⚠ Overdue' : '📝 Task'}${t.repeat ? ' ↻' : ''}${t.assigned_to ? ' · ' + esc(t.assigned_to) : ''}</div><div class="en">${esc(t.task)}</div></button>`; }
    html += `</div>${dinner ? `<div class="dinner">🍽️ <b>${esc(dinner.meal)}</b></div>` : ''}</div>`;
  }
  wrap.className = 'cal-week'; wrap.innerHTML = html;
  const endD = addDays(startD, 6);
  $('#cal-title').textContent = Cal.offset === 0 ? '📅 This Week' : Cal.offset === 1 ? '📅 Next Week' : `📅 ${MONTHS[startD.getMonth()].slice(0, 3)} ${startD.getDate()} – ${startD.getMonth() !== endD.getMonth() ? MONTHS[endD.getMonth()].slice(0, 3) + ' ' : ''}${endD.getDate()}`;
  const n = (S.state.events || []).length;
  $('#cal-sub').textContent = errs.length ? '⚠️ ' + errs[0] : !cfg('ical_urls', '') ? 'add your calendar’s iCal link under Parents → Settings to see it here' : `${n} event${n === 1 ? '' : 's'} in the next ${cfg('calendar_days', '14')} days`;
}
function showDay(k) {
  const d = new Date(k + 'T12:00:00'), evs = calEvents(d), tds = todosOn(d), din = dinnerFor(d), wx = wxFor(d);
  const body = `<div class="agenda">${wx ? `<div class="aw">${wmo(wx.code)[1]} ${esc(wmo(wx.code)[2])} · high ${wx.hi}° · low ${wx.lo}°</div>` : ''}
    ${evs.map(ev => `<div class="ev ${ev.allDay ? 'allday' : ''}" style="border-color:${esc(ev.color || '#60a5fa')}"><div class="et">${esc(evTime(ev))}${ev.calendar ? ' · ' + esc(ev.calendar) : ''}</div><div class="en">${esc(ev.title)}</div>${ev.location ? `<div class="el">📍 ${esc(ev.location)}</div>` : ''}</div>`).join('')}
    ${tds.map(t => `<div class="ev task"><div class="et">📝 Task${t.assigned_to ? ' · ' + esc(t.assigned_to) : ''}</div><div class="en">${esc(t.task)}</div></div>`).join('')}
    ${!evs.length && !tds.length ? '<div class="muted">Nothing scheduled.</div>' : ''}${din ? `<div class="ad">🍽️ Dinner: <b style="color:var(--text)">${esc(din.meal)}</b></div>` : ''}</div>`;
  Modal.confirm({ icon: '📅', title: d.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' }), body, ok: 'Close', alt: '＋ Add something', noCancel: true, wide: true })
    .then(async r => { if (r !== 'alt') return; const v = await Modal.pick({ icon: '＋', title: 'Add what?', options: [{ value: 'event', label: '📅 Event or reminder' }, { value: 'task', label: '📝 Task' }, { value: 'dinner', label: '🍽️ Dinner plan' }] }); if (v === 'event') EE.open(null, k); else if (v === 'task') TE.open(null, { due: k }); else if (v === 'dinner') editDinner(k); });
}
function showEvent(ev) {
  S.openEvent = ev;
  const s = toDate(ev.start), c = claimOf(ev);
  const who = `<div class="claimrow" data-evk="${esc(evKey(ev))}"><span class="muted" style="font-weight:700">Who's got it?</span>${members().map(m => `<button data-claim="${esc(m.name)}" class="${c === m.name ? 'on' : ''}">${esc(m.emoji || '👤')} ${esc(m.name)}</button>`).join('')}${c ? '<button data-claim="">✕ Nobody</button>' : ''}</div>`;
  const body = `<div class="agenda"><div class="ev ${ev.allDay ? 'allday' : ''}" style="border-color:${esc(ev.color || '#60a5fa')}"><div class="et">${esc(s.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' }))} · ${esc(evTime(ev))}</div>${ev.location ? `<div style="margin-top:6px">📍 ${esc(ev.location)}</div>` : ''}${ev.calendar ? `<div class="el" style="margin-top:6px">Calendar: ${esc(ev.calendar)}</div>` : ''}</div>${who}</div>`;
  Modal.confirm({ icon: '🗓️', title: ev.title, body, ok: 'Close', noCancel: true, wide: true, alt: ev.local ? '✎ Edit' : '' }).then(r => { S.openEvent = null; if (r === 'alt') { const row = (S.state.local_events || []).find(x => x.id === ev.id); if (row) EE.open(row); } });
}
async function editDinner(k) {
  const cur = dinnerFor(new Date(k + 'T12:00:00')), dd = new Date(k + 'T12:00:00');
  const v = await KB.open({ title: `Dinner · ${dd.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' })}${cur ? ' (clear it to remove)' : ''}`, initial: cur ? cur.meal : '', placeholder: 'What’s for dinner?' });
  if (v === null) return;
  (S.state.dinner = S.state.dinner || []).push({ date: k, meal: v.trim(), note: '' }); render();
  await act('setDinner', { date: k, meal: v.trim() }, { toast: v.trim() ? 'Dinner plan saved' : 'Dinner plan cleared' });
}
/* event / reminder editor */
const EREPEATS = [['', 'Once'], ['daily', 'Daily'], ['weekly', 'Weekly'], ['biweekly', 'Every 2 weeks'], ['monthly', 'Monthly'], ['yearly', 'Yearly']];
const EE = {
  state: null,
  open(ev, presetDate) {
    this.state = ev ? { id: ev.id, title: ev.title, date: ev.date, time: ev.time || '', kind: String(ev.kind || 'event').toLowerCase() === 'reminder' ? 'reminder' : 'event', who: ev.who || '', repeat: String(ev.repeat || '').toLowerCase(), note: ev.note || '' }
      : { id: '', title: '', date: presetDate || dayKey(new Date()), time: '', kind: 'event', who: '', repeat: '', note: '' };
    $('#ee-title').textContent = ev ? 'Edit' : 'New event or reminder'; $('#ee-del').style.display = ev ? '' : 'none';
    this.draw(); Sheet.open('ev-ed'); if (!ev) setTimeout(() => this.editTitle(), 80);
  },
  close() { Sheet.close('ev-ed'); this.state = null; },
  draw() {
    const s = this.state; if (!s) return;
    const nm = $('#ee-name'); nm.textContent = s.title || 'Tap to type…'; nm.classList.toggle('ph', !s.title);
    $('#ee-kind').innerHTML = `<button data-ekind="event" class="${s.kind === 'event' ? 'on' : ''}">📅 Event</button><button data-ekind="reminder" class="${s.kind === 'reminder' ? 'on' : ''}">🔔 Reminder</button>`;
    const now = new Date(), d = (n) => dayKey(addDays(now, n)); const opts = [[d(0), 'Today'], [d(1), 'Tomorrow']]; for (let i = 2; i < 7; i++) opts.push([d(i), DAYS[(now.getDay() + i) % 7]]);
    const custom = !opts.some(o => o[0] === s.date);
    $('#ee-date').innerHTML = opts.map(o => `<button data-edate="${o[0]}" class="${s.date === o[0] ? 'on' : ''}">${o[1]}</button>`).join('') + `<button data-epickdate class="${custom ? 'on' : ''}">📅 ${custom ? esc(new Date(s.date + 'T12:00:00').toLocaleDateString([], { month: 'short', day: 'numeric' })) : 'Pick…'}</button>`;
    const times = [['', 'All day'], ['08:00', '8 AM'], ['09:00', '9 AM'], ['12:00', 'Noon'], ['15:00', '3 PM'], ['17:00', '5 PM'], ['18:00', '6 PM'], ['19:00', '7 PM']], tcustom = s.time && !times.some(t => t[0] === s.time);
    $('#ee-time').innerHTML = times.map(t => `<button data-etime="${t[0]}" class="${s.time === t[0] ? 'on' : ''}">${t[1]}</button>`).join('') + `<button data-epicktime class="${tcustom ? 'on' : ''}">🕐 ${tcustom ? esc(fmtTime(new Date(s.date + 'T' + s.time + ':00'))) : 'Other…'}</button>`;
    $('#ee-who').innerHTML = `<button data-ewho="" class="${!s.who ? 'on' : ''}">Everyone</button>` + members().map(m => `<button data-ewho="${esc(m.name)}" class="${s.who === m.name ? 'on' : ''}">${esc(m.emoji || '')} ${esc(m.name)}</button>`).join('');
    $('#ee-repeat').innerHTML = EREPEATS.map(r => `<button data-erep="${r[0]}" class="${s.repeat === r[0] ? 'on' : ''}">${r[1]}</button>`).join('');
    const nt = $('#ee-note'); nt.textContent = s.note || 'e.g. bring the forms'; nt.classList.toggle('ph', !s.note);
  },
  async editTitle() { const v = await KB.open({ title: this.state.kind === 'reminder' ? 'Remind us to…' : 'What’s happening?', initial: this.state.title, placeholder: 'e.g. Piano recital' }); if (v !== null && this.state) { this.state.title = v; this.draw(); } },
  async save() { const s = this.state; if (!s.title.trim()) { toast('Give it a name first', true); return; } this.close(); await act('saveEvent', { id: s.id, title: s.title.trim(), date: s.date, time: s.time, kind: s.kind, who: s.who, repeat: s.repeat, note: s.note, by: Me.who() }, { toast: s.kind === 'reminder' ? 'Reminder saved' : 'Event saved' }); },
  async del() { const s = this.state; if (!await Modal.confirm({ icon: '🗑️', title: `Delete “${s.title}”?`, body: s.repeat ? 'This removes every future occurrence.' : '', ok: 'Delete', okClass: 'bad' })) return; this.close(); await act('deleteEvent', { id: s.id }, { toast: 'Deleted' }); },
};

/* ======================================================================
   GROCERIES
   ====================================================================== */
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ#'.split('');
const metaHtml = (g) => { const st = storesOf(g), r = gRepeat(g); return (st.length || isNice(g) || r) ? `<div class="meta">${st.map(x => `<span>${esc(x)}</span>`).join('')}${isNice(g) ? '<span class="npill">nice to have</span>' : ''}${r ? `<span class="rpill">↻ ${esc(repeatLabel(r))}</span>` : ''}</div>` : ''; };
function renderGroceries() {
  const everything = (S.state.groceries || []).filter(g => g.item).slice().sort(byName);
  const storeNames = {}; everything.forEach(g => storesOf(g).forEach(x => { storeNames[x.toLowerCase()] = storeNames[x.toLowerCase()] || x; }));
  const all = everything.filter(g => (!S.gStore || storesOf(g).some(x => x.toLowerCase() === S.gStore)) && (!S.gEssOnly || !isNice(g)));
  const needed = all.filter(g => gStatus(g) !== ''), toBuy = needed.length, allNeeded = everything.filter(g => gStatus(g) !== '').length;
  if (!S.gtab) S.gtab = allNeeded ? 'need' : 'all';
  if (S.gtab === 'store' && !isPhone()) S.gtab = 'need';
  $$('.gtab').forEach(b => b.classList.toggle('active', b.dataset.gtab === S.gtab));
  $('#groc-need-cnt').textContent = allNeeded; $('#groc-all-cnt').textContent = everything.length; $('#groc-store-cnt').textContent = everything.filter(g => gStatus(g) === 'needed').length;
  $('.groc').classList.toggle('store-mode', S.gtab === 'store'); $('#groc-add').textContent = S.gtab === 'store' ? '＋ Add' : '＋ Add item';
  const storeKeys = Object.keys(storeNames).sort((a, b) => a.localeCompare(b));
  const cntFor = (k) => everything.filter(g => (S.gtab === 'need' ? gStatus(g) !== '' : true) && storesOf(g).some(x => x.toLowerCase() === k)).length;
  $('#gfilters').innerHTML = (storeKeys.length ? `<button class="${S.gStore ? '' : 'on'}" data-store="">All stores</button>` + storeKeys.map(k => `<button class="${S.gStore === k ? 'on' : ''}" data-store="${esc(k)}">${esc(storeNames[k])} <span class="n">${cntFor(k)}</span></button>`).join('') + `<span class="spacer"></span>` : '') + `<button class="toggle ${S.gEssOnly ? 'on' : ''}" id="groc-essonly">${S.gEssOnly ? '✓ Essentials only' : 'Essentials only'}</button>`;
  const keeping = S.gKeep.filter(id => everything.some(g => g.id === id && gStatus(g) !== '')).length;
  $('#groc-count').innerHTML = `${needed.length}<small>${needed.length === 1 ? 'item' : 'items'} to buy${S.gStore ? ` at ${esc(storeNames[S.gStore])}` : ''}${keeping ? ` · keeping ${keeping}` : ''}</small>`;
  $('#groc-clear').style.display = toBuy && S.gtab === 'need' ? '' : 'none'; $('#groc-clear').textContent = keeping ? `🧹 Clear all but ${keeping}` : '🧹 Clear list';
  $('#groc-send').style.display = needed.length && S.gtab === 'need' ? '' : 'none';
  $('#groc-hint').textContent = S.gtab === 'need' ? 'what to get · back home, tap what you still need and clear the rest' : S.gtab === 'store' ? 'tap what’s in the cart · works offline' : 'tap anything you’re out of to put it on the list · hold to edit';
  const list = $('#groc-list'), rail = $('#letter-rail');
  if (S.gtab === 'need') {
    rail.classList.add('hidden');
    const row = (g) => { const k = S.gKeep.includes(g.id); return `<button class="gitem ${k ? 'keep' : ''} ${isNice(g) ? 'nice' : ''}" data-id="${esc(g.id)}"><span class="box">${k ? '📌' : ''}</span><span><div class="name">${esc(g.item)}</div>${g.note ? `<div class="note">${esc(g.note)}</div>` : ''}${metaHtml(g)}</span>${k ? '<span class="keeplbl">KEEPING</span>' : ''}</button>`; };
    const groups = groupByStore(needed), multi = groups.length > 1 || (groups.length === 1 && groups[0].store !== 'Any store');
    list.innerHTML = toBuy ? groups.map(grp => (multi ? `<div class="shead">🏬 ${esc(grp.store)} <span class="n">${grp.items.length}</span></div>` : '') + `<div class="cgrid">${grp.items.map(row).join('')}</div>`).join('')
      : `<div class="empty">${S.gStore || S.gEssOnly ? 'Nothing needed with this filter' : "Nothing on the list — everything's stocked 🎉"}<br><span style="font-size:16px">Open <b>Library</b> and tap what you're out of.</span></div>`;
    return;
  }
  if (S.gtab === 'store') {
    rail.classList.add('hidden');
    const bought = needed.filter(g => gStatus(g) === 'cart').length, left = needed.filter(g => gStatus(g) !== 'cart');
    $('#groc-count').innerHTML = `${left.length}<small>left${bought ? ` · ${bought} in cart` : ''}</small>`;
    $('#groc-clear').style.display = bought ? '' : 'none'; $('#groc-clear').textContent = `Clear ${bought} bought`; $('#groc-send').style.display = 'none';
    const row = (g) => { const sub = [g.note, isNice(g) ? 'if they have it' : ''].filter(Boolean).join(' · '); return `<button class="sitem" data-id="${esc(g.id)}"><span class="ck"></span><span class="nm">${esc(g.item)}${sub ? `<span class="sub">${esc(sub)}</span>` : ''}</span></button>`; };
    const groups = groupByStore(left), multi = groups.length > 1 || (groups.length === 1 && groups[0].store !== 'Any store');
    // tapped in the last 3 hours: a collapsible strip at the bottom, tap to put one back
    const cutoff = Date.now() - 3 * 3600000;
    const recent = needed.filter(g => gStatus(g) === 'cart').map(g => ({ g, t: S.clearedAt[g.id] || (g.updated_at ? toDate(g.updated_at).getTime() : 0) })).filter(x => x.t >= cutoff).sort((a, b) => b.t - a.t);
    const recentHtml = recent.length ? `<div class="cleared ${S.clearedOpen ? 'open' : ''}"><button class="clhd" data-toggle-cleared><span>Recently cleared · ${recent.length}</span><span class="chev">${S.clearedOpen ? '▾' : '▸'}</span></button>
      ${S.clearedOpen ? `<div class="slist">${recent.map(({ g, t }) => `<button class="sitem cart" data-restore="${esc(g.id)}"><span class="ck">✓</span><span class="nm"><s>${esc(g.item)}</s><span class="sub">${esc(relTime(new Date(t).toISOString()))} · tap to put back</span></span></button>`).join('')}</div>` : ''}</div>` : '';
    list.innerHTML = (left.length ? groups.map(grp => (multi ? `<div class="slhead">${esc(grp.store)} · ${grp.items.length}</div>` : '') + `<div class="slist">${grp.items.map(row).join('')}</div>`).join('')
      : `<div class="empty">${needed.length ? 'All in the cart 🎉' : 'Nothing on the list 🎉'}</div>`) + recentHtml;
    return;
  }
  rail.classList.remove('hidden');
  const groups = {}; all.forEach(g => { (groups[gLetter(g)] = groups[gLetter(g)] || []).push(g); });
  const chip = (g) => { const s = gStatus(g); return `<button class="gchip ${s} ${isNice(g) ? 'nice' : ''}" data-id="${esc(g.id)}"><span class="box">${s === 'cart' ? '✓' : s === 'needed' ? '🛒' : ''}</span><span><div class="name">${esc(g.item)}</div>${g.note ? `<div class="note">${esc(g.note)}</div>` : ''}${metaHtml(g)}</span></button>`; };
  list.innerHTML = all.length ? LETTERS.filter(L => groups[L]).map(L => `<div class="lsec" data-letter="${L}"><div class="lhead">${L}</div><div class="lgrid">${groups[L].map(chip).join('')}</div></div>`).join('') : `<div class="empty">Nothing here yet — tap <b>＋ Add item</b>.</div>`;
  rail.innerHTML = LETTERS.map(L => `<span data-l="${L}" class="${groups[L] ? '' : 'muted'}" style="${groups[L] ? '' : 'opacity:.3'}">${L}</span>`).join('');
}
function jumpToLetter(L) {
  const sec = $(`#groc-list .lsec[data-letter="${L}"]`); if (!sec) return false;
  if (isPhone()) sec.scrollIntoView({ block: 'start', behavior: 'instant' }); else $('#groc-list').scrollTo({ top: sec.offsetTop, behavior: 'instant' });
  $$('#letter-rail span').forEach(s => s.classList.toggle('cur', s.dataset.l === L)); return true;
}
const GE = {
  state: null,
  open(g, presetName) {
    this.state = g ? { id: g.id, name: g.item, note: g.note || '', stores: storesOf(g), nice: isNice(g), repeat: gRepeat(g) } : { name: presetName || '', note: '', stores: [], nice: false, repeat: '' };
    if (!g && S.gStore) { const disp = allStores().find(x => x.toLowerCase() === S.gStore); this.state.stores = [disp || S.gStore]; }
    $('#ge-title').textContent = g ? 'Edit item' : 'Add an item';
    $('#ge-del').style.display = g ? '' : 'none'; $('#ge-save').style.display = g ? '' : 'none'; $('#ge-addlist').style.display = $('#ge-addlib').style.display = g ? 'none' : '';
    this.draw(); Sheet.open('groc-ed'); if (!g && !presetName) setTimeout(() => this.editName(), 80);
  },
  close() { Sheet.close('groc-ed'); this.state = null; },
  async editName() { const v = await KB.open({ title: 'Item name', initial: this.state.name, placeholder: 'e.g. Apples' }); if (v !== null && this.state) { this.state.name = v; this.draw(); } },
  draw() {
    const s = this.state; if (!s) return;
    const nf = $('#ge-name'); nf.textContent = s.name || 'Tap to type the item…'; nf.classList.toggle('ph', !s.name);
    const dup = !s.id && s.name.trim() && (S.state.groceries || []).find(g => g.item.trim().toLowerCase() === s.name.trim().toLowerCase());
    $('#ge-dup').textContent = dup ? `“${dup.item}” is already in your library — adding will update it${gStatus(dup) ? ' (it’s already on the list)' : ''}.` : '';
    const tf = $('#ge-note'); tf.textContent = s.note || 'Optional'; tf.classList.toggle('ph', !s.note);
    const stores = allStores(); s.stores.forEach(x => { if (!stores.some(y => y.toLowerCase() === x.toLowerCase())) stores.push(x); });
    $('#ge-store').innerHTML = `<button data-store="" class="${s.stores.length ? '' : 'on info'}">Any store</button>` + stores.map(x => `<button data-store="${esc(x)}" class="${s.stores.some(y => y.toLowerCase() === x.toLowerCase()) ? 'on info' : ''}">${esc(x)}</button>`).join('') + `<button class="newtag" data-newstore>＋ store</button>`;
    $('#ge-prio').innerHTML = `<button data-prio="" class="${s.nice ? '' : 'on'}">⭐ Essential</button><button data-prio="nice" class="${s.nice ? 'on' : ''}">☆ Nice to have</button>`;
    $('#ge-repeat').innerHTML = [['', 'Only when I add it'], ['weekly', 'Weekly'], ['biweekly', 'Every 2 weeks'], ['monthly', 'Monthly']].map(x => `<button data-grepeat="${x[0]}" class="${s.repeat === x[0] ? 'on good' : ''}">${x[0] ? '↻ ' : ''}${x[1]}</button>`).join('');
    $('#ge-repeat-note').textContent = s.repeat ? `Goes back on the list ${repeatLabel(s.repeat).toLowerCase()} after you clear it.` : '';
  },
  async add(toList) {
    const s = this.state; if (!s.name.trim()) { toast('Type the item name first', true); return; }
    const body = { item: s.name.trim(), note: s.note, store: s.stores.join(', '), priority: s.nice ? 'nice' : '', repeat: s.repeat, list: toList, by: Me.who() };
    this.close(); if (toList) S.gtab = 'need';
    const r = await act('addGrocery', body, { toast: toList ? `${body.item} added to the list 🛒` : `${body.item} saved to your library` });
    if (r && r.existed && toList) { /* server already marked it needed */ }
  },
  async save() {
    const s = this.state; if (!s.name.trim()) { toast('Give the item a name first', true); return; }
    this.close(); await act('updateGrocery', { id: s.id, item: s.name.trim(), note: s.note, store: s.stores.join(', '), priority: s.nice ? 'nice' : '', repeat: s.repeat }, { toast: 'Item updated' });
  },
  async del() { const s = this.state; if (!await Modal.confirm({ icon: '🗑️', title: `Remove ${s.name}?`, body: 'It comes off the library. You can always add it again.', ok: 'Remove', okClass: 'bad' })) return; this.close(); act('deleteGrocery', { id: s.id }, { toast: `Removed ${s.name}` }); },
};
async function shareList() {
  const needed = (S.state.groceries || []).filter(g => gStatus(g) === 'needed');
  const text = groupByStore(needed).map(grp => `${grp.store.toUpperCase()}\n${grp.items.map(g => `☐ ${g.item}${g.note ? ` (${g.note})` : ''}${isNice(g) ? ' ~nice to have' : ''}`).join('\n')}`).join('\n\n');
  if (navigator.share) { try { await navigator.share({ title: 'Shopping list', text }); return; } catch (_) { return; } }
  try { await navigator.clipboard.writeText(text); toast('List copied'); } catch (_) { Modal.confirm({ icon: '🛒', title: 'Shopping list', body: `<pre style="white-space:pre-wrap;font:inherit">${esc(text)}</pre>`, ok: 'Close', noCancel: true }); }
}

/* ======================================================================
   QUESTS
   ====================================================================== */
function renderQuests() {
  const kids = members('kid');
  if (!kids.length) { $('#kid-tabs').innerHTML = ''; $('#quest-grid').innerHTML = `<div class="empty">Add family members with role <b>kid</b> under Parents → Family.</div>`; $('#rewards').innerHTML = ''; return; }
  if (!S.kid || !kids.find(k => k.name === S.kid)) S.kid = (isPhone() && kids.find(k => k.name === Me.name()) || kids[0]).name;
  $('#kid-tabs').innerHTML = kids.map(k => { const b = balance(k.name); return `<button class="kid-tab ${k.name === S.kid ? 'active' : ''}" style="--kid:${esc(k.color || '#f59e0b')}" data-kid="${esc(k.name)}"><span class="av" style="background:${esc(k.color || '#334')}">${esc(k.emoji || '⭐')}</span><span>${esc(k.name)}<div class="pts">${b.approved} pts</div></span></button>`; }).join('');
  const kid = kids.find(k => k.name === S.kid), wknd = [0, 6].includes(new Date().getDay()), order = { available: 0, pending: 1, done: 2 };
  const items = kidQuests(kid.name).filter(q => !(wknd && String(q.repeat).toLowerCase() === 'weekdays')).map(q => ({ q, s: questStatus(q, kid.name) })).sort((a, b) => order[a.s] - order[b.s]);
  const label = { pending: 'WAITING ⏳', done: 'DONE ✓' }, rep = { daily: 'today', weekdays: 'today', weekly: 'this week', biweekly: 'every 2 weeks', monthly: 'this month', once: 'one time' };
  const repTxt = (r) => { const n = everyDays(r); return n ? (n === 1 ? 'today' : `every ${n} days`) : (rep[(r || 'daily').toLowerCase()] || esc(r)); };
  $('#quest-grid').innerHTML = items.length ? items.map(({ q, s }) => { const st = questStreak(q, kid.name).cur, nx = nextPrize(q, st); return `<button class="quest ${s}" data-state="${label[s] || ''}" data-q="${esc(q.id)}" ${s === 'done' ? 'disabled' : ''}>${helpAsked(q, kid.name) ? '<span class="helpflag">🙋</span>' : ''}${st >= 2 ? `<span class="flame">🔥${st}</span>` : ''}<div class="qi">${esc(q.icon || '⭐')}</div><div class="qt">${esc(q.title)}</div>${questOpts(q).auto ? '<div class="auto">✓ no approval needed</div>' : ''}${nx ? `<div class="snext">🔥 ${nx.target - st} more → ${esc(prizeShort(nx.m))}</div>` : ''}<div class="qm"><span>${repTxt(q.repeat)}</span><span class="qp">+${esc(q.points || 0)}</span></div></button>`; }).join('')
    : `<div class="empty">No quests for ${esc(kid.name)} yet.</div>`;
  const b = balance(kid.name), rewards = (S.state.rewards || []).filter(r => r.title && (r.active === '' || r.active === undefined || isTrue(r.active)));
  const cps = couponsFor(kid.name), bestOff = cps.length ? Math.max(...cps.map(c => +c.off || 0)) : 0;
  $('#rewards').innerHTML = `<div class="bal"><div class="l">${esc(kid.name)}'s points</div><div class="n">${b.approved}</div>${b.pending ? `<div class="p">+${b.pending} waiting for approval</div>` : ''}${goalBar(goalFor(kid.name))}</div>
    ${cps.length || prizesFor(kid.name).length ? `<div class="coupons">${cps.map(c => `<span class="coupon" title="${esc(c.label || '')}">🎟️ −${esc(c.off)} pts</span>`).join('')}${prizesFor(kid.name).map(p => `<span class="prize-chip">🏆 ${esc(p.text)}</span>`).join('')}</div>` : ''}
    <div class="sect">Rewards</div>` + (rewards.length ? rewards.map(r => {
      const cost = parseInt(r.cost || 0, 10), eff = Math.max(0, cost - Math.min(bestOff, cost)), lst = lockStatus(r, kid.name), afford = b.approved >= eff;
      const cls = lst.locked ? 'locked' : (X.get('locks', {})[r.id] ? 'sopen' : '') + (afford ? '' : ' cant');
      return `<button class="reward ${cls}" data-r="${esc(r.id)}"><span class="ri">${lst.locked ? '🔒' : esc(r.icon || '🎁')}</span><span class="rt">${esc(r.title)}${lst.text ? `<span class="rsub">${lst.locked ? '' : '🔓 '}${lst.text}</span>` : ''}</span><span class="rc">${eff !== cost ? `<s>${cost}</s>` : ''}${eff} pts</span></button>`;
    }).join('') : `<div class="muted">Add rewards under Parents → Quests &amp; rewards.</div>`);
}
async function tapQuest(qid) {
  const q = (S.state.quests || []).find(x => x.id === qid); if (!q) return;
  const kid = S.kid, auto = !!questOpts(q).auto, pend = pendingEntry(q, kid);
  if (pend) {
    const v = await Modal.confirm({ icon: '⏳', title: q.title, body: `Waiting for a parent to approve.<br>Not actually done yet? Take it back and the check disappears.`, ok: '↩ Take it back', okClass: 'bad', cancel: 'Leave it' });
    if (v === true) await act('withdrawQuest', { id: pend.id }, { toast: 'Unchecked' });
    return;
  }
  const v = await Modal.confirm({ icon: q.icon || '⭐', title: `${q.title} — done?`, body: auto ? `${esc(kid)} gets <b>+${esc(q.points)} points</b> right away.` : `${esc(kid)} will get <b>+${esc(q.points)} points</b> once a parent approves it.`, ok: 'Yes, done!', alt: helpAsked(q, kid) ? '' : '🙋 I need help' });
  if (v === 'alt') { await act('askHelp', { questId: q.id, member: kid }, { toast: `Asked for help with “${q.title}” 🙋` }); return; }
  if (v !== true) return;
  const r = await act('submitQuest', { questId: q.id, member: kid, auto });
  if (r) { toast(auto ? `Nice work, ${kid}! +${q.points} points 🎉` : `Nice work, ${kid}! Waiting for a parent to approve.`); if (auto && r.id) X.merge('auto', { [r.id]: 1 }).catch(() => {}); checkStreaks(); }
}
async function tapReward(rid) {
  const r = (S.state.rewards || []).find(x => x.id === rid); if (!r) return;
  const kid = S.kid, cost = parseInt(r.cost || 0, 10), bal = balance(kid).approved;
  const cps = couponsFor(kid).slice().sort((a, c) => (+c.off || 0) - (+a.off || 0)), cp = cps[0], off = cp ? Math.min(+cp.off || 0, cost) : 0, eff = cost - off;
  const lst = lockStatus(r, kid), isGoal = X.get('goals', {})[kid] === r.id, goalBtn = isGoal ? '✕ Remove goal' : '🎯 Make this my goal';
  const setGoal = () => X.merge('goals', { [kid]: isGoal ? null : r.id }).then(() => { renderQuests(); renderHome(); toast(isGoal ? 'Goal removed' : `🎯 Goal set: ${r.title}`); });
  if (lst.locked) { const v = await Modal.confirm({ icon: '🔒', title: r.title, body: `Unlock it with streaks:<br><b>${esc(lockLabel(X.get('locks', {})[r.id]).replace('🔒 ', ''))}</b><br><br>So far: ${lst.text}`, ok: goalBtn, cancel: 'OK' }); if (v === true) setGoal(); return; }
  if (bal < eff) { const v = await Modal.confirm({ icon: r.icon || '🎁', title: r.title, body: `${esc(kid)} needs <b>${eff - bal} more points</b> for this one.`, ok: goalBtn, cancel: 'OK' }); if (v === true) setGoal(); return; }
  const v = await Modal.confirm({ icon: r.icon || '🎁', title: `Redeem ${r.title}?`, body: off ? `Costs <b>${cost}</b> − 🎟️ <b>${off}</b> coupon = <b>${eff} points</b>, once a parent approves it.` : `This will use <b>${esc(r.cost)} points</b> once a parent approves it.`, ok: 'Redeem', alt: goalBtn });
  if (v === 'alt') { setGoal(); return; } if (v !== true) return;
  const res = await act('redeemReward', { rewardId: r.id, member: kid });
  if (!res) return;
  if (off && cp) {
    try {
      await api('/api/do', { action: 'adjustPoints', member: kid, points: off, reason: `🎟️ Coupon on ${r.title}`, pin: cfg('pin', '') });
      await X.op({ op: 'set', key: 'coupons', value: (X.get('coupons', []) || []).map(c => c && c.id === cp.id ? Object.assign({}, c, { used: new Date().toISOString(), used_on: res.id || '', reward: r.title }) : c) });
    } catch (e2) { toast('Coupon not applied: ' + e2.message, true); }
  }
  if (X.get('locks', {})[r.id]) X.merge('unlocked', { [kid + '|' + r.id]: null }).catch(() => {});
  if (isGoal) X.merge('goals', { [kid]: null }).catch(() => {});
  toast(`Asked for ${r.title} 🎁 — a parent will approve it`); await Sync.refresh();
}

/* ======================================================================
   TO-DO
   ====================================================================== */
function renderTodos() {
  if (isTrue(cfg('todos_require_pin', 'FALSE')) && !S.parent) { $('#todo-list').innerHTML = `<div class="empty">🔒 The to-do list is for parents.<br><button class="btn primary" data-act="todo-unlock" style="margin-top:14px">Enter PIN</button></div>`; $('#tfilters').innerHTML = ''; return; }
  const all = (S.state.todos || []).filter(t => t.task), open = all.filter(t => !isTrue(t.done)), done = all.filter(t => isTrue(t.done)), today = dayKey(new Date());
  const counts = {}, display = {}; open.forEach(t => tagList(t).forEach(tag => { const k = tagKey(tag); counts[k] = (counts[k] || 0) + 1; display[k] = display[k] || tag; }));
  if (S.todoTag && !counts[S.todoTag]) S.todoTag = null;
  const tags = Object.keys(counts).sort((a, b) => counts[b] - counts[a] || a.localeCompare(b));
  const SORTS = [['due', 'Due'], ['name', 'A–Z'], ['who', 'Who'], ['new', 'Newest']];
  $('#tfilters').innerHTML = `<button class="${S.todoTag ? '' : 'on'}" data-tag="">All <span class="n">${open.length}</span></button>` + tags.map(k => `<button class="${S.todoTag === k ? 'on' : ''}" data-tag="${esc(k)}">#${esc(display[k])} <span class="n">${counts[k]}</span></button>`).join('') +
    `<span class="sortlbl">Sort</span>` + SORTS.map(x => `<button class="${S.todoSort === x[0] ? 'on' : ''}" data-sort="${x[0]}">${x[1]}</button>`).join('') + `<button class="toggle ${S.todoShowDone ? 'on' : ''}" id="todo-showdone">${S.todoShowDone ? '✓ Showing done' : 'Show done'} (${done.length})</button>`;
  const match = (t) => !S.todoTag || tagList(t).some(tag => tagKey(tag) === S.todoTag);
  const rank = (t) => t.due ? (t.due < today ? 0 : t.due === today ? 1 : 2) : 3;
  const byDue = (a, b) => rank(a) - rank(b) || (a.due || '9').localeCompare(b.due || '9') || (a.created_at || '').localeCompare(b.created_at || '');
  const sorters = { due: byDue, name: (a, b) => a.task.localeCompare(b.task, undefined, { sensitivity: 'base' }), who: (a, b) => (a.assigned_to || '~').localeCompare(b.assigned_to || '~') || byDue(a, b), new: (a, b) => (b.created_at || '').localeCompare(a.created_at || '') };
  const visOpen = open.filter(match).sort(sorters[S.todoSort] || byDue), visDone = S.todoShowDone ? done.filter(match).sort((a, b) => (b.done_at || '').localeCompare(a.done_at || '')) : [];
  const row = (t) => { const d = isTrue(t.done), cls = d ? 'done' : t.due && t.due < today ? 'overdue' : t.due === today ? 'today' : '', st = subtasksOf(t), sd = st.filter(x => x.d).length, m = memberOf(t.assigned_to);
    return `<button class="todo ${cls}" data-id="${esc(t.id)}"><span class="box" data-check="${esc(t.id)}">${d ? '✓' : ''}</span><span style="min-width:0"><div class="tt">${esc(t.task)}</div><div class="tm">${tagList(t).map(x => `<span class="pill">#${esc(x)}</span>`).join('')}${t.due ? `<span class="due">📅 ${esc(dueLabel(t.due))}</span>` : ''}${t.repeat ? `<span>↻ ${esc(repeatLabel(t.repeat))}</span>` : ''}${st.length ? `<span>☑ ${sd}/${st.length}</span>` : ''}${t.notes ? '<span>📝</span>' : ''}${t.assigned_to ? `<span>${esc(t.assigned_to)}</span>` : ''}</div></span>${m.emoji ? `<span class="who">${esc(m.emoji)}</span>` : ''}</button>`; };
  const groupOf = (t) => { if (!t.due) return ['nodate', 'No date']; if (t.due < today) return ['overdue', 'Overdue']; if (t.due === today) return ['today', 'Today']; if (t.due === dayKey(addDays(new Date(), 1))) return ['tomorrow', 'Tomorrow']; return t.due <= dayKey(addDays(new Date(), 6)) ? ['week', 'This week'] : ['later', 'Later']; };
  let html = '';
  if (S.todoSort === 'due') { let last = ''; for (const t of visOpen) { const [g, lbl] = groupOf(t); if (g !== last) { html += `<div class="tgroup ${g}">${lbl}</div>`; last = g; } html += row(t); } }
  else if (S.todoSort === 'who') { let last = null; for (const t of visOpen) { const w = t.assigned_to || 'Anyone'; if (w !== last) { html += `<div class="tgroup">${esc(w)}</div>`; last = w; } html += row(t); } }
  else html = visOpen.map(row).join('');
  $('#todo-list').innerHTML = (visOpen.length ? html : `<div class="empty">${S.todoTag ? `Nothing open tagged #${esc(display[S.todoTag] || S.todoTag)}` : 'Nothing on the list 🎉'}</div>`) + (visDone.length ? `<div class="sect">Done</div>` + visDone.map(row).join('') : '');
  const dueNow = open.filter(t => t.due && t.due <= today).length;
  $('#todo-count').innerHTML = `${open.length}<small>open${dueNow ? ` · ${dueNow} due now` : ''}</small>`;
}
const TD = {
  id: null,
  task() { return (S.state.todos || []).find(x => x.id === this.id) || null; },
  open(t) { this.id = t.id; this.draw(); Sheet.open('todo-dt'); },
  close() { Sheet.close('todo-dt'); this.id = null; },
  draw() {
    const t = this.task(); if (!t) { this.close(); return; }
    const d = isTrue(t.done), today = dayKey(new Date());
    $('#td-box').textContent = d ? '✓' : ''; $('#td-box').classList.toggle('done', d); $('#td-title').textContent = t.task; $('#td-title').classList.toggle('done', d);
    const late = t.due && t.due < today && !d;
    $('#td-chips').innerHTML = `<button data-td="due" class="${t.due ? (late ? 'late' : '') : 'empty'}">📅 ${t.due ? esc(dueLabel(t.due)) : 'Add due date'}</button><button data-td="repeat" class="${t.repeat ? '' : 'empty'}">↻ ${t.repeat ? esc(repeatLabel(t.repeat)) : 'Repeat'}</button><button data-td="who" class="${t.assigned_to ? '' : 'empty'}">${t.assigned_to ? esc(memberOf(t.assigned_to).emoji || '👤') + ' ' + esc(t.assigned_to) : '👤 Assign'}</button>` + (tagList(t).length ? tagList(t).map(x => `<button data-td="tags">#${esc(x)}</button>`).join('') : `<button data-td="tags" class="empty"># Add tags</button>`);
    const n = $('#td-notes'); n.textContent = t.notes || 'Tap to add notes — measurements, links, what to ask…'; n.classList.toggle('ph', !t.notes);
    const st = subtasksOf(t), sd = st.filter(x => x.d).length;
    $('#td-steps-n').textContent = st.length ? `${sd} of ${st.length} done` : '';
    $('#td-steps').innerHTML = st.map((x, i) => `<div class="step ${x.d ? 'd' : ''}"><button class="sb" data-step="${i}">${x.d ? '✓' : ''}</button><button class="st" data-stepedit="${i}">${esc(x.t)}</button><button class="sx" data-stepdel="${i}">✕</button></div>`).join('');
    const w = (iso) => iso ? toDate(iso).toLocaleDateString([], { month: 'short', day: 'numeric' }) : '';
    $('#td-meta').textContent = `${t.added_by ? 'Added by ' + t.added_by : 'Added'}${t.created_at ? ' · ' + w(t.created_at) : ''}${d && t.done_at ? ' · done ' + w(t.done_at) : ''}`;
  },
  async saveSteps(st) { const t = this.task(); if (!t) return; t.subtasks = JSON.stringify(st); this.draw(); renderTodos(); await act('updateTodo', { id: t.id, subtasks: t.subtasks }); },
  async complete() {
    const t = this.task(); if (!t) return;
    if (t.repeat && !isTrue(t.done)) { const nd = nextDue(t.due, t.repeat); t.due = nd; this.draw(); renderTodos(); act('setTodoDone', { id: t.id, done: true }, { toast: `Done ✓ — next: ${dueLabel(nd)}` }); return; }
    t.done = isTrue(t.done) ? 'FALSE' : 'TRUE'; t.done_at = isTrue(t.done) ? new Date().toISOString() : ''; this.draw(); renderTodos();
    act('setTodoDone', { id: t.id, done: isTrue(t.done) }, { toast: isTrue(t.done) ? 'Done ✓' : 'Reopened' });
  },
};
const TE = {
  state: null,
  open(t, preset) {
    this.state = t ? { id: t.id, task: t.task, tags: tagList(t), due: t.due || '', who: t.assigned_to || '', repeat: t.repeat || '' } : Object.assign({ task: '', tags: S.todoTag ? [S.todoTag] : [], due: '', who: '', repeat: '' }, preset || {});
    $('#te-title').textContent = t ? 'Edit task' : 'New task'; this.draw(); Sheet.open('todo-ed'); if (!t) setTimeout(() => this.editTask(), 80);
  },
  close() { Sheet.close('todo-ed'); this.state = null; },
  allTags() { const seen = {}, out = []; (S.state.todos || []).forEach(t => tagList(t).forEach(x => { if (!seen[tagKey(x)]) { seen[tagKey(x)] = 1; out.push(x); } })); this.state.tags.forEach(x => { if (!seen[tagKey(x)]) { seen[tagKey(x)] = 1; out.push(x); } }); return out.sort((a, b) => a.localeCompare(b)); },
  draw() {
    const s = this.state; if (!s) return;
    const tf = $('#te-task'); tf.textContent = s.task || 'Tap to type the task…'; tf.classList.toggle('ph', !s.task);
    $('#te-tags').innerHTML = this.allTags().map(x => `<button data-tag="${esc(x)}" class="${s.tags.some(y => tagKey(y) === tagKey(x)) ? 'on info' : ''}">#${esc(x)}</button>`).join('') + `<button class="newtag" data-newtag>＋ tag</button>`;
    const now = new Date(), d = (n) => dayKey(addDays(now, n)), sat = (6 - now.getDay() + 7) % 7 || 7, mon = (8 - now.getDay()) % 7 || 7;
    const opts = [['', 'No date'], [d(0), 'Today'], [d(1), 'Tomorrow'], [d(sat), 'Saturday'], [d(mon), 'Next Mon']], custom = s.due && !opts.some(o => o[0] === s.due);
    $('#te-due').innerHTML = opts.map(o => `<button data-due="${o[0]}" class="${s.due === o[0] ? 'on' : ''}">${o[1]}</button>`).join('') + `<button data-pickdate class="${custom ? 'on' : ''}">📅 ${custom ? esc(new Date(s.due + 'T12:00:00').toLocaleDateString([], { month: 'short', day: 'numeric' })) : 'Pick…'}</button>`;
    $('#te-who').innerHTML = `<button data-who="" class="${!s.who ? 'on' : ''}">Anyone</button>` + members('parent').map(m => `<button data-who="${esc(m.name)}" class="${s.who === m.name ? 'on' : ''}">${esc(m.emoji)} ${esc(m.name)}</button>`).join('');
    const known = REPEATS.some(x => x[0] === s.repeat);
    $('#te-repeat').innerHTML = REPEATS.map(x => `<button data-repeat="${x[0]}" class="${s.repeat === x[0] ? 'on good' : ''}">${x[1]}</button>`).join('') + `<button data-repeat-custom class="${!known && s.repeat ? 'on good' : 'newtag'}">${!known && s.repeat ? '↻ ' + esc(repeatLabel(s.repeat)) : '＋ every N days'}</button>`;
    $('#te-repeat-note').textContent = s.repeat ? `Checking it off moves it to the next date${s.due ? '' : ' (starting from today)'} instead of finishing it.` : '';
  },
  async editTask() { const v = await KB.open({ title: 'What needs doing? (#tags welcome)', initial: this.state.task, placeholder: 'e.g. Call the plumber #house' }); if (v === null || !this.state) return; const { clean, tags } = extractHashtags(v); this.state.task = clean; tags.forEach(x => { if (!this.state.tags.some(y => tagKey(y) === tagKey(x))) this.state.tags.push(x); }); this.draw(); },
  async save() {
    const s = this.state; if (!s.task) { toast('Give the task a name first', true); return; }
    const body = { task: s.task, tags: s.tags.join(', '), assigned_to: s.who, due: s.due, repeat: s.repeat }; this.close();
    if (s.id) await act('updateTodo', Object.assign({ id: s.id }, body), { toast: 'Task updated' }); else await act('addTodo', Object.assign({ by: Me.who() }, body), { toast: 'Task added' });
    if (TD.id) TD.draw();
  },
};
