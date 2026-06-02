# macOS code signing & notarization

Signed + notarized macOS builds unlock **seamless in-app auto-update**: the app
downloads the new version in the background and applies it on restart, exactly
like the Windows/Linux builds. Without signing, the macOS build is *ad-hoc*
signed and falls back to downloading the DMG and asking the user to drag it into
Applications (still automatic download, just a manual final step).

The build is configured to switch automatically: when the signing secrets below
are present in CI, the release is signed, notarized, and the bundle is marked as
signed (`__MAC_SIGNED__`) so the updater uses the seamless path. When they're
absent, nothing changes from the old ad-hoc behavior.

> One-time transition note: users currently on an **ad-hoc** build (≤ the last
> unsigned release) will get the *next* (first signed) release via the manual
> DMG download — Squirrel can't upgrade an unsigned app in place. Every update
> **after** they're on a signed build is fully seamless.

## What you need (Apple Developer Program — you already have an account)

1. **Developer ID Application certificate**
   - Xcode → Settings → Accounts → your team → *Manage Certificates* → `+` →
     **Developer ID Application**. (Or create it in the Apple Developer portal.)
   - Export it from **Keychain Access** as a `.p12` (select the certificate
     *and* its private key → right-click → Export). Set a strong password.

2. **App-specific password** for notarization
   - <https://account.apple.com> → Sign-In and Security → **App-Specific
     Passwords** → generate one (e.g. labeled "mordor-notarize").

3. **Team ID**
   - <https://developer.apple.com/account> → Membership details → **Team ID**
     (10 characters, e.g. `A1B2C3D4E5`).

## GitHub Actions secrets to add

Repo → Settings → Secrets and variables → Actions → **New repository secret**:

| Secret name                   | Value                                                            |
| ----------------------------- | --------------------------------------------------------------- |
| `MAC_CSC_LINK`                | base64 of the `.p12` (see command below)                        |
| `MAC_CSC_KEY_PASSWORD`        | the password you set when exporting the `.p12`                  |
| `APPLE_ID`                    | your Apple ID email                                             |
| `APPLE_APP_SPECIFIC_PASSWORD` | the app-specific password from step 2                           |
| `APPLE_TEAM_ID`               | your 10-character Team ID                                       |

Encode the certificate to base64 (macOS/Linux):

```bash
base64 -i DeveloperIDApplication.p12 | pbcopy   # macOS: now paste into MAC_CSC_LINK
# or: base64 -w0 DeveloperIDApplication.p12 > cert.b64
```

That's it — the next tag push (`vX.Y.Z`) will produce a signed, notarized macOS
release. The workflow scopes these secrets to the macOS job only, so the
certificate is never exposed to the Windows/Linux signers.

## Verifying a build locally (optional)

With the same env vars exported in your shell, `npm run dist:mac` signs and
notarizes locally. To check the result:

```bash
codesign -dv --verbose=4 "release/mac-arm64/Mordor.app"   # Authority should be "Developer ID Application: …"
spctl -a -vvv -t install "release/mac-arm64/Mordor.app"   # should say "accepted / source=Notarized Developer ID"
xcrun stapler validate "release/Mordor-<version>-arm64.dmg"
```

If you build **without** the env vars, you get the ad-hoc build (the app runs
locally, but `spctl` will reject it and auto-update uses the DMG fallback).
