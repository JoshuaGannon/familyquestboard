#!/usr/bin/env bash
# Runs the v2 browser tests against a throwaway server (fresh demo data, port 8097).
# Needs node + playwright (npm i -g playwright && npx playwright install chromium).
set -e
HERE="$(cd "$(dirname "$0")" && pwd)"; V2="$(dirname "$HERE")"
TMP="$(mktemp -d)"; PORT=8097
python3 "$V2/server.py" --port $PORT --data "$TMP" --demo >"$TMP/server.log" 2>&1 &
PID=$!; trap 'kill $PID 2>/dev/null; rm -rf "$TMP"' EXIT
for _ in $(seq 1 30); do curl -fs "http://localhost:$PORT/api/health" >/dev/null 2>&1 && break; sleep 0.3; done
export FQB2_URL="http://localhost:$PORT" NODE_PATH="${NODE_PATH:-$(npm root -g)}"
FAIL=0
echo "== test_server.py"; python3 "$HERE/test_server.py" || FAIL=1
for t in "$HERE"/test-*.js; do echo "== $(basename "$t")"; node "$t" || FAIL=1; done
exit $FAIL
