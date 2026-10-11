#!/usr/bin/env python3
"""
Family Quest Board v2 — the server
----------------------------------
One Python process, one SQLite file, no Google script. Standard library only
(Pillow optional, for photo resizing).

    python3 server.py                      # port 8090, data in ./data
    python3 server.py --port 8090 --photos ../photos

Runs side by side with v1 (which keeps port 8080).
"""
import argparse
import hashlib
import io
import json
import mimetypes
import os
import sys
import threading
import time
import zipfile
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, unquote, urlparse

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from fqb import access, alerts, db, ics, importer, pi  # noqa: E402

WEB = os.path.join(HERE, "web")
DATA = os.path.join(HERE, "data")
PORT = 8090
IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp", ".heic", ".heif"}
MAX_EDGE = 1920

try:
    from PIL import Image, ImageOps
    try:
        import pillow_heif  # noqa: F401
        pillow_heif.register_heif_opener()
    except Exception:  # noqa: BLE001
        pass
    HAVE_PIL = True
except Exception:  # noqa: BLE001
    HAVE_PIL = False
_resize_lock = threading.Lock()


# ---------------------------------------------------------------- photos
def photos_dir():
    d = db.meta_get("photos_dir")
    return d if d and os.path.isdir(d) else Handler.photos_dir


def list_photos(folder):
    out = []
    if not os.path.isdir(folder):
        return out
    for root, _dirs, files in os.walk(folder):
        if os.path.basename(root).startswith(".") or os.path.basename(root) == "_cache":
            continue
        for f in files:
            if not f.startswith(".") and os.path.splitext(f)[1].lower() in IMAGE_EXTS:
                out.append(os.path.relpath(os.path.join(root, f), folder).replace(os.sep, "/"))
    out.sort()
    return out


def cached_path(folder, rel):
    src = os.path.join(folder, rel)
    if not HAVE_PIL:
        return src
    cache_dir = os.path.join(folder, "_cache")
    try:
        os.makedirs(cache_dir, exist_ok=True)
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
            im = ImageOps.exif_transpose(im)
            im.thumbnail((MAX_EDGE, MAX_EDGE))
            if im.mode not in ("RGB", "L"):
                im = im.convert("RGB")
            im.save(dst + ".tmp", "JPEG", quality=85, optimize=True)
            os.replace(dst + ".tmp", dst)
            return dst
        except Exception as e:  # noqa: BLE001
            print(f"[photos] could not resize {rel}: {e}", file=sys.stderr)
            return src


# ---------------------------------------------------------------- calendar (background refresh)
_cal = {"events": [], "errors": [], "at": 0}


def calendar_events(force=False):
    cfg = db.config()
    feeds = cfg.get("ical_urls", "")
    if not feeds.strip():
        _cal.update({"events": [], "errors": [], "at": time.time()})
        return _cal
    if force or time.time() - _cal["at"] > 240:
        try:
            days = int(cfg.get("calendar_days") or 14)
        except ValueError:
            days = 14
        evs, errs = ics.get_events(feeds, days, force)
        _cal.update({"events": evs, "errors": errs, "at": time.time()})
    return _cal


PUBLIC_PATHS = {"/manifest.json", "/sw.js", "/icon-192.png", "/icon-512.png", "/favicon.ico"}


class Handler(SimpleHTTPRequestHandler):
    photos_dir = os.path.join(DATA, "photos")

    def __init__(self, *a, **kw):
        super().__init__(*a, directory=WEB, **kw)

    # --- plumbing
    def log_message(self, fmt, *args):
        s = fmt % args
        if "/api/" in s or "/photos/" in s:
            return
        super().log_message(fmt, *args)

    def log_error(self, fmt, *args):
        pass

    def end_headers(self):
        path = getattr(self, "path", "") or ""
        self.send_header("Cache-Control", "max-age=300" if path.startswith("/photos/") else "no-store")
        super().end_headers()

    def handle_one_request(self):
        try:
            first = self.rfile.peek(1)[:1]
        except Exception:  # noqa: BLE001
            first = b""
        if first == b"\x16":  # a TLS hello on the plain port: close quietly so the phone falls back to http
            self.close_connection = True
            return
        super().handle_one_request()

    def _json(self, obj, code=200, headers=None):
        body = json.dumps(obj, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        for k, v in (headers or []):
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(body)

    def _body(self):
        try:
            n = int(self.headers.get("Content-Length") or 0)
            return json.loads(self.rfile.read(n) or b"{}") if n else {}
        except Exception:  # noqa: BLE001
            return {}

    def _html(self, html, code=200):
        body = html.encode()
        self.send_response(code)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _secure(self):
        return "; Secure" if (self.headers.get("X-Forwarded-Proto", "").lower() == "https") else ""

    def _cookie(self, name, value, days):
        return f"{name}={value}; Path=/; Max-Age={int(days * 86400)}; HttpOnly; SameSite=Lax{self._secure()}"

    # --- auth
    def _remote(self):
        if self.headers.get("X-Forwarded-For"):
            return True
        return not access.is_private_ip(self.client_address[0])

    def _cookies(self):
        return access.cookies(self.headers.get("Cookie"))

    def _authed(self):
        return access.token_ok(self._cookies().get(access.COOKIE, ""), "auth")

    def _is_parent(self, body=None):
        pin = db.cfg("pin", "1234")
        tok = self._cookies().get(access.PARENT_COOKIE, "")
        if tok and access.token_ok(tok, "parent", hashlib.sha256(pin.encode()).hexdigest()[:16]):
            return True
        return bool(body) and str(body.get("pin", "")) == pin and str(body.get("pin", "")) != ""

    def _gate(self):
        if urlparse(self.path).path in PUBLIC_PATHS or not self._remote():
            return True
        if not access.enabled():
            self._html(access.LOGIN_HTML.replace("%ERR%", '<p class="err">Internet access is not set up yet — set a password under Parents → Settings on the board.</p>'), 403)
            return False
        if self._authed():
            return True
        self._html(access.LOGIN_HTML.replace("%ERR%", ""))
        return False

    def _do_login(self):
        ip = self.client_address[0]
        if not access.login_allowed(ip):
            self._html(access.LOGIN_HTML.replace("%ERR%", '<p class="err">Too many tries — wait 10 minutes.</p>'), 429)
            return
        n = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(n).decode("utf-8", "replace") if n else ""
        pw = (parse_qs(raw).get("password") or [""])[0]
        if access.check(pw):
            access.login_ok(ip)
            self.send_response(303)
            self.send_header("Location", "/")
            self.send_header("Set-Cookie", self._cookie(access.COOKIE, access.make_token("auth"), access.COOKIE_DAYS))
            self.send_header("Content-Length", "0")
            self.end_headers()
            return
        access.login_failed(ip)
        time.sleep(0.8)
        self._html(access.LOGIN_HTML.replace("%ERR%", '<p class="err">Wrong password.</p>'), 401)

    # --- GET
    def do_GET(self):  # noqa: C901
        u = urlparse(self.path)
        path, q = u.path, parse_qs(u.query)
        if path == "/login":
            self._html(access.LOGIN_HTML.replace("%ERR%", ""))
            return
        if path == "/logout":
            self.send_response(303)
            self.send_header("Location", "/login")
            self.send_header("Set-Cookie", f"{access.COOKIE}=; Path=/; Max-Age=0")
            self.send_header("Content-Length", "0")
            self.end_headers()
            return
        if not self._gate():
            return
        if path == "/api/state":
            since = int((q.get("since") or ["0"])[0] or 0)
            cal = calendar_events()
            v = db.version()
            if since and since == v and cal["at"] <= float((q.get("cal") or ["0"])[0] or 0):
                self._json({"unchanged": True, "version": v, "cal": cal["at"]})
                return
            st = db.state()
            st.update({"events": cal["events"], "calendar_errors": cal["errors"], "cal": cal["at"], "parent": self._is_parent(),
                       "server": self._server_info(), "import": importer.status()})
            self._json(st)
            return
        if path == "/api/events":
            cal = calendar_events(force=bool(q.get("refresh")))
            self._json({"events": cal["events"], "errors": cal["errors"]})
            return
        if path == "/api/whoami":
            self._json({"parent": self._is_parent(), "remote": self._remote()})
            return
        if path == "/api/photos":
            pd = photos_dir()
            self._json({"photos": [{"name": p, "url": "/photos/" + p} for p in list_photos(pd)], "folder": pd, "resize": HAVE_PIL})
            return
        if path.startswith("/photos/"):
            pd = photos_dir()
            rel = unquote(path[len("/photos/"):])
            full = os.path.normpath(os.path.join(pd, rel))
            if not full.startswith(os.path.normpath(pd)) or not os.path.isfile(full):
                self.send_error(404)
                return
            serve = cached_path(pd, rel)
            try:
                with open(serve, "rb") as fh:
                    data = fh.read()
            except OSError:
                self.send_error(404)
                return
            self.send_response(200)
            self.send_header("Content-Type", mimetypes.guess_type(serve)[0] or "application/octet-stream")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)
            return
        if path == "/api/display":
            m = pi.screen_probe()
            self._json({"supported": bool(m), "method": m, "state": pi.screen_state()})
            return
        if path == "/api/override":
            self._json(pi.override_state())
            return
        if path == "/api/heartbeat":
            self._json(pi.heartbeat_get())
            return
        if path == "/api/import/status":
            self._json(importer.status())
            return
        if path == "/api/export":
            buf = io.BytesIO()
            with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
                for name, text in db.export_csv_bundle().items():
                    z.writestr(name, text)
            data = buf.getvalue()
            self.send_response(200)
            self.send_header("Content-Type", "application/zip")
            self.send_header("Content-Disposition", 'attachment; filename="family-quest-board-export.zip"')
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)
            return
        if path == "/api/health":
            self._json(self._server_info())
            return
        if path in ("/", "") or (not path.startswith("/api/") and "." not in os.path.basename(path)):
            self.path = "/index.html"
        super().do_GET()

    def _server_info(self):
        return {"ok": True, "v": 2, "port": PORT, "photos_dir": photos_dir(), "photos": len(list_photos(photos_dir())), "pillow": HAVE_PIL,
                "lan_ip": pi.lan_ip(), "hostname": pi.friendly_host(), "access": access.enabled(), "remote": self._remote(),
                "public_host": os.environ.get("FQB_PUBLIC_HOST", ""), "public_prefix": os.environ.get("FQB_PUBLIC_PREFIX", ""),
                "display": bool(pi.screen_probe()), "display_method": pi.screen_probe(), "v1_script": bool(importer.v1_script_url()),
                "imported_at": db.meta_get("imported_at"), "demo": db.meta_get("demo") == "1", "pi": sys.platform.startswith("linux") and os.path.exists(pi.PI_DIR)}

    # --- POST
    def do_POST(self):  # noqa: C901
        u = urlparse(self.path)
        path = u.path
        if path == "/login":
            self._do_login()
            return
        if path == "/api/msg-quick":
            q = parse_qs(u.query)
            ok, why = alerts.msg_quick((q.get("m") or [""])[0], (q.get("r") or [""])[0], (q.get("s") or [""])[0], (q.get("a") or [""])[0])
            self._json({"ok": ok, "detail": why}, 200 if ok else 403, [("Access-Control-Allow-Origin", "*")])
            return
        if path == "/api/access":
            if self._remote():
                self._json({"ok": False, "error": "Only from the home network"}, 403)
                return
            access.set_password(str(self._body().get("password", "")))
            self._json({"ok": True, "enabled": access.enabled()})
            return
        if not self._gate():
            return
        body = self._body()
        if path == "/api/unlock":
            pin = db.cfg("pin", "1234")
            if str(body.get("pin", "")) != pin:
                time.sleep(0.5)
                self._json({"ok": False, "error": "Wrong PIN"}, 403)
                return
            days = 30 if body.get("remember") else 1
            tok = access.make_token("parent", days, hashlib.sha256(pin.encode()).hexdigest()[:16])
            self._json({"ok": True, "parent": True, "days": days}, 200, [("Set-Cookie", self._cookie(access.PARENT_COOKIE, tok, days))])
            return
        if path == "/api/lock":
            self._json({"ok": True, "parent": False}, 200, [("Set-Cookie", f"{access.PARENT_COOKIE}=; Path=/; Max-Age=0")])
            return
        if path == "/api/do":
            action = str(body.get("action", ""))
            try:
                out = db.do(action, body, self._is_parent(body))
            except PermissionError as e:
                self._json({"ok": False, "error": str(e), "locked": True}, 403)
                return
            except (ValueError, KeyError, TypeError) as e:
                self._json({"ok": False, "error": str(e)}, 400)
                return
            self._after(action, body, out)
            out["version"] = db.version()
            self._json(out)
            return
        if path == "/api/x":
            try:
                changed = db.kv_op(body)
                self._json({"ok": True, "changed": changed, "version": db.version()})
            except Exception as e:  # noqa: BLE001
                self._json({"ok": False, "error": str(e)}, 400)
            return
        if path == "/api/notify":
            if body.get("topic"):
                base = alerts.public_base()
                go = "".join(c for c in str(body.get("go", "") or "").lower() if c.isalnum() or c in "/_-")[:60]
                ok, msg = alerts.ntfy_send(body.get("topic"), body.get("title", ""), body.get("message", ""), body.get("priority", "default"),
                                           body.get("tags", ""), f"{base}/#{go or 'go/home'}" if base else "")
            else:
                ok, msg = alerts.notify(str(body.get("kind", "test")), body.get("title", ""), body.get("message", ""),
                                        body.get("go") or "go/parent/queue", bool(body.get("force")))
            self._json({"ok": ok, "detail": msg}, 200 if ok else 502)
            return
        if path == "/api/msg":
            try:
                self._json(alerts.msg_post(body))
            except Exception as e:  # noqa: BLE001
                self._json({"ok": False, "error": str(e)}, 400)
            return
        if path == "/api/display":
            want_on = str(body.get("state", "on")).lower() not in ("off", "0", "false")
            ok, method = pi.screen_set(want_on)
            self._json({"ok": ok, "supported": bool(method), "method": method, "state": pi.screen_state()})
            return
        if path == "/api/override":
            self._json(pi.override_set(body.get("mode"), body.get("minutes") or 0))
            return
        if path == "/api/heartbeat":
            if self.client_address[0] in ("127.0.0.1", "::1", "::ffff:127.0.0.1"):
                pi.heartbeat_post(body)
            self._json({"ok": True})
            return
        if path == "/api/system":
            if not self._is_parent(body):
                self._json({"ok": False, "message": "Parent PIN needed"}, 403)
                return
            ok, msg = pi.system_action(str(body.get("action", "")))
            self._json({"ok": ok, "message": msg})
            return
        if path == "/api/import":
            if not self._is_parent(body):
                self._json({"ok": False, "error": "Parent PIN needed"}, 403)
                return
            started = importer.run(str(body.get("script_url", "")).strip(), want_photos=body.get("photos", True) is not False)
            self._json({"ok": started, "status": importer.status()})
            return
        self.send_error(404)

    def _after(self, action, body, out):
        """Alerts that follow an action (never allowed to fail the action)."""
        try:
            if action == "submitQuest" and not out.get("dup"):
                q = db._find("quests", body.get("questId")) or {}
                auto = bool(body.get("auto"))
                alerts.notify("quest", f"{body.get('member')} finished: {q.get('title', '')}",
                              f"+{q.get('points', 0)} pts " + ("(auto-approved)" if auto else "waiting for approval"),
                              "go/quests" if auto else "go/parent/queue")
            elif action == "askHelp" and not out.get("dup"):
                q = db._find("quests", body.get("questId")) or {}
                alerts.notify("help", f"🙋 {body.get('member')} needs help", q.get("title", ""))
            elif action == "redeemReward":
                r = db._find("rewards", body.get("rewardId")) or {}
                alerts.notify("reward", f"🎁 {body.get('member')} wants: {r.get('title', '')}", f"{r.get('cost', 0)} pts — approve on the board")
        except Exception as e:  # noqa: BLE001
            print(f"[alerts] {e}", file=sys.stderr)

    def do_OPTIONS(self):
        if urlparse(self.path).path == "/api/msg-quick":
            self.send_response(204)
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Access-Control-Allow-Methods", "POST, GET, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "*")
            self.send_header("Content-Length", "0")
            self.end_headers()
            return
        self.send_error(405)

    def do_HEAD(self):
        if self._gate():
            super().do_HEAD()


def main():
    ap = argparse.ArgumentParser(description="Family Quest Board v2 server")
    ap.add_argument("--port", type=int, default=int(os.environ.get("FQB2_PORT", 8090)))
    ap.add_argument("--data", default=os.environ.get("FQB2_DATA", DATA))
    ap.add_argument("--photos", default=os.environ.get("FQB2_PHOTOS", ""))
    ap.add_argument("--host", default="0.0.0.0")
    ap.add_argument("--demo", action="store_true", help="seed the starter family if the database is empty")
    args = ap.parse_args()
    global PORT
    PORT = args.port
    data_dir = os.path.abspath(args.data)
    os.makedirs(data_dir, exist_ok=True)
    db.open_db(os.path.join(data_dir, "fqb.db"))
    access.load(os.path.join(data_dir, "access.json"))
    Handler.photos_dir = os.path.abspath(args.photos) if args.photos else os.path.join(data_dir, "photos")
    os.makedirs(Handler.photos_dir, exist_ok=True)
    if args.demo or not db.rows("members"):
        if db.seed_demo():
            print("  (empty database — seeded the starter family; Settings → Import brings your real data over)")
    srv = ThreadingHTTPServer((args.host, args.port), Handler)
    ip = pi.lan_ip()
    print("Family Quest Board v2")
    print(f"  Board   : http://localhost:{args.port}")
    if ip:
        print(f"  Phones  : http://{ip}:{args.port}" + (f"   or http://{pi.friendly_host()}:{args.port}" if pi.friendly_host() else ""))
    print(f"  Data    : {data_dir}")
    print(f"  Photos  : {photos_dir()}  ({len(list_photos(photos_dir()))} found, resize {'on' if HAVE_PIL else 'off'})")
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
