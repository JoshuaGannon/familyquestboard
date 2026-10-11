#!/usr/bin/env bash
# Point the wall screen at v1 or v2 and restart the kiosk browser.
#   bash v2/pi/switch-wall.sh v2     bash v2/pi/switch-wall.sh v1
set -e
V2="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"; PROJECT="$(dirname "$V2")"
case "${1:-}" in
  v1) PORT=8080 ;; v2) PORT="${FQB2_PORT:-8090}" ;;
  *) echo "usage: $0 v1|v2"; exit 1 ;;
esac
KIOSK="$PROJECT/pi/kiosk.sh"
if [ "$1" = v1 ]; then rm -f "$PROJECT/pi/wall.env"; else echo "URL=\"http://localhost:$PORT\"" > "$PROJECT/pi/wall.env"; fi
echo "Wall now points at $1 (port $PORT). Restarting the kiosk…"
pkill -f "user-data-dir=.*fqb-kiosk" 2>/dev/null || true
sleep 1
( setsid nohup bash "$KIOSK" >/dev/null 2>&1 & )
echo "Done."
