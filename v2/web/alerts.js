/* Family Quest Board v2 — the big "you missed it" notice on the home screen, and the sounds that go with it.
   The server works out WHAT is late (kv.alerts); this decides WHEN and HOW LOUD to show it. */
'use strict';

const Alerts = {
  snoozed: ls.get('fqb2_alert_snooze', {}), seen: new Set(), timer: null, hideTimer: null, lastShow: 0, forced: null, demo: null,
  cfg() { return penCfg().banner; },
  list() {
    const now = Date.now();
    const live = this.demo ? [this.demo] : alertsNow();
    return live.filter(a => !(this.snoozed[a.id] > now));
  },
  // called on every render / state refresh
  render() {
    const el = $('#alerts'); if (!el) return;
    const list = this.list(), b = this.cfg();
    // brand-new penalty alerts make a sound (once per alert, not in quiet hours)
    const fresh = !this.booted; this.booted = true;
    for (const a of list) {
      if (this.seen.has(a.id)) continue;
      this.seen.add(a.id);
      if (!fresh && !isPhone() && !this.demo) this.sound(a.kind, true);
    }
    if (!list.length) { el.innerHTML = ''; el.classList.remove('on'); return; }
    const anim = (k) => (k === 'penalty' ? (b.animPenalty || []) : (b.animMissed || [])).map(x => 'an-' + x).join(' ');
    const card = (a) => `<button class="alert-card ${a.kind} ${anim(a.kind)}" data-alert="${esc(a.id)}" data-member="${esc(a.member)}">
        <span class="al-ico">${a.kind === 'penalty' ? '🚨' : '⚠️'}</span>
        <span class="al-body"><span class="al-who"><span class="av" style="background:${esc(memberOf(a.member).color || '#334')}">${esc(memberOf(a.member).emoji || '⭐')}</span>${esc(a.member)}</span><span class="al-text"><span class="al-mq">${esc(a.text)}</span></span></span>
        ${a.kind === 'penalty' ? `<span class="al-pts">−${esc(a.points)}</span>` : ''}
        <span class="al-ack" data-alert-ack="${esc(a.id)}">Got it ✓</span></button>`;
    const many = list.length > 3;
    el.innerHTML = many
      ? `<div class="alert-strip ${list.some(a => a.kind === 'penalty') ? 'penalty' : 'missed'} an-glow">${Object.entries(list.reduce((m, a) => { (m[a.member] = m[a.member] || []).push(a); return m; }, {}))
          .map(([who, as]) => `<button class="al-row" data-member="${esc(who)}"><span class="av" style="background:${esc(memberOf(who).color || '#334')}">${esc(memberOf(who).emoji || '⭐')}</span><b>${esc(who)}</b> · ${as.length} late${as.some(a => a.kind === 'penalty') ? ` · 🚨 −${as.reduce((s, a) => s + (+a.points || 0), 0)} at risk` : ''}</button>`).join('')}</div>`
      : list.map(card).join('');
    this.schedule();
  },
  // wall: show for `duration` seconds every `interval` minutes (first time right away). phone: always visible.
  schedule() {
    const el = $('#alerts'), b = this.cfg();
    if (isPhone() || this.forced) { el.classList.add('on'); return; }
    const interval = Math.max(1, +b.interval || 10) * 60000, duration = Math.max(5, +b.duration || 20) * 1000;
    const since = Date.now() - this.lastShow;
    if (since >= interval) this.show(duration);
    else if (!this.timer) this.timer = setTimeout(() => { this.timer = null; this.schedule(); }, interval - since + 50);
  },
  show(duration) {
    const el = $('#alerts'); if (!el || !el.innerHTML) return;
    this.lastShow = Date.now(); el.classList.remove('on'); void el.offsetWidth; el.classList.add('on');   // restart the arrival animation
    clearTimeout(this.hideTimer); this.hideTimer = setTimeout(() => { if (!this.forced) el.classList.remove('on'); this.schedule(); }, duration);
  },
  snooze(id, minutes) { this.snoozed[id] = Date.now() + minutes * 60000; ls.set('fqb2_alert_snooze', this.snoozed); this.render(); },
  reset() { this.lastShow = 0; this.seen = new Set(); },
  // preview from Settings: a fake alert for 12 s
  preview(kind) {
    const kid = members('kid')[0] || { name: 'Max', emoji: '🦖', color: '#34d399' };
    this.demo = { id: '_demo', kind, member: kid.name, quest: '_demo', title: 'Feed the cat', icon: '🐈', points: 5, misses: 2,
      text: kind === 'penalty' ? 'Feed the cat is late — miss it again today and it’s −5 points.' : 'Feed the cat didn’t get done yesterday.' };
    this.forced = true; this.render(); showScreen('home'); this.sound(kind, false);
    setTimeout(() => { this.demo = null; this.forced = null; this.render(); }, 12000);
  },
  sound(kind, respectQuiet) {
    const b = this.cfg(), on = b.soundOn || 'penalty';
    if (!b.sound || on === 'never' || (on === 'penalty' && kind !== 'penalty')) return;
    if (respectQuiet && inQuietHours(b)) return;
    Sound.play(b.sound, b.via || 'pi');
  },
};

/* ---------- sounds: on the Pi's speaker (server) or right here in the browser ---------- */
const Sound = {
  names: { chime: 'Two-note chime', bell: 'Soft bell', alert: 'Three beeps', buzz: 'Low buzz', ding: 'Single ding' },
  async play(name, via) {
    if (via === 'browser' || isPhone()) { this.local(name); return { ok: true }; }
    try { return await api('/api/audio', { action: 'play', sound: name }); }
    catch (e) { this.local(name); return { ok: false, error: e.message }; }
  },
  ctx: null,
  tone(f, at, dur, vol, shape) {
    const c = this.ctx, o = c.createOscillator(), g = c.createGain(); o.type = shape || 'sine'; o.frequency.value = f; o.connect(g); g.connect(c.destination);
    const t = c.currentTime + at; g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol || 0.3, t + 0.015); g.gain.exponentialRampToValueAtTime(0.0001, t + dur); o.start(t); o.stop(t + dur + 0.05);
  },
  local(name) {
    try {
      this.ctx = this.ctx || new (window.AudioContext || window.webkitAudioContext)();
      if (this.ctx.state === 'suspended') this.ctx.resume();
      if (name === 'bell') { this.tone(1047, 0, 1.3, 0.35); this.tone(2093, 0, 0.8, 0.08); }
      else if (name === 'alert') { [0, 0.22, 0.44].forEach(t => this.tone(1500, t, 0.14, 0.3)); }
      else if (name === 'buzz') { this.tone(110, 0, 0.5, 0.25, 'square'); this.tone(165, 0, 0.5, 0.12, 'square'); }
      else if (name === 'ding') { this.tone(1760, 0, 0.6, 0.3); }
      else { this.tone(880, 0, 0.4, 0.3); this.tone(1320, 0.16, 0.6, 0.3); }
    } catch (_) {}
  },
};
