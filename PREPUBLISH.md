# PREPUBLISH — publishing kotoshu-vscode

Owner-only steps. Everything here needs credentials that live with the
owner, never in this repo. Once the one-time setup below is done, each
release is: bump version, push tag, done.

## One-time setup

### 1. Visual Studio Marketplace publisher

1. Sign in at <https://marketplace.visualstudio.com/manage> with the
   Microsoft account that will own the listing.
2. Click **Create publisher** (left pane).
3. Set **ID** to `kotoshu` — it must match the `publisher` field in
   `package.json`, it is permanent, and it appears in the listing URL.
   **Name** is the display name, e.g. `Kotoshu`.
4. Click **Create**.

### 2. Marketplace PAT (`VSCE_PAT`)

1. Open the Azure DevOps portal (link from the Marketplace publish docs:
   <https://go.microsoft.com/fwlink/?LinkId=307137>), or
   <https://dev.azure.com> → **User settings** (gear next to your profile) →
   **Personal access tokens**.
2. Click **New Token**:
   - **Name**: anything, e.g. `kotoshu-vscode-publish`.
   - **Organization**: **All accessible organizations** — required; a
     single-org token gets 401/403 from the Marketplace.
   - **Expiration**: your call.
   - **Scopes**: **Custom defined** → **Show all scopes** → under
     **Marketplace**, select **Manage**.
3. Click **Create** and copy the token (shown once).

Note: Microsoft is retiring full-scope PATs on 2026-12-01 in favor of Entra
ID–based publishing (`vsce publish --azure-credential`); scoped PATs as
created above keep working.

### 3. Open VSX account and token (`OPEN_VSX_TOKEN`)

1. At <https://open-vsx.org>, click the account icon (top right) and sign in
   with GitHub.
2. Open your profile → **Settings** → log in with Eclipse and **Agree** to
   the Publisher Agreement (this is not the Contributor Agreement).
3. Still under **Settings** → **Access Tokens**, click **Generate New
   Token**, give it a description, generate, and copy it (shown once).
4. Claim the namespace once:

   ```bash
   npx ovsx create-namespace kotoshu -p <token>
   ```

   See the [Open VSX publishing guide](https://github.com/eclipse/openvsx/wiki/Publishing-Extensions)
   for details, including namespace verification.

### 4. Add the repo secrets

GitHub repo → **Settings** → **Secrets and variables** → **Actions** →
**New repository secret**, twice:

| Secret name     | Value                       |
| --------------- | --------------------------- |
| `VSCE_PAT`      | the Azure DevOps PAT        |
| `OPEN_VSX_TOKEN`| the Open VSX access token   |

## Publish a release

The workflows build from source, gate on `npm run check-manifest` +
`vsce package`, verify the trigger version equals `package.json`, then
publish the same build to both registries.

1. Set the release version in `package.json` and update `CHANGELOG.md`.
2. Merge to `main` — the release workflows must exist in the tagged commit,
   so tag only after the workflow files are on `main`.
3. Tag and push:

   ```bash
   git tag vX.Y.Z && git push origin vX.Y.Z
   ```

   Both [Release (Marketplace)](.github/workflows/release-marketplace.yml)
   and [Release (Open VSX)](.github/workflows/release-ovsx.yml) run.

   Manual trigger without a tag: Actions → **Release (Marketplace)** (or
   **Release (Open VSX)**) → **Run workflow** → enter the version.

4. Verify the listings:

   - <https://marketplace.visualstudio.com/items?itemName=kotoshu.kotoshu-vscode>
   - <https://open-vsx.org/extension/kotoshu/kotoshu-vscode>

## Manual fallback (one command, no CI)

```bash
npm ci && npm run compile
npx vsce publish --no-dependencies     # VSCE_PAT env var or prompts
npx ovsx publish kotoshu-vscode.vsix -p "$OPEN_VSX_TOKEN"
```

`vsce` reads the PAT from the `VSCE_PAT` environment variable
(`VSCE_PAT=... npx vsce publish --no-dependencies`); the third command
assumes a `vsce package` run happened first.

## Pre-publish niceties (optional)

- **Icon**: none exists yet (`vsce` does not warn, but listings look bare
  without one). Add a 128x128 PNG at `media/icon.png` and
  `"icon": "media/icon.png"` to `package.json`. No invented artwork —
  commission or pick from brand assets.
- **Demo GIF**: the README has a `TODO(owner)` placeholder for one.
- **Site cross-link**: after the first publish, link the marketplace pages
  from kotoshu.github.io `/docs/clients/lsp` (plan 99 pass).
