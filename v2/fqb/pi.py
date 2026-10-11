"""Raspberry Pi hardware bits: panel power, kiosk restart, manual display override, freeze heartbeat.
Shells out to the scripts in ../../pi (shared with v1) when they exist."""
import os
import socket
import subprocess
import sys
import threading
import time

HERE = os.path.dirname(os.path.abspath(__file__))
V2_DIR = os.path.dirname(HERE)
PROJECT = os.path.dirname(V2_DIR)
PI_DIR = os.path.join(PROJECT, "pi")
SCREEN_SH = os.path.join(PI_DIR, "screen.sh")
PAUSE_FILE = os.path.join(PI_DIR, ".watchdog", "paused_until")

_screen = {"method": None, "probed": 0.0, "on": True}
_screen_lock = threading.Lock()
_override = {"mode": None, "until": 0}
_heartbeat = {"at": time.time(), "idle": 0, "busy": False}
_PROBE_RETRY_SEC = 60


def _spawn(cmd):
    subprocess.Popen(cmd, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                     start_new_session=True, cwd=PROJECT)


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
        except Exception as e:  # noqa: BLE001
            print(f"[display] probe failed: {e}", file=sys.stderr)
            _screen["method"] = None
        return _screen["method"]


def screen_set(on):
    if not os.path.exists(SCREEN_SH):
        return False, None
    try:
        r = subprocess.run(["bash", SCREEN_SH, "on" if on else "off"], capture_output=True, text=True, timeout=15)
        m = (r.stdout or "").strip().splitlines()[-1].strip() if r.stdout.strip() else ""
        ok = r.returncode == 0 and m and m != "none"
        with _screen_lock:
            _screen["probed"] = time.time()
            _screen["method"] = m if ok else None
            if ok:
                _screen["on"] = bool(on)
        return bool(ok), (m if ok else None)
    except Exception as e:  # noqa: BLE001
        print(f"[display] set failed: {e}", file=sys.stderr)
        return False, None


def screen_state():
    return "on" if _screen["on"] else "off"


def override_state():
    o = dict(_override)
    if o["mode"] and o["until"] and time.time() > o["until"]:
        o = {"mode": None, "until": 0}
        _override.update(o)
    o["seconds_left"] = max(0, int(o["until"] - time.time())) if o["mode"] and o["until"] else 0
    return o


def override_set(mode, minutes):
    if mode in (None, "", "schedule"):
        _override.update({"mode": None, "until": 0})
    else:
        _override.update({"mode": str(mode), "until": time.time() + float(minutes or 0) * 60 if float(minutes or 0) > 0 else 0})
    return override_state()


def heartbeat_post(body):
    _heartbeat["at"] = time.time()
    try:
        _heartbeat["idle"] = int(body.get("idle", 0))
    except (TypeError, ValueError):
        _heartbeat["idle"] = 0
    _heartbeat["busy"] = bool(body.get("busy"))


def heartbeat_get():
    age = int(time.time() - _heartbeat["at"])
    return {"age": age, "idle": _heartbeat.get("idle", 0) + age, "busy": _heartbeat.get("busy", False)}


def friendly_host():
    try:
        name = (socket.gethostname() or "").split(".")[0].lower()
    except Exception:  # noqa: BLE001
        return ""
    if not name or name == "localhost":
        return ""
    if sys.platform.startswith("win"):
        return name
    return name + ".local"


def lan_ip():
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("10.255.255.255", 1))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:  # noqa: BLE001
        try:
            return socket.gethostbyname(socket.gethostname())
        except Exception:  # noqa: BLE001
            return None
