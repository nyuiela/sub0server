#!/usr/bin/env sh
# Run trigger-all on the backend every CRON_INTERVAL_SECONDS (default 300).
# Run from sub0server with backend already up (no Docker build). Uses .env if present.
# Example: cd sub0server && chmod +x scripts/cron-trigger-all.sh && ./scripts/cron-trigger-all.sh

set -e
cd "$(dirname "$0")/.."
if [ -f .env ]; then
  [ -z "$BACKEND_URL" ] && BACKEND_URL=$(grep -E '^BACKEND_URL=' .env 2>/dev/null | cut -d= -f2- | tr -d '"' | tr -d "'")
  [ -z "$API_KEY" ] && API_KEY=$(grep -E '^API_KEY=' .env 2>/dev/null | cut -d= -f2- | tr -d '"' | tr -d "'")
  [ -z "$CRON_INTERVAL_SECONDS" ] && CRON_INTERVAL_SECONDS=$(grep -E '^CRON_INTERVAL_SECONDS=' .env 2>/dev/null | cut -d= -f2- | tr -d '"' | tr -d "'")
fi

BACKEND_URL="${BACKEND_URL:-http://localhost:4000}"
API_KEY="${API_KEY:?Set API_KEY in .env or environment}"
INTERVAL="${CRON_INTERVAL_SECONDS:-300}"

echo "Trigger-all cron: every ${INTERVAL}s -> ${BACKEND_URL}/api/agent/trigger-all"
while true; do
  sleep "$INTERVAL"
  curl -sf -X POST "${BACKEND_URL}/api/agent/trigger-all" -H "x-api-key: ${API_KEY}" || true
done
