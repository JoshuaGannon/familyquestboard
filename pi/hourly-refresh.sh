#!/usr/bin/env bash
# Hourly fresh start for the wall browser (cron, installed by install-extras.sh).
# A full browser restart frees all its memory - a page reload can't, and a
# crashed page can't reload itself. Waits (up to ~20 min) while someone is
# using the board, so it never yanks the screen out from under anyone.
PROJECT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="$(grep -o 'FQB_PORT=[0-9]*' /etc/systemd/system/fqb-server.service 2>/dev/null | cut -d= -f2)"; PORT="${PORT:-8080}"
STATE="$PROJECT/pi/.watchdog"; mkdir -p "$STATE"
now=$(date +%s)
paused=$(cat "$STATE/paused_until" 2>/dev/null || echo 0)
[ "$now" -lt "${paused:-0}" ] && exit 0            # closed on purpose from Parents -> Settings
# Screen is scheduled off (night): skip. The slideshow isn't running, so memory
# stays flat, and restarting would light the screen up in the middle of the night.
curl -fs -m 5 "http://localhost:$PORT/api/display" 2>/dev/null | grep -q '"state": "off"' && exit 0
for _ in $(seq 1 20); do
  hb="$(curl -fs -m 5 "http://localhost:$PORT/api/heartbeat" 2>/dev/null)"
  idle=$(echo "$hb" | sed -n 's/.*"idle": *\([0-9]*\).*/\1/p')
  busy=$(echo "$hb" | grep -c '"busy": true')
  if [ "$busy" = "0" ] && [ "${idle:-9999}" -ge 120 ]; then break; fi
  sleep 60
done
echo "$(date +%s)" > "$STATE/last_action"          # the watchdog gives it a few minutes to come back
echo "$(date '+%F %T') hourly refresh" >> "$PROJECT/pi/watchdog.log"
bash "$PROJECT/pi/relaunch-kiosk.sh" >> "$PROJECT/pi/watchdog.log" 2>&1
