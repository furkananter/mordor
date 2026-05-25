# Mordor

Multi-database desktop workbench for macOS, Windows, and Linux.

## Supported databases

- **Apache Cassandra** — keyspaces, tables, CQL console, schema scripts, migrations.
- **Redis** — DB browser, key inspector, ad-hoc command palette.
- **PostgreSQL** — schemas (tables + views), table preview, SQL console, table DDL.

## Features

- Detect local Cassandra / Postgres / Redis instances on their default ports.
- Store connection metadata locally while keeping passwords in the OS keychain.
- Browse connections and their schemas/keyspaces/databases from a compact sidebar.
- Select a table to auto-load schema and a `LIMIT 100` preview.
- Per-engine workspace: CQL for Cassandra, SQL for Postgres, command palette for Redis.

## Development

```sh
npm install
npm run compile
npm test
npm run build
npm run dev
```

## Packaging

Create an unpacked build:

```sh
npm run package
```

Create platform installers with electron-builder:

```sh
npm run dist
```

Targets:

- macOS: `dmg`, `zip`
- Windows: `nsis`
- Linux: `AppImage`

## Data Storage

Profile metadata is stored in the Electron user data directory as `profiles.json`.
Passwords are stored through OS keychain integration via `keytar` using:

- service: `mordor`
- account: `connection:<profileId>:password`
