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

## Releasing & Auto-Updates

Mordor uses [`electron-updater`](https://www.electron.build/auto-update) against
GitHub Releases. Each released version is delivered automatically to running
clients on platforms where the build is signed.

### Cutting a release

1. Bump `version` in `package.json` (semver).
2. Build the platform artifacts you want to publish — for example all targets:

   ```sh
   npm run dist:all
   ```

3. Publish to GitHub Releases (creates a draft if the release doesn't exist):

   ```sh
   GH_TOKEN=<your-github-pat> npx electron-builder --publish always
   ```

   The PAT needs `public_repo` (or `repo` for private repos) scope. Alternatively
   run this from a CI workflow with the built-in `GITHUB_TOKEN`.

4. Open the GitHub release, edit notes, hit **Publish release**. Connected
   Mordor clients pick it up on their next check.

### Update lifecycle in the app

- Boot completes → ~10 s later the main process asks GitHub for the latest
  release manifest.
- New version found → background download starts; a one-line banner appears
  at the top of the workspace with progress.
- Download finishes → banner switches to **Restart to install**; clicking quits
  and relaunches into the new version.
- Manual control lives in **Settings → Updates**: a `Check now` button with the
  last-checked timestamp and current status.

### Platform notes

- **Linux (AppImage)**: works out of the box. Unsigned AppImages update fine.
- **Windows (NSIS)**: updates work without signing, but Windows SmartScreen
  will warn until the installer is Authenticode-signed.
- **macOS (dmg/zip)**: the bundled build is *ad-hoc signed* (`identity: "-"`).
  Squirrel's update path rejects ad-hoc signed bundles, so in-app updates are
  disabled on macOS. The Settings panel and update banner detect this and
  point users at the GitHub releases page for a manual download. To enable
  in-app updates on macOS, replace the `mac.identity` value in `package.json`
  with a Developer ID and add notarization credentials
  (`APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`) to the build
  environment.
