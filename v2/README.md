# Family Quest Board v2

The same board, rebuilt the way it should have been built the first time:

- **One database on the Pi** (SQLite, `v2/data/fqb.db`). No Google Sheet, no Apps Script, nothing to paste or deploy. Every change ships with the normal `publish-to-github.bat` → Pi auto-pull.
- **Instant saves.** Every tap is on the Pi in milliseconds, so phones and the wall agree within a few seconds.
- **Parent PIN entered once per device** (phones remember it for 30 days; the wall re-locks when idle). Changing the PIN signs every device out.
- **Calendar by iCal link** (Google Calendar → Settings → your calendar → *Secret address in iCal format*). Repeats, exceptions and moved instances all handled on the Pi.
- **Members, quests, rewards, dinner, schedule, alerts, calendars — all edited on the board.** The Sheet is gone; there is a CSV export if you want to look at the data in a spreadsheet.
- **Same features as v1**: quests with streaks and prizes, approvals with undo, groceries with library / list / in-store (offline), to-dos, board events and reminders, sticky notes, countdowns, photos with the slow pan, display schedule, messages with per-parent pushes, internet access with the family password.

It runs **next to v1**. v1 stays on port 8080 and keeps working; v2 is on port 8090 with its own data. Nothing in v1 is touched.

## Install on the Pi (next to v1)

```bash
cd ~/FamilyQuestBoard          # wherever v1 lives (it has to be the same git checkout)
bash v2/pi/setup-v2.sh
```

That installs the `fqb2-server` service on port 8090, pointed at the same photos folder as v1. If v1's internet setup exists it also adds `https://v2.<your-name>.duckdns.org` to Caddy (DuckDNS resolves sub-names on its own — nothing to add there).

Then on a phone: `http://familyboard.local:8090` (or the Pi's IP :8090). Add it to the home screen; it installs as a separate "Quest Board 2" icon.

### Bring your real data over

Parents → Settings → **Import from v1**. It reads the Google Sheet through v1's script (the address is picked up from v1's config automatically), copies the Pi-side data (notes, countdowns, messages, coupons, streak settings) and uses the Pi's photos folder. Takes a few seconds. Run it again any time to reset the sandbox to a fresh copy of v1.

Two things the import cannot copy, both one-minute jobs under Settings:
- the **calendar** (v1 read it with your Google login; v2 needs the iCal link),
- the **PIN memory on phones** (enter the PIN once more).

### Go live (v2 becomes *the* board)

```bash
bash v2/pi/go-live.sh           # imports v1 → v2, then the main address and the wall switch to v2
bash v2/pi/go-live.sh revert    # everything back to v1
```

While live: `https://<name>.duckdns.org` → v2 and `https://v1.<name>.duckdns.org` → v1. Both servers keep running, nothing is deleted, so a revert is instant. Note that after going live, changes are made in v2 only; a revert shows v1 as it was on switch day.

### Put it on the wall / take it off (without touching the addresses)

```bash
bash v2/pi/switch-wall.sh v2      # wall shows v2
bash v2/pi/switch-wall.sh v1      # back to v1
```

Both servers keep running either way, so phones can use whichever they like.

### Missed quests: warnings, penalties, the big notice

Parents → **Family → Missed quests** turns it on (off by default; counting starts the day you switch it on, nothing is charged for the past). The family default sets what each miss costs (a ladder like *warning, −5, −10…*), how often a miss counts (every time / every 2nd / only once N pile up), free misses, a cap per run, whether doing the quest resets the ladder, and whether penalties are taken automatically or wait under **Approvals** as *Apply / Forgive*. Any quest can override all of that from its own editor (**If it’s missed → Custom**), or opt out.

Once a day (just after midnight, and whenever the server starts) the Pi looks at the periods that just closed, logs a warning or proposes a penalty, and keeps `kv.alerts` up to date: that is what the home screen shows as the big red/yellow notice (comes back every N minutes, configurable), what the kid’s quest card wears as a badge, and what the “heads-up” push and the parents’ evening digest are built from. **Settings → Board alerts & sounds** picks the effects (glow / pulse / shake / drift / flash), the sound, quiet hours, and lets you test the Pi’s speaker and set its volume (`pi/audio.sh` — PipeWire, PulseAudio or ALSA).

## Day to day

- Publish from Windows exactly as before (`publish-to-github.bat`). The Pi restarts both servers after a pull.
- The publish script runs v2's server tests first (if Python is installed on the PC) and refuses to push when they fail.
- Browser tests: `bash v2/tests/run.sh` (needs node + playwright).
- Logs: `journalctl -u fqb2-server -n 50`.
- Data folder: `v2/data/` (git ignores it). Back it up by copying `fqb.db`.

## Layout

```
v2/
  server.py          HTTP server (stdlib), routes
  fqb/db.py          SQLite schema, state, every action
  fqb/ics.py         calendar feeds + repeat rules
  fqb/alerts.py      ntfy pushes, messages
  fqb/access.py      family password gate, parent-role cookie
  fqb/importer.py    import from v1
  fqb/pi.py          screen power, kiosk restart, override, heartbeat
  fqb/penalties.py   missed quests: warnings, penalty ladder, board alerts, nag + digest (once-a-minute tick)
  fqb/sound.py       generated wave files + pi/audio.sh (speaker, volume, output)
  web/               the app: core.js (state, keyboard, dialogs), logic.js (points, streaks,
                     groceries, calendar), screens.js, parent.js, messages.js, photos.js, alerts.js (the notice + sounds), main.js, app.css
  pi/                setup-v2.sh, switch-wall.sh
  tests/             test_server.py (Python), test-core.js (browser), run.sh
```

## API (for the curious)

`GET /api/state?since=N` — everything, or `{unchanged:true}`. `POST /api/do {action,…}` — the actions (`addGrocery`, `submitQuest`, `reviewQueue`, `undoQueue`, `setDinner`, `saveEvent`, `saveQuest`, `saveMember`, `setConfig`, …). `POST /api/x` — the loosely structured bits (notes, countdowns, coupons…) with `set / merge / push / remove / award`. `POST /api/unlock {pin, remember}` sets the parent cookie; `POST /api/lock` clears it. `/api/photos`, `/api/notify`, `/api/msg`, `/api/import`, `/api/export`, `/api/penalties/run` (check misses now), `/api/audio` (probe / play / volume / sink).
