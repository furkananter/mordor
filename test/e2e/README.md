# End-to-end test harness (placeholder)

This directory is a **placeholder** for the Docker-backed end-to-end (E2E) suite.
The full design lives in [`docs/specs/e2e-test-harness.md`](../../docs/specs/e2e-test-harness.md).

Today the repo ships only the **unit suite** (`npm test` → `vitest run`). Those
tests exercise services, IPC dispatch, and renderer logic against mocks. They do
**not** spin up real databases or drive the packaged Electron app, so every
"connect → browse → write → verify" PR has had to be checked by hand against
live engines. The E2E harness closes that gap.

## What lands here later

- `docker-compose.e2e.yml` (already at the repo root) brings up Cassandra,
  PostgreSQL, and Redis on their default ports (9042 / 5432 / 6379).
- `seed/` — per-engine seed scripts (`cassandra.cql`, `postgres.sql`,
  `redis.txt`) that create a known keyspace/schema/db with a few rows so the
  scenarios have deterministic data to read and mutate.
- Playwright specs that launch the built Electron app via `_electron.launch`,
  point it at the seeded containers, and walk the connect/browse/insert/edit/
  delete flow for each engine.

## Running (once the harness is implemented)

```sh
# 1. start the databases
docker compose -f docker-compose.e2e.yml up -d --wait

# 2. seed them (script TBD — see the spec)
#    bash test/e2e/seed/apply.sh

# 3. build the app and run the e2e suite (script TBD)
#    npm run build
#    npm run test:e2e

# 4. tear down
docker compose -f docker-compose.e2e.yml down -v
```

## Status

Scaffold only — no executable E2E specs yet. Adding them does **not** change the
existing `npm run compile` / `npm test` flow; the E2E job is intended to be a
separate, opt-in CI lane (see the spec's "CI integration" section).
