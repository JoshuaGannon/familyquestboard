"""Internet access gate + parent role cookie.

- Family password (set from the home network under Settings): requests that arrive
  through the public reverse proxy need the signed `fqb2_auth` cookie from /login.
- Parent role: POST /api/unlock with the PIN sets a signed `fqb2_parent` cookie, so
  the PIN is typed once per device and never sent with every action. The wall
  clears it when it idles out; a PIN change signs everyone out.
"""
import hashlib
import hmac
import ipaddress
import json
import os
import secrets
import time

ACCESS_FILE = None
_access = {"hash": "", "salt": "", "secret": ""}
_login_fails = {}
COOKIE = "fqb2_auth"
PARENT_COOKIE = "fqb2_parent"
COOKIE_DAYS = 30


def load(path):
    global ACCESS_FILE
    ACCESS_FILE = path
    try:
        with open(path, encoding="utf-8") as f:
            _access.update(json.load(f))
    except Exception:  # noqa: BLE001
        pass
    if not _access.get("secret"):
        _access["secret"] = secrets.token_hex(32)
        save()


def save():
    os.makedirs(os.path.dirname(ACCESS_FILE), exist_ok=True)
    with open(ACCESS_FILE, "w", encoding="utf-8") as f:
        json.dump(_access, f)


def secret():
    return _access["secret"]


def _pw_hash(pw, salt):
    return hashlib.pbkdf2_hmac("sha256", pw.encode(), bytes.fromhex(salt), 200000).hex()


def set_password(pw):
    pw = (pw or "").strip()
    if not pw:
        _access.update({"hash": "", "salt": ""})
    else:
        salt = secrets.token_hex(16)
        _access.update({"hash": _pw_hash(pw, salt), "salt": salt})
    _access["secret"] = secrets.token_hex(32)  # signs everyone out
    save()


def enabled():
    return bool(_access.get("hash"))


def check(pw):
    return enabled() and hmac.compare_digest(_pw_hash(pw or "", _access["salt"]), _access["hash"])


def _sign(payload):
    return hmac.new(_access["secret"].encode(), payload.encode(), "sha256").hexdigest()


def make_token(kind="auth", days=COOKIE_DAYS, extra=""):
    exp = str(int(time.time()) + days * 86400)
    payload = f"{kind}|{exp}|{extra}"
    return payload + "." + _sign(payload)


def token_ok(tok, kind="auth", extra=None):
    try:
        payload, sig = tok.rsplit(".", 1)
        k, exp, ex = payload.split("|", 2)
        if k != kind or not hmac.compare_digest(sig, _sign(payload)) or int(exp) <= time.time():
            return False
        return extra is None or ex == extra
    except Exception:  # noqa: BLE001
        return False


def cookies(header):
    out = {}
    for part in (header or "").split(";"):
        k, _, v = part.strip().partition("=")
        if k:
            out[k] = v
    return out


def is_private_ip(ip):
    try:
        return ipaddress.ip_address(ip.split("%")[0]).is_private or ip.startswith("127.")
    except Exception:  # noqa: BLE001
        return False


def login_allowed(ip):
    now = time.time()
    fails = [t for t in _login_fails.get(ip, []) if now - t < 600]
    _login_fails[ip] = fails
    return len(fails) < 8


def login_failed(ip):
    _login_fails.setdefault(ip, []).append(time.time())


def login_ok(ip):
    _login_fails.pop(ip, None)


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
