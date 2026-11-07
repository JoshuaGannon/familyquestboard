"""Sounds on the Pi's own speaker (HDMI monitor or the jack) and the system volume.

The wave files are generated here (no assets to ship). Playback and mixer control go through
pi/audio.sh, which knows PipeWire (wpctl), PulseAudio (pactl/paplay) and plain ALSA (amixer/aplay).
"""
import json
import math
import os
import struct
import subprocess
import sys
import wave

from . import pi

SOUNDS = {
    "chime": "Two-note chime",
    "bell": "Soft bell",
    "alert": "Three beeps",
    "buzz": "Low buzz",
    "ding": "Single ding",
}
RATE = 44100
_dir = None
AUDIO_SH = os.path.join(pi.PI_DIR, "audio.sh")


def init(data_dir):
    global _dir
    _dir = os.path.join(data_dir, "sounds")
    os.makedirs(_dir, exist_ok=True)


def _tone(freq, dur, vol=0.5, shape="sine", attack=0.01, decay=None):
    n = int(RATE * dur)
    decay = dur if decay is None else decay
    out = []
    for i in range(n):
        t = i / RATE
        env = min(1.0, t / attack) if attack else 1.0
        env *= math.exp(-3.0 * t / decay)
        if shape == "square":
            v = 1.0 if math.sin(2 * math.pi * freq * t) >= 0 else -1.0
        else:
            v = math.sin(2 * math.pi * freq * t) + 0.3 * math.sin(4 * math.pi * freq * t)
        out.append(v * env * vol)
    return out


def _mix(parts):
    """parts: [(offset_sec, samples)] -> one list of samples."""
    length = max(int(o * RATE) + len(s) for o, s in parts)
    buf = [0.0] * length
    for o, s in parts:
        k = int(o * RATE)
        for i, v in enumerate(s):
            buf[k + i] += v
    peak = max(1.0, max(abs(v) for v in buf))
    return [v / peak * 0.9 for v in buf]


def _render(name):
    if name == "chime":
        return _mix([(0.0, _tone(880, 0.5)), (0.18, _tone(1320, 0.7))])
    if name == "bell":
        return _mix([(0.0, _tone(1047, 1.4, 0.6, decay=0.9)), (0.0, _tone(2093, 1.0, 0.15, decay=0.4))])
    if name == "alert":
        return _mix([(i * 0.22, _tone(1500, 0.14, 0.6, decay=0.12)) for i in range(3)])
    if name == "buzz":
        return _mix([(0.0, _tone(110, 0.45, 0.5, "square", decay=0.6)), (0.0, _tone(165, 0.45, 0.25, "square", decay=0.6))])
    return _mix([(0.0, _tone(1760, 0.6, 0.6, decay=0.5))])


def path(name):
    name = name if name in SOUNDS else "chime"
    p = os.path.join(_dir, name + ".wav")
    if not os.path.exists(p):
        data = _render(name)
        with wave.open(p, "wb") as w:
            w.setnchannels(1)
            w.setsampwidth(2)
            w.setframerate(RATE)
            w.writeframes(b"".join(struct.pack("<h", int(max(-1, min(1, v)) * 32767)) for v in data))
    return p


def _sh(*args, timeout=15):
    if not os.path.exists(AUDIO_SH) or not sys.platform.startswith("linux"):
        return False, "Only available on the Raspberry Pi"
    try:
        r = subprocess.run(["bash", AUDIO_SH, *args], capture_output=True, text=True, timeout=timeout, cwd=pi.PROJECT)
        out = (r.stdout or "").strip()
        return r.returncode == 0, out or (r.stderr or "").strip()
    except Exception as e:  # noqa: BLE001
        return False, str(e)


def probe():
    ok, out = _sh("probe")
    info = {"supported": ok, "sounds": SOUNDS}
    if ok:
        try:
            info.update(json.loads(out))
        except ValueError:
            info["raw"] = out
    else:
        info["error"] = out
    return info


def play(name, volume=None):
    if volume is not None:
        set_volume(volume)
    return _sh("play", path(name))


def set_volume(pct):
    pct = max(0, min(100, int(pct)))
    return _sh("volume", str(pct))


def set_sink(sink):
    return _sh("sink", str(sink)[:80])
