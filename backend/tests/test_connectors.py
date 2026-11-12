import io
import json

import pytest

from todohub import connectors
from todohub.config import load_settings


@pytest.mark.parametrize("tool,server,kind", [
    ("slack_search_public_and_private", "Slack", "read"),
    ("slack_send_message", "Slack", "write"),
    ("get_thread", "Gmail", "read"),
    ("create_draft", "Gmail", "write"),
    ("list_release_notes", "Linear", "read"),
    ("list_meetings", "Zoom", "read"),
    ("getMeetingSummary", "Zoom", "read"),
    ("fetch_meeting_transcript", "Grain", "read"),
    ("get_or_create_contact", "HubSpot", "unclear"),        # reads, but the name also says create
    ("resolve_urls", "Grain", "write"),                       # cautious: resolve can change things
    ("my_settings", "Grain", "read"),
    ("meeting_notes", "Zoom", "unclear"),                     # no verb at all
    ("bulk_delete_recordings", "Zoom", "write"),
    ("outlook_search_email", "Microsoft_365", "read"),
    ("teams_send_message", "Microsoft_365", "write"),
    ("respond_to_event", "Google_Calendar", "write"),
    ("download_file_content", "Google_Drive", "read"),
])
def test_classify(tool, server, kind):
    assert connectors.classify(tool, server) == kind


INIT = {
    "type": "system", "subtype": "init",
    "mcp_servers": [{"name": "claude.ai Zoom", "status": "connected"}, {"name": "claude.ai Slack", "status": "connected"},
                    {"name": "claude.ai Linear", "status": "connected"}, {"name": "my-local", "status": "connected"}],
    "tools": ["Read", "mcp__claude_ai_Zoom__list_meetings", "mcp__claude_ai_Zoom__delete_recording",
              "mcp__claude_ai_Zoom__get_meeting_summary", "mcp__claude_ai_Slack__slack_read_thread",
              "mcp__claude_ai_Linear__save_issue", "mcp__my-local__thing",
              "mcp__claude_ai_Microsoft_365__outlook_search_email"],
}


def test_from_init_groups_and_flags():
    found = {c["server"]: c for c in connectors.from_init(INIT, ["mcp__claude_ai_Linear"])}
    assert set(found) == {"Zoom", "Slack", "Linear", "Microsoft_365"}
    zoom = found["Zoom"]
    assert [t["name"] for t in zoom["tools"]] == ["get_meeting_summary", "list_meetings", "delete_recording"]
    assert [t["kind"] for t in zoom["tools"]] == ["read", "read", "write"]
    assert zoom["builtin"] is None and not zoom["denied"] and zoom["status"] == "connected"
    assert found["Slack"]["builtin"] == "slack"
    assert found["Linear"]["denied"] is True
    ms = found["Microsoft_365"]            # tools without a server line still count
    assert ms["name"] == "Microsoft 365" and ms["tools"][0]["kind"] == "read"


class FakeProc:
    def __init__(self, lines, err=""):
        self.stdout = io.StringIO("".join(lines))
        self.stderr = io.StringIO(err)
        self.killed = False
        self.returncode = None

    def poll(self):
        return self.returncode

    def kill(self):
        self.killed = True
        self.returncode = -9

    def wait(self):
        return self.returncode


def test_discover_starts_like_a_sweep_and_stops_at_init():
    proc = FakeProc(["not json\n", json.dumps({"type": "system", "subtype": "hook"}) + "\n", json.dumps(INIT) + "\n",
                     json.dumps({"type": "assistant"}) + "\n"])
    seen = {}
    settings = load_settings()

    def popen(cmd, **kw):
        seen["cmd"], seen["cwd"] = cmd, kw["cwd"]
        seen["mcp"] = json.loads(open(cmd[cmd.index("--mcp-config") + 1]).read())
        return proc

    report = {}
    found = connectors.discover(settings, report=report, popen=popen)
    assert proc.killed and {c["server"] for c in found} == {"Zoom", "Slack", "Linear", "Microsoft_365"}
    cmd = seen["cmd"]
    assert "--restricted" in cmd and "stream-json" in cmd and "--allowedTools" in cmd
    assert "--disallowedTools" not in cmd                      # write tools must show, to be labelled
    assert "todo-db" in seen["mcp"]["mcpServers"] and seen["cwd"].name == "sweep"
    assert not (settings.sweep_dir / "mcp-probe.json").exists()
    assert report["tools"]["mcp__claude_ai_Zoom"] == 3


def test_init_event_without_init_is_an_error():
    with pytest.raises(connectors.DiscoveryError, match="not logged in"):
        connectors.discover(load_settings(), popen=lambda cmd, **kw: FakeProc([], err="not logged in"))


def test_probe_compares_starts():
    settings = load_settings()
    cmds = []
    event = {"type": "system", "subtype": "init", "tools": ["Read", "mcp__claude_ai_Slack__slack_read_thread"],
             "mcp_servers": [{"name": "claude.ai Slack", "status": "connected"}]}

    def popen(cmd, **kw):
        cmds.append(cmd)
        return FakeProc([json.dumps(event) + "\n"])

    out = connectors.probe(settings, popen=popen)
    assert len(out) == 4 and out[1][0] == "exactly like a sweep"
    assert out[1][1]["tools"] == {"(built-in)": 1, "mcp__claude_ai_Slack": 1}
    assert "--mcp-config" not in cmds[0]
    assert "--mcp-config" in cmds[1] and "--disallowedTools" in cmds[1] and "--disallowedTools" not in cmds[2]
    assert "--restricted" not in cmds[3]
    assert not (settings.sweep_dir / "mcp-probe.json").exists()
