# Design spec: ERD + foreign-key navigation

Status: proposed · Scope: design only (no code in this PR)

## 1. Problem & motivation

Mordor today lets you browse one table at a time. The sidebar tree
(`AdapterSchema` → keyspaces/schemas → tables) and the data grid
(`DataPanel.tsx` → `DataTable.tsx`) are entirely table-local: there is no way
to see how tables relate to one another, and no way to follow a relationship.

Two concrete pain points fall out of that:

1. **No relationship overview.** When you open an unfamiliar Postgres database
   you cannot tell, without reading DDL by hand, that `orders.customer_id`
   points at `customers.id`. The DDL view itself is deliberately FK-blind —
   `PostgresService.fetchTableDdl` ships a comment saying foreign keys are
   "intentionally out of scope until someone asks for them." This is that ask.
2. **No navigation along relationships.** Looking at an `orders` row, the
   natural next move is "show me the customer." Today that means manually
   noting the `customer_id` value, switching tables in the sidebar, typing a
   filter, and finding the row. Every step is friction the tool could remove.

The single highest-value primitive is **"click a foreign-key cell → open the
referenced row."** A full entity-relationship diagram (ERD) is the broader,
more visual goal but it is strictly heavier to build and to lay out well, so it
is phased behind FK navigation.

## 2. Goals / non-goals

### Goals
- Read foreign-key (FK) relationship metadata per engine and expose it over a
  new, additive IPC channel without disturbing the existing preview/schema
  contracts.
- Render an FK affordance in the data grid: a cell that participates in a known
  FK is visibly actionable, and clicking it opens the referenced row using the
  existing row-detail / preview machinery plus a filtered fetch.
- Render an ERD: a read-only diagram of tables (nodes) and FK edges for the
  currently selected keyspace/schema, with reasonable auto-layout.
- Stay dependency-light and match existing patterns (tagged-union payloads,
  per-engine dispatch in `schemaHandlers.ts`, zustand stores in
  `src/renderer/store`).

### Non-goals
- **Editing** relationships (adding/dropping FKs). This is a read/navigate
  feature; DDL authoring stays in the existing schema-script path.
- **Inferring** relationships where the engine does not record them. Cassandra
  and Redis have no FK catalog (see §3); we do not guess.
- Cross-database / cross-profile relationships. Edges are within a single
  connected profile and (for the ERD) a single keyspace/schema.
- Many-to-many "junction table" collapse, cardinality inference beyond what the
  catalog states, or diagram persistence/manual layout editing. All future work.

## 3. How to read FK + relationship metadata per engine

The IPC layer already dispatches on `profile.type` (`schemaHandlers.ts`), so
each engine implements its own relationship reader and the handler routes to it.
The shared return shape is defined in §4.

### 3.1 Postgres — authoritative

Postgres records FKs in the catalog. Two equivalent sources:

- `pg_constraint` (filter `contype = 'f'`), joined to `pg_class`/`pg_namespace`
  for the local and referenced table names, and to `pg_attribute` via the
  `conkey` / `confkey` arrays for the column lists. This is the lowest-level and
  most precise source and matches the style already used in
  `PostgresService.fetchTableSchema` (which joins `pg_index`/`pg_attribute` via
  `regclass`).
- `information_schema.table_constraints` + `key_column_usage` +
  `constraint_column_usage`. More portable/readable but clumsier for
  multi-column keys (ordinal joins) and slower.

Recommendation: use `pg_constraint`, mirroring the existing catalog joins. A
single round-trip can return every FK edge in a schema. Sketch (one row per
constraint, columns aggregated in order):

```sql
SELECT
  con.conname                              AS constraint_name,
  src_ns.nspname                           AS src_schema,
  src_rel.relname                          AS src_table,
  tgt_ns.nspname                           AS tgt_schema,
  tgt_rel.relname                          AS tgt_table,
  ARRAY(
    SELECT a.attname
    FROM unnest(con.conkey) WITH ORDINALITY AS k(attnum, ord)
    JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = k.attnum
    ORDER BY k.ord
  )                                        AS src_columns,
  ARRAY(
    SELECT a.attname
    FROM unnest(con.confkey) WITH ORDINALITY AS k(attnum, ord)
    JOIN pg_attribute a ON a.attrelid = con.confrelid AND a.attnum = k.attnum
    ORDER BY k.ord
  )                                        AS tgt_columns
FROM pg_constraint con
JOIN pg_class      src_rel ON src_rel.oid = con.conrelid
JOIN pg_namespace  src_ns  ON src_ns.oid  = src_rel.relnamespace
JOIN pg_class      tgt_rel ON tgt_rel.oid = con.confrelid
JOIN pg_namespace  tgt_ns  ON tgt_ns.oid  = tgt_rel.relnamespace
WHERE con.contype = 'f'
  AND src_ns.nspname = $1   -- scope to one schema for the ERD view
ORDER BY src_rel.relname, con.conname;
```

For the single-table FK-navigation case, scope additionally on
`src_rel.relname = $2` (outbound edges) and optionally `tgt_rel.relname = $2`
(inbound edges, for "what references this row"). The same `SYSTEM_SCHEMAS`
filter already in `PostgresService` (`pg_catalog`, `information_schema`,
`pg_toast`) should exclude catalog noise.

### 3.2 Cassandra — no FKs (out of scope / heuristic only)

Cassandra has no referential-integrity catalog; there is nothing authoritative
to read. `system_schema.tables` / `system_schema.columns` describe partition and
clustering keys but encode no cross-table references. Options, in order of
preference:

1. **Out of scope (recommended for v1).** `getTableRelations` returns an empty
   edge list with `engine: "cassandra"` and `supported: false`. The ERD button
   and FK affordances simply do not appear for Cassandra profiles.
2. **Heuristic inference (explicitly deferred).** Could guess edges from naming
   conventions (a `customer_id` column where a `customers` table has an `id`
   partition key). This is a guess, never a guarantee — Cassandra denormalizes
   on purpose and "the same id in two tables" is the norm, not a relation. If
   ever built it must be clearly labelled "inferred (heuristic)" in the UI and
   gated behind an opt-in, never presented as ground truth.

v1 ships option 1.

### 3.3 Redis — not applicable

Redis has no schema and no tables (`AdapterSchema` `{ kind: "redis" }` is the
empty variant). `getTableRelations` is never offered for Redis profiles; the
handler rejects it the same way other table ops reject Redis via the
`unsupported(...)` helper in `schemaHandlers.ts`.

## 4. Data model + IPC contract additions

All additions are **additive** — no existing channel, payload, or signature
changes. New types live in `src/core/shared/messages.ts` alongside
`TableSchemaPayload` / `PreviewRowsPayload`.

### 4.1 New shared types (`src/core/shared/messages.ts`)

```ts
/** One foreign-key edge: src columns reference tgt columns, in order. */
export interface TableRelationEdge {
  /** Engine-native constraint name (Postgres conname); "" if synthesised. */
  name: string;
  /** Direction relative to the queried table, when querying one table. */
  direction: "outbound" | "inbound";
  source: { keyspace: string; table: string; columns: string[] };
  target: { keyspace: string; table: string; columns: string[] };
  /** True only for authoritative catalog edges; false for heuristic guesses. */
  authoritative: boolean;
}

export interface TableRelationsPayload {
  /** Echoes which engine produced these (drives UI labelling). */
  engine: "cassandra" | "postgres" | "redis";
  /** False when the engine cannot report relationships (Cassandra/Redis). */
  supported: boolean;
  edges: TableRelationEdge[];
}
```

`columns` are ordered to line up positionally (`source.columns[i]` →
`target.columns[i]`), matching the SQL above. Single-column FKs are the common
case; multi-column composite keys are represented naturally.

### 4.2 New IPC channel

A single channel covers both the single-table (FK-nav) and whole-schema (ERD)
queries via an optional `table` argument. When `table` is omitted, return every
edge in the keyspace/schema; when present, return that table's inbound +
outbound edges.

Touch points (every one is required when adding a `CassandraDeskApi` method, per
the project's contract rules):

1. **`src/core/ipc.ts`** — add to the `CassandraDeskApi` interface and the
   `ipcChannels` map:

   ```ts
   // interface CassandraDeskApi
   getTableRelations(
     profileId: string,
     keyspace: string,
     table?: string,
   ): Promise<TableRelationsPayload>;

   // ipcChannels
   getTableRelations: "table:get-relations",
   ```

   (`keyspace` is the Postgres schema name under the existing documented
   overload in `schemaHandlers.ts`.)

2. **`src/preload/index.ts`** — add to the `api` object, mirroring `getPreview`:

   ```ts
   getTableRelations: (profileId, keyspace, table) =>
     ipcRenderer.invoke(ipcChannels.getTableRelations, profileId, keyspace, table),
   ```

3. **`src/main/handlers/schemaHandlers.ts`** — add a dispatch beside
   `getTableSchema` / `getPreview`:

   ```ts
   [ipcChannels.getTableRelations]: async (
     profileId: string,
     keyspace: string,
     table?: string,
   ): Promise<TableRelationsPayload> => {
     const profile = await requireProfile(profileId);
     if (profile.type === "postgres")
       return postgres.fetchTableRelations(keyspace, table);
     if (profile.type === "cassandra")
       return { engine: "cassandra", supported: false, edges: [] };
     throw unsupported("getTableRelations", profile); // redis
   },
   ```

4. **`test/App.test.tsx`** — add `getTableRelations: vi.fn()` to the `api` mock
   object (otherwise `tsc` fails on the test file, per the contract rules).

5. **Engine method** — new `PostgresService.fetchTableRelations(schema, table?)`
   returning `TableRelationsPayload`, built from the §3.1 query. Cassandra needs
   no method in v1 (the handler returns the unsupported payload inline).

This keeps the change set small and parallel to the existing
schema/preview/DDL trio.

## 5. ERD rendering approach

### 5.1 Library vs. hand-rolled
Two realistic options, both dependency-conscious:

- **`@xyflow/react` (React Flow).** Purpose-built for node/edge graphs, pan/zoom,
  custom node components, handles. Adds one substantial dependency. Best if the
  ERD is meant to grow (collapsible nodes, column-level edges, manual layout).
- **Hand-rolled SVG/HTML.** Table nodes as positioned `<div>`s, edges as SVG
  `<path>`s between anchor points, pan/zoom via a CSS transform on a wrapper.
  Zero new runtime deps, matches the "dependency-light" house style, but we own
  layout, edge routing, and hit-testing.

Recommendation: **hand-rolled SVG/HTML for v1** (read-only diagram, modest table
counts), revisiting React Flow only if interaction demands grow. Either way the
component is self-contained under
`src/renderer/components/erd/` and reads from a new
`src/renderer/store/relations.ts` zustand store (same shape/pattern as
`store/schema.ts`).

### 5.2 Auto-layout
The diagram needs node positions; we will not ask users to place tables. Options:

- **Layered / Sugiyama** (good for mostly-acyclic FK graphs — edges flow one
  direction). `dagre` or `elkjs` produce coordinates we feed to the renderer.
  `dagre` is small and battle-tested; `elkjs` is heavier but higher quality.
- **Force-directed** (`d3-force`). Handles cycles gracefully, needs settling
  time, less predictable.
- **Naive grid** for v1: bucket tables into columns by FK depth (roots with no
  outbound FKs first), stack within a column. No new dependency; good enough to
  ship and to validate the feature before investing in `dagre`.

Recommendation: ship the **naive depth-bucket grid** first; adopt `dagre` if/when
diagrams get dense. Layout runs once per `TableRelationsPayload` (memoised on the
edge set), so it is cheap and re-runs only on schema refresh.

### 5.3 Where it hangs in the UI
The workspace already has tabs (`useLayoutStore.setActiveTab("data")`). Add an
"ERD" tab/view alongside "data" that, for the selected keyspace/schema, calls
`getTableRelations(profileId, keyspace)` (no `table` arg) and renders the graph.
Clicking a node opens that table via the existing
`useSchemaStore.openTable(...)`; clicking an edge can highlight the participating
columns.

## 6. "Click a FK cell → open the referenced row" UX

This is the v1 headline and reuses machinery that already exists.

### 6.1 Marking FK cells
`DataPanel.tsx` already loads `schema` and `preview` for the selected table. It
additionally fetches `getTableRelations(profileId, keyspace, table)` (outbound
edges) and passes a derived `Map<columnName, TableRelationEdge>` down to
`DataTable.tsx`. A column whose name appears as a single-column outbound FK
source renders its cells with a subtle affordance (an arrow glyph / underline on
hover), parallel to how the grid already styles cells. The mapping is the only
new prop; non-FK columns are unaffected.

### 6.2 The navigation action
Clicking the affordance (not the whole cell — single click still drives the
existing row-detail expansion via `expandedRowKey` in `DataTable.tsx`) triggers:

1. Build the target `TableIdentity` from the edge's `target.keyspace` /
   `target.table` plus the current `profileId` / `profileName`.
2. `useSchemaStore.openTable(targetTable)` — the existing path that loads schema
   + preview and switches to the data tab.
3. Apply a filter for `target.columns[i] = <cell value>` so the referenced row
   is the one shown. This composes naturally with **Stream 6** (server-side
   filter / keyset pagination): if that lands, pass the equality filter through
   `getPreview`'s new optional `query` argument
   (`{ filters: [{ column, op: "eq" }], value }`) so the server returns exactly
   the referenced row. Until then, the renderer applies the same equality as a
   client-side filter over the loaded page (the existing `DataTableFilters`
   path), which is correct for the common case where the target PK row is on the
   first preview page; the spec notes the limitation and defers the precise fetch
   to the Stream 6 contract.
4. Auto-expand the matched row using the existing `RowDetailPanel` so the user
   lands directly on the referenced record's detail view.

Composite FKs apply one equality per `columns[i]` pair. Inbound edges ("what
references this row") are a natural follow-up: the same `getTableRelations` call
with `direction: "inbound"` powers a "referenced by" affordance in
`RowDetailPanel`, opening the child table filtered to the parent key.

### 6.3 Why this is low-risk
Every step above is an existing capability — `openTable`, the filter UI, and
`RowDetailPanel` are all in place. The new surface area is: one IPC call, one
column→edge map, one click handler, and (optionally) one extra `getPreview`
argument shared with Stream 6.

## 7. Phasing

- **Phase 0 — contract.** Add the `TableRelationEdge` / `TableRelationsPayload`
  types and the `getTableRelations` channel across `ipc.ts`, preload,
  `schemaHandlers.ts`, the `App.test.tsx` mock, and
  `PostgresService.fetchTableRelations`. No UI. Unit-test the SQL builder.
- **Phase 1 — FK navigation (headline).** Mark outbound-FK cells in
  `DataTable.tsx`; wire the click-to-open-referenced-row flow through
  `openTable` + a filter. Client-side filter fallback until Stream 6 lands.
- **Phase 2 — inbound edges.** "Referenced by" affordance in `RowDetailPanel`.
- **Phase 3 — ERD view.** New `erd/` component + `store/relations.ts`, naive
  grid layout, node click → `openTable`, edge highlight.
- **Phase 4 — polish.** Adopt `dagre` layout if diagrams get dense; composite-FK
  edge labels; optional Cassandra heuristic inference behind an opt-in flag.

FK navigation (Phases 0–1) delivers most of the value and ships independently of
the ERD.

## 8. Risks

- **Catalog query cost on large schemas.** A database with thousands of FKs
  returns a large edge set. Mitigation: scope by schema for the ERD, scope by
  table for navigation; memoise; the array-aggregation subqueries are
  per-constraint and bounded.
- **Postgres-schema overload.** `TableIdentity.keyspace` doubling as the pg
  schema name is an existing, documented wart (`schemaHandlers.ts`). The new
  channel inherits it; we keep the same convention rather than diverging.
- **Composite & cross-schema FKs.** Multi-column and cross-schema references must
  be handled in both the SQL (already ordered above) and the navigation filter
  (one equality per column pair). Edges whose target lies in a system schema are
  filtered out.
- **Stale relationships after DDL changes.** Edges are cached per the relations
  store; a schema refresh (`refreshSchema`) must also invalidate cached
  relations, mirroring how `reloadSelectedTable` invalidates the preview cache.
- **Cassandra false expectations.** Surfacing any heuristic edges as if they were
  real would mislead. v1 avoids this entirely by reporting `supported: false`.
- **ERD layout quality.** The naive grid can produce crossing edges on dense
  graphs. Accepted for v1; `dagre` is the escape hatch.

## 9. Testing strategy

- **SQL builder unit tests.** Pure-function tests over the `fetchTableRelations`
  query construction (schema-scoped vs. table-scoped, identifier quoting),
  mirroring the existing query-builder tests in the repo's vitest suite. No live
  DB needed — assert the generated SQL string and bound parameters.
- **Payload mapping tests.** Given mocked `pg_constraint` rows, assert the
  produced `TableRelationsPayload` (column ordering, direction, `authoritative`).
- **Handler dispatch test.** Extend `test/ipcHandlers.test.ts`: a Postgres
  profile routes to `postgres.fetchTableRelations`; a Redis profile throws via
  `unsupported(...)`; a Cassandra profile returns the
  `supported: false` payload. Mirrors the existing dispatch tests.
- **Mock contract test.** Confirm `test/App.test.tsx`'s `api` mock includes
  `getTableRelations` so `tsc` stays green.
- **Renderer behaviour test.** A focused render test: given a preview with a
  column present in the relations map, clicking the FK affordance invokes
  `openTable` with the target `TableIdentity` and the expected filter. Pure
  enough to test without a live backend.
- **E2E (future, Stream 10).** Once the Docker E2E harness exists, add a
  connect → browse `orders` → click `customer_id` → land on the `customers`
  row scenario against a seeded Postgres instance.

## 10. Files this feature would touch

- `src/core/shared/messages.ts` — new `TableRelationEdge` / `TableRelationsPayload`.
- `src/core/ipc.ts` — interface method + `ipcChannels.getTableRelations`.
- `src/preload/index.ts` — `api.getTableRelations` wiring.
- `src/main/handlers/schemaHandlers.ts` — per-engine dispatch.
- `src/core/postgres/PostgresService.ts` — `fetchTableRelations` (pg_constraint query).
- `src/renderer/store/relations.ts` — new zustand store (pattern: `store/schema.ts`).
- `src/renderer/features/workspace/DataPanel.tsx` — fetch relations, derive column→edge map.
- `src/renderer/components/ui/data-table/DataTable.tsx` / `DataTableBody.tsx` — FK cell affordance + click handler.
- `src/renderer/components/ui/data-table/RowDetailPanel` (in `DataTable.tsx`) — "referenced by" (Phase 2).
- `src/renderer/components/erd/` — new ERD view (Phase 3).
- `test/App.test.tsx` — `getTableRelations: vi.fn()` mock entry.
- `test/ipcHandlers.test.ts` — dispatch tests.
- New `test/tableRelations.test.ts` — SQL builder + payload mapping tests.
