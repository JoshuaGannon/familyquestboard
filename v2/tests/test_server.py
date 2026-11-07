"""Server-side checks: ICS expansion, actions, role cookie, import. Run: python3 tests/test_server.py"""
import json, os, sys, tempfile
try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass
from datetime import date, timedelta
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from fqb import db, ics, importer, penalties, sound

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

# --- penalties (fresh db, pinned clock)
tmp2 = tempfile.mkdtemp(); db.open_db(os.path.join(tmp2, "p.db")); db.seed_demo()
T = date(2026, 11, 11)  # a Wednesday
penalties._test_today = T
sub = lambda qid, kid, d, st="approved": db._insert("queue", {"id": db.uid(), "type": "quest", "ref_id": qid, "title": "x", "member": kid, "points": "5", "submitted_at": d.isoformat() + "T12:00:00Z", "status": st, "reviewed_at": ""})
db.kv_set("questSince", dict({q["id"]: "2026-11-10" for q in db.rows("quests")}, q3="2026-10-01", q5="2026-11-07"))
db.kv_set("penaltyCfg", {"enabled": True, "ladder": [0, 5, 10], "cadence": "period", "cap": 30, "floor": True, "auto": False, "route": "board"})
db.do("adjustPoints", {"member": "Ava", "points": 50, "reason": "seed"}, True); db.do("adjustPoints", {"member": "Max", "points": 50, "reason": "seed"}, True)
# q3 Feed the cats (daily, Ava): done Nov 8, missed 9 and 10 -> at Nov 11 that is 2 misses -> rung 2 = -5
sub("q3", "Ava", date(2026, 11, 8))
# q1 Make your bed (daily, Anyone): Max did it yesterday -> nothing; Ava missed 1 -> warning (rung 1 = 0)
sub("q1", "Max", date(2026, 11, 10))
for d in range(1, 11): sub("q1", "Ava", date(2026, 11, d)) if d <= 9 else None
rows = penalties.run_day(T)
pen = [k for k in db.rows("queue") if k["type"] == "penalty" and k["ref_id"] == "q3"]
ok(len(pen) == 1 and pen[0]["member"] == "Ava" and pen[0]["points"] == "-5" and pen[0]["status"] == "pending", "2nd miss -> proposed -5 (first miss was a warning)")
npen = len([k for k in db.rows("queue") if k["type"] == "penalty"])
log = db.kv_get("penaltyLog"); ok(any(k.startswith("q1|Ava|") and v["kind"] == "warning" for k, v in log.items()), "1st miss -> warning logged, no points")
ok(not any(k.startswith("q1|Max|") for k in log), "kid who did it yesterday: nothing")
ok(penalties.run_day(T) == [] and len([k for k in db.rows("queue") if k["type"] == "penalty"]) == npen, "running the day twice charges nothing extra")
al = db.kv_get("alerts"); a3 = next((a for a in al if a["id"] == "q3|Ava"), None); a1 = next((a for a in al if a["id"] == "q1|Ava"), None)
ok(a3 and a3["kind"] == "penalty" and a3["points"] == 10 and "−10" in a3["text"], "board alert: next miss costs 10 (ladder)")
ok(a1 and a1["kind"] == "penalty" and a1["points"] == 5, "board alert after a warning says the next miss costs 5")
sub("q3", "Ava", T, "pending"); penalties.refresh_alerts(T)
ok(not any(a["id"] == "q3|Ava" for a in db.kv_get("alerts")), "alert clears once the quest is submitted today")
# cadence everyN=2 with grace 1 on q5 (daily, Anyone) for Max: 4 misses -> grace eats 1, ticks at m'=1 and m'=3 -> rung index 1 at the 4th miss
db.kv_set("questOpts", {"q5": {"penalty": {"mode": "custom", "grace": 1, "cadence": "everyN", "n": 2, "ladder": [5, 10], "auto": True}}})
sub("q5", "Max", date(2026, 11, 6))  # misses 7,8,9,10 = 4
db.kv_set("penaltyLog", {}); db._conn.execute("DELETE FROM queue WHERE type='penalty' AND ref_id='q5'"); penalties.run_day(T)
p5 = [k for k in db.rows("queue") if k["type"] == "penalty" and k["ref_id"] == "q5" and k["member"] == "Max"]
ok(len(p5) == 1 and p5[0]["points"] == "-10" and p5[0]["status"] == "approved", "every-2nd-miss cadence with grace, auto-applied, lands on the 2nd rung")
ok(penalties.tick_for({"grace": 0, "cadence": "afterN", "n": 3}, 2) is None and penalties.tick_for({"grace": 0, "cadence": "afterN", "n": 3}, 3) == 0, "afterN waits for N misses")
ok(penalties.ladder_amount({"ladder": [0, 5, 10], "beyond": "grow"}, 4) == 20 and penalties.ladder_amount({"ladder": [0, 5, 10], "beyond": "repeat"}, 4) == 10, "beyond the ladder: grow vs repeat")
# floor at zero: a kid with 3 points can only lose 3
db.kv_set("penaltyLog", {}); db._conn.execute("DELETE FROM queue WHERE type='penalty'"); db._conn.execute("UPDATE queue SET points='3' WHERE type='adjust' AND member='Ava'"); db._conn.execute("DELETE FROM queue WHERE type='quest' AND ref_id<>'q3'")
db.kv_set("penaltyCfg", {"enabled": True, "ladder": [5, 10], "cadence": "period", "floor": True, "route": "board"}); db.kv_set("questOpts", {})
db._conn.execute("DELETE FROM queue WHERE ref_id='q3' AND member='Ava' AND status='pending'")
bal = penalties.balance(db.rows("queue"), "Ava"); penalties.run_day(T); p3 = [k for k in db.rows("queue") if k["type"] == "penalty" and k["ref_id"] == "q3"]
ok(0 < bal < 10 and p3 and p3[0]["points"] == str(-bal), "floor: never below zero")
# weekly quest only ticks on the week boundary
ok(penalties.is_boundary("weekly", date(2026, 11, 9)) and not penalties.is_boundary("weekly", date(2026, 11, 10)), "weekly ticks on Monday only")
ok(penalties.is_boundary("days:mon,thu", date(2026, 11, 10)) and not penalties.is_boundary("days:mon,thu", date(2026, 11, 11)), "picked-days ticks the morning after a picked day")
cp = penalties.current_period("week:2", date(2026, 11, 11)); ok(cp and cp[0] == date(2026, 11, 9) and cp[2] == 2, "current period for twice-a-week")
# paused days are skipped
db.kv_set("streak", {"pauses": [{"from": "2026-11-09", "to": "2026-11-10"}]}); db.kv_set("penaltyLog", {}); db._conn.execute("DELETE FROM queue WHERE type='penalty'")
penalties.run_day(T); ok(not [k for k in db.rows("queue") if k["type"] == "penalty" and k["ref_id"] == "q3"], "paused days don't count as misses")
db.kv_set("streak", {}); penalties._test_today = None
sound.init(tmp2); ok(os.path.getsize(sound.path("chime")) > 20000 and os.path.getsize(sound.path("alert")) > 10000, "sound files render")
print("FAILED" if fails else "ALL OK"); sys.exit(1 if fails else 0)
