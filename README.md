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

### Cutting a release (recommended: CI)

The `.github/workflows/release.yml` workflow does the multi-platform build and
publish on every tag push. Day-to-day flow:

```sh
# bump the version, create the matching tag, commit it
npm version patch -m "chore: release v%s"
# or `npm version minor` / `npm version major`

# push the commit AND the tag
git push --follow-tags
```

That fires off three matrix jobs (`macos-latest`, `ubuntu-latest`,
`windows-latest`) — each runs `electron-builder --publish always`, which
creates a draft GitHub Release matching the new version and uploads its
artifacts to it. The job uses the built-in `GITHUB_TOKEN`, no PAT needed.

When all platforms finish, open the draft release on GitHub, edit notes,
hit **Publish release**. Connected Mordor clients pick it up on their next
check (the manifest read is what auto-updater watches; draft releases don't
count, only published ones).

### Cutting a release (manual fallback)

When the workflow is unavailable or you want to test locally first:

```sh
GH_TOKEN=<your-github-pat> npx electron-builder --publish always
```

The PAT needs `public_repo` (or `repo` for private repos) scope. This builds
only the host's native platform — multi-arch + multi-OS still wants the
workflow. The existing `npm run dist:*` scripts produce unpublished
artifacts in `release/` if you just want to inspect them.

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
