#!/usr/bin/env bash
# Sound on the Pi, used by v2 (Parents → Settings → Board alerts & sounds).
#   audio.sh probe            -> JSON: {"backend":..,"volume":..,"sinks":[{"id":..,"name":..,"default":true}]}
#   audio.sh volume <0-100>   -> set the system volume
#   audio.sh play <file.wav>  -> play a wave file on the default output
#   audio.sh sink <id>        -> make an output the default (HDMI vs headphone jack)
# Works with PipeWire (Pi OS Bookworm), PulseAudio, or plain ALSA. The server runs as the
# desktop user, so point at that user's session bus if it isn't already.
export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"
cmd="${1:-probe}"; arg="${2:-}"

json_escape() { printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'; }

if command -v wpctl >/dev/null 2>&1 && wpctl status >/dev/null 2>&1; then
  BACKEND=pipewire
elif command -v pactl >/dev/null 2>&1 && pactl info >/dev/null 2>&1; then
  BACKEND=pulse
elif command -v amixer >/dev/null 2>&1; then
  BACKEND=alsa
else
  echo "no audio system found" >&2; exit 1
fi

case "$cmd" in
  probe)
    vol=""; sinks="[]"
    case "$BACKEND" in
      pipewire)
        v=$(wpctl get-volume @DEFAULT_AUDIO_SINK@ 2>/dev/null | awk '{print int($2*100+0.5)}'); vol="${v:-}"
        def=$(wpctl inspect @DEFAULT_AUDIO_SINK@ 2>/dev/null | awk -F'"' '/node.name/ {print $2; exit}')
        sinks=$(wpctl status 2>/dev/null | awk '/Sinks:/{f=1;next} f&&/Sources:|Filters:|Streams:|Sink endpoints:/{f=0} f' \
          | sed -n 's/^[ │]*\*\{0,1\}[ ]*\([0-9]\+\)\. *\(.*\) \[vol:.*$/\1|\2/p' \
          | while IFS='|' read -r id name; do
              d=false; wpctl inspect "$id" 2>/dev/null | grep -q "\"$def\"" && [ -n "$def" ] && d=true
              printf '{"id":"%s","name":"%s","default":%s},' "$id" "$(json_escape "$name")" "$d"
            done)
        sinks="[${sinks%,}]";;
      pulse)
        v=$(pactl get-sink-volume @DEFAULT_SINK@ 2>/dev/null | grep -o '[0-9]\+%' | head -1 | tr -d %); vol="${v:-}"
        def=$(pactl get-default-sink 2>/dev/null)
        sinks=$(pactl list short sinks 2>/dev/null | while IFS=$'\t' read -r id name _; do
              d=false; [ "$name" = "$def" ] && d=true
              printf '{"id":"%s","name":"%s","default":%s},' "$(json_escape "$name")" "$(json_escape "$name")" "$d"; done)
        sinks="[${sinks%,}]";;
      alsa)
        v=$(amixer sget Master 2>/dev/null || amixer sget PCM 2>/dev/null || amixer sget Headphone 2>/dev/null); vol=$(printf '%s' "$v" | grep -o '[0-9]\+%' | head -1 | tr -d %)
        sinks=$(aplay -l 2>/dev/null | sed -n 's/^card \([0-9]\+\): \([^,]*\),.*/\1|\2/p' | while IFS='|' read -r id name; do
              printf '{"id":"%s","name":"%s","default":false},' "$id" "$(json_escape "$name")"; done)
        sinks="[${sinks%,}]";;
    esac
    printf '{"backend":"%s","volume":%s,"sinks":%s}\n' "$BACKEND" "${vol:-null}" "$sinks";;
  volume)
    pct=$(( ${arg:-50} < 0 ? 0 : ${arg:-50} > 100 ? 100 : ${arg:-50} ))
    case "$BACKEND" in
      pipewire) wpctl set-mute @DEFAULT_AUDIO_SINK@ 0 2>/dev/null; wpctl set-volume @DEFAULT_AUDIO_SINK@ "$pct%" ;;
      pulse) pactl set-sink-mute @DEFAULT_SINK@ 0 2>/dev/null; pactl set-sink-volume @DEFAULT_SINK@ "$pct%" ;;
      alsa) for c in Master PCM Headphone; do amixer -q sset "$c" "$pct%" unmute 2>/dev/null && break; done ;;
    esac
    echo "volume $pct";;
  play)
    [ -f "$arg" ] || { echo "no such file: $arg" >&2; exit 1; }
    case "$BACKEND" in
      pipewire) if command -v pw-play >/dev/null 2>&1; then pw-play "$arg"; elif command -v paplay >/dev/null 2>&1; then paplay "$arg"; else aplay -q "$arg"; fi ;;
      pulse) if command -v paplay >/dev/null 2>&1; then paplay "$arg"; else aplay -q "$arg"; fi ;;
      alsa) aplay -q "$arg" ;;
    esac
    echo "played";;
  sink)
    case "$BACKEND" in
      pipewire) wpctl set-default "$arg" ;;
      pulse) pactl set-default-sink "$arg" ;;
      alsa) echo "pick the output with: sudo raspi-config → System → Audio" ;;
    esac
    echo "default output: $arg";;
  *) echo "usage: audio.sh probe|volume N|play file|sink id" >&2; exit 2;;
esac
