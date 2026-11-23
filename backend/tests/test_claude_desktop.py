import subprocess

import pytest
from conftest import FakeLinear
from fastapi.testclient import TestClient

from todohub import claude_desktop
from todohub.api import create_app
from todohub.config import load_settings
from todohub.db import DB
# Bound at import, before conftest's no_claude_desktop replaces the module's is_installed for each test.
from todohub.claude_desktop import is_installed
from todohub.start import StartError


def test_open_chat_opens_the_encoded_link(monkeypatch):
    ran = []
    monkeypatch.setattr(subprocess, "run", lambda args, **kw: ran.append(args))
    claude_desktop.open_chat("Read ENG-1 & fix #2?\nThanks, 100% é")
    assert ran == [["open", "claude://claude.ai/new?q=Read%20ENG-1%20%26%20fix%20%232%3F%0AThanks%2C%20100%25%20%C3%A9"]]


@pytest.mark.parametrize("error", [subprocess.CalledProcessError(1, "open", stderr="no handler\n"),
                                   subprocess.TimeoutExpired("open", 15)])
def test_open_chat_failure(monkeypatch, error):
    def fail(args, **kw):
        raise error

    monkeypatch.setattr(subprocess, "run", fail)
    with pytest.raises(StartError, match="Could not open Claude Desktop."):
        claude_desktop.open_chat("Read ENG-1.")


@pytest.mark.parametrize(("code", "stdout", "stderr", "installed"), [
    (0, "/Applications/Claude.app\n", "", True),
    (0, "\n", "", False),
    (1, "", "script error", False),
])
def test_is_installed_asks_launch_services(monkeypatch, code, stdout, stderr, installed):
    ran = []

    def run(cmd, **kw):
        ran.append((cmd, kw))
        return subprocess.CompletedProcess(cmd, code, stdout=stdout, stderr=stderr)

    monkeypatch.setattr(subprocess, "run", run)
    assert is_installed() is installed
    cmd, kw = ran[0]
    assert cmd[:4] == ["osascript", "-l", "JavaScript", "-e"]
    assert claude_desktop.BUNDLE_ID in cmd[4]
    assert kw["timeout"] == claude_desktop.FIND_SECONDS


def test_is_installed_is_false_on_timeout(monkeypatch):
    def slow(cmd, **kw):
        raise subprocess.TimeoutExpired(cmd, claude_desktop.FIND_SECONDS)

    monkeypatch.setattr(subprocess, "run", slow)
    assert is_installed() is False


def client() -> TestClient:
    settings = load_settings()
    return TestClient(create_app(settings, DB(settings.db_path), linear_factory=FakeLinear))


def test_the_route_opens_a_chat_with_the_chat_prompt(monkeypatch):
    chats = []
    monkeypatch.setattr(claude_desktop, "is_installed", lambda: True)
    monkeypatch.setattr(claude_desktop, "open_chat", chats.append)
    c = client()
    c.get("/api/meta")
    r = c.post("/api/issues/id-ENG-1/claude-desktop")
    assert r.status_code == 200 and r.json() == {"ok": True}
    assert chats == ["Read Linear ticket ENG-1 (https://linear.app/x/issue/ENG-1) and its comments with the Linear "
                     "connector. Sum up the ask, then help me with it."]


def test_the_route_answers_404_when_claude_desktop_is_not_installed(monkeypatch):
    monkeypatch.setattr(claude_desktop, "is_installed", lambda: False)
    monkeypatch.setattr(claude_desktop, "open_chat", pytest.fail)
    c = client()
    c.get("/api/meta")
    r = c.post("/api/issues/id-ENG-1/claude-desktop")
    assert r.status_code == 404 and r.json() == {"error": "Claude Desktop is not installed."}


def test_a_link_that_fails_is_a_502(monkeypatch):
    def fail(prompt):
        raise StartError("Could not open Claude Desktop.")

    monkeypatch.setattr(claude_desktop, "is_installed", lambda: True)
    monkeypatch.setattr(claude_desktop, "open_chat", fail)
    c = client()
    c.get("/api/meta")
    r = c.post("/api/issues/id-ENG-1/claude-desktop")
    assert r.status_code == 502 and r.json() == {"error": "Could not open Claude Desktop."}


@pytest.mark.parametrize("installed", [False, True])
def test_meta_says_whether_claude_desktop_is_installed(monkeypatch, installed):
    monkeypatch.setattr(claude_desktop, "is_installed", lambda: installed)
    assert client().get("/api/meta").json()["claude_desktop"] is installed


def test_meta_checks_for_claude_desktop_once_per_refresh(monkeypatch):
    checks = []
    monkeypatch.setattr(claude_desktop, "is_installed", lambda: checks.append(1) or True)
    c = client()
    c.get("/api/meta")
    c.get("/api/meta")
    assert len(checks) == 1
    c.get("/api/meta?refresh=true")
    assert len(checks) == 2
