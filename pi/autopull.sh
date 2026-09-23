#!/usr/bin/env bash
# Runs every minute from cron (installed by setup-pi.sh when the project is a
# git checkout). If GitHub has new commits, pull them and relaunch the board.
PROJECT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT" || exit 0
[ -d .git ] || exit 0
BRANCH="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo main)"
git fetch -q origin "$BRANCH" 2>/dev/null || exit 0
LOCAL="$(git rev-parse HEAD)"; REMOTE="$(git rev-parse "origin/$BRANCH")"
[ "$LOCAL" = "$REMOTE" ] && exit 0
git reset -q --hard "origin/$BRANCH"
chmod +x pi/*.sh
echo "$(date '+%F %T') updated $LOCAL -> $REMOTE" >> "$PROJECT/pi/autopull.log"
bash "$PROJECT/pi/update.sh" >> "$PROJECT/pi/autopull.log" 2>&1
