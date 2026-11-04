"""How this install starts its own parts: as `python -m todohub.<module>` from a checkout,
or as `todohub-backend <command>` when bundled into the app as a single binary."""

from __future__ import annotations

import sys

MODULES = {"api": "todohub.api", "sweep": "todohub.sweep", "mcp": "todohub.mcp_server", "cli": "todohub.cli"}


def frozen() -> bool:
    return bool(getattr(sys, "frozen", False))


def self_command(command: str) -> list[str]:
    if frozen():
        return [sys.executable, command]
    return [sys.executable, "-m", MODULES[command]]
