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
        "url": f"https://linear.app/x/issue/{identifier}", "branchName": f"me/{identifier.lower()}",
        "priority": priority, "dueDate": due,
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
        self.client_labels = [{"id": "l-Initech & Co", "name": "Initech & Co"}, {"id": "l-Globex", "name": "Globex"}]
        self.created_labels = []   # (name, group id)
        self.client_group = {"id": "g-client", "color": "#f7c8c1", "team_id": None}
        self.fail_label = False    # create_client_label raises
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
            client_labels=list(self.client_labels),
            client_group=self.client_group,
            viewer_id="me",
            projects=[{"id": "p-globex", "name": "Globex"}, {"id": "p-out", "name": "Improve our \"Forecast\" models"}],
        )

    def my_open_issues(self):
        return self.issues

    def my_completed_issues(self, since_iso):
        self.completed_since = since_iso
        return getattr(self, "completed", [])

    def my_closed_issues(self, since_iso):
        return getattr(self, "closed", [])

    def create_client_label(self, name, group):
        from todohub.linear import LinearError
        if self.fail_label:
            raise LinearError("Only admins can create labels.")
        label = {"id": f"l-{name}", "name": name}
        self.created_labels.append((name, group["id"]))
        self.client_labels.append(label)
        return label

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

    def restore_issue(self, issue_id):
        self.restored_issues = getattr(self, "restored_issues", []) + [issue_id]

    def add_link(self, issue_id, url, title):
        self.links.append((issue_id, url, title))
        return f"att-{len(self.links)}"

    existing_links: dict = {}
    due_history: list = []
    due_history_calls = 0

    def fetch_upload(self, url):
        self.fetched = getattr(self, "fetched", 0) + 1
        return b"\x89PNG", "image/png"

    def initiative_projects(self, ref):
        return getattr(self, "missions", [])

    def due_date_history(self):
        self.due_history_calls += 1
        return self.due_history

    def attachment_urls(self, issue_id):
        return list(self.existing_links.get(issue_id, []))

    def delete_attachment(self, attachment_id):
        self.deleted_attachments = getattr(self, "deleted_attachments", []) + [attachment_id]

    def issue_preview(self, ident):
        issue = dict(self.get_issue(ident))
        issue.update(description="Rebin the grades per channel.\n\n- use deciles", createdAt="2026-11-01T10:00:00Z",
                     assignee={"name": "Thibault"},
                     comments={"nodes": [{"body": f"note {n}", "createdAt": f"2026-11-0{n}T09:00:00Z",
                                          "user": {"name": "Jordan"}} for n in (4, 2, 3, 1)]},
                     children={"nodes": [i for i in self.issues if (i.get("parent") or {}).get("id") == issue["id"]]})
        return issue

    def update_issue(self, issue_id, changes):
        """Records the change and returns the issue as Linear would after it; ``self.issues`` stays as it was."""
        self.updated.append((issue_id, changes))
        issue = dict(self.get_issue(issue_id))
        if "stateId" in changes:
            name = changes["stateId"].removeprefix("s-")
            issue["state"] = {"id": changes["stateId"], "name": name, "type": "completed" if name == "Done" else "unstarted"}
        for field in ("title", "description", "dueDate", "priority"):
            if field in changes:
                issue[field] = changes[field]
        if "projectId" in changes:
            projects = self.team_meta(None, None).projects
            issue["project"] = next((p for p in projects if p["id"] == changes["projectId"]), None)
        labels = [l for l in issue["labels"]["nodes"] if l["id"] not in changes.get("removedLabelIds", [])]
        labels += [{"id": i, "name": i.removeprefix("l-"), "parent": {"id": "g-client", "name": "client"}}
                   for i in changes.get("addedLabelIds", [])]
        issue["labels"] = {"nodes": labels}
        return issue

    notifications = []

    def gql(self, query, variables=None):
        if "notifications" in query:
            return {"notifications": {"nodes": self.notifications}}
        raise AssertionError("unexpected query")

    def close(self):
        pass
