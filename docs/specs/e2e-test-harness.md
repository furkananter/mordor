# Design spec: Docker-backed end-to-end test harness

Status: proposed. This document specifies a Docker + Playwright end-to-end (E2E)
harness for Mordor and ships the minimal, non-breaking scaffold that supports it
(`docker-compose.e2e.yml` at the repo root, the `test/e2e/` directory with a
README and seed scripts). The executable Playwright specs and the optional CI
lane described here are intentionally **not** wired up yet — see
[Phasing](#phasing).

## Problem & motivation

Mordor is an Electron + React workbench that talks to three real database
engines (Cassandra, PostgreSQL, Redis) through `src/main` adapters and an IPC
contract in `src/core/ipc.ts`. The current automated suite is **unit-only**:
`npm test` runs `vitest run` over services, IPC dispatch, serialization, export
formatters, and renderer logic — all against mocks (the `api` mock object in
`test/App.test.tsx`, the dispatch fakes in `test/ipcHandlers.test.ts`).

Nothing exercises the full stack against a live engine. As a result, every PR
that touches a write path (insert / update / delete / preview) has had to note
"manual E2E vs a live DB was not run." That leaves a class of bugs uncovered:

- Real driver behaviour (type coercion, paging tokens, transaction semantics)
  that mocks paper over.
- The preload `contextBridge` wiring (`window.cassandraDesk`) and main-process
  dispatch as an integrated whole, rather than each half in isolation.
- The packaged Electron app actually launching, rendering the sidebar, and
  round-tripping a user action to the database and back.

The goal is a harness that brings up the three engines in containers, seeds them
with known data, drives the built app with Playwright, and asserts the
connect → browse → write → verify flow per engine — without slowing down or
destabilising the fast unit suite.

## Goals

- Stand up Cassandra + Postgres + Redis reproducibly via Docker Compose, on the
  same default ports the app auto-detects (9042 / 5432 / 6379).
- Seed each engine with deterministic data so scenarios are repeatable.
- Drive the **built** Electron app with Playwright's Electron support
  (`_electron.launch`), reusing the repo's preinstalled Chromium.
- Cover the core per-engine user journey: connect → browse schema → insert →
  edit → delete, asserting the grid reflects each mutation.
- Keep the harness **opt-in**: it must not change `npm run compile` or
  `npm test`, and must not be required for a green PR by default.
- Provide an **optional** CI lane that runs the E2E suite without gating or
  slowing the existing unit job.

## Non-goals

- Replacing the unit suite. E2E is a thin top layer; unit tests remain the bulk
  of coverage (see [Relationship to the unit suite](#relationship-to-the-existing-vitest-unit-suite)).
- Exhaustive matrix testing (every OS / engine version / edge type). Start with
  Linux CI + the pinned image versions in `docker-compose.e2e.yml`.
- Testing packaging/signing/auto-update (covered elsewhere; see
  `docs/RELEASE_SIGNING.md`).
- Cloud/managed-engine targets (Astra, RDS, ElastiCache). Local containers only.
- SSH-tunnelled connections (a separate roadmap stream); the harness connects
  directly to `127.0.0.1`.

## The Docker stack

`docker-compose.e2e.yml` (repo root, already added) defines three services:

| Service     | Image                | Port | Notes |
|-------------|----------------------|------|-------|
| `cassandra` | `cassandra:5.0`      | 9042 | single-node, small heap, `SimpleSnitch` |
| `postgres`  | `postgres:16-alpine` | 5432 | user/pw `mordor`/`mordor`, db `mordor_e2e` |
| `redis`     | `redis:7-alpine`     | 6379 | default config |

Each service declares a **healthcheck** so the harness can wait for true
readiness rather than racing a fixed sleep:

- Cassandra: `cqlsh -e 'describe keyspaces'` (CQL is the last subsystem up;
  needs a generous `start_period`).
- Postgres: `pg_isready -U mordor -d mordor_e2e`.
- Redis: `redis-cli ping` returns `PONG`.

Bring-up / tear-down:

```sh
docker compose -f docker-compose.e2e.yml up -d --wait   # --wait blocks on healthchecks
docker compose -f docker-compose.e2e.yml down -v        # -v drops volumes for a clean slate
```

The ports deliberately match the `parsePort` fallbacks in
`src/core/config/profile.ts` (9042 / 5432 / 6379), so a profile produced by the
app's local-discovery path (`test/localDiscovery.test.ts` covers the detection
logic) points straight at these containers with no manual host/port entry.

## Seed scripts

`test/e2e/seed/` holds one script per engine, all creating the same logical
shape — a keyspace/schema/db named `app` with a `users` table/collection of
three rows and a single-column primary key (`id`). A single-column PK keeps the
write paths trivial: insert/update/delete only need the one key value, matching
how `CassandraService` / `PostgresService` derive key columns from the table
schema.

- `seed/postgres.sql` — `CREATE SCHEMA app; CREATE TABLE app.users (id PK, …)`,
  three `INSERT`s. Applied with `psql -f`.
- `seed/cassandra.cql` — `CREATE KEYSPACE app …; CREATE TABLE app.users …`,
  three `INSERT`s. Applied with `cqlsh -f`.
- `seed/redis.txt` — `SET` / `HSET` / `SADD` commands. Piped via `redis-cli`.

A future `seed/apply.sh` will wait on the healthchecks (or `--wait`) and run the
three scripts against the containers (using `docker compose exec` so no local
client binaries are required). The exact applier is left to implementation; the
data shape above is the contract the scenarios depend on.

## Driving the Electron app under Playwright

The repo's environment **preinstalls Chromium and configures Playwright** —
`PLAYWRIGHT_BROWSERS_PATH` points at the shared browser cache, so the harness
must **not** re-download browsers (`PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1` during
install, and never call `npx playwright install` in CI). Playwright drives
Electron directly through its Electron API:

```ts
import { test, expect, _electron as electron } from "@playwright/test";

const app = await electron.launch({
  args: ["."],                 // entry from package.json "main"
  env: { ...process.env, MORDOR_E2E: "1" },
});
const window = await app.firstWindow();
// ...interact with the React UI via window locators...
await app.close();
```

Practical notes:

- **Build first.** Run `npm run build` so Playwright launches the compiled
  main + renderer bundles, exercising the real preload `contextBridge`
  (`window.cassandraDesk`) end to end — not a Vite dev server.
- **Deterministic profile/secret state.** E2E runs must not touch the
  developer's real profiles or OS keychain. Gate on an env flag (e.g.
  `MORDOR_E2E=1`) so the app writes profiles to a throwaway userData dir and
  uses an in-memory secret store instead of keytar. `test/SecretStore.test.ts`
  shows the existing fallback shape to mirror. The harness can also pre-seed a
  profile JSON pointing at `127.0.0.1` to skip the discovery/creation UI.
- **Stable selectors.** Prefer role/text locators; add `data-testid` to the few
  load-bearing elements (sidebar connection node, table node, the DataTable
  toolbar insert/edit/delete controls, the row dialog inputs) so scenarios don't
  depend on styling. These are small, additive renderer changes deferred to the
  implementation phase.

## Proposed test scenarios

One spec per engine, each a full round trip. Pseudocode for Postgres
(Cassandra/Redis analogous, swapping the seed data and key inspector for Redis):

1. **Connect** — launch app, select the seeded `postgres` profile, assert it
   connects (the sidebar shows `connected: true`; mirrors the `connect` IPC →
   `ConnectResult`).
2. **Browse** — expand schema `app`, open table `users`, assert the preview grid
   shows the three seeded rows (`getPreview` → `PreviewRowsPayload`).
3. **Insert** — open the row dialog, add `id=4, email=…`, submit
   (`insertTableRow`), assert the grid now shows four rows after reload.
4. **Edit** — change row 4's `name` (row dialog or, once it lands, inline cell
   edit) via `updateTableRow`, assert the new value renders.
5. **Delete** — select row 4, delete it (`deleteTableRows`), assert the grid
   returns to three rows.
6. **Verify out-of-band** — query the engine directly (`docker compose exec`
   `psql`/`cqlsh`/`redis-cli`) to confirm the database state matches the UI, so
   the assertion isn't just trusting the app's own re-render.

Redis differs (no tabular schema): the scenario browses DB 0, inspects a seeded
key, sets/edits a value via the command palette / key inspector, and deletes it.

Each spec is fully independent and idempotent — it tears down its own
mutations (or relies on `down -v` between runs) so reruns are stable.

## CI integration

The existing job in `.github/workflows/ci.yml` (`Type-check + Tests`) stays
**exactly as-is** — it remains the fast required gate (`npm ci`, `npm run
compile`, `npm test`). The E2E suite goes in a **separate, optional job** so it
never slows or blocks the unit lane. Sketch (added in the implementation phase,
**not** in this scaffold PR):

```yaml
  e2e:
    name: E2E (Docker engines)
    runs-on: ubuntu-latest
    timeout-minutes: 30
    # Opt-in: only on demand or labelled PRs, so normal PRs aren't slowed.
    if: github.event_name == 'workflow_dispatch' ||
        contains(github.event.pull_request.labels.*.name, 'e2e')
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '22', cache: 'npm' }
      - run: npm ci
      - name: Start engines
        run: docker compose -f docker-compose.e2e.yml up -d --wait
      - name: Seed
        run: bash test/e2e/seed/apply.sh
      - name: Build app
        run: npm run build
      - name: Run E2E
        run: xvfb-run --auto-servernum npm run test:e2e   # Electron needs a display
      - if: always()
        run: docker compose -f docker-compose.e2e.yml down -v
```

Gating choices that keep the unit lane fast:

- **Separate job**, not added steps in `test` → the required check stays quick.
- **`if:` guard** → runs only on `workflow_dispatch` or an `e2e` label, so most
  PRs skip it entirely. It can be promoted to run on `main` pushes (post-merge
  safety net) without ever blocking PR merge.
- **`xvfb-run`** provides the virtual display Electron needs on headless Linux.
- Reuse the preinstalled Chromium via `PLAYWRIGHT_BROWSERS_PATH`; never download
  browsers in CI.

## Relationship to the existing vitest unit suite

The two layers are complementary, not redundant:

- **Unit (vitest, `npm test`)** — fast, hermetic, no Docker. Owns service logic,
  SQL/CQL building, IPC dispatch shape, serialization, export formatters, and
  renderer state. Stays the primary coverage and the required PR gate. Runs in
  seconds; no engine needed.
- **E2E (Playwright + Docker)** — slow, integrated, opt-in. Owns the
  cross-process contract (preload `contextBridge` ⇄ main dispatch ⇄ real driver)
  and the end-user journey against real engines. A handful of high-value
  scenarios, not exhaustive coverage.

Rule of thumb: push a behaviour down to a unit test whenever it can be expressed
hermetically; reserve E2E for "does the whole thing actually work against a live
DB" confidence that mocks can't give.

## Files this touches

- `docker-compose.e2e.yml` — **added** (this PR).
- `test/e2e/README.md`, `test/e2e/seed/{postgres.sql,cassandra.cql,redis.txt}` —
  **added** (this PR).
- `.github/workflows/ci.yml` — **unchanged** in this PR; gains an optional `e2e`
  job later.
- `package.json` — later: `@playwright/test` devDependency + a `test:e2e`
  script. Deferred so `npm ci` and the unit suite stay untouched here.
- Renderer (`DataTable` toolbar, sidebar nodes, row dialog) — later: a few
  additive `data-testid` attributes for stable selectors.
- A small `MORDOR_E2E` gate in the main process (userData dir + in-memory secret
  store) — later.

Real references for the flows above: the IPC contract `src/core/ipc.ts`
(`connect`, `getPreview`, `insertTableRow`, `updateTableRow`, `deleteTableRows`);
dispatch in `src/main/handlers/schemaHandlers.ts`; services
`src/core/cassandra/CassandraService.ts` and `src/core/postgres/PostgresService.ts`;
adapters in `src/main/adapters/`; the preload bridge `src/preload/index.ts`; and
the renderer `DataPanel.tsx` / `DataTable.tsx` write wiring.

## Phasing

1. **Scaffold (this PR)** — `docker-compose.e2e.yml`, `test/e2e/` README + seed
   scripts, this spec. No deps, no CI change, no executable specs. `npm run
   compile` and `npm test` unaffected.
2. **Harness deps + first scenario** — add `@playwright/test` (devDependency),
   a `playwright.config.ts` for the Electron project, a `test:e2e` script, the
   `MORDOR_E2E` main-process gate, `data-testid`s, and the **Postgres** round
   trip. Add `seed/apply.sh`.
3. **All three engines** — port the scenario to Cassandra and Redis (key
   inspector flow for Redis).
4. **CI lane** — add the optional, gated `e2e` job to `ci.yml`.
5. **Hardening** — flake control (retries, healthcheck waits), artifact capture
   (Playwright traces/screenshots on failure), optional promotion to a
   post-merge `main` run.

## Risks & mitigations

- **Flakiness / timing** — Cassandra is slow to accept CQL. Mitigate with
  Compose healthchecks + `--wait`, generous `start_period`, and Playwright
  auto-waiting locators (no fixed sleeps).
- **CI cost & time** — three containers + a build is minutes, not seconds.
  Mitigate by keeping E2E in a separate, label/dispatch-gated job off the
  critical path.
- **Headless Electron on Linux** — needs a display. Mitigate with `xvfb-run`.
- **Touching real user state** — never run E2E against the developer's profiles
  or keychain. Mitigate with the `MORDOR_E2E` throwaway-userData + in-memory
  secret store gate.
- **Browser download in a locked-down env** — must reuse the preinstalled
  Chromium. Mitigate by honouring `PLAYWRIGHT_BROWSERS_PATH` and never invoking
  `playwright install`.
- **Selector drift** — UI restyles break text selectors. Mitigate with a small
  set of stable `data-testid`s on load-bearing controls.

## Testing strategy for the harness itself

- The scaffold added here is inert config/markdown/SQL — it cannot break
  `compile` or the unit suite, which is the acceptance bar for this PR.
- Each E2E spec asserts both the **UI state** (grid row count / cell values) and
  the **out-of-band DB state** (direct `psql`/`cqlsh`/`redis-cli` query), so a
  passing spec proves a real round trip rather than the app agreeing with itself.
- Specs are independent and idempotent (self-cleanup or `down -v` between runs)
  to keep reruns deterministic.
- Failure artifacts (Playwright trace + screenshot) are captured in CI to make
  red E2E runs debuggable without a local repro.
