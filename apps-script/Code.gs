/**
 * Family Quest Board — Google Apps Script backend
 * ------------------------------------------------
 * This script lives inside a Google Sheet and turns it into a tiny API that the
 * wall dashboard talks to. The Sheet is the "database" — you and your wife can
 * edit it directly from the Google Sheets app on your phones.
 *
 * ONE-TIME SETUP (see README.md for the click-by-click version):
 *   1. Create a new Google Sheet (any name, e.g. "Family Quest Board").
 *   2. Extensions -> Apps Script. Delete the sample code, paste this whole file.
 *   3. Click the "setup" function in the toolbar dropdown, then Run.
 *      Google will ask you to authorize Sheets, Calendar and Drive. Approve.
 *      This creates all the tabs with headers and sample data.
 *   4. Deploy -> New deployment -> Type: Web app
 *        Execute as: Me
 *        Who has access: Anyone
 *      Copy the Web app URL (ends in /exec) into dashboard/config.js.
 *
 * Every time you change this script you must Deploy -> Manage deployments ->
 * edit (pencil) -> Version: New version -> Deploy, or the web app keeps running
 * the old code.
 */

// ---------------------------------------------------------------------------
// Tab definitions
// ---------------------------------------------------------------------------

// Starter pantry — edit freely on the Groceries tab. A few start as "needed".
var GROCERY_STARTER = [
  // [item, note, status, store, priority]  — status '' | needed | cart ; priority '' (essential) | nice
  ['Milk', '', 'needed', '', ''], ['Eggs', '', '', '', ''], ['Butter', '', '', '', ''], ['Cheese', 'shredded', '', '', ''], ['Yogurt', '', '', '', ''],
  ['Bread', '', 'needed', '', ''], ['Tortillas', '', '', '', ''], ['Bagels', '', '', '', 'nice'], ['Cereal', '', '', '', ''], ['Oatmeal', '', '', '', ''],
  ['Bananas', '', 'needed', '', ''], ['Apples', '', '', '', ''], ['Berries', '', '', '', 'nice'], ['Grapes', '', '', '', 'nice'], ['Oranges', '', '', '', ''],
  ['Lettuce', '', '', '', ''], ['Tomatoes', '', '', '', ''], ['Onions', '', '', '', ''], ['Garlic', '', '', '', ''], ['Potatoes', '', '', '', ''],
  ['Carrots', '', '', '', ''], ['Broccoli', '', '', '', ''], ['Avocados', '', '', '', 'nice'], ['Lemons', '', '', '', ''],
  ['Chicken', '', '', 'Costco', ''], ['Ground beef', '', '', 'Costco', ''], ['Bacon', '', '', '', ''], ['Deli turkey', '', '', '', ''], ['Salmon', '', '', 'Costco', 'nice'],
  ['Rice', '', '', 'Costco', ''], ['Pasta', '', '', '', ''], ['Pasta sauce', '', '', '', ''], ['Beans', 'black', '', '', ''], ['Peanut butter', '', '', '', ''],
  ['Jelly', '', '', '', ''], ['Ketchup', '', '', '', ''], ['Olive oil', '', '', 'Costco', ''], ['Salt', '', '', '', ''], ['Sugar', '', '', '', ''], ['Flour', '', '', '', ''],
  ['Chips', '', '', '', 'nice'], ['Crackers', '', '', '', 'nice'], ['Granola bars', '', '', 'Costco', ''], ['Juice boxes', '', '', 'Costco', ''], ['Coffee', '', '', 'Costco', ''],
  ['Frozen pizza', '', '', '', 'nice'], ['Ice cream', '', '', '', 'nice'], ['Frozen veggies', '', '', '', ''],
  ['Paper towels', '', '', 'Costco', ''], ['Toilet paper', '', 'needed', 'Costco', ''], ['Dish soap', '', '', 'Target', ''], ['Laundry detergent', '', '', 'Costco', ''],
  ['Trash bags', '', '', 'Costco', ''], ['Toothpaste', '', '', 'Target', ''], ['Shampoo', '', '', 'Target', ''], ['Cat food', 'the big bag', '', 'Pet store', ''], ['Cat litter', '', '', 'Pet store', ''],
].map(function (r, i) {
  var weekly = { 'Milk': 1, 'Eggs': 1, 'Bread': 1, 'Bananas': 1 };
  return ['g' + (i + 1), r[0], r[1], r[2], r[3], r[4], weekly[r[0]] ? 'weekly' : '', '', 'setup', ''];
});

var TABS = {
  Config: {
    headers: ['key', 'value', 'notes'],
    seed: [
      ['family_name', 'Our Family', 'Shown on the home screen'],
      ['pin', '1234', 'Parent PIN for approving quests on the wall'],
      ['lat', '34.05', 'Latitude for weather (Open-Meteo, no key needed)'],
      ['lon', '-118.24', 'Longitude for weather'],
      ['weather_units', 'F', 'F or C'],
      ['calendars', '', 'Comma-separated calendar names or IDs to show. Blank = every calendar that is ticked in Google Calendar'],
      ['calendar_days', '14', 'How many days ahead to load events'],
      ['school_days', 'Mon,Tue,Wed,Thu,Fri', 'Days the "leave for school" countdown runs'],
      ['school_departure', '07:45', 'Time you leave for school (24h HH:MM)'],
      ['school_countdown_from', '06:00', 'Countdown starts showing at this time'],
      ['photo_interval_sec', '20', 'Seconds each photo is shown'],
      ['idle_timeout_sec', '90', 'Seconds of no touching before returning to the photo screen'],
      ['night_start', '21:30', 'LEGACY — only used if the Display tab is empty'],
      ['night_end', '06:00', 'LEGACY — only used if the Display tab is empty'],
      ['touch_wake_min', '2', 'Minutes the board stays awake after a touch during a clock/off period'],
      ['clock_dim', '35', 'Brightness of the dim clock screen, 10-100'],
      ['photo_folder', 'Wall Photos', 'Google Drive folder name used by the Drive photo fallback'],
      ['week_starts_monday', 'TRUE', 'For weekly quests: TRUE = Mon-Sun weeks, FALSE = Sun-Sat'],
      ['shopping_email', '', 'Where "Send list" emails the shopping list. Comma-separated. Blank = the Google account that owns this Sheet'],
      ['todos_require_pin', 'FALSE', 'TRUE = the To-do screen asks for the parent PIN'],
    ],
  },
  Members: {
    headers: ['name', 'role', 'color', 'emoji', 'active'],
    seed: [
      ['Mom', 'parent', '#f472b6', '👩', 'TRUE'],
      ['Dad', 'parent', '#60a5fa', '👨', 'TRUE'],
      ['Ava', 'kid', '#a78bfa', '🦄', 'TRUE'],
      ['Max', 'kid', '#34d399', '🦖', 'TRUE'],
    ],
  },
  Groceries: {
    // A master list of everything you ever buy. status: '' = stocked,
    // 'needed' = on the shopping list, 'cart' = picked up in the store.
    // store: comma-separated store tags (Costco, Target…). priority: '' = essential, 'nice' = nice to have.
    // repeat: '' | weekly | biweekly | monthly | every:N — the item puts itself back on the
    // list that long after the list is cleared. next_add: the date that happens (set automatically).
    headers: ['id', 'item', 'note', 'status', 'store', 'priority', 'repeat', 'next_add', 'added_by', 'updated_at'],
    seed: GROCERY_STARTER,
  },
  Quests: {
    headers: ['id', 'title', 'points', 'assigned_to', 'repeat', 'icon', 'active', 'notes'],
    seed: [
      ['q1', 'Make your bed', '5', 'Anyone', 'daily', '🛏️', 'TRUE', ''],
      ['q2', 'Brush teeth (morning)', '2', 'Anyone', 'daily', '🪥', 'TRUE', ''],
      ['q3', 'Feed the cats', '5', 'Ava', 'daily', '🐈', 'TRUE', ''],
      ['q4', 'Take out recycling', '10', 'Max', 'weekly', '♻️', 'TRUE', ''],
      ['q5', 'Read for 20 minutes', '10', 'Anyone', 'daily', '📚', 'TRUE', ''],
      ['q6', 'Clean your room', '25', 'Anyone', 'weekly', '🧹', 'TRUE', ''],
      ['q7', 'Help with dinner', '15', 'Anyone', 'once', '🍳', 'TRUE', 'One-time bonus quest'],
    ],
  },
  Rewards: {
    headers: ['id', 'title', 'cost', 'icon', 'active'],
    seed: [
      ['r1', '30 min screen time', '30', '🎮', 'TRUE'],
      ['r2', 'Pick the movie', '50', '🍿', 'TRUE'],
      ['r3', 'Ice cream trip', '100', '🍦', 'TRUE'],
      ['r4', 'Stay up 30 min late', '75', '🌙', 'TRUE'],
    ],
  },
  Queue: {
    headers: ['id', 'type', 'ref_id', 'title', 'member', 'points', 'submitted_at', 'status', 'reviewed_at'],
    seed: [],
  },
  Dinner: {
    headers: ['date', 'meal', 'note'],
    seed: [],
  },
  Display: {
    // When the wall shows what. mode: photos | clock | off
    //   photos = full board with the photo slideshow
    //   clock  = dim clock only, touch to wake
    //   off    = panel powered off (touch to wake), black screen if the hardware can't
    // days: all | weekdays | weekends | a comma list like "Mon,Tue"
    headers: ['id', 'start', 'mode', 'days', 'note'],
    seed: [
      ['p1', '06:00', 'photos', 'all', 'Morning: full board with photos'],
      ['p2', '21:30', 'clock', 'all', 'Wind-down: dim clock, touch to wake'],
      ['p3', '23:00', 'off', 'all', 'Overnight: screen off'],
    ],
  },
  Todos: {
    // Parents' to-do list. tags: comma-separated. due: yyyy-mm-dd or blank.
    // repeat: '' | daily | weekly | biweekly | monthly | every:N (days). A repeating task rolls
    // forward to its next due date when checked off instead of staying done.
    // notes: free text. subtasks: JSON list like [{"t":"Buy paint","d":false}]
    headers: ['id', 'task', 'tags', 'assigned_to', 'due', 'repeat', 'done', 'notes', 'subtasks', 'added_by', 'created_at', 'done_at'],
    seed: [
      ['t1', 'Call the dentist to reschedule', 'calls, kids', '', '', '', 'FALSE', '', '', 'setup', '', ''],
      ['t2', 'Fix the gate latch', 'house', '', '', '', 'FALSE', 'Latch bolt is bent — probably needs the whole assembly.', '[{"t":"Measure the old latch","d":true},{"t":"Buy replacement","d":false},{"t":"Install","d":false}]', 'setup', '', ''],
      ['t3', 'Order new cat litter', 'shopping, cats', '', '', '', 'FALSE', '', '', 'setup', '', ''],
      ['t4', 'Plan the birthday party', 'kids, planning', '', '', '', 'FALSE', '', '', 'setup', '', ''],
      ['t5', 'Take the trash bins out', 'house', '', '', 'weekly', 'FALSE', '', '', 'setup', '', ''],
      ['t6', 'Water the plants', 'house', '', '', 'every:3', 'FALSE', '', '', 'setup', '', ''],
    ],
  },
};

var HEADER_BG = '#1f2937';
var HEADER_FG = '#ffffff';

// ---------------------------------------------------------------------------
// setup(): run once from the editor
// ---------------------------------------------------------------------------

function setup() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var order = ['Config', 'Members', 'Quests', 'Rewards', 'Queue', 'Groceries', 'Dinner', 'Todos', 'Display'];
  order.forEach(function (name) {
    var def = TABS[name];
    var sheet = ss.getSheetByName(name);
    if (!sheet) {
      sheet = ss.insertSheet(name);
      sheet.getRange(1, 1, 1, def.headers.length).setValues([def.headers]);
      if (def.seed.length) {
        sheet.getRange(2, 1, def.seed.length, def.headers.length).setValues(def.seed);
      }
    } else {
      // Make sure headers exist even on an older tab
      sheet.getRange(1, 1, 1, def.headers.length).setValues([def.headers]);
    }
    // Everything stored as plain text so dates/IDs never get "helpfully" converted
    sheet.getRange(1, 1, Math.max(sheet.getMaxRows(), 500), def.headers.length).setNumberFormat('@');
    var header = sheet.getRange(1, 1, 1, def.headers.length);
    header.setBackground(HEADER_BG).setFontColor(HEADER_FG).setFontWeight('bold');
    sheet.setFrozenRows(1);
    sheet.autoResizeColumns(1, def.headers.length);
  });

  // Seed a week of dinner placeholders
  var dinner = ss.getSheetByName('Dinner');
  if (dinner.getLastRow() < 2) {
    var rows = [];
    for (var i = 0; i < 7; i++) {
      var d = new Date();
      d.setDate(d.getDate() + i);
      rows.push([fmtDate(d), i === 0 ? 'Tacos' : '', '']);
    }
    dinner.getRange(2, 1, rows.length, 3).setValues(rows);
  }

  // Remove the default empty "Sheet1" if it is still there and unused
  var s1 = ss.getSheetByName('Sheet1');
  if (s1 && s1.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(s1);

  // Touch Calendar + Drive so Google asks for those permissions now,
  // not later when the wall display tries to load.
  CalendarApp.getAllCalendars();
  DriveApp.getRootFolder();
  MailApp.getRemainingDailyQuota();

  SpreadsheetApp.getUi().alert(
    'Family Quest Board is set up!\n\n' +
    'Next: Deploy -> New deployment -> Web app (Execute as Me, Anyone) ' +
    'and paste the URL into dashboard/config.js.'
  );
}

// ---------------------------------------------------------------------------
// Web app entry points
// ---------------------------------------------------------------------------

function doGet(e) {
  var p = (e && e.parameter) || {};
  var action = p.action || 'state';
  try {
    var out;
    switch (action) {
      case 'state':   out = getState(); break;
      case 'events':  out = { events: getEvents() }; break;
      case 'ping':    out = { ok: true, time: new Date().toISOString() }; break;
      case 'photos':  out = { photos: listDrivePhotos() }; break;
      case 'photo':   out = getDrivePhoto(p.id); break;
      default: throw new Error('Unknown action: ' + action);
    }
    return json(out);
  } catch (err) {
    return json({ error: String(err && err.message || err) });
  }
}

function doPost(e) {
  var body = {};
  try { body = JSON.parse(e.postData.contents || '{}'); } catch (_) {}
  var action = body.action;
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var out;
    switch (action) {
      case 'addGrocery':       out = addGrocery(body); break;
      case 'setGroceryStatus': out = setGroceryStatus(body); break;
      case 'updateGrocery':    out = updateGrocery(body); break;
      case 'deleteGrocery':    out = deleteGrocery(body); break;
      case 'doneShopping':     out = doneShopping(); break;
      case 'clearList':        out = clearList(body); break;
      case 'emailList':        out = emailList(body); break;
      case 'addTodo':          out = addTodo(body); break;
      case 'updateTodo':       out = updateTodo(body); break;
      case 'setTodoDone':      out = setTodoDone(body); break;
      case 'deleteTodo':       out = deleteTodo(body); break;
      case 'saveDisplay':      out = saveDisplay(body); break;
      case 'deleteDisplay':    out = deleteDisplay(body); break;
      case 'setConfig':        out = setConfig(body); break;
      case 'submitQuest':    out = submitQuest(body); break;
      case 'redeemReward':   out = redeemReward(body); break;
      case 'reviewQueue':    out = reviewQueue(body); break;
      case 'setDinner':      out = setDinner(body); break;
      case 'adjustPoints':   out = adjustPoints(body); break;
      case 'saveQuest':      out = saveQuest(body); break;
      case 'deleteQuest':    out = deleteQuest(body); break;
      case 'saveReward':     out = saveReward(body); break;
      case 'deleteReward':   out = deleteReward(body); break;
      default: throw new Error('Unknown action: ' + action);
    }
    return json(out || { ok: true });
  } catch (err) {
    return json({ error: String(err && err.message || err) });
  } finally {
    lock.releaseLock();
  }
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ---------------------------------------------------------------------------
// Read the whole state in one call (dashboard polls this every minute)
// ---------------------------------------------------------------------------

function getState() {
  var config = getConfig();
  autoAddRepeating();
  return {
    time: new Date().toISOString(),
    config: config,
    members: readTab('Members'),
    groceries: readTab('Groceries'),
    quests: readTab('Quests'),
    rewards: readTab('Rewards'),
    queue: readTab('Queue'),
    dinner: readTab('Dinner'),
    todos: safeReadTab('Todos'),
    display: safeReadTab('Display'),
    events: getEvents(config),
  };
}

function getConfig() {
  var rows = readTab('Config');
  var cfg = {};
  rows.forEach(function (r) { if (r.key) cfg[r.key] = r.value; });
  return cfg;
}

// ---------------------------------------------------------------------------
// Calendar (read-only, cached 5 minutes)
// ---------------------------------------------------------------------------

function getEvents(config) {
  config = config || getConfig();
  var cache = CacheService.getScriptCache();
  var cached = cache.get('events');
  if (cached) return JSON.parse(cached);

  var days = parseInt(config.calendar_days || '14', 10);
  var start = new Date(); start.setHours(0, 0, 0, 0);
  var end = new Date(start.getTime() + days * 86400000);

  var wanted = String(config.calendars || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean);
  var cals = CalendarApp.getAllCalendars().filter(function (c) {
    if (wanted.length) return wanted.indexOf(c.getName()) >= 0 || wanted.indexOf(c.getId()) >= 0;
    return c.isSelected();
  });

  var events = [];
  cals.forEach(function (cal) {
    var color = cal.getColor() || '#60a5fa';
    var name = cal.getName();
    cal.getEvents(start, end).forEach(function (ev) {
      events.push({
        title: ev.getTitle() || '(no title)',
        start: ev.getStartTime().toISOString(),
        end: ev.getEndTime().toISOString(),
        allDay: ev.isAllDayEvent(),
        calendar: name,
        color: color,
        location: ev.getLocation() || '',
      });
    });
  });
  events.sort(function (a, b) { return a.start < b.start ? -1 : a.start > b.start ? 1 : 0; });
  // Cache limit is 100KB per key; trim if a very busy calendar overflows it
  var payload = JSON.stringify(events);
  if (payload.length < 95000) cache.put('events', payload, 300);
  return events;
}

// ---------------------------------------------------------------------------
// Groceries
// ---------------------------------------------------------------------------

// Repeating grocery items put themselves back on the list when their date comes.
function autoAddRepeating() {
  var sheet = sheetByName('Groceries');
  var data = sheet.getDataRange().getValues();
  var h = data[0].map(String);
  var si = h.indexOf('status'), ri = h.indexOf('repeat'), ni = h.indexOf('next_add'), ui = h.indexOf('updated_at');
  if (ri < 0 || ni < 0) return;
  var today = fmtDate(new Date());
  for (var r = 1; r < data.length; r++) {
    var rep = String(data[r][ri] || '').trim(), st = String(data[r][si] || '').toLowerCase(), nx = String(data[r][ni] || '');
    if (rep && !st && (!nx || nx <= today)) {
      sheet.getRange(r + 1, si + 1).setValue('needed');
      if (ui >= 0) sheet.getRange(r + 1, ui + 1).setValue(nowIso());
    }
  }
}

function stepDate(fromKey, repeat) {
  var d = new Date(fromKey + 'T12:00:00'); var r = String(repeat).toLowerCase();
  if (r === 'daily') d.setDate(d.getDate() + 1); else if (r === 'weekly') d.setDate(d.getDate() + 7); else if (r === 'biweekly') d.setDate(d.getDate() + 14);
  else if (r === 'monthly') d.setMonth(d.getMonth() + 1); else if (r.indexOf('every:') === 0) d.setDate(d.getDate() + Math.max(1, parseInt(r.slice(6), 10) || 1)); else d.setDate(d.getDate() + 7);
  return fmtDate(d);
}

// Add to the master list (or, if it already exists, just mark it needed).
// b.store: comma-separated store tags; b.priority: '' (essential) or 'nice'.
function addGrocery(b) {
  var item = String(b.item || '').trim();
  if (!item) throw new Error('Empty item');
  var existing = readTab('Groceries').filter(function (g) { return g.item.trim().toLowerCase() === item.toLowerCase(); })[0];
  if (existing) {
    var ch = { status: 'needed', updated_at: nowIso() };
    if (b.store !== undefined) ch.store = cleanTags(b.store);
    if (b.priority !== undefined) ch.priority = b.priority === 'nice' ? 'nice' : '';
    if (b.repeat !== undefined) ch.repeat = String(b.repeat || '');
    if (b.note !== undefined && b.note !== '') ch.note = String(b.note);
    updateRow('Groceries', existing.id, ch);
    return { ok: true, id: existing.id, existed: true };
  }
  var id = uid();
  appendRow('Groceries', {
    id: id, item: item, note: String(b.note || ''), status: 'needed',
    store: cleanTags(b.store), priority: b.priority === 'nice' ? 'nice' : '', repeat: String(b.repeat || ''), next_add: '',
    added_by: String(b.by || 'Wall'), updated_at: nowIso(),
  });
  return { ok: true, id: id };
}

// Edit name / note / store tags / priority of an existing item.
function updateGrocery(b) {
  var ch = { updated_at: nowIso() };
  if (b.item !== undefined) { var n = String(b.item).trim(); if (!n) throw new Error('Empty item'); ch.item = n; }
  if (b.note !== undefined) ch.note = String(b.note);
  if (b.store !== undefined) ch.store = cleanTags(b.store);
  if (b.priority !== undefined) ch.priority = b.priority === 'nice' ? 'nice' : '';
  if (b.repeat !== undefined) { ch.repeat = String(b.repeat || ''); if (!ch.repeat) ch.next_add = ''; }
  updateRow('Groceries', b.id, ch);
  return { ok: true };
}

// status: '' (stocked) | 'needed' | 'cart'
function setGroceryStatus(b) {
  var s = String(b.status || '');
  if (['', 'needed', 'cart'].indexOf(s) < 0) throw new Error('Bad status');
  updateRow('Groceries', b.id, { status: s, updated_at: nowIso() });
  return { ok: true };
}

function deleteGrocery(b) {
  deleteRowById('Groceries', b.id);
  return { ok: true };
}

// Email the current shopping list (needed items) to Config → shopping_email.
function emailList(b) {
  var cfg = getConfig();
  var to = String((b && b.to) || cfg.shopping_email || Session.getEffectiveUser().getEmail()).trim();
  if (!to) throw new Error('No email address. Set shopping_email on the Config tab.');
  var storeFilter = String((b && b.store) || '').trim().toLowerCase();
  var items = readTab('Groceries').filter(function (g) { return String(g.status).toLowerCase() === 'needed'; })
    .filter(function (g) { return !storeFilter || storesOf(g).some(function (s) { return s.toLowerCase() === storeFilter; }); });
  if (!items.length) throw new Error('The shopping list is empty.');
  var date = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'EEE, MMM d');
  var groups = groupByStore(items);
  var family = cfg.family_name || 'Family Quest Board';
  var text = 'Shopping list — ' + date + (storeFilter ? ' — ' + groups[0].store : '') + '\n';
  var html = '<div style="font:16px/1.6 system-ui,sans-serif"><h2 style="margin:0 0 10px">🛒 Shopping list <span style="color:#888;font-weight:normal">' + date + '</span></h2>';
  groups.forEach(function (grp) {
    text += '\n' + grp.store.toUpperCase() + '\n' + grp.items.map(function (g) { return '☐ ' + g.item + (g.note ? ' (' + g.note + ')' : '') + (g.priority === 'nice' ? '  ~nice to have' : ''); }).join('\n') + '\n';
    html += '<h3 style="margin:16px 0 4px;color:#b45309">' + grp.store + '</h3><ul style="list-style:none;padding:0;margin:0">' + grp.items.map(function (g) {
      return '<li style="padding:6px 0;border-bottom:1px solid #eee' + (g.priority === 'nice' ? ';color:#888' : '') + '">☐ <b>' + g.item + '</b>' + (g.note ? ' <span style="color:#888">' + g.note + '</span>' : '') + (g.priority === 'nice' ? ' <span style="font-size:12px;border:1px solid #ccc;border-radius:6px;padding:0 5px">nice to have</span>' : '') + '</li>';
    }).join('') + '</ul>';
  });
  text += '\n' + items.length + ' items · ' + family;
  html += '<p style="color:#888;font-size:13px">' + items.length + ' items · ' + family + '</p></div>';
  MailApp.sendEmail({ to: to, subject: '🛒 Shopping list (' + items.length + ')' + (storeFilter ? ' — ' + groups[0].store : '') + ' — ' + date, body: text, htmlBody: html });
  return { ok: true, to: to, count: items.length };
}

function storesOf(g) {
  return String(g.store || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean);
}

// Group needed items by their first store tag: named stores A–Z, then "Any store".
// Within a store: essentials first, then nice-to-haves, each A–Z.
function groupByStore(items) {
  var map = {};
  items.forEach(function (g) {
    var s = storesOf(g)[0] || 'Any store';
    var k = s.toLowerCase();
    (map[k] = map[k] || { store: s, items: [] }).items.push(g);
  });
  var keys = Object.keys(map).sort(function (a, b) { return a === 'any store' ? 1 : b === 'any store' ? -1 : a < b ? -1 : 1; });
  return keys.map(function (k) {
    map[k].items.sort(function (a, b) {
      var pa = a.priority === 'nice' ? 1 : 0, pb = b.priority === 'nice' ? 1 : 0;
      if (pa !== pb) return pa - pb;
      return a.item.toLowerCase() < b.item.toLowerCase() ? -1 : 1;
    });
    return map[k];
  });
}

// Clear the shopping list. b.keep = ids that stay on the list ("clear all but…").
function clearList(b) {
  var keep = {};
  (b && b.keep || []).forEach(function (id) { keep[String(id)] = 1; });
  var sheet = sheetByName('Groceries');
  var data = sheet.getDataRange().getValues();
  var headers = data[0].map(String);
  var si = headers.indexOf('status'), ui = headers.indexOf('updated_at'), ri = headers.indexOf('repeat'), ni = headers.indexOf('next_add');
  var today = fmtDate(new Date());
  var n = 0;
  for (var r = 1; r < data.length; r++) {
    var st = String(data[r][si]).toLowerCase();
    if ((st === 'needed' || st === 'cart' || st === 'true') && !keep[String(data[r][0])]) {
      sheet.getRange(r + 1, si + 1).setValue('');
      if (ui >= 0) sheet.getRange(r + 1, ui + 1).setValue(nowIso());
      // Repeating item: schedule its return
      if (ri >= 0 && ni >= 0 && String(data[r][ri] || '').trim()) sheet.getRange(r + 1, ni + 1).setValue(stepDate(today, data[r][ri]));
      n++;
    }
  }
  return { ok: true, cleared: n };
}

// Legacy: everything in the cart is now stocked.
function doneShopping() {
  var sheet = sheetByName('Groceries');
  var data = sheet.getDataRange().getValues();
  var headers = data[0].map(String);
  var si = headers.indexOf('status'), ui = headers.indexOf('updated_at');
  for (var r = 1; r < data.length; r++) {
    if (String(data[r][si]) === 'cart') {
      sheet.getRange(r + 1, si + 1).setValue('');
      if (ui >= 0) sheet.getRange(r + 1, ui + 1).setValue(nowIso());
    }
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Quests, rewards, approval queue
// ---------------------------------------------------------------------------

function submitQuest(b) {
  var quest = findRow('Quests', b.questId);
  if (!quest) throw new Error('Quest not found');
  var id = uid();
  appendRow('Queue', {
    id: id, type: 'quest', ref_id: quest.id, title: quest.title, member: String(b.member || ''),
    points: String(quest.points || 0), submitted_at: nowIso(), status: 'pending', reviewed_at: '',
  });
  return { ok: true, id: id };
}

function redeemReward(b) {
  var reward = findRow('Rewards', b.rewardId);
  if (!reward) throw new Error('Reward not found');
  var id = uid();
  appendRow('Queue', {
    id: id, type: 'reward', ref_id: reward.id, title: reward.title, member: String(b.member || ''),
    points: String(-Math.abs(parseInt(reward.cost || 0, 10))), submitted_at: nowIso(), status: 'pending', reviewed_at: '',
  });
  return { ok: true, id: id };
}

function reviewQueue(b) {
  requirePin(b.pin);
  var status = b.status === 'approved' ? 'approved' : 'rejected';
  updateRow('Queue', b.id, { status: status, reviewed_at: nowIso() });
  return { ok: true };
}

function adjustPoints(b) {
  requirePin(b.pin);
  appendRow('Queue', {
    id: uid(), type: 'adjust', ref_id: '', title: String(b.reason || 'Bonus'), member: String(b.member || ''),
    points: String(parseInt(b.points || 0, 10)), submitted_at: nowIso(), status: 'approved', reviewed_at: nowIso(),
  });
  return { ok: true };
}

function setDinner(b) {
  requirePin(b.pin);
  var sheet = sheetByName('Dinner');
  var data = sheet.getDataRange().getValues();
  for (var r = 1; r < data.length; r++) {
    if (String(data[r][0]) === String(b.date)) {
      sheet.getRange(r + 1, 2, 1, 2).setValues([[String(b.meal || ''), String(b.note || '')]]);
      return { ok: true };
    }
  }
  sheet.appendRow([String(b.date), String(b.meal || ''), String(b.note || '')]);
  return { ok: true };
}

function requirePin(pin) {
  var cfg = getConfig();
  if (String(pin) !== String(cfg.pin || '')) throw new Error('Wrong PIN');
}

// ---------------------------------------------------------------------------
// Parents' to-do list
// ---------------------------------------------------------------------------

function cleanTags(v) {
  var seen = {};
  return String(v || '').split(',').map(function (t) { return t.trim().replace(/^#/, ''); })
    .filter(function (t) { if (!t || seen[t.toLowerCase()]) return false; seen[t.toLowerCase()] = 1; return true; }).join(', ');
}

function addTodo(b) {
  var task = String(b.task || '').trim();
  if (!task) throw new Error('Empty task');
  var id = uid();
  appendRow('Todos', {
    id: id, task: task, tags: cleanTags(b.tags), assigned_to: String(b.assigned_to || ''), due: String(b.due || ''),
    repeat: String(b.repeat || ''), done: 'FALSE', notes: String(b.notes || ''), subtasks: String(b.subtasks || ''), added_by: String(b.by || 'Wall'), created_at: nowIso(), done_at: '',
  });
  return { ok: true, id: id };
}

function updateTodo(b) {
  var changes = {};
  if (b.task !== undefined) changes.task = String(b.task).trim();
  if (b.tags !== undefined) changes.tags = cleanTags(b.tags);
  if (b.assigned_to !== undefined) changes.assigned_to = String(b.assigned_to);
  if (b.due !== undefined) changes.due = String(b.due);
  if (b.repeat !== undefined) changes.repeat = String(b.repeat);
  if (b.notes !== undefined) changes.notes = String(b.notes);
  if (b.subtasks !== undefined) changes.subtasks = String(b.subtasks);
  updateRow('Todos', b.id, changes);
  return { ok: true };
}

function setTodoDone(b) {
  var t = findRow('Todos', b.id);
  if (!t) throw new Error('Task not found');
  if (b.done && t.repeat) {
    // Repeating task: stay open, move the due date forward
    var next = nextDue(t.due, t.repeat);
    updateRow('Todos', b.id, { done: 'FALSE', due: next, done_at: nowIso() });
    return { ok: true, next: next };
  }
  updateRow('Todos', b.id, { done: b.done ? 'TRUE' : 'FALSE', done_at: b.done ? nowIso() : '' });
  return { ok: true };
}

// Next due date for a repeating task: from the current due date (or today if none / already
// past), stepping forward until the result is after today.
function nextDue(due, repeat) {
  var today = fmtDate(new Date());
  var base = /^\d{4}-\d{2}-\d{2}$/.test(String(due)) && due >= today ? due : today;
  var d = new Date(base + 'T12:00:00');
  var step = function () {
    var r = String(repeat).toLowerCase();
    if (r === 'daily') d.setDate(d.getDate() + 1);
    else if (r === 'weekly') d.setDate(d.getDate() + 7);
    else if (r === 'biweekly') d.setDate(d.getDate() + 14);
    else if (r === 'monthly') d.setMonth(d.getMonth() + 1);
    else if (r.indexOf('every:') === 0) d.setDate(d.getDate() + Math.max(1, parseInt(r.slice(6), 10) || 1));
    else d.setDate(d.getDate() + 7);
  };
  step();
  var guard = 0;
  while (fmtDate(d) <= today && guard++ < 400) step();
  return fmtDate(d);
}

function deleteTodo(b) {
  deleteRowById('Todos', b.id);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Quests + rewards (parent-PIN protected). Repeat: once, daily, weekdays,
// weekly, biweekly, monthly.
// ---------------------------------------------------------------------------

function saveQuest(b) {
  requirePin(b.pin);
  var title = String(b.title || '').trim();
  if (!title) throw new Error('Quest needs a title');
  var row = {
    title: title, points: String(parseInt(b.points, 10) || 0), assigned_to: String(b.assigned_to || 'Anyone'),
    repeat: String(b.repeat || 'daily').toLowerCase(), icon: String(b.icon || '⭐'),
    active: b.active === undefined ? 'TRUE' : (isTrue(b.active) ? 'TRUE' : 'FALSE'), notes: String(b.notes || ''),
  };
  if (b.id && findRow('Quests', b.id)) { updateRow('Quests', b.id, row); return { ok: true, id: b.id }; }
  row.id = uid(); appendRow('Quests', row); return { ok: true, id: row.id };
}

function isTrue(v) { return v === true || /^(true|yes|1)$/i.test(String(v || '')); }

function deleteQuest(b) { requirePin(b.pin); deleteRowById('Quests', b.id); return { ok: true }; }

function saveReward(b) {
  requirePin(b.pin);
  var title = String(b.title || '').trim();
  if (!title) throw new Error('Reward needs a title');
  var row = { title: title, cost: String(parseInt(b.cost, 10) || 0), icon: String(b.icon || '🎁'), active: b.active === undefined ? 'TRUE' : (isTrue(b.active) ? 'TRUE' : 'FALSE') };
  if (b.id && findRow('Rewards', b.id)) { updateRow('Rewards', b.id, row); return { ok: true, id: b.id }; }
  row.id = uid(); appendRow('Rewards', row); return { ok: true, id: row.id };
}

function deleteReward(b) { requirePin(b.pin); deleteRowById('Rewards', b.id); return { ok: true }; }

// ---------------------------------------------------------------------------
// Display schedule + config writes (both parent-PIN protected)
// ---------------------------------------------------------------------------

function saveDisplay(b) {
  requirePin(b.pin);
  var start = String(b.start || '').trim();
  if (!/^\d{1,2}:\d{2}$/.test(start)) throw new Error('Time must look like 21:30');
  if (start.length === 4) start = '0' + start;
  var mode = String(b.mode || 'photos');
  if (['photos', 'clock', 'off'].indexOf(mode) < 0) throw new Error('Bad mode');
  var days = String(b.days || 'all');
  if (b.id) {
    updateRow('Display', b.id, { start: start, mode: mode, days: days });
    return { ok: true, id: b.id };
  }
  var id = uid();
  appendRow('Display', { id: id, start: start, mode: mode, days: days, note: '' });
  return { ok: true, id: id };
}

function deleteDisplay(b) {
  requirePin(b.pin);
  deleteRowById('Display', b.id);
  return { ok: true };
}

// Write a single Config value from the wall (adds the row if it's missing).
function setConfig(b) {
  requirePin(b.pin);
  var key = String(b.key || '').trim();
  if (!key || key === 'pin') throw new Error('That setting cannot be changed here');
  var sheet = sheetByName('Config');
  var data = sheet.getDataRange().getValues();
  for (var r = 1; r < data.length; r++) {
    if (String(data[r][0]) === key) { sheet.getRange(r + 1, 2).setValue(String(b.value)); return { ok: true }; }
  }
  sheet.appendRow([key, String(b.value), 'Added from the wall']);
  return { ok: true };
}

// Like readTab but returns [] for a tab that doesn't exist yet (older Sheets)
function safeReadTab(name) {
  try { return readTab(name); } catch (e) { return []; }
}

// ---------------------------------------------------------------------------
// Drive photo fallback (used only if the local photo server is not running)
// ---------------------------------------------------------------------------

function listDrivePhotos() {
  var cfg = getConfig();
  var folders = DriveApp.getFoldersByName(cfg.photo_folder || 'Wall Photos');
  if (!folders.hasNext()) return [];
  var files = folders.next().getFiles();
  var out = [];
  while (files.hasNext()) {
    var f = files.next();
    var mime = f.getMimeType();
    if (mime && mime.indexOf('image/') === 0) {
      out.push({ id: f.getId(), name: f.getName(), mime: mime, size: f.getSize() });
    }
  }
  return out;
}

function getDrivePhoto(id) {
  var f = DriveApp.getFileById(id);
  var blob = f.getBlob();
  return { id: id, mime: blob.getContentType(), data: Utilities.base64Encode(blob.getBytes()) };
}

// ---------------------------------------------------------------------------
// Sheet helpers
// ---------------------------------------------------------------------------

function sheetByName(name) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
  if (!sheet) throw new Error('Missing tab "' + name + '" — run setup()');
  return sheet;
}

function readTab(name) {
  var sheet = sheetByName(name);
  var data = sheet.getDataRange().getValues();
  if (data.length < 2) return [];
  var headers = data[0].map(String);
  var rows = [];
  for (var r = 1; r < data.length; r++) {
    var row = {};
    var empty = true;
    for (var c = 0; c < headers.length; c++) {
      var v = data[r][c];
      if (v instanceof Date) v = fmtDateTime(v);
      v = v === null || v === undefined ? '' : String(v);
      if (v !== '') empty = false;
      row[headers[c]] = v;
    }
    if (!empty) rows.push(row);
  }
  return rows;
}

function appendRow(name, obj) {
  var sheet = sheetByName(name);
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String);
  var row = headers.map(function (h) { return obj[h] !== undefined ? obj[h] : ''; });
  sheet.appendRow(row);
  sheet.getRange(sheet.getLastRow(), 1, 1, headers.length).setNumberFormat('@');
}

function findRow(name, id) {
  var rows = readTab(name);
  for (var i = 0; i < rows.length; i++) if (rows[i].id === String(id)) return rows[i];
  return null;
}

function updateRow(name, id, changes) {
  var sheet = sheetByName(name);
  var data = sheet.getDataRange().getValues();
  var headers = data[0].map(String);
  for (var r = 1; r < data.length; r++) {
    if (String(data[r][0]) === String(id)) {
      Object.keys(changes).forEach(function (k) {
        var c = headers.indexOf(k);
        if (c >= 0) sheet.getRange(r + 1, c + 1).setValue(changes[k]);
      });
      return true;
    }
  }
  throw new Error('Row not found: ' + id);
}

function deleteRowById(name, id) {
  var sheet = sheetByName(name);
  var data = sheet.getDataRange().getValues();
  for (var r = 1; r < data.length; r++) {
    if (String(data[r][0]) === String(id)) { sheet.deleteRow(r + 1); return true; }
  }
  return false;
}

function uid() {
  return Utilities.getUuid().replace(/-/g, '').slice(0, 10);
}

function nowIso() { return new Date().toISOString(); }

function fmtDate(d) {
  return Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy-MM-dd');
}

function fmtDateTime(d) {
  return Utilities.formatDate(d, Session.getScriptTimeZone(), "yyyy-MM-dd'T'HH:mm:ss");
}
