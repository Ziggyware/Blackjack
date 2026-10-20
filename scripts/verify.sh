#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# VELVET — full verification suite.
# Boots a real table server, then runs every layer of the test suite against it:
#
#   1. engine unit tests          (rules, shoe, strategy, chip conservation)
#   2. headless client render     (server-rendered React tree vs live engine data)
#   3. multiplayer protocol       (3 raw sockets: seats, bets, rounds, reconnect)
#   4. browser end-to-end         (real React client in jsdom, driven by clicks)
#   5. offline fallback           (same client with no server at all)
#
#   ./scripts/verify.sh
# ---------------------------------------------------------------------------
set -uo pipefail
cd "$(dirname "$0")/.."

PORT="${PORT:-8787}"
FAILED=0

step() { printf '\n\033[1;35m▶ %s\033[0m\n' "$1"; }
pass() { printf '\033[1;32m  ✓ %s\033[0m\n' "$1"; }
fail() { printf '\033[1;31m  ✗ %s\033[0m\n' "$1"; FAILED=1; }

echo "starting table server on :$PORT"
PORT="$PORT" ./node_modules/.bin/tsx server/src/index.ts &
SERVER_PID=$!
cleanup() {
  kill "$SERVER_PID" 2>/dev/null || true
  wait "$SERVER_PID" 2>/dev/null || true
}
trap cleanup EXIT

for _ in $(seq 1 60); do
  if curl -sf "http://127.0.0.1:$PORT/healthz" >/dev/null 2>&1; then break; fi
  sleep 0.5
done
if ! curl -sf "http://127.0.0.1:$PORT/healthz" >/dev/null 2>&1; then
  fail "table server never came up on :$PORT"
  exit 1
fi
pass "table server is live on :$PORT"

step "1/5 engine unit tests"
if npm test --silent; then pass "engine rules, shoe, strategy and chip conservation"; else fail "engine unit tests"; fi

step "2/5 headless client render"
if ./node_modules/.bin/tsx scripts/render-smoke.tsx; then pass "React tree renders against live engine data"; else fail "client render"; fi

step "3/5 multiplayer protocol"
if node scripts/smoke.mjs "ws://127.0.0.1:$PORT/ws"; then pass "sockets, seats, bets, rounds, reconnect, private rooms"; else fail "multiplayer protocol"; fi

step "4/5 browser end to end (served by the table server)"
if ./node_modules/.bin/tsx scripts/browser-smoke.tsx "http://127.0.0.1:$PORT"; then pass "real client drove a full round over the socket"; else fail "browser end to end"; fi

step "5/5 offline fallback (no server at this origin)"
if ./node_modules/.bin/tsx scripts/browser-smoke.tsx "http://127.0.0.1:9"; then pass "in-browser engine took over and played a full round"; else fail "offline fallback"; fi

echo
if [ "$FAILED" -eq 0 ]; then
  printf '\033[1;32m♠  every layer is green\033[0m\n\n'
  exit 0
fi
printf '\033[1;31m✗ some checks failed\033[0m\n\n'
exit 1
