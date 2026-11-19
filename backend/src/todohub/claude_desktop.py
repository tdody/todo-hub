"""Start in Claude Desktop: a new chat with the prompt in its message box. Claude Desktop fills the box from
the link's ``q`` and does not send it (Claude Desktop 6.6395.1, 2026-11-19)."""

from __future__ import annotations

import logging
import subprocess
from urllib.parse import quote

from .start import StartError

BUNDLE_ID = "com.anthropic.claudefordesktop"
FIND_SECONDS = 3
QUICK_SECONDS = 15
log = logging.getLogger("todohub.claude_desktop")
# Launch Services gives the app's path for the bundle ID, or nil. It sends no Apple Events, so macOS asks for
# no permission. It takes about 70 ms.
_FIND_APP = ("ObjC.import('AppKit'); var u = $.NSWorkspace.sharedWorkspace"
             f".URLForApplicationWithBundleIdentifier('{BUNDLE_ID}'); u.isNil() ? '' : u.path.js")


def is_installed() -> bool:
    try:
        proc = subprocess.run(["osascript", "-l", "JavaScript", "-e", _FIND_APP], capture_output=True, text=True,
                              timeout=FIND_SECONDS)
    except subprocess.TimeoutExpired:
        log.warning("Launch Services did not answer in %s s.", FIND_SECONDS)
        return False
    if proc.returncode != 0:
        log.warning("Launch Services check failed: %s", proc.stderr.strip())
        return False
    return bool(proc.stdout.strip())


def open_chat(prompt: str) -> None:
    url = "claude://claude.ai/new?q=" + quote(prompt, safe="")
    try:
        subprocess.run(["open", url], check=True, capture_output=True, text=True, timeout=QUICK_SECONDS)
    except (subprocess.CalledProcessError, subprocess.TimeoutExpired) as exc:
        log.warning("open failed: %s", (getattr(exc, "stderr", None) or "").strip() or exc)
        raise StartError("Could not open Claude Desktop.") from None
