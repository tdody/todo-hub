#!/usr/bin/env bash
# Build the backend as one binary and put it where Tauri expects its sidecar:
#   app/src-tauri/binaries/todohub-backend-<target triple>
# Run from anywhere; needs uv. Then build the app with:
#   cd app && npm run tauri build -- --config src-tauri/tauri.bundle.conf.json
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
backend="$(dirname "$here")"
app="$(dirname "$backend")/app"
triple="$(rustc -Vv | sed -n 's/^host: //p')"

cd "$backend"
uv sync --extra bundle --extra dev --quiet
uv run --extra bundle pyinstaller \
  --onefile --clean --noconfirm \
  --name todohub-backend \
  --distpath "$here/dist" --workpath "$here/build" --specpath "$here/build" \
  --paths "$backend/src" \
  --collect-data todohub \
  --collect-submodules todohub \
  --collect-submodules uvicorn \
  --collect-submodules keyring.backends \
  --collect-submodules mcp.server.mcpserver \
  "$here/entry.py"

mkdir -p "$app/src-tauri/binaries"
cp "$here/dist/todohub-backend" "$app/src-tauri/binaries/todohub-backend-$triple"
echo "Sidecar: $app/src-tauri/binaries/todohub-backend-$triple"
