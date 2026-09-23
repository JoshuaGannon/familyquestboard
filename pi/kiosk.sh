#!/usr/bin/env bash
# Launches the dashboard full-screen in Chromium kiosk mode.
# setup-pi.sh fills in URL and CHROMIUM and registers this to run at login.
URL="http://localhost:8080"
CHROMIUM="chromium"

# Wait for the local server to answer (up to 60 s)
for _ in $(seq 1 60); do
  if curl -fs "$URL/api/health" >/dev/null 2>&1; then break; fi
  sleep 1
done

# Hide the mouse cursor on X11 sessions (harmless on Wayland)
command -v unclutter >/dev/null 2>&1 && unclutter -idle 0.5 -root &

# Clear the "Chromium didn't shut down correctly" nag after a power cut
PROFILE="$HOME/.config/fqb-kiosk"
mkdir -p "$PROFILE"
sed -i 's/"exited_cleanly":false/"exited_cleanly":true/; s/"exit_type":"Crashed"/"exit_type":"Normal"/' "$PROFILE/Default/Preferences" 2>/dev/null || true

exec "$CHROMIUM" \
  --user-data-dir="$PROFILE" \
  --kiosk "$URL" \
  --noerrdialogs \
  --disable-infobars \
  --disable-session-crashed-bubble \
  --disable-features=TranslateUI \
  --overscroll-history-navigation=0 \
  --disable-pinch \
  --touch-events=enabled \
  --autoplay-policy=no-user-gesture-required \
  --check-for-update-interval=31536000 \
  --password-store=basic
