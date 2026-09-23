# Family Quest Board

A touchscreen family dashboard for the wall: shared Google Calendar, grocery list,
kids' quest board with points and parent approvals, dinner plan, and a photo
slideshow with weather when idle. Runs in any browser now, and on a Raspberry Pi
later. Your Google Sheet is the database, so you and your wife can edit
everything from your phones.

```
Family Quest Board/
├── run-windows.bat      ← double-click to try it right now (demo mode)
├── server.py            ← tiny local server: serves the app + your photos
├── dashboard/
│   ├── index.html       ← the whole app (one file)
│   └── config.js        ← paste your Apps Script URL here (step 5 below)
├── apps-script/
│   └── Code.gs          ← goes into your Google Sheet (steps 1–4 below)
├── photos/              ← drop family photos here (4 sample images included)
└── pi/                  ← Raspberry Pi install scripts (later)
```

---

## Try it now (2 minutes, no Google yet)

1. Double-click **`run-windows.bat`**. A server window opens and the dashboard
   opens in Chrome/Edge. (Needs Python — https://www.python.org/downloads/,
   tick "Add python.exe to PATH".)
2. Press **F11** for full screen. Click = tap.
3. It's in **DEMO** mode (yellow pill, bottom-left): sample family, quests,
   groceries, calendar. Parent PIN is **1234**. Play with everything — demo
   edits are saved in the browser only.

---

## Go live with your Google account (5 minutes)

This is the one part only you can do, because it needs your Google sign-in.

1. **Create the Sheet.** Go to https://sheets.new and name it
   `Family Quest Board`. Share it with your wife (Editor).
2. **Open the script editor.** In the Sheet: **Extensions → Apps Script**.
   Delete the sample code in the editor.
3. **Paste the backend.** Open `apps-script/Code.gs` from this folder in
   Notepad, select all, copy, paste into the editor. Press **Ctrl+S**.
4. **Run `setup` once.** In the toolbar dropdown (says `doGet`), choose
   **`setup`**, then click **▶ Run**.
   Google will ask you to authorize → *Review permissions* → pick your account →
   *Advanced* → *Go to Family Quest Board (unsafe)* → *Allow*.
   (It's "unsafe" only because it's your own unpublished script.) You'll get a
   popup in the Sheet saying it's set up, and the tabs **Config, Members,
   Quests, Rewards, Queue, Groceries, Dinner, Todos, Display** appear with
   sample rows.
5. **Deploy it as a web app.** **Deploy → New deployment** → gear icon →
   **Web app** →
   - Description: anything
   - Execute as: **Me**
   - Who has access: **Anyone**
   → **Deploy**. Copy the **Web app URL** (ends in `/exec`).
6. **Paste the URL** into `dashboard/config.js`:
   ```js
   APPS_SCRIPT_URL: "https://script.google.com/macros/s/……/exec",
   ```
   (or on the dashboard: Parents → Settings → paste → *Save & connect*).
7. Restart `run-windows.bat`. The pill turns **LIVE**. Your real calendar
   events appear, and anything you tap on the wall shows up in the Sheet
   within a second or two.

> "Anyone" here means anyone *with the URL* can read the family's list — no
> Google account required. Nobody can find the URL by searching, and the
> parent-only actions (approvals, points, dinner) need your PIN on top.
> Change the PIN on the **Config** tab.

### Now personalise the Sheet
- **Members** – real names, one row per person, `role` = `parent` or `kid`,
  pick an emoji and a hex color for each kid.
- **Quests** and **Rewards** – easiest from the board itself:
  Parents → PIN → **Quests & rewards** → New quest. Or edit the tabs directly:
  title, points, `assigned_to` (a name, or `Anyone`), `repeat` (`once`,
  `daily`, `weekdays`, `weekly`, `biweekly`, `monthly`), an emoji icon.
  Set `active` to `FALSE` to pause one without deleting it.
- **Config** – family name, PIN, lat/lon for weather, school departure time,
  photo interval, which calendars to show
  (blank = every calendar you have ticked in Google Calendar).
- **Groceries / Dinner** – edit from your phone in the Google Sheets app
  any time; the wall picks it up within a minute.

The dashboard re-reads the Sheet every 60 s, and calendar events are cached
for 5 minutes on Google's side.

---

## Use it from your phone or another computer

The server listens on your whole home network, so any device on the same
Wi-Fi can open the dashboard:

1. Start `run-windows.bat`. The server window prints a line like
   `Phones : http://192.168.1.42:8080` (also shown on the wall under
   Parents → Settings).
2. The first time, Windows Firewall may ask about Python — click **Allow**
   (Private networks). If phones still can't connect, allow "Python" for
   private networks in *Windows Security → Firewall → Allow an app*.
3. Open that address on your phone — **type `http://` in front** (some phones
   try `https://` first, which this local server doesn't speak). If the page
   looks tiny/zoomed-out, turn off **⋮ → Desktop site** in Chrome (or
   *Request Desktop Website* in Safari). Tap **Share → Add to Home Screen**
   (iPhone) or **⋮ → Add to Home screen** (Android) for an app-style icon.

Narrow screens automatically switch to **phone mode**: bottom tab bar, your
phone's own keyboard instead of the on-screen one, and no idle timeout or
sleep screen. Everything else is identical — check off groceries in
the store, approve a quest from the couch, plan dinner from work — and the
wall updates within a minute. (Force phone mode on any device with
`?remote=1` at the end of the address.)

Tips:
- Give the PC (later the Pi) a **DHCP reservation** in your router so the IP
  never changes. From an iPhone, `http://raspberrypi.local:8080` also works.
- Both the wall and every phone read the Apps Script URL from
  `dashboard/config.js`, so set it there (not just in Settings) and every
  device goes LIVE together.
- Away from home? Edit the Google Sheet directly from the Sheets app — it's
  the same data. (Reaching the dashboard itself from outside the house would
  need something like Tailscale; happy to set that up later.)

---

## Photos

Drop JPG/PNG/HEIC files into **`photos/`** — they rotate on the Home screen.
New photos are picked up within 10 minutes. `server.py` auto-resizes them to
screen size (needs `pip install pillow`; `pip install pillow-heif` for iPhone
HEIC files) so even huge phone photos stay smooth.

**Shared drag-and-drop folder:** create a folder called **Wall Photos** in
Google Drive and share it with your wife. Then either

- install *Google Drive for desktop* on your PC and point the server at it:
  edit `run-windows.bat` and un-comment the line
  `set FQB_PHOTOS=G:\My Drive\Wall Photos` (adjust the drive letter), or
- on the Pi, `rclone` mirrors that Drive folder every 10 minutes
  (set up by `pi/setup-pi.sh`).

- or do nothing: when the local `photos/` folder is empty, the board asks
  the Apps Script for the Drive folder named in **Config → `photo_folder`**
  (a folder name, its ID, or the folder's URL all work). Photos arrive as
  Drive's resized JPEG thumbnails, so HEIC and huge originals are fine.
  Parents → Settings shows which folder it found and a **Rescan photos**
  button; otherwise it re-checks every 10 minutes.

Either way: add a photo from any phone → it's on the wall within minutes;
delete it from Drive → it disappears from the wall.

If neither the local folder nor Drive is available, the Home screen shows a
slow animated gradient instead, so it never looks broken.

---

## How the grocery list works

It's a **pantry-style master list**, not a scratch list. The Groceries tab
holds everything you ever buy (a starter set of ~55 items is seeded — edit
freely). Each item has a `status`:

| status | meaning | where it shows |
|---|---|---|
| *(blank)* | stocked | All items |
| `needed` | you're out of it | Shopping list + All items (highlighted 🛒) |

Other columns: `store` (comma-separated store tags), `priority` (blank =
essential, `nice` = nice to have), `repeat` (`weekly`, `biweekly`, `monthly`,
`every:N`), `next_add` (set automatically), `note`.

- **Out of something?** Open **All items**, jump to its letter with the A–Z
  rail (tap a letter, or slide your finger along it), tap the item. If it's
  new, tap **Add item** — it joins the master list for good and is marked
  needed. Typing a name that already exists just marks that one needed.
- **To get** tab is the list — no checkboxes, it's for reading (take it to the
  store with **Send list**). **Add items** is the toggle to everything you
  buy; tap something there to put it on the list.
- Back home, **Clear list** resets everything to stocked. Tap anything you
  **still need** first (out of stock, forgot it) — it gets a 📌 KEEPING mark
  and the button becomes **Clear all but N**.
- **Repeating staples:** hold an item → Edit → *Comes back automatically* →
  Weekly / Every 2 weeks / Monthly. When you clear the list, that item
  quietly schedules its return (`next_add` in the Sheet) and reappears on
  the list by itself when the date comes. Milk, eggs, bread and bananas are
  seeded as weekly.
- **Stores & priority:** each item can carry store tags (`Costco`, `Target`…)
  and be marked *essential* (default) or *nice to have*. The shopping list is
  grouped by store (essentials first, nice-to-haves after, "Any store" at the
  end); store chips at the top filter both tabs, and **Essentials only**
  hides the nice-to-haves. **Hold** an item to edit its name, note, stores and
  priority — or remove it. New items open the same editor after you type the
  name, with the current store filter pre-selected.
- **Take it to the store:** **Send list** on the Shopping list tab.
  *Email it* sends a checklist email from your Google account (to the
  addresses in Config → `shopping_email`; blank = yourself) — one tap on the
  wall before you leave. On a phone the second button is *Share…* (text it,
  drop it in Notes/Keep, etc.); on a computer it's *Copy text*.
  The export is grouped by store, and if a store filter is on, only that
  store is sent ("Send 3 items — Costco?").
  This matters because the phone dashboard only works on your home Wi-Fi.
- Your wife can do all of this from her phone (see above) or straight in
  the Sheet — set `status` to `needed`, clear it, or add rows.

---

## The parents' to-do list

The **To-do** screen is a shared grown-up list (the **Todos** tab in the
Sheet). Each task can have **tags**, a **due date**, and an owner.

- **Filter by tag** with the chips across the top (counts show open tasks).
  *Show done* reveals finished ones.
- **New task**: type it (you can put `#house #urgent` right in the text and
  they become tags), toggle existing tags or add a new one, pick a due date
  (Today / Tomorrow / Saturday / Next Mon / any date), and who it's for.
- **Repeating tasks:** pick Daily / Weekly / Every 2 weeks / Monthly / Every
  3 days, or *every N days* for anything (furnace filter every 90 days).
  Checking one off doesn't finish it — it rolls forward to the next due date
  (from its current due date, or from today if it had none) and shows a
  ↻ badge. In the Sheet the `repeat` column holds `daily`, `weekly`,
  `biweekly`, `monthly` or `every:N`.
- **Tap the circle** to complete a task (tap again to reopen). **Tap the task
  itself** to open it — a slim detail view with notes, a checklist of steps,
  and chips for due date / repeat / owner / tags (tap any to edit). Delete and
  full edit live there too.
- **Sort** by Due (grouped Overdue / Today / Tomorrow / This week / Later /
  No date), A–Z, Who, or Newest.
- **On the calendar:** dated tasks show on their day as dashed 📝 pills;
  repeating ones are projected forward across the two-week window; overdue
  ones sit under today in red. Tap a pill to open the task. Today's due
  tasks also appear in the Home screen agenda.
- Overdue tasks get a red border, today's are amber; the nav badge and the
  Home screen show how many are due.
- Want it hidden from the kids? Set `todos_require_pin` to `TRUE` on the
  Config tab and the screen asks for the parent PIN.

---

## How the quest board works

1. Kid taps their name, taps a quest, confirms → the quest shows **WAITING ⏳**
   and a row lands on the **Queue** tab with `status = pending`.
2. A parent approves it on the wall (Parents → PIN → Approvals) **or** by
   changing `status` to `approved` in the Sheet from their phone.
3. Points are the sum of approved rows (rewards are negative rows). Daily
   quests reappear the next day (`weekdays` ones hide on Sat/Sun), weekly ones
   next week (Mon–Sun by default), `biweekly` 14 days after the last approval,
   `monthly` on the 1st, and `once` quests vanish after approval. Rejected
   quests reopen immediately.
6. Add, edit, pause or delete quests and rewards under Parents →
   **Quests & rewards**. Pausing keeps the history; deleting keeps the points
   already earned but removes the quest.
4. Rewards a kid can afford light up; redeeming also goes through the queue.
5. Bonus/penalty points: Parents → Bonus points.

---

## Home screen logic

- **School mornings** (days + times on Config): a big
  *"23 min until it's time to leave"* countdown with today's agenda.
- **Before 3 pm:** today's agenda + tonight's dinner chip.
- **After 3 pm:** tonight's dinner, remaining events, tomorrow's first event.
- Always: clock, date, 4-day weather (Open-Meteo, no API key), points
  leaderboard, photo slideshow with a slow Ken Burns drift.

---

## Display schedule (Parents → Display)

The wall runs on a daily schedule you set from the board itself. Three modes:

| Mode | What you see |
|---|---|
| 🖼 **Photos + board** | The full dashboard, photos rotating |
| 🕐 **Dim clock only** | Black screen with a dimmed clock and date — touch to wake |
| ⏻ **Screen off** | The panel is actually powered down — touch to wake |

The default schedule is 06:00 photos → 21:30 dim clock → 23:00 off. Tap any
period to change its time, mode or days (every day / weekdays / weekends), or
**＋ Add period** for as many blocks as you like.

**"Right now"** buttons override the schedule until you tap *Follow schedule* —
and because the override lives on the server, you can hit it from your phone to
turn the board off from the couch.

**Screen off is real, not a black screen.** Chromium can't power a panel down,
but `server.py` can: it shells out to `pi/screen.sh`, which tries `wlopm`,
`vcgencmd`, `wlr-randr` and `xset` in that order. The Display pane shows which
method it found — or warns you if none works (on Windows, for instance), in
which case "off" just shows black. The touchscreen keeps working while the
panel is off, so a tap wakes it.

**Timing** (also on this pane): how long a touch keeps the board awake, the idle
timeout back to home, seconds per photo, and the dim-clock brightness.

If the **Display** tab of the Sheet is empty, the old `night_start` /
`night_end` Config values are used as a fallback.

---

## Testing in a Debian VM (rehearsal for the Pi)

Raspberry Pi OS is Debian-based, so a Debian 13 VM behaves nearly the same.
Copy this folder in and run:

```bash
sudo apt install -y python3 python3-pil chromium
python3 server.py &
chromium --kiosk http://localhost:8080
```

`pi/setup-pi.sh` also runs on a Debian VM (skip the `raspi-config` bits; it
does that automatically) so you can rehearse the auto-start config there.

---

## Raspberry Pi install

### Option A — GitHub auto-publish (no file copying, ever)

The project lives in a GitHub repo. Claude pushes changes there; the Pi checks
every minute and updates itself.

One-time, on the Pi (SSH or the Pi Connect terminal):
```
sudo apt-get install -y git
git clone https://github.com/YOURNAME/family-quest-board.git ~/FamilyQuestBoard
cd ~/FamilyQuestBoard && bash pi/setup-pi.sh && sudo reboot
```
Then on the touchscreen: Parents → Settings → paste the Apps Script URL → Save.
That's stored in `dashboard/config.local.js` on the Pi (ignored by git, and
served to phones too), so updates never wipe it.

From then on: a push to GitHub is live on the wall within about a minute
(`pi/autopull.sh`, log in `pi/autopull.log`).

### Option B — copy from Windows

1. Put your Apps Script URL in `dashboard/config.js` (`APPS_SCRIPT_URL`) so
   the Pi goes live on first boot instead of demo mode.
2. Double-click **`install-on-pi.bat`**. It asks once for the Pi's login
   (e.g. `pi@raspberrypi.local`), sets up passwordless SSH, copies the
   project over, runs the installer, and reboots the Pi into the full-screen
   dashboard. Run the same file again any time to push changes.

   (Manual equivalent: `scp -r` the folder to `~/FamilyQuestBoard` on the Pi,
   then `bash pi/setup-pi.sh && sudo reboot`; later `bash pi/update.sh`.)

**Phones:** `http://raspberrypi.local:8080` (iPhone, Mac, Windows 10+, most
Android) or the IP shown under Parents → Settings. Add to home screen.

**Updating later:** run `install-on-pi.bat` again — it copies the changed
files and relaunches the board without a reboot.

**Getting out of kiosk mode:** plug in a keyboard and press **Alt+F4**, or
from SSH: `pkill chromium`. It comes back on the next login/reboot.

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| Pill says **OFFLINE** | Parents → Settings shows the last error. Usually the deployment isn't set to *Anyone*, or you edited `Code.gs` and didn't create a **new version** (Deploy → Manage deployments → ✏️ → New version). |
| Calendar empty in LIVE mode | The calendars must be ticked in Google Calendar for your account, or list them by name on Config → `calendars`. Shared family calendars must be shared *to the account that deployed the script*. |
| "Wrong PIN" | It's the `pin` row on the Config tab. |
| Photos don't change | Check the server window for the photo folder path and count. |
| Screen won't turn off | Parents → Display shows the method in use. If it says "not available", run `pi/screen.sh probe` on the Pi — you may need `sudo apt install wlopm wlr-randr`. The server retries the probe every minute, so it recovers if the desktop wasn't up yet at boot. |
| Weather blank | Check `lat`/`lon` on Config, and that the PC can reach api.open-meteo.com. |
| Runs as a plain file (no server) | Everything works except local photos. Use `run-windows.bat`. |

Editing the look: everything visual is CSS at the top of `dashboard/index.html`
(colors in `:root`).
