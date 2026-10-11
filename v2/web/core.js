/* Family Quest Board v2 — core: state, API, keyboard, dialogs, identity, PIN, offline queue.
   Plain JS, no build step. Loaded first; the other files rely on what's here. */
'use strict';

/* ---------- tiny helpers ---------- */
const $ = (s, el) => (el || document).querySelector(s);
const $$ = (s, el) => Array.from((el || document).querySelectorAll(s));
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = (n) => String(n).padStart(2, '0');
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const isTrue = (v) => v === true || v === 1 || String(v).toUpperCase() === 'TRUE';
const dayKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseHM = (s, fb) => { const m = /^(\d{1,2}):(\d{2})$/.exec(String(s || '').trim()); return m ? (+m[1]) * 60 + (+m[2]) : fb; };
const fmtTime = (d) => d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
const toDate = (v) => (v instanceof Date ? v : new Date(v));
const startOfDay = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const firstGrapheme = (s) => { try { return [...new Intl.Segmenter().segment(s)][0].segment; } catch (_) { return Array.from(s)[0] || ''; } };
const xuid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
function weekKey(d, monday) { const x = startOfDay(d); const day = x.getDay(); x.setDate(x.getDate() - (monday ? (day + 6) % 7 : day)); return dayKey(x); }
function when(iso) { if (!iso) return ''; const d = toDate(iso), now = new Date(); return dayKey(d) === dayKey(now) ? 'today ' + fmtTime(d) : d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' }) + ' ' + fmtTime(d); }
const relTime = (iso) => { const d = new Date(iso), now = new Date(); if (dayKey(d) === dayKey(now)) return fmtTime(d); const diff = (now - d) / 86400000; return diff < 7 ? DAYS[d.getDay()] : d.toLocaleDateString([], { month: 'short', day: 'numeric' }); };
const ls = { get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch (_) { return d; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) {} }, del(k) { try { localStorage.removeItem(k); } catch (_) {} } };

/* ---------- device: wall or phone ---------- */
const isPhone = () => S.forcePhone || new URLSearchParams(location.search).has('remote') || window.matchMedia('(max-width: 900px)').matches;

/* ---------- app state ---------- */
const S = {
  state: null, version: 0, cal: 0, parent: false, server: null, weather: null, error: '', lastOk: null,
  screen: 'home', ptab: 'queue', kid: '', gtab: '', gStore: null, gEssOnly: false, gKeep: [], todoTag: null, todoSort: 'due', todoShowDone: false,
  bonus: { member: '', points: 5, reason: '' }, calIndex: [], forcePhone: false, online: true,
};
function cfg(key, fb) { const v = S.state && S.state.config ? S.state.config[key] : undefined; return v === undefined || v === null || v === '' ? fb : v; }
const X = {
  get(key, fb) { const v = S.state && S.state.extras ? S.state.extras[key] : undefined; return v === undefined || v === null ? fb : v; },
  // Pi-side data ops: apply locally right away, then send
  async op(body) {
    const ex = S.state.extras = S.state.extras || {};
    const k = body.key;
    if (body.op === 'set') ex[k] = body.value;
    else if (body.op === 'merge') { const cur = Object.assign({}, ex[k] || {}); for (const [a, b] of Object.entries(body.value || {})) { if (b === null) delete cur[a]; else cur[a] = b; } ex[k] = cur; }
    else if (body.op === 'push') ex[k] = (ex[k] || []).concat([body.value]);
    else if (body.op === 'remove') { const ids = new Set(body.ids || [body.id]); ex[k] = (ex[k] || []).filter(x => !(x && ids.has(x.id))); }
    const r = await fetch('/api/x', { method: 'POST', body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.ok) throw new Error(j.error || 'not saved');
    if (j.version) S.version = j.version;
    if (body.op === 'award') await Sync.refresh();
    return j.changed;
  },
  merge(key, value) { return this.op({ op: 'merge', key, value }); },
};

/* ---------- server sync ---------- */
const Sync = {
  timer: null, busy: false,
  async refresh(quiet) {
    if (this.busy) return; this.busy = true;
    try {
      const r = await fetch(`/api/state?since=${S.state ? S.version : 0}&cal=${S.cal || 0}`, { cache: 'no-store' });
      if (r.status === 403 && (await r.text()).includes('password')) { location.href = '/login'; return; }
      const j = await r.json();
      S.online = true;
      if (j.unchanged) { if (S.parent !== undefined && S.state) { /* parent flag only travels with full state */ } return; }
      const first = !S.state;
      S.state = j; S.version = j.version; S.cal = j.cal || 0; S.parent = !!j.parent; S.server = j.server; S.lastOk = new Date(); S.error = '';
      Outbox.overlay();
      if (first) document.body.classList.remove('loading');
      render();
    } catch (e) {
      S.online = false; S.error = e.message || String(e);
      if (!quiet) console.warn('sync failed', e);
      updatePill();
    } finally { this.busy = false; }
  },
  start() { clearInterval(this.timer); this.timer = setInterval(() => this.refresh(true), 4000); },
};

/* ---------- actions ---------- */
async function api(path, body) {
  const r = await fetch(path, { method: 'POST', body: JSON.stringify(body || {}) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.ok === false) { const e = new Error(j.error || j.message || `HTTP ${r.status}`); e.locked = !!j.locked; throw e; }
  return j;
}
// Run a board action. Parent-only actions ask for the PIN when needed.
async function act(action, body, opts) {
  opts = opts || {};
  try {
    const j = await api('/api/do', Object.assign({ action }, body));
    if (opts.toast) toast(opts.toast);
    await Sync.refresh();
    return j;
  } catch (e) {
    if (e.locked) { const ok = await Parent.ask(); if (ok) return act(action, body, opts); return null; }
    toast((opts.fail || 'That didn’t save') + ': ' + (e.message || e), true);
    return null;
  }
}

/* ---------- who is using this device ---------- */
const Me = {
  key: 'fqb2_me',
  name() { return isPhone() ? (ls.get(this.key, '') || '') : ''; },
  set(n) { ls.set(this.key, n); },
  who() { return this.name() || 'wall'; },
  isKid(n) { return members('kid').some(k => k.name === n); },
  isParent(n) { return members('parent').some(k => k.name === n); },
  async pick(force) {
    if (!isPhone() || (!force && this.name())) return this.name();
    const ms = members();
    const v = await Modal.pick({ icon: '👋', title: 'Who’s using this phone?', body: 'Messages you send come from them, and the board remembers it on this phone.',
      options: ms.map(m => ({ value: m.name, label: `${m.emoji || '👤'} ${m.name}` })) });
    if (v) { this.set(v); render(); }
    return v;
  },
};
function members(role) {
  const list = ((S.state && S.state.members) || []).filter(m => m.name && (m.active === '' || m.active === undefined || isTrue(m.active)));
  return role ? list.filter(m => (m.role || '').toLowerCase() === role) : list;
}
const memberOf = (n) => members().find(m => m.name === n) || {};

/* ---------- parent PIN ---------- */
const Parent = {
  resolve: null, pin: '',
  async ask(title) {
    if (S.parent) return true;
    return new Promise((resolve) => {
      this.resolve = resolve; this.pin = '';
      $('#pin-title').textContent = title || 'Parent PIN';
      $('#pin-remember').style.display = isPhone() && !Me.isKid(Me.name()) ? '' : 'none';
      $('#pin-msg').textContent = ''; this.dots();
      $('#pinpad').classList.add('open');
    });
  },
  dots() { $$('#pin-dots span').forEach((d, i) => d.classList.toggle('on', i < this.pin.length)); },
  async key(k) {
    if (k === '⌫') { this.pin = this.pin.slice(0, -1); this.dots(); return; }
    if (k === 'cancel') { this.close(false); return; }
    this.pin = (this.pin + k).slice(0, 4); this.dots();
    if (this.pin.length < 4) return;
    try {
      const remember = $('#pin-remember').style.display !== 'none' && $('#pin-remember input').checked;
      await api('/api/unlock', { pin: this.pin, remember });
      S.parent = true;
      if (remember) toast('This phone stays unlocked for 30 days');
      this.close(true);
      await Sync.refresh();
    } catch (e) {
      $('#pin-msg').textContent = 'Wrong PIN'; this.pin = '';
      setTimeout(() => { this.dots(); $('#pin-msg').textContent = ''; }, 700);
    }
  },
  close(v) { $('#pinpad').classList.remove('open'); const r = this.resolve; this.resolve = null; if (r) r(v); },
  async lock() { S.parent = false; try { await api('/api/lock'); } catch (_) {} render(); },
};

/* ---------- on-screen keyboard (wall) / native field (phone) ---------- */
const EMOJI = {
  '😀': ['😀', '😁', '😂', '🤣', '😊', '😍', '😘', '😎', '🤔', '😴', '😭', '😡', '🥳', '🤩', '🙃', '😇', '🤗', '🤪', '😬', '🥺', '👍', '👎', '👏', '🙏', '💪', '👋', '✌️', '🤞', '❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '💖', '⭐', '🌟', '✨', '🔥'],
  '🏠': ['🏠', '🛏️', '🛋️', '🚿', '🧹', '🧺', '🧼', '🗑️', '♻️', '🪥', '🧽', '🧻', '🪣', '🔧', '🔨', '🪛', '🧰', '💡', '🔑', '🚪', '🪟', '🧯', '🛒', '🧾', '📦', '📬', '🐈', '🐕', '🐠', '🪴', '🌳', '🌷', '🌻', '🍂', '☀️', '🌧️', '❄️', '🌈', '🕐', '⏰'],
  '🍽️': ['🍽️', '🍳', '🥞', '🧇', '🥓', '🍞', '🥪', '🌮', '🌯', '🍕', '🍔', '🍟', '🌭', '🍗', '🥩', '🍝', '🍜', '🍣', '🍱', '🥗', '🥦', '🥕', '🍎', '🍌', '🍇', '🍓', '🍉', '🍪', '🍩', '🎂', '🧁', '🍦', '🍫', '🍿', '☕', '🧃', '🥛', '🍷', '🍺', '🎉'],
  '📚': ['📚', '📖', '✏️', '📝', '🎒', '🏫', '🚌', '🧮', '🔬', '🎨', '🎭', '🎵', '🎸', '🎹', '🎤', '⚽', '🏀', '🏈', '⚾', '🎾', '🏊', '🚴', '🛹', '🏃', '🧘', '🎮', '🧩', '🎲', '🪁', '🧸', '🚗', '✈️', '🚲', '🛝', '🏕️', '🏖️', '🎪', '🎁', '🏆', '🥇'],
  '👨‍👩‍👧': ['👨‍👩‍👧', '👨‍👩‍👦', '👩', '👨', '👧', '👦', '👶', '👵', '👴', '🧑‍⚕️', '🦷', '💊', '🩹', '🏥', '💇', '💈', '🛁', '🧴', '🎓', '💼', '💻', '📱', '📞', '💬', '📅', '📌', '🔔', '⚠️', '✅', '❌', '❓', '❗', '💤', '🚀', '🦄', '🦖', '🐉', '🐢', '🦊', '🐸'],
};
const KB = {
  resolve: null, shift: true, multi: false, mode: 'abc', cat: '😀',
  layout: [['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'], ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p'], ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l', "'"], ['⇧', 'z', 'x', 'c', 'v', 'b', 'n', 'm', '.', '⌫'], ['cancel', '?123', '😀', 'space', 'done']],
  symbols: [['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'], ['@', '#', '$', '%', '&', '*', '-', '+', '(', ')'], ['!', '?', ':', ';', '"', "'", '/', '=', '_', '~'], ['abc', '.', ',', '<', '>', '[', ']', '{', '}', '⌫'], ['cancel', '?123', '😀', 'space', 'done']],
  field() { return this.multi ? $('#kb-area') : $('#kb-input'); },
  open(opts) {
    return new Promise((resolve) => {
      this.resolve = resolve; this.shift = true; this.mode = opts.emoji ? 'emoji' : 'abc';
      $('#kb-title').textContent = opts.title || 'Type';
      this.multi = !!(opts.multiline || opts.multi);
      $('#kb-input').style.display = this.multi ? 'none' : ''; $('#kb-area').style.display = this.multi ? '' : 'none';
      $('#kb-input').type = opts.type || 'text'; $('#kb-input').inputMode = opts.inputMode || 'text';
      const inp = this.field(); inp.value = opts.initial || ''; inp.placeholder = opts.placeholder || '';
      this.draw(); $('#kb').classList.toggle('native', isPhone()); $('#kb').classList.add('open'); setTimeout(() => { inp.focus(); if (isPhone()) inp.setSelectionRange(inp.value.length, inp.value.length); }, 50);
    });
  },
  draw() {
    const nativeRow = `<div class="kb-row native-row"><button class="wide cancel" data-k="cancel">Cancel</button><button class="mode" data-k="mode:emoji">😀</button><button class="wide done" data-k="done">Done ✓</button></div>`;
    if (this.mode === 'emoji') {
      const cats = Object.keys(EMOJI), list = EMOJI[this.cat] || EMOJI[cats[0]]; const rows = []; for (let i = 0; i < list.length; i += 10) rows.push(list.slice(i, i + 10));
      $('#kb-rows').innerHTML = nativeRow + `<div class="kb-cats">${cats.map(c => `<button data-k="cat:${c}" class="${c === this.cat ? 'on' : ''}">${c}</button>`).join('')}</div>` +
        rows.map(r => `<div class="kb-row">${r.map(e => `<button class="emo" data-k="${e}">${e}</button>`).join('')}</div>`).join('') +
        `<div class="kb-row"><button class="wide cancel" data-k="cancel">Cancel</button><button class="mode" data-k="mode:abc">ABC</button><button class="space" data-k=" ">space</button><button data-k="bs">⌫</button><button class="wide done" data-k="done">Done ✓</button></div>`;
      return;
    }
    const layout = this.mode === 'sym' ? this.symbols : this.layout;
    $('#kb-rows').innerHTML = nativeRow + layout.map(row => `<div class="kb-row">${row.map(k => {
      if (k === 'space') return `<button class="space" data-k=" ">space</button>`;
      if (k === 'done') return `<button class="wide done" data-k="done">Done ✓</button>`;
      if (k === 'cancel') return `<button class="wide cancel" data-k="cancel">Cancel</button>`;
      if (k === '?123') return `<button class="mode" data-k="mode:${this.mode === 'sym' ? 'abc' : 'sym'}">${this.mode === 'sym' ? 'abc' : '?123'}</button>`;
      if (k === 'abc') return `<button class="mode" data-k="mode:abc">abc</button>`;
      if (k === '😀') return `<button class="mode" data-k="mode:emoji">😀</button>`;
      if (k === '⇧') return `<button class="${this.shift ? 'on' : ''}" data-k="shift">⇧</button>`;
      if (k === '⌫') return `<button data-k="bs">⌫</button>`;
      const show = this.mode === 'abc' && this.shift ? k.toUpperCase() : k;
      return `<button data-k="${esc(k)}">${esc(show)}</button>`;
    }).join('')}</div>`).join('');
  },
  press(k) {
    const inp = this.field();
    if (k === 'done') { const v = inp.value; this.close(); if (this.resolve) { const r = this.resolve; this.resolve = null; r(v); } return; }
    if (k === 'cancel') { this.close(); if (this.resolve) { const r = this.resolve; this.resolve = null; r(null); } return; }
    if (k.startsWith('mode:')) { this.mode = k.slice(5); this.draw(); return; }
    if (k.startsWith('cat:')) { this.cat = k.slice(4); this.draw(); return; }
    if (k === 'shift') { this.shift = !this.shift; this.draw(); return; }
    if (k === 'bs') { inp.value = inp.value.slice(0, -1); return; }
    let ch = k;
    if (this.mode === 'abc' && /^[a-z']$/.test(k) && this.shift) { ch = k.toUpperCase(); this.shift = false; this.draw(); }
    inp.value += ch;
    // auto-capitalise after a sentence, or at the start
    if (this.mode === 'abc' && !this.shift && (/[.!?]\s$/.test(inp.value) || inp.value === '')) { this.shift = true; this.draw(); }
    inp.scrollTop = inp.scrollHeight;
  },
  close() { $('#kb').classList.remove('open'); this.field().blur(); },
};

/* ---------- modal / confirm / pick ---------- */
const Modal = {
  resolve: null, info: false,
  confirm(o) {
    return new Promise((resolve) => {
      this.resolve = resolve; this.info = !!o.noCancel;
      $('#m-icon').textContent = o.icon || '❓'; $('#m-title').textContent = o.title || ''; $('#m-body').innerHTML = o.body || '';
      $('#m-cancel').style.display = o.noCancel ? 'none' : ''; $('#m-cancel').textContent = o.cancel || 'Cancel';
      $('.modal-box').classList.toggle('wide', !!o.wide);
      $('#m-ok').textContent = o.ok || 'Yes'; $('#m-ok').className = 'btn ' + (o.okClass || 'primary');
      const alt = $('#m-alt'); alt.style.display = o.alt ? '' : 'none'; alt.textContent = o.alt || '';
      $('#modal').classList.add('open');
    });
  },
  pick(o) {   // a list of big buttons; resolves with the chosen value or null
    return new Promise((resolve) => {
      this.resolve = resolve; this.info = false;
      $('#m-icon').textContent = o.icon || '❓'; $('#m-title').textContent = o.title || '';
      $('#m-body').innerHTML = (o.body ? `<p class="muted">${esc(o.body)}</p>` : '') + `<div class="pick">${o.options.map(x => `<button data-pick="${esc(x.value)}" class="${x.on ? 'on' : ''}">${x.label}</button>`).join('')}</div>`;
      $('#m-cancel').style.display = ''; $('#m-cancel').textContent = o.cancel || 'Cancel'; $('#m-ok').style.display = 'none'; $('#m-alt').style.display = 'none';
      $('.modal-box').classList.toggle('wide', !!o.wide);
      $('#modal').classList.add('open');
    });
  },
  close(v) { $('#modal').classList.remove('open'); $('#m-ok').style.display = ''; const r = this.resolve; this.resolve = null; if (r) r(v); },
};
// Native date picker, works on wall and phone
function pickDate(initial) {
  return new Promise((resolve) => {
    const inp = $('#date-pick'); inp.value = initial || dayKey(new Date());
    let done = false; const fin = (v) => { if (done) return; done = true; inp.onchange = inp.onblur = null; resolve(v); };
    inp.onchange = () => fin(inp.value || null); inp.onblur = () => setTimeout(() => fin(null), 300);
    try { inp.showPicker(); } catch (_) { inp.focus(); inp.click(); }
  });
}
let toastTimer;
function toast(msg, isErr) { const t = $('#toast'); t.textContent = msg; t.className = 'on' + (isErr ? ' err' : ''); clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.className = ''; }, isErr ? 6000 : 2500); }
let audioCtx;
function chime() {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    [[880, 0], [1320, 0.16]].forEach(([f, t]) => { const o = audioCtx.createOscillator(), g = audioCtx.createGain(); o.frequency.value = f; o.type = 'sine'; o.connect(g); g.connect(audioCtx.destination); const at = audioCtx.currentTime + t; g.gain.setValueAtTime(0.0001, at); g.gain.exponentialRampToValueAtTime(0.25, at + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, at + 0.35); o.start(at); o.stop(at + 0.4); });
  } catch (_) {}
}

/* ---------- offline outbox (phones in a store) ---------- */
const Outbox = {
  key: 'fqb2_outbox', q: [], flushing: false, timer: null, recent: [],
  init() { this.q = ls.get(this.key, []); setInterval(() => this.flush(), 5000); window.addEventListener('online', () => this.flush()); this.banner(); },
  save() { ls.set(this.key, this.q); this.banner(); },
  send(action, body) { this.q.push({ id: xuid(), action, body, t: Date.now() }); this.save(); this.flush(); },
  overlay() {
    // pending (and just-sent) grocery checks win over whatever the server said a moment ago
    if (!S.state) return;
    const now = Date.now();
    this.recent = this.recent.filter(r => now - r.t < 20000);
    for (const it of this.q.concat(this.recent)) if (it.action === 'setGroceryStatus') { const g = (S.state.groceries || []).find(x => x.id === it.body.id); if (g) g.status = it.body.status; }
  },
  async flush() {
    if (this.flushing || !this.q.length) return; this.flushing = true;
    try {
      while (this.q.length) {
        const it = this.q[0];
        try { await api('/api/do', Object.assign({ action: it.action }, it.body)); }
        catch (e) { if (e.message && /HTTP 4|Unknown|Not found|needed/i.test(e.message)) { /* bad item: drop it */ } else break; }
        this.q = this.q.filter(x => x.id !== it.id); this.recent.push(Object.assign({}, it, { t: Date.now() })); this.save();
      }
      if (!this.q.length) await Sync.refresh(true);
    } finally { this.flushing = false; this.banner(); }
  },
  banner() {
    const el = $('#offline-bar'); if (!el) return;
    const n = this.q.length, old = n && Date.now() - this.q[0].t > 4000;
    el.textContent = old ? `📶 ${n} change${n === 1 ? '' : 's'} waiting for signal — they’ll send on their own` : '';
    el.classList.toggle('on', !!old);
  },
};

/* ---------- screens / navigation ---------- */
const SCREENS = ['home', 'calendar', 'groceries', 'quests', 'todo', 'messages', 'parent'];
function showScreen(name) {
  if (!SCREENS.includes(name)) name = 'home';
  S.screen = name;
  $$('.screen').forEach(s => s.classList.toggle('active', s.id === 'screen-' + name));
  $$('#nav .navbtn').forEach(b => b.classList.toggle('active', b.dataset.screen === name));
  const main = $('main'); if (main) main.scrollTop = 0;
  if (name === 'messages') { Msg.onShow(); }
  if (name === 'quests') renderQuests();
  if (name === 'parent') renderParent();
  if (name === 'todo') renderTodos();
  if (name === 'calendar') renderCalendar();
  if (name === 'groceries') renderGroceries();
  if (name === 'home') { Photos.next(); }
  if (isPhone()) { try { history.replaceState(null, '', '#' + (name === 'messages' && Msg.cur ? 'chat/' + encodeURIComponent(Msg.cur) : name)); } catch (_) {} }
}
// Alert / message links: #go/<screen>[/<tab>], #chat/<cid>
function openHash() {
  const h = decodeURIComponent(location.hash || '');
  if (h.startsWith('#chat')) { const cid = h.split('/')[1]; if (cid) Msg.cur = cid; showScreen('messages'); return true; }
  if (h.startsWith('#go/')) { const [scr, tab] = h.slice(4).split('/'); if (tab && scr === 'parent') S.ptab = tab; showScreen(scr); try { history.replaceState(null, '', location.pathname + location.search); } catch (_) {} return true; }
  if (h.length > 1 && SCREENS.includes(h.slice(1))) { showScreen(h.slice(1)); return true; }
  return false;
}

/* ---------- idle: back to home, lock parents ---------- */
let idleTimer;
function bumpIdle() {
  clearTimeout(idleTimer);
  if (isPhone()) return;
  const secs = Math.max(20, parseInt(cfg('idle_timeout_sec', '90'), 10) || 90);
  idleTimer = setTimeout(async () => {
    if (Modal.resolve && Modal.info) Modal.close(true);
    if (KB.resolve || Modal.resolve || Sheet.openCount() || Parent.resolve) { bumpIdle(); return; }
    Cal.offset = 0; S.gtab = ''; S.gStore = null;
    if (S.parent) await Parent.lock();
    showScreen('home'); Photos.next();
  }, secs * 1000);
}

/* ---------- generic bottom-sheet editors ---------- */
const Sheet = {
  open(id) { $('#' + id).classList.add('open'); },
  close(id) { $('#' + id).classList.remove('open'); },
  openCount() { return $$('.sheet.open').length; },
};

/* ---------- phone layout fit ---------- */
function fitPhoneHeight() {
  const set = () => { if (S.forcePhone) return; document.documentElement.style.setProperty('--app-h', window.innerHeight + 'px'); if (window.scrollY) window.scrollTo(0, 0); };
  set(); window.addEventListener('resize', set); window.addEventListener('orientationchange', () => setTimeout(set, 300));
  if (window.visualViewport) window.visualViewport.addEventListener('resize', () => { if (!document.activeElement || !/INPUT|TEXTAREA/.test(document.activeElement.tagName)) set(); });
  document.addEventListener('focusout', () => setTimeout(set, 150));
}
// A phone in "desktop site" mode: force the phone layout anyway
function forcePhoneLayoutIfNeeded() {
  const small = screen.width && screen.width <= 900, wide = window.innerWidth > 900, touch = window.matchMedia('(pointer: coarse)').matches;
  if (!(small && wide && touch)) return;
  S.forcePhone = true; document.body.dataset.mode = 'phone';
  const scale = window.innerWidth / screen.width; document.documentElement.style.zoom = String(scale);
  const fit = () => { $('#app').style.height = Math.floor(window.innerHeight / scale) + 'px'; }; fit(); window.addEventListener('resize', fit);
}
