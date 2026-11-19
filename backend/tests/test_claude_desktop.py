import subprocess

import pytest

from todohub import claude_desktop
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
