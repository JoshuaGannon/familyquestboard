"""
Missed quests: warnings, point penalties, board alerts, nag reminders, the nightly digest.

Runs from a once-a-minute tick (server.py starts the thread). Everything it decides is
written to the database, so the wall and the phones just render it:

  kv.alerts        [{id, kind: missed|penalty, member, quest, title, icon, text, points, misses, day}]
  queue (penalty)  one row per applied/proposed penalty: points < 0, status pending (parent taps
                   Apply / Forgive) or approved (auto). Warnings never touch the queue.
  kv.penaltyLog    {"quest|member|periodKey": {...}}   what has already been decided, so a period is never charged twice
  kv.questSince    {quest_id: "YYYY-MM-DD"}             misses are only counted from this day on

Settings live in kv.penaltyCfg (family default + banner/sound/digest) and
kv.questOpts[quest_id].penalty (per quest: mode default|custom|off, plus the same fields).
"""
import sys
import threading
import time
from datetime import date, datetime, timedelta, timezone

from . import alerts, db

DEFAULTS = {
    "enabled": False,           # family default off until a parent turns it on
    "grace": 0,                 # misses that cost nothing at all (not even a warning)
    "ladder": [0, 5, 10],       # amount for the 1st, 2nd, 3rd… tick; 0 = warning only
    "beyond": "repeat",         # past the end of the ladder: repeat the last amount, or keep growing by the last step
    "cadence": "period",        # period = every time it's due | everyN = every Nth miss | afterN = only once N misses have piled up
    "n": 2,
    "cap": 30,                  # most points one run of misses can cost
    "reset": "done",            # done = doing it resets the ladder | week = ladder only resets after a clean week
    "floor": True,              # never take a kid below 0
    "auto": False,              # False = parent taps Apply / Forgive; True = taken automatically
    "route": "both",            # board | phones | both | quiet
    "nag": "19:00",             # heads-up time for daily quests that are still open ("" = off)
    "banner": {"interval": 10, "duration": 20, "animMissed": ["glow"], "animPenalty": ["glow", "pulse", "shake"],
               "sound": "chime", "soundOn": "penalty", "quietFrom": "20:30", "quietTo": "07:00", "via": "pi"},
    "digest": "20:30",          # parents' one-push summary ("" = off)
}
DOW = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]  # Python weekday(): Mon=0
_lock = threading.Lock()
_last = {"day": None, "nag": None, "digest": None, "alerts": None}
_test_today = None  # tests pin the clock


# ---------------------------------------------------------------- settings
def family_cfg():
    c = dict(DEFAULTS)
    c["banner"] = dict(DEFAULTS["banner"])
    saved = db.kv_get("penaltyCfg", {}) or {}
    for k, v in saved.items():
        if k == "banner" and isinstance(v, dict):
            c["banner"].update(v)
        elif v is not None:
            c[k] = v
    return c


def quest_cfg(qid):
    """Effective penalty settings for one quest, or None when penalties are off for it."""
    fam = family_cfg()
    opts = (db.kv_get("questOpts", {}) or {}).get(qid, {}) or {}
    p = opts.get("penalty") or {}
    mode = p.get("mode", "default")
    if mode == "off":
        return None
    if mode == "custom":
        c = dict(fam)
        for k, v in p.items():
            if k not in ("mode", "banner", "digest") and v is not None:
                c[k] = v
        c["enabled"] = True
        return c
    return fam if fam.get("enabled") else None


# ---------------------------------------------------------------- dates / periods
def today():
    return _test_today or date.today()


def local_date(iso):
    try:
        s = str(iso).replace("Z", "+00:00")
        d = datetime.fromisoformat(s)
        if d.tzinfo is None:
            d = d.replace(tzinfo=timezone.utc)
        return d.astimezone().date() if not _test_today else d.date()
    except ValueError:
        return None


def week_start(d):
    monday = db.is_true(db.cfg("week_starts_monday", "TRUE"))
    off = d.weekday() if monday else (d.weekday() + 1) % 7
    return d - timedelta(days=off)


def quest_days(rep):
    if not rep.startswith("days:"):
        return None
    out = sorted({DOW.index(x.strip()[:3].lower()) for x in rep[5:].split(",") if x.strip()[:3].lower() in DOW})
    return out


def every_days(rep):
    import re
    m = re.match(r"^(?:every[:\s]*)?(\d+)(?:\s*days?)?$", rep)
    return max(1, int(m.group(1))) if m else 0


def per_week(rep):
    import re
    m = re.match(r"^week:(\d+)$", rep)
    return max(1, int(m.group(1))) if m else 0


def closed_periods(rep, ref, limit=400):
    """Yield (start, end_exclusive, need) for periods that closed before `ref`, newest first.
    `need` = completions required in that period (only >1 for week:N)."""
    rep = str(rep or "daily").lower()
    if rep == "once":
        return
    n = 0
    if rep in ("daily", "weekdays") or every_days(rep) == 1:
        d = ref - timedelta(days=1)
        while n < limit:
            if rep == "weekdays" and d.weekday() >= 5:
                d -= timedelta(days=1)
                continue
            yield d, d + timedelta(days=1), 1
            n += 1
            d -= timedelta(days=1)
        return
    ds = quest_days(rep)
    if ds is not None:
        if not ds:
            return
        d = ref - timedelta(days=1)
        while n < limit:
            if d.weekday() in ds:
                yield d, d + timedelta(days=1), 1
                n += 1
            d -= timedelta(days=1)
        return
    ev = every_days(rep)
    if ev:
        # buckets of `ev` days counted from the epoch, same as the board's periodKey
        epoch = (ref - date(1970, 1, 1)).days
        b = epoch // ev - 1
        while n < limit:
            s = date(1970, 1, 1) + timedelta(days=b * ev)
            yield s, s + timedelta(days=ev), 1
            n += 1
            b -= 1
        return
    if rep == "weekly" or per_week(rep):
        need = per_week(rep) or 1
        s = week_start(ref) - timedelta(days=7)
        while n < limit:
            yield s, s + timedelta(days=7), need
            n += 1
            s -= timedelta(days=7)
        return
    if rep == "biweekly":
        epoch = (ref - date(1970, 1, 1)).days
        b = epoch // 14 - 1
        while n < limit:
            s = date(1970, 1, 1) + timedelta(days=b * 14)
            yield s, s + timedelta(days=14), 1
            n += 1
            b -= 1
        return
    if rep == "monthly":
        y, m = ref.year, ref.month
        while n < limit:
            m -= 1
            if m == 0:
                m, y = 12, y - 1
            s = date(y, m, 1)
            e = date(y + (1 if m == 12 else 0), 1 if m == 12 else m + 1, 1)
            yield s, e, 1
            n += 1
        return


def current_period(rep, ref):
    """(start, end_exclusive, need) of the period that contains `ref`, or None for one-time quests."""
    rep = str(rep or "daily").lower()
    if rep == "once":
        return None
    for s, e, need in closed_periods(rep, ref + timedelta(days=366), 400):
        if s <= ref < e:
            return s, e, need
    return None


def is_boundary(rep, ref):
    """Did a period close between yesterday and `ref`? (Only then can a tick fire.)"""
    first = next(closed_periods(rep, ref, 1), None)
    if not first:
        return False
    return first[1] == ref


def due_today(rep, ref):
    rep = str(rep or "daily").lower()
    if rep == "once":
        return False
    if rep in ("daily",) or every_days(rep) == 1:
        return True
    if rep == "weekdays":
        return ref.weekday() < 5
    ds = quest_days(rep)
    if ds is not None:
        return ref.weekday() in ds
    return True  # longer periods: "open" every day of the period


def paused(d):
    for p in (db.kv_get("streak", {}) or {}).get("pauses", []) or []:
        fr, to = p.get("from"), p.get("to") or today().isoformat()
        if fr and fr <= d.isoformat() <= to:
            return True
    return False


# ---------------------------------------------------------------- the maths
def ladder_amount(cfg, tick_index):
    lad = [int(x) for x in (cfg.get("ladder") or [0, 5, 10])]
    if not lad:
        return 0
    if tick_index < len(lad):
        return lad[tick_index]
    if cfg.get("beyond") == "grow" and len(lad) >= 2:
        step = lad[-1] - lad[-2]
        return lad[-1] + step * (tick_index - len(lad) + 1)
    return lad[-1]


def tick_for(cfg, misses):
    """Given `misses` consecutive misses (the newest just closed), does a tick fire, and which rung?
    Returns the ladder index or None."""
    m = misses - int(cfg.get("grace") or 0)
    if m <= 0:
        return None
    cad, n = cfg.get("cadence", "period"), max(1, int(cfg.get("n") or 1))
    if cad == "everyN":
        return (m - 1) // n if (m - 1) % n == 0 else None
    if cad == "afterN":
        return m - n if m >= n else None
    return m - 1


def kids_for(quest, members):
    a = str(quest.get("assigned_to") or "Anyone").strip().lower()
    kids = [m["name"] for m in members if m.get("role") == "kid" and db.is_true(m.get("active", "TRUE"))]
    if a in ("", "anyone"):
        return kids
    want = {x.strip().lower() for x in a.split(",")}
    return [k for k in kids if k.lower() in want]


def submissions(queue, qid, member):
    out = []
    for k in queue:
        if k["type"] == "quest" and k["ref_id"] == qid and k["member"] == member and k["status"] in ("approved", "pending"):
            d = local_date(k["submitted_at"])
            if d:
                out.append(d)
    return out


def done_in(subs, s, e, need):
    return sum(1 for d in subs if s <= d < e) >= need


def consecutive_misses(quest, member, queue, since, ref):
    """Closed periods, newest first, until one was done or we reach the quest's start. Paused periods are skipped."""
    rep = str(quest.get("repeat") or "daily").lower()
    subs = submissions(queue, quest["id"], member)
    misses, last_key = 0, None
    for s, e, need in closed_periods(rep, ref):
        if e <= since:   # period ended before the quest existed / penalties were switched on
            break
        if s < since:    # partial first period: don't count it
            break
        if paused(s) or paused(e - timedelta(days=1)):
            continue
        if done_in(subs, s, e, need):
            break
        misses += 1
        if last_key is None:
            last_key = s.isoformat()
    return misses, last_key


def balance(queue, member):
    return sum(int(k["points"] or 0) for k in queue if k["member"] == member and k["status"] == "approved")


def run_cost(queue, qid, member, since_day):
    """Penalty points already applied/proposed for this run of misses."""
    tot = 0
    for k in queue:
        if k["type"] == "penalty" and k["ref_id"] == qid and k["member"] == member and k["status"] in ("approved", "pending"):
            d = local_date(k["submitted_at"])
            if d and d >= since_day:
                tot += abs(int(k["points"] or 0))
    return tot


# ---------------------------------------------------------------- the daily pass
def ensure_since(quests):
    since = db.kv_get("questSince", {}) or {}
    changed = False
    for q in quests:
        if q["id"] not in since:
            since[q["id"]] = today().isoformat()
            changed = True
    if changed:
        db.kv_set("questSince", since)
    return since


def run_day(ref=None):
    """Once per day: decide warnings/penalties for the periods that just closed. Idempotent."""
    ref = ref or today()
    with _lock, db._lock, db._conn:
        quests = [q for q in db.rows("quests") if q.get("title") and db.is_true(q.get("active", "TRUE") or "TRUE")]
        members = db.rows("members")
        queue = db.rows("queue")
        since_map = ensure_since(quests)
        log = db.kv_get("penaltyLog", {}) or {}
        new_rows, pushes, changed = [], [], False
        for q in quests:
            cfg = quest_cfg(q["id"])
            if not cfg:
                continue
            rep = str(q.get("repeat") or "daily").lower()
            if not is_boundary(rep, ref):
                continue
            since = date.fromisoformat(since_map.get(q["id"], ref.isoformat()))
            for kid in kids_for(q, members):
                misses, key = consecutive_misses(q, kid, queue, since, ref)
                if not misses or not key:
                    continue
                lk = f"{q['id']}|{kid}|{key}"
                if lk in log:
                    continue
                idx = tick_for(cfg, misses)
                entry = {"day": ref.isoformat(), "misses": misses, "points": 0, "kind": "none"}
                if idx is not None:
                    if cfg.get("reset") == "week":
                        # the ladder only resets after a clean week: continue from the last rung if the last miss was recent
                        pos = (db.kv_get("penaltyPos", {}) or {}).get(f"{q['id']}|{kid}") or {}
                        if pos.get("day") and (ref - date.fromisoformat(pos["day"])).days < 7 and int(pos.get("idx", -1)) + 1 > idx:
                            idx = int(pos["idx"]) + 1
                        posmap = db.kv_get("penaltyPos", {}) or {}
                        posmap[f"{q['id']}|{kid}"] = {"idx": idx, "day": ref.isoformat()}
                        db.kv_set("penaltyPos", posmap)
                    amount = max(0, int(ladder_amount(cfg, idx)))
                    cap = int(cfg.get("cap") or 0)
                    if cap:
                        run_start = ref - timedelta(days=min(400, misses * 32))
                        amount = max(0, min(amount, cap - run_cost(queue, q["id"], kid, run_start)))
                    if cfg.get("floor", True):
                        amount = max(0, min(amount, balance(queue, kid)))
                    entry["kind"] = "penalty" if amount > 0 else "warning"
                    entry["points"] = -amount
                    if amount > 0:
                        row = {"id": db.uid(), "type": "penalty", "ref_id": q["id"], "title": q["title"], "member": kid, "points": str(-amount),
                               "submitted_at": db.now_iso(), "status": "approved" if cfg.get("auto") else "pending",
                               "reviewed_at": db.now_iso() if cfg.get("auto") else ""}
                        db._insert("queue", row)
                        queue.append(row)
                        new_rows.append(row)
                        entry["queue_id"] = row["id"]
                log[lk] = entry
                changed = True
                if entry["kind"] != "none" and cfg.get("route") in ("phones", "both"):
                    nxt = ladder_amount(cfg, (idx or 0) + 1)
                    if entry["kind"] == "penalty":
                        pushes.append((f"⚠️ {kid} missed {q['title']}", f"{'Taken' if cfg.get('auto') else 'Proposed'}: {entry['points']} pts ({misses} in a row). "
                                       + (f"Next miss: −{nxt}." if nxt else ""), "go/parent/queue"))
                    else:
                        pushes.append((f"⚠️ {kid} missed {q['title']}", f"Warning only. Miss it again and it's −{nxt} pts." if nxt else "Warning only.", "go/quests"))
        if changed:
            db.kv_set("penaltyLog", {k: v for k, v in sorted(log.items(), key=lambda kv: kv[1].get("day", ""))[-3000:]})
            db.bump()
    for title, msg, go in pushes:
        try:
            alerts.notify("penalty", title, msg, go, force=True)
        except Exception as e:  # noqa: BLE001
            print(f"[penalties] push failed: {e}", file=sys.stderr)
    refresh_alerts(ref)
    return new_rows


# ---------------------------------------------------------------- what the board shows right now
def compute_alerts(ref=None):
    ref = ref or today()
    quests = [q for q in db.rows("quests") if q.get("title") and db.is_true(q.get("active", "TRUE") or "TRUE")]
    members = db.rows("members")
    queue = db.rows("queue")
    since_map = db.kv_get("questSince", {}) or {}
    out = []
    for q in quests:
        cfg = quest_cfg(q["id"])
        if not cfg or cfg.get("route") == "quiet":
            continue
        rep = str(q.get("repeat") or "daily").lower()
        if not due_today(rep, ref):
            continue
        since = date.fromisoformat(since_map.get(q["id"], ref.isoformat()))
        for kid in kids_for(q, members):
            subs = submissions(queue, q["id"], kid)
            # already done (or waiting for approval) in the current period → nothing to shout about
            cur = current_period(rep, ref)
            if cur and done_in(subs, cur[0], cur[1], cur[2]):
                continue
            misses, _key = consecutive_misses(q, kid, queue, since, ref)
            if not misses:
                continue
            nxt_idx = tick_for(cfg, misses + 1)
            nxt = ladder_amount(cfg, nxt_idx) if nxt_idx is not None else 0
            last_idx = tick_for(cfg, misses)
            last_amt = ladder_amount(cfg, last_idx) if last_idx is not None else 0
            unit = "day" if rep in ("daily", "weekdays") or every_days(rep) == 1 or quest_days(rep) else "time"
            kind = "penalty" if nxt > 0 else "missed"
            if kind == "penalty":
                text = f"{q['title']} is late — miss it again {'today' if unit == 'day' else 'this time'} and it’s −{nxt} points."
                if last_amt > 0:
                    text = f"{q['title']} is late ({misses} in a row, −{last_amt} already). Miss it again and it’s −{nxt} points."
            else:
                text = f"{q['title']} didn’t get done {'yesterday' if unit == 'day' and misses == 1 else f'the last {misses} {unit}s' if misses > 1 else 'last time'}."
            out.append({"id": f"{q['id']}|{kid}", "kind": kind, "member": kid, "quest": q["id"], "title": q["title"], "icon": q.get("icon") or "⭐",
                        "text": text, "points": nxt, "misses": misses, "day": ref.isoformat()})
    out.sort(key=lambda a: (a["kind"] != "penalty", -a["misses"], a["member"]))
    return out


def refresh_alerts(ref=None):
    with _lock, db._lock, db._conn:
        new = compute_alerts(ref)
        cur = db.kv_get("alerts", None)
        if cur != new:
            db.kv_set("alerts", new)
            db.bump()
        return new


# ---------------------------------------------------------------- reminders
def _hm(s):
    try:
        h, m = str(s).split(":")
        return int(h) * 60 + int(m)
    except (ValueError, AttributeError):
        return None


def nag(now):
    """At the nag time: tell the board/phones which daily quests are still open."""
    fam = family_cfg()
    ref = today()
    alerts_now = db.kv_get("alerts", []) or []
    quests = [q for q in db.rows("quests") if q.get("title") and db.is_true(q.get("active", "TRUE") or "TRUE")]
    members, queue = db.rows("members"), db.rows("queue")
    mins = now.hour * 60 + now.minute
    opts = db.kv_get("questOpts", {}) or {}
    pushes, items = [], []
    for q in quests:
        cfg = quest_cfg(q["id"])
        if not cfg or cfg.get("route") in ("quiet", "board"):
            continue
        t = _hm((opts.get(q["id"], {}) or {}).get("penalty", {}).get("nag") if (opts.get(q["id"], {}) or {}).get("penalty", {}).get("mode") == "custom" else fam.get("nag"))
        if t is None or t != mins:
            continue
        rep = str(q.get("repeat") or "daily").lower()
        if not due_today(rep, ref):
            continue
        for kid in kids_for(q, members):
            subs = submissions(queue, q["id"], kid)
            cur = current_period(rep, ref)
            if cur and done_in(subs, cur[0], cur[1], cur[2]):
                continue
            a = next((x for x in alerts_now if x["id"] == f"{q['id']}|{kid}"), None)
            items.append(f"{kid}: {q['title']}" + (f" (−{a['points']} if missed)" if a and a.get("points") else ""))
    if items:
        pushes.append(("⏰ Still not done today", " · ".join(items[:8]), "go/quests"))
    for title, msg, go in pushes:
        try:
            alerts.notify("nag", title, msg, go, force=True)
        except Exception as e:  # noqa: BLE001
            print(f"[penalties] nag failed: {e}", file=sys.stderr)
    return items


def digest(now):
    fam = family_cfg()
    if _hm(fam.get("digest")) != now.hour * 60 + now.minute:
        return None
    pend = [k for k in db.rows("queue") if k["type"] == "penalty" and k["status"] == "pending"]
    at_risk = [a for a in (db.kv_get("alerts", []) or []) if a.get("points")]
    if not pend and not at_risk:
        return None
    parts = []
    if pend:
        parts.append(f"{len(pend)} penalt{'y' if len(pend) == 1 else 'ies'} waiting for your tap")
    if at_risk:
        parts.append("at risk: " + ", ".join(f"{a['member']} – {a['title']} (−{a['points']})" for a in at_risk[:6]))
    msg = ". ".join(parts)
    try:
        alerts.notify("digest", "📋 Quest Board tonight", msg, "go/parent/queue", force=True)
    except Exception as e:  # noqa: BLE001
        print(f"[penalties] digest failed: {e}", file=sys.stderr)
    return msg


# ---------------------------------------------------------------- the clock
def tick():
    now = datetime.now()
    d = today().isoformat()
    try:
        if _last["day"] != d:
            run_day()
            _last["day"] = d
        key = now.strftime("%Y-%m-%d %H:%M")
        if _last["alerts"] != key:
            refresh_alerts()
            _last["alerts"] = key
        if _last["nag"] != key:
            nag(now)
            _last["nag"] = key
        if _last["digest"] != key:
            digest(now)
            _last["digest"] = key
    except Exception as e:  # noqa: BLE001
        print(f"[penalties] tick failed: {e}", file=sys.stderr)


def start():
    def loop():
        time.sleep(3)
        while True:
            tick()
            time.sleep(60 - (time.time() % 60))
    threading.Thread(target=loop, daemon=True, name="penalties").start()
