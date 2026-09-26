#!/usr/bin/env bash
# Family Quest Board — Raspberry Pi one-shot setup
# -------------------------------------------------
# Tested against Raspberry Pi OS (Bookworm / Trixie, desktop edition) on a Pi 4/5.
#
#   1. Flash Raspberry Pi OS (64-bit, with desktop) with Raspberry Pi Imager.
#      In the Imager settings: set username, Wi-Fi, and enable SSH.
#   2. Copy this whole project folder to the Pi, e.g. /home/<user>/FamilyQuestBoard
#      (from Windows: scp -r "C:\Users\YOU\Family Quest Board" pi@raspberrypi.local:FamilyQuestBoard)
#   3. On the Pi:   cd ~/FamilyQuestBoard && bash pi/setup-pi.sh
#   4. Reboot. It boots straight into the dashboard.
#
# Re-running the script is safe.

set -euo pipefail
PROJECT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
USER_NAME="${SUDO_USER:-$USER}"
HOME_DIR="$(getent passwd "$USER_NAME" | cut -d: -f6)"
PORT="${FQB_PORT:-8080}"
PHOTOS="${FQB_PHOTOS:-$PROJECT/photos}"

echo "== Family Quest Board setup =="
echo "   project : $PROJECT"
echo "   user    : $USER_NAME"
echo "   photos  : $PHOTOS"

# ---------------------------------------------------------------- packages
echo "== Installing packages"
sudo apt-get update -qq
PKGS="python3 python3-pil rclone unclutter avahi-daemon curl git fonts-noto-color-emoji"
# wlopm gives the cleanest screen on/off on Wayland (true DPMS, no output reconfigure)
apt-cache show wlopm >/dev/null 2>&1 && PKGS="$PKGS wlopm"
if apt-cache show chromium >/dev/null 2>&1; then PKGS="$PKGS chromium"; else PKGS="$PKGS chromium-browser"; fi
if apt-cache show wlr-randr >/dev/null 2>&1; then PKGS="$PKGS wlr-randr"; fi
sudo apt-get install -y -qq $PKGS

CHROMIUM="$(command -v chromium || command -v chromium-browser)"
mkdir -p "$PHOTOS"
sed -i "s/\r$//" "$PROJECT/pi/"*.sh "$PROJECT/server.py" 2>/dev/null || true   # in case they came via Windows
chmod +x "$PROJECT/pi/"*.sh

# ---------------------------------------------------------------- server service
echo "== Installing the photo/dashboard server as a service"
sudo tee /etc/systemd/system/fqb-server.service >/dev/null <<EOF
[Unit]
Description=Family Quest Board local server
After=network.target

[Service]
Type=simple
User=$USER_NAME
WorkingDirectory=$PROJECT
Environment=FQB_PORT=$PORT
Environment=FQB_PHOTOS=$PHOTOS
ExecStart=/usr/bin/python3 $PROJECT/server.py
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF
sudo systemctl daemon-reload
sudo systemctl enable --now fqb-server.service

# mDNS so phones can use http://<hostname>.local:PORT instead of the IP
sudo systemctl enable --now avahi-daemon >/dev/null 2>&1 || true

# ---------------------------------------------------------------- kiosk autostart
echo "== Configuring kiosk autostart"
KIOSK="$PROJECT/pi/kiosk.sh"
sed -i "s#^URL=.*#URL=\"http://localhost:$PORT\"#" "$KIOSK"
sed -i "s#^CHROMIUM=.*#CHROMIUM=\"$CHROMIUM\"#" "$KIOSK"

# labwc (Pi OS Trixie / newer Bookworm on Pi 5)
mkdir -p "$HOME_DIR/.config/labwc"
grep -q "kiosk.sh" "$HOME_DIR/.config/labwc/autostart" 2>/dev/null || echo "$KIOSK &" >> "$HOME_DIR/.config/labwc/autostart"

# wayfire (older Bookworm)
if [ -f "$HOME_DIR/.config/wayfire.ini" ] || command -v wayfire >/dev/null 2>&1; then
  mkdir -p "$HOME_DIR/.config"
  touch "$HOME_DIR/.config/wayfire.ini"
  if ! grep -q "kiosk.sh" "$HOME_DIR/.config/wayfire.ini"; then
    grep -q "^\[autostart\]" "$HOME_DIR/.config/wayfire.ini" || printf "\n[autostart]\n" >> "$HOME_DIR/.config/wayfire.ini"
    sed -i "/^\[autostart\]/a fqb = $KIOSK" "$HOME_DIR/.config/wayfire.ini"
  fi
fi

# X11 / LXDE fallback
mkdir -p "$HOME_DIR/.config/lxsession/LXDE-pi"
grep -q "kiosk.sh" "$HOME_DIR/.config/lxsession/LXDE-pi/autostart" 2>/dev/null || echo "@$KIOSK" >> "$HOME_DIR/.config/lxsession/LXDE-pi/autostart"
chown -R "$USER_NAME":"$USER_NAME" "$HOME_DIR/.config"

# If the Pi shares a multi-port USB-C charger with the monitor it gets 5V/3A
# rather than 5A; this stops the spurious "low power supply" warning.
CONF=/boot/firmware/config.txt; [ -f "$CONF" ] || CONF=/boot/config.txt
if [ -f "$CONF" ] && ! grep -q "^usb_max_current_enable" "$CONF"; then
  echo "usb_max_current_enable=1" | sudo tee -a "$CONF" >/dev/null
fi

# Auto-login to desktop + never blank the screen (the app runs its own schedule)
if command -v raspi-config >/dev/null 2>&1; then
  sudo raspi-config nonint do_boot_behaviour B4 || true
  sudo raspi-config nonint do_blanking 1 || true
fi

# ---------------------------------------------------------------- auto-update from GitHub
if [ -d "$PROJECT/.git" ]; then
  echo "== Auto-update: checking GitHub every minute"
  PULL_LINE="* * * * * $PROJECT/pi/autopull.sh >/dev/null 2>&1"
  ( crontab -u "$USER_NAME" -l 2>/dev/null | grep -v "autopull.sh"; echo "$PULL_LINE" ) | crontab -u "$USER_NAME" -
fi

# ---------------------------------------------------------------- reliability
echo "== Watchdog, nightly browser refresh, clean screen-off"
sudo -u "$USER_NAME" bash "$PROJECT/pi/install-extras.sh" || true

# ---------------------------------------------------------------- photo sync
echo "== Photo sync (Google Drive → $PHOTOS)"
CRON_LINE="*/10 * * * * $PROJECT/pi/sync-photos.sh >/dev/null 2>&1"
( crontab -u "$USER_NAME" -l 2>/dev/null | grep -v "sync-photos.sh"; echo "$CRON_LINE" ) | crontab -u "$USER_NAME" -
sed -i "s#^PHOTOS=.*#PHOTOS=\"$PHOTOS\"#" "$PROJECT/pi/sync-photos.sh"

HOSTNAME_LOCAL="$(hostname).local"
IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
cat <<EOF

== Done. Reboot and it opens full screen on its own:   sudo reboot

   Phones / other computers on the same Wi-Fi:
        http://$HOSTNAME_LOCAL:$PORT      (by name — iPhone, Mac, Windows 10+, most Android)
        http://$IP:$PORT       (always works)
   Add it to the phone's home screen for an app icon.

   Make sure dashboard/config.js has your Apps Script URL, otherwise the Pi
   starts in DEMO mode (you can also paste it under Parents → Settings on the
   touchscreen).

== Two optional things left:

 1. Google Drive photo sync (one time, interactive):
        rclone config
      → n (new remote), name: gdrive, storage: drive, leave client id/secret blank,
        scope: 1 (full) or 2 (read-only), auto config: n (headless) — it prints a
        command to run on your Windows PC that gives you a token to paste back.
      Then test:   $PROJECT/pi/sync-photos.sh
      Photos in your Drive "Wall Photos" folder land in $PHOTOS every 10 minutes.

 2. Nothing! The screen schedule (photos / dim clock / screen off) is set on the
    wall itself: Parents -> PIN -> Display. The server powers the panel through
    pi/screen.sh, and the Display pane tells you which method it's using.
    Test it by hand any time with:
        $PROJECT/pi/screen.sh off     # and: screen.sh on

Now:  sudo reboot
EOF
