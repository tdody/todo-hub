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

/** The newest release when it is newer than this app, else null. Throws when the check fails.
 *  Each check holds a new update in Rust: keep one and close the other. While an install runs,
 *  the update being installed stays. */
export async function checkForUpdate(): Promise<Update | null> {
  const found = await check();
  if (update.progress !== null || found?.version === update.ready?.version) {
    void found?.close();
    return update.ready;
  }
  void update.ready?.close();
  update.ready = found;
  update.error = "";
  changed();
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
