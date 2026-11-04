import pytest

from todohub.linear import TeamMeta


@pytest.fixture(autouse=True)
def tmp_home(tmp_path, monkeypatch):
    monkeypatch.setenv("TODOHUB_HOME", str(tmp_path / "home"))
    monkeypatch.delenv("TODOHUB_TOKEN", raising=False)
    monkeypatch.setenv("LINEAR_API_KEY", "lin_test")
    return tmp_path / "home"


def make_issue(identifier, title, client=None, state="Todo", due=None, priority=0, completed=None):
    labels = [{"id": "l-bug", "name": "Bug", "parent": None}]
    if client:
        labels.append({"id": f"l-{client}", "name": client, "parent": {"id": "g-client", "name": "client"}})
    return {
        "id": f"id-{identifier}", "identifier": identifier, "title": title,
        "url": f"https://linear.app/x/issue/{identifier}", "priority": priority, "dueDate": due,
        "updatedAt": "2026-11-03T12:00:00Z", "completedAt": completed,
        "state": {"id": f"s-{state}", "name": state, "type": "unstarted"},
        "project": None, "parent": None, "labels": {"nodes": labels},
    }


class FakeLinear:
    """Stands in for todohub.linear.Linear in tests."""

    def __init__(self):
        self.created = []
        self.updated = []
        self.links = []
        self.comments = []
        self.deleted_issues = []
        self.deleted_comments = []
        self.fail_delete = set()   # delete_issue raises for these ids
        self.fail_titles = set()   # create_issue raises for these titles
        self.issues = [
            make_issue("ENG-1", "Rebin Globex grades", client="Globex"),
            make_issue("ENG-2", "Fix outcome report copy"),
        ]

    def team_meta(self, team_key, client_group):
        return TeamMeta(
            team_id="team-eng",
            states=[
                {"id": "s-Backlog", "name": "Backlog", "type": "backlog", "position": 0},
                {"id": "s-Todo", "name": "Todo", "type": "unstarted", "position": 1},
                {"id": "s-Pending", "name": "Pending", "type": "unstarted", "position": 2},
                {"id": "s-Done", "name": "Done", "type": "completed", "position": 3},
            ],
            client_labels=[{"id": "l-Initech & Co", "name": "Initech & Co"},
                           {"id": "l-Globex", "name": "Globex"}],
            viewer_id="me",
            projects=[{"id": "p-globex", "name": "Globex"}, {"id": "p-out", "name": "Improve our \"Forecast\" models"}],
        )

    def my_open_issues(self):
        return self.issues

    def my_completed_issues(self, since_iso):
        self.completed_since = since_iso
        return getattr(self, "completed", [])

    def create_issue(self, **kw):
        from todohub.linear import LinearError
        if kw["title"] in self.fail_titles:
            raise LinearError("boom")
        self.created.append(kw)
        issue = make_issue(f"ENG-{99 + len(self.created) - 1}", kw["title"], client=None)
        if kw.get("parent_id"):
            issue["parent"] = {"id": kw["parent_id"], "identifier": "ENG-99", "title": "parent"}
        return issue

    def get_issue(self, ident):
        from todohub.linear import LinearError
        found = next((i for i in self.issues if ident in (i["identifier"], i["id"])), None)
        if not found:
            raise LinearError(f"Issue {ident} not found.")
        return found

    def create_comment(self, issue_id, body):
        self.comments.append((issue_id, body))
        return f"comment-{len(self.comments)}"

    def delete_comment(self, comment_id):
        self.deleted_comments.append(comment_id)

    def delete_issue(self, issue_id):
        from todohub.linear import LinearError
        if issue_id in self.fail_delete:
            raise LinearError("nope")
        self.deleted_issues.append(issue_id)

    def add_link(self, issue_id, url, title):
        self.links.append((issue_id, url, title))

    def update_issue(self, issue_id, changes):
        self.updated.append((issue_id, changes))
        found = next((i for i in self.issues if i["id"] == issue_id), None)
        if found and "stateId" in changes:
            name = changes["stateId"].removeprefix("s-")
            return {**found, "state": {"id": changes["stateId"], "name": name, "type": "completed" if name == "Done" else "unstarted"}}
        return make_issue("ENG-2", "Fix outcome report copy", due=changes.get("dueDate"))

    notifications = []

    def gql(self, query, variables=None):
        if "notifications" in query:
            return {"notifications": {"nodes": self.notifications}}
        raise AssertionError("unexpected query")

    def close(self):
        pass
