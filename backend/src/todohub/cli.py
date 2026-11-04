"""`todohub` command line: one-time setup and checks.

    todohub init                 create the settings folder, config.toml and app.json
    todohub set-linear-key       store the Linear API key in the macOS Keychain
    todohub check                verify Linear, Claude Code and the config
    todohub list-tools gmail     ask Claude Code for a connector's exact tool names
    todohub install-schedule     run the sweep on weekdays at 8, 10, 12, 14 and 16 (launchd)
    todohub uninstall-schedule   stop the scheduled sweep
"""

from __future__ import annotations

import argparse
import getpass
import json
import os
import plistlib
import shutil
import subprocess
import sys
from pathlib import Path

from .config import ensure_home, get_linear_key, load_settings, set_linear_key
from .linear import Linear, LinearError
from .selfcmd import self_command

LABEL = "com.todohub.sweep"
SCHEDULE_HOURS = (8, 10, 12, 14, 16)
WEEKDAYS = (1, 2, 3, 4, 5)   # launchd: 0 and 7 are Sunday
CONNECTORS = {"gmail": "claude.ai Gmail", "slack": "claude.ai Slack", "grain": "claude.ai Grain"}


def plist_path() -> Path:
    return Path.home() / "Library" / "LaunchAgents" / f"{LABEL}.plist"


def schedule_plist() -> dict:
    settings = load_settings()
    env = {"PATH": os.environ.get("PATH", "/usr/bin:/bin")}
    if os.environ.get("TODOHUB_HOME"):
        env["TODOHUB_HOME"] = os.environ["TODOHUB_HOME"]
    return {
        "Label": LABEL,
        "ProgramArguments": [*self_command("sweep"), "--trigger", "schedule"],
        "StartCalendarInterval": [
            {"Weekday": d, "Hour": h, "Minute": 0} for d in WEEKDAYS for h in SCHEDULE_HOURS
        ],
        "EnvironmentVariables": env,
        "StandardOutPath": str(settings.log_dir / "launchd.log"),
        "StandardErrorPath": str(settings.log_dir / "launchd.log"),
        "ProcessType": "Background",
    }


def broad_allow_rules(settings, path: Path | None = None) -> list[str]:
    """Allow rules in Claude Code's user settings that reach beyond the sweep's read-only tools."""
    path = path or Path.home() / ".claude" / "settings.json"
    try:
        rules = json.loads(path.read_text()).get("permissions", {}).get("allow", [])
    except (OSError, ValueError):
        return []
    read_only = (set(settings.slack_tools) | set(settings.gmail_tools) | set(settings.grain_tools)
                 | set(settings.calendar_tools))
    return [r for r in rules if isinstance(r, str) and r.startswith("mcp__") and r not in read_only]


def bypass_default(path: Path | None = None) -> bool:
    path = path or Path.home() / ".claude" / "settings.json"
    try:
        return json.loads(path.read_text()).get("permissions", {}).get("defaultMode") == "bypassPermissions"
    except (OSError, ValueError):
        return False


def cmd_init(_: argparse.Namespace) -> int:
    home = ensure_home()
    # Tells the desktop app how to start this backend (the Python of this install).
    (home / "app.json").write_text(json.dumps({"backend": self_command("api")}, indent=2))
    print(f"Settings folder: {home}")
    print(f"Edit {home / 'config.toml'} to change settings.")
    return 0


def cmd_set_linear_key(_: argparse.Namespace) -> int:
    key = getpass.getpass("Linear personal API key (input hidden): ").strip()
    if not key:
        print("No key entered.")
        return 1
    settings = load_settings()
    client = Linear(key)
    try:
        meta = client.team_meta(settings.team_key, settings.client_label_group)
    except LinearError as exc:
        print(f"Key not saved: {exc}")
        return 1
    finally:
        client.close()
    set_linear_key(key)
    print(f"Saved. Team {settings.team_key}: {len(meta.states)} statuses, {len(meta.client_labels)} client labels.")
    return 0


def cmd_check(_: argparse.Namespace) -> int:
    settings = load_settings()
    ok = True
    print(f"Settings folder: {settings.home}")
    try:
        client = Linear(get_linear_key())
        try:
            meta = client.team_meta(settings.team_key, settings.client_label_group)
            issues = client.my_open_issues()
        finally:
            client.close()
        states = [s["name"] for s in meta.states]
        print(f"Linear: OK. {len(issues)} open issues, {len(meta.client_labels)} client labels.")
        if settings.todo_state not in states:
            ok = False
            print(f"  ! No status named {settings.todo_state!r}. Statuses: {', '.join(states)}")
    except (LinearError, RuntimeError) as exc:
        ok = False
        print(f"Linear: FAILED. {exc}")
    claude = shutil.which(settings.claude_path) or (settings.claude_path if Path(settings.claude_path).exists() else None)
    if claude:
        print(f"Claude Code: {claude}")
    else:
        ok = False
        print(f"Claude Code: not found as {settings.claude_path!r}. Set sweep.claude_path in config.toml.")
    risky = broad_allow_rules(settings)
    if not settings.restricted and (risky or bypass_default()):
        ok = False
        print("  ! restricted = false, and ~/.claude/settings.json pre-approves tools the sweep doesn't need"
              + (" (defaultMode is bypassPermissions)" if bypass_default() else "") + ":")
        for rule in risky:
            print(f"      {rule}")
        print("    Set restricted = true in config.toml so sweeps ignore those settings.")
    elif risky:
        print(f"Claude Code settings: {len(risky)} broad allow rules, ignored by sweeps (restricted mode).")
    print(f"Sources on: {', '.join(settings.enabled_sources()) or 'none'}")
    if not settings.gmail_tools:
        print("  Gmail is off (gmail_tools = [] in config.toml).")
    if settings.github_reviews:
        try:
            gh = subprocess.run([settings.gh_path, "auth", "status"], capture_output=True, text=True, timeout=20)
            print("GitHub (gh): signed in" if gh.returncode == 0 else
                  f"GitHub (gh): not signed in. Run `gh auth login`. {gh.stderr.strip()[:200]}")
        except (FileNotFoundError, subprocess.TimeoutExpired):
            print(f"GitHub (gh): not found as {settings.gh_path!r}. Install it, or set github_reviews = false.")
    print(f"Schedule: {'installed' if plist_path().exists() else 'not installed'}")
    print(f"Dead Man's Snitch: {'set' if settings.snitch_url else 'not set'}")
    return 0 if ok else 1


def cmd_list_tools(args: argparse.Namespace) -> int:
    settings = load_settings()
    connector = CONNECTORS[args.source]
    prompt = (
        f"List the exact names of every tool provided by the {connector} MCP server, one per line, "
        "with a short note on whether each one only reads or can change/send something. "
        "Do not call any of those tools."
    )
    return subprocess.call(
        [settings.claude_path, "-p", prompt, "--output-format", "text", "--max-turns", "5"],
        cwd=settings.sweep_dir,
    )


def cmd_install_schedule(_: argparse.Namespace) -> int:
    path = plist_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "wb") as fh:
        plistlib.dump(schedule_plist(), fh)
    domain = f"gui/{os.getuid()}"
    subprocess.call(["launchctl", "bootout", domain, str(path)], stderr=subprocess.DEVNULL)
    code = subprocess.call(["launchctl", "bootstrap", domain, str(path)])
    if code == 0:
        hours = ", ".join(f"{h}:00" for h in SCHEDULE_HOURS)
        print(f"Scheduled: weekdays at {hours} (your Mac's local time). If the Mac is asleep, the run happens on wake.")
    return code


def cmd_uninstall_schedule(_: argparse.Namespace) -> int:
    path = plist_path()
    subprocess.call(["launchctl", "bootout", f"gui/{os.getuid()}", str(path)], stderr=subprocess.DEVNULL)
    path.unlink(missing_ok=True)
    print("Schedule removed.")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="todohub", description="TodoHub setup and checks.")
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("init").set_defaults(fn=cmd_init)
    sub.add_parser("set-linear-key").set_defaults(fn=cmd_set_linear_key)
    sub.add_parser("check").set_defaults(fn=cmd_check)
    lt = sub.add_parser("list-tools")
    lt.add_argument("source", choices=sorted(CONNECTORS))
    lt.set_defaults(fn=cmd_list_tools)
    sub.add_parser("install-schedule").set_defaults(fn=cmd_install_schedule)
    sub.add_parser("uninstall-schedule").set_defaults(fn=cmd_uninstall_schedule)
    args = parser.parse_args(argv)
    return args.fn(args)


if __name__ == "__main__":
    sys.exit(main())
