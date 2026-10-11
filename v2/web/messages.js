/* Family Quest Board v2 — Messages: one thread per pair of people, plus the Family group.
   Read status lives on the Pi per person, so it follows you between devices. */
'use strict';

const KID_QUICK = ['I’m hungry 🍎', 'Can I have screen time? 📺', 'Come here please 🙏', 'I’m done with homework ✅', 'I need help 🆘', 'Love you ❤️'];
const PARENT_QUICK = ['👍 Yes', '👎 Not now', '🏃 On my way', 'Dinner’s ready 🍽️', 'Come here please', 'Love you ❤️'];
const FAMILY = 'family';
const convoId = (a, b) => (a === FAMILY || b === FAMILY) ? FAMILY : [a, b].sort().join('|');
const Msg = {
  cur: null, draft: {}, knownIds: null, bt: null, seenKey: 'fqb2_msg_seen',
  enabled() { return String(cfg('messages_enabled', 'TRUE')).toUpperCase() !== 'FALSE'; },
  all() { return (X.get('messages', []) || []).filter(m => m && m.text && m.at).slice().sort((a, b) => a.at < b.at ? -1 : 1); },
  cid(m) { return convoId(m.from, (m.to === 'parents' || m.to === 'all' || !m.to) ? FAMILY : m.to); },
  me() { return Me.name(); },
  who() { return Me.who(); },
  localSeen() { return ls.get(this.seenKey, {}); },
  seen() {
    const all = X.get('msg_seen', {}) || {}, out = Object.assign({}, this.localSeen());
    const maps = this.who() === 'wall' ? Object.values(all) : [all[this.who()] || {}];
    for (const m of maps) for (const [c, at] of Object.entries(m || {})) if (!out[c] || at > out[c]) out[c] = at;
    return out;
  },
  markSeen(cid) {
    const last = this.thread(cid).slice(-1)[0]; if (!last) { this.badge(); return; }
    const loc = this.localSeen(); if (!loc[cid] || last.at > loc[cid]) { loc[cid] = last.at; ls.set(this.seenKey, loc); }
    const who = this.who(), mine = Object.assign({}, (X.get('msg_seen', {}) || {})[who] || {});
    if (!mine[cid] || last.at > mine[cid]) { mine[cid] = last.at; X.merge('msg_seen', { [who]: mine }).catch(() => {}); }
    this.badge();
  },
  mine(cid) { const me = this.me(); return !me || cid === FAMILY || cid.split('|').includes(me); },
  thread(cid) { return this.all().filter(m => this.cid(m) === cid); },
  convos() {
    const map = {}; for (const m of this.all()) { const c = this.cid(m); (map[c] = map[c] || { id: c, msgs: [] }).msgs.push(m); }
    if (!map[FAMILY]) map[FAMILY] = { id: FAMILY, msgs: [] };
    const seen = this.seen(), me = this.me();
    return Object.values(map).filter(c => this.mine(c.id)).map(c => { const last = c.msgs[c.msgs.length - 1]; return Object.assign(c, { last, unread: c.msgs.filter(m => m.at > (seen[c.id] || '') && m.from !== me).length, at: last ? last.at : '' }); }).sort((a, b) => (b.at || '') < (a.at || '') ? -1 : 1);
  },
  people(cid) { return cid === FAMILY ? members().map(m => m.name) : cid.split('|'); },
  title(cid) { if (cid === FAMILY) return 'Family'; const me = this.me(), ps = cid.split('|'); return me && ps.includes(me) ? ps.find(p => p !== me) : ps.join(' & '); },
  avatars(cid) { const who = cid === FAMILY ? members().slice(0, 3).map(m => m.name) : (this.me() ? [this.title(cid)] : cid.split('|')); return `<span class="avs">${who.map(n => { const m = memberOf(n); return `<span class="av" style="${m.color ? `background:${esc(m.color)}` : ''}">${esc(m.emoji || '👤')}</span>`; }).join('')}</span>`; },
  unreadTotal() { return S.state && this.enabled() ? this.convos().reduce((a, c) => a + c.unread, 0) : 0; },
  badge() { const n = this.unreadTotal(); badge('#badge-msg', n); },
  senders(cid) { if (this.me()) return [this.me()]; return cid === FAMILY ? members().map(m => m.name) : cid.split('|'); },
  sender(cid) { const ok = this.senders(cid), d = this.draft[cid] || {}; if (d.as && ok.includes(d.as)) return d.as; return ok.find(n => Me.isKid(n)) || ok[0]; },
  recipient(cid, from) { return cid === FAMILY ? FAMILY : cid.split('|').find(p => p !== from); },
  topicFor(n) { return String(cfg('msg_topic_' + n, '') || cfg('notify_msg_topic', '')).trim(); },
  targets(cid, from) { const seen = {}, out = []; for (const n of this.people(cid).filter(n => n !== from && Me.isParent(n))) { const t = this.topicFor(n); if (!t) continue; if (seen[t]) { seen[t].as = 'Parent'; continue; } seen[t] = { topic: t, as: n }; out.push(seen[t]); } return out; },
  open(cid) { this.cur = cid; renderMessages(); this.markSeen(cid); $('#chat').classList.add('open'); if (isPhone()) { try { history.replaceState(null, '', '#chat/' + encodeURIComponent(cid)); } catch (_) {} } },
  back() { this.cur = null; $('#chat').classList.remove('open'); renderMessages(); },
  onShow() { if (isPhone() && !this.me()) Me.pick().then(() => { if (this.cur && !this.mine(this.cur)) this.cur = null; renderMessages(); }); renderMessages(); if (this.cur) this.markSeen(this.cur); },
  async send(text) {
    const cid = this.cur; if (!cid) return;
    const d = this.draft[cid] = this.draft[cid] || {}; text = String(text || d.text || '').trim();
    if (!text) { toast('Type a message first', true); return; }
    const from = this.sender(cid), to = this.recipient(cid, from);
    try {
      const j = await api('/api/msg', { from, to, text, kind: Me.isKid(from) ? 'kid' : 'parent', targets: this.targets(cid, from), fulltext: cfg('msg_fulltext', 'TRUE'), cid });
      d.text = ''; await Sync.refresh(); this.knownIds = new Set(this.all().map(m => m.id)); renderMessages(); this.markSeen(cid);
      if (j.limited) toast('Sent — phone alerts paused for a minute (lots of messages)');
    } catch (e) { toast('Couldn’t send: ' + (e.message || e), true); }
  },
  check() {
    const ids = new Set(this.all().map(m => m.id));
    if (this.knownIds) { const me = this.me(); const fresh = this.all().filter(m => !this.knownIds.has(m.id) && m.from !== me && this.mine(this.cid(m))); if (fresh.length) this.announce(fresh[fresh.length - 1]); }
    this.knownIds = ids; this.badge();
    if (S.screen === 'messages') { renderMessages(); if (this.cur) this.markSeen(this.cur); }
  },
  announce(m) {
    if (!this.enabled()) return;
    if (!isPhone()) { try { Display.wake(); } catch (_) {} }
    if (isPhone() && S.screen === 'messages' && this.cur === this.cid(m)) { chime(); return; }
    const who = memberOf(m.from), el = $('#msg-banner');
    el.innerHTML = `💬 ${esc(who.emoji || '')} ${esc(m.from)}: ${esc(m.text)}<small>tap to open</small>`;
    el.dataset.cid = this.cid(m); el.classList.add('on'); clearTimeout(this.bt); this.bt = setTimeout(() => el.classList.remove('on'), 10000); chime();
  },
  async parentOk(what) { if (S.parent) return true; return Parent.ask(`Parent PIN to delete ${what}`); },
  async remove(ids) { await X.op({ op: 'remove', key: 'messages', ids }); this.knownIds = new Set(this.all().map(m => m.id)); this.badge(); renderMessages(); },
  async deleteConvo(cid) {
    const msgs = this.thread(cid); if (!msgs.length) { toast('Nothing to delete'); return; }
    if (!await this.parentOk('this conversation')) return;
    if (!await Modal.confirm({ icon: '🗑️', title: `Delete the conversation ${cid === FAMILY ? 'in Family' : 'between ' + cid.split('|').join(' & ')}?`, body: `All ${msgs.length} message${msgs.length === 1 ? '' : 's'} are removed from the wall and every phone.`, ok: 'Delete', okClass: 'bad' })) return;
    if (cid !== FAMILY) this.cur = null; await this.remove(msgs.map(m => m.id)); toast('Conversation deleted');
  },
  async deleteOne(id) {
    const m = this.all().find(x => x.id === id); if (!m) return;
    if (!await this.parentOk('this message')) return;
    if (!await Modal.confirm({ icon: '🗑️', title: 'Delete this message?', body: `<b>${esc(m.from)}:</b> ${esc(m.text)}`, ok: 'Delete', okClass: 'bad' })) return;
    await this.remove([id]); toast('Message deleted');
  },
};
function renderMessages() {
  if (!S.state) return;
  const list = $('#chat-list'), pane = $('#chat-pane'), sub = $('#msg-sub');
  if (!Msg.enabled()) { list.innerHTML = ''; pane.innerHTML = '<div class="chat-empty">Messages are turned off.<br><span style="font-size:14px">Parents → Settings → Messages</span></div>'; sub.textContent = ''; return; }
  const me = Msg.me();
  if (isPhone() && !me) { list.innerHTML = ''; $('#chat').classList.add('open'); pane.innerHTML = `<div class="chat-empty"><div><div style="font-size:22px;font-weight:800;color:var(--text);margin-bottom:6px">Who’s using this phone?</div><div style="margin-bottom:16px">Messages you send will come from them.</div><div class="seg" style="justify-content:center">${members().map(m => `<button data-setme="${esc(m.name)}">${esc(m.emoji || '👤')} ${esc(m.name)}</button>`).join('')}</div></div></div>`; sub.textContent = ''; return; }
  sub.innerHTML = me ? `you’re <b>${esc(me)}</b> · <a href="#" data-changeme style="color:var(--muted)">change</a>` : 'tap a conversation · parents get a buzz on their phones';
  const convos = Msg.convos();
  list.innerHTML = `<div class="clhead"><span>Conversations</span><button data-newchat>＋ New</button></div>` + convos.map(c => `<button class="convo ${c.id === Msg.cur ? 'on' : ''} ${c.unread ? 'unread' : ''}" data-convo="${esc(c.id)}">${Msg.avatars(c.id)}<span class="ct"><span class="cn"><span>${esc(Msg.title(c.id))}</span>${c.last ? `<span class="tm">${esc(relTime(c.last.at))}</span>` : ''}</span><span class="cp">${c.last ? `${c.id === FAMILY || !me ? esc(c.last.from) + ': ' : c.last.from === me ? 'You: ' : ''}${esc(c.last.text)}` : 'No messages yet'}</span></span>${c.unread ? '<span class="dot"></span>' : ''}</button>`).join('');
  const cid = Msg.cur;
  if (!cid) { pane.innerHTML = `<div class="chat-empty"><div>💬<br>Pick a conversation, or tap <b>＋ New</b> to message someone.</div></div>`; $('#chat').classList.remove('open'); return; }
  const msgs = Msg.thread(cid), seen = Msg.seen()[cid] || '', from = Msg.sender(cid), d = Msg.draft[cid] || {};
  let lastDay = '';
  const bubbles = msgs.map(m => { const mem = memberOf(m.from), t = new Date(m.at), dk = dayKey(t); const day = dk !== lastDay ? `<div class="msg-day">${dk === dayKey(new Date()) ? 'Today' : t.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' })}</div>` : ''; lastDay = dk; const mine = me ? m.from === me : false;
    return day + `<div class="bub ${mine ? 'me' : ''} ${m.at > seen && m.from !== me ? 'new' : ''}" data-mid="${esc(m.id || '')}"><span class="av" style="${mem.color ? `background:${esc(mem.color)}` : ''}">${esc(mem.emoji || '👤')}</span><div class="bx">${!mine ? `<div class="who">${esc(m.from)}</div>` : ''}<div class="tx">${esc(m.text)}</div><div class="tm">${esc(fmtTime(t))}</div></div></div>`; }).join('');
  const senders = Msg.senders(cid), quick = Me.isKid(from) ? KID_QUICK : PARENT_QUICK, buzz = Msg.targets(cid, from);
  pane.innerHTML = `<div class="thread-head"><button class="back" data-back>‹ Back</button>${Msg.avatars(cid)}<div><div class="tn">${esc(Msg.title(cid))}</div><div class="ts">${cid === FAMILY ? 'everyone sees this' : buzz.length ? `${esc(buzz.map(b => b.as).join(' & '))} gets a buzz on their phone` : Msg.people(cid).filter(n => n !== from).some(n => Me.isParent(n)) ? 'no phone set for them yet (Parents → Settings → Messages)' : 'shows on the wall'}${!isPhone() && msgs.length ? ' · hold a message to delete it' : ''}</div></div>${!isPhone() && msgs.length ? '<button class="del" data-delconvo>🗑 Delete</button>' : ''}</div>
    <div class="thread" id="thread">${bubbles || `<div class="chat-empty">Say hi 👋</div>`}</div>
    <div class="composer">${senders.length > 1 ? `<div class="as">Sending as ${senders.map(n => `<button data-as="${esc(n)}" class="${n === from ? 'on' : ''}">${esc(memberOf(n).emoji || '')} ${esc(n)}</button>`).join('')}</div>` : ''}
      <div class="quick">${quick.map(q => `<button data-mquick="${esc(q)}">${esc(q)}</button>`).join('')}</div>
      <div class="box"><button class="field ${d.text ? '' : 'ph'}" id="msg-type">${esc(d.text) || 'Message…'}</button><button class="send" id="msg-send" aria-label="Send">➤</button></div></div>`;
  const th = $('#thread'); th.scrollTop = th.scrollHeight; $('#chat').classList.add('open');
}
