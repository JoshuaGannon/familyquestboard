/* Family Quest Board v2 — Parent Zone: approvals, dinner, quests & rewards, bonus, family, display, settings */
'use strict';

function renderParent() {
  const body = $('#pbody');
  $$('.ptab').forEach(b => b.classList.toggle('active', b.dataset.ptab === S.ptab));
  $('#parent-lockbtn').style.display = S.parent ? '' : 'none';
  $('#parent-sub').textContent = S.parent ? '' : 'parents only';
  if (!S.parent) {
    body.innerHTML = `<div class="empty">🔒<br>This part is for parents.<br><button class="btn primary" data-act="parent-unlock" style="margin-top:16px">Enter PIN</button></div>`;
    $('#ptabs').style.display = 'none';
    Parent.ask().then(ok => { if (ok) renderParent(); });
    return;
  }
  $('#ptabs').style.display = '';
  const mem = (n) => memberOf(n);
  if (S.ptab === 'queue') {
    const q = (S.state.queue || []).filter(k => k.status === 'pending').sort((a, b) => a.submitted_at < b.submitted_at ? 1 : -1), recent = recentDecisions().slice(0, 12);
    const pm = (k) => { const e = Object.values(X.get('penaltyLog', {}) || {}).find(x => x && x.queue_id === k.id); return e ? ` · missed ${e.misses} in a row` : ''; };
    const row = (k, acts) => `<div class="qrow ${k.type === 'penalty' ? 'penalty' : ''}"><span class="qi">${k.type === 'penalty' ? '⚠️' : esc(mem(k.member).emoji || '⭐')}</span><span><div class="qt">${esc(k.member)} · ${esc(k.title)}</div><div class="qs">${k.type === 'help' ? '🙋 Needs help' : k.type === 'reward' ? 'Reward' : k.type === 'adjust' ? 'Adjustment' : k.type === 'penalty' ? (acts ? 'Proposed penalty' : k.status === 'rejected' ? 'Penalty forgiven' : 'Penalty') + pm(k) : 'Quest'}${k.type === 'help' ? '' : ` · ${k.points > 0 ? '+' : ''}${esc(k.points)} pts`} · ${esc(when(k.submitted_at))}${acts ? '' : ' · ' + esc(k.type === 'penalty' ? (k.status === 'approved' ? 'applied' : k.status === 'rejected' ? 'forgiven' : k.status) : k.status) + (X.get('auto', {})[k.id] ? ' (auto)' : '')}</div></span>${acts ? (k.type === 'help' ? `<span class="acts"><button class="btn sm good" data-review="approved" data-id="${esc(k.id)}">👍 Got it</button></span>` : k.type === 'penalty' ? `<span class="acts"><button class="btn sm ghost" data-review="rejected" data-id="${esc(k.id)}">🕊️ Forgive</button><button class="btn sm bad" data-review="approved" data-id="${esc(k.id)}">Apply ${esc(k.points)}</button></span>` : `<span class="acts"><button class="btn sm bad" data-review="rejected" data-id="${esc(k.id)}">✕ Reject</button><button class="btn sm good" data-review="approved" data-id="${esc(k.id)}">✓ Approve</button></span>`) : k.type !== 'help' ? `<span class="acts"><button class="btn sm ghost" data-undo="${esc(k.id)}">↶ Undo</button></span>` : ''}</div>`;
    const pz = prizesFor();
    const pzHtml = pz.length ? `<div class="prizebox"><div class="sect" style="margin-top:0">🏆 Streak prizes to hand out</div>${pz.map(p => `<div class="qrow"><span class="qi">${esc(mem(p.member).emoji || '⭐')}</span><span><div class="qt">${esc(p.member)} · ${esc(p.text)}</div><div class="qs">${esc(p.label || '')} · ${esc(when(p.at))}</div></span><span class="acts"><button class="btn sm good" data-prizegiven="${esc(p.id)}">Given ✓</button></span></div>`).join('')}</div>` : '';
    body.innerHTML = pzHtml + (q.length ? q.map(k => row(k, true)).join('') : `<div class="empty">Nothing waiting for approval 🎉</div>`) + (recent.length ? `<div class="sect">Recent</div>` + recent.map(k => row(k, false)).join('') : '');
  } else if (S.ptab === 'dinner') {
    let html = '';
    for (let i = 0; i < 14; i++) { const d = addDays(new Date(), i), din = dinnerFor(d); html += `<button class="drow" data-date="${dayKey(d)}"><span class="dd">${i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : DAYS[d.getDay()]}<br><small>${d.toLocaleDateString([], { month: 'short', day: 'numeric' })}</small></span><span class="dm ${din ? '' : 'none'}">${din ? esc(din.meal) : 'tap to plan'}${din && din.note ? ` <small class="muted">· ${esc(din.note)}</small>` : ''}</span></button>`; }
    body.innerHTML = html;
  } else if (S.ptab === 'quests') {
    const on = (x) => x.active === '' || x.active === undefined || isTrue(x.active);
    const quests = (S.state.quests || []).filter(q => q.title).slice().sort((a, b) => on(b) - on(a) || a.title.localeCompare(b.title));
    const rewards = (S.state.rewards || []).filter(r => r.title).slice().sort((a, b) => on(b) - on(a) || (+a.cost || 0) - (+b.cost || 0));
    body.innerHTML = `<div class="row" style="justify-content:space-between;margin-bottom:10px"><span class="sect" style="margin:0">Quests · ${quests.length}</span><button class="btn primary sm" data-act="quest-add">＋ New quest</button></div>
      ${quests.length ? quests.map(q => `<button class="prow ${on(q) ? '' : 'off'}" data-qedit="${esc(q.id)}"><span class="pt" style="font-size:26px;min-width:40px">${esc(q.icon || '⭐')}</span><span><div class="pm">${esc(q.title)}</div><div class="pd">${esc(questRepeatLabel(q.repeat))}${questOpts(q).auto ? ' · ✓ auto-approve' : ''}${questPen(q) ? ' · ⚠️ penalties' : ''} · ${esc(q.assigned_to || 'Anyone')}${on(q) ? '' : ' · paused'}</div></span><span class="badge2">+${esc(q.points || 0)} pts</span></button>`).join('') : '<div class="empty">No quests yet.</div>'}
      <div class="row" style="justify-content:space-between;margin:26px 0 10px"><span class="sect" style="margin:0">Rewards · ${rewards.length}</span><button class="btn primary sm" data-act="reward-add">＋ New reward</button></div>
      ${rewards.length ? rewards.map(r => `<button class="prow ${on(r) ? '' : 'off'}" data-redit="${esc(r.id)}"><span class="pt" style="font-size:26px;min-width:40px">${esc(r.icon || '🎁')}</span><span><div class="pm">${esc(r.title)}</div><div class="pd">${on(r) ? 'Available' : 'Paused'}${X.get('locks', {})[r.id] ? ' · ' + esc(lockLabel(X.get('locks', {})[r.id])) : ''}</div></span><span class="badge2" style="background:var(--card-hi);color:var(--accent)">${esc(r.cost || 0)} pts</span></button>`).join('') : '<div class="empty">No rewards yet.</div>'}
      <div class="note" style="margin-top:14px">Tap a quest or reward to edit it. A paused quest is hidden without losing its history.</div>`;
  } else if (S.ptab === 'bonus') {
    const kids = members('kid'); if (!kids.find(k => k.name === S.bonus.member)) S.bonus.member = kids[0] ? kids[0].name : '';
    const bvals = [1, 2, 3, 4, 5, 10, 15, 20, 25, 50, 100], mag = Math.abs(S.bonus.points), neg = S.bonus.points < 0;
    body.innerHTML = `<div class="form"><label>Who</label><div class="seg">${kids.map(k => `<button data-bm="${esc(k.name)}" class="${S.bonus.member === k.name ? 'on' : ''}">${esc(k.emoji)} ${esc(k.name)}</button>`).join('')}</div>
      <label>Give or take</label><div class="seg"><button data-bsign="1" class="${neg ? '' : 'on good'}">＋ Give points</button><button data-bsign="-1" class="${neg ? 'on' : ''}">− Take points</button></div>
      <label>How many</label><div class="seg">${bvals.map(p => `<button data-bp="${p}" class="${mag === p ? 'on' : ''}">${p}</button>`).join('')}<button data-bp="custom" class="${bvals.includes(mag) ? '' : 'on'}">${bvals.includes(mag) ? 'Other…' : mag + ' ✎'}</button></div>
      <label>Reason</label><button class="field ${S.bonus.reason ? '' : 'ph'}" data-act="bonus-reason">${esc(S.bonus.reason) || 'e.g. Helped grandma, great report card…'}</button>
      <div class="row" style="margin-top:16px"><button class="btn primary" data-act="bonus-go">${neg ? `Take ${mag} from` : `Give +${mag} to`} ${esc(S.bonus.member || '…')}</button></div></div>`;
    const rb = recentDecisions().filter(k => k.type === 'adjust').slice(0, 8);
    if (rb.length) body.innerHTML += `<div class="sect">Recent points</div>` + rb.map(k => `<div class="qrow"><span class="qi">${esc(mem(k.member).emoji || '⭐')}</span><span><div class="qt">${esc(k.member)} · ${+k.points > 0 ? '+' : ''}${esc(k.points)} pts</div><div class="qs">${esc(k.title)} · ${esc(when(k.reviewed_at || k.submitted_at))}</div></span><span class="acts"><button class="btn sm ghost" data-undo="${esc(k.id)}">↶ Undo</button></span></div>`).join('');
  } else if (S.ptab === 'family') {
    const ms = (S.state.members || []), c = streakCfg(), paused = (c.pauses || []).some(p => p.from && !p.to), pc = penCfg(), pend = (S.state.queue || []).filter(k => k.type === 'penalty' && k.status === 'pending');
    const notes = (X.get('notes', []) || []).filter(Boolean), cds = (X.get('countdowns', []) || []).filter(Boolean).sort((a, b) => a.date < b.date ? -1 : 1), coupons = (X.get('coupons', []) || []).filter(x => x && !x.used);
    body.innerHTML = `
      <div class="fx-sec"><h3>👨‍👩‍👧 Members</h3>${ms.map(m => `<button class="mem-row ${m.active === 'FALSE' ? 'off' : ''}" data-medit="${esc(m.name)}"><span class="av" style="background:${esc(m.color || '#334')}">${esc(m.emoji || '👤')}</span><span><div class="mn">${esc(m.name)}</div><div class="mr">${m.role === 'parent' ? 'Parent' : 'Kid'}${m.active === 'FALSE' ? ' · hidden' : ''}${m.role === 'kid' ? ` · ${balance(m.name).approved} pts` : ''}</div></span></button>`).join('')}<div class="row" style="margin-top:8px"><button class="btn sm primary" data-act="member-add">＋ Add a person</button></div></div>
      <div class="fx-sec"><h3>🔥 Streaks</h3>
        <div class="fx-row"><span class="grow">Family default prizes<div class="muted" style="font-size:14px">${(c.milestones || []).map(m => `🔥${m.n} in a row → 🎟️ −${m.off} pts coupon`).join(' · ') || 'none'}</div></span><button class="btn sm" data-fx="milestones">Change</button></div>
        <div class="fx-row"><span class="grow">Streak shield<div class="muted" style="font-size:14px">One missed day per week is forgiven (daily quests)</div></span><button class="btn sm ${c.shield ? 'good' : ''}" data-fx="shield">${c.shield ? 'On' : 'Off'}</button></div>
        <div class="fx-row"><span class="grow">Pause streaks<div class="muted" style="font-size:14px">For vacations and sick days — paused days don't count or break streaks</div></span><button class="btn sm ${paused ? 'good' : ''}" data-fx="pause">${paused ? '⏸ Paused — tap to resume' : 'Pause now'}</button></div></div>
      <div class="fx-sec"><h3>⚠️ Missed quests</h3>
        <div class="fx-row"><span class="grow">Warnings &amp; point penalties<div class="muted" style="font-size:14px">${pc.enabled ? esc(penSummary(pc)) : 'Off — nothing happens when a quest isn’t done'}</div></span><button class="btn sm ${pc.enabled ? 'good' : ''}" data-fx="pen-toggle">${pc.enabled ? 'On' : 'Off'}</button><button class="btn sm" data-fx="pen-edit">Change</button></div>
        <div class="fx-row"><span class="grow">Where the alerts go<div class="muted" style="font-size:14px">${esc(routeLabel(pc.route))}${pc.nag ? ` · heads-up at ${esc(pc.nag)}` : ''}${pc.digest ? ` · parents’ summary at ${esc(pc.digest)}` : ''}. Each quest can override this.</div></span><button class="btn sm ghost" data-fx="pen-run">Check now</button></div>
        ${pend.length ? `<div class="note" style="margin-top:6px">⚠️ ${pend.length} proposed penalt${pend.length === 1 ? 'y' : 'ies'} waiting under Approvals.</div>` : ''}</div>
      <div class="fx-sec"><h3>🎟️ Unused coupons</h3>${coupons.length ? coupons.map(x => `<div class="fx-row"><span class="grow">${esc(x.member)} · −${esc(x.off)} pts <span class="muted">${esc(x.label || '')}</span></span><button class="btn sm bad" data-fxdelcoupon="${esc(x.id)}">Remove</button></div>`).join('') : '<div class="muted">None yet — kids earn them from streak milestones.</div>'}<div class="fx-row"><span class="grow muted" style="font-size:14px">Give one by hand</span><button class="btn sm" data-fx="givecoupon">＋ Give coupon</button></div></div>
      <div class="fx-sec"><h3>⏳ Countdowns</h3>${cds.length ? cds.map(x => `<div class="fx-row"><span style="font-size:22px">${esc(x.emoji || '⏳')}</span><span class="grow">${esc(x.title)} <span class="muted">· ${esc(new Date(x.date + 'T12:00:00').toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' }))}</span></span><button class="btn sm bad" data-fxdelcd="${esc(x.id)}">Remove</button></div>`).join('') : '<div class="muted">No countdowns. Calendar events with ⏳ or #countdown in the title show up on their own.</div>'}<div class="fx-row"><span class="grow"></span><button class="btn sm primary" data-fx="addcd">＋ Add countdown</button></div></div>
      <div class="fx-sec"><h3>📌 Notes on the board</h3>${notes.length ? notes.map(n => `<div class="fx-row"><span class="grow">${esc(n.text)}</span><button class="btn sm bad" data-fxdelnote="${esc(n.id)}">Remove</button></div>`).join('') : '<div class="muted">No notes. Anyone can post one from the home screen (＋ Note).</div>'}</div>`;
  } else if (S.ptab === 'display') {
    const now = new Date(), cur = periodAt(now), eff = Display.effective(), nx = nextChange(now), hw = Display.hw, ov = Display.override, wakeLeft = Display.wakeUntil > Date.now() ? Math.ceil((Display.wakeUntil - Date.now()) / 60000) : 0;
    body.innerHTML = `<div class="dstatus"><div><div class="now">${esc(modeLabel(eff))}</div><div class="sub">${ov ? `Manual override${ov.until ? ` · ${Math.ceil((ov.until - Date.now()) / 60000)} min left` : ''}` : wakeLeft ? `Woken by touch · back to ${esc(modeLabel(cur.mode))} in ${wakeLeft} min` : nx ? `Until ${esc(nx.at)}${nx.tomorrow ? ' tomorrow' : ''}, then ${esc(modeLabel(nx.mode))}` : 'Following the schedule'}</div></div><span class="hw ${hw.supported ? 'ok' : 'no'}">${hw.supported ? `⏻ Screen power: ${esc(hw.method)}` : '⏻ Screen power not available — "off" shows black'}</span></div>
      <label>Right now</label><div class="seg" style="margin-bottom:18px">${MODES.map(m => `<button data-ovr="${m[0]}" class="${ov && ov.mode === m[0] ? 'on' : ''}">${m[1]}</button>`).join('')}<button data-ovr="" class="${ov ? '' : 'on'}">↻ Follow schedule</button></div>
      <label>Daily schedule</label>${displayPeriods().map(p => `<button class="prow ${p.id === cur.id ? 'cur' : ''}" data-period="${esc(p.id)}"><span class="pt">${esc(p.start)}</span><span><div class="pm">${esc(modeLabel(p.mode))}</div><div class="pd">${esc(daysLabel(p.days))}</div></span>${p.id === cur.id ? '<span class="badge2">NOW</span>' : ''}</button>`).join('')}
      <div class="row" style="margin:14px 0 24px"><button class="btn primary" data-act="disp-add">＋ Add period</button></div>
      <label>Timing</label><div class="row"><button class="btn sm" data-cfg="touch_wake_min">Touch keeps it awake: <b>${esc(cfg('touch_wake_min', '2'))} min</b></button><button class="btn sm" data-cfg="idle_timeout_sec">Back to home after: <b>${esc(cfg('idle_timeout_sec', '90'))} s</b></button><button class="btn sm" data-cfg="photo_interval_sec">Each photo shows for: <b>${esc(cfg('photo_interval_sec', '20'))} s</b></button><button class="btn sm" data-cfg="clock_dim">Dim clock brightness: <b>${esc(cfg('clock_dim', '35'))}%</b></button></div>
      <div class="note" style="margin-top:8px">Touch the screen during a clock or off period and the full board comes back for the touch-wake time, then it settles again.</div>`;
  } else if (S.ptab === 'settings') {
    const sv = S.server || {}, imp = S.state.import || {}, pb = penCfg().banner;
    const feeds = String(cfg('ical_urls', '')).split('\n').map(s => s.trim()).filter(Boolean);
    body.innerHTML = `<div class="form">
      <label>Family</label><div class="row"><button class="btn sm" data-cfgtext="family_name">🏠 Family name: <b>${esc(cfg('family_name', ''))}</b></button><button class="btn sm" data-cfgpin>🔒 Change PIN</button><button class="btn sm" data-cfgtext="lat,lon">📍 Weather location: <b>${esc(cfg('lat', ''))}, ${esc(cfg('lon', ''))}</b></button><button class="btn sm" data-act="cfg-units">🌡️ ${cfg('weather_units', 'F') === 'C' ? 'Celsius' : 'Fahrenheit'}</button></div>
      <label>Calendar</label><div class="note">Paste your calendar’s <b>iCal link</b> (Google Calendar: Settings → your calendar → “Secret address in iCal format”). One per line as <code>Name | #color | link</code>, or just the link.</div>
      ${feeds.length ? feeds.map((f, i) => `<div class="fx-row"><span class="grow" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(f.split('|').length > 1 ? f.split('|')[0].trim() : f)}</span><button class="btn sm bad" data-feeddel="${i}">Remove</button></div>`).join('') : '<div class="muted">No calendar feeds yet.</div>'}
      <div class="row" style="margin-top:8px"><button class="btn sm primary" data-act="feed-add">＋ Add a calendar</button><button class="btn sm" data-cfgnum="calendar_days">Days ahead: <b>${esc(cfg('calendar_days', '14'))}</b></button><button class="btn sm ghost" data-act="cal-refresh">↻ Refresh now</button></div>
      ${(S.state.calendar_errors || []).length ? `<div class="note" style="color:var(--bad)">⚠️ ${esc((S.state.calendar_errors || []).join(' · '))}</div>` : ''}
      <label>Alerts to your phones</label><div class="note">Push uses the free <b>ntfy</b> app: subscribe to a private topic name you invent, enter it here. The Pi sends the alert the moment something happens, and tapping it opens the board on the right screen.</div>
      <div class="row"><button class="btn sm" data-cfgtext="notify_ntfy_topic">📲 Family topic: <b>${esc(cfg('notify_ntfy_topic', '')) || 'not set'}</b></button><button class="btn sm ghost" data-act="notify-test">Send a test</button></div>
      <div class="seg" style="margin-top:8px">${[['quest', '✅ Quest finished'], ['help', '🙋 Needs help'], ['reward', '🎁 Reward requested'], ['streak', '🔥 Streak prize earned']].map(([k, l]) => `<button data-nev="${k}" class="${notifyOn(k) ? 'on good' : ''}">${l}</button>`).join('')}</div>
      <label>Board alerts &amp; sounds</label><div class="note">When a quest is missed, a big notice shows on the home screen (and over the dim clock). It comes back every so often until the quest is done. Turn penalties on under <b>Family → Missed quests</b>.</div>
      <div class="row"><button class="btn sm" data-pb="interval">⏱️ Shows every <b>${esc(pb.interval)} min</b></button><button class="btn sm" data-pb="duration">for <b>${esc(pb.duration)} s</b></button><button class="btn sm ghost" data-act="alert-preview-missed">👀 Preview “missed”</button><button class="btn sm ghost" data-act="alert-preview-penalty">👀 Preview “penalty”</button></div>
      <div class="note hint">Effects for a <b>missed</b> notice</div><div class="seg">${ANIMS.map(([k, l]) => `<button data-pban="missed:${k}" class="${(pb.animMissed || []).includes(k) ? 'on' : ''}">${l}</button>`).join('')}</div>
      <div class="note hint">Effects for a <b>penalty coming</b> notice</div><div class="seg">${ANIMS.map(([k, l]) => `<button data-pban="penalty:${k}" class="${(pb.animPenalty || []).includes(k) ? 'on good' : ''}">${l}</button>`).join('')}</div>
      <div class="note hint">Sound</div><div class="seg"><button data-pbsnd="" class="${!pb.sound ? 'on' : ''}">🔇 None</button>${Object.entries(Sound.names).map(([k, l]) => `<button data-pbsnd="${k}" class="${pb.sound === k ? 'on' : ''}">🔔 ${l}</button>`).join('')}</div>
      <div class="row" style="margin-top:6px"><div class="seg">${[['penalty', 'Only for penalties'], ['both', 'Missed too'], ['never', 'Never']].map(([k, l]) => `<button data-pbon="${k}" class="${(pb.soundOn || 'penalty') === k ? 'on' : ''}">${l}</button>`).join('')}</div><div class="seg">${[['pi', '🔊 Pi speaker'], ['browser', '🖥️ In the page']].map(([k, l]) => `<button data-pbvia="${k}" class="${(pb.via || 'pi') === k ? 'on info' : ''}">${l}</button>`).join('')}</div><button class="btn sm" data-pb="quiet">🌙 Quiet <b>${esc(pb.quietFrom)}–${esc(pb.quietTo)}</b></button></div>
      <div class="row" style="margin-top:8px"><button class="btn sm primary" data-act="snd-test-pi">▶ Test on the Pi speaker</button><button class="btn sm" data-act="snd-test-here">▶ Test in this browser</button><button class="btn sm ghost" data-act="snd-probe">🔎 Check Pi audio</button></div>
      <div id="snd-pi"><div class="vol"><span>🔈</span><input type="range" min="0" max="100" value="${esc(pb.volume ?? 70)}" id="snd-vol"><span>🔊</span><b id="snd-vol-n">${esc(pb.volume ?? 70)}%</b><button class="btn sm" data-act="snd-vol-set">Set Pi volume</button></div><div class="note hint" id="snd-info">${S.audio ? audioInfo(S.audio) : 'Volume is the Pi’s own system volume (not just this page). Tap “Check Pi audio” to see the outputs it found.'}</div></div>
      <label>Messages</label><div class="row"><button class="btn sm ${Msg.enabled() ? 'good' : ''}" data-act="msg-toggle">${Msg.enabled() ? '💬 Messages are on' : '💬 Messages are off'}</button><button class="btn sm ${isTrue(cfg('msg_fulltext', 'TRUE')) ? '' : 'good'}" data-act="msg-full">${isTrue(cfg('msg_fulltext', 'TRUE')) ? 'Lock screen shows the message' : 'Lock screen: “new message” only ✓'}</button><button class="btn sm ghost" data-act="msg-clear">🧹 Clear history</button></div>
      <div class="note">Each parent subscribes to their own ntfy topic so a message to them buzzes their phone only.</div>
      <div class="row">${members('parent').map(p => `<button class="btn sm" data-cfgtext="msg_topic_${esc(p.name)}">${esc(p.emoji || '📲')} ${esc(p.name)}’s phone: <b>${esc(cfg('msg_topic_' + p.name, '')) || 'not set'}</b></button>`).join('')}</div>
      <label>Phones & internet</label><div class="note">On home Wi-Fi: <b style="font-size:19px">http://${esc(sv.lan_ip || '…')}:${esc(sv.port || '')}</b>${sv.hostname ? ` or <b style="font-size:19px">http://${esc(sv.hostname)}:${esc(sv.port)}</b>` : ''}. ${sv.remote ? 'You’re connected from outside the house right now; the password can only be changed from home.' : sv.public_host ? `From anywhere: <b style="font-size:19px">https://${esc(sv.public_host)}${esc(sv.public_prefix || '')}</b>.` : 'Internet access needs the Caddy setup (see README).'} Family password: <b>${sv.access ? 'set ✓' : 'not set (blocked from outside)'}</b></div>
      ${!sv.remote ? `<div class="row"><button class="btn sm primary" data-act="set-access">${sv.access ? 'Change password' : 'Set password'}</button>${sv.access ? '<button class="btn sm ghost" data-act="set-access-off">Turn off internet access</button>' : ''}</div>` : ''}
      <label>To-do list</label><div class="row"><button class="btn sm ${isTrue(cfg('todos_require_pin', 'FALSE')) ? 'good' : ''}" data-act="todo-pin">${isTrue(cfg('todos_require_pin', 'FALSE')) ? '🔒 Needs the parent PIN' : '🔓 Anyone can see it'}</button><button class="btn sm ${isTrue(cfg('week_starts_monday', 'TRUE')) ? 'good' : ''}" data-act="week-monday">Weeks start ${isTrue(cfg('week_starts_monday', 'TRUE')) ? 'Monday' : 'Sunday'}</button></div>
      <label>Photos</label><div class="note">Folder: <code>${esc(sv.photos_dir || '')}</code> · ${sv.photos || 0} photos${sv.pillow ? ' · resized for the screen' : ''}. Put photos in that folder (the Pi’s rclone sync fills it from Google Drive) <button class="btn sm" data-act="photos-rescan">↻ Rescan</button></div>
      <label>Data</label><div class="note">${S.state.demo ? '<b>Starter (demo) data.</b> ' : sv.imported_at ? `Imported from v1 on <b>${esc(when(sv.imported_at))}</b>. ` : ''}Everything lives in one database on the Pi. <b>Import from v1</b> replaces it with a fresh copy of the Google Sheet, the v1 Pi data and the photos${sv.v1_script ? '' : ' (v1’s script address was not found on this machine; paste it below if you have one)'}.</div>
      <div class="row"><button class="btn sm primary" data-act="import-v1" ${imp.running ? 'disabled' : ''}>${imp.running ? '⏳ Importing…' : '⬇️ Import from v1 (replaces v2 data)'}</button><a class="btn sm ghost" href="/api/export" download>📦 Export CSVs</a>${S.state.demo ? '' : '<button class="btn sm ghost" data-act="reset-demo">Reset to starter data</button>'}</div>
      ${imp.log && imp.log.length ? `<div class="imp-log" style="margin-top:8px">${esc(imp.log.slice(-8).join('\n'))}${imp.error ? '\n⚠️ ' + esc(imp.error) : ''}</div>` : ''}
      <label>Wall controls</label><div class="note">Works from your phone even when the wall screen is frozen.</div>
      <div class="row"><button class="btn sm primary" data-sys="restart_app">↻ Restart app</button><button class="btn sm ghost" data-sys="exit_app">✕ Close app (1 hr)</button><button class="btn sm ghost" data-sys="reboot">⏻ Reboot Pi</button><button class="btn sm ghost" data-act="reload">Reload page</button></div>
      <div class="note" style="margin-top:20px">Family Quest Board <b>v2.0</b> · ${esc(sv.lan_ip || '')} · database on the Pi · no Google script</div></div>`;
  }
}
const ANIMS = [['glow', '✨ Glow'], ['pulse', '💓 Pulse'], ['shake', '🫨 Shake'], ['marquee', '↔️ Drift'], ['flash', '⚡ Flash']];
function audioInfo(a) {
  if (!a || !a.supported) return `Pi audio: ${esc((a && a.error) || 'not available here')}. On the Pi this uses the monitor (HDMI) or the headphone jack — whichever is the default output.`;
  const sinks = a.sinks || [];
  return `Pi audio: <b>${esc(a.backend)}</b>${a.volume !== null && a.volume !== undefined ? ` · volume ${esc(a.volume)}%` : ''}. Outputs: ${sinks.length ? sinks.map(x => `<button class="btn sm ${x.default ? 'good' : 'ghost'}" data-sink="${esc(x.id)}">${x.default ? '✓ ' : ''}${esc(x.name)}</button>`).join(' ') : 'none found'}${sinks.length > 1 ? '<br>Tap an output to make it the default (HDMI = the monitor’s speakers).' : ''}`;
}
const notifyOn = (k) => String(cfg('notify_events', 'quest,help,reward,streak')).split(',').map(x => x.trim().toLowerCase()).includes(k);
async function setConfig(key, value, msg) { await act('setConfig', { key, value }, { toast: msg || 'Saved' }); }

/* ---------- quest / reward editor ---------- */
const QE = {
  state: null, kind: 'quest',
  open(kind, item) {
    this.kind = kind;
    this.state = kind === 'quest'
      ? (item ? { id: item.id, title: item.title, icon: item.icon || '⭐', points: parseInt(item.points, 10) || 0, who: item.assigned_to || 'Anyone', repeat: String(item.repeat || 'daily').toLowerCase(), active: item.active === '' || item.active === undefined || isTrue(item.active), notes: item.notes || '' } : { id: '', title: '', icon: '⭐', points: 5, who: 'Anyone', repeat: 'daily', active: true, notes: '' })
      : (item ? { id: item.id, title: item.title, icon: item.icon || '🎁', points: parseInt(item.cost, 10) || 0, active: item.active === '' || item.active === undefined || isTrue(item.active) } : { id: '', title: '', icon: '🎁', points: 50, active: true });
    $('#qe-title').textContent = (item ? 'Edit ' : 'New ') + kind; $('#qe-del').style.display = item ? '' : 'none';
    $('#qe-questonly').style.display = kind === 'quest' ? '' : 'none'; $('#qe-rewardonly').style.display = kind === 'reward' ? '' : 'none';
    const id = item && item.id, o = id ? (X.get('questOpts', {})[id] || {}) : {};
    this.state.auto = !!o.auto; this.state.streak = o.streak ? JSON.parse(JSON.stringify(o.streak)) : { mode: 'default', milestones: [] }; this.state.sdraft = null;
    this.state.lock = id && X.get('locks', {})[id] ? Object.assign({}, X.get('locks', {})[id]) : null;
    this.state.pen = o.penalty ? JSON.parse(JSON.stringify(o.penalty)) : { mode: 'default' };
    $('#qe-ptslabel').textContent = kind === 'quest' ? 'Points earned' : 'Points it costs';
    this.draw(); Sheet.open('quest-ed'); if (!item) setTimeout(() => this.editName(), 80);
  },
  close() { Sheet.close('quest-ed'); this.state = null; },
  async editName() { const v = await KB.open({ title: this.kind === 'quest' ? 'What’s the quest?' : 'What’s the reward?', initial: this.state.title, placeholder: this.kind === 'quest' ? 'e.g. Feed the cat' : 'e.g. Pick the movie' }); if (v !== null && this.state) { this.state.title = v; this.draw(); } },
  drawPen() {
    const s = this.state, p = s.pen || { mode: 'default' }, fam = penCfg(), once = s.repeat === 'once';
    $('#qe-pen').innerHTML = once ? '' : [['default', 'Family default'], ['custom', '🎯 Custom for this quest'], ['off', 'No penalties']].map(([k, l]) => `<button data-qpen="${k}" class="${(p.mode || 'default') === k ? 'on' : ''}">${l}</button>`).join('') + (p.mode === 'custom' ? `<button data-qpen-edit class="on info">✎ Change…</button>` : '');
    const eff = once ? null : p.mode === 'off' ? null : p.mode === 'custom' ? Object.assign({}, fam, p, { enabled: true }) : fam.enabled ? fam : null;
    $('#qe-penhint').textContent = once ? 'One-time quests can’t be missed.' : eff ? `${penSummary(eff)} · alerts: ${routeLabel(eff.route).replace(/^\S+ /, '')}${eff.nag ? ` · heads-up ${eff.nag}` : ''}` : p.mode === 'default' ? 'The family default is off (Family → Missed quests).' : 'Nothing happens when this quest isn’t done.';
  },
  drawStreak() {
    const s = this.state, wrap = $('#qe-streakwrap'), once = s.repeat === 'once'; wrap.style.display = once ? 'none' : ''; if (once) return;
    const ST = s.streak, D = s.sdraft;
    let h = `<div class="seg">${[['default', 'Family default'], ['custom', '🎯 Custom for this quest'], ['off', 'No prizes']].map(([k, l]) => `<button data-smode="${k}" class="${ST.mode === k ? 'on' : ''}">${l}</button>`).join('')}</div>`;
    if (ST.mode === 'default') { const g = streakCfg().milestones || []; h += `<div class="note hint">${g.length ? g.map(m => `🔥${m.n} in a row → 🎟️ −${m.off} pts coupon`).join(' · ') : 'The family default has no prizes right now'} <span class="muted">(change it under Family)</span></div>`; }
    else if (ST.mode === 'off') h += `<div class="note hint">The 🔥 streak still counts and shows on the card — it just doesn’t pay out.</div>`;
    else {
      h += (ST.milestones || []).map((m, i) => `<div class="srow"><span style="font-weight:800;color:#fb923c">🔥${m.n}${m.every ? ' ↻' : ''}</span><span class="grow">${esc(prizeText(m))}${m.every ? ` <span class="muted">· every ${m.n} in a row</span>` : ''}</span><button class="btn sm ghost" data-sdel="${i}">✕</button></div>`).join('') || '<div class="note hint">No prizes yet — add one below.</div>';
      if (!D) h += `<button class="btn sm primary" data-sadd style="margin-top:8px">＋ Add a streak prize</button>`;
      else {
        const ns = [3, 5, 7, 10, 14, 21, 30], vs = [5, 10, 15, 25, 50], rewardTitles = (S.state.rewards || []).filter(r => r.title).map(r => r.title);
        h += `<div class="sdraft"><label>After how many in a row</label><div class="seg">${ns.map(n => `<button data-sdn="${n}" class="${D.n === n ? 'on' : ''}">🔥${n}</button>`).join('')}<button data-sdn="custom" class="${ns.includes(D.n) ? '' : 'on'}">${ns.includes(D.n) ? 'Other…' : '🔥' + D.n + ' ✎'}</button></div>
          <label>Prize</label><div class="seg"><button data-sdt="points" class="${D.type === 'points' ? 'on' : ''}">⭐ Bonus points</button><button data-sdt="coupon" class="${D.type === 'coupon' ? 'on' : ''}">🎟️ Coupon off a reward</button><button data-sdt="prize" class="${D.type === 'prize' ? 'on' : ''}">🏆 Real-life prize</button></div>
          ${D.type === 'prize' ? `<label>What do they get</label><button class="field ${D.text ? '' : 'ph'}" data-sdtext>${esc(D.text) || 'e.g. Pick the movie, ice cream trip…'}</button>${rewardTitles.length ? `<div class="seg" style="margin-top:6px">${rewardTitles.slice(0, 8).map(t => `<button data-sdpick="${esc(t)}" class="${D.text === t ? 'on' : ''}">${esc(t)}</button>`).join('')}</div>` : ''}`
            : `<label>${D.type === 'points' ? 'Bonus points' : 'Points off'}</label><div class="seg">${vs.map(v => `<button data-sdv="${v}" class="${D.value === v ? 'on' : ''}">${v}</button>`).join('')}<button data-sdv="custom" class="${vs.includes(D.value) ? '' : 'on'}">${vs.includes(D.value) ? 'Other…' : D.value + ' ✎'}</button></div>`}
          <label>How often</label><div class="seg"><button data-sde="0" class="${D.every ? '' : 'on'}">Once per streak</button><button data-sde="1" class="${D.every ? 'on' : ''}">↻ Every ${D.n} in a row (${D.n}, ${D.n * 2}, ${D.n * 3}…)</button></div>
          <div class="row" style="margin-top:10px"><button class="btn sm ghost" data-scancel>Cancel</button><button class="btn sm primary" data-sok>Add prize</button></div></div>`;
      }
    }
    $('#qe-streak').innerHTML = h;
  },
  draw() {
    const s = this.state; if (!s) return;
    $('#qe-icon').textContent = s.icon;
    const nm = $('#qe-name'); nm.textContent = s.title || (this.kind === 'quest' ? 'What’s the quest?' : 'What’s the reward?'); nm.classList.toggle('ph', !s.title);
    const pts = this.kind === 'quest' ? [1, 2, 5, 10, 15, 25, 50] : [10, 25, 50, 100, 200, 500];
    $('#qe-points').innerHTML = pts.map(p => `<button data-qpts="${p}" class="${s.points === p ? 'on' : ''}">${p}</button>`).join('') + `<button data-qpts="custom" class="${pts.includes(s.points) ? '' : 'on'}">${pts.includes(s.points) ? 'Other…' : s.points + ' ✎'}</button>`;
    if (this.kind === 'quest') {
      $('#qe-who').innerHTML = [['Anyone', '👧👦 Anyone']].concat(members('kid').map(k => [k.name, `${k.emoji || '⭐'} ${k.name}`])).map(w => `<button data-qwho="${esc(w[0])}" class="${s.who.toLowerCase() === w[0].toLowerCase() ? 'on' : ''}">${esc(w[1])}</button>`).join('');
      const evN = everyDays(s.repeat) > 1 ? everyDays(s.repeat) : 0, dys = questDays(s.repeat), pw = perWeek(s.repeat);
      $('#qe-repeat').innerHTML = QREPEATS.map(r => `<button data-qrep="${r[0]}" class="${s.repeat === r[0] ? 'on' : ''}">${r[1]}</button>`).join('')
        + `<button data-qrep-every class="${evN ? 'on' : ''}">${evN ? `↻ Every ${evN} days ✎` : '↻ Every N days…'}</button>`
        + `<button data-qrep-week class="${pw ? 'on' : ''}">${pw ? esc(questRepeatLabel(s.repeat)) + ' ✎' : 'N times a week…'}</button>`
        + `<button data-qrep-days class="${dys ? 'on' : ''}">${dys ? '📅 ' + esc(questRepeatLabel(s.repeat)) : '📅 Pick the days…'}</button>`;
      $('#qe-days').innerHTML = dys ? DOW_LABEL.map((l, i) => `<button data-qday="${i}" class="${dys.includes(i) ? 'on good' : ''}">${l}</button>`).join('') : '';
      $('#qe-days').style.display = dys ? '' : 'none';
      $('#qe-hint').textContent = questHint(s.repeat);
      this.drawStreak(); this.drawPen();
      $('#qe-approve').innerHTML = `<button data-qauto="0" class="${s.auto ? '' : 'on'}">👀 Parent approves</button><button data-qauto="1" class="${s.auto ? 'on good' : ''}">✓ Auto-approve</button>`;
    } else {
      const L = s.lock;
      $('#qe-lock').innerHTML = `<button data-lk="" class="${!L ? 'on' : ''}">No lock</button><button data-lk="quest" class="${L && L.type === 'quest' ? 'on' : ''}">🔥 Streak on one quest</button><button data-lk="variety" class="${L && L.type === 'variety' ? 'on' : ''}">🔥 Several different streaks</button>`;
      let o = '';
      if (L && L.type === 'quest') { const qs = (S.state.quests || []).filter(q => q.title && String(q.repeat || '').toLowerCase() !== 'once'); o = `<label>Which quest</label><div class="seg">${qs.map(q => `<button data-lkq="${esc(q.id)}" class="${L.quest === q.id ? 'on' : ''}">${esc(q.icon || '⭐')} ${esc(q.title)}</button>`).join('')}</div><label>Streak needed</label><div class="seg">${[3, 5, 7, 10, 14, 21, 30].map(n => `<button data-lkn="${n}" class="${L.n === n ? 'on' : ''}">🔥${n}</button>`).join('')}</div>`; }
      else if (L && L.type === 'variety') o = `<label>How many different quests</label><div class="seg">${[2, 3, 4, 5].map(n => `<button data-lkc="${n}" class="${L.count === n ? 'on' : ''}">${n}</button>`).join('')}</div><label>Each with a streak of at least</label><div class="seg">${[3, 5, 7, 10, 14].map(n => `<button data-lkn="${n}" class="${L.n === n ? 'on' : ''}">🔥${n}</button>`).join('')}</div><label>Only quests worth at least</label><div class="seg">${[0, 2, 5, 10].map(n => `<button data-lkm="${n}" class="${(+L.min || 0) === n ? 'on' : ''}">${n ? n + '+ pts' : 'any'}</button>`).join('')}</div>`;
      $('#qe-lockopts').innerHTML = o + (L ? '<div class="note hint">Once unlocked it stays unlocked until it’s redeemed, then it has to be earned again.</div>' : '');
    }
    $('#qe-active').innerHTML = `<button data-qact="1" class="${s.active ? 'on good' : ''}">Active</button><button data-qact="0" class="${s.active ? '' : 'on'}">Paused (hidden from kids)</button>`;
  },
  async save() {
    const s = this.state; if (!s.title.trim()) { toast('Give it a name first', true); return; }
    if (s.sdraft && s.streak && s.streak.mode === 'custom') { toast('Finish or cancel the streak prize first', true); return; }
    if (this.kind === 'quest' && questDays(s.repeat) && !questDays(s.repeat).length) { toast('Pick at least one day', true); return; }
    const kind = this.kind; this.close();
    if (kind === 'quest') {
      const res = await act('saveQuest', { id: s.id, title: s.title.trim(), icon: s.icon, points: s.points, assigned_to: s.who, repeat: s.repeat, active: s.active, notes: s.notes }, { toast: 'Quest saved' });
      const id = (res && res.id) || s.id; if (id) { await X.merge('questOpts', { [id]: { auto: !!s.auto, streak: s.streak, penalty: s.pen && s.pen.mode !== 'default' ? s.pen : null } }); api('/api/penalties/run').then(() => Sync.refresh()).catch(() => {}); }
    } else {
      const res = await act('saveReward', { id: s.id, title: s.title.trim(), icon: s.icon, cost: s.points, active: s.active }, { toast: 'Reward saved' });
      const id = (res && res.id) || s.id; if (id) await X.merge('locks', { [id]: s.lock && (s.lock.type === 'quest' ? s.lock.quest && s.lock.n : s.lock.count && s.lock.n) ? s.lock : null });
    }
    render();
  },
  async del() { const s = this.state, kind = this.kind; if (!await Modal.confirm({ icon: '🗑️', title: `Delete “${s.title}”?`, body: kind === 'quest' ? 'Points already earned from it stay. Use <b>Paused</b> instead if you might bring it back.' : 'Rewards already claimed are unaffected.', ok: 'Delete', okClass: 'bad' })) return; this.close(); await act(kind === 'quest' ? 'deleteQuest' : 'deleteReward', { id: s.id }, { toast: 'Deleted' }); },
};
/* ---------- display period editor ---------- */
const DE = {
  state: null,
  open(p) { this.state = p ? { id: p.id, start: p.start, mode: p.mode, days: String(p.days || 'all').toLowerCase() } : { start: '20:00', mode: 'clock', days: 'all' }; $('#de-title').textContent = p ? 'Edit period' : 'New period'; $('#de-del').style.display = p && !String(p.id).startsWith('_legacy') ? '' : 'none'; this.draw(); Sheet.open('disp-ed'); },
  close() { Sheet.close('disp-ed'); this.state = null; },
  draw() { const s = this.state; if (!s) return; $('#de-time').textContent = s.start; $('#de-mode').innerHTML = MODES.map(m => `<button data-dmode="${m[0]}" class="${s.mode === m[0] ? 'on' : ''}">${m[1]}</button>`).join(''); $('#de-days').innerHTML = DAYSETS.map(d => `<button data-ddays="${d[0]}" class="${s.days === d[0] ? 'on' : ''}">${d[1]}</button>`).join(''); },
  async save() { const s = this.state, id = String(s.id || '').startsWith('_legacy') ? '' : (s.id || ''); this.close(); await act('saveDisplay', { id, start: s.start, mode: s.mode, days: s.days }, { toast: 'Schedule saved' }); Display.applied = null; Display.tick(); },
  async del() { const s = this.state; this.close(); await act('deleteDisplay', { id: s.id }, { toast: 'Period removed' }); Display.applied = null; Display.tick(); },
};
/* ---------- member editor ---------- */
const MCOLORS = ['#f472b6', '#60a5fa', '#a78bfa', '#34d399', '#fbbf24', '#fb923c', '#f87171', '#22d3ee', '#a3e635', '#e879f9'];
const ME = {
  state: null,
  open(m) { this.state = m ? { old: m.name, name: m.name, role: m.role === 'parent' ? 'parent' : 'kid', color: m.color || '#60a5fa', emoji: m.emoji || '👤', active: m.active !== 'FALSE' } : { old: '', name: '', role: 'kid', color: MCOLORS[(S.state.members || []).length % MCOLORS.length], emoji: '🙂', active: true }; $('#me-title').textContent = m ? 'Edit person' : 'Add a person'; $('#me-del').style.display = m ? '' : 'none'; this.draw(); Sheet.open('member-ed'); if (!m) setTimeout(() => this.editName(), 80); },
  close() { Sheet.close('member-ed'); this.state = null; },
  async editName() { const v = await KB.open({ title: 'Name', initial: this.state.name, placeholder: 'e.g. Mia' }); if (v !== null && this.state) { this.state.name = v.trim(); this.draw(); } },
  draw() { const s = this.state; if (!s) return; $('#me-emoji').textContent = s.emoji; const nm = $('#me-name'); nm.textContent = s.name || 'Name…'; nm.classList.toggle('ph', !s.name);
    $('#me-role').innerHTML = `<button data-mrole="kid" class="${s.role === 'kid' ? 'on' : ''}">🧒 Kid (does quests)</button><button data-mrole="parent" class="${s.role === 'parent' ? 'on' : ''}">👩‍👧 Parent (approves)</button>`;
    $('#me-color').innerHTML = MCOLORS.map(c => `<button class="swatch ${s.color === c ? 'on' : ''}" data-mcolor="${c}" style="background:${c}"></button>`).join('');
    $('#me-active').innerHTML = `<button data-mact="1" class="${s.active ? 'on good' : ''}">Active</button><button data-mact="0" class="${s.active ? '' : 'on'}">Hidden</button>`; },
  async save() { const s = this.state; if (!s.name) { toast('Give them a name', true); return; } this.close(); await act('saveMember', { oldName: s.old, name: s.name, role: s.role, color: s.color, emoji: s.emoji, active: s.active ? 'TRUE' : 'FALSE' }, { toast: 'Saved' }); },
  async del() { const s = this.state; if (!await Modal.confirm({ icon: '🗑️', title: `Remove ${s.name}?`, body: 'Their points history stays in the database. You can also just mark them <b>Hidden</b>.', ok: 'Remove', okClass: 'bad' })) return; this.close(); await act('deleteMember', { name: s.old }, { toast: 'Removed' }); },
};


/* ---------- penalty editor: the family default, or one quest's custom rules ---------- */
const PE = {
  state: null,
  open(target, cfg, title) {
    const c = Object.assign({}, PEN_DEFAULTS, cfg || {}); delete c.banner; delete c.digest;
    this.state = { target, c, title };
    $('#pe-title').textContent = title || 'If a quest is missed';
    $('#pe-sub').textContent = target === 'family' ? 'The family default. Any quest can override it from its own editor.' : 'Only for this quest. Leave anything you don’t care about as it is.';
    this.draw(); Sheet.open('pen-ed');
  },
  close() { Sheet.close('pen-ed'); this.state = null; },
  draw() {
    const { c, target } = this.state, lad = (c.ladder || []).map(Number), n = +c.n || 2;
    const preset = (l, b) => lad.join(',') === l.join(',') && (c.beyond || 'repeat') === b;
    const PRESETS = [[[0, 5], 'repeat', 'Warning, then −5 each time'], [[0, 5, 10], 'grow', 'Warning, −5, −10, −15…'], [[0, 5, 10], 'repeat', 'Warning, −5, then −10 each time'], [[5, 10], 'grow', '−5, −10, −15… (no warning)'], [[0], 'repeat', 'Warnings only']];
    const isPreset = PRESETS.some(p => preset(p[0], p[1]));
    let h = '';
    if (target === 'family') h += `<label>Penalties for missed quests</label><div class="seg"><button data-pe="enabled:1" class="${c.enabled ? 'on good' : ''}">On</button><button data-pe="enabled:0" class="${c.enabled ? '' : 'on'}">Off</button></div>`;
    h += `<label>What each miss costs</label><div class="pe-lad">${lad.map((v, i) => `<span class="${v ? 'pt' : 'warn'}">${i + 1}${['st', 'nd', 'rd'][i] || 'th'}: ${v ? '−' + v : '⚠️ warning'}</span>`).join('<span class="arrow">→</span>')}<span class="arrow">→</span><span class="${c.beyond === 'grow' ? 'pt' : ''}">${c.beyond === 'grow' ? `keeps growing (−${ladderAmount(c, lad.length)}, −${ladderAmount(c, lad.length + 1)}…)` : `then ${lad[lad.length - 1] ? '−' + lad[lad.length - 1] : 'warning'} each time`}</span></div>
      <div class="seg">${PRESETS.map((p, i) => `<button data-pelad="${i}" class="${preset(p[0], p[1]) ? 'on' : ''}">${p[2]}</button>`).join('')}<button data-pelad="custom" class="${isPreset ? 'newtag' : 'on'}">✎ Custom list…</button></div>
      ${!isPreset ? `<div class="seg" style="margin-top:6px"><button data-pe="beyond:repeat" class="${c.beyond !== 'grow' ? 'on' : ''}">After the list: repeat the last</button><button data-pe="beyond:grow" class="${c.beyond === 'grow' ? 'on' : ''}">After the list: keep growing</button></div>` : ''}
      <label>How often it counts</label><div class="seg">${[['period', 'Every time it’s missed'], ['everyN', `Every ${n === 2 ? '2nd' : n === 3 ? '3rd' : n + 'th'} miss`], ['afterN', `Only once ${n} pile up`]].map(([k, l]) => `<button data-pe="cadence:${k}" class="${(c.cadence || 'period') === k ? 'on' : ''}">${l}</button>`).join('')}${(c.cadence || 'period') !== 'period' ? `<button data-pen="n">N = ${n} ✎</button>` : ''}</div>
      <div class="note hint">A daily quest is “due” every day; a weekly one once a week; “every 3 days” every third day — so these count misses, not calendar days.</div>
      <label>Free misses first</label><div class="seg">${[0, 1, 2, 3].map(g => `<button data-pe="grace:${g}" class="${(+c.grace || 0) === g ? 'on' : ''}">${g === 0 ? 'None' : g}</button>`).join('')}</div>
      <label>Most it can cost in one run</label><div class="seg">${[10, 20, 30, 50, 100].map(v => `<button data-pe="cap:${v}" class="${(+c.cap || 0) === v ? 'on' : ''}">−${v}</button>`).join('')}<button data-pe="cap:0" class="${!+c.cap ? 'on' : ''}">No limit</button></div>
      <label>Starting over</label><div class="seg"><button data-pe="reset:done" class="${(c.reset || 'done') === 'done' ? 'on' : ''}">Doing it resets the ladder</button><button data-pe="reset:week" class="${c.reset === 'week' ? 'on' : ''}">Only a clean week resets it</button></div>
      <div class="seg" style="margin-top:8px"><button data-pe="floor:1" class="${c.floor !== false ? 'on good' : ''}">Never below 0 points</button><button data-pe="floor:0" class="${c.floor === false ? 'on' : ''}">Can go negative</button></div>
      <label>Taking the points</label><div class="seg"><button data-pe="auto:0" class="${c.auto ? '' : 'on'}">👀 Parent taps Apply / Forgive</button><button data-pe="auto:1" class="${c.auto ? 'on' : ''}">⚡ Automatic</button></div>
      <label>Where the alerts go</label><div class="seg">${ROUTES.map(([k, l]) => `<button data-pe="route:${k}" class="${(c.route || 'both') === k ? 'on' : ''}">${l}</button>`).join('')}</div>
      <div class="note hint">Board = the big notice on the home screen and the badge on the quest. Phones = a push to the family topic when a miss is recorded, plus the heads-up below. Quiet = badge on the quest card only.</div>
      <label>Heads-up before it’s missed</label><div class="seg"><button data-pen="nag" class="${c.nag ? 'on' : ''}">${c.nag ? `⏰ ${c.nag} ✎` : 'Set a time…'}</button><button data-pe="nag:" class="${c.nag ? '' : 'on'}">Off</button></div>
      <div class="note hint">At this time, anything still not done today gets one reminder (to the phones, and the board notice shows again).</div>`;
    $('#pe-body').innerHTML = h;
  },
  async save() {
    const { c, target } = this.state;
    if (!(c.ladder || []).length) { toast('Pick what a miss costs', true); return; }
    this.close();
    if (target === 'family') await X.merge('penaltyCfg', c);
    else if (QE.state) { QE.state.pen = Object.assign({ mode: 'custom' }, c); delete QE.state.pen.enabled; QE.drawPen(); toast('Saved with the quest'); return; }
    api('/api/penalties/run').then(() => Sync.refresh()).catch(() => Sync.refresh());
    toast('Saved');
  },
};
