import json

import httpx
import pytest

from todohub.config import Settings
from todohub.linear import Linear, LinearError, client_labels, shape_issue
from conftest import make_issue


def transport(handler):
    return httpx.MockTransport(handler)


def test_team_meta_paginates_labels_and_sends_raw_key():
    calls = []

    def handler(request: httpx.Request):
        body = json.loads(request.content)
        calls.append(body)
        assert request.headers["authorization"] == "lin_key"
        if "teams" in body["query"]:
            return httpx.Response(200, json={"data": {
                "viewer": {"id": "me"},
                "teams": {"nodes": [{"id": "t1", "states": {"nodes": [
                    {"id": "b", "name": "Todo", "type": "unstarted", "position": 2},
                    {"id": "a", "name": "Backlog", "type": "backlog", "position": 1}]}}]}}})
        if "projects" in body["query"]:
            if "status" in body["query"]:      # pretend this workspace only has the older field
                return httpx.Response(200, json={"errors": [{"message": "Cannot query field 'status'"}]})
            return httpx.Response(200, json={"data": {"team": {"projects": {"nodes": [
                {"id": "p1", "name": "Globex", "state": "started"},
                {"id": "p2", "name": "Old thing", "state": "completed"}]}}}})
        after = body["variables"]["after"]
        page = {"nodes": [{"id": "x", "name": "Vandelay"}], "pageInfo": {"hasNextPage": True, "endCursor": "c1"}} \
            if after is None else {"nodes": [{"id": "y", "name": "acme"}], "pageInfo": {"hasNextPage": False, "endCursor": None}}
        return httpx.Response(200, json={"data": {"issueLabels": page}})

    meta = Linear("lin_key", transport=transport(handler)).team_meta("ENG", "client")
    assert [s["name"] for s in meta.states] == ["Backlog", "Todo"]
    assert [l["name"] for l in meta.client_labels] == ["acme", "Vandelay"]
    assert meta.viewer_id == "me" and len(calls) == 5
    assert meta.projects == [{"id": "p1", "name": "Globex"}]


def test_errors():
    def handler(request):
        return httpx.Response(200, json={"errors": [{"message": "Entity not found"}]})

    with pytest.raises(LinearError, match="Entity not found"):
        Linear("k", transport=transport(handler)).update_issue("x", {"priority": 1})

    with pytest.raises(LinearError, match="401"):
        Linear("k", transport=transport(lambda r: httpx.Response(401))).my_open_issues()


def test_network_and_http_errors_become_linear_errors():
    def boom(request):
        raise httpx.ConnectError("offline")

    with pytest.raises(LinearError, match="Can't reach Linear"):
        Linear("k", transport=transport(boom)).my_open_issues()
    with pytest.raises(LinearError, match="HTTP 503"):
        Linear("k", transport=transport(lambda r: httpx.Response(503, text="down"))).my_open_issues()


def test_missing_team():
    def handler(request):
        return httpx.Response(200, json={"data": {"viewer": {"id": "me"}, "teams": {"nodes": []}}})

    with pytest.raises(LinearError, match="No Linear team"):
        Linear("k", transport=transport(handler)).team_meta("ENG", "client")


def test_shape_issue_buckets():
    settings = Settings()
    assert shape_issue(make_issue("ENG-1", "a", client="Globex"), settings)["list"] == "client"
    shaped = shape_issue(make_issue("ENG-2", "b"), settings)
    assert shaped["list"] == "dev" and shaped["client"] is None


def test_team_meta_orders_states_like_linear():
    def handler(request: httpx.Request):
        body = json.loads(request.content)
        if "teams" in body["query"]:
            return httpx.Response(200, json={"data": {"viewer": {"id": "me"}, "teams": {"nodes": [{"id": "t1", "states": {"nodes": [
                {"id": "c", "name": "Canceled", "type": "canceled", "position": 0},
                {"id": "d", "name": "Duplicate", "type": "duplicate", "position": 1},
                {"id": "p", "name": "In Progress", "type": "started", "position": 2},
                {"id": "t", "name": "Todo", "type": "unstarted", "position": 3},
                {"id": "w", "name": "Pending", "type": "unstarted", "position": 1.5},
                {"id": "x", "name": "Done", "type": "completed", "position": -1},
                {"id": "b", "name": "Backlog", "type": "backlog", "position": 9}]}}]}}})
        if "projects" in body["query"]:
            return httpx.Response(200, json={"data": {"team": {"projects": {"nodes": []}}}})
        return httpx.Response(200, json={"data": {"issueLabels": {"nodes": [], "pageInfo": {"hasNextPage": False, "endCursor": None}}}})

    meta = Linear("k", transport=transport(handler)).team_meta("ENG", "client")
    assert [s["name"] for s in meta.states] == ["Backlog", "Pending", "Todo", "In Progress", "Done", "Canceled", "Duplicate"]


def test_fetch_upload_only_linear_images_and_key_stays_with_linear():
    seen = []

    def handler(request: httpx.Request):
        seen.append((request.url.host, request.headers.get("authorization"), request.headers.get("content-type")))
        if request.url.host == "uploads.linear.app":
            if request.url.path.endswith("/moved"):
                return httpx.Response(302, headers={"location": "https://storage.example.com/signed/abc"})
            if request.url.path.endswith("/page"):
                return httpx.Response(200, headers={"content-type": "text/html"}, content=b"<html>")
            if request.url.path.endswith("/huge"):
                return httpx.Response(200, headers={"content-type": "image/png"}, content=b"x" * (16 * 1024 * 1024))
            if request.url.path.endswith("/gone"):
                return httpx.Response(403)
            return httpx.Response(200, headers={"content-type": "image/png; charset=binary"}, content=b"\x89PNG")
        return httpx.Response(200, headers={"content-type": "image/jpeg"}, content=b"jpeg")

    lin = Linear("lin_key", transport=transport(handler))
    assert lin.fetch_upload("https://uploads.linear.app/org/a/b") == (b"\x89PNG", "image/png")
    assert seen[-1] == ("uploads.linear.app", "lin_key", None)            # the key, and no JSON content type
    assert lin.fetch_upload("https://uploads.linear.app/org/moved") == (b"jpeg", "image/jpeg")
    assert seen[-1][0] == "storage.example.com" and seen[-1][1] is None    # never sent to another host
    for bad in ("https://evil.example.com/x.png", "http://uploads.linear.app/a", "javascript:alert(1)",
                "https://uploads.linear.app.evil.com/a"):
        with pytest.raises(LinearError, match="Only images stored on Linear"):
            lin.fetch_upload(bad)
    with pytest.raises(LinearError, match="isn't an image"):
        lin.fetch_upload("https://uploads.linear.app/org/page")
    with pytest.raises(LinearError, match="too large"):
        lin.fetch_upload("https://uploads.linear.app/org/huge")
    with pytest.raises(LinearError, match="refused"):
        lin.fetch_upload("https://uploads.linear.app/org/gone")


def test_delete_and_restore_issue():
    sent = []

    def handler(request: httpx.Request):
        body = json.loads(request.content)
        sent.append(body)
        key = "issueDelete" if "issueDelete" in body["query"] else "issueUnarchive"
        return httpx.Response(200, json={"data": {key: {"success": body["variables"]["id"] != "bad"}}})

    linear = Linear("lin_key", transport=transport(handler))
    linear.delete_issue("i1")
    linear.restore_issue("i1")
    assert "issueDelete" in sent[0]["query"] and "issueUnarchive" in sent[1]["query"]
    assert sent[1]["variables"] == {"id": "i1"}
    with pytest.raises(LinearError):
        linear.restore_issue("bad")


def test_client_labels_are_the_ones_in_the_client_group():
    issue = make_issue("ENG-1", "Rebin Globex grades", client="Globex")
    assert [l["id"] for l in client_labels(issue, "client")] == ["l-Globex"]
    assert client_labels(make_issue("ENG-2", "Fix the copy"), "client") == []
