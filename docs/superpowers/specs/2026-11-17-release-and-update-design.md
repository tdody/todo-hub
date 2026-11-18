# Releases on GitHub, and updates from inside the app

## Goal

Colleagues install TodoHub from a `.dmg` on GitHub, without a checkout or a build. When a newer release exists, the app shows it, and one click installs it and restarts the app. The maintainer cuts a release with one command after writing its notes.

## What happens today

- Each person builds TodoHub from a checkout with `install-app.sh`. A build needs Rust, Node, uv and the Xcode command-line tools.
- The version is 0.1.0, in 5 files. There are no tags, no `CHANGELOG.md` and no GitHub releases.
- CI runs the backend tests and `tsc` on Linux. Nothing builds the Mac app.
- Periscope is the model for releases: `bin/release`, `CHANGELOG.md`, and a workflow that builds on a tag. Its installs update with git. TodoHub cannot update that way, because the app holds the built backend.

## Scope

In:

- `CHANGELOG.md`, `bin/release`, `bin/release-notes` and `.github/workflows/release.yml`.
- The Tauri updater: the check, the sidebar line and its panel, the install and the restart.
- An "Updates" card in Settings.
- Ad-hoc signing of the app.
- README and `docs/releasing.md`.

Out:

- Apple signing and notarization.
- Intel Macs. Each release is for Apple Silicon only.
- An update that installs without a click.
- A return to an older version. To do it, install the older `.dmg` yourself.
- A setup screen in the app for the Linear key and the team. This can be a later change.

## Releasing

### One-time setup (the maintainer)

1. Run `npm run tauri signer generate -- -w ~/.tauri/todohub.key` in `app/`. Give the key a password.
2. Put the public key in `app/src-tauri/tauri.conf.json`, at `plugins.updater.pubkey`, and commit it.
3. Add 2 GitHub secrets to `tdody/todo-hub`:
   - `TAURI_SIGNING_PRIVATE_KEY`: the content of `~/.tauri/todohub.key`;
   - `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`: its password.

The private key never goes in the repo. If you lose it, the installed apps cannot accept a new update, and each colleague must install the next `.dmg` by hand.

### `CHANGELOG.md`

- It opens with a short paragraph, then one section for each release, newest first.
- A section starts with `## vX.Y.Z — YYYY-MM-DD`. Its body says what changed for a person who uses TodoHub, in prose. It is not a list of commits.
- The public sees it, so it has no client or work data. The scan before each commit covers it.

### `bin/release-notes X.Y.Z`

It prints the body of the `## vX.Y.Z` section. It prints nothing when that section is not the first `## ` heading. It is a copy of Periscope's script, with the TodoHub paths.

### `bin/release X.Y.Z`

A copy of Periscope's script, with the TodoHub paths. It refuses to run, with a message, when:

- the argument is not `X.Y.Z`;
- the branch is not `main`, or `main` is behind `origin/main`;
- a file other than `CHANGELOG.md` has changes;
- `vX.Y.Z` is not newer than the last tag, or no commit exists since that tag;
- `bin/release-notes X.Y.Z` prints nothing. The script then also lists the commits since the last tag, as raw material for the notes.

Otherwise, it:

1. sets the version in:
   - `app/src-tauri/tauri.conf.json`;
   - `app/src-tauri/Cargo.toml`, then syncs `Cargo.lock` with `cargo metadata`;
   - `app/package.json` and `app/package-lock.json`, with `npm version X.Y.Z --no-git-tag-version`;
   - `backend/pyproject.toml`, then syncs `backend/uv.lock` with `uv lock`;
2. commits these files and `CHANGELOG.md` as "release: vX.Y.Z";
3. tags `vX.Y.Z`;
4. pushes `main` and the tag;
5. prints the link to the Actions page.

The unused `__version__` in `backend/src/todohub/__init__.py` is removed, so the version lives in 4 files.

### `.github/workflows/release.yml`

It runs on a pushed `v*` tag, on `macos-latest` (Apple Silicon), with `contents: write`. Its steps:

1. Check out, then set up uv and Node with the same steps as `ci.yml`. Cache the Rust build with `Swatinem/rust-cache` for `app/src-tauri`.
2. Build the backend file with `backend/packaging/build-backend.sh`.
3. Run `npm ci` in `app/`.
4. Read the notes with `bin/release-notes "${GITHUB_REF_NAME#v}"`.
5. Run `tauri-apps/tauri-action@v0` with:
   - `projectPath: app`;
   - `args: --config src-tauri/tauri.bundle.conf.json --config src-tauri/tauri.release.conf.json --bundles app,dmg`;
   - `tagName: ${{ github.ref_name }}`, `releaseName: TodoHub ${{ github.ref_name }}`;
   - `releaseBody`: the notes only, because the app shows this text in its update panel;
   - `releaseDraft: false`, `prerelease: false`, `includeUpdaterJson: true`;
   - the env `GITHUB_TOKEN`, `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`.

The new `app/src-tauri/tauri.release.conf.json` holds `{"bundle": {"createUpdaterArtifacts": true}}`. It is a separate file, because a build with this setting needs the private key. `install-app.sh` does not use it, so local builds work without the key.

Each release holds:

- `TodoHub_X.Y.Z_aarch64.dmg`, for a first install;
- the update archive (`.app.tar.gz`) and its signature (`.sig`);
- `latest.json`: the newest version, its notes, and the link and signature of its update.

The first release is v0.2.0.

## Updating

### The check

- `tauri-plugin-updater` reads `https://github.com/tdody/todo-hub/releases/latest/download/latest.json`. The request goes from Rust, so the CSP does not change.
- The app checks 10 seconds after launch, then every hour.
- Updates are on only in the built app. In a browser and in the dev app (`npm run tauri dev`, where `import.meta.env.DEV` is true), the app does not check and shows no update UI. In the dev app, an install would put the update in the wrong folder.
- When an automatic check fails (for example, offline), the app shows nothing. The next check tries again.

### The sidebar line and its panel

- When a newer version exists, a line shows at the bottom of the sidebar, above the sweep status: **↑ Update to v0.3.0**.
- The line opens a panel, with the same `details.drop-menu` pattern as the sweep status:
  - the heading "TodoHub v0.3.0";
  - the notes, drawn with `renderMarkdown`;
  - an **All releases** link to `https://github.com/tdody/todo-hub/releases`, because `latest.json` holds only the newest notes;
  - the button **Update and restart**.

### The update

1. The button changes to "Downloading… 40%", and it is disabled.
2. The updater checks the signature with the public key, then replaces `/Applications/TodoHub.app`.
3. An app command, `restart_shown`, restarts the app and removes `--hidden`. The window then opens also after a start at login.

When a step fails, the panel shows "The update failed: <error>" and the **All releases** link, and the button is active again.

### Settings

A last card, "Updates":

- "TodoHub 0.2.0", from `getVersion()`;
- a **Check for updates** button. A manual check shows its result under the button: "You have the latest version", "v0.3.0 is ready: see the bottom of the sidebar.", or "Couldn't check: <error>";
- outside the installed app (the dev app or a browser): "Updates are off outside the installed app.", and no button.

### After the restart

- **The backend:** the old one stops with the app. The new one starts on a new free port, as at each launch.
- **A running sweep:** it continues. It runs in its own process (`start_new_session=True`).
- **The scheduled sweep and the login item:** they point to paths inside `/Applications/TodoHub.app`. These paths do not change, so they do not need to be written again.
- **The data:** the update does not touch `~/Library/Application Support/TodoHub`.

## First install

Set `bundle.macOS.signingIdentity` to `"-"` in `tauri.conf.json`, as Periscope does. Each build then signs every file in the app ad hoc, including the backend file. Apple Silicon does not run code without a valid signature.

Set `bundle.macOS.hardenedRuntime` to `false`. With hardened runtime, the PyInstaller backend cannot load its Python library. Only notarization needs hardened runtime.

A colleague:

1. downloads the `.dmg` from `https://github.com/tdody/todo-hub/releases/latest`;
2. opens it and drags TodoHub to Applications;
3. runs `xattr -dr com.apple.quarantine /Applications/TodoHub.app` one time. Without it, macOS says that the app "is damaged";
4. sets up with the CLI in the app (`/Applications/TodoHub.app/Contents/MacOS/todohub-backend cli …`): `init`, `linear.team_key` in `config.toml`, `set-linear-key` (it needs the team key), then `check`;
5. opens TodoHub, and installs the sweep schedule from Settings.

Updates that the app downloads do not get the quarantine mark, so step 3 is needed only one time.

## Changes

- **New:** `CHANGELOG.md`, `bin/release`, `bin/release-notes`, `.github/workflows/release.yml`, `app/src-tauri/tauri.release.conf.json`, `app/src/update.ts`, `docs/releasing.md`.
- **`app/src-tauri/Cargo.toml` and `main.rs`:** add and register `tauri-plugin-updater`. `main.rs` also adds the command `restart_shown`.
- **`app/src-tauri/tauri.conf.json`:** `plugins.updater.pubkey`, `plugins.updater.endpoints`, `bundle.macOS.signingIdentity: "-"`, `bundle.macOS.hardenedRuntime: false`.
- **`app/src-tauri/capabilities/default.json`:** add `updater:allow-check` and `updater:allow-download-and-install`.
- **`app/package.json`:** add `@tauri-apps/plugin-updater`.
- **`app/src/desktop.ts`:** export `inTauri`, so `update.ts` uses the same test.
- **`app/src/update.ts`:** the check, the hourly timer, the install with its progress, and the state that the sidebar and Settings read.
- **`app/src/main.ts`:** the sidebar line and its panel.
- **`app/src/settings.ts`:** the "Updates" card.
- **`app/src/styles.css`:** the line and the panel, with the existing tokens.
- **`backend/src/todohub/__init__.py`:** remove `__version__`.
- **README:**
  - a new "Install" section for colleagues: the first install, and "Updates" (the sidebar line, and the Keychain question after an update);
  - "Setup (macOS)" becomes "Build from source".
- **`docs/releasing.md`:** the one-time setup, each release step, what the workflow does, and what to do when it fails.

## Errors

- **A failed automatic check:** the app shows nothing, and the next check tries again.
- **A failed manual check:** Settings shows the error.
- **A failed download or install:** the panel shows the error and the **All releases** link. The installed app does not change.
- **A wrong signature:** the updater refuses the update, and the panel shows the error.
- **A failed release workflow:** no release is published, and `latest.json` still points to the last release. `docs/releasing.md` says how to fix and run it again: re-run the job, or delete the tag and run `bin/release` again.

## Testing

- **`bin/release`:** try each refusal by hand: not on `main`, another changed file, no changelog section, a version that is not newer.
- **`bin/release-notes`:** a first section, a section further down (prints nothing), and an empty section.
- **The sidebar line, the panel and the Settings card:** a browser check on a production build (`vite build`, then `vite preview`, so `import.meta.env.DEV` is false). Use the Tauri shim, which answers the updater calls with a fake update. Check at 1120 and 760 px, in light and dark.
- **The full path:** release v0.2.0, install it from the `.dmg` on the maintainer's Mac, then release a small v0.2.1 and update from the sidebar line. This is the only real test of the signature, the replace, the restart and the quarantine mark.

## Assumptions

- Updates that the app downloads do not get the quarantine mark. The v0.2.1 test proves this.
- Colleagues can write to `/Applications`, as admin users can. If they cannot, the updater asks macOS for an admin password. If they cancel, the update fails, and the panel shows the error and the releases link.
- After each update, macOS asks again whether `todohub-backend` can use the Keychain, because an ad-hoc signature changes at each build. Choose **Always Allow**. The README says this.
- Ad-hoc signing works on the PyInstaller backend file. A local build proves that the backend starts (`--help`). The first release proves the same for the release build.
- The panel shows only the newest notes. The **All releases** link shows the older notes.
- Each release is public, and anyone can download it. The code has no client or work data, so this is safe.
- `main` has no branch protection today, so `bin/release` can push to it.
