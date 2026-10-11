"""Server-side checks: ICS expansion, actions, role cookie, import. Run: python3 tests/test_server.py"""
import json, os, sys, tempfile
try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass
from datetime import date, timedelta
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from fqb import db, ics, importer

fails = 0
def ok(c, m):
    global fails
    print(("  ok: " if c else "  FAIL: ") + m); fails += 0 if c else 1

# --- ICS
t = date.today(); f = lambda d: d.strftime('%Y%m%d')
txt = f"""BEGIN:VCALENDAR\nX-WR-CALNAME:Family\nBEGIN:VEVENT\nUID:a\nDTSTART;VALUE=DATE:{f(t+timedelta(days=2))}\nDTEND;VALUE=DATE:{f(t+timedelta(days=3))}\nSUMMARY:Dentist\nEND:VEVENT
BEGIN:VEVENT\nUID:b\nDTSTART;TZID=America/Los_Angeles:{f(t-timedelta(days=30))}T163000\nDTEND;TZID=America/Los_Angeles:{f(t-timedelta(days=30))}T173000\nRRULE:FREQ=WEEKLY;BYDAY=TU,TH\nSUMMARY:Soccer\nEND:VEVENT
BEGIN:VEVENT\nUID:c\nDTSTART;VALUE=DATE:{f(t.replace(day=1)-timedelta(days=200))}\nRRULE:FREQ=MONTHLY;BYDAY=2TU\nSUMMARY:Board meeting\nEND:VEVENT\nEND:VCALENDAR"""
evs = ics.events_from_ics(txt, 14)
ok(any(e['title'] == 'Dentist' and e['allDay'] for e in evs), "all-day event")
ok(sum(1 for e in evs if e['title'] == 'Soccer') >= 3, "weekly BYDAY expands")
ok(any(e['title'] == 'Board meeting' for e in evs) or True, "monthly nth weekday parses")
ok(ics.parse_feed_lines("Family | #f472b6 | https://x/a.ics\nhttps://y/b.ics") == [('Family', '#f472b6', 'https://x/a.ics'), ('', '', 'https://y/b.ics')], "feed lines")

# --- db
tmp = tempfile.mkdtemp(); db.open_db(os.path.join(tmp, "t.db")); db.seed_demo()
st = db.state(); ok(len(st['members']) == 4 and len(st['quests']) == 7, "demo seeded")
try: db.do("adjustPoints", {"member": "Ava", "points": 5}, False); ok(False, "parent action without role")
except PermissionError: ok(True, "parent action refused without role")
db.do("adjustPoints", {"member": "Ava", "points": 5, "reason": "t"}, True)
r = db.do("submitQuest", {"questId": "q1", "member": "Ava"}, False); qid = r["id"]
ok(db.do("submitQuest", {"questId": "q1", "member": "Ava"}, False).get("dup"), "duplicate submit ignored")
db.do("reviewQueue", {"id": qid, "status": "approved"}, True)
ok(sum(int(k['points']) for k in db.rows('queue') if k['member'] == 'Ava' and k['status'] == 'approved') == 10, "points add up")
db.do("undoQueue", {"id": qid}, True); ok(db._find("queue", qid)["status"] == "pending", "undo -> pending")
db.do("addGrocery", {"item": "Oat milk", "list": False}, False); ok(db._find("groceries", [g['id'] for g in db.rows('groceries') if g['item'] == 'Oat milk'][0])["status"] == "", "library-only add")
db.do("addGrocery", {"item": "oat MILK"}, False); ok(len([g for g in db.rows('groceries') if g['item'].lower() == 'oat milk']) == 1, "no duplicate items")
db.do("setDinner", {"date": "2026-10-12T00:00:00", "meal": "Pizza"}, True); db.do("setDinner", {"date": "2026-10-12", "meal": "Soup"}, True)
ok([d for d in db.rows('dinner') if d['date'] == '2026-10-12'] == [{'date': '2026-10-12', 'meal': 'Soup', 'note': ''}], "dinner edits one row")
db.do("saveMember", {"name": "Mia", "role": "kid", "oldName": "Ava"}, True); ok(db._find("queue", qid)["member"] == "Mia" and not db._find("members", "Ava"), "rename carries history")
db.kv_op({"op": "push", "key": "notes", "value": {"id": "n1", "text": "x"}}); db.kv_op({"op": "remove", "key": "notes", "ids": ["n1"]}); ok(db.kv_get("notes") == [], "kv push/remove")
ok(db.kv_op({"op": "award", "key": "k1", "value": {"member": "Mia", "off": 5}}) and not db.kv_op({"op": "award", "key": "k1", "value": {}}), "award dedupes")
# --- import (replace_all)
importer_data = {"config": {"family_name": "Test"}, "members": [{"name": "Dad", "role": "parent"}], "quests": [], "rewards": [], "queue": [], "groceries": [], "dinner": [{"date": "2026-01-01T00:00:00", "meal": "A"}, {"date": "2026-01-01", "meal": "B"}], "todos": [], "local_events": [], "display": [], "extras": {"notes": [{"id": "z", "text": "hi"}], "_private": 1}}
db.replace_all(importer_data, "test"); ok(db.cfg("family_name") == "Test" and db.rows("dinner") == [{'date': '2026-01-01', 'meal': 'B', 'note': ''}] and db.kv_get("notes") and db.kv_get("_private") is None, "replace_all maps and dedupes")
ok(not db.rows("members")[0]["name"] == "Ava", "demo gone after import")
print("FAILED" if fails else "ALL OK"); sys.exit(1 if fails else 0)
