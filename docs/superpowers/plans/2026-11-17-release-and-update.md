# Releases and in-app updates: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A pushed `vX.Y.Z` tag publishes a GitHub release of TodoHub for Apple Silicon. The installed app finds the release, shows it in the sidebar, and installs it and restarts with one click.

**Architecture:** `bin/release` sets the version and tags; a GitHub workflow builds the backend file and the app, and `tauri-action` publishes the `.dmg`, the signed update and `latest.json`. In the app, `tauri-plugin-updater` checks `latest.json`, and `app/src/update.ts` holds the update state that the sidebar line (`main.ts`) and the Settings card (`settings.ts`) show.

**Tech Stack:** POSIX sh, GitHub Actions, Tauri v2 (`tauri-plugin-updater`), TypeScript with the `h()` DOM helper, Vite.

**Spec:** `docs/superpowers/specs/2026-11-17-release-and-update-design.md`.


> **After the reviews:** where the reviews and the merge of `main` changed the code, the code is the reference. The changes: the popover layout, the `editing()` guard in the `watchForUpdates` call, and the `#app.side-icons` rules in place of the `@media (max-width: 820px)` rules.

---

## Before you start

- **Worktree:** `/Users/thibaultdody/dev/worktrees/todo-hub/release-updates`, branch `release-updates`. Run every command from there. Never touch `/Users/thibaultdody/github/tdody/todo-hub`: another session works there.
- **The repo is public.** No client names, company names, work emails or colleagues' names in any file or commit. Examples use Globex, Initech & Co, Hooli, Sam, `ENG-123`. Before each commit, run `python3 "$HOME/Library/Application Support/TodoHub/scan_staged.py"`; it must print `clean`. Report any hit to the controller, and do not commit until it is resolved.
- **Commit messages** end with a blank line and `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Write them in plain, short sentences.
- **Do not push.** Do not create tags. Do not run `bin/release` in this worktree.
- **Comments:** short, about current behavior, no history.
- **Task 4 needs the update key.** `~/.tauri/todohub.key.pub` must exist. If it does not, stop and report BLOCKED.

## Files

| File | Task | What it does |
|---|---|---|
| `CHANGELOG.md` | 1 | Release notes, newest first |
| `bin/release-notes` | 1 | Prints one version's section |
| `bin/release` | 2 | Checks, sets the version, commits, tags, pushes |
| `backend/src/todohub/__init__.py` | 2 | Loses the unused `__version__` |
| `.github/workflows/release.yml` | 3 | Builds and publishes on a tag |
| `app/src-tauri/tauri.release.conf.json` | 3 | Turns on the update files, for releases only |
| `app/src-tauri/Cargo.toml`, `src/main.rs` | 4 | The 2 plugins |
| `app/src-tauri/tauri.conf.json` | 4 | Public key, endpoint, ad-hoc signing |
| `app/src-tauri/capabilities/default.json` | 4 | Updater and restart permissions |
| `app/package.json`, `package-lock.json` | 5 | The 2 JS plugins |
| `app/src/desktop.ts`, `theme.ts` | 5 | One `inTauri()` test |
| `app/src/update.ts` | 5 | Check, timer, install, state |
| `app/tsconfig.json` | 5 | Vite client types, for `import.meta.env` |
| `app/src/main.ts`, `styles.css` | 6 | Sidebar line and panel |
| `app/src/settings.ts` | 7 | The Updates card |
| `README.md`, `DESIGN.md`, `docs/releasing.md` | 8 | Docs |

---

### Task 1: `CHANGELOG.md` and `bin/release-notes`

**Files:**
- Create: `CHANGELOG.md`
- Create: `bin/release-notes` (executable)

- [ ] **Step 1: Write `CHANGELOG.md`**

```markdown
# Changelog

What changed in each TodoHub release, newest first. The app's update panel shows the newest section, and anyone can read this file.
```

The v0.2.0 section is written at release time, not in this task.

- [ ] **Step 2: Write `bin/release-notes`**

```sh
#!/bin/sh
# Print the body of one version's section in CHANGELOG.md: the notes that bin/release refuses to
# release without, and the text of the GitHub release, which the app's update panel shows. Prints
# nothing unless that section is the FIRST `## ` heading, because the newest release is at the top.
#
#   bin/release-notes 0.2.0
set -eu
REPO="$(cd "$(dirname "$0")/.." && pwd)"
awk -v h="## v$1" '
  /^## / { if (seen || ($0 != h && index($0, h " ") != 1)) exit; seen = 1; next }
  seen { print }
' "$REPO/CHANGELOG.md"
```

Run: `chmod +x bin/release-notes`

- [ ] **Step 3: Check it on a scratch changelog**

The script reads `CHANGELOG.md` next to `bin/`, so check it on a scratch copy of the folder:

```bash
S=$(mktemp -d) && mkdir -p "$S/bin" && cp bin/release-notes "$S/bin/"
printf '# Changelog\n\nIntro.\n\n## v0.3.0 — 2026-12-01\n\nNew things.\n\n## v0.2.0 — 2026-11-18\n\nOld things.\n' > "$S/CHANGELOG.md"
echo "--- first section:"; "$S/bin/release-notes" 0.3.0
echo "--- older section (expect nothing):"; "$S/bin/release-notes" 0.2.0
echo "--- missing (expect nothing):"; "$S/bin/release-notes" 0.4.0
echo "--- prefix only (expect nothing):"; "$S/bin/release-notes" 0.3
printf '# Changelog\n\n## v0.3.0 — 2026-12-01\n\n## v0.2.0\n\nOld.\n' > "$S/CHANGELOG.md"
echo "--- empty section (expect a blank line only):"; "$S/bin/release-notes" 0.3.0
rm -rf "$S"
```

Expected: the first block prints a blank line, then `New things.`, then a blank line. Each other block prints nothing, or only blank lines.

- [ ] **Step 4: Commit**

```bash
git add CHANGELOG.md bin/release-notes
python3 "$HOME/Library/Application Support/TodoHub/scan_staged.py"
git commit -m "Release notes: CHANGELOG.md, and bin/release-notes prints one version's section

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: `bin/release`, and the version in 4 files

**Files:**
- Create: `bin/release` (executable)
- Modify: `backend/src/todohub/__init__.py` (remove `__version__ = "0.1.0"`)

- [ ] **Step 1: Remove the unused `__version__`**

`git grep -n __version__` shows only its definition. Delete the line `__version__ = "0.1.0"` from `backend/src/todohub/__init__.py`, and the blank line before it if the file then ends with 2 blank lines. Keep the rest of the file.

Run: `cd backend && uv run --extra dev pytest -q`
Expected: all tests pass.

- [ ] **Step 2: Write `bin/release`**

```sh
#!/bin/sh
# Cut a release. Refuses unless CHANGELOG.md opens with a non-empty `## vX.Y.Z` section: the notes
# that the app's update panel shows. Then sets the version of the app and the backend, syncs their
# lockfiles, commits them with the changelog, tags `vX.Y.Z` and pushes. The pushed tag starts
# .github/workflows/release.yml, which builds TodoHub and publishes the GitHub release.
#
#   bin/release 0.2.0
set -eu

VERSION="${1:-}"
if ! echo "$VERSION" | grep -qE '^[0-9]+\.[0-9]+\.[0-9]+$'; then
  echo "usage: $0 X.Y.Z" >&2
  exit 1
fi

REPO="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO"

if [ "$(git rev-parse --abbrev-ref HEAD)" != main ]; then
  echo "releases are cut from main" >&2
  exit 1
fi
git fetch --quiet --tags origin
if ! git merge-base --is-ancestor origin/main HEAD; then
  echo "main is behind origin/main: pull first" >&2
  exit 1
fi

# CHANGELOG.md is the one file that can have changes: its new section is written just before.
if ! git diff-index --quiet HEAD -- . ':(exclude)CHANGELOG.md'; then
  echo "other files have changes: commit or stash them first" >&2
  exit 1
fi

LAST="$(git tag --list 'v*' --sort=-v:refname | head -1)"
if [ -n "$LAST" ]; then
  if [ "$(printf '%s\nv%s\n' "$LAST" "$VERSION" | sort -V | tail -1)" != "v$VERSION" ] || [ "$LAST" = "v$VERSION" ]; then
    echo "v$VERSION is not newer than $LAST" >&2
    exit 1
  fi
  if [ "$(git rev-list --count "$LAST..HEAD")" -eq 0 ]; then
    echo "nothing to release: no commits since $LAST" >&2
    exit 1
  fi
fi

if [ -z "$("$REPO/bin/release-notes" "$VERSION" | tr -d '[:space:]')" ]; then
  echo "CHANGELOG.md must open with a non-empty '## v$VERSION' section: what changed, in prose." >&2
  echo "Commits since ${LAST:-the beginning}, as raw material:" >&2
  git log --no-merges --format='  - %s' "${LAST:+$LAST..}HEAD" | head -100 >&2
  exit 1
fi

sed -i '' -E "s/\"version\": \"[^\"]*\"/\"version\": \"$VERSION\"/" app/src-tauri/tauri.conf.json
sed -i '' -E "s/^version = \"[^\"]*\"/version = \"$VERSION\"/" app/src-tauri/Cargo.toml backend/pyproject.toml
(cd app && npm version "$VERSION" --no-git-tag-version >/dev/null)

# Each lockfile holds its own package's version too.
cargo metadata --manifest-path app/src-tauri/Cargo.toml --format-version 1 >/dev/null
(cd backend && uv lock --quiet)

git add CHANGELOG.md app/src-tauri/tauri.conf.json app/src-tauri/Cargo.toml app/src-tauri/Cargo.lock \
  app/package.json app/package-lock.json backend/pyproject.toml backend/uv.lock
git commit -m "release: v$VERSION"
git tag -m "TodoHub v$VERSION" "v$VERSION"
git push --atomic origin HEAD "v$VERSION"

echo
echo "Tagged v$VERSION and pushed. The release build (about 10 minutes):"
echo "  https://github.com/tdody/todo-hub/actions/workflows/release.yml"
echo "Installed apps offer the update at their next hourly check after the build."
```

Run: `chmod +x bin/release`

- [ ] **Step 3: Commit**

```bash
git add bin/release backend/src/todohub/__init__.py
python3 "$HOME/Library/Application Support/TodoHub/scan_staged.py"
git commit -m "bin/release: check, set the version in the app and the backend, commit, tag and push

The unused __version__ is gone, so the version lives in 4 files.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 4: Check each refusal and the full run, in a scratch clone**

Never run `bin/release` in the worktree. The scratch clone pushes to a local bare repo, never to GitHub. It clones the commit of Step 3.

```bash
S=$(mktemp -d)
git clone -q --bare "$PWD" "$S/origin.git"
git clone -q "$S/origin.git" "$S/work" && cd "$S/work"
git checkout -q -B main origin/release-updates && git push -q -f origin main && git fetch -q origin

echo "--- bad argument:"; bin/release 1.2 ; echo "exit $?"
git checkout -q -b side; echo "--- not main:"; bin/release 0.2.0 ; echo "exit $?"; git checkout -q main
echo x >> README.md; echo "--- other changes:"; bin/release 0.2.0 ; echo "exit $?"; git checkout -q README.md
echo "--- no section:"; bin/release 0.2.0 ; echo "exit $?"
```

Expected, in order:
- `usage: bin/release X.Y.Z`, exit 1;
- `releases are cut from main`, exit 1;
- `other files have changes: commit or stash them first`, exit 1;
- `CHANGELOG.md must open with a non-empty '## v0.2.0' section…`, then a list of commits, exit 1.

Then the full run, still in `$S/work`:

```bash
printf '\n## v0.2.0 — 2026-11-18\n\nA test release.\n' >> CHANGELOG.md
bin/release 0.2.0 ; echo "exit $?"
git show --stat HEAD | cat
git tag --list
grep -n '"version"' app/src-tauri/tauri.conf.json app/package.json
grep -n '^version' app/src-tauri/Cargo.toml backend/pyproject.toml
grep -n -A1 'name = "todohub"' app/src-tauri/Cargo.lock backend/uv.lock
grep -n -m2 '"version": "0.2.0"' app/package-lock.json
echo "--- same version again:"; bin/release 0.2.0 ; echo "exit $?"
cd - && rm -rf "$S"
```

Expected:
- the full run exits 0; `HEAD` is "release: v0.2.0" and changes the 8 files of the `git add` list;
- the tag `v0.2.0` exists;
- each version line shows `0.2.0`, also in both lockfiles and twice in `package-lock.json`;
- "same version again" prints `v0.2.0 is not newer than v0.2.0`, exit 1.

If `cargo metadata` or `uv lock` fails for lack of network, report it; do not change the script to skip them.

---

### Task 3: The release workflow

**Files:**
- Create: `.github/workflows/release.yml`
- Create: `app/src-tauri/tauri.release.conf.json`

- [ ] **Step 1: Write `app/src-tauri/tauri.release.conf.json`**

```json
{ "bundle": { "createUpdaterArtifacts": true } }
```

A build with this setting needs the private key, so only the release workflow uses this file. `install-app.sh` does not.

- [ ] **Step 2: Write `.github/workflows/release.yml`**

```yaml
name: release

# A pushed `vX.Y.Z` tag (see bin/release) builds TodoHub for Apple Silicon and publishes a GitHub
# release: the .dmg for a first install, and the signed update and latest.json that installed apps read.
on:
  push:
    tags:
      - 'v*'

jobs:
  macos:
    runs-on: macos-latest   # Apple Silicon: the backend file runs only on the chip it is built on
    permissions:
      contents: write
    steps:
      - uses: actions/checkout@v7
      - uses: astral-sh/setup-uv@v10.3.3   # this action publishes no moving major tag
        with:
          python-version: "3.11"
      - uses: actions/setup-node@v7
        with:
          node-version: 24
          cache: npm
          cache-dependency-path: app/package-lock.json
      - uses: Swatinem/rust-cache@v2
        with:
          workspaces: app/src-tauri

      - name: Build the backend file
        run: backend/packaging/build-backend.sh

      - name: Install the app's packages
        working-directory: app
        run: npm ci

      # The CHANGELOG.md section that bin/release refused to tag without. The app's update panel shows it.
      - name: Release notes
        id: notes
        run: |
          {
            echo 'body<<TODOHUB_NOTES_EOF'
            bin/release-notes "${GITHUB_REF_NAME#v}"
            echo 'TODOHUB_NOTES_EOF'
          } >> "$GITHUB_OUTPUT"

      - name: Build and publish the release
        uses: tauri-apps/tauri-action@v0
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          TAURI_SIGNING_PRIVATE_KEY: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY }}
          TAURI_SIGNING_PRIVATE_KEY_PASSWORD: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY_PASSWORD }}
        with:
          projectPath: app
          tagName: ${{ github.ref_name }}
          releaseName: TodoHub ${{ github.ref_name }}
          releaseBody: ${{ steps.notes.outputs.body }}
          releaseDraft: false
          prerelease: false
          includeUpdaterJson: true
          args: --config src-tauri/tauri.bundle.conf.json --config src-tauri/tauri.release.conf.json --bundles app,dmg
```

- [ ] **Step 3: Check that both files parse**

```bash
uv run --no-project --with pyyaml python -c "import yaml,sys; d=yaml.safe_load(open('.github/workflows/release.yml')); print(list(d['jobs']['macos']['steps'][i].get('name') or d['jobs']['macos']['steps'][i]['uses'] for i in range(8)))"
python3 -m json.tool app/src-tauri/tauri.release.conf.json
```

Expected: the 8 step names or `uses` values, then the JSON.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/release.yml app/src-tauri/tauri.release.conf.json
python3 "$HOME/Library/Application Support/TodoHub/scan_staged.py"
git commit -m "Release workflow: a v* tag builds TodoHub for Apple Silicon and publishes the release

tauri.release.conf.json turns on the update files for releases only, because a build with them
needs the private key.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: The updater in the Rust shell and its config

**Files:**
- Modify: `app/src-tauri/Cargo.toml` (the desktop-only dependencies)
- Modify: `app/src-tauri/src/main.rs` (the `tauri::Builder` in `main()`)
- Modify: `app/src-tauri/tauri.conf.json`
- Modify: `app/src-tauri/capabilities/default.json`

- [ ] **Step 1: Add the crates**

In `app/src-tauri/Cargo.toml`, under `[target.'cfg(not(any(target_os = "android", target_os = "ios")))'.dependencies]`, after `tauri-plugin-autostart = "2"`:

```toml
tauri-plugin-updater = "2"
```

- [ ] **Step 2: Register the plugin and add the restart command**

In `app/src-tauri/src/main.rs`, in `main()`, after the `tauri_plugin_autostart` plugin:

```rust
        .plugin(tauri_plugin_updater::Builder::new().build())
```

Add this command near `backend_info` and `set_tray_count`, and add `restart_shown` to `generate_handler!`:

```rust
/// Update and restart: open the new app with its window, also when login started this one with --hidden.
#[tauri::command]
fn restart_shown(app: tauri::AppHandle) {
    let mut env = app.env();
    env.args_os.retain(|a| a != "--hidden");
    stop_backend(&mut app.state::<Backend>().0.lock().unwrap());
    app.cleanup_before_exit();
    tauri::process::restart(&env);
}
```

- [ ] **Step 3: The config**

Read the public key: `cat ~/.tauri/todohub.key.pub`. If the file is missing, stop and report BLOCKED.

In `app/src-tauri/tauri.conf.json`:
- in `bundle`, after `"active": true,`, add `"macOS": { "signingIdentity": "-", "hardenedRuntime": false },`;
- after the `bundle` object, add a top-level `plugins` object:

```json
  "plugins": {
    "updater": {
      "pubkey": "<the one line from ~/.tauri/todohub.key.pub>",
      "endpoints": ["https://github.com/tdody/todo-hub/releases/latest/download/latest.json"]
    }
  }
```

The public key is safe to commit. Do not add any other `"version"` key to this file: `bin/release` sets every `"version"` in it.

- [ ] **Step 4: The permissions**

`app/src-tauri/capabilities/default.json` becomes:

```json
{
  "$schema": "../gen/schemas/desktop-schema.json",
  "identifier": "default",
  "description": "Main window: core APIs, opening links in the browser, notifications, and updates",
  "windows": ["main"],
  "permissions": ["core:default", "core:window:allow-set-theme", "opener:default", "notification:default", "updater:allow-check", "updater:allow-download-and-install"]
}
```

- [ ] **Step 5: Build**

```bash
cd app/src-tauri && cargo check 2>&1 | tail -3
```

Expected: `Finished`, no errors. The first build in this worktree takes several minutes.

- [ ] **Step 6: A local app build still works without the private key, and is signed ad hoc**

This is the build that `install-app.sh` makes, without the install:

```bash
backend/packaging/build-backend.sh
cd app && npm ci --no-fund --no-audit && npm run tauri build -- --config src-tauri/tauri.bundle.conf.json --bundles app 2>&1 | tail -5
codesign -dv src-tauri/target/release/bundle/macos/TodoHub.app 2>&1 | grep -E "Signature|Identifier"
codesign --verify --deep --strict src-tauri/target/release/bundle/macos/TodoHub.app && echo "signature OK"
codesign -dv src-tauri/target/release/bundle/macos/TodoHub.app/Contents/MacOS/todohub-backend 2>&1 | grep Signature
codesign -dv --verbose=2 src-tauri/target/release/bundle/macos/TodoHub.app 2>&1 | grep flags
codesign -dv --verbose=2 src-tauri/target/release/bundle/macos/TodoHub.app/Contents/MacOS/todohub-backend 2>&1 | grep flags
T=$(mktemp -d); TODOHUB_HOME="$T" src-tauri/target/release/bundle/macos/TodoHub.app/Contents/MacOS/todohub-backend --help
```

Expected: the build ends with the bundle path; `Signature=adhoc` for the app and for `todohub-backend`; `signature OK`; `flags=0x2(adhoc)` for both, with no `runtime`; the last command prints the usage and exits 0. Run `sweep --help` and `cli --help` the same way. Do not run `api`, `mcp` or any `cli` command that reads the Keychain. Do not copy the app to `/Applications` and do not open it.

- [ ] **Step 7: Commit**

`Cargo.lock` changes too. Do not commit `app/src-tauri/binaries/` (git ignores it).

```bash
git add app/src-tauri/Cargo.toml app/src-tauri/Cargo.lock app/src-tauri/src/main.rs app/src-tauri/tauri.conf.json app/src-tauri/capabilities/default.json
git status --short
python3 "$HOME/Library/Application Support/TodoHub/scan_staged.py"
git commit -m "App: the updater and process plugins, the update key and endpoint, and ad-hoc signing

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: `update.ts`, and one test for "in the Tauri app"

**Files:**
- Modify: `app/package.json`, `app/package-lock.json`
- Modify: `app/src/desktop.ts:9` (export `inTauri`)
- Modify: `app/src/main.ts:3583` and its uses (`inApp` becomes `inTauri()`)
- Modify: `app/src/theme.ts:22`
- Create: `app/src/update.ts`
- Modify: `app/tsconfig.json` (`"types": ["vite/client"]`, so `import.meta.env` has types)

- [ ] **Step 1: Add the JS plugins**

```bash
cd app && npm install --no-fund --no-audit @tauri-apps/plugin-updater@^2
```

Expected: it is in `dependencies` in `package.json`.

- [ ] **Step 2: One way to ask "in the Tauri app"**

- `app/src/desktop.ts:9`: `const inTauri = …` becomes `export const inTauri = () => "__TAURI_INTERNALS__" in window;`.
- `app/src/main.ts`: delete `const inApp = "__TAURI_INTERNALS__" in window;` (line 3583). Each use of `inApp` becomes `inTauri()`. Add `inTauri` to the existing `./desktop` import on line 7.
- `app/src/theme.ts:22`: `if ("__TAURI_INTERNALS__" in window)` becomes `if (inTauri())`, with `import { inTauri } from "./desktop";`. If that import makes a cycle (`desktop.ts` imports nothing from `theme.ts` today), report it.

Run: `git grep -n "__TAURI_INTERNALS__" app/src`
Expected: only `app/src/desktop.ts`.

- [ ] **Step 3: Write `app/src/update.ts`**

```ts
// Updates from the GitHub releases: a check 10 s after launch and every hour, and the install, which
// replaces /Applications/TodoHub.app and restarts it. On only in the built app: in the dev app, an
// install would put the update in the wrong folder.
import { getVersion } from "@tauri-apps/api/app";
import { invoke } from "@tauri-apps/api/core";
import { check } from "@tauri-apps/plugin-updater";
import type { Update } from "@tauri-apps/plugin-updater";
import { inTauri } from "./desktop";

export const RELEASES_URL = "https://github.com/tdody/todo-hub/releases";
export const updatesOn = inTauri() && !import.meta.env.DEV;

export const update = {
  version: "",                       // this app's, for Settings
  ready: null as Update | null,      // a newer release
  progress: null as number | null,   // percent downloaded, then 100 while it installs; null otherwise
  error: "",                         // why the last install failed
};

let changed = () => {};

/** Read this app's version, then check 10 s after launch and every hour. `onChange` redraws what
 *  shows the update. An automatic check that fails shows nothing; the next one tries again. */
export function watchForUpdates(onChange: () => void) {
  changed = onChange;
  if (!inTauri()) return;
  void getVersion().then((v) => { update.version = v; changed(); }).catch(() => undefined);
  if (!updatesOn) return;
  const quietly = () => void checkForUpdate().catch(() => undefined);
  setTimeout(quietly, 10_000);
  setInterval(quietly, 60 * 60_000);
}

/** The newest release when it is newer than this app, else null. Throws when the check fails. */
export async function checkForUpdate(): Promise<Update | null> {
  const found = await check();
  if (found?.version !== update.ready?.version) {
    update.ready = found;
    changed();
  }
  return found;
}

/** Download `ready`, check its signature, replace the app and restart it. On failure, keep the
 *  error for the panel; the installed app does not change. */
export async function installUpdate(ready: Update) {
  let size = 0;
  let got = 0;
  update.progress = 0;
  update.error = "";
  changed();
  try {
    await ready.downloadAndInstall((e) => {
      if (e.event === "Started") size = e.data.contentLength ?? 0;
      else if (e.event === "Progress" && size) {
        got += e.data.chunkLength;
        const pct = Math.min(99, Math.floor((got * 100) / size));
        if (pct !== update.progress) { update.progress = pct; changed(); }
      } else if (e.event === "Finished") { update.progress = 100; changed(); }
    });
    await invoke("restart_shown");
  } catch (e) {
    update.progress = null;
    update.error = e instanceof Error ? e.message : String(e);
    changed();
  }
}
```

- [ ] **Step 4: Type-check**

Run: `cd app && npx tsc --noEmit`
Expected: no output. `update.ts` has no caller yet; Task 6 adds it.

- [ ] **Step 5: Commit**

```bash
git add app/package.json app/package-lock.json app/src/desktop.ts app/src/main.ts app/src/theme.ts app/src/update.ts
python3 "$HOME/Library/Application Support/TodoHub/scan_staged.py"
git commit -m "App: update.ts checks for a release at launch and every hour, and installs it

inTauri() from desktop.ts is the one test for the Tauri app; main.ts and theme.ts use it.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: The sidebar line and its panel

**Files:**
- Modify: `app/src/main.ts` (the `state` object near line 80, `renderHeader()` near line 3275, a new `updateLine()` next to `sweepStatus()`, and `start()` near line 3745)
- Modify: `app/src/styles.css` (a new block after the "Sources: one line at the bottom of the sidebar" block, near line 1278)

- [ ] **Step 1: State and imports**

- In `state`, after `sourcesOpen: false,`, add `updateOpen: false,`.
- Add to the imports: `import { installUpdate, RELEASES_URL, update, watchForUpdates } from "./update";`.

- [ ] **Step 2: `updateLine()`**

Add this function just before `sweepStatus()`:

```ts
/** Above the sweep status, when a newer release exists: "↑ Update to v0.3.0". It opens the release's
 *  notes and Update and restart. */
function updateLine(): HTMLElement | "" {
  const ready = update.ready;
  if (!ready) return "";
  const busy = update.progress !== null;
  const label = update.progress === 100 ? "Installing…" : busy ? `Downloading… ${update.progress}%` : "Update and restart";
  return h("div", { class: "update" },
    h("details", { class: "drop-menu update-menu", open: state.updateOpen,
      ontoggle: (e: Event) => { state.updateOpen = (e.currentTarget as HTMLDetailsElement).open; } },
      h("summary", { class: "update-line", title: `TodoHub v${ready.version} is ready`, "aria-label": `Update to v${ready.version}` },
        h("span", { "aria-hidden": "true" }, "↑"), h("span", { class: "update-line-text" }, `Update to v${ready.version}`)),
      h("div", { class: "menu update-pop", role: "dialog", "aria-label": `TodoHub v${ready.version}` },
        h("b", {}, `TodoHub v${ready.version}`),
        ready.body?.trim() ? h("div", { class: "update-notes md" }, ...renderMarkdown(ready.body)) : "",
        update.error ? h("p", { class: "update-err" }, `The update failed: ${update.error}`) : "",
        h("div", { class: "update-pop-foot" },
          h("button", { class: "primary small-btn", disabled: busy, onclick: () => void installUpdate(ready) }, label),
          link("All releases", RELEASES_URL, "link-btn")))));
}
```

`link` is already imported from `./dom`; it opens the URL in the browser.

- [ ] **Step 3: Put it in the sidebar**

In `renderHeader()`, the end of `side.replaceChildren(...)` is:

```ts
    h("div", { class: "side-fill" }),
    sweepStatus(),
  );
```

It becomes:

```ts
    h("div", { class: "side-fill" }),
    updateLine(),
    sweepStatus(),
  );
```

- [ ] **Step 4: Start watching**

In `start()`, after `onDesktopEvent("run-now", () => void runNow());`, add:

```ts
  watchForUpdates(() => { renderHeader(); settingsCtx.rerender(); });
```

`settingsCtx.rerender` redraws only when the Settings page is open.

- [ ] **Step 5: CSS**

After the block that ends with the `@media (max-width: 820px)` rules for `.src-line-text` and `.src-pop` (near line 1278), add:

```css
/* ---- An update: one line above the sweep status, a popover with the release's notes -------------- */
.update { position: relative; padding: 0 0 4px; }
.drop-menu.update-menu { position: static; display: flex; }
.update-line { cursor: pointer; display: flex; align-items: center; gap: 7px; flex: 1; min-width: 0;
  padding: 5px 8px; border-radius: 7px; font-size: 12px; font-weight: 600; color: var(--accent); white-space: nowrap; }
.update-line:hover, .update-menu[open] > .update-line { background: var(--surface-2); }
.update-line-text { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.update-menu .menu.update-pop { left: -8px; right: -8px; bottom: calc(100% + 8px); min-width: 0; padding: 10px 12px; gap: 8px;
  border-radius: 12px; box-shadow: 0 14px 34px rgba(0, 0, 0, .16); font-size: 12px; color: var(--ink); }
.update-pop b { font-size: 13px; }
.update-notes { max-height: 50vh; overflow: auto; line-height: 1.45; }
.update-notes > :first-child { margin-top: 0; }
.update-notes > :last-child { margin-bottom: 0; }
.update-err { margin: 0; color: var(--bad); }
.update-pop-foot { display: flex; align-items: center; gap: 12px; border-top: 1px solid var(--border); padding-top: 8px; }
.update-menu .update-pop button.primary { background: var(--accent); color: var(--accent-ink); border: 1px solid var(--accent);
  padding: 4px 12px; border-radius: 6px; font-weight: 600; }
.update-menu .update-pop button.primary:disabled { opacity: .6; cursor: default; }
@media (max-width: 820px) {
  .update-line-text { display: none; }
  .update-line { flex: none; justify-content: center; }
  .update-menu .menu.update-pop { position: fixed; left: 68px; right: auto; bottom: 16px; width: 300px; }
}
```

Use only existing tokens (`--accent`, `--accent-ink`, `--surface-2`, `--ink`, `--bad`, `--border`). Check that each exists: `grep -c -- "--accent-ink:" app/src/styles.css` must not print 0.

- [ ] **Step 6: Type-check and build**

Run: `cd app && npm run build 2>&1 | tail -3`
Expected: `built in …`, no type errors.

- [ ] **Step 7: Commit**

```bash
git add app/src/main.ts app/src/styles.css
python3 "$HOME/Library/Application Support/TodoHub/scan_staged.py"
git commit -m "App: \"↑ Update to vX.Y.Z\" above the sweep status opens the notes and Update and restart

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: The Updates card in Settings

**Files:**
- Modify: `app/src/settings.ts` (imports, the `sections` list in `settingsView()`, `sectionIcon()`, a new `updatesSection()` at the end of the file)

- [ ] **Step 1: Imports and the section**

- Add `import { checkForUpdate, RELEASES_URL, update, updatesOn } from "./update";`.
- In `settingsView()`, add `["updates", "Updates", () => updatesSection(ctx)]` as the last entry of `sections`, after the Periscope entry.
- In `sectionIcon()`, the last line becomes:

```ts
  return h("span", { class: "set-ico", "aria-hidden": "true" },
    id === "sources" ? "⇄" : id === "periscope" ? "↗" : id === "updates" ? "↑" : "◷");
```

- [ ] **Step 2: `updatesSection()`**

Add at the end of `settings.ts`:

```ts
// ---- updates ------------------------------------------------------------------------------------
let checkResult = "";                // what the last Check for updates found

async function checkNow(ctx: SettingsCtx) {
  busy = "updates";
  ctx.rerender();
  try {
    const found = await checkForUpdate();
    checkResult = found ? `v${found.version} is ready: see the bottom of the sidebar.` : "You have the latest version.";
  } catch (e) {
    checkResult = `Couldn't check: ${e instanceof Error ? e.message : String(e)}`;
  } finally {
    busy = "";
    ctx.rerender();
  }
}

function updatesSection(ctx: SettingsCtx): HTMLElement {
  if (!updatesOn) {
    return card("updates", "Updates", "Updates are off outside the installed app.", "",
      h("p", { class: "set-row-inline" }, `TodoHub ${update.version}`));
  }
  return card("updates", "Updates",
    "TodoHub checks for a new release at launch and every hour, and shows it at the bottom of the sidebar.", "",
    h("div", { class: "set-row-inline" },
      h("span", {}, `TodoHub ${update.version}`),
      h("button", { type: "button", class: "ghost small-btn", disabled: busy === "updates", onclick: () => void checkNow(ctx) },
        busy === "updates" ? "Checking…" : "Check for updates"),
      link("All releases", RELEASES_URL)),
    checkResult ? h("p", { class: "set-hint" }, checkResult) : "");
}
```

- [ ] **Step 3: Type-check and build**

Run: `cd app && npm run build 2>&1 | tail -3`
Expected: `built in …`, no type errors.

- [ ] **Step 4: Commit**

```bash
git add app/src/settings.ts
python3 "$HOME/Library/Application Support/TodoHub/scan_staged.py"
git commit -m "Settings: an Updates card with the version and Check for updates

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Docs

**Files:**
- Modify: `README.md` (a new "Install" section before "## Setup (macOS)", which becomes "## Build from source"; the Settings line near line 108; the Files block)
- Modify: `DESIGN.md:545` (the Sidebar line)
- Create: `docs/releasing.md`

- [ ] **Step 1: README, the new section**

Insert before `## Setup (macOS)`:

````markdown
## Install (Apple Silicon Mac)

1. Download the `.dmg` from the [newest release](https://github.com/tdody/todo-hub/releases/latest).
2. Open it and drag **TodoHub** to **Applications**.
3. Apple did not sign TodoHub, so macOS says that it "is damaged". Run this one time in Terminal:

   ```bash
   xattr -dr com.apple.quarantine /Applications/TodoHub.app
   ```

4. Set up with the command line inside the app:

   ```bash
   todohub=/Applications/TodoHub.app/Contents/MacOS/todohub-backend
   $todohub cli init              # creates ~/Library/Application Support/TodoHub
   $todohub cli set-linear-key    # Linear personal API key (hidden input, saved in Keychain)
   ```

   Put your Linear team's key in `config.toml` (`team_key = "ENG"` under `[linear]`), then run `$todohub cli check`.
5. Open TodoHub. In **Settings → Schedule**, click **Set it up**.

You also need Claude Code (`claude`), signed in, and `gh`, signed in, for GitHub reviews and the Pull requests tab.

### Updates

TodoHub checks for a new release when it starts and every hour. When one exists, **↑ Update to v0.3.0** shows at the bottom of the sidebar. Click it to read what changed, then click **Update and restart**. **Settings → Updates** shows your version and has **Check for updates**.

After an update, macOS may ask again whether `todohub-backend` can use the Linear key in your Keychain. Choose **Always Allow**.

````

- [ ] **Step 2: README, the other changes**

- `## Setup (macOS)` becomes `## Build from source`. Its first line becomes: "To work on TodoHub, build it from a checkout. You need Python 3.11+ …" (keep the rest of the sentence).
- The Settings line (near line 108): "one page with four sections" becomes "one page with five sections", and add at the end of that bullet: "The last section, **Updates**, shows your version and checks for a new release."
- In the `## Files` block, after the `backend/packaging/` line, add:

```
bin/release           cut a release: check, set the version, tag and push (see docs/releasing.md)
bin/release-notes     print one version's CHANGELOG.md section
```

- And the `app/src/` line gets `update.ts (updates)` after `desktop.ts (menu bar, notifications)`.

- [ ] **Step 3: DESIGN.md**

At the end of the Sidebar line (`DESIGN.md:545`), after "The sources line sits at the bottom with a green or red dot.", add: "When a newer release exists, an accent line, **↑ Update to vX.Y.Z**, sits just above it and opens the release's notes in a popover like the sources popover."

- [ ] **Step 4: Write `docs/releasing.md`**

````markdown
# Releasing TodoHub

A release is a GitHub release with a `.dmg` for a first install, and a signed update that installed apps download. Releases are for Apple Silicon only, and Apple does not sign them.

## One-time setup

1. Make the update key pair:

   ```bash
   cd app
   npm run tauri signer generate -- -w ~/.tauri/todohub.key
   ```

   Give it a password. Keep the key file and the password safe, for example in a password manager. If you lose them, installed apps cannot accept a new update, and each person must install the next `.dmg` by hand.
2. The public key, `~/.tauri/todohub.key.pub`, is in `app/src-tauri/tauri.conf.json` at `plugins.updater.pubkey`. A new key pair needs its new public key there.
3. Add 2 secrets to the GitHub repo:

   ```bash
   gh secret set TAURI_SIGNING_PRIVATE_KEY < ~/.tauri/todohub.key
   gh secret set TAURI_SIGNING_PRIVATE_KEY_PASSWORD
   ```

## Each release

1. On an up-to-date `main`, add a section at the top of `CHANGELOG.md`, under the intro:

   ```markdown
   ## v0.3.0 — 2026-12-01

   What changed for a person who uses TodoHub, in prose.
   ```

   The app's update panel shows this text, and anyone can read it. Keep client and work data out of it.
2. Run `bin/release 0.3.0`. It refuses when:
   - the version is not `X.Y.Z`;
   - you are not on `main`, or `main` is behind `origin/main`;
   - a file other than `CHANGELOG.md` has changes;
   - the version is not newer than the last tag, or nothing changed since it;
   - `CHANGELOG.md` does not open with a non-empty `## v0.3.0` section. It then lists the commits since the last release, to help you write it.

   Otherwise it sets the version in `app/src-tauri/tauri.conf.json`, `app/src-tauri/Cargo.toml`, `app/package.json` and `backend/pyproject.toml`, syncs their lockfiles, commits "release: v0.3.0", tags `v0.3.0` and pushes.
3. The tag starts `.github/workflows/release.yml` on an Apple Silicon runner (about 10 minutes). It builds the backend file and the app, signs the update with the secret key, and publishes "TodoHub v0.3.0" with the changelog section as its text.
4. Installed apps find the update at their next hourly check, or at once with **Settings → Updates → Check for updates**.

## What a release holds

- `TodoHub_0.3.0_aarch64.dmg`: for a first install (see the README's Install section).
- The update archive (`.app.tar.gz`) and its signature (`.sig`).
- `latest.json`: the newest version, its notes, and the link and signature of its update. Installed apps read `https://github.com/tdody/todo-hub/releases/latest/download/latest.json`.

## How an update works

The app checks `latest.json` 10 seconds after launch and every hour. When its version is newer, the sidebar shows **↑ Update to v0.3.0**. **Update and restart** downloads the update, checks its signature with the public key, replaces `/Applications/TodoHub.app` and restarts it. The dev app (`npm run tauri dev`) does not check.

A local build with `install-app.sh` does not make update files, so it does not need the private key.

## When the release workflow fails

- Installed apps keep seeing the last release, because `latest.json` changes only when a release is published.
- A temporary failure (for example, a network error): re-run the job from the Actions page.
- A failure that needs a code change:
  1. Delete the tag: `git push origin :refs/tags/v0.3.0` and `git tag -d v0.3.0`. If a release page exists for it on GitHub, delete it too.
  2. Fix the cause in a pull request and merge it.
  3. Change the changelog heading to the next patch version and run `bin/release 0.3.1`.

## When bin/release stops halfway

- **Before its commit** (for example, `uv lock` or `cargo metadata` has no network): the version files have changes. Put them back with `git checkout -- app backend`, fix the cause, and run `bin/release 0.3.0` again. `CHANGELOG.md` keeps your section.
- **At the push** (for example, no network): the release commit and the tag exist on your Mac only. The push sends both or neither, so run it again: `git push --atomic origin HEAD v0.3.0`.
- **GitHub refuses `main`** because someone pushed first: put your release commit on top, then tag it again.

  ```bash
  git tag -d v0.3.0
  git pull --rebase
  git tag -m "TodoHub v0.3.0" v0.3.0
  git push --atomic origin HEAD v0.3.0
  ```
````

- [ ] **Step 5: Commit**

```bash
git add README.md DESIGN.md docs/releasing.md
python3 "$HOME/Library/Application Support/TodoHub/scan_staged.py"
git commit -m "Docs: Install and Updates in the README, the update line in DESIGN.md, and docs/releasing.md

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Browser check of the sidebar line, the panel and the Settings card (the controller does this)

Follow the memory note "UI check without the real app", with 3 changes:

- Serve a production build, because the update UI is off when `import.meta.env.DEV` is true: `cd app && npm run build && npx vite preview --port 1430 --strictPort`.
- The Tauri shim also answers:
  - `plugin:app|version` → `"0.2.0"`;
  - `plugin:updater|check` → `{ rid: 1, currentVersion: "0.2.0", version: "0.3.0", date: "2026-12-01T00:00:00Z", body: "Globex cards now **merge** in one click.\n\n- Item one\n- Item two", rawJson: {} }`;
  - `plugin:updater|download_and_install` → rejects with `"network error"`.
- Wait 10 s after load for the first check, or click **Check for updates** in Settings.

Check, at 1120 and 760 px wide, in light and dark:

- the line "↑ Update to v0.3.0" above the sweep status (only "↑" at 760 px);
- the panel: the heading, the notes as Markdown, **Update and restart**, **All releases**;
- after **Update and restart**: "The update failed: network error", and the button is active again;
- Settings → Updates: "TodoHub 0.2.0", **Check for updates**, and after a click "v0.3.0 is ready: see the bottom of the sidebar.";
- a second shim run where `plugin:updater|check` returns `null`: no line, and "You have the latest version.".

Block every write to the backend, as the memory note says. Delete `.playwright-mcp/` after.

---

### Task 10: The first releases (after the merge, with the user)

Not for a subagent. Each step needs the user.

1. The user has done the one-time setup in `docs/releasing.md` (key pair and 2 secrets).
2. Draft the `## v0.2.0` section of `CHANGELOG.md` from the merged PRs, in prose, with no client or work data. The user approves the text.
3. The user runs `bin/release 0.2.0` on an up-to-date `main` (or asks for it to be run).
4. Watch the workflow. On success, check that the release has the `.dmg`, the `.app.tar.gz`, its `.sig` and `latest.json`, and that `latest.json` has a `darwin-aarch64` entry.
5. The user installs v0.2.0 from the `.dmg` with the README's Install steps, on their own Mac.
6. Release a small v0.2.1. In v0.2.0, click **↑ Update to v0.2.1**, then **Update and restart**. Check:
   - the app restarts as v0.2.1 (Settings → Updates);
   - `xattr -l /Applications/TodoHub.app` shows no `com.apple.quarantine`;
   - the backend answers, and the scheduled sweep still runs at its next hour.
