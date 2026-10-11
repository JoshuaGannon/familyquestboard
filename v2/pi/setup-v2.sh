#!/usr/bin/env bash
# Family Quest Board v2 — install on the Pi NEXT TO v1 (v1 keeps running on 8080).
#   cd ~/FamilyQuestBoard && bash v2/pi/setup-v2.sh
# Re-running is safe. v2 gets: its own service on port 8090, its own database in
# v2/data, the same photos folder as v1, and (if v1's internet setup exists) its own
# address https://v2.<your>.duckdns.org
set -euo pipefail
V2="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROJECT="$(dirname "$V2")"
USER_NAME="${SUDO_USER:-$USER}"
PORT="${FQB2_PORT:-8090}"
PHOTOS="${FQB_PHOTOS:-$PROJECT/photos}"
PUBLIC=""
if [ -f "$PROJECT/pi/internet.env" ]; then . "$PROJECT/pi/internet.env"; PUBLIC="v2.${DOMAIN:-}"; fi

echo "== Family Quest Board v2"
echo "   folder : $V2"
echo "   port   : $PORT"
echo "   photos : $PHOTOS"
[ -n "$PUBLIC" ] && echo "   public : https://$PUBLIC"

sudo tee /etc/systemd/system/fqb2-server.service >/dev/null <<UNIT
[Unit]
Description=Family Quest Board v2 server
After=network.target

[Service]
Type=simple
User=$USER_NAME
WorkingDirectory=$V2
Environment=FQB2_PORT=$PORT
Environment=FQB2_PHOTOS=$PHOTOS
${PUBLIC:+Environment=FQB_PUBLIC_HOST=$PUBLIC}
ExecStart=/usr/bin/python3 $V2/server.py
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
UNIT
sudo systemctl daemon-reload
sudo systemctl enable --now fqb2-server.service
sleep 2
if curl -fs "http://localhost:$PORT/api/health" >/dev/null; then echo "   v2 is up: http://$(hostname).local:$PORT"; else echo "   (server not answering yet — check: journalctl -u fqb2-server -n 30)"; fi

# Internet: add a v2.<domain> site to Caddy if v1's internet setup is in place
if [ -n "$PUBLIC" ] && [ -f /etc/caddy/Caddyfile ] && ! grep -q "$PUBLIC" /etc/caddy/Caddyfile; then
  sudo tee -a /etc/caddy/Caddyfile >/dev/null <<CADDY

$PUBLIC {
    encode gzip
    reverse_proxy 127.0.0.1:$PORT
}
CADDY
  sudo systemctl reload caddy && echo "   Caddy: https://$PUBLIC → v2 (DuckDNS resolves sub-names on its own)"
fi

echo
echo "Done. Phones on home Wi-Fi: http://$(hostname).local:$PORT"
echo "To put v2 on the wall screen:  bash v2/pi/switch-wall.sh v2   (and ... v1 to go back)"
