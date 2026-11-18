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
