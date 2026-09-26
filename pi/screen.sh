#!/usr/bin/env bash
# Turn the display on/off at the hardware level.
#   screen.sh on | off | probe
# Prints the method that worked (wlopm / vcgencmd / xset) on the last line,
# or "none" and exit 1 if nothing safe is available (the app then just shows
# a black screen instead).
#
# Called by server.py (so the dashboard can power the panel) and usable from cron.
#
# NOTE: wlr-randr --off is deliberately NOT used. Disabling the only output can
# crash the Wayland session, which drops the Pi to the login screen.
STATE="${1:-on}"
export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"
# Find the real Wayland socket (labwc is not always wayland-0)
if [ -z "${WAYLAND_DISPLAY:-}" ] || [ ! -S "$XDG_RUNTIME_DIR/$WAYLAND_DISPLAY" ]; then
  for s in "$XDG_RUNTIME_DIR"/wayland-[0-9]; do
    [ -S "$s" ] && { WAYLAND_DISPLAY="$(basename "$s")"; break; }
  done
fi
export WAYLAND_DISPLAY="${WAYLAND_DISPLAY:-wayland-0}"
export DISPLAY="${DISPLAY:-:0}"

# 1. wlopm — Wayland output power management. A true DPMS off that leaves the
#    output configured, so the session and the kiosk window are untouched.
if command -v wlopm >/dev/null 2>&1 && wlopm >/dev/null 2>&1; then
  [ "$STATE" = "probe" ] && { echo wlopm; exit 0; }
  if [ "$STATE" = "off" ]; then wlopm --off '*' >/dev/null 2>&1; else wlopm --on '*' >/dev/null 2>&1; fi
  echo wlopm; exit 0
fi

# 2. vcgencmd — only on the legacy (non-KMS) driver. Under KMS it reports
#    display_power=-1 and silently does nothing, so we skip it there.
if command -v vcgencmd >/dev/null 2>&1; then
  VP="$(vcgencmd display_power 2>/dev/null)"
  if [ -n "$VP" ] && ! echo "$VP" | grep -q -- "-1"; then
    [ "$STATE" = "probe" ] && { echo vcgencmd; exit 0; }
    if [ "$STATE" = "off" ]; then vcgencmd display_power 0 >/dev/null 2>&1; else vcgencmd display_power 1 >/dev/null 2>&1; fi
    echo vcgencmd; exit 0
  fi
fi

# 3. xset — X11 sessions.
if command -v xset >/dev/null 2>&1 && xset q >/dev/null 2>&1; then
  [ "$STATE" = "probe" ] && { echo xset; exit 0; }
  if [ "$STATE" = "off" ]; then xset dpms force off; else xset dpms force on; fi
  echo xset; exit 0
fi

echo none
exit 1
