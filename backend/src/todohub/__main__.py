"""One entry point for every part of TodoHub, so it can ship as a single binary.

    todohub-backend api [--port N]        the local API the app talks to
    todohub-backend sweep [--trigger ...] one sweep, or --capture TEXT
    todohub-backend mcp                   the todo-db MCP server (started by Claude Code)
    todohub-backend cli <command>         init, set-linear-key, check, install-schedule, ...

From a checkout, `python -m todohub <command>` does the same.
"""

from __future__ import annotations

import sys

USAGE = __doc__


def main(argv: list[str] | None = None) -> int:
    args = list(sys.argv[1:] if argv is None else argv)
    if not args or args[0] in ("-h", "--help"):
        print(USAGE)
        return 0
    command, rest = args[0], args[1:]
    sys.argv = [f"todohub-backend {command}", *rest]
    if command == "api":
        from .api import serve
        serve()
        return 0
    if command == "sweep":
        from .sweep import main as sweep_main
        return sweep_main(rest)
    if command == "mcp":
        from .mcp_server import main as mcp_main
        mcp_main()
        return 0
    if command == "cli":
        from .cli import main as cli_main
        return cli_main(rest)
    print(f"Unknown command {command!r}.\n{USAGE}", file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main())
