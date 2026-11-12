"""Which claude.ai connectors Claude Code can see, and which of their tools only read.

Claude Code announces its MCP servers and every tool it has in an "init" message when a headless
run starts, before the model is called. ``discover`` starts a run exactly as a sweep does (same
folder, restricted mode, the todo-db MCP config, the same allowed tools), reads that message and
stops the run, so nothing is asked of the model and no tool is called. (Restricted mode loads no
MCP servers at all without an --mcp-config, so a plainer start sees no connectors.) The one
difference from a sweep: no --disallowedTools, so write tools show up and can be labelled; a
server with no tools here can't be used by a sweep either. ``classify`` sorts each tool by name:

- read:    the name starts with a reading verb (get, list, search, fetch, read, ...) and has no
           writing word in it. Pre-ticked when a source is set up.
- write:   it starts with, or contains, a word that changes or sends something (create, update,
           delete, send, share, ...). Can never be allowed for a sweep.
- unclear: neither. Shown unticked with a warning; you decide.

Connectors don't label their tools as reading or writing, so this is a judgment from names,
deliberately cautious: a read tool with an odd name is left unclear rather than allowed.
"""

from __future__ import annotations

import json
import re
import subprocess
import threading
from typing import Callable

from .config import Settings

CONNECTOR_PREFIX = "mcp__claude_ai_"
# Connectors TodoHub already reads as built-in sources (see config.py's tool lists).
BUILTIN = {"Slack": "slack", "Gmail": "gmail", "Grain": "grain", "Google_Calendar": "calendar", "HubSpot": "hubspot"}

# Verbs a tool name may start with to count as reading.
READ_VERBS = {
    "get", "list", "search", "fetch", "read", "find", "query", "describe", "lookup", "look", "show",
    "view", "count", "download", "retrieve", "inspect", "preview", "whoami", "my", "me",
}
# Words that change or send something: a name starting with one is "write", and a name holding
# one anywhere is never "read".
WRITE_WORDS = {
    "create", "update", "delete", "remove", "send", "post", "reply", "forward", "write", "upload", "trash",
    "untrash", "share", "unshare", "invite", "cancel", "publish", "merge", "submit", "approve", "execute",
    "run", "modify", "insert", "patch", "put", "edit", "set", "save", "add", "move", "archive", "unarchive",
    "mark", "unmark", "label", "unlabel", "assign", "unassign", "close", "complete", "restore", "enable",
    "disable", "start", "stop", "rename", "copy", "duplicate", "transfer", "grant", "revoke", "pin", "unpin",
    "react", "star", "subscribe", "unsubscribe", "join", "leave", "book", "accept", "decline", "respond",
    "schedule", "draft", "comment", "import", "apply", "rotate", "force", "retire", "sync", "trigger",
    "deploy", "clear", "reset", "toggle", "change", "convert", "mutate", "batch", "manage", "connect",
    "disconnect", "authorize", "login", "logout", "pay", "refund", "order", "purchase", "register", "kick",
    "ban", "mute", "unmute", "resolve", "dismiss", "snooze", "unsnooze", "upsert", "replace", "append",
}


def words(tool: str, server: str = "") -> list[str]:
    """``slack_search_public`` -> ["search", "public"] (the server's own name dropped);
    ``getMeetingSummary`` -> ["get", "meeting", "summary"]."""
    parts = re.sub(r"([a-z0-9])([A-Z])", r"\1_\2", tool).lower()
    out = [w for w in re.split(r"[^a-z0-9]+", parts) if w]
    lead = {p.lower() for p in re.split(r"[^A-Za-z0-9]+", server) if p}
    while out[1:] and out[0] in lead:
        out = out[1:]
    return out


def classify(tool: str, server: str = "") -> str:
    w = words(tool, server)
    if not w:
        return "unclear"
    if len(w) > 1 and w[0] not in READ_VERBS | WRITE_WORDS and w[1] in READ_VERBS | WRITE_WORDS:
        w = w[1:]          # a product name first: outlook_search_email, teams_send_message
    if w[0] in WRITE_WORDS:
        return "write"
    if w[0] in READ_VERBS:
        return "unclear" if any(x in WRITE_WORDS for x in w[1:]) else "read"
    return "write" if any(x in WRITE_WORDS for x in w) else "unclear"


def split_tool(full: str) -> tuple[str, str] | None:
    """``mcp__claude_ai_Zoom__list_meetings`` -> ("Zoom", "list_meetings"); None for other tools."""
    if not full.startswith(CONNECTOR_PREFIX) or "__" not in full[len(CONNECTOR_PREFIX):]:
        return None
    server, tool = full[len(CONNECTOR_PREFIX):].split("__", 1)
    return server, tool


def from_init(event: dict, denied: list[str] | None = None) -> list[dict]:
    """The claude.ai connectors in an init message, each with its tools sorted and classified."""
    denied = denied or []
    servers: dict[str, dict] = {}
    for s in event.get("mcp_servers") or []:
        name = str(s.get("name", ""))
        # Claude Code names them "claude.ai Zoom"; tool names use claude_ai_Zoom.
        if name.startswith("claude.ai "):
            key = re.sub(r"[^A-Za-z0-9]+", "_", name[len("claude.ai "):]).strip("_")
            servers[key] = {"server": key, "name": name[len("claude.ai "):], "status": s.get("status"), "tools": []}
    for full in event.get("tools") or []:
        hit = split_tool(str(full))
        if not hit:
            continue
        server, tool = hit
        entry = servers.setdefault(server, {"server": server, "name": server.replace("_", " "), "status": None, "tools": []})
        entry["tools"].append({"name": tool, "full": full, "kind": classify(tool, server)})
    out = []
    for key, entry in sorted(servers.items(), key=lambda kv: kv[1]["name"].lower()):
        order = {"read": 0, "unclear": 1, "write": 2}
        entry["tools"].sort(key=lambda t: (order[t["kind"]], t["name"]))
        entry["builtin"] = BUILTIN.get(key)
        entry["denied"] = any(f"{CONNECTOR_PREFIX}{key}" == d or f"{CONNECTOR_PREFIX}{key}".startswith(d + "__")
                              for d in denied)
        out.append(entry)
    return out


class DiscoveryError(RuntimeError):
    pass


def discovery_command(settings: Settings, mcp_path) -> list[str]:
    """A sweep's command with a placeholder prompt, streaming (for the init message) and without
    the deny list. The run is stopped at the init message; the prompt is never answered."""
    from .sweep import claude_command
    cmd = claude_command(settings, "Reply with OK.", mcp_path)
    i = cmd.index("--output-format")
    cmd[i:i + 2] = ["--output-format", "stream-json", "--verbose"]
    cmd[cmd.index("--model") + 1] = "haiku"
    i = cmd.index("--disallowedTools")
    del cmd[i:i + 2]
    return cmd


def probe_mcp_file(settings: Settings):
    """The todo-db MCP config a sweep passes (restricted mode loads connectors only with one)."""
    from .sweep import mcp_config
    settings.sweep_dir.mkdir(parents=True, exist_ok=True)
    path = settings.sweep_dir / "mcp-probe.json"
    path.write_text(json.dumps(mcp_config(settings, 0), indent=2))
    return path


def init_event(settings: Settings, timeout: float = 90,
               popen: Callable[..., subprocess.Popen] = subprocess.Popen, cmd: list[str] = ()) -> dict:
    """Start a run, return its init message, and stop the run."""
    from .sweep import _env
    settings.sweep_dir.mkdir(parents=True, exist_ok=True)
    try:
        proc = popen(cmd, cwd=settings.sweep_dir, env=_env(), text=True,
                     stdout=subprocess.PIPE, stderr=subprocess.PIPE, stdin=subprocess.DEVNULL)
    except FileNotFoundError:
        raise DiscoveryError(f"Can't find Claude Code at {settings.claude_path!r}.")
    timer = threading.Timer(timeout, proc.kill)
    timer.start()
    try:
        for line in proc.stdout:
            try:
                event = json.loads(line)
            except ValueError:
                continue
            if event.get("type") == "system" and event.get("subtype") == "init":
                return event
        err = (proc.stderr.read() if proc.stderr else "") or ""
        raise DiscoveryError(f"Claude Code ended without listing its tools. {err.strip()[:300]}".strip())
    finally:
        timer.cancel()
        if proc.poll() is None:
            proc.kill()
        proc.wait()


def discover(settings: Settings, report: dict | None = None, **kw) -> list[dict]:
    """The connectors a sweep can see and their tools. ``report`` gets the raw start-up summary,
    for `todohub connectors --debug`."""
    from .sweep import denied_servers
    mcp_path = probe_mcp_file(settings)
    try:
        event = init_event(settings, cmd=discovery_command(settings, mcp_path), **kw)
    finally:
        mcp_path.unlink(missing_ok=True)
    if report is not None:
        report.update(summarize(event))
    return from_init(event, denied_servers(settings))


def summarize(event: dict) -> dict:
    """An init message in short: each MCP server's status and how many tools each server has."""
    prefixes: dict[str, int] = {}
    for t in event.get("tools") or []:
        key = "__".join(str(t).split("__")[:2]) if str(t).startswith("mcp__") else "(built-in)"
        prefixes[key] = prefixes.get(key, 0) + 1
    return {"servers": [(s.get("name"), s.get("status")) for s in event.get("mcp_servers") or []], "tools": prefixes}


def probe_commands(settings: Settings, mcp_path) -> list[tuple[str, list[str]]]:
    """Ways to start Claude Code, to see which one loads the claude.ai connectors. Each run is
    stopped at its init message, before the model answers."""
    from .sweep import claude_command, hardening_flags
    sweep = claude_command(settings, "Reply with OK.", mcp_path)
    i = sweep.index("--output-format")
    sweep[i:i + 2] = ["--output-format", "stream-json", "--verbose"]
    sweep[sweep.index("--model") + 1] = "haiku"
    bare = [settings.claude_path, "-p", "Reply with OK.", *hardening_flags(settings),
            "--output-format", "stream-json", "--verbose", "--model", "haiku", "--max-turns", "1"]
    return [("restricted, no MCP config", bare),
            ("exactly like a sweep", sweep),
            ("discovery (a sweep without the deny list)", discovery_command(settings, mcp_path)),
            ("not restricted", [a for a in bare if a != "--restricted"])]


def probe(settings: Settings, **kw) -> list[tuple[str, dict | str]]:
    mcp_path = probe_mcp_file(settings)
    out: list[tuple[str, dict | str]] = []
    try:
        for label, cmd in probe_commands(settings, mcp_path):
            try:
                out.append((label, summarize(init_event(settings, cmd=cmd, **kw))))
            except DiscoveryError as exc:
                out.append((label, str(exc)))
    finally:
        mcp_path.unlink(missing_ok=True)
    return out
