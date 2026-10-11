"""Bring everything across from v1: the Google Sheet (through the v1 Apps Script
URL), the v1 Pi extras file (notes, countdowns, messages, coupons…) and the photos.

Runs in a background thread; /api/import/status reports progress. Safe to run
again: it replaces v2's data with a fresh copy (that is the point of the sandbox)."""
import base64
import json
import os
import re
import threading
import time
import urllib.parse
import urllib.request

from . import access, db

HERE = os.path.dirname(os.path.abspath(__file__))
V2_DIR = os.path.dirname(HERE)
PROJECT = os.path.dirname(V2_DIR)
V1_DASHBOARD = os.path.join(PROJECT, "dashboard")
V1_EXTRAS = os.path.join(PROJECT, "data", "extras.json")
V1_ACCESS = os.path.join(PROJECT, "data", "access.json")
V1_PHOTOS = os.path.join(PROJECT, "photos")
IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp", ".heic", ".heif"}

_status = {"running": False, "step": "", "done": 0, "total": 0, "log": [], "error": "", "finished_at": "", "ok": False}
_lock = threading.Lock()


def status():
    with _lock:
        return dict(_status, log=_status["log"][-30:])


def _set(**kw):
    with _lock:
        _status.update(kw)


def _log(msg):
    with _lock:
        _status["log"].append(msg)
        _status["step"] = msg


def v1_script_url():
    """The Apps Script URL v1 is using on this machine, if any."""
    for name in ("config.local.js", "config.js"):
        p = os.path.join(V1_DASHBOARD, name)
        try:
            with open(p, encoding="utf-8") as f:
                m = re.search(r"APPS_SCRIPT_URL\s*:\s*['\"]([^'\"]+)['\"]", f.read())
            if m and m.group(1).startswith("http"):
                return m.group(1)
        except OSError:
            pass
    return ""


def _get(url, params=None, timeout=60):
    if params:
        url += ("&" if "?" in url else "?") + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={"User-Agent": "FamilyQuestBoard/2"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


def fetch_v1_state(script_url):
    raw = _get(script_url, {"action": "state"})
    data = json.loads(raw.decode("utf-8"))
    if data.get("error"):
        raise RuntimeError(data["error"])
    return data


def load_v1_extras(path=V1_EXTRAS):
    try:
        with open(path, encoding="utf-8") as f:
            d = json.load(f)
            return d if isinstance(d, dict) else {}
    except (OSError, ValueError):
        return {}


def has_images(folder):
    try:
        for root, _dirs, files in os.walk(folder):
            if os.path.basename(root) in ("_cache",) or os.path.basename(root).startswith("."):
                continue
            if any(os.path.splitext(f)[1].lower() in IMAGE_EXTS for f in files):
                return True
    except OSError:
        pass
    return False


def run(script_url="", photos_dir="", want_photos=True):
    """Start the import in the background. Returns False if one is already running."""
    with _lock:
        if _status["running"]:
            return False
        _status.update({"running": True, "step": "starting", "done": 0, "total": 0, "log": [], "error": "", "finished_at": "", "ok": False})
    threading.Thread(target=_run, args=(script_url or v1_script_url(), photos_dir, want_photos), daemon=True).start()
    return True


def _run(script_url, photos_dir, want_photos):
    try:
        data = {}
        if script_url:
            _log("Reading the Google Sheet through the v1 script…")
            data = fetch_v1_state(script_url)
            counts = {k: len(v) for k, v in data.items() if isinstance(v, list)}
            _log("Sheet read: " + ", ".join(f"{k} {n}" for k, n in counts.items()))
        else:
            _log("No v1 script URL found — importing only the Pi-side data")
        extras = load_v1_extras()
        if extras:
            _log(f"Pi extras read: {', '.join(sorted(k for k in extras if not k.startswith('_')))}")
        data["extras"] = extras
        # v1 config keys that mean nothing here
        cfg = dict(data.get("config") or {})
        for k in ("calendars", "photo_folder", "shopping_email", "night_start", "night_end"):
            cfg.pop(k, None)
        data["config"] = cfg
        db.replace_all(data, script_url or "pi-extras")
        _log("Database loaded")
        if access.adopt_from_v1(V1_ACCESS):
            _log("Family password copied from v1")
        if want_photos:
            _import_photos(script_url, photos_dir)
        if data.get("events"):
            _log("Note: Google Calendar events are not copied — add your calendar's iCal link under Settings → Calendar")
        _set(ok=True)
    except Exception as e:  # noqa: BLE001
        _set(error=str(e)[:300])
        _log("Failed: " + str(e)[:300])
    finally:
        _set(running=False, finished_at=db.now_iso())


def _import_photos(script_url, photos_dir):
    if has_images(V1_PHOTOS):
        _log(f"Photos: using the Pi's existing folder ({V1_PHOTOS})")
        db.meta_set("photos_dir", V1_PHOTOS)
        return
    if not script_url:
        return
    target = photos_dir or os.path.join(V2_DIR, "data", "photos")
    os.makedirs(target, exist_ok=True)
    try:
        lst = json.loads(_get(script_url, {"action": "photos"}).decode("utf-8")).get("photos") or []
    except Exception as e:  # noqa: BLE001
        _log("Photos: could not list the Drive folder (" + str(e)[:80] + ")")
        return
    if not lst:
        _log("Photos: the Drive folder is empty")
        return
    _set(total=len(lst), done=0)
    have = {f for f in os.listdir(target)}
    for i, p in enumerate(lst):
        name = re.sub(r"[^\w.\-]+", "_", p.get("name") or (p.get("id") + ".jpg"))
        if name in have:
            _set(done=i + 1)
            continue
        try:
            j = json.loads(_get(script_url, {"action": "photo", "id": p["id"]}, timeout=120).decode("utf-8"))
            with open(os.path.join(target, name), "wb") as f:
                f.write(base64.b64decode(j["data"]))
        except Exception as e:  # noqa: BLE001
            _log(f"Photos: skipped {name} ({str(e)[:60]})")
        _set(done=i + 1)
        _log(f"Photos: {i + 1} of {len(lst)}")
        time.sleep(0.2)
    db.meta_set("photos_dir", target)
    _log(f"Photos: {len(lst)} copied to {target}")
