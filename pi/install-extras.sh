#!/usr/bin/env bash
# Keeps the Pi's reliability extras installed. Safe to re-run; called by
# setup-pi.sh and by update.sh (so it also lands via the GitHub auto-pull).
PROJECT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ME="$(id -un)"
chmod +x "$PROJECT/pi/"*.sh

# Cron: watchdog every minute, a fresh browser every hour (when idle),
# GitHub auto-pull every minute (git checkouts only), Drive photo sync every 10 min
( crontab -l 2>/dev/null | grep -v -e "pi/watchdog.sh" -e "fqb-nightly" -e "fqb-hourly" -e "pi/autopull.sh" -e "pi/sync-photos.sh" ;
  echo "* * * * * $PROJECT/pi/watchdog.sh >/dev/null 2>&1"
  echo "5 * * * * $PROJECT/pi/hourly-refresh.sh >/dev/null 2>&1 # fqb-hourly"
  [ -d "$PROJECT/.git" ] && echo "* * * * * $PROJECT/pi/autopull.sh >/dev/null 2>&1"
  echo "*/10 * * * * $PROJECT/pi/sync-photos.sh >/dev/null 2>&1"
) | crontab -

# The server can relaunch the kiosk (Parents -> Settings -> Restart app). Keep a
# server restart from taking the browser down with it.
if [ -f /etc/systemd/system/fqb-server.service ] && [ ! -f /etc/systemd/system/fqb-server.service.d/killmode.conf ]; then
  sudo mkdir -p /etc/systemd/system/fqb-server.service.d
  printf '[Service]\nKillMode=process\n' | sudo tee /etc/systemd/system/fqb-server.service.d/killmode.conf >/dev/null
  sudo systemctl daemon-reload
fi

# wlopm = clean hardware screen off on Wayland (no session crash)
if ! command -v wlopm >/dev/null 2>&1; then
  sudo apt-get install -y -qq wlopm >/dev/null 2>&1 || true
fi

# Keep the HDMI port "connected" even when the monitor sleeps. Some portable
# monitors disconnect entirely on power-off; when they reappear the desktop
# crashes to the login screen. Forcing the connector on prevents that.
CMDLINE=/boot/firmware/cmdline.txt; [ -f "$CMDLINE" ] || CMDLINE=/boot/cmdline.txt
if [ -f "$CMDLINE" ] && ! grep -q "video=HDMI-A-" "$CMDLINE"; then
  for c in /sys/class/drm/card*-HDMI-A-*; do
    [ "$(cat "$c/status" 2>/dev/null)" = "connected" ] || continue
    PORT="${c##*-HDMI-A-}"; MODE="$(head -1 "$c/modes" 2>/dev/null)"; MODE="${MODE:-1920x1080}"
    sudo cp "$CMDLINE" "$CMDLINE.fqb-backup"
    sudo sed -i "1 s|\$| video=HDMI-A-$PORT:${MODE}@60D|" "$CMDLINE"
    echo "Forced HDMI-A-$PORT on (${MODE}) - takes effect after the next reboot"
    break
  done
fi

# Keep system logs across reboots so freezes can be diagnosed afterwards
# (Pi OS ships a volatile journal; this drop-in overrides it)
if [ ! -f /etc/systemd/journald.conf.d/zz-fqb-persistent.conf ]; then
  sudo mkdir -p /etc/systemd/journald.conf.d /var/log/journal
  printf '[Journal]\nStorage=persistent\nSystemMaxUse=200M\n' | sudo tee /etc/systemd/journald.conf.d/zz-fqb-persistent.conf >/dev/null
  sudo systemctl restart systemd-journald || true
fi

# Hardware watchdog: if the whole Pi locks up, it resets itself in ~15 s
if [ ! -f /etc/systemd/system.conf.d/fqb-watchdog.conf ]; then
  sudo mkdir -p /etc/systemd/system.conf.d
  printf '[Manager]\nRuntimeWatchdogSec=15\nRebootWatchdogSec=2min\n' | sudo tee /etc/systemd/system.conf.d/fqb-watchdog.conf >/dev/null
  sudo systemctl daemon-reexec || true
fi

# The board has its own on-screen keyboard; the system one (squeekboard) only
# pops up over it when a touch lands on a text field. Keep it off.
if [ -f /etc/xdg/autostart/squeekboard.desktop ] && [ ! -f "$HOME/.config/autostart/squeekboard.desktop" ]; then
  mkdir -p "$HOME/.config/autostart"
  cp /etc/xdg/autostart/squeekboard.desktop "$HOME/.config/autostart/"
  echo "Hidden=true" >> "$HOME/.config/autostart/squeekboard.desktop"
  pkill -x squeekboard 2>/dev/null || true
fi

# Make sure nothing puts up a lock / password screen
for f in /etc/xdg/autostart/light-locker.desktop /etc/xdg/autostart/xscreensaver.desktop; do
  [ -f "$f" ] && { mkdir -p "$HOME/.config/autostart"; cp "$f" "$HOME/.config/autostart/"; echo "Hidden=true" >> "$HOME/.config/autostart/$(basename "$f")"; }
done
command -v raspi-config >/dev/null 2>&1 && sudo raspi-config nonint do_blanking 1 >/dev/null 2>&1 || true
exit 0
