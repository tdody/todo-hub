"""Weekly client summary: a plain-text draft you can edit and send yourself.

For one client label it lists what was completed this week (Monday to now, America/New_York),
what's open, and what you're waiting on from them (issues in the waiting status). Linear
identifiers are left out because the reader is the client.
"""

from __future__ import annotations

import re
from datetime import date

WAITING_PREFIX = re.compile(r"^waiting on [^:]+:\s*", re.I)


def _when(d: str | None) -> str:
    return date.fromisoformat(d[:10]).strftime("%b %-d") if d else ""


def client_summary(client: str, week_start: date, open_issues: list[dict], completed: list[dict],
                   waiting_state: str) -> str:
    mine = [i for i in open_issues if i.get("client") == client]
    waiting = [i for i in mine if i["state"]["name"] == waiting_state]
    active = [i for i in mine if i["state"]["name"] != waiting_state and not i.get("parent")]
    done = [i for i in completed if i.get("client") == client]

    active.sort(key=lambda i: (i["priority"] or 9, i["due_date"] or "9999"))
    lines = [f"{client}: update for the week of {week_start.strftime('%b %-d')}", ""]

    lines.append("Done this week")
    lines += [f"- {i['title']}" for i in done] or ["- Nothing closed yet this week"]
    lines.append("")

    lines.append("In progress")
    for i in active:
        due = f" (target {_when(i['due_date'])})" if i.get("due_date") else ""
        lines.append(f"- {i['title']}{due}")
    if not active:
        lines.append("- Nothing open right now")

    if waiting:
        lines += ["", "Waiting on your side"]
        lines += [f"- {WAITING_PREFIX.sub('', i['title'])}" for i in waiting]
    return "\n".join(lines) + "\n"
