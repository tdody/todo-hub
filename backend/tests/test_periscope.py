import json
import re
import subprocess
from types import SimpleNamespace

import httpx
import pytest
from fastapi.testclient import TestClient

from todohub import periscope, tools
from todohub.api import create_app
from todohub.config import load_settings
from todohub.db import DB
from todohub.linear import LinearError
from todohub.periscope import Periscope, PeriscopeError, pr_links, pr_repos, review_prs
from todohub.start import LAST_REPO_KEY, REPOS_KEY
from conftest import FakeLinear, git, make_issue

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
# The catalog of a periscope that sends each repo's slug. web's slug has capitals: GitHub ignores case. notes's
# origin is not on GitHub.
SLUGGED = {
    **CATALOG,
    "repos": [{**CATALOG["repos"][0], "slug": "acme/api"}, {**CATALOG["repos"][1], "slug": "Acme/Web"},
              {"repo": "/dev/notes", "label": "notes", "default_branch": "main", "branches": [], "slug": None}],
    "worktrees": [*CATALOG["worktrees"],
                  {"path": "/dev/worktrees/api/pr-812", "repo": "/dev/api", "branch": "pr-812", "is_main": False}],
}
PR = "https://github.com/acme/api/pull/812"


@pytest.fixture
def peri():
    """Periscope behind an httpx MockTransport. ``calls`` holds (method, path, body); set ``answer`` to change
    what POST /api/linear/start answers, and ``catalog`` to change the catalog."""
    p = SimpleNamespace(calls=[], answer=httpx.Response(200, json=SPAWNED), catalog=CATALOG)

    def handler(request: httpx.Request) -> httpx.Response:
        p.calls.append((request.method, request.url.path, json.loads(request.content) if request.content else None))
        if request.url.path == "/api/open/catalog":
            return httpx.Response(200, json=p.catalog)
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


def test_client_start_with_a_pr_sends_no_branch(peri):
    Periscope(URL, transport=peri.transport).start(repo="/dev/api", pr=812, ticket="ENG-3", title="Review",
                                                   prompt="Review it.", name="eng-3")
    assert peri.calls == [("POST", "/api/linear/start", {"repo": "/dev/api", "pr": 812, "ticket": "ENG-3",
                                                         "title": "Review", "prompt": "Review it.", "name": "eng-3"})]


def test_client_start_with_no_ticket_sends_none(peri):
    Periscope(URL, transport=peri.transport).start(repo="/dev/api", pr=812, prompt="Review it.", name="pr-812")
    assert peri.calls == [("POST", "/api/linear/start", {"repo": "/dev/api", "pr": 812, "prompt": "Review it.",
                                                         "name": "pr-812"})]


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
    # FastAPI's 422, from an older periscope that needs the ticket: the message names the field, without the prompt.
    peri.answer = httpx.Response(422, json={"detail": [{"type": "missing", "loc": ["body", "ticket"], "msg": "Field required",
                                                        "input": {"prompt": "p"}}]})
    with pytest.raises(PeriscopeError) as e:
        client.start(repo="/dev/api", pr=812, prompt="p", name="pr-812")
    assert str(e.value) == "ticket: Field required"
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


def test_pr_links_keeps_pull_requests_in_order_once():
    assert pr_links([
        "https://example.slack.com/archives/C1/p1",
        "https://github.com/acme/web/pull/455",
        "https://github.com/acme/api/issues/3",
        "https://github.com/acme/api/commit/abc123",
        f"{PR}/files",
        "https://github.com/acme/web/pull/455#discussion_r1",
        "https://github.com/Acme/Web/pull/455",
    ]) == [("acme/web", 455), ("acme/api", 812)]


def test_review_prs_match_repos_by_origin_and_name_the_missing_ones():
    issue = {"identifier": "ENG-3", "title": "Review", "url": "https://linear.app/x/issue/ENG-3"}
    prs, hint = review_prs([("acme/web", 455), ("acme/api", 812)], SLUGGED, "Review {pr}.", issue)
    assert prs == [
        {"number": 455, "label": "acme/web#455", "url": "https://github.com/acme/web/pull/455",
         "repos": ["/dev/web"], "branch_worktrees": [], "prompt": "Review https://github.com/acme/web/pull/455."},
        {"number": 812, "label": "acme/api#812", "url": PR,
         "repos": ["/dev/api"], "branch_worktrees": ["/dev/api"], "prompt": f"Review {PR}."},
    ]
    assert hint == ""
    assert review_prs([("acme/ios", 7), ("acme/infra", 9), ("acme/ios", 8)], SLUGGED, "Review {pr}.", issue) == (
        [], "No periscope repo has acme/ios or acme/infra as its origin. This starts on the Linear branch.")
    # One PR with a repo is enough: the others are not offered, and there is no hint.
    prs, hint = review_prs([("acme/ios", 7), ("acme/api", 812)], SLUGGED, "Review {pr}.", issue)
    assert [p["label"] for p in prs] == ["acme/api#812"] and hint == ""


def test_pr_repos_are_the_ones_whose_origin_is_the_prs_repo():
    none = {"repos": [], "branch_worktrees": []}
    assert pr_repos(SLUGGED, "ACME/api", 812) == {"repos": [{"repo": "/dev/api", "label": "api"}],
                                                  "branch_worktrees": ["/dev/api"]}
    assert pr_repos(SLUGGED, "acme/web", 812) == {**none, "repos": [{"repo": "/dev/web", "label": "web"}]}
    assert pr_repos(SLUGGED, "acme/ios", 7) == none
    assert pr_repos(CATALOG, "acme/api", 812) == none              # an older periscope sends no slug


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
def linear():
    return FakeLinear()


@pytest.fixture
def env(peri, linear):
    settings = settings_on()
    db = DB(settings.db_path)
    fronted = []
    app = create_app(settings, db, linear_factory=lambda: linear,
                     periscope_factory=lambda: Periscope(URL, transport=peri.transport),
                     front_fn=fronted.append, name_fn=lambda ident, title: f"{ident.lower()}-rebin")
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
        "prs": [],
        "pr_hint": "",
    }


REVIEW_PROMPT = (f"Read Linear ticket ENG-3 (https://linear.app/x/issue/ENG-3) and its comments with the Linear tools. "
                 f"Then review {PR} in this worktree: sum up the change and list the problems you find. "
                 f"Do not post anything on GitHub.")


def review_issue(linear, links, identifier="ENG-3", title="Review acme/api#812: Retry stuck uploads"):
    """A review ticket with ``links``. make_issue's Bug label would make it a code ticket, so it has no label."""
    issue = make_issue(identifier, title)
    issue["labels"]["nodes"] = []
    linear.issues.append(issue)
    linear.existing_links = {issue["id"]: list(links)}
    return issue


def test_a_review_ticket_offers_its_pr(env, peri, linear):
    client, _, _ = env
    peri.catalog = SLUGGED
    review_issue(linear, ["https://example.slack.com/archives/C1/p1", f"{PR}/files"])
    o = client.get("/api/issues/id-ENG-3/periscope").json()
    assert o["prs"] == [{"number": 812, "label": "acme/api#812", "url": PR, "repos": ["/dev/api"],
                         "branch_worktrees": ["/dev/api"], "prompt": REVIEW_PROMPT}]
    assert o["pr_hint"] == ""
    # The branch start stays, for "None: start on the Linear branch".
    assert o["branch"] == "me/eng-3" and o["prompt"].startswith("Read Linear ticket ENG-3")


def test_a_review_ticket_whose_pr_has_no_repo_gets_a_hint(env, peri, linear):
    client, _, _ = env
    peri.catalog = SLUGGED
    review_issue(linear, ["https://github.com/acme/ios/pull/7"])
    o = client.get("/api/issues/id-ENG-3/periscope").json()
    assert o["prs"] == []
    assert o["pr_hint"] == "No periscope repo has acme/ios as its origin. This starts on the Linear branch."


def test_a_ticket_that_is_not_a_review_does_not_read_its_links(env, peri, linear):
    client, _, _ = env
    peri.catalog = SLUGGED
    linear.attachment_urls = lambda issue_id: pytest.fail("read the links of a code ticket")
    o = client.get("/api/issues/id-ENG-1/periscope").json()
    assert o["prs"] == [] and o["pr_hint"] == ""


def test_a_ticket_you_approved_as_a_review_gets_its_pr(env, peri, linear):
    client, db, _ = env
    peri.catalog = SLUGGED
    linear.existing_links = {"id-ENG-1": [PR]}       # ENG-1's Bug label makes it a code ticket by the rules
    cid = tools.add_candidate(db, None, source="slack", source_id="C1:9", title="Rebin Globex grades",
                              signal="ask", why="Sam asked.", excerpt="can you look", category="review",
                              source_url="https://example.slack.com/archives/C1/p9")["id"]
    db.decide(cid, "approved", "ENG-1", "https://linear.app/x/issue/ENG-1")
    assert [p["label"] for p in client.get("/api/issues/id-ENG-1/periscope").json()["prs"]] == ["acme/api#812"]


def test_an_older_periscope_gets_no_prs_and_no_hint(env, linear):
    client, _, _ = env                                 # CATALOG has no slug: that periscope cannot take a pr
    review_issue(linear, [PR])
    linear.attachment_urls = lambda issue_id: pytest.fail("read the links for a periscope that cannot take a pr")
    o = client.get("/api/issues/id-ENG-3/periscope").json()
    assert o["prs"] == [] and o["pr_hint"] == ""


def test_start_sends_the_issue_and_its_name_and_remembers_the_repo(env, peri, linear):
    client, db, _ = env
    r = client.post("/api/issues/id-ENG-1/periscope", json=START)
    assert r.status_code == 200 and r.json() == {**SPAWNED, "warnings": []}
    assert peri.calls[-1] == ("POST", "/api/linear/start", {
        "repo": "/dev/api", "branch": "me/eng-1", "ticket": "ENG-1", "title": "Rebin Globex grades",
        "prompt": "Read ENG-1.", "name": "eng-1-rebin"})
    assert db.get_meta(REPOS_KEY) == {"client:Globex": "/dev/api"}
    assert db.get_meta(LAST_REPO_KEY) == "/dev/api"
    assert linear.comments == []


def test_a_pr_start_sends_the_pr_and_keeps_the_remembered_repos(env, peri, linear):
    client, db, _ = env
    peri.answer = httpx.Response(200, json={**SPAWNED, "session_id": "3f2a9c1e-5b7d-4e2a-9f10-2c4d6e8a0b1c",
                                            "email": "you@example.com"})
    r = client.post("/api/issues/id-ENG-1/periscope", json={"repo": "/dev/api", "pr": 812, "prompt": "Review it."})
    assert r.status_code == 200
    assert peri.calls[-1] == ("POST", "/api/linear/start", {
        "repo": "/dev/api", "pr": 812, "ticket": "ENG-1", "title": "Rebin Globex grades",
        "prompt": "Review it.", "name": "eng-1-rebin"})
    # The PR chose the repo, not you.
    assert db.get_meta(REPOS_KEY) is None and db.get_meta(LAST_REPO_KEY) is None
    assert len(linear.comments) == 1


def test_a_claude_already_on_the_branch_is_answered_and_the_repo_remembered(env, peri, linear):
    client, db, _ = env
    peri.answer = httpx.Response(200, json={"mode": "existing", "pid": "p1"})
    r = client.post("/api/issues/id-ENG-2/periscope", json=START)
    assert r.json() == {"mode": "existing", "pid": "p1", "warnings": []}
    assert db.get_meta(REPOS_KEY) is None and db.get_meta(LAST_REPO_KEY) == "/dev/api"
    assert linear.comments == []


SID = "3f2a9c1e-5b7d-4e2a-9f10-2c4d6e8a0b1c"
WITH_SESSION = {**SPAWNED, "session_id": SID, "email": "you@example.com"}
STARTED = re.compile(r"- Started: \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}")


def test_a_new_claude_session_goes_into_a_comment(env, peri, linear):
    client, _, _ = env
    peri.answer = httpx.Response(200, json=WITH_SESSION)
    r = client.post("/api/issues/id-ENG-1/periscope", json=START)
    assert r.status_code == 200 and r.json() == {**WITH_SESSION, "warnings": []}
    [(issue_id, body)] = linear.comments
    started, account, session = body.split("\n")
    assert issue_id == "id-ENG-1"
    assert STARTED.fullmatch(started)
    assert account == "- Claude account: you@example.com"
    assert session == f"- Claude session: `{SID}`"


def test_a_session_without_an_email_says_unknown(env, peri, linear):
    client, _, _ = env
    peri.answer = httpx.Response(200, json={**WITH_SESSION, "email": None})
    client.post("/api/issues/id-ENG-1/periscope", json=START)
    assert "- Claude account: unknown" in linear.comments[0][1].split("\n")


def test_a_comment_that_fails_is_a_warning_not_an_error(env, peri, linear):
    # Claude is already running, so the start still succeeds.
    client, db, _ = env
    peri.answer = httpx.Response(200, json=WITH_SESSION)

    def refuse(issue_id, body):
        raise LinearError("Can't reach Linear")

    linear.create_comment = refuse
    r = client.post("/api/issues/id-ENG-1/periscope", json=START)
    assert r.status_code == 200
    assert r.json()["warnings"] == ["The Claude session was not added to ENG-1: Can't reach Linear"]
    assert db.get_meta(LAST_REPO_KEY) == "/dev/api"


def test_periscopes_warning_goes_into_the_warnings(env, peri, linear):
    # Claude starts on a PR worktree that periscope could not bring up to the PR's latest commit.
    client, _, _ = env
    behind = "pr-812 may be behind PR #812: the worktree has local changes"
    peri.answer = httpx.Response(200, json={**WITH_SESSION, "reused": True, "warning": behind})
    r = client.post("/api/issues/id-ENG-1/periscope", json={"repo": "/dev/api", "pr": 812, "prompt": "Review it."})
    assert r.status_code == 200 and r.json() == {**WITH_SESSION, "reused": True, "warnings": [behind]}


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


@pytest.mark.parametrize("target", [{"branch": "me/eng-1", "pr": 812}, {}, {"branch": "   "}])
def test_a_start_needs_a_branch_or_a_pr(env, peri, target):
    client, _, _ = env
    r = client.post("/api/issues/id-ENG-1/periscope", json={"repo": "/dev/api", "prompt": "Read.", **target})
    assert r.status_code == 400 and r.json() == {"error": "Send a branch or a PR."}
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


PULL = "/api/pulls/acme/api/812"
PULL_START = {"repo": "/dev/api", "prompt": "Review it.", "title": "Retry stuck uploads"}


def test_pull_options_with_an_issue(env, peri):
    client, _, _ = env
    peri.catalog = SLUGGED
    r = client.get(f"{PULL}/start?ident=ENG-1")
    assert r.status_code == 200 and r.json() == {
        "issue": {"identifier": "ENG-1", "title": "Rebin Globex grades"},
        "issue_hint": "",
        "prompt": REVIEW_PROMPT.replace("ENG-3", "ENG-1"),
        "targets": {"periscope": {"repos": [{"repo": "/dev/api", "label": "api"}], "branch_worktrees": ["/dev/api"],
                                  "error": ""}},
    }


def test_pull_options_with_no_issue(env, peri):
    client, _, _ = env
    peri.catalog = SLUGGED
    o = client.get("/api/pulls/acme/ios/7/start").json()
    assert o["issue"] is None and o["issue_hint"] == ""
    assert o["prompt"].startswith("Then review https://github.com/acme/ios/pull/7 in this worktree")
    assert o["targets"] == {"periscope": {"repos": [], "branch_worktrees": [], "error": ""}}


def test_pull_options_when_linear_does_not_give_the_issue(env, peri):
    client, _, _ = env
    peri.catalog = SLUGGED
    o = client.get(f"{PULL}/start?ident=ENG-9").json()
    assert o["issue"] is None
    assert o["issue_hint"] == "The prompt leaves ENG-9 out: Issue ENG-9 not found."
    assert o["prompt"].startswith(f"Then review {PR}")


def test_pull_options_with_both_targets_on_and_periscope_not_running(git_repo):
    def refuse(request):
        raise httpx.ConnectError("refused")

    git("remote", "set-url", "origin", "git@github.com:acme/api.git", cwd=git_repo)
    settings = settings_on()
    settings.repos, settings.review_prompt = [str(git_repo)], "My {pr} for {title}. Be kind."
    app = create_app(settings, DB(settings.db_path), linear_factory=FakeLinear,
                     periscope_factory=lambda: Periscope(URL, transport=httpx.MockTransport(refuse)))
    o = TestClient(app).get("/api/pulls/ACME/api/812/start").json()
    assert o["prompt"] == "Be kind."
    assert o["targets"]["periscope"] == {"repos": [], "branch_worktrees": [],
                                         "error": "Periscope is not running at 127.0.0.1:17374."}
    assert [r["repo"] for r in o["targets"]["claude-code"]["repos"]] == [str(git_repo)]


def test_pull_start_sends_the_pr_and_its_ticket(env, peri, linear):
    client, db, _ = env
    peri.answer = httpx.Response(200, json=WITH_SESSION)
    r = client.post(f"{PULL}/periscope", json={**PULL_START, "ticket": "ENG-1", "ticket_title": "Rebin Globex grades"})
    assert r.status_code == 200 and r.json() == {**WITH_SESSION, "warnings": []}
    assert peri.calls == [("POST", "/api/linear/start", {
        "repo": "/dev/api", "pr": 812, "ticket": "ENG-1", "title": "Rebin Globex grades", "prompt": "Review it.",
        "name": "pr-812-rebin"})]
    # The issue can be the PR author's, and the PR chose the repo.
    assert linear.comments == []
    assert db.get_meta(REPOS_KEY) is None and db.get_meta(LAST_REPO_KEY) is None


def test_pull_start_with_no_ticket_sends_none(env, peri):
    client, _, _ = env
    assert client.post(f"{PULL}/periscope", json=PULL_START).status_code == 200
    assert peri.calls == [("POST", "/api/linear/start", {
        "repo": "/dev/api", "pr": 812, "prompt": "Review it.", "name": "pr-812-rebin"})]


def test_pull_start_names_the_claude_for_the_pr(peri):
    settings, named = settings_on(), []
    app = create_app(settings, DB(settings.db_path), linear_factory=FakeLinear,
                     periscope_factory=lambda: Periscope(URL, transport=peri.transport),
                     name_fn=lambda ident, title: named.append((ident, title)) or "pr-812")
    TestClient(app).post(f"{PULL}/periscope", json=PULL_START)
    assert named == [("pr-812", "Retry stuck uploads")]


def test_pull_start_carries_periscopes_warning(env, peri):
    client, _, _ = env
    behind = "pr-812 may be behind PR #812: the worktree has local changes"
    peri.answer = httpx.Response(200, json={**SPAWNED, "warning": behind})
    assert client.post(f"{PULL}/periscope", json=PULL_START).json() == {**SPAWNED, "warnings": [behind]}


def test_pull_start_that_periscope_refuses(env, peri):
    client, _, _ = env
    peri.answer = httpx.Response(409, json={"detail": "start already running"})
    r = client.post(f"{PULL}/periscope", json=PULL_START)
    assert r.status_code == 409 and r.json() == {"error": "Periscope is already starting #812."}


def test_pull_start_is_404_when_periscope_is_off(peri):
    settings = load_settings()
    client = TestClient(create_app(settings, DB(settings.db_path), linear_factory=FakeLinear,
                                   periscope_factory=lambda: Periscope(URL, transport=peri.transport)))
    assert client.post(f"{PULL}/periscope", json=PULL_START).status_code == 404
    assert client.get(f"{PULL}/start").json()["targets"] == {}
    assert peri.calls == []
