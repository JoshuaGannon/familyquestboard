#!/usr/bin/env bash
# Family Quest Board watchdog — runs every minute from cron (installed by
# pi/install-extras.sh). Fixes the board on its own instead of needing a reboot:
#   * server not answering          -> restart the server service
#   * browser gone / login screen   -> relaunch the kiosk / restart auto-login
#   * page frozen (no heartbeat)    -> relaunch the kiosk browser
#   * 3 rescues within 30 minutes   -> reboot the Pi
PROJECT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="$(grep -o 'FQB_PORT=[0-9]*' /etc/systemd/system/fqb-server.service 2>/dev/null | cut -d= -f2)"
PORT="${PORT:-8080}"
STATE="$PROJECT/pi/.watchdog"; mkdir -p "$STATE"
LOG="$PROJECT/pi/watchdog.log"
ME="$(id -un)"
now=$(date +%s)
log() { echo "$(date '+%F %T') $*" >> "$LOG"; tail -n 300 "$LOG" > "$LOG.tmp" 2>/dev/null && mv "$LOG.tmp" "$LOG"; }

# Give things time to settle after boot or after we just acted
uptime_s=$(cut -d. -f1 /proc/uptime)
[ "$uptime_s" -lt 240 ] && exit 0
last_action=$(cat "$STATE/last_action" 2>/dev/null || echo 0)
[ $((now - last_action)) -lt 300 ] && exit 0
# Don't fight an update that's in progress
pgrep -f 'pi/update.sh' >/dev/null && exit 0

rescue() {   # $1 = what happened, $2 = command
  log "$1"
  echo "$now" >> "$STATE/rescues"
  recent=$(awk -v t=$((now - 1800)) '$1 > t' "$STATE/rescues" | wc -l)
  awk -v t=$((now - 1800)) '$1 > t' "$STATE/rescues" > "$STATE/rescues.tmp" && mv "$STATE/rescues.tmp" "$STATE/rescues"
  echo "$now" > "$STATE/last_action"
  if [ "$recent" -ge 3 ]; then
    log "3 rescues in 30 min - rebooting"
    : > "$STATE/rescues"
    sudo reboot
    exit 0
  fi
  eval "$2" >> "$LOG" 2>&1
  exit 0
}

# 1. Server
if ! curl -fs -m 8 "http://localhost:$PORT/api/health" >/dev/null 2>&1; then
  sleep 10
  curl -fs -m 8 "http://localhost:$PORT/api/health" >/dev/null 2>&1 || \
    rescue "server not answering - restarting it" "sudo systemctl restart fqb-server.service"
fi

# 2. Browser missing (crashed, or the Pi fell back to the login screen)
if ! pgrep -u "$ME" -f 'user-data-dir=.*fqb-kiosk' >/dev/null; then
  missing_since=$(cat "$STATE/missing_since" 2>/dev/null || echo "$now")
  echo "$missing_since" > "$STATE/missing_since"
  [ $((now - missing_since)) -ge 120 ] && { rm -f "$STATE/missing_since"; rescue "kiosk browser not running - relaunching" "bash '$PROJECT/pi/relaunch-kiosk.sh'"; }
  exit 0
fi
rm -f "$STATE/missing_since"

# 3. Page frozen: the wall's browser checks in every 30 s
age=$(curl -fs -m 8 "http://localhost:$PORT/api/heartbeat" 2>/dev/null | sed -n 's/.*"age": *\([0-9]*\).*/\1/p')
if [ -n "$age" ] && [ "$age" -gt 300 ]; then
  rescue "page frozen (no heartbeat for ${age}s) - relaunching kiosk" "bash '$PROJECT/pi/relaunch-kiosk.sh'"
fi
exit 0
