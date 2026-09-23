#!/usr/bin/env bash
# Mirrors the Google Drive "Wall Photos" folder to the Pi's local photos folder.
# Runs every 10 minutes from cron (installed by setup-pi.sh).
# Requires a one-time `rclone config` with a remote named "gdrive".
REMOTE="gdrive:Wall Photos"
PHOTOS="$HOME/FamilyQuestBoard/photos"

command -v rclone >/dev/null 2>&1 || exit 0
rclone listremotes 2>/dev/null | grep -q '^gdrive:' || exit 0

# --exclude keeps the local resize cache; deleting in Drive deletes here too
rclone sync "$REMOTE" "$PHOTOS" \
  --exclude "_cache/**" \
  --include "*.{jpg,jpeg,png,webp,gif,heic,heif,JPG,JPEG,PNG,WEBP,GIF,HEIC,HEIF}" \
  --fast-list --transfers 4 --quiet
