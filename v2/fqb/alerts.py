"""Push alerts (ntfy) and the family messages."""
import hmac
import json
import os
import secrets
import time
import urllib.request
from urllib.parse import quote

from . import access, db

MSG_PUSH_LIMIT = 3
MSG_PUSH_WINDOW = 60
_msg_push_times = {}
QUICK_REPLIES = [("yes", "👍 Yes"), ("no", "👎 Not now"), ("omw", "🏃 On my way")]


def public_base():
    host = os.environ.get("FQB_PUBLIC_HOST", "").strip()
    prefix = os.environ.get("FQB_PUBLIC_PREFIX", "").strip().rstrip("/")
    return (f"https://{host}{prefix}") if host else ""


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


def notify(kind, title, message, go="go/parent/queue", force=False):
    """Family-wide alert (quest done, help, reward, streak). Honours the notify_events setting."""
    cfg = db.config()
    topic = str(cfg.get("notify_ntfy_topic", "")).strip()
    kinds = [k.strip().lower() for k in str(cfg.get("notify_events") or "quest,help,reward,streak").split(",")]
    if not topic:
        return False, "no topic"
    if not force and kind not in kinds:
        return False, "off"
    base = public_base()
    tags = {"help": "raising_hand", "reward": "gift", "streak": "fire", "quest": "white_check_mark", "test": "tada"}.get(kind, "")
    return ntfy_send(topic, title, message, "high" if kind == "help" else "default", tags, f"{base}/#{go}" if base else "")


def _msg_sig(mid, code, as_name=""):
    return hmac.new(access.secret().encode(), f"{mid}|{code}|{as_name}".encode(), "sha256").hexdigest()[:24]


def msg_post(body):
    text = str(body.get("text", "")).strip()[:500]
    frm = str(body.get("from", "")).strip()[:40]
    if not text or not frm:
        raise ValueError("empty message")
    msg = {"id": secrets.token_hex(6), "from": frm, "to": str(body.get("to", "") or "all")[:40], "text": text,
           "kind": "kid" if body.get("kind") == "kid" else "parent", "at": db.now_iso()}
    if body.get("reply_to"):
        msg["reply_to"] = str(body.get("reply_to"))[:20]
    db.kv_op({"op": "push", "key": "messages", "value": msg})
    pushed, limited, detail = False, False, ""
    targets = body.get("targets")
    targets = [x for x in (targets if isinstance(targets, list) else []) if isinstance(x, dict) and str(x.get("topic", "")).strip()][:6]
    if targets:
        now = time.time()
        recent = [t for t in _msg_push_times.get(frm, []) if now - t < MSG_PUSH_WINDOW]
        if len(recent) >= MSG_PUSH_LIMIT:
            limited = True
        else:
            recent.append(now)
            _msg_push_times[frm] = recent
            base = public_base()
            full = str(body.get("fulltext", "TRUE")).upper() != "FALSE"
            results = []
            for tg in targets:
                as_name = str(tg.get("as") or "Parent")[:40]
                title = f"💬 {frm}" + (" → Family" if msg["to"] in ("family", "parents", "all") else "")
                cid = str(body.get("cid", "")).strip()[:100]
                click = (base + "/#chat/" + quote(cid)) if (base and cid) else ((base + "/#messages") if base else "")
                q = lambda code: f"{base}/api/msg-quick?m={msg['id']}&r={code}&a={quote(as_name)}&s={_msg_sig(msg['id'], code, as_name)}"  # noqa: E731
                actions = [{"action": "http", "label": label, "method": "POST", "clear": True, "url": q(code)}
                           for code, label in QUICK_REPLIES] if base else None
                ok, why = ntfy_send(tg.get("topic"), title, text if full else "New message — tap to read it", "high", "", click, actions)
                results.append(ok)
                detail = why
            pushed = any(results)
    return {"ok": True, "id": msg["id"], "pushed": pushed, "limited": limited, "detail": detail}


def msg_quick(mid, code, sig, as_name=""):
    label = dict(QUICK_REPLIES).get(code)
    as_name = (as_name or "")[:40]
    if not label or not hmac.compare_digest(sig or "", _msg_sig(mid, code, as_name)):
        return False, "bad link"
    msgs = db.kv_get("messages", []) or []
    orig = next((m for m in msgs if isinstance(m, dict) and m.get("id") == mid), None)
    if not orig:
        return False, "message not found"
    who = as_name or "Parent"
    if any(isinstance(m, dict) and m.get("reply_to") == mid and m.get("quick") == code and m.get("from") == who for m in msgs):
        return True, "already sent"
    reply = {"id": secrets.token_hex(6), "from": who, "to": orig.get("from", ""), "text": label, "kind": "parent",
             "reply_to": mid, "quick": code, "at": db.now_iso()}
    db.kv_op({"op": "push", "key": "messages", "value": reply})
    return True, "sent"
