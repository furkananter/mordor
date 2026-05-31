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

> **Every change that ships to users needs a release.** A merge to `main` does
> not reach anyone on its own — clients only update when a new GitHub Release
> exists. The flow below turns "merged" into "shipped".

### Commit conventions (this is what drives the version bump)

The release tooling reads your commit messages to decide the next version, so
**every commit must follow [Conventional Commits](https://www.conventionalcommits.org/)**:

```
<type>(optional scope): <description>
```

| Commit prefix | Example | Release bump |
| --- | --- | --- |
| `feat:` | `feat(redis): add key TTL editor` | **minor** (`1.2.0` → `1.3.0`) |
| `fix:` / `perf:` / `chore:` / `docs:` / `refactor:` / … | `fix(migrations): scope list to profile` | **patch** (`1.2.0` → `1.2.1`) |
| `!` after the type, or a `BREAKING CHANGE:` footer | `feat!: drop legacy profile format` | **major** (`1.2.0` → `2.0.0`) |

The highest bump found among all commits since the last `vX.Y.Z` tag wins
(one `feat:` in the range makes the whole release a minor, one `!` makes it a
major). Anything that doesn't match a recognized type is treated as a patch, so
when in doubt prefix with `fix:` or `chore:`.

### Cutting a release (one click)

After your PR is merged to `main`:

1. Go to **Actions → "Release (cut version)" → Run workflow**.
2. Leave **bump** on `auto` to derive the version from the commits (above), or
   pick `patch`/`minor`/`major` to force a specific level.
3. Run it.

`.github/workflows/release-cut.yml` then bumps `package.json`, commits the bump
to `main` as `chore(release): vX.Y.Z`, and pushes the matching `vX.Y.Z` tag.

Pushing that tag triggers `.github/workflows/release.yml`, which fans out three
matrix jobs (`macos-latest`, `ubuntu-latest`, `windows-latest`) — each runs
`electron-builder --publish always` to create a draft GitHub Release for the
new version and upload its artifacts. Both jobs use the built-in `GITHUB_TOKEN`;
no PAT needed.

When all platforms finish, open the draft release on GitHub, edit notes, hit
**Publish release**. Connected Mordor clients pick it up on their next check
(the manifest read is what auto-updater watches; draft releases don't count,
only published ones).

### Cutting a release (manual tag, if you skip the workflow)

You can still bump and tag by hand — `release.yml` fires on any `v*` tag push:

```sh
# bump the version, create the matching tag, commit it
npm version patch -m "chore(release): v%s"
# or `npm version minor` / `npm version major`

# push the commit AND the tag
git push --follow-tags
```

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
- New version found → background download starts; a compact toast appears in
  the top-right corner with progress (it floats over the UI and does not shift
  the layout).
- Download finishes → the toast switches to **Restart to install**; clicking
  quits and relaunches into the new version.
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
