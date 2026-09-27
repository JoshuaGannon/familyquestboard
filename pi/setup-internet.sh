#!/usr/bin/env bash
# Family Quest Board — reach the board from anywhere (https://<name>.duckdns.org)
# ---------------------------------------------------------------------------
# What this sets up on the Pi:
#   * Caddy: a tiny web server that gets a free HTTPS certificate for your
#     DuckDNS name automatically and forwards traffic to the board (port 8080).
#   * A cron job that tells DuckDNS your home IP every 5 minutes, so the name
#     keeps working when your ISP changes it.
#   * The board itself asks for the family password (Parents -> Settings ->
#     Internet access) on every connection that comes in from outside.
#
# On your router, forward ONE port: TCP 443 -> this Pi's IP, port 443.
#
# Usage:  bash pi/setup-internet.sh <name>.duckdns.org <duckdns-token>
# Re-running is safe.
set -euo pipefail
PROJECT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENVF="$PROJECT/pi/internet.env"

DOMAIN="${1:-}"; TOKEN="${2:-}"
if [ -z "$DOMAIN" ] && [ -f "$ENVF" ]; then . "$ENVF"; fi
[ -n "${DOMAIN:-}" ] || { read -rp "DuckDNS domain (e.g. familyquestboard.duckdns.org): " DOMAIN; }
[ -n "${TOKEN:-}" ] || { read -rp "DuckDNS token (from the top of duckdns.org): " TOKEN; }
DOMAIN="${DOMAIN#http://}"; DOMAIN="${DOMAIN#https://}"; DOMAIN="${DOMAIN%/}"
SUB="${DOMAIN%%.duckdns.org}"
printf 'DOMAIN=%s\nTOKEN=%s\n' "$DOMAIN" "$TOKEN" > "$ENVF"; chmod 600 "$ENVF"

echo "== Installing Caddy"
sudo apt-get update -qq
sudo apt-get install -y -qq caddy curl

echo "== Configuring Caddy for https://$DOMAIN"
sudo tee /etc/caddy/Caddyfile >/dev/null <<EOF
$DOMAIN {
    encode gzip
    reverse_proxy 127.0.0.1:${FQB_PORT:-8080}
}
EOF
sudo systemctl enable caddy >/dev/null 2>&1 || true
sudo systemctl restart caddy

echo "== Telling the board its public name"
if ! grep -q "FQB_PUBLIC_HOST" /etc/systemd/system/fqb-server.service 2>/dev/null; then
  sudo sed -i "/^Environment=FQB_PORT/a Environment=FQB_PUBLIC_HOST=$DOMAIN" /etc/systemd/system/fqb-server.service
else
  sudo sed -i "s#^Environment=FQB_PUBLIC_HOST=.*#Environment=FQB_PUBLIC_HOST=$DOMAIN#" /etc/systemd/system/fqb-server.service
fi
sudo systemctl daemon-reload
sudo systemctl restart fqb-server.service

echo "== DuckDNS updater (every 5 minutes)"
cat > "$PROJECT/pi/duckdns.sh" <<EOF
#!/usr/bin/env bash
curl -fs "https://www.duckdns.org/update?domains=$SUB&token=$TOKEN&ip=" >/dev/null 2>&1
EOF
chmod 700 "$PROJECT/pi/duckdns.sh"
LINE="*/5 * * * * $PROJECT/pi/duckdns.sh"
( crontab -l 2>/dev/null | grep -v "duckdns.sh"; echo "$LINE" ) | crontab -
"$PROJECT/pi/duckdns.sh" && echo "   DuckDNS updated."

PUB="$(curl -fs https://api.ipify.org 2>/dev/null || echo '?')"
LAN="$(hostname -I 2>/dev/null | awk '{print $1}')"
cat <<EOF

== Done on the Pi. Two things left:

 1. On the router: forward TCP port 443 -> $LAN port 443
    (the setting is usually called Port Forwarding / Virtual Server / NAT).
    Your public IP right now is $PUB — DuckDNS should show the same.

 2. On the board: Parents -> Settings -> Internet access -> set a password.

 Then open https://$DOMAIN on your phone (off Wi-Fi to test). The first
 visit can take ~30 s while Caddy fetches the certificate.

 Troubleshooting:  sudo journalctl -u caddy -n 40 --no-pager
EOF
