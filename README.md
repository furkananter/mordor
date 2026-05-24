# Cassandra Desk

Internal read-only Cassandra desktop workbench for macOS, Windows, and Linux.

## Features

- Detect local Cassandra nodes on common localhost ports.
- Store connection metadata locally while keeping passwords in the OS keychain.
- Browse connections, keyspaces, and tables from a compact sidebar.
- Select a table to auto-load schema and a read-only `LIMIT 100` preview.
- Keep v1 read-only: no arbitrary CQL editor, inserts, updates, deletes, or schema mutations.

## Development

```sh
npm install
npm run compile
npm test
npm run build
npm run dev
```

## Packaging

Create an unpacked internal build:

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

- service: `cassandra-desk`
- account: `connection:<profileId>:password`
