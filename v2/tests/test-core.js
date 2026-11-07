// v2 core flows on the demo data: wall + phone, every screen, the main actions.
const { chromium, devices } = require('playwright');
const URL = process.env.FQB2_URL || 'http://localhost:8090';
const assert = (c, m) => { if (!c) { console.log('  FAIL:', m); process.exitCode = 1; } else console.log('  ok:', m); };
(async () => { const b = await chromium.launch(); const errors = [];
  const wall = await b.newPage({ viewport: { width: 1920, height: 1080 } }); wall.on('pageerror', e => errors.push('WALL ' + e.message)); wall.on('console', m => { if (m.type() === 'error' && !/open-meteo|Failed to load resource/.test(m.text())) errors.push('WALL console: ' + m.text()); });
  const txt = async (sel) => ((await wall.textContent(sel)) || '').replace(/\s+/g, ' ').trim();
  const pin = async (p) => { for (const k of '1234') await p.click(`#pinpad [data-pin="${k}"]`); await p.waitForTimeout(600); };
  const type = async (p, text) => { await p.fill('#kb-input', text); await p.click('#kb-rows [data-k="done"]:visible'); await p.waitForTimeout(150); };
  await wall.goto(URL); await wall.waitForTimeout(2000);
  assert(!(await wall.evaluate(() => document.body.classList.contains('loading'))), 'wall loads');
  // --- quests: Ava does Make your bed, Max auto? no; parent approves; undo
  await wall.click('[data-screen="quests"]'); await wall.waitForTimeout(300);
  await wall.click('[data-kid="Ava"]'); const q1 = wall.locator('.quest', { hasText: 'Make your bed' }); await q1.click(); await wall.waitForTimeout(200); await wall.click('#m-ok'); await wall.waitForTimeout(800);
  assert((await q1.getAttribute('class')).includes('pending'), 'quest shows pending after tap');
  await q1.click(); await wall.waitForTimeout(200); assert(/Take it back/.test(await txt('#m-ok')), 'pending quest offers take back'); await wall.click('#m-cancel');
  // help
  const q2 = wall.locator('.quest', { hasText: 'Read for 20' }); await q2.click(); await wall.waitForTimeout(200); await wall.click('#m-alt'); await wall.waitForTimeout(800);
  assert(await q2.locator('.helpflag').count() === 1, 'help flag shows');
  // --- parent approvals
  await wall.click('[data-screen="parent"]'); await wall.waitForTimeout(300); await pin(wall);
  assert(await wall.locator('#pbody [data-review="approved"]').count() >= 2, 'approvals listed (quest + help)');
  await wall.locator('.qrow', { hasText: 'Make your bed' }).locator('[data-review="approved"]').click(); await wall.waitForTimeout(800);
  assert(/Undo/.test(await txt('.qrow:has-text("Make your bed")')), 'approved item in Recent with Undo');
  await wall.click('[data-screen="home"]'); await wall.waitForTimeout(200); assert(/Ava 5/.test((await txt('#leader')).replace(/\s+/g, ' ')) || /Ava.*5/.test(await txt('#leader')), 'Ava has 5 pts on home');
  await wall.click('[data-screen="parent"]'); await wall.waitForTimeout(300);
  await wall.locator('.qrow', { hasText: 'Make your bed' }).locator('[data-undo]').click(); await wall.waitForTimeout(200); await wall.click('#m-ok'); await wall.waitForTimeout(800);
  assert(await wall.locator('.qrow:has-text("Make your bed") [data-review]').count() === 2, 'undo put it back in waiting');
  // bonus + undo
  await wall.click('[data-ptab="bonus"]'); await wall.click('[data-bm="Max"]'); await wall.click('[data-bp="10"]'); await wall.click('[data-act="bonus-go"]'); await wall.waitForTimeout(800);
  assert(await wall.locator('#pbody .qrow [data-undo]').count() === 1, 'bonus listed with undo');
  await wall.locator('#pbody .qrow [data-undo]').click(); await wall.click('#m-ok'); await wall.waitForTimeout(800); assert(await wall.locator('#pbody .qrow').count() === 0, 'bonus undone');
  // dinner edit
  await wall.click('[data-ptab="dinner"]'); await wall.locator('.drow').nth(1).click(); await type(wall, 'Lasagna'); await wall.waitForTimeout(800);
  assert((await wall.locator('.drow .dm').nth(1).textContent()).includes('Lasagna'), 'dinner saved');
  // new quest via editor
  await wall.click('[data-ptab="quests"]'); await wall.click('[data-act="quest-add"]'); await wall.waitForTimeout(300); await type(wall, 'Water the garden'); await wall.click('[data-qpts="15"]'); await wall.click('[data-qrep="weekly"]'); await wall.click('[data-qauto="1"]'); await wall.click('#qe-save'); await wall.waitForTimeout(900);
  assert(/Water the garden/.test(await txt('#pbody')) && /auto-approve/.test(await txt('#pbody')), 'quest created with auto-approve');
  // custom intervals: pick days (today + one other), every 3 days, twice a week
  const dowNames = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'], todayDow = new Date().getDay(), otherDow = (todayDow + 3) % 7;
  await wall.click('[data-act="quest-add"]'); await wall.waitForTimeout(300); await type(wall, 'Take out bins'); await wall.click('[data-qrep-days]'); await wall.waitForTimeout(150);
  assert(await wall.locator('#qe-days [data-qday]').count() === 7, 'day picker shows 7 days');
  for (const d of [1, 4]) if (await wall.locator(`#qe-days [data-qday="${d}"].on`).count()) await wall.click(`#qe-days [data-qday="${d}"]`); // clear the mon/thu default
  await wall.click(`#qe-days [data-qday="${todayDow}"]`); await wall.click(`#qe-days [data-qday="${otherDow}"]`); await wall.waitForTimeout(150);
  assert((await txt('#qe-hint')).includes(dowNames[todayDow]) && (await txt('#qe-hint')).includes(dowNames[otherDow]), 'hint names the picked days');
  await wall.click('#qe-save'); await wall.waitForTimeout(900);
  assert(new RegExp(dowNames[todayDow] + '.*' + dowNames[otherDow] + '|' + dowNames[otherDow] + '.*' + dowNames[todayDow]).test(await txt('#pbody')), 'quest list shows the picked days');
  await wall.click('[data-act="quest-add"]'); await wall.waitForTimeout(300); await type(wall, 'Vacuum room'); await wall.click('[data-qrep-every]'); await wall.waitForTimeout(200); await type(wall, '3'); await wall.waitForTimeout(150);
  assert(/Every 3 days/.test(await txt('#qe-repeat')), 'every-3-days chip set'); await wall.click('#qe-save'); await wall.waitForTimeout(900);
  await wall.click('[data-act="quest-add"]'); await wall.waitForTimeout(300); await type(wall, 'Practice piano'); await wall.click('[data-qrep-week]'); await wall.waitForTimeout(200); await type(wall, '2'); await wall.waitForTimeout(150);
  assert(/Twice a week/.test(await txt('#qe-repeat')), 'twice-a-week chip set'); await wall.click('#qe-save'); await wall.waitForTimeout(900);
  assert(/Every 3 days/.test(await txt('#pbody')) && /Twice a week/.test(await txt('#pbody')), 'custom intervals saved and listed');
  // kid side: the day-picked quest shows today, twice-a-week shows a 0 of 2 counter, and it stays available after one completion
  await wall.click('[data-screen="quests"]'); await wall.waitForTimeout(300); await wall.click('[data-kid="Ava"]'); await wall.waitForTimeout(200);
  assert(await wall.locator('.quest', { hasText: 'Take out bins' }).count() === 1, 'day-picked quest visible on a picked day');
  const piano = wall.locator('.quest', { hasText: 'Practice piano' }); assert(/0 of 2 this week/.test(await piano.textContent()), 'twice-a-week shows 0 of 2');
  await piano.click(); await wall.waitForTimeout(200); await wall.click('#m-ok'); await wall.waitForTimeout(800);
  await wall.click('[data-screen="parent"]'); await wall.waitForTimeout(300); await wall.click('[data-ptab="queue"]'); await wall.waitForTimeout(200); await wall.locator('.qrow', { hasText: 'Practice piano' }).locator('[data-review="approved"]').click(); await wall.waitForTimeout(800);
  await wall.click('[data-screen="quests"]'); await wall.waitForTimeout(300); await wall.click('[data-kid="Ava"]'); await wall.waitForTimeout(200);
  assert(/1 of 2 this week/.test(await piano.textContent()) && !(await piano.getAttribute('class')).includes('done'), 'twice-a-week still available after one approval (1 of 2)');
  await wall.click('[data-screen="parent"]'); await wall.waitForTimeout(300); await wall.click('[data-ptab="quests"]'); await wall.waitForTimeout(200);
  // --- missed quests: penalties, approvals, board alert, editors, sound settings
  const ago = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10); };
  await wall.evaluate(async (since) => {
    const post = (u, b) => fetch(u, { method: 'POST', body: JSON.stringify(b) }).then(r => r.json());
    const qs = Object.fromEntries(FQB.state.quests.map(q => [q.id, since]));
    await post('/api/x', { op: 'set', key: 'questSince', value: qs });
    await post('/api/x', { op: 'set', key: 'penaltyCfg', value: { enabled: true, ladder: [0, 5, 10], cadence: 'period', floor: false, auto: false, route: 'both', cap: 0 } });
    return post('/api/penalties/run', {});
  }, ago(10));
  await wall.evaluate(() => FQB.refreshNow()); await wall.waitForTimeout(600);
  await wall.click('[data-ptab="queue"]'); await wall.waitForTimeout(300);
  const propRows = await wall.locator('#pbody .qrow.penalty [data-review="approved"]').count();
  assert(propRows >= 2 && /Proposed penalty/.test(await txt('#pbody')) && /missed 10 in a row/.test(await txt('#pbody')), 'missed daily quests -> proposed penalties in Approvals');
  await wall.locator('#pbody .qrow.penalty [data-review="rejected"]').first().click(); await wall.waitForTimeout(800);
  assert(/forgiven/.test(await txt('#pbody')), 'Forgive -> recorded as forgiven');
  await wall.locator('#pbody .qrow.penalty [data-review="approved"]').first().click(); await wall.waitForTimeout(800);
  assert(/Penalty.*applied/.test(await txt('#pbody')) && await wall.locator('#pbody .qrow.penalty [data-review="approved"]').count() === propRows - 2, 'Apply -> penalty applied, leaves the queue');
  // the board notice
  await wall.click('[data-screen="home"]'); await wall.waitForTimeout(500);
  assert(await wall.locator('#alerts.on').count() === 1 && (await wall.locator('#alerts .alert-card, #alerts .alert-strip').count()) >= 1, 'home shows the missed-quest notice');
  assert(await wall.evaluate(() => document.body.classList.contains('on-home') && getComputedStyle(document.querySelector('#alerts')).display === 'flex'), 'notice is visible on the home screen');
  await wall.locator('#alerts [data-member="Ava"]').first().click(); await wall.waitForTimeout(400);
  assert(await wall.evaluate(() => FQB.screen === 'quests' && FQB.kid === 'Ava'), 'tapping the notice opens that kid’s quests');
  assert(await wall.locator('.quest.alerted .late.penalty').count() >= 1 && /−10 if not done today/.test(await txt('#quest-grid')), 'late quest card shows the penalty badge');
  // family default editor
  await wall.click('[data-screen="parent"]'); await wall.waitForTimeout(300); await wall.click('[data-ptab="family"]'); await wall.waitForTimeout(200);
  assert(/Missed quests/.test(await txt('#pbody')) && /warning, −5, −10/.test(await txt('#pbody')), 'Family tab summarises the penalty ladder');
  await wall.click('[data-fx="pen-edit"]'); await wall.waitForTimeout(300);
  assert(await wall.locator('#pen-ed.open').count() === 1, 'penalty editor opens');
  await wall.click('[data-pelad="1"]'); await wall.waitForTimeout(100);
  assert(/keeps growing/.test(await txt('#pe-body')), 'preset picked: ladder keeps growing');
  await wall.click('[data-pe="cadence:everyN"]'); await wall.click('[data-pe="grace:1"]'); await wall.click('[data-pe="cap:50"]'); await wall.waitForTimeout(100);
  await wall.click('#pe-save'); await wall.waitForTimeout(1200); 
  assert(/−15, −20…/.test(await txt('#pbody')) && /1 free miss, then every 2nd miss/.test(await txt('#pbody')) && /max −50 per run/.test(await txt('#pbody')), 'family default saved and summarised');
  // per-quest custom rules
  await wall.click('[data-ptab="quests"]'); await wall.waitForTimeout(200); await wall.locator('.prow', { hasText: 'Water the garden' }).click(); await wall.waitForTimeout(300);
  assert(await wall.locator('#qe-pen [data-qpen]').count() === 3, 'quest editor has the If-missed choices');
  await wall.click('[data-qpen="custom"]'); await wall.waitForTimeout(300);
  assert(await wall.locator('#pen-ed.open').count() === 1 && /Water the garden/.test(await txt('#pe-title')), 'custom opens the editor for this quest');
  await wall.click('[data-pe="auto:1"]'); await wall.click('[data-pe="route:board"]'); await wall.click('#pe-save'); await wall.waitForTimeout(300);
  assert(/taken automatically/.test(await txt('#qe-penhint')) && /Board/.test(await txt('#qe-penhint')), 'quest hint reflects the custom rules');
  await wall.click('#qe-save'); await wall.waitForTimeout(1200);
  assert(/Water the garden[\s\S]*⚠️ penalties/.test(await txt('#pbody')), 'quest list marks the quest as having penalties');
  // settings: alerts & sounds
  await wall.click('[data-ptab="settings"]'); await wall.waitForTimeout(200);
  assert(/Board alerts & sounds/.test(await txt('#pbody')) && await wall.locator('[data-act="snd-test-pi"]').count() === 1 && await wall.locator('#snd-vol').count() === 1, 'settings has sound test and Pi volume');
  await wall.click('[data-pban="penalty:flash"]'); await wall.waitForTimeout(800);
  assert((await wall.locator('[data-pban="penalty:flash"]').getAttribute('class')).includes('on'), 'animation toggle saves');
  await wall.click('[data-act="snd-test-here"]'); await wall.click('[data-act="snd-probe"]'); await wall.waitForTimeout(800);
  assert(/Pi audio/.test(await txt('#snd-info')), 'Check Pi audio reports back');
  await wall.click('[data-act="alert-preview-penalty"]'); await wall.waitForTimeout(700);
  const demo = wall.locator('#alerts .alert-card.penalty');
  assert(await demo.count() === 1 && /an-glow/.test(await demo.getAttribute('class')) && /an-flash/.test(await demo.getAttribute('class')) && /−5 points/.test(await demo.textContent()), 'preview shows a penalty notice with the chosen effects');
  await wall.click('[data-screen="parent"]'); await wall.waitForTimeout(300);
  // family: add member
  await wall.click('[data-ptab="family"]'); await wall.click('[data-act="member-add"]'); await wall.waitForTimeout(300); await type(wall, 'Zoe'); await wall.click('#me-save'); await wall.waitForTimeout(900);
  assert(/Zoe/.test(await txt('#pbody')), 'member added');
  // settings: calendar feed add (bad url rejected), pin change flow skipped
  await wall.click('[data-ptab="settings"]'); assert(/Import from v1/.test(await txt('#pbody')), 'settings has import');
  // --- groceries
  await wall.click('[data-screen="groceries"]'); await wall.waitForTimeout(300);
  await wall.click('#groc-add'); await wall.waitForTimeout(300); await type(wall, 'Oat milk'); await wall.click('#ge-store [data-store="Costco"]'); await wall.click('#ge-addlib'); await wall.waitForTimeout(900);
  await wall.click('[data-gtab="all"]'); await wall.waitForTimeout(200); assert(await wall.locator('.gchip', { hasText: 'Oat milk' }).count() === 1 && !(await wall.locator('.gchip', { hasText: 'Oat milk' }).getAttribute('class')).includes('needed'), 'library-only item not on list');
  await wall.locator('.gchip', { hasText: 'Oat milk' }).click(); await wall.waitForTimeout(800); assert((await wall.locator('.gchip', { hasText: 'Oat milk' }).getAttribute('class')).includes('needed'), 'tap library item → needed');
  await wall.click('[data-gtab="need"]'); await wall.waitForTimeout(200); assert(await wall.locator('.gitem', { hasText: 'Oat milk' }).count() === 1, 'on the list');
  // --- todo
  await wall.click('[data-screen="todo"]'); await wall.click('#todo-add'); await wall.waitForTimeout(300); await type(wall, 'Call the plumber #house'); await wall.click('[data-due]:nth-child(2)'); await wall.click('#te-save'); await wall.waitForTimeout(900);
  assert(/Call the plumber/.test(await txt('#todo-list')) && /#house/.test(await txt('#todo-list')), 'todo added with hashtag');
  // --- calendar: add event tomorrow, see it on home
  await wall.click('[data-screen="calendar"]'); await wall.click('#cal-add'); await wall.waitForTimeout(300); await type(wall, 'Piano recital'); await wall.click('[data-edate]:nth-child(2)'); await wall.click('[data-etime="17:00"]'); await wall.click('#ee-save'); await wall.waitForTimeout(900);
  assert(/Piano recital/.test(await txt('#cal-wrap')), 'board event on calendar');
  await wall.click('[data-calview="month"]'); await wall.waitForTimeout(200); assert(await wall.locator('.mcell').count() === 42, 'month view renders'); await wall.click('[data-calview="week"]');
  // --- note on home
  await wall.click('[data-screen="home"]'); await wall.click('[data-act="note-add"]'); await wall.waitForTimeout(300); await wall.fill('#kb-area', 'Cleats are in the car'); await wall.click('#kb-rows [data-k="done"]:visible'); await wall.waitForTimeout(600);
  assert(await wall.locator('.note-card', { hasText: 'Cleats' }).count() === 1, 'note posted');
  await wall.screenshot({ path: process.env.SHOTS ? process.env.SHOTS + '/v2-core-home.png' : '/tmp/v2-core-home.png' });
  // --- phone
  const ph = await (await b.newContext({ ...devices['Pixel 7'] })).newPage(); ph.on('pageerror', e => errors.push('PHONE ' + e.message));
  await ph.goto(URL); await ph.waitForTimeout(2000); await ph.click('[data-pick="Dad"]'); await ph.waitForTimeout(300);
  await ph.click('[data-screen="groceries"]'); await ph.click('[data-gtab="store"]'); await ph.waitForTimeout(300);
  assert(await ph.locator('.sitem').count() > 3, 'phone in-store checklist');
  const nStore = await ph.locator('.sitem').count(); await ph.locator('.sitem').first().click(); await ph.waitForTimeout(1500); assert(await ph.locator('.sitem:not([data-restore])').count() === nStore - 1 && /Recently cleared · 1/.test(await ph.textContent('.clhd')), 'tapped item leaves the list, lands in Recently cleared');
  await ph.click('[data-toggle-cleared]'); await ph.locator('[data-restore]').first().click(); await ph.waitForTimeout(1500); assert(await ph.locator('.sitem:not([data-restore])').count() === nStore, 'restored from Recently cleared');
  await ph.click('[data-screen="parent"]'); await ph.waitForTimeout(400); assert(await ph.locator('#pinpad.open').count() === 1 && await ph.locator('#pin-remember').isVisible(), 'phone PIN with remember');
  await pin(ph); assert(await ph.locator('.ptab').count() >= 6, 'phone parent unlocked');
  await ph.reload(); await ph.waitForTimeout(2000); await ph.click('[data-screen="parent"]'); await ph.waitForTimeout(400); assert(await ph.locator('#pinpad.open').count() === 0, 'phone stays unlocked after reload');
  await ph.click('[data-screen="messages"]'); await ph.waitForTimeout(300); await ph.click('[data-newchat]'); await ph.waitForTimeout(300); await ph.click('[data-pick="Ava"]'); await ph.waitForTimeout(300); await ph.click('[data-mquick="👍 Yes"]'); await ph.waitForTimeout(1200);
  assert(await ph.locator('#thread .bub.me').count() === 1, 'phone sent a message');
  await wall.click('[data-screen="messages"]'); await wall.waitForTimeout(300); assert(/Ava & Dad/.test(await txt('#chat-list')), 'wall sees the conversation');
  console.log('ERRORS:', errors.length ? errors : 'none'); if (errors.length) process.exitCode = 1; await b.close(); })();
