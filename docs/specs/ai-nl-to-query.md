# Design spec — AI natural-language → query

Status: proposed (design only — no implementation in this document)
Branch: `claude/spec-ai-nl-query`
Owner: workspace / query console

---

## 1. Problem

Mordor's CQL/SQL console (`src/renderer/features/workspace/CqlPanel.tsx`) assumes the
user already knows the query language and the live schema. Two real frictions follow:

- **Recall cost.** Across Cassandra, PostgreSQL and (planned) other engines, users
  juggle dialect differences (CQL `ALLOW FILTERING`, partition-key constraints,
  Postgres `RETURNING`/`jsonb`) and have to remember exact table/column names that
  already live in the schema tree.
- **Onboarding cost.** Someone exploring an unfamiliar database spends more time
  reading the schema panel than asking the question they actually have ("how many
  orders shipped last week, grouped by region?").

We already introspect full schema metadata per engine — table names, column names,
types, partition/clustering keys (`TableSchemaPayload`, `AdapterSchema`). That
metadata is exactly the context an LLM needs to translate a plain-English request
into a correct, schema-grounded query. This spec describes adding an opt-in
natural-language prompt that produces CQL/SQL **into the editor** — never executed
automatically — reusing the existing safety gating.

## 2. Goals / non-goals

### Goals
- A prompt box in the CQL/SQL panel: the user types a request in English, gets a
  generated query inserted into the existing editor.
- **Schema-aware** generation: the prompt is assembled from the live introspected
  schema so the model references real tables/columns and the correct dialect.
- **Main-process** LLM calls so the API key never reaches the renderer.
- Generated SQL/CQL is **never auto-executed**. It lands in the editor and flows
  through the exact same Run path (and read/write/all gating) as a hand-typed query.
- Explain + iterate: the model can annotate what it generated and the user can refine
  with a follow-up instruction.
- Validate generated identifiers against the known schema before presenting them, so
  hallucinated columns are caught early.
- Opt-in, with a clear statement of what leaves the machine.

### Non-goals
- No autonomous agent that runs queries on its own. No write executed without the
  same explicit, gated Run click a manual query requires.
- No fine-tuning / no shipping schema or data to train any model.
- No multi-statement "migrations from a paragraph" generation in v1 (the console is
  single-statement today — see `normalizeQuery` in `src/core/cassandra/query.ts`).
- No new database engine. No change to existing query semantics.
- Not bundling a local model; this targets a hosted API in v1.

## 3. Architecture

### 3.1 Provider

The generation provider is the **Claude API via the official Anthropic SDK**
(`@anthropic-ai/sdk`), called from the Electron main process. We refer to Claude
models **generally** and resolve the concrete model id from configuration at
runtime — **do not hardcode a specific model id** in source. A single
`AI_MODEL` config value (with a sensible default chosen at integration time) lets
the model be swapped without code changes and keeps this document durable as the
model lineup evolves.

The SDK and key handling live entirely in `src/main` (new module
`src/main/ai/`). The renderer only ever sees a typed IPC method and the resulting
text — it never imports the SDK and never holds the key.

### 3.2 Schema-aware prompt assembly

We already have the schema in two forms:

- `AdapterSchema` (`src/core/db/types.ts`) — the per-engine tree
  (`{ kind: "cassandra"; keyspaces }` / `{ kind: "postgres"; schemas }`), held in the
  main-process adapters and surfaced to the renderer via `refreshSchema`.
- `TableSchemaPayload` (`src/core/shared/messages.ts`) — per-table columns with
  `kind` (`partition_key` | `clustering` | `static` | `regular`), `type`,
  `partitionKeys`, `clusteringKeys`. The renderer already holds the open table's
  schema in `useSchemaStore` (`src/renderer/store/schema.ts`) and the panel already
  derives `completions` (`tables`, `columns`) from it in `CqlPanel.tsx`.

A new pure helper `src/core/ai/promptContext.ts` builds a compact, deterministic
schema digest from this metadata:

```
SchemaDigest = {
  engine: "cassandra" | "postgres";
  // The table currently in focus (if any) gets full column detail.
  focusTable?: { keyspace; table; columns: Array<{ name; type; kind }>;
                 partitionKeys; clusteringKeys };
  // Sibling tables in the same keyspace/schema get name + column-name list only,
  // to keep the prompt small while still letting the model JOIN / reference them.
  otherTables: Array<{ keyspace; table; columns: string[] }>;
}
```

This digest is rendered into a system prompt that states: the target engine and its
dialect rules (Cassandra: single-statement, partition-key-first, no JOINs, flag when
`ALLOW FILTERING` would be required; Postgres: standard SQL, schema-qualified names),
the available tables/columns, and hard rules — **emit exactly one statement**, **only
reference listed tables/columns**, **prefer a read (SELECT) unless the user explicitly
asks to modify data**, and **return the query plus a one-line explanation in a
structured shape**. Keeping the digest pure and deterministic makes it unit-testable
(see Testing) and keeps token cost bounded by truncating `otherTables` past a budget.

The system prompt is cached-friendly (stable schema digest first, volatile user
instruction last) so repeated requests against the same table reuse prompt-prefix
caching where the API supports it.

### 3.3 Request flow

```
CqlPanel (prompt box)
  → useAiQueryStore.generate(instruction)          [renderer]
  → window.cassandraDesk.aiGenerateQuery({...})     [preload bridge]
  → ipcChannels.aiGenerateQuery                      [IPC]
  → schemaHandlers dispatch / dedicated ai handler   [main]
       • resolve profile + engine (store.get(profileId))
       • build SchemaDigest from the adapter's AdapterSchema + focus TableSchemaPayload
       • read API key from SecretStore
       • call Anthropic SDK (main process)
       • validate generated identifiers against the digest
  → returns { query, explanation, dialect, warnings }
  → renderer inserts `query` into the editor (onChange), shows explanation + warnings
  → user reviews, then clicks Run (existing gated path) — nothing auto-runs
```

New main module `src/main/ai/AiQueryService.ts` owns the SDK client, key retrieval,
prompt assembly (delegating to `src/core/ai/promptContext.ts`), the request, and
post-generation schema validation. A thin `src/main/ai/aiIpc.ts` registers the
handler with `ipcMain.handle`, mirroring `src/main/updaterIpc.ts` /
`src/main/terminalIpc.ts`.

### 3.4 IPC contract additions

Additive, following the existing `CassandraDeskApi` + `ipcChannels` pattern
(`src/core/ipc.ts`). All four wiring points required by COMMON SETUP step 5 are
listed so the implementer cannot miss one:

```ts
// src/core/ipc.ts — request/response types
export interface AiGenerateQueryRequest {
  profileId: string;
  instruction: string;            // plain-English request
  focusTable?: TableIdentity;     // current table for full-column context
  mode: "read" | "write" | "all"; // current query-mode gate (steers the prompt)
  priorQuery?: string;            // for "iterate / refine this query"
}
export interface AiGenerateQueryResult {
  query: string;                  // single statement, inserted into the editor
  explanation: string;            // one-line plain-English description
  dialect: "cassandra" | "postgres";
  warnings: string[];             // e.g. "requires ALLOW FILTERING", unknown column
}

// CassandraDeskApi interface — new method
aiGenerateQuery(request: AiGenerateQueryRequest): Promise<AiGenerateQueryResult>;
aiSetApiKey(key: string): Promise<void>;   // stores via SecretStore, never returns it
aiHasApiKey(): Promise<boolean>;            // for settings UI state

// ipcChannels — new channels
aiGenerateQuery: "ai:generate-query",
aiSetApiKey:     "ai:set-key",
aiHasApiKey:     "ai:has-key",
```

Each new method must also be added to the preload `api` object
(`src/preload/index.ts`) and, per COMMON SETUP, a `vi.fn()` entry added to the `api`
mock in `test/App.test.tsx` (otherwise `tsc` fails on that test file). Respect the
strict tsconfig (`exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`): optional
fields like `focusTable` / `priorQuery` are conditionally spread, never set to
`undefined`.

### 3.5 Key storage

The API key is a secret and is handled exactly like DB passwords: via
`SecretStore` (`src/main/SecretStore.ts`, keytar-backed). It uses a fixed,
non-profile key (e.g. `aiSetApiKey` writes under a constant id such as
`"__ai_provider__"` through the same keytar service name `"mordor"`) so it is not
tied to any one connection. The renderer's settings UI calls `aiSetApiKey` (write-only)
and `aiHasApiKey` (presence check). The key is **never** sent to the renderer, never
written to the plaintext profile JSON, and never logged.

## 4. Safety model

This is the load-bearing section. AI generation must not weaken any existing guard.

1. **No auto-execution.** `aiGenerateQuery` returns *text only*. The renderer inserts
   it into the editor via the existing `onChange` and stops. Execution still requires
   the user to click **Run**, which goes through `useQueryStore.runQuery` →
   `runSelectQuery` exactly as a hand-typed query does.
2. **Query-mode gating is unchanged and authoritative.** The `mode`
   (`read`/`write`/`all`) from `usePreferencesStore` is passed into the prompt so the
   model *prefers a SELECT in read mode*, but the real enforcement remains
   `normalizeQuery` (`src/core/cassandra/query.ts`), which rejects non-SELECT in read
   mode and DDL in write mode at execution time. The AI cannot bypass it — a generated
   `DELETE` pasted under read mode is refused at Run just like a typed one. The
   existing `QueryModeBadge` keeps showing the active mode.
3. **Write preview + affected-row estimate before any mutation.** When the generated
   statement is a mutation (insert/update/delete/truncate — same `DML_KEYWORDS` set
   `normalizeQuery` already recognizes) and the mode permits it, the panel shows a
   confirmation step before Run: the statement, a plain-English summary, and a
   best-effort **affected-row estimate**. The estimate is produced without mutating:
   Postgres via `EXPLAIN` (row estimate) or a derived `SELECT count(*)` over the same
   `WHERE`; Cassandra via a `SELECT` with the same key predicates. The estimate is
   advisory and labeled as such (Cassandra counts are approximate). Read-only
   generations skip this step.
4. **Schema validation catches hallucinations (see §7).** Any table/column the model
   references that is not in the digest becomes a `warnings[]` entry and is surfaced
   prominently before Run; we do not silently "fix" it.
5. **Explicit, visible provenance.** AI-generated text is marked as such in the UI so
   the user knows to review it; it is recorded in query history as a normal query once
   run (no special privilege).

## 5. UX

In `CqlPanel.tsx`, add a compact, opt-in **prompt row** above the editor (collapsed by
default; a small "Ask AI" affordance in the header alongside the existing History /
QueryMode / Explain / Run controls, reusing `Button` and the existing dropdown/popover
primitives). Behaviour:

- User types an instruction (e.g. "top 10 customers by total order value this month")
  and submits.
- Panel calls a new `useAiQueryStore` action (renderer store
  `src/renderer/store/aiQuery.ts`, following `store/query.ts` conventions and
  `runWithStatus` for status/error reporting). State: `instruction`, `generating`,
  `lastResult`, `error`.
- On success: the generated `query` is inserted into the editor (`onChange`), the
  `explanation` is shown inline, and any `warnings` (e.g. "would require ALLOW
  FILTERING", "column `foo` not found") render as a prominent caution strip.
- **Explain**: reuse the existing explanation already returned; optionally a secondary
  "Explain this query" can re-ask the model to expand. (Distinct from the Postgres
  `EXPLAIN ANALYZE` plan already in `CqlPanel`'s `onExplain` — naming in the UI must
  disambiguate "AI explanation" vs "EXPLAIN plan".)
- **Iterate**: a follow-up instruction passes `priorQuery` so the model refines the
  current editor contents rather than starting over.
- Nothing runs automatically — the user reviews then clicks the existing **Run**.

Only the workspace console surfaces this; the prompt box honors the same `dialect`
prop the panel already receives, so Cassandra vs Postgres phrasing/dialect is correct.

## 6. Cost, latency, streaming

- **Latency.** A single generation is one round-trip. We stream the response so the
  query text appears progressively in a preview area and only commits to the editor on
  completion (avoids a half-written statement landing in the editor). Streaming uses
  the SDK's streaming API in the main process; tokens are forwarded to the renderer via
  an event channel (mirroring how `onTerminalData` streams in `terminalIpc.ts`) or, for
  v1 simplicity, a single non-streamed `invoke` with a spinner — streaming is a phase-2
  refinement.
- **Cost.** Bounded by the prompt-context budget: full columns only for the focus
  table, name-only for siblings, hard cap on `otherTables`. Schema-prefix prompt
  caching reduces repeat cost when iterating on the same table. We never include row
  data in the prompt by default (see Privacy).
- **Token accounting.** Surface a small "~N tokens" hint in the settings/AI area so
  users on metered keys understand the cost; read usage from the SDK response.

## 7. Failure modes

- **Hallucinated tables/columns.** After generation, parse the statement's referenced
  identifiers and validate them against the `SchemaDigest`. Unknown identifiers →
  `warnings[]`, shown prominently; we never auto-execute and never auto-rewrite.
- **Multiple statements.** The console is single-statement (`normalizeQuery` rejects
  embedded `;`). The prompt forbids multi-statement output; if the model returns more,
  we keep the first statement and warn.
- **Wrong dialect.** The engine is pinned in the prompt; a Cassandra digest never
  offers JOINs. Residual mistakes are caught at Run by the engine itself.
- **Empty / refusal / malformed structured output.** Surface a clear, actionable error
  via `runWithStatus`/`useStatusStore`; leave the editor untouched.
- **No API key / network / rate-limit / auth error.** Distinct, human-readable
  messages (e.g. "Add a Claude API key in Settings → AI" when `aiHasApiKey` is false);
  the feature degrades gracefully and the rest of the console is unaffected.
- **Provider/SDK errors** are caught in `AiQueryService` and mapped to friendly text;
  raw errors and the key are never logged.

## 8. Privacy

- The feature is **opt-in**: disabled until the user adds a key and enables it in
  settings. A first-use notice states plainly what is sent.
- **What leaves the machine:** the user's instruction and the **schema digest**
  (table names, column names, types, key roles) — i.e. structure, not contents.
- **What does not:** row data / cell values are **not** included by default. An
  explicit, separately-gated "include sample rows for better results" toggle (off by
  default) would be the only path to sending any data, and even then a small, capped,
  user-confirmed sample. v1 ships without sample rows.
- The API key is stored only in the OS keychain via `SecretStore`; it is never in the
  renderer, profile JSON, logs, or telemetry.
- No schema or instruction is persisted by Mordor beyond normal query history (which
  only stores the final query text the user ran, as today).

## 9. Phasing

- **Phase 1 — read-only generation.** Prompt box, schema-aware prompt, main-process
  call, key storage, identifier validation, insert-to-editor. Mode steers toward
  SELECT; no streaming; no sample rows. Lowest risk, highest value.
- **Phase 2 — write support with preview.** Allow mutation generation under
  write/all mode, gated behind the §4.3 preview + affected-row estimate. Streaming
  token preview.
- **Phase 3 — iterate/explain polish & caching.** Refinement loop (`priorQuery`),
  richer explanations, prompt-prefix caching, token/cost surface, optional capped
  sample-row context behind an explicit toggle.

## 10. Testing

- **`src/core/ai/promptContext.ts` (pure)** — `test/aiPromptContext.test.ts`: given an
  `AdapterSchema` + focus `TableSchemaPayload`, the digest includes the focus table's
  full columns, name-only siblings, correct engine tag, and respects the
  `otherTables` truncation budget. Deterministic snapshot of the rendered system
  prompt. No network.
- **Identifier validation** — unit tests that a query referencing an unknown
  table/column yields the expected `warnings[]`, and that a valid query yields none.
- **IPC dispatch** — extend `test/ipcHandlers.test.ts` with an `aiGenerateQuery`
  dispatch test, **mocking the Anthropic SDK** (no live calls in CI). Assert the key is
  read from `SecretStore` and never returned to the renderer.
- **Safety** — a test asserting a generated mutation pasted under `read` mode is still
  rejected by `normalizeQuery` (the AI path adds no execution privilege).
- **Renderer** — `useAiQueryStore` action test (loading/error/result transitions); the
  `api` mock in `test/App.test.tsx` gains `aiGenerateQuery` / `aiSetApiKey` /
  `aiHasApiKey` `vi.fn()` entries so existing renderer tests keep compiling.
- Live provider calls are never exercised in CI; all model interaction is mocked.

## 11. Files this would touch (reference)

- `src/core/ipc.ts` — new request/response types, `CassandraDeskApi` methods, channels.
- `src/core/ai/promptContext.ts` — new pure schema-digest + prompt builder.
- `src/main/ai/AiQueryService.ts`, `src/main/ai/aiIpc.ts` — SDK client, key retrieval,
  generation, validation; IPC registration (mirrors `updaterIpc.ts`/`terminalIpc.ts`).
- `src/main/handlers/schemaHandlers.ts` — engine/dialect resolution helper reuse.
- `src/main/SecretStore.ts` — reused as-is for the API key.
- `src/preload/index.ts` — bridge the new methods.
- `src/renderer/features/workspace/CqlPanel.tsx` — prompt row, explanation/warnings UI.
- `src/renderer/store/aiQuery.ts` — new renderer store (follows `store/query.ts`).
- `src/renderer/store/preferences.ts` — AI opt-in flag (persisted).
- `test/aiPromptContext.test.ts`, `test/ipcHandlers.test.ts`, `test/App.test.tsx` —
  tests + mock wiring.
- `package.json` — add `@anthropic-ai/sdk` dependency.
</content>
</invoke>
