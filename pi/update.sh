#!/usr/bin/env bash
# Restart the Family Quest Board after new files were copied onto the Pi.
# Normally run for you by install-on-pi.bat / the GitHub auto-pull; also fine by hand:
#   bash ~/FamilyQuestBoard/pi/update.sh
set -e
PROJECT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
chmod +x "$PROJECT/pi/"*.sh
sed -i "s/\r$//" "$PROJECT/pi/"*.sh "$PROJECT/server.py" 2>/dev/null || true

bash "$PROJECT/pi/install-extras.sh" || true

sudo systemctl restart fqb-server.service
echo "Server restarted."

bash "$PROJECT/pi/relaunch-kiosk.sh"
