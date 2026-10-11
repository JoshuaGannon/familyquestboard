"""
Family Quest Board v2 — the database.

One SQLite file holds everything the v1 Google Sheet and the v1 Pi "extras"
file held. Tables mirror the old Sheet tabs so the import is a straight copy;
loosely structured bits (sticky notes, countdowns, messages, coupons, streak
settings…) live in the `kv` table as JSON, with the same set/merge/push/
remove/award operations the old extras store had.

Every write bumps a version counter so clients can poll cheaply.
"""
import json
import os
import secrets
import sqlite3
import threading
import time
from datetime import date, datetime, timedelta

_lock = threading.RLock()
_conn = None
DB_PATH = None

SCHEMA = """
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS config (key TEXT PRIMARY KEY, value TEXT NOT NULL DEFAULT '', notes TEXT NOT NULL DEFAULT '');
CREATE TABLE IF NOT EXISTS members (name TEXT PRIMARY KEY, role TEXT NOT NULL DEFAULT 'kid', color TEXT NOT NULL DEFAULT '',
    emoji TEXT NOT NULL DEFAULT '', active TEXT NOT NULL DEFAULT 'TRUE', sort INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS quests (id TEXT PRIMARY KEY, title TEXT NOT NULL, points TEXT NOT NULL DEFAULT '0',
    assigned_to TEXT NOT NULL DEFAULT 'Anyone', repeat TEXT NOT NULL DEFAULT 'daily', icon TEXT NOT NULL DEFAULT '',
    active TEXT NOT NULL DEFAULT 'TRUE', notes TEXT NOT NULL DEFAULT '', sort INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS rewards (id TEXT PRIMARY KEY, title TEXT NOT NULL, cost TEXT NOT NULL DEFAULT '0',
    icon TEXT NOT NULL DEFAULT '', active TEXT NOT NULL DEFAULT 'TRUE', sort INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS queue (id TEXT PRIMARY KEY, type TEXT NOT NULL, ref_id TEXT NOT NULL DEFAULT '',
    title TEXT NOT NULL DEFAULT '', member TEXT NOT NULL DEFAULT '', points TEXT NOT NULL DEFAULT '0',
    submitted_at TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'pending', reviewed_at TEXT NOT NULL DEFAULT '');
CREATE TABLE IF NOT EXISTS groceries (id TEXT PRIMARY KEY, item TEXT NOT NULL, note TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT '', store TEXT NOT NULL DEFAULT '', priority TEXT NOT NULL DEFAULT '',
    repeat TEXT NOT NULL DEFAULT '', next_add TEXT NOT NULL DEFAULT '', added_by TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL DEFAULT '');
CREATE TABLE IF NOT EXISTS dinner (date TEXT PRIMARY KEY, meal TEXT NOT NULL DEFAULT '', note TEXT NOT NULL DEFAULT '');
CREATE TABLE IF NOT EXISTS events (id TEXT PRIMARY KEY, title TEXT NOT NULL, date TEXT NOT NULL, time TEXT NOT NULL DEFAULT '',
    kind TEXT NOT NULL DEFAULT 'event', who TEXT NOT NULL DEFAULT '', repeat TEXT NOT NULL DEFAULT '',
    note TEXT NOT NULL DEFAULT '', added_by TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT '');
CREATE TABLE IF NOT EXISTS todos (id TEXT PRIMARY KEY, task TEXT NOT NULL, tags TEXT NOT NULL DEFAULT '',
    assigned_to TEXT NOT NULL DEFAULT '', due TEXT NOT NULL DEFAULT '', repeat TEXT NOT NULL DEFAULT '',
    done TEXT NOT NULL DEFAULT 'FALSE', notes TEXT NOT NULL DEFAULT '', subtasks TEXT NOT NULL DEFAULT '',
    added_by TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT '', done_at TEXT NOT NULL DEFAULT '');
CREATE TABLE IF NOT EXISTS display (id TEXT PRIMARY KEY, start TEXT NOT NULL, mode TEXT NOT NULL DEFAULT 'photos',
    days TEXT NOT NULL DEFAULT 'all', note TEXT NOT NULL DEFAULT '');
CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
"""

TABLES = ["config", "members", "quests", "rewards", "queue", "groceries", "dinner", "events", "todos", "display"]
TABLE_COLS = {}

DEFAULT_CONFIG = [
    ("family_name", "Our Family", "Shown on the home screen"),
    ("pin", "1234", "Parent PIN"),
    ("lat", "34.05", "Latitude for weather (Open-Meteo, no key needed)"),
    ("lon", "-118.24", "Longitude for weather"),
    ("weather_units", "F", "F or C"),
    ("ical_urls", "", "Calendar feeds, one per line: Name | #color | https://…/basic.ics"),
    ("calendar_days", "14", "How many days ahead to load events"),
    ("school_days", "Mon,Tue,Wed,Thu,Fri", "Days the leave-for-school countdown runs"),
    ("school_departure", "07:45", "Time you leave for school (24h)"),
    ("school_countdown_from", "06:00", "Countdown starts showing at this time"),
    ("photo_interval_sec", "20", "Seconds each photo is shown"),
    ("idle_timeout_sec", "90", "Seconds of no touching before the wall returns home"),
    ("touch_wake_min", "2", "Minutes the board stays awake after a touch at night"),
    ("clock_dim", "35", "Brightness of the dim clock screen, 10-100"),
    ("week_starts_monday", "TRUE", "Weekly quests: Mon-Sun weeks"),
    ("todos_require_pin", "FALSE", "To-do screen asks for the parent PIN"),
    ("notify_ntfy_topic", "", "Push alerts: ntfy topic for the family"),
    ("notify_events", "quest,help,reward,streak", "Which things send alerts"),
    ("messages_enabled", "TRUE", "Family messages on/off"),
    ("msg_fulltext", "TRUE", "Show message text in push alerts"),
]

SEED = {
    "members": [
        ("Mom", "parent", "#f472b6", "👩", "TRUE", 1), ("Dad", "parent", "#60a5fa", "👨", "TRUE", 2),
        ("Ava", "kid", "#a78bfa", "🦄", "TRUE", 3), ("Max", "kid", "#34d399", "🦖", "TRUE", 4),
    ],
    "quests": [
        ("q1", "Make your bed", "5", "Anyone", "daily", "🛏️", "TRUE", "", 1),
        ("q2", "Brush teeth (morning)", "2", "Anyone", "daily", "🪥", "TRUE", "", 2),
        ("q3", "Feed the cats", "5", "Ava", "daily", "🐈", "TRUE", "", 3),
        ("q4", "Take out recycling", "10", "Max", "weekly", "♻️", "TRUE", "", 4),
        ("q5", "Read for 20 minutes", "10", "Anyone", "daily", "📚", "TRUE", "", 5),
        ("q6", "Clean your room", "25", "Anyone", "weekly", "🧹", "TRUE", "", 6),
        ("q7", "Help with dinner", "15", "Anyone", "once", "🍳", "TRUE", "One-time bonus quest", 7),
    ],
    "rewards": [
        ("r1", "30 min screen time", "30", "🎮", "TRUE", 1), ("r2", "Pick the movie", "50", "🍿", "TRUE", 2),
        ("r3", "Ice cream trip", "100", "🍦", "TRUE", 3), ("r4", "Stay up 30 min late", "75", "🌙", "TRUE", 4),
    ],
    "display": [
        ("p1", "06:00", "photos", "all", "Morning: full board with photos"),
        ("p2", "21:30", "clock", "all", "Wind-down: dim clock, touch to wake"),
        ("p3", "23:00", "off", "all", "Overnight: screen off"),
    ],
    "todos": [
        ("t1", "Call the dentist to reschedule", "calls, kids", "", "", "", "FALSE", "", "", "setup", "", ""),
        ("t2", "Fix the gate latch", "house", "", "", "", "FALSE", "Latch bolt is bent.", '[{"t":"Measure the old latch","d":true},{"t":"Buy replacement","d":false},{"t":"Install","d":false}]', "setup", "", ""),
        ("t5", "Take the trash bins out", "house", "", "", "weekly", "FALSE", "", "", "setup", "", ""),
        ("t6", "Water the plants", "house", "", "", "every:3", "FALSE", "", "", "setup", "", ""),
    ],
}
GROCERY_STARTER = [
    ("Milk", "", "needed", "", "", "weekly"), ("Eggs", "", "needed", "", "", "weekly"), ("Bread", "", "", "", "", "weekly"),
    ("Bananas", "", "needed", "", "", "weekly"), ("Apples", "", "", "", "", ""), ("Chicken", "", "needed", "Costco", "", ""),
    ("Coffee", "", "needed", "Costco", "", ""), ("Butter", "", "", "", "", ""), ("Cheese", "", "", "", "", ""),
    ("Rice", "", "", "Costco", "", ""), ("Pasta", "", "", "", "", ""), ("Berries", "", "", "", "nice", ""),
    ("Ice cream", "", "", "", "nice", ""), ("Paper towels", "", "", "Costco", "", ""), ("Toilet paper", "", "needed", "Costco", "", ""),
    ("Dish soap", "", "", "Target", "", ""), ("Toothpaste", "", "needed", "Target", "", ""), ("Cat food", "the big bag", "", "Pet store", "", ""),
]


def now_iso():
    return datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")


def today_key():
    return date.today().isoformat()


def uid():
    return secrets.token_hex(5)


def is_true(v):
    return str(v).strip().lower() in ("true", "yes", "1")


def open_db(path):
    global _conn, DB_PATH
    DB_PATH = path
    os.makedirs(os.path.dirname(path), exist_ok=True)
    _conn = sqlite3.connect(path, check_same_thread=False, isolation_level=None)
    _conn.row_factory = sqlite3.Row
    _conn.execute("PRAGMA journal_mode=WAL")
    _conn.execute("PRAGMA synchronous=NORMAL")
    _conn.executescript(SCHEMA)
    for t in TABLES:
        TABLE_COLS[t] = [r["name"] for r in _conn.execute(f"PRAGMA table_info({t})")]
    if not _conn.execute("SELECT 1 FROM meta WHERE key='version'").fetchone():
        _conn.execute("INSERT INTO meta VALUES ('version','1')")
    for k, v, n in DEFAULT_CONFIG:
        _conn.execute("INSERT OR IGNORE INTO config VALUES (?,?,?)", (k, v, n))
    return _conn


def seed_demo():
    """Fill an empty database with the starter family (same as the v1 Sheet seed)."""
    with _lock, _conn:
        if _conn.execute("SELECT COUNT(*) FROM members").fetchone()[0]:
            return False
        _conn.executemany("INSERT INTO members VALUES (?,?,?,?,?,?)", SEED["members"])
        _conn.executemany("INSERT INTO quests VALUES (?,?,?,?,?,?,?,?,?)", SEED["quests"])
        _conn.executemany("INSERT INTO rewards VALUES (?,?,?,?,?,?)", SEED["rewards"])
        _conn.executemany("INSERT INTO display VALUES (?,?,?,?,?)", SEED["display"])
        _conn.executemany("INSERT INTO todos VALUES (?,?,?,?,?,?,?,?,?,?,?,?)", SEED["todos"])
        for i, g in enumerate(GROCERY_STARTER):
            _conn.execute("INSERT INTO groceries VALUES (?,?,?,?,?,?,?,?,?,?)",
                          (f"g{i + 1}", g[0], g[1], g[2], g[3], g[4], g[5], "", "setup", now_iso()))
        _conn.execute("INSERT OR REPLACE INTO dinner VALUES (?,?,?)", (today_key(), "Tacos", ""))
        _conn.execute("INSERT OR REPLACE INTO meta VALUES ('demo','1')")
        bump()
    return True


def bump():
    _conn.execute("UPDATE meta SET value = CAST(value AS INTEGER) + 1 WHERE key='version'")


def version():
    return int(_conn.execute("SELECT value FROM meta WHERE key='version'").fetchone()[0])


def meta_get(key, default=""):
    r = _conn.execute("SELECT value FROM meta WHERE key=?", (key,)).fetchone()
    return r[0] if r else default


def meta_set(key, value):
    with _lock, _conn:
        _conn.execute("INSERT OR REPLACE INTO meta VALUES (?,?)", (key, str(value)))


def rows(table, order=None):
    cols = TABLE_COLS[table]
    q = f"SELECT * FROM {table}" + (f" ORDER BY {order}" if order else "")
    return [dict(zip(cols, r)) for r in _conn.execute(q)]


def config():
    return {r["key"]: r["value"] for r in _conn.execute("SELECT key, value FROM config")}


def cfg(key, default=""):
    r = _conn.execute("SELECT value FROM config WHERE key=?", (key,)).fetchone()
    return r[0] if r and r[0] != "" else default


def kv_all():
    return {r["key"]: json.loads(r["value"]) for r in _conn.execute("SELECT key, value FROM kv")}


def kv_get(key, default=None):
    r = _conn.execute("SELECT value FROM kv WHERE key=?", (key,)).fetchone()
    return json.loads(r[0]) if r else default


def kv_set(key, value):
    _conn.execute("INSERT OR REPLACE INTO kv VALUES (?,?)", (key, json.dumps(value, ensure_ascii=False)))


def state():
    """Everything the clients need, in one go."""
    with _lock, _conn:
        auto_add_repeating()
        return {
            "time": now_iso(), "version": version(), "demo": meta_get("demo") == "1",
            "config": config(),
            "members": rows("members", "sort, name"),
            "groceries": rows("groceries", "item COLLATE NOCASE"),
            "quests": rows("quests", "sort, title COLLATE NOCASE"),
            "rewards": rows("rewards", "sort, title COLLATE NOCASE"),
            "queue": rows("queue", "submitted_at"),
            "dinner": rows("dinner", "date"),
            "todos": rows("todos", "created_at"),
            "local_events": rows("events", "date, time"),
            "display": rows("display", "start"),
            "extras": kv_all(),
        }


# ---------------------------------------------------------------------------
# generic row helpers
# ---------------------------------------------------------------------------
def _find(table, id_):
    cols = TABLE_COLS[table]
    key = "date" if table == "dinner" else "name" if table == "members" else "id"
    r = _conn.execute(f"SELECT * FROM {table} WHERE {key}=?", (str(id_),)).fetchone()
    return dict(zip(cols, r)) if r else None


def _update(table, id_, changes):
    key = "date" if table == "dinner" else "name" if table == "members" else "id"
    cols = [c for c in changes if c in TABLE_COLS[table]]
    if not cols:
        return
    _conn.execute(f"UPDATE {table} SET " + ", ".join(f"{c}=?" for c in cols) + f" WHERE {key}=?",
                  [str(changes[c]) if changes[c] is not None else "" for c in cols] + [str(id_)])


def _insert(table, obj):
    cols = TABLE_COLS[table]
    vals = [str(obj.get(c, "")) if obj.get(c) is not None else "" for c in cols]
    _conn.execute(f"INSERT OR REPLACE INTO {table} VALUES (" + ",".join("?" * len(cols)) + ")", vals)


def _delete(table, id_):
    key = "date" if table == "dinner" else "name" if table == "members" else "id"
    _conn.execute(f"DELETE FROM {table} WHERE {key}=?", (str(id_),))


# ---------------------------------------------------------------------------
# kv operations (same semantics as the v1 Pi extras store)
# ---------------------------------------------------------------------------
def kv_op(body):
    op, key = body.get("op"), str(body.get("key", ""))
    if not key or key.startswith("_"):
        raise ValueError("bad key")
    with _lock, _conn:
        changed = True
        if op == "set":
            kv_set(key, body.get("value"))
        elif op == "merge":
            cur = kv_get(key, {})
            cur = cur if isinstance(cur, dict) else {}
            for k, v in (body.get("value") or {}).items():
                if v is None:
                    cur.pop(k, None)
                else:
                    cur[k] = v
            kv_set(key, cur)
        elif op == "push":
            lst = kv_get(key, [])
            lst = lst if isinstance(lst, list) else []
            lst.append(body.get("value"))
            kv_set(key, lst[-500:])
        elif op == "remove":
            lst = kv_get(key, [])
            ids = body.get("ids") if isinstance(body.get("ids"), list) else [body.get("id")]
            ids = {i for i in ids if i}
            kv_set(key, [x for x in (lst if isinstance(lst, list) else []) if not (isinstance(x, dict) and x.get("id") in ids)])
        elif op == "award":
            awarded = kv_get("awarded", [])
            awarded = awarded if isinstance(awarded, list) else []
            if key in awarded:
                return False
            awarded.append(key)
            kv_set("awarded", awarded[-2000:])
            val = body.get("value") or {}
            kind = val.get("kind") if isinstance(val, dict) else None
            target = "prizes" if kind == "prize" else "pointlog" if kind == "points" else "coupons"
            lst = kv_get(target, [])
            lst = lst if isinstance(lst, list) else []
            lst.append(val)
            kv_set(target, lst[-500:])
        else:
            raise ValueError("unknown op")
        bump()
        return changed


# ---------------------------------------------------------------------------
# actions (what the v1 Apps Script did, now local)
# ---------------------------------------------------------------------------
PARENT_ACTIONS = {"reviewQueue", "undoQueue", "adjustPoints", "setDinner", "saveQuest", "deleteQuest", "saveReward",
                  "deleteReward", "saveDisplay", "deleteDisplay", "setConfig", "saveMember", "deleteMember",
                  "clearQueue", "resetDemo"}


def step_date(from_key, repeat):
    d = datetime.strptime(from_key, "%Y-%m-%d")
    r = str(repeat or "").lower()
    if r == "daily":
        d += timedelta(days=1)
    elif r == "weekly":
        d += timedelta(days=7)
    elif r == "biweekly":
        d += timedelta(days=14)
    elif r == "monthly":
        m = d.month % 12 + 1
        y = d.year + (1 if m == 1 else 0)
        d = d.replace(year=y, month=m, day=min(d.day, 28))
    elif r.startswith("every:"):
        d += timedelta(days=max(1, int(r[6:] or 1)))
    else:
        d += timedelta(days=7)
    return d.strftime("%Y-%m-%d")


def auto_add_repeating():
    today = today_key()
    changed = False
    for g in _conn.execute("SELECT id, repeat, status, next_add FROM groceries").fetchall():
        if g["repeat"] and not g["status"] and (not g["next_add"] or g["next_add"] <= today):
            _conn.execute("UPDATE groceries SET status='needed', updated_at=? WHERE id=?", (now_iso(), g["id"]))
            changed = True
    if changed:
        bump()


def clean_tags(v):
    return ", ".join(x.strip() for x in str(v or "").split(",") if x.strip())


def next_due(due, repeat):
    r = str(repeat or "").lower()
    base = due if due else today_key()
    nxt = step_date(base, r if r else "weekly")
    while nxt < today_key():
        nxt = step_date(nxt, r if r else "weekly")
    return nxt


def do(action, b, is_parent):
    """Run one action. Returns a JSON-able dict. Raises ValueError on bad input."""
    if action in PARENT_ACTIONS and not is_parent:
        raise PermissionError("Parent PIN needed")
    with _lock, _conn:
        out = _do(action, b)
        bump()
        return out or {"ok": True}


def _do(action, b):  # noqa: C901 - one big switch is clearer than 40 tiny modules here
    # ---- groceries
    if action == "addGrocery":
        item = str(b.get("item", "")).strip()
        if not item:
            raise ValueError("Empty item")
        to_list = b.get("list") is not False
        ex = _conn.execute("SELECT id FROM groceries WHERE lower(trim(item))=?", (item.lower(),)).fetchone()
        if ex:
            ch = {"updated_at": now_iso()}
            if to_list:
                ch["status"] = "needed"
            for k in ("store", "priority", "repeat"):
                if b.get(k) is not None:
                    ch[k] = clean_tags(b[k]) if k == "store" else ("nice" if b[k] == "nice" else "") if k == "priority" else str(b[k])
            if b.get("note"):
                ch["note"] = str(b["note"])
            _update("groceries", ex["id"], ch)
            return {"ok": True, "id": ex["id"], "existed": True}
        gid = uid()
        _insert("groceries", {"id": gid, "item": item, "note": b.get("note", ""), "status": "needed" if to_list else "",
                              "store": clean_tags(b.get("store")), "priority": "nice" if b.get("priority") == "nice" else "",
                              "repeat": b.get("repeat", ""), "added_by": b.get("by", "Wall"), "updated_at": now_iso()})
        return {"ok": True, "id": gid}
    if action == "updateGrocery":
        ch = {"updated_at": now_iso()}
        for k in ("item", "note", "store", "priority", "repeat"):
            if b.get(k) is not None:
                ch[k] = clean_tags(b[k]) if k == "store" else ("nice" if b[k] == "nice" else "") if k == "priority" else str(b[k]).strip()
        _update("groceries", b.get("id"), ch)
        return
    if action == "setGroceryStatus":
        st = str(b.get("status", "")).lower()
        st = st if st in ("", "needed", "cart") else ""
        _update("groceries", b.get("id"), {"status": st, "updated_at": now_iso()})
        return
    if action == "deleteGrocery":
        _delete("groceries", b.get("id"))
        return
    if action == "clearList":
        keep = set(b.get("keep") or [])
        for g in rows("groceries"):
            if g["status"] and g["id"] not in keep:
                _update("groceries", g["id"], {"status": "", "updated_at": now_iso(),
                                               "next_add": step_date(today_key(), g["repeat"]) if g["repeat"] else ""})
        return
    if action == "clearPurchased":
        for g in rows("groceries"):
            if g["status"] == "cart":
                _update("groceries", g["id"], {"status": "", "updated_at": now_iso(),
                                               "next_add": step_date(today_key(), g["repeat"]) if g["repeat"] else ""})
        return
    # ---- quests
    if action == "submitQuest":
        q = _find("quests", b.get("questId"))
        if not q:
            raise ValueError("Quest not found")
        member = str(b.get("member", ""))
        if _conn.execute("SELECT 1 FROM queue WHERE type='quest' AND ref_id=? AND member=? AND status='pending'", (q["id"], member)).fetchone():
            return {"ok": True, "dup": True}
        qid = uid()
        auto = bool(b.get("auto"))
        _insert("queue", {"id": qid, "type": "quest", "ref_id": q["id"], "title": q["title"], "member": member, "points": q["points"],
                          "submitted_at": now_iso(), "status": "approved" if auto else "pending", "reviewed_at": now_iso() if auto else ""})
        return {"ok": True, "id": qid}
    if action == "withdrawQuest":
        if b.get("id"):
            k = _find("queue", b["id"])
            if k and k["status"] == "pending":
                _conn.execute("DELETE FROM queue WHERE id=?", (k["id"],))
            return
        _conn.execute("DELETE FROM queue WHERE type IN ('quest','help') AND ref_id=? AND member=? AND status='pending'", (str(b.get("questId")), str(b.get("member"))))
        return
    if action == "askHelp":
        q = _find("quests", b.get("questId"))
        if not q:
            raise ValueError("Quest not found")
        member = str(b.get("member", ""))
        if _conn.execute("SELECT 1 FROM queue WHERE type='help' AND ref_id=? AND member=? AND status='pending'", (q["id"], member)).fetchone():
            return {"ok": True, "dup": True}
        _insert("queue", {"id": uid(), "type": "help", "ref_id": q["id"], "title": q["title"], "member": member, "points": "0",
                          "submitted_at": now_iso(), "status": "pending"})
        return
    if action == "redeemReward":
        r = _find("rewards", b.get("rewardId"))
        if not r:
            raise ValueError("Reward not found")
        qid = uid()
        _insert("queue", {"id": qid, "type": "reward", "ref_id": r["id"], "title": r["title"], "member": b.get("member", ""),
                          "points": str(-abs(int(r["cost"] or 0))), "submitted_at": now_iso(), "status": "pending"})
        return {"ok": True, "id": qid}
    if action == "reviewQueue":
        st = "approved" if b.get("status") == "approved" else "rejected"
        _update("queue", b.get("id"), {"status": st, "reviewed_at": now_iso()})
        return
    if action == "undoQueue":
        k = _find("queue", b.get("id"))
        if not k:
            raise ValueError("Not found")
        if k["type"] == "adjust":
            _update("queue", k["id"], {"status": "undone", "reviewed_at": now_iso()})
        else:
            _update("queue", k["id"], {"status": "pending", "reviewed_at": ""})
        return
    if action == "adjustPoints":
        _insert("queue", {"id": uid(), "type": "adjust", "title": str(b.get("reason") or "Bonus"), "member": b.get("member", ""),
                          "points": str(int(b.get("points") or 0)), "submitted_at": now_iso(), "status": "approved", "reviewed_at": now_iso()})
        return
    if action == "clearQueue":
        _conn.execute("DELETE FROM queue WHERE status IN ('rejected','undone')")
        return
    # ---- dinner
    if action == "setDinner":
        d = str(b.get("date", ""))[:10]
        meal = str(b.get("meal", "")).strip()
        cur = _find("dinner", d)
        note = str(b["note"]) if b.get("note") is not None else (cur["note"] if cur else "")
        if not meal and not note:
            _delete("dinner", d)
        else:
            _insert("dinner", {"date": d, "meal": meal, "note": note})
        return
    # ---- todos
    if action == "addTodo":
        tid = uid()
        _insert("todos", {"id": tid, "task": str(b.get("task", "")).strip(), "tags": clean_tags(b.get("tags")), "assigned_to": b.get("assigned_to", ""),
                          "due": b.get("due", ""), "repeat": b.get("repeat", ""), "done": "FALSE", "notes": b.get("notes", ""),
                          "subtasks": b.get("subtasks", ""), "added_by": b.get("by", "Wall"), "created_at": now_iso()})
        return {"ok": True, "id": tid}
    if action == "updateTodo":
        ch = {}
        for k in ("task", "tags", "assigned_to", "due", "repeat", "notes", "subtasks"):
            if b.get(k) is not None:
                ch[k] = clean_tags(b[k]) if k == "tags" else b[k]
        _update("todos", b.get("id"), ch)
        return
    if action == "setTodoDone":
        t = _find("todos", b.get("id"))
        if not t:
            raise ValueError("Not found")
        done = is_true(b.get("done"))
        if done and t["repeat"]:
            # a repeating task rolls forward instead of staying done
            subs = t["subtasks"]
            try:
                sl = json.loads(subs) if subs else []
                for s in sl:
                    s["d"] = False
                subs = json.dumps(sl) if sl else ""
            except ValueError:
                pass
            _update("todos", t["id"], {"due": next_due(t["due"], t["repeat"]), "done": "FALSE", "done_at": now_iso(), "subtasks": subs})
        else:
            _update("todos", t["id"], {"done": "TRUE" if done else "FALSE", "done_at": now_iso() if done else ""})
        return
    if action == "deleteTodo":
        _delete("todos", b.get("id"))
        return
    # ---- board events
    if action == "saveEvent":
        row = {"title": str(b.get("title", "")).strip(), "date": str(b.get("date", ""))[:10], "time": b.get("time", ""),
               "kind": "reminder" if b.get("kind") == "reminder" else "event", "who": b.get("who", ""),
               "repeat": str(b.get("repeat", "")).lower(), "note": b.get("note", "")}
        if not row["title"] or not row["date"]:
            raise ValueError("Title and date are needed")
        ev = b.get("id") and _find("events", b["id"])
        if ev:
            _update("events", ev["id"], row)
            return {"ok": True, "id": ev["id"]}
        row.update({"id": uid(), "added_by": b.get("by", "Wall"), "created_at": now_iso()})
        _insert("events", row)
        return {"ok": True, "id": row["id"]}
    if action == "deleteEvent":
        _delete("events", b.get("id"))
        return
    # ---- parent: quests / rewards / display / config / members
    if action == "saveQuest":
        row = {"title": str(b.get("title", "")).strip(), "points": str(int(b.get("points") or 0)), "assigned_to": b.get("assigned_to") or "Anyone",
               "repeat": b.get("repeat") or "daily", "icon": b.get("icon") or "⭐",
               "active": "FALSE" if (b.get("active") is False or str(b.get("active")).upper() == "FALSE") else "TRUE", "notes": b.get("notes", "")}
        if not row["title"]:
            raise ValueError("Title needed")
        q = b.get("id") and _find("quests", b["id"])
        if q:
            _update("quests", q["id"], row)
            return {"ok": True, "id": q["id"]}
        row["id"] = uid()
        row["sort"] = (_conn.execute("SELECT COALESCE(MAX(sort),0) FROM quests").fetchone()[0] or 0) + 1
        _insert("quests", row)
        return {"ok": True, "id": row["id"]}
    if action == "deleteQuest":
        _delete("quests", b.get("id"))
        return
    if action == "saveReward":
        row = {"title": str(b.get("title", "")).strip(), "cost": str(int(b.get("cost") or 0)), "icon": b.get("icon") or "🎁",
               "active": "FALSE" if (b.get("active") is False or str(b.get("active")).upper() == "FALSE") else "TRUE"}
        if not row["title"]:
            raise ValueError("Title needed")
        r = b.get("id") and _find("rewards", b["id"])
        if r:
            _update("rewards", r["id"], row)
            return {"ok": True, "id": r["id"]}
        row["id"] = uid()
        row["sort"] = (_conn.execute("SELECT COALESCE(MAX(sort),0) FROM rewards").fetchone()[0] or 0) + 1
        _insert("rewards", row)
        return {"ok": True, "id": row["id"]}
    if action == "deleteReward":
        _delete("rewards", b.get("id"))
        return
    if action == "saveDisplay":
        row = {"start": str(b.get("start", "06:00")), "mode": b.get("mode") or "photos", "days": b.get("days") or "all", "note": b.get("note", "")}
        d = b.get("id") and _find("display", b["id"])
        if d:
            _update("display", d["id"], row)
            return {"ok": True, "id": d["id"]}
        row["id"] = uid()
        _insert("display", row)
        return {"ok": True, "id": row["id"]}
    if action == "deleteDisplay":
        _delete("display", b.get("id"))
        return
    if action == "setConfig":
        key = str(b.get("key", "")).strip()
        if not key:
            raise ValueError("key")
        _conn.execute("INSERT INTO config (key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                      (key, str(b.get("value", "") if b.get("value") is not None else "")))
        return
    if action == "saveMember":
        name = str(b.get("name", "")).strip()
        if not name:
            raise ValueError("Name needed")
        old = b.get("oldName")
        row = {"name": name, "role": "parent" if b.get("role") == "parent" else "kid", "color": b.get("color", "#60a5fa"),
               "emoji": b.get("emoji") or ("👤"), "active": "FALSE" if str(b.get("active")).upper() == "FALSE" else "TRUE"}
        if old and old != name and _find("members", old):
            m = _find("members", old)
            row["sort"] = m["sort"]
            _delete("members", old)
            # carry the old name's history across
            for t, col in (("queue", "member"), ("quests", "assigned_to"), ("todos", "assigned_to"), ("events", "who")):
                _conn.execute(f"UPDATE {t} SET {col}=? WHERE {col}=?", (name, old))
        elif _find("members", name):
            row["sort"] = _find("members", name)["sort"]
        else:
            row["sort"] = (_conn.execute("SELECT COALESCE(MAX(sort),0) FROM members").fetchone()[0] or 0) + 1
        _insert("members", row)
        return
    if action == "deleteMember":
        _delete("members", b.get("name"))
        return
    if action == "resetDemo":
        for t in TABLES + ["kv"]:
            _conn.execute(f"DELETE FROM {t}")
        for k, v, n in DEFAULT_CONFIG:
            _conn.execute("INSERT OR IGNORE INTO config VALUES (?,?,?)", (k, v, n))
        _conn.execute("DELETE FROM meta WHERE key IN ('demo','imported_at','import_source')")
        return
    raise ValueError("Unknown action " + str(action))


def replace_all(data, source=""):
    """Used by the importer: wipe and load tables + kv from a v1-shaped state dict."""
    with _lock, _conn:
        for t in TABLES + ["kv"]:
            _conn.execute(f"DELETE FROM {t}")
        for k, v, n in DEFAULT_CONFIG:
            _conn.execute("INSERT OR IGNORE INTO config VALUES (?,?,?)", (k, v, n))
        for k, v in (data.get("config") or {}).items():
            _conn.execute("INSERT INTO config (key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", (str(k), str(v)))
        for i, m in enumerate(data.get("members") or []):
            if m.get("name"):
                _insert("members", dict(m, sort=i + 1))
        for i, q in enumerate(data.get("quests") or []):
            if q.get("id"):
                _insert("quests", dict(q, sort=i + 1))
        for i, r in enumerate(data.get("rewards") or []):
            if r.get("id"):
                _insert("rewards", dict(r, sort=i + 1))
        for k in data.get("queue") or []:
            if k.get("id"):
                _insert("queue", k)
        for g in data.get("groceries") or []:
            if g.get("id") and g.get("item"):
                _insert("groceries", g)
        for d in data.get("dinner") or []:
            key = str(d.get("date", ""))[:10]
            if key and (d.get("meal") or d.get("note")):
                _insert("dinner", {"date": key, "meal": d.get("meal", ""), "note": d.get("note", "")})
        for e in data.get("local_events") or []:
            if e.get("id") and e.get("title"):
                _insert("events", e)
        for t in data.get("todos") or []:
            if t.get("id") and t.get("task"):
                _insert("todos", t)
        for d in data.get("display") or []:
            if d.get("id"):
                _insert("display", d)
        for k, v in (data.get("extras") or {}).items():
            if not str(k).startswith("_"):
                kv_set(str(k), v)
        _conn.execute("DELETE FROM meta WHERE key='demo'")
        _conn.execute("INSERT OR REPLACE INTO meta VALUES ('imported_at',?)", (now_iso(),))
        _conn.execute("INSERT OR REPLACE INTO meta VALUES ('import_source',?)", (source,))
        bump()


def export_csv_bundle():
    """All tables as CSV text, for people who like to look at their data in a spreadsheet."""
    import csv
    import io
    out = {}
    for t in TABLES:
        buf = io.StringIO()
        w = csv.writer(buf)
        w.writerow(TABLE_COLS[t])
        for r in rows(t):
            w.writerow([r[c] for c in TABLE_COLS[t]])
        out[t + ".csv"] = buf.getvalue()
    out["extras.json"] = json.dumps(kv_all(), ensure_ascii=False, indent=1)
    return out
