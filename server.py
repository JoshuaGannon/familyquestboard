#!/usr/bin/env python3
"""
Family Quest Board — local server
---------------------------------
Serves the dashboard and the family photo slideshow from a folder.

    python server.py                       # photos from ./photos, port 8080
    python server.py --photos "G:/My Drive/Wall Photos"
    python server.py --port 8080 --photos /home/pi/wall-photos

Then open http://localhost:8080 in a browser.

Photos: drop JPG/PNG/WEBP/HEIC* files into the photos folder (or point --photos
at your Google Drive "Wall Photos" folder). New photos show up within 10 minutes,
no restart needed. If Pillow is installed (pip install pillow) photos are
auto-resized to the screen size and cached, which keeps a Raspberry Pi smooth.
(*HEIC needs: pip install pillow-heif)

No third-party packages are required. Standard library only, Pillow optional.
"""
import argparse
import hashlib
import hmac
import ipaddress
import json
import re
import secrets
import mimetypes
import os
import socket
import subprocess
import sys
import threading
import time
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, quote, unquote, urlparse
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
DASHBOARD = os.path.join(HERE, "dashboard")
# Machine-specific settings (the Apps Script URL) live here so a git pull or a
# re-copy of the project never wipes them. Written by Parents -> Settings.
LOCAL_CONFIG = os.path.join(DASHBOARD, "config.local.js")


def write_local_config(url):
    body = ('// Written by the dashboard (Parents -> Settings). Overrides config.js on this machine.\n'
            'window.FQB_CONFIG = Object.assign(window.FQB_CONFIG || {}, { APPS_SCRIPT_URL: %s });\n' % json.dumps(url))
    with open(LOCAL_CONFIG, "w", encoding="utf-8") as f:
        f.write(body)
# ---------------------------------------------------------------------------
# Internet access gate
# ---------------------------------------------------------------------------
# When the board is reachable from outside the house (Caddy on the Pi reverse-
# proxies https://<you>.duckdns.org to this server), every request that comes
# through the proxy must carry a signed cookie obtained from the /login page.
# Requests from the home network / the kiosk itself never see the gate.
# The password is set from Parents -> Settings (LAN only) and stored hashed in
# data/access.json, which git ignores.
ACCESS_FILE = os.path.join(HERE, "data", "access.json")
_access = {"hash": "", "salt": "", "secret": ""}
_login_fails = {}  # ip -> [timestamps]
COOKIE = "fqb_auth"
COOKIE_DAYS = 30


def _access_load():
    global _access
    try:
        with open(ACCESS_FILE, encoding="utf-8") as f:
            _access.update(json.load(f))
    except Exception:
        pass
    if not _access.get("secret"):
        _access["secret"] = secrets.token_hex(32)
        _access_save()


def _access_save():
    os.makedirs(os.path.dirname(ACCESS_FILE), exist_ok=True)
    with open(ACCESS_FILE, "w", encoding="utf-8") as f:
        json.dump(_access, f)


def _pw_hash(pw, salt):
    return hashlib.pbkdf2_hmac("sha256", pw.encode(), bytes.fromhex(salt), 200000).hex()


def access_set_password(pw):
    pw = (pw or "").strip()
    if not pw:
        _access.update({"hash": "", "salt": ""})
    else:
        salt = secrets.token_hex(16)
        _access.update({"hash": _pw_hash(pw, salt), "salt": salt})
    _access["secret"] = secrets.token_hex(32)  # signs everyone out
    _access_save()


def access_enabled():
    return bool(_access.get("hash"))


def access_check(pw):
    return access_enabled() and hmac.compare_digest(_pw_hash(pw or "", _access["salt"]), _access["hash"])


def make_token():
    exp = str(int(time.time()) + COOKIE_DAYS * 86400)
    sig = hmac.new(_access["secret"].encode(), exp.encode(), "sha256").hexdigest()
    return exp + "." + sig


def token_ok(tok):
    try:
        exp, sig = tok.split(".", 1)
        good = hmac.new(_access["secret"].encode(), exp.encode(), "sha256").hexdigest()
        return hmac.compare_digest(sig, good) and int(exp) > time.time()
    except Exception:
        return False


def is_private_ip(ip):
    try:
        return ipaddress.ip_address(ip.split("%")[0]).is_private or ip.startswith("127.")
    except Exception:
        return False


LOGIN_HTML = """<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Family Quest Board</title><style>
body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0b0e14;color:#e8ecf3;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
form{background:#161a24;padding:34px 30px;border-radius:22px;width:min(360px,90vw);box-shadow:0 20px 60px rgba(0,0,0,.5)}
h1{margin:0 0 6px;font-size:26px}p{margin:0 0 20px;color:#98a2b8}
input{width:100%;box-sizing:border-box;font-size:20px;padding:14px 16px;border-radius:14px;border:2px solid #2a3040;background:#0f1320;color:#fff;outline:none}
input:focus{border-color:#fbbf24}button{margin-top:14px;width:100%;font-size:19px;font-weight:700;padding:14px;border:0;border-radius:14px;background:#fbbf24;color:#1a1200}
.err{color:#f87171;margin:10px 0 0;font-weight:600}</style></head><body>
<form method="post" action="/login"><h1>🏰 Family Quest Board</h1><p>Enter the family password to continue.</p>
<input type="password" name="password" placeholder="Password" autofocus autocomplete="current-password">
<button>Open the board</button>%ERR%</form></body></html>"""

# Push alerts go out from here (the Pi's own internet), because Google's servers
# can't reliably reach ntfy.sh. The Google script still sends the text messages.
def ntfy_send(topic, title, message, priority="default", tags="", click="", actions=None):
    topic = "".join(c for c in str(topic or "") if c.isalnum() or c in "-_")[:64]
    if not topic:
        return False, "no topic"
    pr = {"min": 1, "low": 2, "default": 3, "high": 4, "urgent": 5}.get(str(priority), 3)
    payload = {"topic": topic, "title": title or "", "message": message or title or "", "priority": pr}
    tl = [t for t in (tags.split(",") if isinstance(tags, str) else (tags or [])) if t]
    if tl:
        payload["tags"] = tl
    if click:
        payload["click"] = click
    if actions:
        payload["actions"] = actions[:3]
    req = urllib.request.Request("https://ntfy.sh/", data=json.dumps(payload).encode("utf-8"), method="POST",
                                 headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=12) as r:
            return 200 <= r.status < 300, f"HTTP {r.status}"
    except Exception as e:  # noqa: BLE001
        return False, str(e)


# ---------------------------------------------------------------------------
# Family messages: kids write on the wall, parents get a push with one-tap
# replies. Stored in data/extras.json under "messages" (last 300).
# ---------------------------------------------------------------------------
MSG_PUSH_LIMIT = 3          # pushes per sender ...
MSG_PUSH_WINDOW = 60        # ... per this many seconds (extra messages still land on the wall)
_msg_push_times = {}
QUICK_REPLIES = [("yes", "👍 Yes"), ("no", "👎 Not now"), ("omw", "🏃 On my way")]


def _msg_sig(mid, code, as_name=""):
    return hmac.new(_access["secret"].encode(), f"{mid}|{code}|{as_name}".encode(), "sha256").hexdigest()[:24]


def msg_post(body):
    text = str(body.get("text", "")).strip()[:500]
    frm = str(body.get("from", "")).strip()[:40]
    if not text or not frm:
        raise ValueError("empty message")
    msg = {"id": secrets.token_hex(6), "from": frm, "to": str(body.get("to", "") or "all")[:40],
           "text": text, "kind": "kid" if body.get("kind") == "kid" else "parent",
           "at": time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime()) + "Z"}
    if body.get("reply_to"):
        msg["reply_to"] = str(body.get("reply_to"))[:20]
    extras_op({"op": "push", "key": "messages", "value": msg})
    pushed, limited, detail = False, False, ""
    # targets: [{topic, as}] — one per recipient phone. "as" is who a one-tap reply
    # from that phone will be signed as (e.g. "Dad"). Old clients send a single topic.
    targets = body.get("targets")
    if not isinstance(targets, list):
        t = str(body.get("topic", "")).strip()
        targets = [{"topic": t, "as": "Parent"}] if (t and msg["kind"] == "kid") else []
    targets = [x for x in targets if isinstance(x, dict) and str(x.get("topic", "")).strip()][:6]
    if targets:
        now = time.time()
        recent = [t for t in _msg_push_times.get(frm, []) if now - t < MSG_PUSH_WINDOW]
        if len(recent) >= MSG_PUSH_LIMIT:
            limited = True
        else:
            recent.append(now); _msg_push_times[frm] = recent
            host = os.environ.get("FQB_PUBLIC_HOST", "").strip()
            base = f"https://{host}" if host else ""
            full = str(body.get("fulltext", "TRUE")).upper() != "FALSE"
            results = []
            for tg in targets:
                as_name = str(tg.get("as") or "Parent")[:40]
                title = f"💬 {frm}" + (" → Family" if msg["to"] in ("family", "parents", "all") else "")
                cid = str(body.get("cid", "")).strip()[:100]
                click = (base + "/#chat/" + quote(cid)) if (base and cid) else ((base + "/#messages") if base else "")
                q = lambda code: f"{base}/api/msg-quick?m={msg['id']}&r={code}&a={quote(as_name)}&s={_msg_sig(msg['id'], code, as_name)}"
                actions = [{"action": "http", "label": label, "method": "POST", "clear": True, "url": q(code)}
                           for code, label in QUICK_REPLIES] if base else None
                ok, why = ntfy_send(tg.get("topic"), title, text if full else "New message — tap to read it",
                                    "high", "", click, actions)
                results.append(ok); detail = why
            pushed = any(results)
    return {"ok": True, "id": msg["id"], "pushed": pushed, "limited": limited, "detail": detail}


def msg_quick(mid, code, sig, as_name=""):
    label = dict(QUICK_REPLIES).get(code)
    as_name = (as_name or "")[:40]
    if not label or not hmac.compare_digest(sig or "", _msg_sig(mid, code, as_name)):
        return False, "bad link"
    with _extras_lock:
        d = _extras_load()
    msgs = d.get("messages") if isinstance(d.get("messages"), list) else []
    orig = next((m for m in msgs if isinstance(m, dict) and m.get("id") == mid), None)
    if not orig:
        return False, "message not found"
    who = as_name or "Parent"
    if any(isinstance(m, dict) and m.get("reply_to") == mid and m.get("quick") == code and m.get("from") == who for m in msgs):
        return True, "already sent"
    reply = {"id": secrets.token_hex(6), "from": who, "to": orig.get("from", ""), "text": label,
             "kind": "parent", "reply_to": mid, "quick": code,
             "at": time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime()) + "Z"}
    extras_op({"op": "push", "key": "messages", "value": reply})
    return True, "sent"


IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp", ".heic", ".heif"}
MAX_EDGE = 1920  # resize longest edge to this when Pillow is available

try:
    from PIL import Image, ImageOps
    try:
        import pillow_heif  # noqa: F401
        pillow_heif.register_heif_opener()
    except Exception:
        pass
    HAVE_PIL = True
except Exception:
    HAVE_PIL = False

_resize_lock = threading.Lock()
PORT = 8080
SCREEN_SH = os.path.join(HERE, "pi", "screen.sh")

# Hardware display power. Chromium can't turn a panel off; this server can,
# by shelling out to pi/screen.sh. The dashboard calls /api/display.
_screen = {"method": None, "probed": 0.0, "on": True}
_PROBE_RETRY_SEC = 60  # a failed probe is retried; the session may not be up yet at boot
_screen_lock = threading.Lock()

# A manual override set from the wall OR from a phone: {"mode": ..., "until": epoch}
# The wall reads this each tick and it wins over the scheduled mode.
_override = {"mode": None, "until": 0}

# Freeze detection: the wall's own browser (localhost only, not phones) posts
# /api/heartbeat every 30 s; pi/watchdog.sh relaunches it if that goes stale.
_heartbeat = {"at": time.time()}

# Extras: data for features that live on the Pi rather than in the Google Sheet
# (sticky notes, countdowns, "who's got it", reward goals, quest options like
# auto-approve, streak settings, coupons, streak-locked prizes). One JSON file.
EXTRAS_FILE = os.path.join(HERE, "data", "extras.json")
_extras_lock = threading.Lock()


def _extras_load():
    try:
        with open(EXTRAS_FILE, encoding="utf-8") as f:
            d = json.load(f)
            return d if isinstance(d, dict) else {}
    except (OSError, ValueError):
        return {}


def _extras_save(d):
    os.makedirs(os.path.dirname(EXTRAS_FILE), exist_ok=True)
    tmp = EXTRAS_FILE + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(d, f, ensure_ascii=False, indent=1)
    os.replace(tmp, EXTRAS_FILE)


def extras_op(body):
    """ops: set {key, value} | merge {key, value: {..}} (dict merge, None deletes)
            push {key, value} (append to list, keeps last 300)
            remove {key, id} or {key, ids: [..]} (drop list items by id)
            award {key: coupon-dedupe-key, value: coupon} (once per key)"""
    op = body.get("op")
    key = str(body.get("key", ""))
    with _extras_lock:
        d = _extras_load()
        if op == "set":
            d[key] = body.get("value")
        elif op == "merge":
            cur = d.get(key) if isinstance(d.get(key), dict) else {}
            for k, v in (body.get("value") or {}).items():
                if v is None:
                    cur.pop(k, None)
                else:
                    cur[k] = v
            d[key] = cur
        elif op == "push":
            lst = d.get(key) if isinstance(d.get(key), list) else []
            lst.append(body.get("value"))
            d[key] = lst[-300:]
        elif op == "remove":
            lst = d.get(key) if isinstance(d.get(key), list) else []
            ids = body.get("ids") if isinstance(body.get("ids"), list) else [body.get("id")]
            ids = {i for i in ids if i}
            d[key] = [x for x in lst if not (isinstance(x, dict) and x.get("id") in ids)]
        elif op == "award":
            awarded = d.get("awarded") if isinstance(d.get("awarded"), list) else []
            if key in awarded:
                return d, False
            awarded.append(key)
            d["awarded"] = awarded[-2000:]
            val = body.get("value") or {}
            kind = val.get("kind") if isinstance(val, dict) else None
            target = "prizes" if kind == "prize" else "pointlog" if kind == "points" else "coupons"
            lst = d.get(target) if isinstance(d.get(target), list) else []
            lst.append(val)
            d[target] = lst[-500:]
        else:
            raise ValueError("unknown op")
        _extras_save(d)
        return d, True


# Wall controls, usable from a phone even when the wall's browser is frozen:
# restart the kiosk browser, close it for an hour, or reboot the Pi.
PI_DIR = os.path.join(HERE, "pi")
PAUSE_FILE = os.path.join(PI_DIR, ".watchdog", "paused_until")


def _spawn(cmd):
    subprocess.Popen(cmd, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                     stderr=subprocess.DEVNULL, start_new_session=True, cwd=HERE)


def _pause_watchdog(seconds):
    os.makedirs(os.path.dirname(PAUSE_FILE), exist_ok=True)
    if seconds > 0:
        with open(PAUSE_FILE, "w") as f:
            f.write(str(int(time.time() + seconds)))
    elif os.path.exists(PAUSE_FILE):
        os.remove(PAUSE_FILE)


def system_action(action):
    if not sys.platform.startswith("linux") or not os.path.exists(os.path.join(PI_DIR, "relaunch-kiosk.sh")):
        return False, "Only available on the Raspberry Pi"
    if action == "restart_app":
        _pause_watchdog(0)
        _spawn(["bash", os.path.join(PI_DIR, "relaunch-kiosk.sh")])
        return True, "Restarting the board app…"
    if action == "exit_app":
        _pause_watchdog(3600)
        _spawn(["pkill", "-f", "user-data-dir=.*fqb-kiosk"])
        return True, "Board closed. It comes back on its own in 1 hour, or tap Restart app."
    if action == "reboot":
        _spawn(["bash", "-c", "sleep 2; sudo reboot"])
        return True, "Rebooting the Pi — back in about a minute."
    return False, "Unknown action"


def screen_probe():
    with _screen_lock:
        if _screen["method"]:
            return _screen["method"]
        if _screen["probed"] and time.time() - _screen["probed"] < _PROBE_RETRY_SEC:
            return None
        _screen["probed"] = time.time()
        if not os.path.exists(SCREEN_SH):
            return None
        try:
            r = subprocess.run(["bash", SCREEN_SH, "probe"], capture_output=True, text=True, timeout=10)
            m = (r.stdout or "").strip().splitlines()[-1].strip() if r.stdout.strip() else ""
            _screen["method"] = m if (r.returncode == 0 and m and m != "none") else None
        except Exception as e:
            print(f"[display] probe failed: {e}", file=sys.stderr)
            _screen["method"] = None
        return _screen["method"]


def screen_set(on):
    """Power the panel on/off. Returns (ok, method)."""
    if not os.path.exists(SCREEN_SH):
        return False, None
    try:
        r = subprocess.run(["bash", SCREEN_SH, "on" if on else "off"],
                           capture_output=True, text=True, timeout=15)
        m = (r.stdout or "").strip().splitlines()[-1].strip() if r.stdout.strip() else ""
        ok = r.returncode == 0 and m and m != "none"
        with _screen_lock:
            _screen["probed"] = time.time()
            _screen["method"] = m if ok else None
            if ok:
                _screen["on"] = bool(on)
        return bool(ok), (m if ok else None)
    except Exception as e:
        print(f"[display] set failed: {e}", file=sys.stderr)
        return False, None


def override_state():
    o = dict(_override)
    if o["mode"] and o["until"] and time.time() > o["until"]:
        o = {"mode": None, "until": 0}
        _override.update(o)
    o["seconds_left"] = max(0, int(o["until"] - time.time())) if o["mode"] and o["until"] else 0
    return o


def friendly_host():
    """Name phones can use instead of the IP: <hostname>.local on the Pi (mDNS via
    avahi), or the plain Windows computer name (NetBIOS / LLMNR)."""
    try:
        name = (socket.gethostname() or "").split(".")[0].lower()
    except Exception:
        return ""
    if not name or name == "localhost":
        return ""
    if sys.platform.startswith("linux") and (os.path.exists("/etc/avahi") or os.path.exists("/run/avahi-daemon")):
        return name + ".local"
    if sys.platform.startswith("win"):
        return name
    return name + ".local"


def lan_ip():
    """Best-effort LAN address of this machine (no packets are actually sent)."""
    import socket
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("10.255.255.255", 1))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        try:
            return socket.gethostbyname(socket.gethostname())
        except Exception:
            return None


def list_photos(folder):
    out = []
    if not os.path.isdir(folder):
        return out
    for root, _dirs, files in os.walk(folder):
        # Skip hidden folders and our own cache
        if os.path.basename(root).startswith(".") or os.path.basename(root) == "_cache":
            continue
        for f in files:
            if f.startswith("."):
                continue
            ext = os.path.splitext(f)[1].lower()
            if ext in IMAGE_EXTS:
                rel = os.path.relpath(os.path.join(root, f), folder).replace(os.sep, "/")
                out.append(rel)
    out.sort()
    return out


def cached_path(folder, rel):
    """Return a resized, cached copy of the photo (or the original if no Pillow)."""
    src = os.path.join(folder, rel)
    if not HAVE_PIL:
        return src
    cache_dir = os.path.join(folder, "_cache")
    os.makedirs(cache_dir, exist_ok=True)
    try:
        st = os.stat(src)
    except OSError:
        return src
    key = hashlib.md5(f"{rel}|{st.st_size}|{int(st.st_mtime)}|{MAX_EDGE}".encode()).hexdigest()
    dst = os.path.join(cache_dir, key + ".jpg")
    if os.path.exists(dst):
        return dst
    with _resize_lock:
        if os.path.exists(dst):
            return dst
        try:
            im = Image.open(src)
            im = ImageOps.exif_transpose(im)  # respect phone rotation
            im.thumbnail((MAX_EDGE, MAX_EDGE))
            if im.mode not in ("RGB", "L"):
                im = im.convert("RGB")
            im.save(dst + ".tmp", "JPEG", quality=85, optimize=True)
            os.replace(dst + ".tmp", dst)
            return dst
        except Exception as e:  # unreadable image → serve original
            print(f"[photos] could not resize {rel}: {e}", file=sys.stderr)
            return src


class Handler(SimpleHTTPRequestHandler):
    photos_dir = os.path.join(HERE, "photos")

    def __init__(self, *a, **kw):
        super().__init__(*a, directory=DASHBOARD, **kw)

    def log_message(self, fmt, *args):
        if "/api/" in fmt % args or "/photos/" in fmt % args:
            return  # keep the console quiet during the slideshow
        super().log_message(fmt, *args)

    def end_headers(self):
        path = getattr(self, "path", "") or ""
        # Photos may be cached; the app itself must not be, so edits show on the next reload.
        cacheable = path.startswith("/photos/")
        self.send_header("Cache-Control", "max-age=300" if cacheable else "no-store")
        super().end_headers()

    def handle_one_request(self):
        # Phones often try https:// first ("HTTPS-First" mode). A TLS handshake
        # starts with byte 0x16. Closing the connection silently makes the
        # browser fall back to plain http:// instead of showing an error.
        try:
            first = self.rfile.peek(1)[:1]
        except Exception:
            first = b""
        if first == b"\x16":
            self.close_connection = True
            return
        super().handle_one_request()

    def log_error(self, fmt, *args):
        pass  # bad/garbled requests are not worth a traceback in the console

    def _send_json(self, obj, code=200):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _read_json(self):
        try:
            n = int(self.headers.get("Content-Length") or 0)
            return json.loads(self.rfile.read(n) or b"{}") if n else {}
        except Exception:
            return {}

    # --- internet gate -----------------------------------------------------
    def _remote(self):
        """True when this request came in through the public reverse proxy."""
        if self.headers.get("X-Forwarded-For"):
            return True
        ip = self.client_address[0]
        return not is_private_ip(ip)

    def _authed(self):
        c = self.headers.get("Cookie") or ""
        for part in c.split(";"):
            k, _, v = part.strip().partition("=")
            if k == COOKIE and token_ok(v):
                return True
        return False

    def _login_page(self, err="", code=200):
        body = LOGIN_HTML.replace("%ERR%", f'<p class="err">{err}</p>' if err else "").encode()
        self.send_response(code)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    # Public even from outside: the install manifest and icons carry nothing
    # private, and browsers fetch the manifest without cookies.
    PUBLIC_PATHS = {"/manifest.json", "/sw.js", "/icon-192.png", "/icon-512.png", "/favicon.ico"}

    def _gate(self):
        """Returns True when the request may proceed."""
        if urlparse(self.path).path in self.PUBLIC_PATHS:
            return True
        if not self._remote():
            return True
        if not access_enabled():
            self._login_page("Internet access is not set up yet — set a password under Parents → Settings on the board.", 403)
            return False
        if self._authed():
            return True
        self._login_page()
        return False

    def _do_login(self):
        ip = self.client_address[0]
        now = time.time()
        fails = [t for t in _login_fails.get(ip, []) if now - t < 600]
        if len(fails) >= 8:
            self._login_page("Too many tries — wait 10 minutes.", 429)
            return
        n = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(n).decode("utf-8", "replace") if n else ""
        pw = (parse_qs(raw).get("password") or [""])[0]
        if access_check(pw):
            _login_fails.pop(ip, None)
            secure = "; Secure" if (self.headers.get("X-Forwarded-Proto", "").lower() == "https") else ""
            self.send_response(303)
            self.send_header("Location", "/")
            self.send_header("Set-Cookie", f"{COOKIE}={make_token()}; Path=/; Max-Age={COOKIE_DAYS * 86400}; HttpOnly; SameSite=Lax{secure}")
            self.send_header("Content-Length", "0")
            self.end_headers()
            return
        fails.append(now); _login_fails[ip] = fails
        time.sleep(0.8)
        self._login_page("Wrong password.", 401)

    def do_POST(self):
        path = urlparse(self.path).path
        if path == "/login":
            self._do_login()
            return
        if path == "/api/msg-quick":
            # Called by the ntfy app / ntfy.sh web page when a parent taps a reply
            # button. The link is signed, so it's safe to allow from any origin.
            q = parse_qs(urlparse(self.path).query)
            ok, why = msg_quick((q.get("m") or [""])[0], (q.get("r") or [""])[0], (q.get("s") or [""])[0], (q.get("a") or [""])[0])
            body = json.dumps({"ok": ok, "detail": why}).encode()
            self.send_response(200 if ok else 403)
            self.send_header("Content-Type", "application/json")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        if path == "/api/access":
            # LAN only: set / clear the internet password
            if self._remote():
                self._send_json({"ok": False, "error": "Only from the home network"}, 403)
                return
            body = self._read_json()
            access_set_password(str(body.get("password", "")))
            self._send_json({"ok": True, "enabled": access_enabled()})
            return
        if not self._gate():
            return
        if path == "/api/display":
            body = self._read_json()
            want_on = str(body.get("state", "on")).lower() not in ("off", "0", "false")
            ok, method = screen_set(want_on)
            self._send_json({"ok": ok, "supported": bool(method), "method": method,
                             "state": "on" if _screen["on"] else "off"})
            return
        if path == "/api/override":
            body = self._read_json()
            mode = body.get("mode")
            if mode in (None, "", "schedule"):
                _override.update({"mode": None, "until": 0})
            else:
                mins = float(body.get("minutes") or 0)
                _override.update({"mode": str(mode),
                                  "until": time.time() + mins * 60 if mins > 0 else 0})
            self._send_json(override_state())
            return
        if path == "/api/extras":
            try:
                d, changed = extras_op(self._read_json())
                self._send_json({"ok": True, "changed": changed, "extras": d})
            except Exception as e:  # noqa: BLE001
                self._send_json({"ok": False, "error": str(e)}, 400)
            return
        if path == "/api/system":
            body = self._read_json()
            ok, msg = system_action(str(body.get("action", "")))
            self._send_json({"ok": ok, "message": msg})
            return
        if path == "/api/heartbeat":
            body = self._read_json()
            if self.client_address[0] in ("127.0.0.1", "::1", "::ffff:127.0.0.1"):
                _heartbeat["at"] = time.time()
                try:
                    _heartbeat["idle"] = int(body.get("idle", 0))
                except (TypeError, ValueError):
                    _heartbeat["idle"] = 0
                _heartbeat["busy"] = bool(body.get("busy"))
            self._send_json({"ok": True})
            return
        if path == "/api/msg":
            try:
                self._send_json(msg_post(self._read_json()))
            except Exception as e:  # noqa: BLE001
                self._send_json({"ok": False, "error": str(e)}, 400)
            return
        if path == "/api/notify":
            body = self._read_json()
            # Tapping the alert opens the board on the right screen (e.g. "go/parent/queue")
            host = os.environ.get("FQB_PUBLIC_HOST", "").strip()
            go = re.sub(r"[^a-z0-9/_-]", "", str(body.get("go", "") or "").lower())[:60]
            click = f"https://{host}/#{go or 'go/home'}" if host else ""
            ok, msg = ntfy_send(body.get("topic"), body.get("title", ""), body.get("message", ""), body.get("priority", "default"), body.get("tags", ""), click)
            self._send_json({"ok": ok, "detail": msg}, 200 if ok else 502)
            return
        if path == "/api/config":
            body = self._read_json()
            url = str(body.get("url", "")).strip()
            try:
                if url:
                    write_local_config(url)
                elif os.path.exists(LOCAL_CONFIG):
                    os.remove(LOCAL_CONFIG)
                self._send_json({"ok": True})
            except Exception as e:  # noqa: BLE001
                self._send_json({"ok": False, "error": str(e)})
            return
        self.send_error(404)

    def do_OPTIONS(self):
        # CORS preflight for the one-tap reply link only
        if urlparse(self.path).path == "/api/msg-quick":
            self.send_response(204)
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Access-Control-Allow-Methods", "POST, GET, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "*")
            self.send_header("Access-Control-Max-Age", "86400")
            self.send_header("Content-Length", "0")
            self.end_headers()
            return
        self.send_error(405)

    def do_HEAD(self):
        if self._gate():
            super().do_HEAD()

    def do_GET(self):
        path = urlparse(self.path).path
        if path == "/login":
            self._login_page()
            return
        if path == "/logout":
            self.send_response(303)
            self.send_header("Location", "/login")
            self.send_header("Set-Cookie", f"{COOKIE}=; Path=/; Max-Age=0")
            self.send_header("Content-Length", "0")
            self.end_headers()
            return
        if not self._gate():
            return
        if path == "/config.js" and os.path.exists(LOCAL_CONFIG):
            # config.js first (defaults), then the local override appended
            try:
                with open(os.path.join(DASHBOARD, "config.js"), "rb") as f:
                    base = f.read()
            except OSError:
                base = b""
            with open(LOCAL_CONFIG, "rb") as f:
                body = base + b"\n" + f.read()
            self.send_response(200)
            self.send_header("Content-Type", "application/javascript")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        if path == "/api/display":
            method = screen_probe()
            self._send_json({"supported": bool(method), "method": method,
                             "state": "on" if _screen["on"] else "off"})
            return
        if path == "/api/override":
            self._send_json(override_state())
            return
        if path == "/api/extras":
            with _extras_lock:
                self._send_json(_extras_load())
            return
        if path == "/api/heartbeat":
            age = int(time.time() - _heartbeat["at"])
            self._send_json({"age": age, "idle": _heartbeat.get("idle", 0) + age,
                             "busy": _heartbeat.get("busy", False)})
            return
        if path == "/api/photos":
            photos = list_photos(self.photos_dir)
            body = json.dumps({
                "photos": [{"name": p, "url": "/photos/" + p} for p in photos],
                "folder": self.photos_dir,
                "resize": HAVE_PIL,
            }).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        if path == "/api/health":
            body = json.dumps({"ok": True, "photos_dir": self.photos_dir, "pillow": HAVE_PIL,
                               "lan_ip": lan_ip(), "port": PORT, "hostname": friendly_host(),
                               "access": access_enabled(), "remote": self._remote(), "public_host": os.environ.get("FQB_PUBLIC_HOST", ""),
                               "display": bool(screen_probe()), "display_method": screen_probe()}).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        if path.startswith("/photos/"):
            rel = unquote(path[len("/photos/"):])
            full = os.path.normpath(os.path.join(self.photos_dir, rel))
            if not full.startswith(os.path.normpath(self.photos_dir)) or not os.path.isfile(full):
                self.send_error(404)
                return
            serve = cached_path(self.photos_dir, rel)
            ctype = mimetypes.guess_type(serve)[0] or "application/octet-stream"
            try:
                with open(serve, "rb") as fh:
                    data = fh.read()
            except OSError:
                self.send_error(404)
                return
            self.send_response(200)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)
            return
        super().do_GET()


def main():
    ap = argparse.ArgumentParser(description="Family Quest Board local server")
    ap.add_argument("--port", type=int, default=int(os.environ.get("FQB_PORT", 8080)))
    ap.add_argument("--photos", default=os.environ.get("FQB_PHOTOS", os.path.join(HERE, "photos")))
    ap.add_argument("--host", default="0.0.0.0", help="0.0.0.0 = reachable from other devices on your Wi-Fi")
    args = ap.parse_args()

    global PORT
    PORT = args.port
    _access_load()
    Handler.photos_dir = os.path.abspath(args.photos)
    os.makedirs(Handler.photos_dir, exist_ok=True)

    srv = ThreadingHTTPServer((args.host, args.port), Handler)
    ip = lan_ip()
    print("Family Quest Board")
    print(f"  Dashboard : http://localhost:{args.port}")
    if ip:
        print(f"  Phones    : http://{ip}:{args.port}   (same Wi-Fi; allow Python through Windows Firewall if asked)")
    if friendly_host():
        print(f"              http://{friendly_host()}:{args.port}   (by name, if your phone can resolve it)")
    print(f"  Photos    : {Handler.photos_dir}  ({len(list_photos(Handler.photos_dir))} found)")
    print(f"  Resizing  : {'on (Pillow)' if HAVE_PIL else 'off — pip install pillow to enable'}")
    m = screen_probe()
    print(f"  Screen off: {('yes, via ' + m) if m else 'not available here (the app will show a black screen instead)'}")
    print("  Ctrl+C to stop")
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
