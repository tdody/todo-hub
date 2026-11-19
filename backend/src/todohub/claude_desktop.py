"""Start in Claude Desktop: a new chat with the prompt in its message box. Claude Desktop fills the box from
the link's ``q`` and does not send it (Claude Desktop 6.6395.1, 2026-11-19)."""

from __future__ import annotations

import subprocess
from urllib.parse import quote

from .start import StartError

BUNDLE_ID = "com.anthropic.claudefordesktop"
QUICK_SECONDS = 15
# Launch Services gives the app's path for the bundle ID, or nil. It sends no Apple Events, so macOS asks for
# no permission. It takes about 70 ms.
_FIND_APP = ("ObjC.import('AppKit'); var u = $.NSWorkspace.sharedWorkspace"
             f".URLForApplicationWithBundleIdentifier('{BUNDLE_ID}'); u.isNil() ? '' : u.path.js")


def is_installed() -> bool:
    try:
        proc = subprocess.run(["osascript", "-l", "JavaScript", "-e", _FIND_APP], capture_output=True, text=True,
                              timeout=QUICK_SECONDS)
    except (OSError, subprocess.SubprocessError):
        return False
    return proc.returncode == 0 and bool(proc.stdout.strip())


def chat_url(prompt: str) -> str:
    return "claude://claude.ai/new?q=" + quote(prompt, safe="")


def open_chat(prompt: str) -> None:
    try:
        subprocess.run(["open", chat_url(prompt)], check=True, capture_output=True, timeout=QUICK_SECONDS)
    except (OSError, subprocess.SubprocessError):
        raise StartError("Could not open Claude Desktop.") from None
