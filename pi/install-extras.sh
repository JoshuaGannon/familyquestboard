#!/usr/bin/env bash
# Keeps the Pi's reliability extras installed. Safe to re-run; called by
# setup-pi.sh and by update.sh (so it also lands via the GitHub auto-pull).
PROJECT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ME="$(id -un)"
chmod +x "$PROJECT/pi/"*.sh

# Cron: watchdog every minute + a fresh browser every night at 3:30
( crontab -l 2>/dev/null | grep -v -e "pi/watchdog.sh" -e "fqb-nightly" ;
  echo "* * * * * $PROJECT/pi/watchdog.sh >/dev/null 2>&1"
  echo "30 3 * * * $PROJECT/pi/relaunch-kiosk.sh >/dev/null 2>&1 # fqb-nightly"
) | crontab -

# wlopm = clean hardware screen off on Wayland (no session crash)
if ! command -v wlopm >/dev/null 2>&1; then
  sudo apt-get install -y -qq wlopm >/dev/null 2>&1 || true
fi

# Hardware watchdog: if the whole Pi locks up, it resets itself in ~15 s
if [ ! -f /etc/systemd/system.conf.d/fqb-watchdog.conf ]; then
  sudo mkdir -p /etc/systemd/system.conf.d
  printf '[Manager]\nRuntimeWatchdogSec=15\nRebootWatchdogSec=2min\n' | sudo tee /etc/systemd/system.conf.d/fqb-watchdog.conf >/dev/null
  sudo systemctl daemon-reexec || true
fi

# Make sure nothing puts up a lock / password screen
for f in /etc/xdg/autostart/light-locker.desktop /etc/xdg/autostart/xscreensaver.desktop; do
  [ -f "$f" ] && { mkdir -p "$HOME/.config/autostart"; cp "$f" "$HOME/.config/autostart/"; echo "Hidden=true" >> "$HOME/.config/autostart/$(basename "$f")"; }
done
command -v raspi-config >/dev/null 2>&1 && sudo raspi-config nonint do_blanking 1 >/dev/null 2>&1 || true
exit 0
