import subprocess

import pytest

from todohub import claude_desktop
# Bound at import, before conftest's no_claude_desktop replaces the module's is_installed for each test.
from todohub.claude_desktop import is_installed
from todohub.start import StartError


def test_chat_url_encodes_the_prompt():
    assert claude_desktop.chat_url("Read ENG-1 & fix #2?\nThanks, 100%") == \
        "claude://claude.ai/new?q=Read%20ENG-1%20%26%20fix%20%232%3F%0AThanks%2C%20100%25"


def test_open_chat_opens_the_link(monkeypatch):
    ran = []
    monkeypatch.setattr(subprocess, "run", lambda args, **kw: ran.append(args))
    claude_desktop.open_chat("Read ENG-1.")
    assert ran == [["open", "claude://claude.ai/new?q=Read%20ENG-1."]]


def test_open_chat_failure(monkeypatch):
    def fail(args, **kw):
        raise subprocess.CalledProcessError(1, args)

    monkeypatch.setattr(subprocess, "run", fail)
    with pytest.raises(StartError, match="Could not open Claude Desktop."):
        claude_desktop.open_chat("Read ENG-1.")


@pytest.mark.parametrize(("stdout", "installed"), [("/Applications/Claude.app\n", True), ("\n", False)])
def test_is_installed_asks_launch_services(monkeypatch, stdout, installed):
    ran = []

    def run(cmd, **kw):
        ran.append(cmd)
        return subprocess.CompletedProcess(cmd, 0, stdout=stdout, stderr="")

    monkeypatch.setattr(subprocess, "run", run)
    assert is_installed() is installed
    assert ran[0][:4] == ["osascript", "-l", "JavaScript", "-e"] and claude_desktop.BUNDLE_ID in ran[0][4]


def test_is_installed_is_false_without_osascript(monkeypatch):
    def missing(cmd, **kw):
        raise FileNotFoundError("osascript")

    monkeypatch.setattr(subprocess, "run", missing)
    assert is_installed() is False
