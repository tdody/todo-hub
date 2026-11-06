#!/usr/bin/env bash
# Build TodoHub.app from this checkout and install it in /Applications.
# Run it again after changing the code. The first build takes several minutes; later ones are faster.
set -euo pipefail
root="$(cd "$(dirname "$0")" && pwd)"
dest="/Applications/TodoHub.app"

if [ "$(uname)" != "Darwin" ]; then
  echo "TodoHub.app can only be built on a Mac." >&2
  exit 1
fi
# A dev copy (npm run tauri dev) would fight the app over the menu bar and the ⌥⌘T shortcut.
if pgrep -f "src-tauri/target/debug/todohub" >/dev/null; then
  echo "Stop \`npm run tauri dev\` first (quit TodoHub from its menu-bar icon, then Ctrl-C)." >&2
  exit 1
fi

echo "==> 1/4  Building the backend (one-file binary)"
"$root/backend/packaging/build-backend.sh"

echo "==> 2/4  Building the app"
cd "$root/app"
npm install --no-fund --no-audit
npm run tauri build -- --config src-tauri/tauri.bundle.conf.json --bundles app
built="$root/app/src-tauri/target/release/bundle/macos/TodoHub.app"
if [ ! -d "$built" ]; then
  echo "The build finished, but $built is missing." >&2
  exit 1
fi

echo "==> 3/4  Installing in /Applications"
# Quit the installed copy if it's running (without launching it if it isn't).
osascript -e 'if application "TodoHub" is running then tell application "TodoHub" to quit' >/dev/null 2>&1 || true
for _ in $(seq 20); do
  pgrep -f "$dest/Contents/MacOS/" >/dev/null || break
  sleep 0.5
done
rm -rf "$dest"
cp -R "$built" "$dest"

echo "==> 4/4  Starting TodoHub"
open "$dest"
echo "Done. TodoHub is in /Applications and in the menu bar. It opens at login; turn that off in TodoHub → Open at Login."
