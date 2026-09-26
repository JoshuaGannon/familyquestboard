#!/usr/bin/env bash
# Restart the kiosk browser inside the running desktop session.
# If there is no desktop session (e.g. the Pi is sitting at the login screen),
# restart the display manager so auto-login brings the board back.
PROJECT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ME="$(id -un)"

# Borrow the session environment from the kiosk browser, or failing that the compositor.
PID="$(pgrep -u "$ME" -f 'user-data-dir=.*fqb-kiosk' | head -1 || true)"
[ -z "$PID" ] && PID="$(pgrep -u "$ME" -x 'labwc|wayfire|lxsession|lxsession-default|openbox|lxpanel' | head -1 || true)"

if [ -n "$PID" ] && [ -r "/proc/$PID/environ" ]; then
  ENVSTR="$(tr '\0' '\n' < "/proc/$PID/environ" | grep -E '^(WAYLAND_DISPLAY|DISPLAY|XDG_RUNTIME_DIR|DBUS_SESSION_BUS_ADDRESS|XDG_SESSION_TYPE)=' | tr '\n' ' ')"
  pkill -u "$ME" -f 'user-data-dir=.*fqb-kiosk' || true
  sleep 2
  pkill -9 -u "$ME" -f 'user-data-dir=.*fqb-kiosk' 2>/dev/null || true
  env $ENVSTR setsid nohup "$PROJECT/pi/kiosk.sh" >/dev/null 2>&1 < /dev/null &
  echo "Kiosk relaunched."
elif [ -n "${WAYLAND_DISPLAY:-}${DISPLAY:-}" ]; then
  setsid nohup "$PROJECT/pi/kiosk.sh" >/dev/null 2>&1 < /dev/null &
  echo "Kiosk launched."
else
  echo "No desktop session - restarting the display manager (auto-login brings the board back)."
  sudo systemctl restart display-manager 2>/dev/null || sudo systemctl restart lightdm 2>/dev/null || sudo reboot
fi
