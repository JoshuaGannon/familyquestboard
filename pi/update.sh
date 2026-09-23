#!/usr/bin/env bash
# Restart the Family Quest Board after new files were copied onto the Pi.
# Normally run for you by install-on-pi.bat; also fine by hand:
#   bash ~/FamilyQuestBoard/pi/update.sh
set -e
PROJECT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
chmod +x "$PROJECT/pi/"*.sh

sudo systemctl restart fqb-server.service
echo "Server restarted."

# Relaunch the kiosk browser inside the desktop session. When run over SSH we
# have no display, so borrow the environment of the running Chromium.
PID="$(pgrep -f 'user-data-dir=.*fqb-kiosk' | head -1 || true)"
if [ -n "$PID" ] && [ -r "/proc/$PID/environ" ]; then
  ENVSTR="$(tr '\0' '\n' < "/proc/$PID/environ" | grep -E '^(WAYLAND_DISPLAY|DISPLAY|XDG_RUNTIME_DIR|DBUS_SESSION_BUS_ADDRESS|XDG_SESSION_TYPE)=' | tr '\n' ' ')"
  pkill -f 'user-data-dir=.*fqb-kiosk' || true
  sleep 1
  env $ENVSTR setsid nohup "$PROJECT/pi/kiosk.sh" >/dev/null 2>&1 < /dev/null &
  echo "Kiosk relaunched."
elif [ -n "${WAYLAND_DISPLAY:-}${DISPLAY:-}" ]; then
  setsid nohup "$PROJECT/pi/kiosk.sh" >/dev/null 2>&1 < /dev/null &
  echo "Kiosk launched."
else
  echo "No kiosk browser is running and no display here - rebooting to bring it up."
  sudo reboot
fi
