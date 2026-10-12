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
