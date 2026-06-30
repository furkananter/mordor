# Design spec: MongoDB engine

Status: proposed (design only — no implementation in this document)

## Problem & motivation

Mordor is a multi-database workbench that today speaks Cassandra, PostgreSQL,
and Redis through a small set of engine-agnostic abstractions: a tagged
`ProfileType` union, an `AdapterRegistry` of `DatabaseAdapter`s, a shared
schema/preview/row payload vocabulary, and a single set of IPC channels that
dispatch per `profile.type`. Several places in the codebase already anticipate a
fourth engine:

- `src/core/db/types.ts` lists `mongodb` explicitly in the doc comment for
  `AdapterSchema` ("As we add more databases (postgres, mongodb, …) we extend
  this union…").
- `src/main/handlers/schemaHandlers.ts` documents that `TableIdentity.keyspace`
  is "a temporary semantic overload … until the MongoDB branch lands (where the
  field will be properly generalized)."

MongoDB is the most-requested engine that does not fit the relational mental
model: it is schemaless, document-oriented, and its closest analogues to
"keyspace / table / row" are "database / collection / document". This spec
describes how a Mongo engine plugs into the existing architecture, how Mongo
concepts map onto the shared payloads, and the CRUD / export / connection
surface area — concretely, against the real files and types.

## Goals

- Add `mongodb` as a first-class `ProfileType` that reuses the existing adapter,
  IPC, and renderer plumbing with the smallest possible set of new abstractions.
- Browse databases → collections in the sidebar tree; preview documents in the
  existing `DataTable`; inspect full documents via the existing row-detail JSON
  view.
- CRUD on documents (insert / update / delete) keyed by `_id`, mirroring the
  `insertRow` / `updateRow` / `deleteRows` contracts.
- Reuse the export pipeline (`src/core/export`) for collections.
- Compose with the planned SSH tunneling work (Stream 5) so Mongo behind a
  bastion works the same way as Postgres/Cassandra.

## Non-goals

- Aggregation-pipeline authoring UI, map-reduce, or change streams.
- Schema *enforcement* or migration tracking (Mongo is schemaless; the
  migrations feature stays Cassandra/Postgres-only).
- A bespoke document editor beyond what the existing row dialog / JSON view
  offers. Rich nested-document editing is a follow-up.
- Multi-document ACID transactions across collections (single-document atomicity
  only, which is all the CRUD paths need).

## How a new engine plugs in

This is the canonical checklist for adding an engine, derived from how Postgres
was added. Each item names the real file.

### 1. `ProfileType` union + profile / draft / validators

`src/core/config/profile.ts`

- Extend the union: `export type ProfileType = "cassandra" | "redis" | "postgres" | "mongodb";`
- Add the profile interface:

  ```ts
  export interface MongoProfile extends BaseProfile {
    type: "mongodb";
    host: string;
    port: number;
    /**
     * Default database the workbench opens to. Mongo URIs can omit a db; we
     * surface it as a profile field so the sidebar has a deterministic root,
     * mirroring how PostgresProfile pins one `database` per profile.
     */
    database?: string;
    /** Replica-set name, when connecting to a replica set rather than a single mongod. */
    replicaSet?: string;
    /** Auth source db (defaults to `admin` when a username is set). */
    authSource?: string;
  }
  ```

- Add `MongoConnectionDraft` next to the other drafts. Like
  `PostgresConnectionDraft`, support a pasted `connectionString?: string`
  (`mongodb://` / `mongodb+srv://`) that, when present, overrides the individual
  fields on save — reuse the precedence comment Postgres already documents.
- Add to the `ConnectionProfile` and `ConnectionDraft` unions, plus the
  `isMongoProfile` type guard (sibling of `isPostgresProfile`).
- Add `validateMongoStored(candidate)` and route it from
  `validateStoredProfile` (extend the `rawType === "redis" || rawType === "postgres"`
  dispatch to also recognize `"mongodb"`; the Cassandra back-compat fallback
  stays untouched).
- Extend `createProfileFromDraft` with a `draft.type === "mongodb"` branch.
  Default port 27017. Parse the connection string with a
  `parseMongoConnectionString` helper modeled on `parsePostgresConnectionString`
  (use the global `URL`; `mongodb+srv://` implies TLS and SRV resolution — the
  driver handles SRV, the parser only needs host/db/user/pass/`authSource`).
- `secretKeyForProfile` already namespaces by profile id, so the Mongo password
  is stored in `SecretStore` exactly like the others — no change needed there.
- Extend `profileAddress` with a `mongodb` arm: `` `${profile.host}:${profile.port}` `` (append `/${database}` when set).

> Strict-tsconfig reminders that bit the Postgres work and will bite here:
> `exactOptionalPropertyTypes` (only assign optional fields when defined — keep
> the `if (x) profile.x = x` pattern) and `noUncheckedIndexedAccess` (guard
> array/record index reads).

### 2. `MongoService` — the engine package

`src/core/mongo/MongoService.ts` (+ `src/core/mongo/types.ts`,
`src/core/mongo/serialize.ts`)

Mirror `PostgresService`: own the driver lifecycle, keep one client per
connected `profileId`, and expose the same method surface the schema handlers
call. Use the **lazy driver import** pattern from `PostgresAdapter`/`PostgresService`
so `mongodb` stays out of the boot path until a Mongo profile is touched:

```ts
let mongoDriverPromise: Promise<typeof import("mongodb")> | undefined;
async function loadMongoDriver() {
  if (!mongoDriverPromise) mongoDriverPromise = import("mongodb");
  return mongoDriverPromise;
}
```

Methods (signatures match the Postgres/Cassandra services so the handlers stay
uniform):

- `connect(profile: ConnectionProfileWithPassword): Promise<MongoDatabaseNode[]>`
  — open a `MongoClient`, `listDatabases()`, and for each db `listCollections()`.
  Return the tree (see `types.ts` below). Filter admin/internal dbs
  (`admin`, `local`, `config`) the way Postgres filters `pg_catalog` /
  `information_schema`.
- `disconnect(profileId)`, `isConnected(profileId)`, `getDatabases(profileId)`,
  `refreshSchema(profileId)`, `dispose()`.
- `fetchTableSchema(table): Promise<TableSchemaPayload>` — see "schema sampling".
- `fetchPreviewRows(table, pageState?): Promise<PreviewRowsPayload>` — see
  "preview / paging".
- `insertRow`, `updateRow`, `deleteRows` — see "CRUD mapping".
- `exportTable` / `exportSchema` / `exportAll` — see "export".

`types.ts`:

```ts
export interface MongoDatabaseNode {
  name: string;
  collections: MongoCollectionNode[];
}
export interface MongoCollectionNode {
  name: string;
  /** True for time-series / view-backed collections, so the sidebar can mark them read-only. */
  readOnly?: boolean;
}
```

This is the Mongo analogue of `PostgresSchemaNode` /
`PostgresTableNode`.

### 3. `MongoAdapter`

`src/main/adapters/MongoAdapter.ts`

A thin envelope over `MongoService`, identical in shape to `PostgresAdapter`:

```ts
export class MongoAdapter implements DatabaseAdapter {
  readonly type = "mongodb" as const;
  constructor(private readonly service: MongoService) {}

  async connect(profile: ConnectionProfileWithPassword): Promise<AdapterConnectResult> {
    if (profile.type !== "mongodb") throw new Error("MongoAdapter received non-Mongo profile.");
    const databases = await this.service.connect(profile);
    return { schema: { kind: "mongodb", databases } };
  }
  disconnect(profileId) { return this.service.disconnect(profileId); }
  isConnected(profileId) { return this.service.isConnected(profileId); }
  getSchema(profileId) { return { kind: "mongodb", databases: this.service.getDatabases(profileId) }; }
  disposeAll() { return this.service.dispose(); }
}
```

`detectLocal` is optional on `DatabaseAdapter`; a first cut can omit it, or probe
`127.0.0.1:27017` with a TCP check the way `PostgresAdapter.detectLocal` does
(no credential matrix needed — Mongo dev instances are typically auth-less).

### 4. `AdapterRegistry` registration

`src/main/handlers/index.ts`

In `createMainContext`, construct the service + adapter and register it next to
the others:

```ts
const mongo = new MongoService();
...
adapters.register(new MongoAdapter(mongo));
return { store, cassandra, postgres, redis, mongo, adapters };
```

Add `mongo: MongoService` to the `MainContext` interface and thread it into
`createSchemaHandlers(ctx.store, ctx.cassandra, ctx.postgres, ctx.mongo)` and the
export handlers.

### 5. `AdapterSchema` tagged-union variant

`src/core/db/types.ts`

- Add the variant: `| { kind: "mongodb"; databases: MongoDatabaseNode[] }`.
- Add the `case "mongodb"` arm to `emptySchemaFor` returning
  `{ kind: "mongodb", databases: [] }`. The existing `never` exhaustiveness
  guard in the `default` branch will produce a compile error until this is done
  — exactly the "compiler reminding you" behaviour the comment promises.
- This also forces a new arm in `src/core/ipc.ts`: add `MongoProfileListItem`
  (`MongoProfile & { connected: boolean; schema: Extract<AdapterSchema, { kind: "mongodb" }> }`)
  to the `ProfileListItem` union.

### 6. `schemaHandlers` dispatch

`src/main/handlers/schemaHandlers.ts`

Add a `profile.type === "mongodb"` arm to each handler that Mongo supports,
routing to `mongo.*`:

- `refreshSchema` → `{ kind: "mongodb", databases: await mongo.refreshSchema(profileId) }`
  (and extend the exhaustiveness `never` check to cover the new type).
- `getTableSchema`, `getPreview`, `insertTableRow`, `updateTableRow`,
  `deleteTableRows`, `getTableDdl` (returns a synthetic `createCollection` /
  index summary), `runSelectQuery` (see "query console" below).
- `runSchemaScript` and the migration handlers stay unsupported for Mongo (the
  `unsupported(op, profile)` helper already produces a clear message).

### 7. Sidebar tree

`src/renderer/features/connections/ConnectionTree.tsx` /
`ConnectionNode.tsx` / `PostgresSchemaList.tsx`

The renderer narrows on `profile.type` / `schema.kind`. Add a Mongo branch that
renders `databases → collections` using the same `PostgresSchemaList` shape
(schema→tables maps cleanly to database→collections). A `MongoDatabaseList`
component parallel to `PostgresSchemaList` is the cleanest fit. Selecting a
collection builds a `TableIdentity` (see overload note below) and opens the
existing `TableWorkspace` / `DataPanel`. A Mongo `ConnectionForm` section adds
host/port/database/replica-set/auth fields plus the optional connection-string
paste box, paralleling the Postgres form.

## Mapping Mongo concepts onto the shared payloads

The whole point of the existing abstraction is that Cassandra and Postgres share
`TableIdentity` / `TableSchemaPayload` / `PreviewRowsPayload`
(`src/core/shared/messages.ts`). Mongo reuses them with this mapping:

| Shared field | Mongo meaning |
| --- | --- |
| `TableIdentity.keyspace` | database name |
| `TableIdentity.table` | collection name |
| `TableSchemaPayload.columns` | sampled top-level field names + inferred types |
| `TableSchemaPayload.partitionKeys` | `["_id"]` (always; it is the document key) |
| `TableSchemaPayload.clusteringKeys` | `[]` |
| `PreviewRowsPayload.rows` | documents flattened to `Record<string,string>` |

### `TableIdentity.keyspace` overload

Postgres already reinterprets `keyspace` as "schema name" (documented in
`schemaHandlers.ts`). Mongo reinterprets it as "database name". Rather than
rename the field across the whole contract, this spec proposes keeping the
overload but **adding a doc comment to `TableIdentity`** enumerating the
per-engine meaning (Cassandra keyspace / Postgres schema / Mongo database). A
later, separate refactor can rename it to a neutral `namespace` — out of scope
here to keep the Mongo change additive.

### Schemaless handling — schema sampling

Mongo has no declared schema, so `fetchTableSchema` *samples*: read N documents
(e.g. 100, configurable) via `find().limit(N)` or the `$sample` aggregation,
union their top-level keys, and infer a coarse type per key (`string`, `number`,
`boolean`, `objectId`, `date`, `array`, `object`, `null`/mixed). Produce
`ColumnMetadata` with `kind: "regular"` for every field except `_id`
(`kind: "partition_key"`, `position: 0`). `position` is `null` for the rest
(matches how Postgres fills non-key columns). The column set is a *hint*, not a
guarantee — documents missing a sampled field render as empty cells, and
documents with extra fields beyond the sample are still shown in full in the
row-detail view.

### Projecting nested docs into the `Record<string,string>` grid

`PreviewRowsPayload.rows` is `Record<string,string>[]` — a flat grid of strings.
A Mongo document is a nested BSON tree. The projection rule (in
`src/core/mongo/serialize.ts`):

- Top-level scalar (`string`/`number`/`boolean`/`null`) → its string form.
- `ObjectId` → its 24-char hex string. `Date` → ISO-8601. `Decimal128`/`Long`
  → their string form. `Binary` → a `Binary(<base64>, <subtype>)` placeholder.
- Nested object or array → a compact JSON string (`JSON.stringify`), so the grid
  cell shows `{"a":1,"b":[…]}`. The cell stays readable and copy-pasteable.

Crucially, the **full structured document** is preserved for the row-detail
view. The row-detail JSON view already renders structured values (it is what
makes Cassandra UDTs / collections and Postgres `jsonb` readable today), so
clicking a row shows the real nested document, pretty-printed — no information is
lost in the flattening; the grid is just the lossy summary. The serializer must
expose both the flattened `Record<string,string>` (for the grid) and the raw
JSON document (for the detail view); the existing payload already carries the
JSON string in the cell, and the detail view re-parses it.

### Preview / paging

`fetchPreviewRows(table, pageState?)` returns a page of documents:

- `limit`: the page size, surfaced in `PreviewRowsPayload.limit` like the others.
- Paging: encode the **last seen `_id`** into `pageState` (base64 of the
  `_id`'s canonical extended-JSON), and the next page does
  `find({ _id: { $gt: <lastId> } }).sort({ _id: 1 }).limit(N)`. This is a
  keyset cursor on `_id` — cheap, stable, and the natural Mongo equivalent of
  Cassandra's `pageState` / the keyset approach Stream 6 proposes for Postgres.
  When no `pageState` is given, start from the beginning sorted by `_id`.
- `columns` is the sampled field union (stable across pages so the grid does not
  reshuffle); `_id` is always the first column.

## Driver choice & connection

- Driver: the official **`mongodb`** Node driver (added to `package.json`
  `dependencies`). It is pure-JS at the API surface (the optional native BSON
  addon is not required — the driver falls back to JS BSON), so it installs
  without a native rebuild, matching the `ssh2` / `pg` "no native rebuild"
  constraint.
- Connection: build a `MongoClient` from either the pasted `mongodb://` /
  `mongodb+srv://` URI or the structured fields. Credentials come from
  `SecretStore` (never the plaintext profile JSON), looked up with
  `secretKeyForProfile(profile.id)` — identical to Postgres/Cassandra/Redis.
  Map `useTls` → `tls: true`; carry `replicaSet`, `authSource`. Set a sane
  `serverSelectionTimeoutMS` so a dead host fails fast in the UI.
- **SSH-tunnel synergy (Stream 5):** when `profile.ssh` is present (the optional
  field Stream 5 adds to `BaseProfile`), open the tunnel first via the shared
  `SshTunnel` manager and point the `MongoClient` at the returned
  `127.0.0.1:<ephemeral>` local endpoint, then close the tunnel on disconnect —
  exactly the integration Stream 5 describes for `CassandraService.connect` /
  `PostgresService.connect` / `RedisAdapter`. For `mongodb+srv://` (which
  resolves multiple hosts), the first phase tunnels only the seed host; full
  replica-set-over-SSH is a documented limitation (single-host or
  `directConnection=true` works cleanly; multi-host SRV behind a bastion is a
  follow-up).

## CRUD mapping (by `_id`)

The shared CRUD contract passes `keys` and `values` as `Record<string,string>`.
For Mongo, the key is always `_id`.

- **Insert** — `insertTableRow(table, values)` → `insertRow`. `values` is a
  `Record<string,string>`; the field whose value is a JSON document string is
  parsed back to BSON (the row dialog can submit a single `document` JSON field,
  or per-sampled-field values). If `_id` is omitted, let the driver generate an
  `ObjectId`. Return `{ inserted: 1 }`. Type coercion uses the sampled schema as
  a hint (a field sampled as `number` parses the string to a number); unknown
  fields default to string. Document the coercion rules in a comment — this is
  the schemaless tax.
- **Update** — `updateTableRow(table, keys, values)` → `updateRow`. Parse
  `keys["_id"]` (string → `ObjectId` if it is a valid 24-hex, else use as-is for
  string/number `_id`s) and run
  `updateOne({ _id }, { $set: <coerced values> })`. Return `{ updated: result.modifiedCount }`.
  This composes with **inline cell editing (Stream 4)**: `editableColumn` =
  every field except `_id`, and `onCommit` calls `updateTableRow` with
  `{ _id }` + `{ [column]: value }` — no Mongo-specific renderer code needed.
- **Delete** — `deleteTableRows(table, rows)` → `deleteRows`. Each row supplies
  its `_id`; build `deleteMany({ _id: { $in: [...] } })` (or per-row
  `deleteOne` in a loop) and return `{ deleted: result.deletedCount }`. Reject
  rows missing/blank `_id`, matching the Cassandra/Postgres "must supply all key
  values" guard. This unblocks the same generic delete UX Stream 1 wires for
  Postgres — no renderer change.

`_id` parsing lives in one helper (`coerceObjectId`) so insert/update/delete
agree on how a string `_id` becomes a query value.

### Query console

`runSelectQuery` has no SQL analogue in Mongo. Two options, in phasing order:

1. **Phase A (recommended first):** keep the CQL/SQL console disabled for Mongo
   profiles (the renderer already hides engine-specific affordances by
   `profile.type`); browsing + CRUD via the grid is the primary path.
2. **Phase B:** accept a JSON **find filter** (and optional projection / sort /
   limit) in the console — e.g. the user types `{ "status": "active" }` and it
   runs `find(filter)` and returns a `QueryResultPayload`. This is a small,
   safe, read-mostly surface and keeps the "never auto-execute writes" posture.
   A full aggregation-pipeline editor is explicitly out of scope.

## Export

The export pipeline (`src/core/export`) is engine-agnostic: the dispatcher
branches on `profile.type` and each engine implements
`exportTable` / `exportSchema` / `exportAll`. Mongo:

- `exportTable` (one collection) → newline-delimited JSON (one document per line,
  canonical extended JSON to preserve `ObjectId`/`Date` types) as the data
  artifact, plus a small schema artifact listing indexes and a synthetic
  `createCollection`. CSV export is *available* via the existing CSV writer
  using the sampled columns, with the same nested-doc-as-JSON-string flattening
  the grid uses (documented lossy).
- `exportSchema` (one database) → loop its collections.
- `exportAll` → loop databases.
- `ExportRequest.keyspace` carries the database name and `table` the collection,
  reusing `ExportTableTarget` / `ExportScopeTarget` unchanged. `redisDb` stays
  ignored. Add the `mongodb` arm to the export dispatcher and the export
  handlers wiring in `src/main/handlers/index.ts`.

## Phasing

1. **Phase 0 — plumbing & read-only browse:** `ProfileType`, profile/draft/
   validators, `MongoService.connect` + schema sampling + `fetchPreviewRows`,
   `MongoAdapter`, `AdapterSchema` variant, registry + `schemaHandlers`
   read dispatch, sidebar tree, connection form. Outcome: connect → browse
   databases/collections → preview documents → inspect full doc in row-detail.
2. **Phase 1 — CRUD:** `insertRow` / `updateRow` / `deleteRows` by `_id`; wires
   into the existing row dialog, inline-edit (Stream 4), and delete (Stream 1)
   UX with no renderer-specific Mongo code.
3. **Phase 2 — export + JSON find console + SSH tunnel integration.**
4. **Phase 3 — niceties:** index inspection in the schema tab, `detectLocal`
   probe, `mongodb+srv` replica-set polish, richer type coercion on write.

## Risks

- **`keyspace` overload debt.** Reusing `TableIdentity.keyspace` for a *third*
  meaning (database) deepens the existing semantic overload. Mitigation: add the
  per-engine doc comment now; schedule the neutral `namespace` rename as a
  separate, contract-wide refactor (it touches every engine, so it must not ride
  along with the Mongo PR).
- **Schemaless → flat grid is lossy.** Users may not realize a cell showing
  `{…}` is a collapsed subtree. Mitigation: the row-detail JSON view shows the
  real document; consider a subtle "expand" affordance on JSON cells (UI
  follow-up). The sampled column set can also miss rare fields — documented as a
  hint, not a guarantee.
- **Type coercion on write.** Turning grid strings back into BSON types
  (ObjectId/Date/number/Decimal128) is inherently ambiguous. Mitigation: prefer
  a single-`document` JSON editing path for inserts/edits where types are
  explicit; use sampled types only as a fallback hint and document the rules.
- **`mongodb+srv` + SSH tunnels.** SRV resolves multiple hosts; tunneling all of
  them is non-trivial. Mitigation: support single-host / `directConnection`
  behind SSH first; document the multi-host limitation.
- **Driver footprint & boot cost.** The `mongodb` driver is sizable. Mitigation:
  the lazy-import pattern keeps it out of the boot path for users who never open
  a Mongo profile — same as `pg`.
- **Large documents / wide collections.** A 16 MB document or a collection with
  hundreds of distinct fields stresses the grid. Mitigation: cap sampled columns,
  truncate giant cell JSON in the grid (full value still in row-detail), and keep
  the keyset page size modest.

## Testing strategy

Match the existing vitest unit-test posture (no live DB required for unit tests):

- **`profile.ts` validation round-trips** (extend `test/profile.test.ts`):
  `validateStoredProfile` accepts a valid Mongo profile, rejects malformed ones,
  and `createProfileFromDraft` parses `mongodb://` / `mongodb+srv://` URIs
  (host/port/db/user/pass/authSource, TLS implied by `+srv`). `exactOptionalPropertyTypes`-safe
  optional handling.
- **Serializer unit tests** (`test/mongoSerialize.test.ts`): document →
  `Record<string,string>` projection (ObjectId hex, Date ISO, Decimal128/Long,
  nested object/array → JSON string, null/missing handling) and the inverse
  coercion used on write (`coerceObjectId`, sampled-type-hinted parsing).
- **Schema sampling** (`test/mongoSchema.test.ts`): given a set of sample
  documents, the inferred `ColumnMetadata` set unions fields, marks `_id` as the
  partition key at position 0, and infers coarse types deterministically.
- **Keyset paging** (`test/mongoPreview.test.ts`): `pageState` encodes the last
  `_id`, the next query filters `_id > cursor` sorted ascending, and the column
  set is stable across pages.
- **IPC dispatch** (extend `test/ipcHandlers.test.ts`): a `mongodb` profile
  routes `getPreview` / `insertTableRow` / `updateTableRow` / `deleteTableRows`
  to the Mongo service and that `runSchemaScript` / migrations reject with the
  `unsupported(...)` message. Mirror the existing Postgres dispatch tests.
- **`test/App.test.tsx`:** if any new method is added to `CassandraDeskApi`
  (none is strictly required — Mongo reuses the existing channels), add the
  matching `vi.fn()` to the `api` mock so tsc stays green. The `AdapterSchema`
  union widening means any renderer component that switches on `schema.kind`
  exhaustively must add a `mongodb` arm; the compiler flags these.
- **Driver-touching paths** (`connect`, real CRUD against a server) are covered
  by the Stream 10 Docker E2E harness (a `mongo` service in
  `docker-compose.e2e.yml` plus a connect → browse → insert → edit → delete
  scenario), not by unit tests.

## Files this engine would touch (summary)

- `src/core/config/profile.ts` — `ProfileType`, `MongoProfile`,
  `MongoConnectionDraft`, guard, validator, `createProfileFromDraft`,
  `profileAddress`.
- `src/core/db/types.ts` — `AdapterSchema` variant, `emptySchemaFor`.
- `src/core/ipc.ts` — `MongoProfileListItem` in `ProfileListItem`.
- `src/core/shared/messages.ts` — doc comment on `TableIdentity.keyspace`.
- `src/core/mongo/MongoService.ts`, `src/core/mongo/types.ts`,
  `src/core/mongo/serialize.ts` (new).
- `src/main/adapters/MongoAdapter.ts` (new).
- `src/main/handlers/index.ts` — construct + register + thread the service.
- `src/main/handlers/schemaHandlers.ts` — Mongo dispatch arms.
- `src/core/export/*` + `src/main/handlers/export-handlers.ts` — Mongo export arm.
- `src/renderer/features/connections/` — `MongoDatabaseList`, tree + form
  branches.
- `package.json` — `mongodb` dependency.
- Tests as listed above.
