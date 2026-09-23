#!/usr/bin/env bash
# Turn the display on/off at the hardware level.
#   screen.sh on | off | probe
# Prints the method that worked (wlopm / wlr-randr / vcgencmd / xset) on the last
# line, or "none" and exit 1 if nothing is available.
# "probe" reports what's available without changing anything.
#
# Called by server.py (so the dashboard can power the panel) and usable from cron.
STATE="${1:-on}"
export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"
export WAYLAND_DISPLAY="${WAYLAND_DISPLAY:-wayland-0}"
export DISPLAY="${DISPLAY:-:0}"

# 1. wlopm — Wayland output power management. Best option: a true DPMS off that
#    leaves the output configured, so nothing reflows when it comes back.
if command -v wlopm >/dev/null 2>&1 && wlopm >/dev/null 2>&1; then
  [ "$STATE" = "probe" ] && { echo wlopm; exit 0; }
  if [ "$STATE" = "off" ]; then wlopm --off '*' >/dev/null 2>&1; else wlopm --on '*' >/dev/null 2>&1; fi
  echo wlopm; exit 0
fi

# 2. vcgencmd — works on Pi OS for HDMI outputs on many setups, no compositor needed.
if command -v vcgencmd >/dev/null 2>&1 && vcgencmd display_power >/dev/null 2>&1; then
  [ "$STATE" = "probe" ] && { echo vcgencmd; exit 0; }
  if [ "$STATE" = "off" ]; then vcgencmd display_power 0 >/dev/null 2>&1; else vcgencmd display_power 1 >/dev/null 2>&1; fi
  echo vcgencmd; exit 0
fi

# 3. wlr-randr — disables/enables the output. Works, but the window may reflow on wake.
if command -v wlr-randr >/dev/null 2>&1 && wlr-randr >/dev/null 2>&1; then
  [ "$STATE" = "probe" ] && { echo wlr-randr; exit 0; }
  OUT="$(wlr-randr 2>/dev/null | awk '/^[A-Za-z]/{print $1; exit}')"
  [ -z "$OUT" ] && { echo none; exit 1; }
  if [ "$STATE" = "off" ]; then wlr-randr --output "$OUT" --off >/dev/null 2>&1; else wlr-randr --output "$OUT" --on >/dev/null 2>&1; fi
  echo wlr-randr; exit 0
fi

# 4. xset — X11 sessions.
if command -v xset >/dev/null 2>&1 && xset q >/dev/null 2>&1; then
  [ "$STATE" = "probe" ] && { echo xset; exit 0; }
  if [ "$STATE" = "off" ]; then xset dpms force off; else xset dpms force on; fi
  echo xset; exit 0
fi

echo none
exit 1
