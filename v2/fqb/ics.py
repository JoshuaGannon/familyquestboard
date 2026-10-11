"""
Calendar feeds (iCalendar / .ics) → a flat list of events for the next N days.

Google Calendar: Settings → your calendar → "Secret address in iCal format".
Apple/Outlook/anything else that publishes an .ics link works the same way.
Handles all-day and timed events, time zones, RRULE repeats (daily / weekly /
monthly / yearly with BYDAY, BYMONTHDAY, INTERVAL, COUNT, UNTIL), EXDATE and
edited single instances (RECURRENCE-ID). Cached for 5 minutes per feed.
"""
import re
import threading
import time
import urllib.request
from datetime import date, datetime, timedelta, timezone

try:
    from zoneinfo import ZoneInfo
except ImportError:  # very old Python
    ZoneInfo = None

_cache = {}          # url -> {"at": epoch, "events": [...], "name": str, "color": str, "error": str}
_lock = threading.Lock()
CACHE_SEC = 300
WEEKDAYS = {"MO": 0, "TU": 1, "WE": 2, "TH": 3, "FR": 4, "SA": 5, "SU": 6}


def local_tz():
    return datetime.now().astimezone().tzinfo


def _unfold(text):
    lines = text.replace("\r\n", "\n").replace("\r", "\n").split("\n")
    out = []
    for ln in lines:
        if ln[:1] in (" ", "\t") and out:
            out[-1] += ln[1:]
        else:
            out.append(ln)
    return out


def _parse_props(lines):
    """Yield (name, params, value) for each content line."""
    for ln in lines:
        if ":" not in ln:
            continue
        head, _, value = ln.partition(":")
        # params may contain ':' inside quotes (rare); good enough
        parts = head.split(";")
        name = parts[0].upper()
        params = {}
        for p in parts[1:]:
            k, _, v = p.partition("=")
            params[k.upper()] = v.strip('"')
        yield name, params, value


def _tz(params):
    tzid = params.get("TZID")
    if tzid and ZoneInfo:
        try:
            return ZoneInfo(tzid)
        except Exception:
            pass
    return local_tz()


def _parse_dt(value, params):
    """Returns (datetime or date, is_all_day)."""
    v = value.strip()
    if params.get("VALUE") == "DATE" or re.fullmatch(r"\d{8}", v):
        return date(int(v[:4]), int(v[4:6]), int(v[6:8])), True
    m = re.fullmatch(r"(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?(Z?)", v)
    if not m:
        raise ValueError("bad datetime " + v)
    y, mo, d, hh, mm, ss, z = m.groups()
    dt = datetime(int(y), int(mo), int(d), int(hh), int(mm), int(ss or 0))
    if z:
        dt = dt.replace(tzinfo=timezone.utc)
    else:
        dt = dt.replace(tzinfo=_tz(params))
    return dt, False


def _parse_duration(v):
    m = re.fullmatch(r"([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?", v.strip())
    if not m:
        return timedelta(0)
    sign, w, d, h, mi, s = m.groups()
    td = timedelta(weeks=int(w or 0), days=int(d or 0), hours=int(h or 0), minutes=int(mi or 0), seconds=int(s or 0))
    return -td if sign == "-" else td


def _unescape(s):
    return s.replace("\\n", "\n").replace("\\,", ",").replace("\\;", ";").replace("\\\\", "\\")


def parse_ics(text):
    """Returns (calendar name, color, [vevent dicts])."""
    lines = _unfold(text)
    name, color = "", ""
    events, cur = [], None
    for prop, params, value in _parse_props(lines):
        if prop == "BEGIN" and value.upper() == "VEVENT":
            cur = {"exdates": set(), "rrule": None, "recurrence_id": None, "status": "", "location": "", "summary": ""}
            continue
        if prop == "END" and value.upper() == "VEVENT":
            if cur and "dtstart" in cur:
                events.append(cur)
            cur = None
            continue
        if cur is None:
            if prop == "X-WR-CALNAME":
                name = _unescape(value)
            elif prop in ("X-APPLE-CALENDAR-COLOR", "COLOR"):
                color = value.strip()
            continue
        if prop == "DTSTART":
            cur["dtstart"], cur["all_day"] = _parse_dt(value, params)
        elif prop == "DTEND":
            cur["dtend"], _ = _parse_dt(value, params)
        elif prop == "DURATION":
            cur["duration"] = _parse_duration(value)
        elif prop == "SUMMARY":
            cur["summary"] = _unescape(value)
        elif prop == "LOCATION":
            cur["location"] = _unescape(value)
        elif prop == "UID":
            cur["uid"] = value
        elif prop == "STATUS":
            cur["status"] = value.upper()
        elif prop == "RRULE":
            cur["rrule"] = dict(p.split("=", 1) for p in value.split(";") if "=" in p)
        elif prop == "EXDATE":
            for part in value.split(","):
                try:
                    d, _ = _parse_dt(part, params)
                    cur["exdates"].add(_key(d))
                except ValueError:
                    pass
        elif prop == "RECURRENCE-ID":
            try:
                cur["recurrence_id"], _ = _parse_dt(value, params)
            except ValueError:
                pass
    return name, color, events


def _key(d):
    """Instance key: date for all-day, UTC minute for timed."""
    if isinstance(d, datetime):
        return d.astimezone(timezone.utc).strftime("%Y%m%dT%H%M")
    return d.strftime("%Y%m%d")


def _nth_weekday(y, m, weekday, n):
    """n-th (1..5, or -1 last) given weekday of a month, or None."""
    if n > 0:
        d = date(y, m, 1)
        d += timedelta(days=(weekday - d.weekday()) % 7)
        d += timedelta(weeks=n - 1)
        return d if d.month == m else None
    last = date(y + (m == 12), m % 12 + 1, 1) - timedelta(days=1)
    last -= timedelta(days=(last.weekday() - weekday) % 7)
    return last


def _expand(ev, win_start, win_end):
    """Yield start datetimes/dates for an event's occurrences inside [win_start, win_end)."""
    start = ev["dtstart"]
    rr = ev.get("rrule")
    if not rr:
        yield start
        return
    freq = rr.get("FREQ", "DAILY").upper()
    interval = max(1, int(rr.get("INTERVAL", 1) or 1))
    count = int(rr["COUNT"]) if rr.get("COUNT") else None
    until = None
    if rr.get("UNTIL"):
        try:
            u, _ = _parse_dt(rr["UNTIL"], {})
            until = u
        except ValueError:
            pass
    bydays = []
    for tok in (rr.get("BYDAY") or "").split(","):
        tok = tok.strip()
        if not tok:
            continue
        m = re.fullmatch(r"([+-]?\d)?([A-Z]{2})", tok)
        if m and m.group(2) in WEEKDAYS:
            bydays.append((int(m.group(1)) if m.group(1) else 0, WEEKDAYS[m.group(2)]))
    bymonthday = [int(x) for x in (rr.get("BYMONTHDAY") or "").split(",") if x.strip().lstrip("-").isdigit()]
    bymonth = [int(x) for x in (rr.get("BYMONTH") or "").split(",") if x.strip().isdigit()]
    is_dt = isinstance(start, datetime)
    sd = start.date() if is_dt else start

    def at(d):  # rebuild an occurrence at calendar date d with the original time of day
        return datetime.combine(d, start.timetz()) if is_dt else d

    def past_until(occ):
        if until is None:
            return False
        if isinstance(until, datetime):
            o = occ if isinstance(occ, datetime) else datetime.combine(occ, datetime.min.time(), tzinfo=local_tz())
            return o.astimezone(timezone.utc) > until.astimezone(timezone.utc)
        return (occ.date() if isinstance(occ, datetime) else occ) > until

    produced = 0
    guard = 0
    cursor = sd
    while guard < 20000:
        guard += 1
        if freq == "DAILY":
            cands = [cursor]
            nxt = cursor + timedelta(days=interval)
        elif freq == "WEEKLY":
            week_start = cursor - timedelta(days=cursor.weekday())
            days = sorted({wd for _, wd in bydays}) if bydays else [sd.weekday()]
            cands = [week_start + timedelta(days=wd) for wd in days]
            nxt = cursor + timedelta(weeks=interval)
        elif freq == "MONTHLY":
            y, m = cursor.year, cursor.month
            cands = []
            if bydays:
                for n, wd in bydays:
                    if n:
                        d = _nth_weekday(y, m, wd, n)
                        if d:
                            cands.append(d)
                    else:
                        for k in range(1, 6):
                            d = _nth_weekday(y, m, wd, k)
                            if d:
                                cands.append(d)
            elif bymonthday:
                for md in bymonthday:
                    try:
                        cands.append(date(y, m, md) if md > 0 else (date(y + (m == 12), m % 12 + 1, 1) + timedelta(days=md)))
                    except ValueError:
                        pass
            else:
                try:
                    cands.append(date(y, m, sd.day))
                except ValueError:
                    pass
            mm = (m - 1 + interval)
            nxt = date(y + mm // 12, mm % 12 + 1, 1)
        elif freq == "YEARLY":
            y = cursor.year
            cands = []
            months = bymonth or [sd.month]
            for m in months:
                if bydays:
                    for n, wd in bydays:
                        d = _nth_weekday(y, m, wd, n or 1)
                        if d:
                            cands.append(d)
                else:
                    try:
                        cands.append(date(y, m, sd.day))
                    except ValueError:
                        pass
            nxt = date(y + interval, 1, 1)
        else:
            yield start
            return
        for d in sorted(set(cands)):
            if d < sd:
                continue
            occ = at(d)
            if past_until(occ):
                return
            if count is not None and produced >= count:
                return
            produced += 1
            if d >= win_end:
                return
            if d >= win_start - timedelta(days=1):
                yield occ
        if nxt > win_end + timedelta(days=1):
            return
        cursor = nxt


def events_from_ics(text, days, name_override="", color_override=""):
    name, color, vevents = parse_ics(text)
    name = name_override or name or "Calendar"
    color = color_override or color or "#60a5fa"
    today = date.today()
    win_start, win_end = today, today + timedelta(days=int(days))
    overrides = {}   # (uid, instance key) -> vevent
    masters = []
    for ev in vevents:
        if ev.get("recurrence_id") is not None:
            overrides[(ev.get("uid"), _key(ev["recurrence_id"]))] = ev
        else:
            masters.append(ev)
    out = []
    ltz = local_tz()

    def emit(ev, start):
        if ev.get("status") == "CANCELLED":
            return
        all_day = not isinstance(start, datetime)
        if "dtend" in ev:
            dur = ev["dtend"] - ev["dtstart"]
        elif "duration" in ev:
            dur = ev["duration"]
        else:
            dur = timedelta(days=1) if all_day else timedelta(0)
        end = start + dur
        if all_day:
            s = datetime.combine(start, datetime.min.time(), tzinfo=ltz)
            e = datetime.combine(end, datetime.min.time(), tzinfo=ltz)
            if end <= win_start or start >= win_end:
                return
        else:
            s, e = start, end
            if e.astimezone(ltz).date() < win_start or s.astimezone(ltz).date() >= win_end:
                return
        out.append({"title": ev.get("summary") or "(no title)", "start": _iso(s), "end": _iso(e), "allDay": all_day,
                    "calendar": name, "color": color, "location": ev.get("location", ""), "uid": ev.get("uid", "")})

    for ev in masters:
        try:
            for occ in _expand(ev, win_start, win_end):
                k = _key(occ)
                if k in ev["exdates"]:
                    continue
                ov = overrides.pop((ev.get("uid"), k), None)
                if ov is not None:
                    emit(ov, ov["dtstart"])
                else:
                    emit(ev, occ)
        except Exception as e:  # one bad event must not kill the feed
            print(f"[ics] skipped {ev.get('summary')!r}: {e}")
    for ov in overrides.values():  # edited instances whose master we did not expand (moved into the window)
        emit(ov, ov["dtstart"])
    out.sort(key=lambda x: x["start"])
    return out


def _iso(dt):
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def parse_feed_lines(text):
    """Config value → [(name, color, url)]. Each line: 'Name | #rrggbb | url', or just a url."""
    feeds = []
    for ln in str(text or "").replace(",http", "\nhttp").splitlines():
        ln = ln.strip()
        if not ln:
            continue
        parts = [p.strip() for p in ln.split("|")]
        url = next((p for p in parts if p.startswith("http")), "")
        if not url:
            continue
        rest = [p for p in parts if p != url]
        name = next((p for p in rest if not p.startswith("#")), "")
        color = next((p for p in rest if p.startswith("#")), "")
        feeds.append((name, color, url))
    return feeds


def _fetch(url):
    req = urllib.request.Request(url, headers={"User-Agent": "FamilyQuestBoard/2"})
    with urllib.request.urlopen(req, timeout=20) as r:
        return r.read().decode("utf-8", "replace")


def get_events(feed_config, days=14, force=False):
    """Merged events from every feed; each feed cached CACHE_SEC. Stale data is returned while a refresh fails."""
    feeds = parse_feed_lines(feed_config)
    merged, errors = [], []
    for name, color, url in feeds:
        with _lock:
            c = _cache.get(url)
        fresh = c and not force and time.time() - c["at"] < CACHE_SEC and c.get("days") == days
        if not fresh:
            try:
                evs = events_from_ics(_fetch(url), days, name, color)
                c = {"at": time.time(), "events": evs, "error": "", "days": days}
            except Exception as e:  # noqa: BLE001
                err = str(e)[:200]
                c = dict(c or {"events": [], "days": days}, at=time.time(), error=err)
                errors.append(f"{name or url[:40]}: {err}")
            with _lock:
                _cache[url] = c
        merged.extend(c.get("events") or [])
        if c.get("error"):
            errors.append(f"{name or url[:40]}: {c['error']}")
    merged.sort(key=lambda x: x["start"])
    return merged, errors
