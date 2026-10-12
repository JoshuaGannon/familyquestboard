#!/usr/bin/env bash
# Family Quest Board — make v2 the live board (or go back to v1).
#
#   bash v2/pi/go-live.sh           # import v1 → v2, then v2 takes the main address + the wall
#   bash v2/pi/go-live.sh revert    # v1 takes the main address + the wall again (v2 keeps running)
#
# After going live:  https://<name>.duckdns.org  → v2      https://v1.<name>.duckdns.org → v1
# After a revert:    https://<name>.duckdns.org  → v1      https://v2.<name>.duckdns.org → v2
# Both servers keep running either way. Nothing is deleted.
set -euo pipefail
V2="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"; PROJECT="$(dirname "$V2")"
MODE="${1:-live}"; V1PORT=8080; V2PORT="${FQB2_PORT:-8090}"
DOMAIN=""; [ -f "$PROJECT/pi/internet.env" ] && . "$PROJECT/pi/internet.env"

systemctl is-enabled --quiet fqb2-server.service 2>/dev/null || { echo "v2 is not installed yet — run: bash v2/pi/setup-v2.sh"; exit 1; }
# make sure the server is running the code that was just pulled
sudo systemctl restart fqb2-server.service
for _ in $(seq 1 20); do curl -fs "http://localhost:$V2PORT/api/health" >/dev/null 2>&1 && break; sleep 1; done

if [ "$MODE" = live ]; then
  echo "== 1/3  Importing v1 → v2 (Sheet, Pi data, photos, password)"
  curl -fs -X POST "http://localhost:$V2PORT/api/import" -d '{}' >/dev/null || { echo "   could not start the import (is v2 running? journalctl -u fqb2-server -n 20)"; exit 1; }
  for _ in $(seq 1 120); do
    sleep 1
    ST="$(curl -fs "http://localhost:$V2PORT/api/import/status" || true)"
    echo "$ST" | grep -q '"running": true' || break
  done
  echo "$ST" | python3 -c 'import json,sys; s=json.load(sys.stdin); print("\n".join("   "+l for l in s["log"])); sys.exit(0 if s.get("ok") else 1)' || { echo "   Import failed — nothing was switched."; exit 1; }
fi

if [ -n "$DOMAIN" ] && [ -f /etc/caddy/Caddyfile ]; then
  echo "== 2/3  Pointing the internet address at $MODE"
  if [ "$MODE" = live ]; then MAINPORT=$V2PORT; ALT="v1.$DOMAIN"; ALTPORT=$V1PORT; else MAINPORT=$V1PORT; ALT="v2.$DOMAIN"; ALTPORT=$V2PORT; fi
  sudo cp /etc/caddy/Caddyfile "/etc/caddy/Caddyfile.bak-$(date +%s)"
  sudo tee /etc/caddy/Caddyfile >/dev/null <<CADDY
$DOMAIN {
    encode gzip
    reverse_proxy 127.0.0.1:$MAINPORT
}
$ALT {
    encode gzip
    reverse_proxy 127.0.0.1:$ALTPORT
}
CADDY
  sudo systemctl reload caddy
  # each server needs to know its own public name (alert links, message links)
  setenv() { local unit="$1" host="$2"; if grep -q "^Environment=FQB_PUBLIC_HOST=" "/etc/systemd/system/$unit"; then sudo sed -i "s#^Environment=FQB_PUBLIC_HOST=.*#Environment=FQB_PUBLIC_HOST=$host#" "/etc/systemd/system/$unit"; else sudo sed -i "/^ExecStart=/i Environment=FQB_PUBLIC_HOST=$host" "/etc/systemd/system/$unit"; fi; }
  if [ "$MODE" = live ]; then setenv fqb2-server.service "$DOMAIN"; setenv fqb-server.service "v1.$DOMAIN"; else setenv fqb-server.service "$DOMAIN"; setenv fqb2-server.service "v2.$DOMAIN"; fi
  sudo systemctl daemon-reload; sudo systemctl restart fqb-server.service fqb2-server.service
  echo "   https://$DOMAIN → $MODE   ·   https://$ALT → the other one"
else
  echo "== 2/3  (no internet setup found — skipping the address swap)"
fi

echo "== 3/3  Wall screen → $MODE"
bash "$V2/pi/switch-wall.sh" "$([ "$MODE" = live ] && echo v2 || echo v1)"

echo
if [ "$MODE" = live ]; then
  echo "v2 is live. Phones: the usual address now opens v2 (sign in with v2's family password, parents enter the PIN once)."
  echo "To go back:  bash v2/pi/go-live.sh revert"
else
  echo "Back on v1. v2 is still running at :$V2PORT if you want it again:  bash v2/pi/go-live.sh"
fi
