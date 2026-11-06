"""A small Linear GraphQL client: just what TodoHub needs."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

import httpx

from .categories import categorize
from .config import Settings

API_URL = "https://api.linear.app/graphql"

ISSUE_FIELDS = """
    id identifier title url priority dueDate createdAt updatedAt completedAt canceledAt
    state { id name type }
    project { id name }
    parent { id identifier title }
    team { id }
    labels { nodes { id name parent { id name } } }
"""


class LinearError(RuntimeError):
    pass


@dataclass
class TeamMeta:
    team_id: str
    states: list[dict]          # [{id, name, type, position}]
    client_labels: list[dict]   # [{id, name}], children of the client label group
    viewer_id: str
    projects: list[dict] = field(default_factory=list)   # [{id, name}], not completed or canceled


class Linear:
    def __init__(self, api_key: str, transport: httpx.BaseTransport | None = None):
        # Personal API keys go in the Authorization header as-is (no "Bearer").
        self._client = httpx.Client(
            headers={"Authorization": api_key, "Content-Type": "application/json"},
            timeout=30,
            transport=transport,
        )

    def close(self) -> None:
        self._client.close()

    def gql(self, query: str, variables: dict | None = None) -> dict:
        try:
            resp = self._client.post(API_URL, json={"query": query, "variables": variables or {}})
        except httpx.HTTPError as exc:
            raise LinearError(f"Can't reach Linear: {exc}") from exc
        if resp.status_code == 401:
            raise LinearError("Linear rejected the API key (401). Run `todohub set-linear-key` again.")
        if resp.status_code >= 400 and not resp.headers.get("content-type", "").startswith("application/json"):
            raise LinearError(f"Linear returned HTTP {resp.status_code}.")
        body = resp.json()
        if body.get("errors"):
            raise LinearError("; ".join(e.get("message", str(e)) for e in body["errors"]))
        if not body.get("data"):
            raise LinearError(f"Unexpected response from Linear (HTTP {resp.status_code}).")
        return body["data"]

    def _paginate(self, query: str, path: list[str], variables: dict | None = None) -> list[dict]:
        nodes: list[dict] = []
        after = None
        while True:
            data = self.gql(query, {**(variables or {}), "after": after})
            conn: Any = data
            for key in path:
                conn = conn[key]
            nodes.extend(conn["nodes"])
            if not conn["pageInfo"]["hasNextPage"]:
                return nodes
            after = conn["pageInfo"]["endCursor"]

    # ---- reads ------------------------------------------------------------------------
    def team_meta(self, team_key: str, client_group: str) -> TeamMeta:
        data = self.gql(
            """
            query($key: String!) {
              viewer { id }
              teams(filter: { key: { eq: $key } }) {
                nodes { id states { nodes { id name type position } } }
              }
            }
            """,
            {"key": team_key},
        )
        teams = data["teams"]["nodes"]
        if not teams:
            raise LinearError(f"No Linear team with key {team_key!r}. Is the API key from the right workspace?")
        team = teams[0]
        labels = self._paginate(
            """
            query($group: String!, $after: String) {
              issueLabels(first: 250, after: $after, filter: { parent: { name: { eq: $group } } }) {
                nodes { id name }
                pageInfo { hasNextPage endCursor }
              }
            }
            """,
            ["issueLabels"],
            {"group": client_group},
        )
        states = sorted(team["states"]["nodes"], key=lambda s: s["position"])
        projects = self.team_projects(team["id"])
        return TeamMeta(
            team_id=team["id"],
            states=states,
            client_labels=sorted(labels, key=lambda l: l["name"].lower()),
            viewer_id=data["viewer"]["id"],
            projects=sorted(projects, key=lambda p: p["name"].lower()),
        )

    def team_projects(self, team_id: str) -> list[dict]:
        """Active projects (not completed or canceled). Tries the current and the older Linear
        field for project status, and returns [] rather than failing if neither works."""
        for status_field, read in (
            ("status { type }", lambda p: (p.get("status") or {}).get("type")),
            ("state", lambda p: p.get("state")),
        ):
            try:
                data = self.gql(
                    f"query($id: String!) {{ team(id: $id) {{ projects(first: 250) {{ nodes {{ id name {status_field} }} }} }} }}",
                    {"id": team_id},
                )
            except LinearError:
                continue
            return [
                {"id": p["id"], "name": p["name"]}
                for p in data["team"]["projects"]["nodes"]
                if (read(p) or "") not in ("completed", "canceled")
            ]
        return []

    def my_open_issues(self) -> list[dict]:
        return self._paginate(
            f"""
            query($after: String) {{
              viewer {{
                assignedIssues(
                  first: 100, after: $after,
                  filter: {{ state: {{ type: {{ nin: ["completed", "canceled", "duplicate"] }} }} }}
                ) {{
                  nodes {{ {ISSUE_FIELDS} }}
                  pageInfo {{ hasNextPage endCursor }}
                }}
              }}
            }}
            """,
            ["viewer", "assignedIssues"],
        )

    def due_date_history(self) -> list[dict]:
        """My open issues that have a due date, with their history (for due-date slips)."""
        return self._paginate(
            """
            query($after: String) {
              viewer {
                assignedIssues(
                  first: 25, after: $after,
                  filter: { state: { type: { nin: ["completed", "canceled", "duplicate"] } }, dueDate: { null: false } }
                ) {
                  nodes {
                    id identifier title url dueDate
                    labels { nodes { name parent { name } } }
                    history(first: 50) { nodes { createdAt fromDueDate toDueDate actor { name } } }
                  }
                  pageInfo { hasNextPage endCursor }
                }
              }
            }
            """,
            ["viewer", "assignedIssues"],
        )

    def my_completed_issues(self, since_iso: str) -> list[dict]:
        """Issues assigned to me that were completed (not canceled) since ``since_iso``."""
        return self._paginate(
            f"""
            query($after: String, $since: DateTimeOrDuration!) {{
              viewer {{
                assignedIssues(
                  first: 100, after: $after,
                  filter: {{ completedAt: {{ gte: $since }}, state: {{ type: {{ eq: "completed" }} }} }}
                ) {{
                  nodes {{ {ISSUE_FIELDS} }}
                  pageInfo {{ hasNextPage endCursor }}
                }}
              }}
            }}
            """,
            ["viewer", "assignedIssues"],
            {"since": since_iso},
        )

    def my_closed_issues(self, since_iso: str) -> list[dict]:
        """Issues assigned to me that were completed or canceled (including duplicates merged
        away) and touched since ``since_iso``."""
        return self._paginate(
            f"""
            query($after: String, $since: DateTimeOrDuration!) {{
              viewer {{
                assignedIssues(
                  first: 100, after: $after,
                  filter: {{ updatedAt: {{ gte: $since }}, state: {{ type: {{ in: ["completed", "canceled"] }} }} }}
                ) {{
                  nodes {{ {ISSUE_FIELDS} }}
                  pageInfo {{ hasNextPage endCursor }}
                }}
              }}
            }}
            """,
            ["viewer", "assignedIssues"],
            {"since": since_iso},
        )

    # ---- writes -----------------------------------------------------------------------
    def create_issue(self, *, team_id: str, title: str, description: str, assignee_id: str,
                     state_id: str, priority: int, due_date: str | None,
                     label_ids: list[str], parent_id: str | None = None,
                     project_id: str | None = None) -> dict:
        fields = {
            "teamId": team_id,
            "title": title,
            "description": description,
            "assigneeId": assignee_id,
            "stateId": state_id,
            "priority": priority,
            "dueDate": due_date,
            "labelIds": label_ids,
        }
        if parent_id:
            fields["parentId"] = parent_id
        if project_id:
            fields["projectId"] = project_id
        data = self.gql(
            f"""
            mutation($input: IssueCreateInput!) {{
              issueCreate(input: $input) {{ success issue {{ {ISSUE_FIELDS} }} }}
            }}
            """,
            {"input": fields},
        )
        result = data["issueCreate"]
        if not result["success"]:
            raise LinearError("Linear did not create the issue.")
        return result["issue"]

    def get_issue(self, id_or_identifier: str) -> dict:
        """Look an issue up by UUID or by identifier such as ENG-123."""
        data = self.gql(f"query($id: String!) {{ issue(id: $id) {{ {ISSUE_FIELDS} }} }}", {"id": id_or_identifier})
        if not data.get("issue"):
            raise LinearError(f"Issue {id_or_identifier} not found.")
        return data["issue"]

    def team_states(self, team_id: str) -> list[dict]:
        data = self.gql("query($id: String!) { team(id: $id) { states { nodes { id name type position } } } }",
                        {"id": team_id})
        return data["team"]["states"]["nodes"]

    def create_comment(self, issue_id: str, body: str) -> str:
        """Add a comment; returns its id."""
        data = self.gql(
            "mutation($input: CommentCreateInput!) { commentCreate(input: $input) { success comment { id } } }",
            {"input": {"issueId": issue_id, "body": body}},
        )
        if not data["commentCreate"]["success"]:
            raise LinearError("Linear did not add the comment.")
        return (data["commentCreate"].get("comment") or {}).get("id") or ""

    def delete_comment(self, comment_id: str) -> None:
        data = self.gql("mutation($id: String!) { commentDelete(id: $id) { success } }", {"id": comment_id})
        if not data["commentDelete"]["success"]:
            raise LinearError("Linear did not delete the comment.")

    def delete_issue(self, issue_id: str) -> None:
        """Move an issue to Linear's trash (it can be restored from there for 30 days)."""
        data = self.gql("mutation($id: String!) { issueDelete(id: $id) { success } }", {"id": issue_id})
        if not data["issueDelete"]["success"]:
            raise LinearError("Linear did not delete the issue.")

    def add_link(self, issue_id: str, url: str, title: str) -> str:
        """Attach a link to an issue; it shows in the issue's Links section. Returns its id."""
        data = self.gql(
            """
            mutation($input: AttachmentCreateInput!) {
              attachmentCreate(input: $input) { success attachment { id } }
            }
            """,
            {"input": {"issueId": issue_id, "url": url, "title": title}},
        )
        if not data["attachmentCreate"]["success"]:
            raise LinearError(f"Linear did not attach {url}.")
        return (data["attachmentCreate"].get("attachment") or {}).get("id") or ""

    def attachment_urls(self, issue_id: str) -> set[str]:
        data = self.gql("query($id: String!) { issue(id: $id) { attachments(first: 100) { nodes { url } } } }",
                        {"id": issue_id})
        return {a["url"] for a in ((data.get("issue") or {}).get("attachments") or {}).get("nodes", [])}

    def delete_attachment(self, attachment_id: str) -> None:
        data = self.gql("mutation($id: String!) { attachmentDelete(id: $id) { success } }", {"id": attachment_id})
        if not data["attachmentDelete"]["success"]:
            raise LinearError("Linear did not remove the link.")

    def issue_preview(self, id_or_identifier: str) -> dict:
        """An issue with its description, assignee and recent comments, for a quick look."""
        data = self.gql(
            f"""
            query($id: String!) {{
              issue(id: $id) {{
                {ISSUE_FIELDS}
                description createdAt
                assignee {{ name }}
                comments(first: 50) {{ nodes {{ body createdAt user {{ name }} }} }}
              }}
            }}
            """,
            {"id": id_or_identifier},
        )
        if not data.get("issue"):
            raise LinearError(f"Issue {id_or_identifier} not found.")
        return data["issue"]

    def update_issue(self, issue_id: str, changes: dict) -> dict:
        """``changes`` uses Linear's field names: stateId, priority, dueDate (None clears it)."""
        data = self.gql(
            f"""
            mutation($id: String!, $input: IssueUpdateInput!) {{
              issueUpdate(id: $id, input: $input) {{ success issue {{ {ISSUE_FIELDS} }} }}
            }}
            """,
            {"id": issue_id, "input": changes},
        )
        result = data["issueUpdate"]
        if not result["success"]:
            raise LinearError("Linear did not update the issue.")
        return result["issue"]


def client_label_of(issue: dict, client_group: str) -> str | None:
    for label in issue["labels"]["nodes"]:
        parent = label.get("parent")
        if parent and parent["name"] == client_group:
            return label["name"]
    return None


def shape_issue(issue: dict, settings: Settings) -> dict:
    """Flatten a Linear issue for the app, and say which list it belongs to."""
    client = client_label_of(issue, settings.client_label_group)
    return {
        "id": issue["id"],
        "identifier": issue["identifier"],
        "title": issue["title"],
        "url": issue["url"],
        "priority": issue["priority"],
        "due_date": issue["dueDate"],
        "updated_at": issue["updatedAt"],
        "completed_at": issue.get("completedAt"),
        "state": issue["state"],
        "project": issue["project"]["name"] if issue.get("project") else None,
        "parent": issue.get("parent"),
        "client": client,
        "list": "client" if client else "dev",
        "category": categorize(issue["title"], [l["name"] for l in issue["labels"]["nodes"]],
                               label_types=settings.label_types),
    }
