# Scripts

## Trigger-all cron (prefer in-process)

The backend can run trigger-all on an interval itself. In `sub0server` `.env` set:

- `TRIGGER_ALL_CRON_ENABLED=true`
- `TRIGGER_ALL_CRON_INTERVAL_MS=300000` (5 min; optional, default 300000)

Then start the backend as usual (`pn dev` or `node dist/server.js`). No separate script or Docker cron needed.

## Cron script (optional)

If you prefer a separate process:

1. Start backend and worker as usual.
2. From `sub0server`: `chmod +x scripts/cron-trigger-all.sh && ./scripts/cron-trigger-all.sh`
   Reads `BACKEND_URL`, `API_KEY`, `CRON_INTERVAL_SECONDS` from `.env`.

Or system crontab (every 5 min):

```bash
*/5 * * * * curl -sf -X POST "http://localhost:4000/api/agent/trigger-all" -H "x-api-key: YOUR_API_KEY" || true
```

## Docker

- `docker compose --profile app up -d` – backend, redis, agent-worker (builds backend).
- `docker compose --profile cron up -d` – only the lightweight cron container (no build). Set `BACKEND_URL` in `.env`.
