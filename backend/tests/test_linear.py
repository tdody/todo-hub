import json

import httpx
import pytest

from todohub.config import Settings
from todohub.linear import Linear, LinearError, shape_issue
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
