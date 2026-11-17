import json
import subprocess
from types import SimpleNamespace

import httpx
import pytest
from fastapi.testclient import TestClient

from todohub import periscope
from todohub.api import create_app
from todohub.config import load_settings
from todohub.db import DB
from todohub.periscope import (LAST_REPO_KEY, REPOS_KEY, Periscope, PeriscopeError, default_repo, fill_prompt,
                               pane_name, remember_repo)
from conftest import FakeLinear

URL = "http://127.0.0.1:17374"
APP_ID = "com.example.periscope"
CATALOG = {
    "repos": [{"repo": "/dev/api", "label": "api", "default_branch": "main", "branches": []},
              {"repo": "/dev/web", "label": "web", "default_branch": "main", "branches": []}],
    "worktrees": [{"path": "/dev/worktrees/web/me-eng-1", "repo": "/dev/web", "branch": "me/eng-1", "is_main": False},
                  {"path": "/dev/api", "repo": "/dev/api", "branch": "main", "is_main": True}],
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
    assert client.start(repo="/dev/api", branch="me/eng-1", ticket="ENG-1", title="Fix", prompt="Read.",
                        name="eng-1-fix") == SPAWNED
    client.select("k")
    assert peri.calls == [
        ("GET", "/api/open/catalog", None),
        ("POST", "/api/linear/start", {"repo": "/dev/api", "branch": "me/eng-1", "ticket": "ENG-1", "title": "Fix",
                                       "prompt": "Read.", "name": "eng-1-fix"}),
        ("POST", "/api/select", {"pid": "k"}),
    ]


def test_client_errors(peri):
    client = Periscope(URL, transport=peri.transport)
    peri.answer = httpx.Response(409, json={"detail": "start already running"})
    with pytest.raises(PeriscopeError, match="start already running") as e:
        client.start(repo="/dev/api", branch="b", ticket="ENG-1", title="", prompt="p", name="eng-1")
    assert e.value.status == 409
    peri.answer = httpx.Response(502, json={"detail": "spawn failed: no server"})
    with pytest.raises(PeriscopeError, match="spawn failed: no server") as e:
        client.start(repo="/dev/api", branch="b", ticket="ENG-1", title="", prompt="p", name="eng-1")
    assert e.value.status == 502
    peri.answer = httpx.Response(500, text="Internal Server Error")
    with pytest.raises(PeriscopeError, match="Periscope answered HTTP 500."):
        client.start(repo="/dev/api", branch="b", ticket="ENG-1", title="", prompt="p", name="eng-1")


def test_client_when_periscope_is_down_or_slow():
    def refuse(request):
        raise httpx.ConnectError("refused")

    def slow(request):
        raise httpx.ReadTimeout("slow")

    with pytest.raises(PeriscopeError, match=r"Periscope is not running at 127\.0\.0\.1:17374\."):
        Periscope(URL, transport=httpx.MockTransport(refuse)).catalog()
    with pytest.raises(PeriscopeError, match="Periscope didn't answer in 15 s."):
        Periscope(URL, transport=httpx.MockTransport(slow)).catalog()
    with pytest.raises(PeriscopeError, match="Periscope didn't answer in 120 s. It may still start Claude."):
        Periscope(URL, transport=httpx.MockTransport(slow)).start(
            repo="/dev/api", branch="b", ticket="ENG-1", title="", prompt="p", name="eng-1")


NAMED = {"identifier": "ENG-1", "title": "Rebin Globex grades for jane@globex.com"}


def haiku(monkeypatch, *, stdout="", returncode=0, raises=None):
    """Claude Code behind a patched subprocess.run; returns the commands it was given."""
    ran = []

    def run(cmd, **kw):
        ran.append(cmd)
        if raises:
            raise raises
        return subprocess.CompletedProcess(cmd, returncode, stdout=stdout, stderr="")

    monkeypatch.setattr(periscope.subprocess, "run", run)
    return ran


def test_pane_name_is_the_id_and_up_to_three_of_haikus_words(monkeypatch):
    ran = haiku(monkeypatch, stdout=json.dumps({"result": "`Globex-Grades rebin` now"}))
    assert pane_name(load_settings(), NAMED) == "eng-1-globex-grades-rebin"
    cmd = ran[0]
    assert cmd[cmd.index("--model") + 1] == "haiku" and cmd[cmd.index("--tools") + 1] == ""
    assert "Rebin Globex grades for" in cmd[2] and "jane@" not in cmd[2]


@pytest.mark.parametrize("answer", [
    {"raises": FileNotFoundError()},
    {"raises": subprocess.TimeoutExpired("claude", 30)},
    {"stdout": "not json", "returncode": 1},
    {"stdout": json.dumps({"is_error": True, "result": "Credit balance is too low"}), "returncode": 1},
    {"stdout": json.dumps({"result": "—"})},
])
def test_pane_name_is_the_id_alone_when_haiku_gives_no_words(monkeypatch, caplog, answer):
    haiku(monkeypatch, **answer)
    assert pane_name(load_settings(), NAMED) == "eng-1"
    assert "ENG-1" in caplog.text


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


def test_bring_to_front_opens_the_app_by_its_id(monkeypatch):
    ran = []
    monkeypatch.setattr(periscope.subprocess, "run", lambda args, **kw: ran.append(args))
    periscope.bring_to_front(APP_ID)
    assert ran == [["open", "-b", APP_ID]]


def test_bring_to_front_failure(monkeypatch):
    def fail(args, **kw):
        raise subprocess.CalledProcessError(1, args)

    monkeypatch.setattr(periscope.subprocess, "run", fail)
    with pytest.raises(PeriscopeError, match="Could not bring Periscope to the front."):
        periscope.bring_to_front(APP_ID)


START = {"repo": "/dev/api", "branch": " me/eng-1 ", "prompt": "Read ENG-1."}


def settings_on(app_id=APP_ID):
    settings = load_settings()
    settings.periscope_url = URL
    settings.periscope_app_id = app_id
    return settings


@pytest.fixture
def env(peri):
    settings = settings_on()
    db = DB(settings.db_path)
    fronted = []
    app = create_app(settings, db, linear_factory=FakeLinear,
                     periscope_factory=lambda: Periscope(URL, transport=peri.transport),
                     front_fn=fronted.append, name_fn=lambda issue: f"{issue['identifier'].lower()}-rebin")
    return TestClient(app), db, fronted


def test_options_fill_the_popover(env):
    client, db, _ = env
    db.set_meta(REPOS_KEY, {"client:Globex": "/dev/web"})
    r = client.get("/api/issues/id-ENG-1/periscope")
    assert r.status_code == 200
    assert r.json() == {
        "repos": [{"repo": "/dev/api", "label": "api"}, {"repo": "/dev/web", "label": "web"}],
        "repo": "/dev/web",
        "hint": "Remembered for Globex.",
        "branch": "me/eng-1",
        "branch_worktrees": ["/dev/web"],
        "prompt": "Read Linear ticket ENG-1 (https://linear.app/x/issue/ENG-1) and its comments with the Linear "
                  "tools. Sum up the ask, then propose a plan. Do not change code until I agree.",
    }


def test_start_sends_the_issue_and_its_name_and_remembers_the_repo(env, peri):
    client, db, _ = env
    r = client.post("/api/issues/id-ENG-1/periscope", json=START)
    assert r.status_code == 200 and r.json() == SPAWNED
    assert peri.calls[-1] == ("POST", "/api/linear/start", {
        "repo": "/dev/api", "branch": "me/eng-1", "ticket": "ENG-1", "title": "Rebin Globex grades",
        "prompt": "Read ENG-1.", "name": "eng-1-rebin"})
    assert db.get_meta(REPOS_KEY) == {"client:Globex": "/dev/api"}
    assert db.get_meta(LAST_REPO_KEY) == "/dev/api"


def test_a_claude_already_on_the_branch_is_answered_and_the_repo_remembered(env, peri):
    client, db, _ = env
    peri.answer = httpx.Response(200, json={"mode": "existing", "pid": "p1"})
    r = client.post("/api/issues/id-ENG-2/periscope", json=START)
    assert r.json() == {"mode": "existing", "pid": "p1"}
    assert db.get_meta(REPOS_KEY) is None and db.get_meta(LAST_REPO_KEY) == "/dev/api"


def test_a_start_periscope_refuses_says_it_is_already_starting(env, peri):
    client, db, _ = env
    peri.answer = httpx.Response(409, json={"detail": "start already running"})
    r = client.post("/api/issues/id-ENG-1/periscope", json=START)
    assert r.status_code == 409 and r.json() == {"error": "Periscope is already starting ENG-1."}
    assert db.get_meta(LAST_REPO_KEY) is None


def test_other_periscope_errors_carry_its_detail(env, peri):
    client, db, _ = env
    peri.answer = httpx.Response(502, json={"detail": "spawn failed: no server"})
    r = client.post("/api/issues/id-ENG-1/periscope", json=START)
    assert r.status_code == 502 and r.json() == {"error": "spawn failed: no server"}
    assert db.get_meta(LAST_REPO_KEY) is None


def test_options_when_periscope_is_not_running():
    def refuse(request):
        raise httpx.ConnectError("refused")

    settings = settings_on()
    app = create_app(settings, DB(settings.db_path), linear_factory=FakeLinear,
                     periscope_factory=lambda: Periscope(URL, transport=httpx.MockTransport(refuse)))
    r = TestClient(app).get("/api/issues/id-ENG-1/periscope")
    assert r.status_code == 502 and r.json() == {"error": "Periscope is not running at 127.0.0.1:17374."}


def test_show_selects_the_pane_then_brings_periscope_forward(env, peri):
    client, _, fronted = env
    assert client.post("/api/periscope/show", json={"pid": "k"}).json() == {"ok": True}
    assert peri.calls[-1] == ("POST", "/api/select", {"pid": "k"}) and fronted == [APP_ID]


def test_show_without_an_app_id_only_selects_the_pane(peri):
    settings = settings_on(app_id="")
    fronted = []
    app = create_app(settings, DB(settings.db_path), linear_factory=FakeLinear,
                     periscope_factory=lambda: Periscope(URL, transport=peri.transport), front_fn=fronted.append)
    assert TestClient(app).post("/api/periscope/show", json={"pid": "k"}).json() == {"ok": True}
    assert peri.calls[-1] == ("POST", "/api/select", {"pid": "k"}) and fronted == []


def test_show_with_an_app_id_opens_the_app(peri, monkeypatch):
    ran = []
    monkeypatch.setattr(periscope.subprocess, "run", lambda args, **kw: ran.append(args))
    settings = settings_on()
    app = create_app(settings, DB(settings.db_path), linear_factory=FakeLinear,
                     periscope_factory=lambda: Periscope(URL, transport=peri.transport))
    assert TestClient(app).post("/api/periscope/show", json={"pid": "k"}).json() == {"ok": True}
    assert ran == [["open", "-b", APP_ID]]


def test_the_routes_answer_404_when_periscope_is_off(peri):
    settings = load_settings()
    app = create_app(settings, DB(settings.db_path), linear_factory=FakeLinear,
                     periscope_factory=lambda: Periscope(URL, transport=peri.transport), front_fn=pytest.fail)
    client = TestClient(app)
    off = {"error": "Start in periscope is off. Set app.periscope_url in config.toml."}
    for r in (client.get("/api/issues/id-ENG-1/periscope"),
              client.post("/api/issues/id-ENG-1/periscope", json=START),
              client.post("/api/periscope/show", json={"pid": "k"})):
        assert r.status_code == 404 and r.json() == off
    assert peri.calls == []


def test_meta_says_whether_periscope_is_on(peri):
    for settings, expected in ((load_settings(), False), (settings_on(), True)):
        app = create_app(settings, DB(settings.db_path), linear_factory=FakeLinear)
        assert TestClient(app).get("/api/meta").json()["periscope"] is expected


def test_a_blank_branch_is_a_400_and_periscope_is_not_asked(env, peri):
    client, _, _ = env
    r = client.post("/api/issues/id-ENG-1/periscope", json={**START, "branch": "   "})
    assert r.status_code == 400 and r.json() == {"error": "The branch is empty"}
    assert peri.calls == []


def test_show_when_periscope_cannot_be_brought_forward(peri):
    def fail(app_id):
        raise PeriscopeError("Could not bring Periscope to the front.")

    settings = settings_on()
    app = create_app(settings, DB(settings.db_path), linear_factory=FakeLinear,
                     periscope_factory=lambda: Periscope(URL, transport=peri.transport), front_fn=fail)
    r = TestClient(app).post("/api/periscope/show", json={"pid": "k"})
    assert r.status_code == 502 and r.json() == {"error": "Could not bring Periscope to the front."}


def test_show_when_periscope_is_not_running_does_not_bring_it_forward():
    def refuse(request):
        raise httpx.ConnectError("refused")

    fronted = []
    settings = settings_on()
    app = create_app(settings, DB(settings.db_path), linear_factory=FakeLinear,
                     periscope_factory=lambda: Periscope(URL, transport=httpx.MockTransport(refuse)),
                     front_fn=fronted.append)
    r = TestClient(app).post("/api/periscope/show", json={"pid": "k"})
    assert r.status_code == 502 and r.json() == {"error": "Periscope is not running at 127.0.0.1:17374."}
    assert fronted == []
