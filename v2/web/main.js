/* Family Quest Board v2 — event wiring and boot */
'use strict';

const on = (el, ev, fn, opts) => el.addEventListener(ev, fn, opts);
const num = async (title, initial, lo, hi) => { const v = await KB.open({ title, initial: String(initial), placeholder: `${lo}–${hi}`, inputMode: 'numeric' }); if (v === null) return null; const n = parseFloat(v); return isNaN(n) ? null : Math.min(hi, Math.max(lo, n)); };
async function pickTime(initial) { const v = await KB.open({ title: 'Time (24h, e.g. 20:30)', initial: initial || '', placeholder: 'HH:MM' }); if (v === null) return null; const m = /^(\d{1,2}):?(\d{2})$/.exec(v.trim()); if (!m || +m[1] > 23 || +m[2] > 59) { toast('Use HH:MM, like 20:30', true); return null; } return `${pad(+m[1])}:${m[2]}`; }
function longPress(root, selector, fn, guard) {
  let t = null, x0 = 0, y0 = 0, fired = false; const stop = () => { clearTimeout(t); t = null; };
  on(root, 'pointerdown', e => { if (guard && !guard()) return; const b = e.target.closest(selector); if (!b) return; x0 = e.clientX; y0 = e.clientY; fired = false; stop(); t = setTimeout(() => { t = null; fired = true; fn(b); }, 650); });
  ['pointerup', 'pointercancel', 'pointerleave'].forEach(ev => on(root, ev, stop));
  on(root, 'pointermove', e => { if (t && Math.abs(e.clientX - x0) + Math.abs(e.clientY - y0) > 10) stop(); });
  on(root, 'contextmenu', e => { if (e.target.closest(selector)) e.preventDefault(); });
  return () => { const f = fired; fired = false; return f; };
}

function bind() {
  on(document, 'pointerdown', () => { bumpIdle(); if (!isPhone() && Display.applied && Display.applied !== 'photos') Display.wake(); }, { passive: true });
  on($('#sleep'), 'click', () => Display.wake());
  on($('#nav'), 'click', e => { const b = e.target.closest('.navbtn'); if (b) showScreen(b.dataset.screen); });
  on($('#msg-banner'), 'click', () => { const cid = $('#msg-banner').dataset.cid; $('#msg-banner').classList.remove('on'); if (cid) { showScreen('messages'); Msg.open(cid); } });
  // keyboard
  on($('#kb-rows'), 'click', e => { const b = e.target.closest('[data-k]'); if (b) KB.press(b.dataset.k); });
  on($('#kb-input'), 'keydown', e => { if (e.key === 'Enter') { e.preventDefault(); KB.press('done'); } if (e.key === 'Escape') KB.press('cancel'); });
  on($('#kb-area'), 'keydown', e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) KB.press('done'); if (e.key === 'Escape') KB.press('cancel'); });
  on($('#kb'), 'click', e => { if (e.target.id === 'kb') KB.press('cancel'); });
  // PIN, modal, sheets
  on($('#pinpad'), 'click', e => { const b = e.target.closest('[data-pin]'); if (b) Parent.key(b.dataset.pin); else if (e.target.id === 'pinpad') Parent.close(false); });
  on($('#modal'), 'click', e => { if (e.target.closest('#m-ok')) Modal.close(true); else if (e.target.closest('#m-cancel')) Modal.close(false); else if (e.target.closest('#m-alt')) Modal.close('alt'); else if (e.target.closest('[data-pick]')) Modal.close(e.target.closest('[data-pick]').dataset.pick); else if (e.target.id === 'modal') Modal.close(false);
    const cl = e.target.closest('[data-claim]'); if (cl) { const row = cl.closest('.claimrow'); X.merge('claims', { [row.dataset.evk]: cl.dataset.claim || null }).then(() => { Modal.close(true); render(); toast(cl.dataset.claim ? `${cl.dataset.claim} has it ✓` : 'Cleared'); }); } });
  on(document, 'click', e => { const c = e.target.closest('[data-close]'); if (c) { Sheet.close(c.dataset.close); if (c.dataset.close === 'todo-dt') TD.id = null; } });
  $$('.sheet').forEach(sh => on(sh, 'click', e => { if (e.target === sh && sh.id !== 'pinpad') { Sheet.close(sh.id); if (sh.id === 'todo-dt') TD.id = null; } }));

  /* ---------- generic actions ---------- */
  on(document, 'click', async e => {
    const a = e.target.closest('[data-act]'); if (!a) return;
    const act_ = a.dataset.act;
    if (act_ === 'note-add') return addNote();
    if (act_ === 'note-open') return removeNote(a.dataset.id);
    if (act_ === 'parent-unlock' || act_ === 'todo-unlock') { if (await Parent.ask()) render(); return; }
    if (act_ === 'quest-add') return QE.open('quest', null);
    if (act_ === 'reward-add') return QE.open('reward', null);
    if (act_ === 'member-add') return ME.open(null);
    if (act_ === 'disp-add') return DE.open(null);
    if (act_ === 'bonus-reason') { const v = await KB.open({ title: 'Reason', initial: S.bonus.reason, placeholder: 'e.g. Helped grandma' }); if (v !== null) { S.bonus.reason = v; renderParent(); } return; }
    if (act_ === 'bonus-go') { if (!S.bonus.member) return; if (await act('adjustPoints', { member: S.bonus.member, points: S.bonus.points, reason: S.bonus.reason || 'Bonus' }, { toast: 'Points updated' })) { S.bonus.reason = ''; renderParent(); } return; }
    if (act_ === 'cfg-units') return setConfig('weather_units', cfg('weather_units', 'F') === 'C' ? 'F' : 'C').then(loadWeather);
    if (act_ === 'feed-add') { const name = await KB.open({ title: 'Calendar name (e.g. Family)', placeholder: 'Family' }); if (name === null) return; const url = await KB.open({ title: 'iCal link (https://…)', placeholder: 'https://calendar.google.com/calendar/ical/…/basic.ics' }); if (!url || !/^https?:\/\//.test(url.trim())) { if (url !== null) toast('That doesn’t look like a link', true); return; } const cur = String(cfg('ical_urls', '')).trim(); await setConfig('ical_urls', (cur ? cur + '\n' : '') + `${name.trim() || 'Calendar'} | ${url.trim()}`, 'Calendar added — loading events'); await fetch('/api/events?refresh=1').catch(() => {}); await Sync.refresh(); return; }
    if (act_ === 'cal-refresh') { toast('Refreshing calendars…'); await fetch('/api/events?refresh=1').catch(() => {}); S.cal = 0; await Sync.refresh(); renderParent(); return; }
    if (act_ === 'notify-test') { toast('Sending…'); try { const j = await api('/api/notify', { kind: 'test', title: '🏰 Family Quest Board', message: 'Push alerts are working!', force: true, go: 'go/home' }); toast('Push sent ✓ ' + (j.detail || '')); } catch (e2) { toast('Push failed: ' + e2.message, true); } return; }
    if (act_ === 'msg-toggle') return setConfig('messages_enabled', Msg.enabled() ? 'FALSE' : 'TRUE', Msg.enabled() ? 'Messages off' : 'Messages on');
    if (act_ === 'msg-full') return setConfig('msg_fulltext', isTrue(cfg('msg_fulltext', 'TRUE')) ? 'FALSE' : 'TRUE');
    if (act_ === 'msg-clear') { if (!await Modal.confirm({ icon: '🧹', title: 'Clear all messages?', body: 'The chat history is removed from the wall and every phone.', ok: 'Clear', okClass: 'bad' })) return; await X.op({ op: 'set', key: 'messages', value: [] }); Msg.knownIds = new Set(); Msg.cur = null; render(); toast('Messages cleared'); return; }
    if (act_ === 'set-access') { const v = await KB.open({ title: 'Family password for internet access', placeholder: 'at least 6 characters' }); if (v === null) return; if (v.trim().length < 6) { toast('Use at least 6 characters', true); return; } try { await api('/api/access', { password: v.trim() }); toast('Password set — everyone outside has to sign in again'); await Sync.refresh(); } catch (e2) { toast(e2.message, true); } return; }
    if (act_ === 'set-access-off') { if (!await Modal.confirm({ icon: '🌐', title: 'Turn off internet access?', body: 'The board stops answering from outside the house until you set a password again.', ok: 'Turn off', okClass: 'bad' })) return; await api('/api/access', { password: '' }); toast('Internet access off'); await Sync.refresh(); return; }
    if (act_ === 'todo-pin') return setConfig('todos_require_pin', isTrue(cfg('todos_require_pin', 'FALSE')) ? 'FALSE' : 'TRUE');
    if (act_ === 'week-monday') return setConfig('week_starts_monday', isTrue(cfg('week_starts_monday', 'TRUE')) ? 'FALSE' : 'TRUE');
    if (act_ === 'photos-rescan') { await Photos.rescan(); await Sync.refresh(); toast(`${Photos.list.length} photos`); return; }
    if (act_ === 'import-v1') {
      const sv = S.server || {};
      let url = '';
      if (!sv.v1_script) { url = await KB.open({ title: 'v1 Google script address (…/exec) — leave blank to import only the Pi data', placeholder: 'https://script.google.com/macros/s/…/exec' }); if (url === null) return; }
      if (!await Modal.confirm({ icon: '⬇️', title: 'Import from v1?', body: '<b>Everything in v2 is replaced</b> with a fresh copy of the v1 Sheet, Pi data and photos. Anything you did in v2 is lost. v1 itself is not touched.', ok: 'Import', okClass: 'bad' })) return;
      try { await api('/api/import', { script_url: url.trim() }); toast('Importing…'); const poll = setInterval(async () => { await Sync.refresh(); const st = (S.state && S.state.import) || {}; renderParent(); if (!st.running) { clearInterval(poll); toast(st.ok ? 'Import finished ✓' : 'Import failed: ' + st.error, !st.ok); S.parent = false; await Parent.ask(); render(); } }, 1500); } catch (e2) { toast(e2.message, true); }
      return;
    }
    if (act_ === 'reset-demo') { if (!await Modal.confirm({ icon: '♻️', title: 'Reset to starter data?', body: 'Wipes v2 and loads the sample family. v1 is not touched.', ok: 'Reset', okClass: 'bad' })) return; await act('resetDemo', {}, { toast: 'Reset' }); location.reload(); return; }
    if (act_ === 'reload') return location.reload();
  });
  on(document, 'click', async e => {
    const s = e.target.closest('[data-sys]'); if (!s) return;
    const act_ = s.dataset.sys, labels = { restart_app: 'Restart the board app?', exit_app: 'Close the board app for an hour?', reboot: 'Reboot the Pi?' };
    if (!await Modal.confirm({ icon: '⚙️', title: labels[act_], ok: 'Yes', okClass: act_ === 'reboot' ? 'bad' : 'primary' })) return;
    try { const j = await api('/api/system', { action: act_ }); toast(j.message); } catch (e2) { toast(e2.message, true); }
  });
  on(document, 'click', async e => {
    const b = e.target.closest('[data-cfgtext],[data-cfgnum],[data-cfgpin],[data-cfg],[data-nev],[data-feeddel]'); if (!b) return;
    if (b.dataset.cfgpin !== undefined) { const v = await KB.open({ title: 'New 4-digit parent PIN', placeholder: '1234', inputMode: 'numeric' }); if (v === null) return; if (!/^\d{4}$/.test(v.trim())) { toast('Use exactly 4 digits', true); return; } await setConfig('pin', v.trim(), 'PIN changed — every phone will ask again'); S.parent = false; await Parent.ask(); render(); return; }
    if (b.dataset.cfgtext) { const keys = b.dataset.cfgtext.split(','); for (const k of keys) { const v = await KB.open({ title: k.replace(/_/g, ' ').replace('msg topic ', '') + (k.startsWith('msg_topic') ? '’s ntfy topic' : ''), initial: cfg(k, ''), placeholder: k === 'lat' ? '34.05' : k === 'lon' ? '-118.24' : '' }); if (v === null) return; await setConfig(k, v.trim()); } if (keys.includes('lat')) loadWeather(); return; }
    if (b.dataset.cfgnum) { const v = await num('Days ahead to load', cfg('calendar_days', '14'), 7, 90); if (v !== null) { await setConfig('calendar_days', String(Math.round(v))); fetch('/api/events?refresh=1').then(() => Sync.refresh()).catch(() => {}); } return; }
    if (b.dataset.cfg) { const k = b.dataset.cfg, ranges = { touch_wake_min: [0.5, 60, 'Minutes a touch keeps the board awake'], idle_timeout_sec: [20, 600, 'Seconds before going back home'], photo_interval_sec: [5, 300, 'Seconds per photo'], clock_dim: [10, 100, 'Dim clock brightness %'] }[k]; const v = await num(ranges[2], cfg(k, ''), ranges[0], ranges[1]); if (v !== null) { await setConfig(k, String(v)); Display.tick(); Photos.start(); } return; }
    if (b.dataset.nev) { const k = b.dataset.nev, cur = String(cfg('notify_events', 'quest,help,reward,streak')).split(',').map(x => x.trim()).filter(Boolean); const i = cur.indexOf(k); if (i >= 0) cur.splice(i, 1); else cur.push(k); await setConfig('notify_events', cur.join(','), i >= 0 ? 'Alert off' : 'Alert on'); return; }
    if (b.dataset.feeddel !== undefined) { const lines = String(cfg('ical_urls', '')).split('\n').map(x => x.trim()).filter(Boolean); lines.splice(+b.dataset.feeddel, 1); await setConfig('ical_urls', lines.join('\n'), 'Calendar removed'); S.cal = 0; await Sync.refresh(); return; }
  });

  /* ---------- calendar ---------- */
  on($('#cal-bar'), 'click', e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.cal === 'prev') Cal.offset--; else if (b.dataset.cal === 'next') Cal.offset++; else if (b.dataset.cal === 'today') Cal.offset = 0;
    else if (b.dataset.calview) { Cal.view = b.dataset.calview; Cal.offset = 0; Cal.save(); } else if (b.id === 'cal-add') { EE.open(null); return; }
    renderCalendar();
  });
  on($('#cal-cals'), 'click', e => { const b = e.target.closest('[data-calname]'); if (!b) return; const n = b.dataset.calname, i = Cal.hidden.indexOf(n); if (i >= 0) Cal.hidden.splice(i, 1); else Cal.hidden.push(n); Cal.save(); renderCalendar(); renderHome(); });
  on($('#cal-wrap'), 'click', e => {
    const ev = e.target.closest('[data-ev]'); if (ev) { showEvent(S.calIndex[+ev.dataset.ev]); return; }
    const td = e.target.closest('[data-todo]'); if (td) { const t = (S.state.todos || []).find(x => x.id === td.dataset.todo); if (t) TD.open(t); return; }
    const cell = e.target.closest('.mcell, .cal-day'); if (cell) showDay(cell.dataset.day);
  });
  on($('#ev-ed'), 'click', async e => {
    const s = EE.state; if (!s) return;
    if (e.target.closest('#ee-name')) return EE.editTitle();
    if (e.target.closest('#ee-note')) { const v = await KB.open({ title: 'Note', initial: s.note, placeholder: 'Anything useful' }); if (v !== null && EE.state) { EE.state.note = v; EE.draw(); } return; }
    if (e.target.closest('#ee-save')) return EE.save(); if (e.target.closest('#ee-del')) return EE.del();
    const k = e.target.closest('[data-ekind]'); if (k) { s.kind = k.dataset.ekind; EE.draw(); return; }
    const d = e.target.closest('[data-edate]'); if (d) { s.date = d.dataset.edate; EE.draw(); return; }
    if (e.target.closest('[data-epickdate]')) { const v = await pickDate(s.date); if (v && EE.state) { EE.state.date = v; EE.draw(); } return; }
    const t = e.target.closest('[data-etime]'); if (t) { s.time = t.dataset.etime; EE.draw(); return; }
    if (e.target.closest('[data-epicktime]')) { const v = await pickTime(s.time); if (v && EE.state) { EE.state.time = v; EE.draw(); } return; }
    const w = e.target.closest('[data-ewho]'); if (w) { s.who = w.dataset.ewho; EE.draw(); return; }
    const r = e.target.closest('[data-erep]'); if (r) { s.repeat = r.dataset.erep; EE.draw(); return; }
  });

  /* ---------- groceries ---------- */
  on($('.gtabs'), 'click', e => { const b = e.target.closest('.gtab'); if (b) { S.gtab = b.dataset.gtab; S.gKeep = []; renderGroceries(); } });
  on($('#gfilters'), 'click', e => { if (e.target.closest('#groc-essonly')) { S.gEssOnly = !S.gEssOnly; renderGroceries(); return; } const b = e.target.closest('[data-store]'); if (b) { S.gStore = b.dataset.store || null; renderGroceries(); } });
  on($('#groc-add'), 'click', () => GE.open(null, ''));
  on($('#groc-send'), 'click', shareList);
  on($('#groc-clear'), 'click', async () => {
    if (S.gtab === 'store') { await act('clearPurchased', {}, { toast: 'Cart cleared ✓' }); return; }
    const needed = (S.state.groceries || []).filter(g => gStatus(g) !== ''), keep = S.gKeep.filter(id => needed.some(g => g.id === id));
    if (!await Modal.confirm({ icon: '🧹', title: keep.length ? `Clear all but ${keep.length}?` : 'Clear the list?', body: keep.length ? 'Kept items stay on the list; everything else is marked stocked.' : 'Everything is marked stocked. Weekly staples come back on their own.', ok: 'Clear' })) return;
    S.gKeep = []; await act('clearList', { keep }, { toast: 'List cleared' });
  });
  const gPressed = longPress($('#groc-list'), '.gchip, .gitem, .sitem:not([data-restore])', (b) => { const g = (S.state.groceries || []).find(x => x.id === b.dataset.id); if (g) GE.open(g); });
  on($('#groc-list'), 'click', e => {
    if (gPressed()) return;
    if (e.target.closest('[data-toggle-cleared]')) { S.clearedOpen = !S.clearedOpen; renderGroceries(); return; }
    const rs = e.target.closest('[data-restore]'); if (rs) { const g = (S.state.groceries || []).find(x => x.id === rs.dataset.restore); if (g) { g.status = 'needed'; delete S.clearedAt[g.id]; ls.set('fqb2_cleared', S.clearedAt); renderGroceries(); Outbox.send('setGroceryStatus', { id: g.id, status: 'needed' }); toast(`${g.item} is back on the list`); } return; }
    const b = e.target.closest('.gchip, .gitem, .sitem'); if (!b) return;
    const g = (S.state.groceries || []).find(x => x.id === b.dataset.id); if (!g) return;
    if (S.gtab === 'store') { g.status = 'cart'; S.clearedAt[g.id] = Date.now(); ls.set('fqb2_cleared', S.clearedAt); renderGroceries(); Outbox.send('setGroceryStatus', { id: g.id, status: 'cart' }); return; }
    if (S.gtab === 'need') { const i = S.gKeep.indexOf(g.id); if (i >= 0) S.gKeep.splice(i, 1); else S.gKeep.push(g.id); renderGroceries(); return; }
    const next = gStatus(g) === '' ? 'needed' : ''; g.status = next; renderGroceries(); act('setGroceryStatus', { id: g.id, status: next });
  });
  const rail = $('#letter-rail'), bubble = $('#letter-bubble');
  const railAt = (y) => { const r = rail.getBoundingClientRect(), i = Math.floor((y - r.top) / r.height * LETTERS.length); return LETTERS[Math.min(LETTERS.length - 1, Math.max(0, i))]; };
  const railMove = (e) => { const L = railAt(e.clientY); let k = LETTERS.indexOf(L); while (k >= 0 && !jumpToLetter(LETTERS[k])) k--; bubble.textContent = L; bubble.classList.add('on'); const r = rail.getBoundingClientRect(); bubble.style.left = (r.left - 130) + 'px'; bubble.style.top = Math.min(window.innerHeight - 120, Math.max(10, e.clientY - 55)) + 'px'; };
  on(rail, 'pointerdown', e => { rail.setPointerCapture(e.pointerId); railMove(e); });
  on(rail, 'pointermove', e => { if (e.buttons) railMove(e); });
  ['pointerup', 'pointercancel'].forEach(ev => on(rail, ev, () => bubble.classList.remove('on')));
  on($('#groc-ed'), 'click', async e => {
    const s = GE.state; if (!s) return;
    if (e.target.closest('#ge-name')) return GE.editName();
    if (e.target.closest('#ge-note')) { const v = await KB.open({ title: 'Note', initial: s.note, placeholder: 'brand, size, flavor…' }); if (v !== null && GE.state) { GE.state.note = v; GE.draw(); } return; }
    if (e.target.closest('#ge-save')) return GE.save(); if (e.target.closest('#ge-addlist')) return GE.add(true); if (e.target.closest('#ge-addlib')) return GE.add(false); if (e.target.closest('#ge-del')) return GE.del();
    const st = e.target.closest('[data-store]'); if (st) { const x = st.dataset.store; if (!x) s.stores = []; else { const i = s.stores.findIndex(y => y.toLowerCase() === x.toLowerCase()); if (i >= 0) s.stores.splice(i, 1); else s.stores.push(x); } GE.draw(); return; }
    if (e.target.closest('[data-newstore]')) { const v = await KB.open({ title: 'New store', placeholder: 'e.g. Costco' }); if (v && GE.state && !GE.state.stores.some(y => y.toLowerCase() === v.toLowerCase())) GE.state.stores.push(v.trim()); GE.draw(); return; }
    const p = e.target.closest('[data-prio]'); if (p) { s.nice = p.dataset.prio === 'nice'; GE.draw(); return; }
    const r = e.target.closest('[data-grepeat]'); if (r) { s.repeat = r.dataset.grepeat; GE.draw(); return; }
  });

  /* ---------- quests ---------- */
  on($('#kid-tabs'), 'click', e => { const b = e.target.closest('.kid-tab'); if (b) { S.kid = b.dataset.kid; renderQuests(); } });
  on($('#quest-grid'), 'click', e => { const b = e.target.closest('.quest'); if (b && !b.disabled) tapQuest(b.dataset.q); });
  on($('#rewards'), 'click', e => { const b = e.target.closest('.reward'); if (b) tapReward(b.dataset.r); });

  /* ---------- to-do ---------- */
  on($('#todo-add'), 'click', () => TE.open(null));
  on($('#tfilters'), 'click', e => { if (e.target.closest('#todo-showdone')) { S.todoShowDone = !S.todoShowDone; renderTodos(); return; } const t = e.target.closest('[data-tag]'); if (t) { S.todoTag = t.dataset.tag || null; renderTodos(); return; } const s = e.target.closest('[data-sort]'); if (s) { S.todoSort = s.dataset.sort; renderTodos(); } });
  on($('#todo-list'), 'click', e => {
    const c = e.target.closest('[data-check]'); if (c) { TD.id = c.dataset.check; TD.complete(); TD.id = null; return; }
    const b = e.target.closest('.todo'); if (b) { const t = (S.state.todos || []).find(x => x.id === b.dataset.id); if (t) TD.open(t); }
  });
  on($('#todo-dt'), 'click', async e => {
    const t = TD.task(); if (!t) return;
    if (e.target.closest('#td-box')) return TD.complete();
    if (e.target.closest('#td-title')) { const v = await KB.open({ title: 'Task', initial: t.task }); if (v && v.trim()) { t.task = v.trim(); TD.draw(); renderTodos(); act('updateTodo', { id: t.id, task: t.task }); } return; }
    if (e.target.closest('#td-notes')) { const v = await KB.open({ title: 'Notes', initial: t.notes || '', multiline: true, placeholder: 'Anything useful for whoever does this…' }); if (v !== null) { t.notes = v; TD.draw(); renderTodos(); act('updateTodo', { id: t.id, notes: v }); } return; }
    if (e.target.closest('#td-edit')) return TE.open(t); if (e.target.closest('#td-del')) { if (!await Modal.confirm({ icon: '🗑️', title: `Delete “${t.task}”?`, ok: 'Delete', okClass: 'bad' })) return; TD.close(); act('deleteTodo', { id: t.id }, { toast: 'Deleted' }); return; }
    if (e.target.closest('#td-addstep')) { const v = await KB.open({ title: 'Add a step', placeholder: 'e.g. Buy the paint' }); if (v && v.trim()) TD.saveSteps(subtasksOf(t).concat([{ t: v.trim(), d: false }])); return; }
    const sb = e.target.closest('[data-step]'); if (sb) { const st = subtasksOf(t); st[+sb.dataset.step].d = !st[+sb.dataset.step].d; TD.saveSteps(st); return; }
    const se = e.target.closest('[data-stepedit]'); if (se) { const st = subtasksOf(t); const v = await KB.open({ title: 'Step', initial: st[+se.dataset.stepedit].t }); if (v !== null) { if (v.trim()) st[+se.dataset.stepedit].t = v.trim(); else st.splice(+se.dataset.stepedit, 1); TD.saveSteps(st); } return; }
    const sx = e.target.closest('[data-stepdel]'); if (sx) { const st = subtasksOf(t); st.splice(+sx.dataset.stepdel, 1); TD.saveSteps(st); return; }
    const ch = e.target.closest('[data-td]'); if (ch) {
      const k = ch.dataset.td;
      if (k === 'due') { const v = await pickDate(t.due); if (v !== null) { t.due = v; TD.draw(); renderTodos(); act('updateTodo', { id: t.id, due: v }); } }
      else if (k === 'repeat') { const v = await Modal.pick({ icon: '↻', title: 'Repeat', options: REPEATS.map(r => ({ value: r[0], label: r[1], on: (t.repeat || '') === r[0] })) }); if (v !== null && v !== undefined && v !== false) { t.repeat = v; TD.draw(); renderTodos(); act('updateTodo', { id: t.id, repeat: v }); } }
      else if (k === 'who') { const v = await Modal.pick({ icon: '👤', title: 'Who’s on it?', options: [{ value: '', label: 'Anyone', on: !t.assigned_to }].concat(members('parent').map(m => ({ value: m.name, label: `${m.emoji} ${m.name}`, on: t.assigned_to === m.name }))) }); if (v !== null && v !== undefined && v !== false) { t.assigned_to = v; TD.draw(); renderTodos(); act('updateTodo', { id: t.id, assigned_to: v }); } }
      else if (k === 'tags') { const v = await KB.open({ title: 'Tags (comma separated)', initial: tagList(t).join(', '), placeholder: 'house, calls' }); if (v !== null) { t.tags = v; TD.draw(); renderTodos(); act('updateTodo', { id: t.id, tags: v }); } }
    }
  });
  on($('#todo-ed'), 'click', async e => {
    const s = TE.state; if (!s) return;
    if (e.target.closest('#te-task')) return TE.editTask(); if (e.target.closest('#te-save')) return TE.save();
    const tg = e.target.closest('[data-tag]'); if (tg) { const x = tg.dataset.tag, i = s.tags.findIndex(y => tagKey(y) === tagKey(x)); if (i >= 0) s.tags.splice(i, 1); else s.tags.push(x); TE.draw(); return; }
    if (e.target.closest('[data-newtag]')) { const v = await KB.open({ title: 'New tag', placeholder: 'e.g. garden' }); if (v && TE.state) { const x = v.trim().replace(/^#/, ''); if (x && !s.tags.some(y => tagKey(y) === tagKey(x))) s.tags.push(x); TE.draw(); } return; }
    const d = e.target.closest('[data-due]'); if (d) { s.due = d.dataset.due; TE.draw(); return; }
    if (e.target.closest('[data-pickdate]')) { const v = await pickDate(s.due); if (v && TE.state) { TE.state.due = v; TE.draw(); } return; }
    const w = e.target.closest('[data-who]'); if (w) { s.who = w.dataset.who; TE.draw(); return; }
    const r = e.target.closest('[data-repeat]'); if (r) { s.repeat = r.dataset.repeat; TE.draw(); return; }
    if (e.target.closest('[data-repeat-custom]')) { const n = await num('Every how many days?', 3, 1, 365); if (n !== null && TE.state) { TE.state.repeat = 'every:' + Math.round(n); TE.draw(); } }
  });

  /* ---------- messages ---------- */
  on($('#chat'), 'click', async e => {
    if (e.target.closest('[data-delconvo]') && Msg.cur && !isPhone()) return Msg.deleteConvo(Msg.cur);
    const sm = e.target.closest('[data-setme]'); if (sm) { Me.set(sm.dataset.setme); if (Msg.cur && !Msg.mine(Msg.cur)) Msg.cur = null; render(); return; }
    if (e.target.closest('[data-changeme]')) { e.preventDefault(); Me.set(''); Msg.cur = null; render(); return; }
    const cv = e.target.closest('[data-convo]'); if (cv) return Msg.open(cv.dataset.convo);
    if (e.target.closest('[data-back]')) return Msg.back();
    if (e.target.closest('[data-newchat]')) {
      const me = Msg.me(); let a = me;
      if (!a) a = await Modal.pick({ icon: '💬', title: 'Who’s writing?', options: members().map(m => ({ value: m.name, label: `${m.emoji || '👤'} ${m.name}` })) }); if (!a) return;
      const b = await Modal.pick({ icon: '💬', title: `${a} → who?`, options: members().filter(m => m.name !== a).map(m => ({ value: m.name, label: `${m.emoji || '👤'} ${m.name}` })).concat([{ value: 'Family', label: '👨‍👩‍👧 Everyone (Family)' }]) }); if (!b) return;
      Msg.open(b === 'Family' ? FAMILY : convoId(a, b)); if (a !== me) (Msg.draft[Msg.cur] = Msg.draft[Msg.cur] || {}).as = a; renderMessages(); return;
    }
    const as = e.target.closest('[data-as]'); if (as && Msg.cur) { (Msg.draft[Msg.cur] = Msg.draft[Msg.cur] || {}).as = as.dataset.as; renderMessages(); return; }
    const q = e.target.closest('[data-mquick]'); if (q && Msg.cur) return Msg.send(q.dataset.mquick);
    if (e.target.closest('#msg-send') && Msg.cur) return Msg.send();
    if (e.target.closest('#msg-type') && Msg.cur) { const d = Msg.draft[Msg.cur] = Msg.draft[Msg.cur] || {}; const v = await KB.open({ title: `${Msg.sender(Msg.cur)} → ${Msg.title(Msg.cur)}`, initial: d.text || '', placeholder: 'Type a message', multiline: true }); if (v !== null) { d.text = v; if (v.trim()) await Msg.send(v); else renderMessages(); } }
  });
  longPress($('#chat-pane'), '.bub[data-mid]', (b) => { if (b.dataset.mid) Msg.deleteOne(b.dataset.mid); }, () => !isPhone());

  /* ---------- parents ---------- */
  on($('#ptabs'), 'click', e => { const b = e.target.closest('.ptab'); if (b) { S.ptab = b.dataset.ptab; renderParent(); } });
  on($('#parent-lockbtn'), 'click', () => { Parent.lock(); showScreen('home'); });
  on($('#pbody'), 'click', async e => {
    const rv = e.target.closest('[data-review]'); if (rv) {
      rv.closest('.qrow').style.opacity = .4; const id = rv.dataset.id, rejecting = rv.dataset.review === 'rejected', cp = rejecting && (X.get('coupons', []) || []).find(c => c && c.used_on === id);
      await act('reviewQueue', { id, status: rv.dataset.review }, { toast: rejecting ? 'Rejected' : 'Approved ✓' });
      if (cp) { try { await api('/api/do', { action: 'adjustPoints', member: cp.member, points: -Math.abs(+cp.off), reason: '🎟️ Coupon returned' }); await X.op({ op: 'set', key: 'coupons', value: (X.get('coupons', []) || []).map(c => c && c.id === cp.id ? Object.assign({}, c, { used: '', used_on: '', reward: '' }) : c) }); await Sync.refresh(); toast('Coupon given back 🎟️'); } catch (e2) { toast('Could not return the coupon: ' + e2.message, true); } }
      return;
    }
    const un = e.target.closest('[data-undo]'); if (un) {
      const k = (S.state.queue || []).find(x => x.id === un.dataset.undo); if (!k) return; const pts = (+k.points > 0 ? '+' : '') + k.points + ' pts';
      const what = k.type === 'adjust' ? { title: `Undo ${pts} for ${k.member}?`, body: `“${esc(k.title)}” is removed and the points stop counting.` } : { title: `Undo this ${k.status === 'approved' ? 'approval' : 'rejection'}?`, body: `${esc(k.member)} · ${esc(k.title)} (${esc(pts)}) goes back to <b>waiting for approval</b>${k.status === 'approved' ? ' — the points come off until you approve it again' : ''}.` };
      if (!await Modal.confirm({ icon: '↶', title: what.title, body: what.body, ok: 'Undo' })) return;
      await act('undoQueue', { id: k.id }, { toast: 'Undone' }); return;
    }
    const pg = e.target.closest('[data-prizegiven]'); if (pg) { await X.op({ op: 'set', key: 'prizes', value: (X.get('prizes', []) || []).map(p => p && p.id === pg.dataset.prizegiven ? Object.assign({}, p, { given: new Date().toISOString() }) : p) }); render(); toast('Marked as given 🏆'); return; }
    const dr = e.target.closest('.drow'); if (dr) return editDinner(dr.dataset.date);
    const qe = e.target.closest('[data-qedit]'); if (qe) { const q = (S.state.quests || []).find(x => x.id === qe.dataset.qedit); if (q) QE.open('quest', q); return; }
    const re = e.target.closest('[data-redit]'); if (re) { const r = (S.state.rewards || []).find(x => x.id === re.dataset.redit); if (r) QE.open('reward', r); return; }
    const me_ = e.target.closest('[data-medit]'); if (me_) { const m = (S.state.members || []).find(x => x.name === me_.dataset.medit); if (m) ME.open(m); return; }
    const bm = e.target.closest('[data-bm]'); if (bm) { S.bonus.member = bm.dataset.bm; renderParent(); return; }
    const bs = e.target.closest('[data-bsign]'); if (bs) { S.bonus.points = Math.abs(S.bonus.points) * (+bs.dataset.bsign); renderParent(); return; }
    const bp = e.target.closest('[data-bp]'); if (bp) { const sign = S.bonus.points < 0 ? -1 : 1; if (bp.dataset.bp === 'custom') { const n = await num('How many points?', Math.abs(S.bonus.points), 1, 10000); if (n !== null) S.bonus.points = sign * Math.round(n); } else S.bonus.points = sign * (+bp.dataset.bp); renderParent(); return; }
    const ov = e.target.closest('[data-ovr]'); if (ov) { const mode = ov.dataset.ovr; if (!mode) { await Display.setOverride(null); toast('Following the schedule'); } else { const v = await Modal.pick({ icon: '⏱', title: `${modeLabel(mode)} for how long?`, options: [{ value: '30', label: '30 minutes' }, { value: '60', label: '1 hour' }, { value: '180', label: '3 hours' }, { value: '0', label: 'Until the next scheduled change' }] }); if (!v && v !== '0') return; await Display.setOverride(mode, +v); toast('Override set'); } renderParent(); return; }
    const pr = e.target.closest('[data-period]'); if (pr) { const p = displayPeriods().find(x => x.id === pr.dataset.period); if (p) DE.open(p); return; }
    const fx = e.target.closest('[data-fx]'); if (fx) {
      const k = fx.dataset.fx, c = streakCfg(); const save = async (patch) => { await X.op({ op: 'set', key: 'streak', value: Object.assign({}, X.get('streak', {}), patch) }); render(); };
      if (k === 'shield') { await save({ shield: !c.shield }); toast(c.shield ? 'Shield off' : 'Shield on'); }
      else if (k === 'pause') { const ps = (c.pauses || []).slice(); const open_ = ps.find(p => p.from && !p.to); if (open_) { open_.to = dayKey(new Date()); await save({ pauses: ps }); toast('Streaks running again'); } else { ps.push({ from: dayKey(new Date()), to: '' }); await save({ pauses: ps }); toast('Streaks paused — tap again to resume'); } }
      else if (k === 'milestones') { const v = await KB.open({ title: 'Milestones as "days:points off", comma separated', initial: (c.milestones || []).map(m => `${m.n}:${m.off}`).join(', '), placeholder: '7:10, 14:25' }); if (v === null) return; const ms = v.split(',').map(x => x.trim().split(':').map(Number)).filter(x => x[0] > 0 && x[1] > 0).map(x => ({ n: x[0], off: x[1] })); await save({ milestones: ms }); toast('Milestones saved'); }
      else if (k === 'givecoupon') { const kids = members('kid'); const who = await Modal.pick({ icon: '🎟️', title: 'Coupon for whom?', options: kids.map(x => ({ value: x.name, label: `${x.emoji} ${x.name}` })) }); if (!who) return; const off = await num('Points off a reward', 10, 1, 1000); if (off === null) return; await X.op({ op: 'push', key: 'coupons', value: { id: xuid(), member: who, off: Math.round(off), label: 'from a parent', at: new Date().toISOString() } }); render(); toast(`Coupon given to ${who} 🎟️`); }
      else if (k === 'addcd') { const title = await KB.open({ title: 'Counting down to…', placeholder: 'e.g. Halloween' }); if (!title) return; const emoji = await KB.open({ title: 'Pick an emoji', emoji: true, placeholder: '⏳' }); if (emoji === null) return; const date = await pickDate(); if (!date) return; await X.op({ op: 'push', key: 'countdowns', value: { id: xuid(), title: title.trim(), emoji: firstGrapheme((emoji || '⏳').trim() || '⏳'), date } }); render(); toast('Countdown added'); }
      return;
    }
    const dc = e.target.closest('[data-fxdelcd]'); if (dc) { await X.op({ op: 'remove', key: 'countdowns', id: dc.dataset.fxdelcd }); render(); return; }
    const dn = e.target.closest('[data-fxdelnote]'); if (dn) { await X.op({ op: 'remove', key: 'notes', id: dn.dataset.fxdelnote }); render(); return; }
    const dcp = e.target.closest('[data-fxdelcoupon]'); if (dcp) { await X.op({ op: 'remove', key: 'coupons', id: dcp.dataset.fxdelcoupon }); render(); return; }
  });
  on($('#quest-ed'), 'click', async e => {
    const s = QE.state; if (!s) return;
    if (e.target.closest('#qe-icon')) { const v = await KB.open({ title: 'Pick an icon', emoji: true, placeholder: s.icon }); if (v && QE.state) { QE.state.icon = firstGrapheme(v.trim()) || s.icon; QE.draw(); } return; }
    if (e.target.closest('#qe-name')) return QE.editName(); if (e.target.closest('#qe-save')) return QE.save(); if (e.target.closest('#qe-del')) return QE.del();
    const qp = e.target.closest('[data-qpts]'); if (qp) { if (qp.dataset.qpts === 'custom') { const n = await num('How many points?', s.points, 0, 10000); if (n !== null) s.points = Math.round(n); } else s.points = +qp.dataset.qpts; QE.draw(); return; }
    const qw = e.target.closest('[data-qwho]'); if (qw) { s.who = qw.dataset.qwho; QE.draw(); return; }
    const qr = e.target.closest('[data-qrep]'); if (qr) { s.repeat = qr.dataset.qrep; QE.draw(); return; }
    const qa = e.target.closest('[data-qauto]'); if (qa) { s.auto = qa.dataset.qauto === '1'; QE.draw(); return; }
    const qc = e.target.closest('[data-qact]'); if (qc) { s.active = qc.dataset.qact === '1'; QE.draw(); return; }
    const sm = e.target.closest('[data-smode]'); if (sm) { s.streak.mode = sm.dataset.smode; s.sdraft = null; QE.draw(); return; }
    if (e.target.closest('[data-sadd]')) { s.sdraft = { n: 7, type: 'points', value: 10, text: '', every: false }; QE.draw(); return; }
    const sd = e.target.closest('[data-sdel]'); if (sd) { s.streak.milestones.splice(+sd.dataset.sdel, 1); QE.draw(); return; }
    if (e.target.closest('[data-scancel]')) { s.sdraft = null; QE.draw(); return; }
    if (e.target.closest('[data-sok]')) { const D = s.sdraft; if (D.type === 'prize' && !D.text) { toast('Say what the prize is', true); return; } s.streak.milestones = (s.streak.milestones || []).concat([{ n: D.n, type: D.type, value: D.type === 'prize' ? 0 : D.value, text: D.type === 'prize' ? D.text : '', every: !!D.every }]); s.sdraft = null; QE.draw(); return; }
    const D = s.sdraft;
    const sn = e.target.closest('[data-sdn]'); if (sn && D) { if (sn.dataset.sdn === 'custom') { const n = await num('After how many in a row?', D.n, 2, 365); if (n !== null) D.n = Math.round(n); } else D.n = +sn.dataset.sdn; QE.draw(); return; }
    const st = e.target.closest('[data-sdt]'); if (st && D) { D.type = st.dataset.sdt; QE.draw(); return; }
    const sv = e.target.closest('[data-sdv]'); if (sv && D) { if (sv.dataset.sdv === 'custom') { const n = await num('How many points?', D.value, 1, 10000); if (n !== null) D.value = Math.round(n); } else D.value = +sv.dataset.sdv; QE.draw(); return; }
    if (e.target.closest('[data-sdtext]') && D) { const v = await KB.open({ title: 'The prize', initial: D.text, placeholder: 'e.g. Ice cream trip' }); if (v !== null) D.text = v.trim(); QE.draw(); return; }
    const spk = e.target.closest('[data-sdpick]'); if (spk && D) { D.text = spk.dataset.sdpick; QE.draw(); return; }
    const se = e.target.closest('[data-sde]'); if (se && D) { D.every = se.dataset.sde === '1'; QE.draw(); return; }
    const lk = e.target.closest('[data-lk]'); if (lk) { const t = lk.dataset.lk; s.lock = !t ? null : t === 'quest' ? { type: 'quest', quest: '', n: 7 } : { type: 'variety', count: 3, n: 5, min: 0 }; QE.draw(); return; }
    const lq = e.target.closest('[data-lkq]'); if (lq && s.lock) { s.lock.quest = lq.dataset.lkq; QE.draw(); return; }
    const ln = e.target.closest('[data-lkn]'); if (ln && s.lock) { s.lock.n = +ln.dataset.lkn; QE.draw(); return; }
    const lc = e.target.closest('[data-lkc]'); if (lc && s.lock) { s.lock.count = +lc.dataset.lkc; QE.draw(); return; }
    const lm = e.target.closest('[data-lkm]'); if (lm && s.lock) { s.lock.min = +lm.dataset.lkm; QE.draw(); return; }
  });
  on($('#disp-ed'), 'click', async e => {
    const s = DE.state; if (!s) return;
    if (e.target.closest('#de-time')) { const v = await pickTime(s.start); if (v && DE.state) { DE.state.start = v; DE.draw(); } return; }
    if (e.target.closest('#de-save')) return DE.save(); if (e.target.closest('#de-del')) return DE.del();
    const m = e.target.closest('[data-dmode]'); if (m) { s.mode = m.dataset.dmode; DE.draw(); return; }
    const d = e.target.closest('[data-ddays]'); if (d) { s.days = d.dataset.ddays; DE.draw(); }
  });
  on($('#member-ed'), 'click', async e => {
    const s = ME.state; if (!s) return;
    if (e.target.closest('#me-emoji')) { const v = await KB.open({ title: 'Pick an emoji', emoji: true, placeholder: s.emoji }); if (v && ME.state) { ME.state.emoji = firstGrapheme(v.trim()) || s.emoji; ME.draw(); } return; }
    if (e.target.closest('#me-name')) return ME.editName(); if (e.target.closest('#me-save')) return ME.save(); if (e.target.closest('#me-del')) return ME.del();
    const r = e.target.closest('[data-mrole]'); if (r) { s.role = r.dataset.mrole; ME.draw(); return; }
    const c = e.target.closest('[data-mcolor]'); if (c) { s.color = c.dataset.mcolor; ME.draw(); return; }
    const a = e.target.closest('[data-mact]'); if (a) { s.active = a.dataset.mact === '1'; ME.draw(); }
  });
}

/* ---------- boot ---------- */
async function boot() {
  document.body.classList.toggle('phone', isPhone());
  forcePhoneLayoutIfNeeded(); if (isPhone()) fitPhoneHeight();
  window.addEventListener('resize', () => { if (!S.forcePhone) document.body.classList.toggle('phone', isPhone()); });
  bind(); tickClock(); setInterval(tickClock, 1000);
  await Sync.refresh();
  if (!S.state) { $('#loading').innerHTML = '<div>Can’t reach the board server.<br><span class="muted" style="font-size:15px">Retrying…</span></div>'; setTimeout(boot, 3000); return; }
  Sync.start(); Outbox.init(); Display.init(); Photos.init();
  loadWeather(); setInterval(loadWeather, 15 * 60000);
  Msg.knownIds = new Set(Msg.all().map(m => m.id));
  if (!openHash()) showScreen(isPhone() ? (ls.get('fqb2_lastscreen', 'home')) : 'home');
  window.addEventListener('hashchange', openHash);
  if (isPhone() && !Me.name()) await Me.pick();
  checkStreaks(); setInterval(checkStreaks, 5 * 60000);
  setInterval(() => { if (S.state) { renderHome(); Display.tick(); } }, 30000);
  bumpIdle();
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
}
window.FQB = S; S.X = X; S.Photos = Photos; S.Msg = Msg; S.refreshNow = () => Sync.refresh();
boot();
