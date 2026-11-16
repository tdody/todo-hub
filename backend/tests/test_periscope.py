import json
import subprocess
from types import SimpleNamespace

import httpx
import pytest

from todohub import periscope
from todohub.config import load_settings
from todohub.db import DB
from todohub.periscope import (LAST_REPO_KEY, REPOS_KEY, Periscope, PeriscopeError, default_repo, fill_prompt,
                               remember_repo)

URL = "http://127.0.0.1:17374"
CATALOG = {
    "repos": [{"repo": "/dev/api", "label": "api", "default_branch": "main", "branches": []},
              {"repo": "/dev/web", "label": "web", "default_branch": "main", "branches": []}],
    "worktrees": [{"path": "/dev/worktrees/web/me-eng-1", "repo": "/dev/web", "branch": "me/eng-1", "is_main": False}],
    "roots": ["/dev"],
}
SPAWNED = {"mode": "spawned", "pid": "k", "path": "/dev/worktrees/api/me-eng-1", "reused": False}


@pytest.fixture
def peri():
    """Periscope behind an httpx MockTransport. ``calls`` holds (method, path, body); set ``answer`` to change
    what POST /api/linear/start answers."""
    p = SimpleNamespace(calls=[], answer=httpx.Response(200, json=SPAWNED))

    def handler(request: httpx.Request) -> httpx.Response:
        p.calls.append((request.method, request.url.path, json.loads(request.content) if request.content else None))
        if request.url.path == "/api/open/catalog":
            return httpx.Response(200, json=CATALOG)
        if request.url.path == "/api/linear/start":
            return p.answer
        if request.url.path == "/api/select":
            return httpx.Response(200, json={"ok": True})
        return httpx.Response(404, json={"detail": "Not Found"})

    p.transport = httpx.MockTransport(handler)
    return p


def test_client_calls(peri):
    client = Periscope(URL, transport=peri.transport)
    assert client.catalog() == CATALOG
    assert client.start(repo="/dev/api", branch="me/eng-1", ticket="ENG-1", title="Fix", prompt="Read.") == SPAWNED
    client.select("k")
    assert peri.calls == [
        ("GET", "/api/open/catalog", None),
        ("POST", "/api/linear/start",
         {"repo": "/dev/api", "branch": "me/eng-1", "ticket": "ENG-1", "title": "Fix", "prompt": "Read."}),
        ("POST", "/api/select", {"pid": "k"}),
    ]


def test_client_errors(peri):
    client = Periscope(URL, transport=peri.transport)
    peri.answer = httpx.Response(409, json={"detail": "start already running"})
    with pytest.raises(PeriscopeError, match="start already running") as e:
        client.start(repo="/dev/api", branch="b", ticket="ENG-1", title="", prompt="p")
    assert e.value.status == 409
    peri.answer = httpx.Response(502, json={"detail": "spawn failed: no server"})
    with pytest.raises(PeriscopeError, match="spawn failed: no server") as e:
        client.start(repo="/dev/api", branch="b", ticket="ENG-1", title="", prompt="p")
    assert e.value.status == 502
    peri.answer = httpx.Response(500, text="Internal Server Error")
    with pytest.raises(PeriscopeError, match="Periscope answered HTTP 500."):
        client.start(repo="/dev/api", branch="b", ticket="ENG-1", title="", prompt="p")


def test_client_when_periscope_is_down_or_slow():
    def refuse(request):
        raise httpx.ConnectError("refused")

    def slow(request):
        raise httpx.ReadTimeout("slow")

    with pytest.raises(PeriscopeError, match=r"Periscope is not running at 127\.0\.0\.1:17374\."):
        Periscope(URL, transport=httpx.MockTransport(refuse)).catalog()
    with pytest.raises(PeriscopeError, match="Periscope didn't answer in 120 s."):
        Periscope(URL, transport=httpx.MockTransport(slow)).catalog()


def test_fill_prompt_fills_three_tokens_and_keeps_other_braces():
    issue = {"identifier": "ENG-1", "title": "Fix {url} in {that}", "url": "https://linear.app/x/issue/ENG-1"}
    assert fill_prompt("Read {identifier}: {title} at {url}. Keep {this}.", issue) == \
        "Read ENG-1: Fix {url} in {that} at https://linear.app/x/issue/ENG-1. Keep {this}."


def test_default_repo_project_then_client_then_last():
    db = DB(load_settings().db_path)
    repos = ["/dev/api", "/dev/web"]
    in_project = {"project": "Pipelines", "client": "Globex"}
    client_only = {"project": None, "client": "Globex"}
    neither = {"project": None, "client": None}
    assert default_repo(db, in_project, repos) == (None, "")
    remember_repo(db, client_only, "/dev/web")
    assert default_repo(db, client_only, repos) == ("/dev/web", "Remembered for Globex.")
    assert default_repo(db, in_project, repos) == ("/dev/web", "The last repo you used.")
    remember_repo(db, in_project, "/dev/api")
    assert default_repo(db, in_project, repos) == ("/dev/api", "Remembered for Pipelines.")
    assert default_repo(db, neither, repos) == ("/dev/api", "The last repo you used.")
    assert db.get_meta(REPOS_KEY) == {"client:Globex": "/dev/web", "project:Pipelines": "/dev/api"}
    assert db.get_meta(LAST_REPO_KEY) == "/dev/api"


def test_default_repo_skips_a_repo_periscope_no_longer_lists():
    db = DB(load_settings().db_path)
    remember_repo(db, {"project": "Pipelines", "client": None}, "/dev/gone")
    assert default_repo(db, {"project": "Pipelines", "client": None}, ["/dev/api"]) == (None, "")


def test_bring_to_front_opens_the_app_by_bundle_id(monkeypatch):
    ran = []
    monkeypatch.setattr(periscope.subprocess, "run", lambda args, **kw: ran.append(args))
    periscope.bring_to_front()
    assert ran == [["open", "-b", "com.tom.periscope.app"]]


def test_bring_to_front_failure(monkeypatch):
    def fail(args, **kw):
        raise subprocess.CalledProcessError(1, args)

    monkeypatch.setattr(periscope.subprocess, "run", fail)
    with pytest.raises(PeriscopeError, match="Could not bring Periscope to the front."):
        periscope.bring_to_front()
