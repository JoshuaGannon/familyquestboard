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
import json
import mimetypes
import os
import socket
import subprocess
import sys
import threading
import time
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import unquote, urlparse

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

    def do_POST(self):
        path = urlparse(self.path).path
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
        if path == "/api/heartbeat":
            self._read_json()
            if self.client_address[0] in ("127.0.0.1", "::1", "::ffff:127.0.0.1"):
                _heartbeat["at"] = time.time()
            self._send_json({"ok": True})
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

    def do_GET(self):
        path = urlparse(self.path).path
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
        if path == "/api/heartbeat":
            self._send_json({"age": int(time.time() - _heartbeat["at"])})
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
