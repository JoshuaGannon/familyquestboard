/* Family Quest Board v2 — photo slideshow and the display schedule (dim clock / screen off) */
'use strict';

const Photos = {
  list: [], idx: -1, timer: null, layer: 0, panDir: false,
  async init() { await this.rescan(true); this.start(); setInterval(() => this.rescan(), 600000); },
  async rescan(first) {
    try {
      const r = await fetch('/api/photos', { cache: 'no-store' }); if (!r.ok) return;
      const j = await r.json(), fresh = (j.photos || []).map(p => ({ url: p.url, name: p.name }));
      if (first || fresh.length !== this.list.length || fresh.some((p, i) => p.url !== (this.list[i] || {}).url)) { this.list = fresh; this.shuffle(); this.idx = -1; if (!first) { $('#gradient-bg').style.display = this.list.length ? 'none' : 'block'; if (!this.timer) this.start(); } }
    } catch (_) {}
  },
  shuffle() { for (let i = this.list.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [this.list[i], this.list[j]] = [this.list[j], this.list[i]]; } },
  place(el, im) {
    if (el._pan) { el._pan.cancel(); el._pan = null; }
    el.classList.remove('kb', 'pan'); el.style.width = el.style.height = el.style.transform = '';
    const box = el.parentElement.getBoundingClientRect(), W = box.width || window.innerWidth, H = box.height || window.innerHeight;
    if (!im || !im.naturalWidth || !im.naturalHeight || !W || !H) { el.classList.add('kb'); return; }
    const imgAR = im.naturalWidth / im.naturalHeight, scrAR = W / H;
    let w, h, dx = 0, dy = 0;
    if (imgAR < scrAR) { w = W; h = W / imgAR; dy = h - H; } else { h = H; w = H * imgAR; dx = w - W; }
    if (Math.max(dx / W, dy / H) < 0.12) { el.classList.add('kb'); return; }
    const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
    let x0 = 0, x1 = 0, y0 = 0, y1 = 0;
    if (dy) { y0 = clamp(0.14 * h, 0, dy); y1 = clamp(0.46 * h - H / 2, y0, dy); }
    if (dx) { x0 = clamp(0.25 * dx, 0, dx); x1 = clamp(0.75 * dx, x0, dx); }
    const travel = Math.max(x1 - x0, y1 - y0);
    el.classList.add('pan'); el.style.width = w + 'px'; el.style.height = h + 'px';
    if (travel < 0.03 * Math.max(W, H)) { el.style.transform = `translate(${-x0}px, ${-y0}px)`; return; }
    const dur = (Math.max(5, +cfg('photo_interval_sec', 20)) + 4) * 1000;
    this.panDir = !this.panDir;
    const from = this.panDir ? `translate(${-x0}px, ${-y0}px)` : `translate(${-x1}px, ${-y1}px)`, to = this.panDir ? `translate(${-x1}px, ${-y1}px)` : `translate(${-x0}px, ${-y0}px)`;
    el._pan = el.animate([{ transform: from }, { transform: to }], { duration: dur, easing: 'linear', fill: 'forwards' });
  },
  start() { clearInterval(this.timer); this.timer = null; $('#gradient-bg').style.display = this.list.length ? 'none' : 'block'; if (!this.list.length) return; this.next(); this.timer = setInterval(() => this.next(), Math.max(5, +cfg('photo_interval_sec', 20)) * 1000); },
  async next() {
    if (!this.list.length || S.screen !== 'home' || Display.applied !== 'photos') return;
    this.idx = (this.idx + 1) % this.list.length;
    const p = this.list[this.idx];
    const im = await new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = p.url; });
    if (!im) return;
    const a = $('#photo-a'), b = $('#photo-b'), show = this.layer === 0 ? a : b, hide = this.layer === 0 ? b : a;
    show.style.backgroundImage = `url("${p.url}")`; this.place(show, im);
    show.classList.add('show'); hide.classList.remove('show', 'kb'); this.layer = 1 - this.layer;
    const n = this.list[(this.idx + 1) % this.list.length]; if (n) { const pre = new Image(); pre.src = n.url; }
  },
};

const Display = {
  applied: null, wakeUntil: 0, override: null, hw: { supported: null, method: null, on: true },
  async init() {
    try { const r = await fetch('/api/display', { cache: 'no-store' }); if (r.ok) this.hw = Object.assign(this.hw, await r.json()); } catch (_) { this.hw.supported = false; }
    this.tick(); setInterval(() => this.tick(), 20000); setInterval(() => this.pollOverride(), 20000);
  },
  async pollOverride() {
    try {
      const r = await fetch('/api/override', { cache: 'no-store' }); if (!r.ok) return;
      const o = await r.json(), mode = o.mode || null;
      if (mode !== (this.override && this.override.mode || null)) { this.override = mode ? { mode, until: o.until ? Date.now() + o.seconds_left * 1000 : 0 } : null; this.tick(); if (S.screen === 'parent' && S.ptab === 'display') renderParent(); }
    } catch (_) {}
  },
  scheduled() { return periodAt(new Date()).mode; },
  effective() {
    if (isPhone()) return 'photos';
    if (this.override) { if (!this.override.until || Date.now() < this.override.until) return this.override.mode; this.override = null; }
    const s = this.scheduled(); if (s !== 'photos' && Date.now() < this.wakeUntil) return 'photos'; return s;
  },
  tick() {
    if (!S.state) return;
    this.apply(this.effective());
    if (this.applied === 'off' && !isPhone() && (this.hw.on || !this.hw.supported) && Date.now() - (this.hw.lastTry || 0) > 300000) this.power(false);
    if (!isPhone()) fetch('/api/heartbeat', { method: 'POST', body: JSON.stringify({ idle: 0, busy: !!(KB.resolve || Modal.resolve) }) }).catch(() => {});
  },
  apply(mode) {
    if (mode === this.applied) return;
    const prev = this.applied; this.applied = mode;
    const el = $('#sleep'); el.classList.toggle('on', mode !== 'photos'); el.classList.toggle('clock', mode === 'clock'); el.classList.toggle('off', mode === 'off');
    el.style.setProperty('--dim', String(Math.min(100, Math.max(10, parseInt(cfg('clock_dim', '35'), 10) || 35)) / 100));
    this.power(mode !== 'off');
    if (mode === 'photos') { if (prev !== null) showScreen('home'); Photos.next(); }
    tickClock();
  },
  async power(on) {
    if (this.hw.supported && this.hw.on === on) return;
    this.hw.lastTry = Date.now();
    try { const r = await fetch('/api/display', { method: 'POST', body: JSON.stringify({ state: on ? 'on' : 'off' }) }); if (r.ok) { const j = await r.json(); this.hw.supported = j.supported; this.hw.method = j.method; this.hw.on = j.state !== 'off'; } } catch (_) {}
  },
  wake() { const mins = Math.max(0.5, parseFloat(cfg('touch_wake_min', '2')) || 2); this.wakeUntil = Date.now() + mins * 60000; if (this.override && this.override.mode !== 'photos') this.setOverride(null); this.tick(); },
  async setOverride(mode, minutes) { this.override = mode ? { mode, until: minutes ? Date.now() + minutes * 60000 : 0 } : null; this.wakeUntil = 0; this.tick(); try { await fetch('/api/override', { method: 'POST', body: JSON.stringify({ mode: mode || null, minutes: minutes || 0 }) }); } catch (_) {} },
};
