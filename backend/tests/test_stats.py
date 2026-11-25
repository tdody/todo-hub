from datetime import date

from todohub import stats, tools
from todohub.config import load_settings
from todohub.db import DB
from todohub.sweep import feedback_section


def test_approval_rate_by_week_and_source():
    today = date(2026, 11, 4)          # a Wednesday
    decisions = [
        {"source": "slack", "status": "approved", "drop_reason": None, "decided_at": "2026-11-03T15:00:00+00:00"},
        {"source": "slack", "status": "dropped", "drop_reason": "noise", "decided_at": "2026-11-02T15:00:00+00:00"},
        {"source": "grain", "status": "approved", "drop_reason": None, "decided_at": "2026-11-02T15:00:00+00:00"},
        # Sunday 11pm in New York is still last week, though it's Monday in UTC
        {"source": "slack", "status": "dropped", "drop_reason": "not_mine", "decided_at": "2026-11-02T04:00:00+00:00"},
    ]
    out = stats.approval_rate(decisions, weeks=2, today=today)
    this, last = out["weeks"][1], out["weeks"][0]
    assert this["week"] == "2026-11-02" and last["week"] == "2026-10-26"
    assert this["sources"]["slack"] == {"approved": 1, "dropped": 1, "rate": 0.5}
    assert this["sources"]["all"]["rate"] == round(2 / 3, 3)
    assert last["sources"]["slack"]["rate"] == 0.0
    assert last["sources"]["grain"]["rate"] is None          # no decisions: no rate
    assert out["drop_reasons"] == {"noise": 1, "not_mine": 1}


def test_balance_client_share():
    today = date(2026, 11, 4)
    done = [
        {"list": "client", "completed_at": "2026-11-03T12:00:00Z"},
        {"list": "dev", "completed_at": "2026-11-02T12:00:00Z"},
        {"list": "dev", "completed_at": "2026-11-03T12:00:00Z"},
        {"list": "client", "completed_at": "2026-10-01T12:00:00Z"},   # too old
    ]
    out = stats.balance(done, weeks=2, today=today)
    assert out["weeks"][1] == {"week": "2026-11-02", "client": 1, "dev": 2, "client_share": 0.333}
    assert out["weeks"][0]["client_share"] is None and out["target"] == 0.5


def test_issue_counts():
    def issue(created, state="unstarted", completed=None, canceled=None):
        return {"createdAt": created, "completedAt": completed, "canceledAt": canceled, "state": {"type": state}}
    issues = [
        issue("2026-09-01T12:00:00Z"),                                                       # opened before, still open
        issue("2026-10-27T12:00:00Z", "completed", completed="2026-11-02T03:30:00Z"),        # Sunday night in New York
        issue("2026-10-28T12:00:00Z", "completed", completed="2026-11-02T05:30:00Z"),        # Monday, half past midnight
        issue("2026-10-29T12:00:00Z", "canceled", canceled="2026-11-03T12:00:00Z"),          # not opened, open until canceled
        issue("2026-11-02T04:30:00Z", "duplicate", canceled="2026-11-03T12:00:00Z"),         # created on Sunday night
        issue("2026-11-02T05:30:00Z", "backlog"),                                            # created on Monday
    ]
    assert stats.issue_counts(issues, weeks=3, today=date(2026, 11, 4)) == {"weeks": [
        {"week": "2026-10-19", "opened": 0, "still_open": 1},
        {"week": "2026-10-26", "opened": 2, "still_open": 4},
        {"week": "2026-11-02", "opened": 1, "still_open": 2},
    ]}


def test_drop_reasons_feed_the_prompt():
    db = DB(load_settings().db_path)
    for i, (status, reason) in enumerate([("approved", None), ("dropped", "already_done"), ("pending", None)]):
        r = tools.add_candidate(db, None, source="slack", source_id=f"C:{i}", title=f"Task {i}", signal="ask",
                                why="w", excerpt="e", source_url=f"https://x.slack.com/archives/C/p{i}")
        if status != "pending":
            db.decide(r["id"], status, drop_reason=reason)
    text = feedback_section(db.recent_decisions())
    assert "Kept:\n  - [slack, ask] Task 0" in text
    assert "Task 1 (dropped: already done)" in text and "Task 2" not in text
    assert feedback_section({"approved": [], "dropped": []}) == "(no decisions yet)"


def test_weekly_digest():
    from datetime import date
    from todohub import digest
    today = date(2026, 11, 5)          # a Thursday; the week starts Mon Nov 2
    def issue(ident, lst, completed=None, due=None, client=None):
        return {"identifier": ident, "title": f"T {ident}", "client": client, "url": f"u/{ident}", "list": lst,
                "due_date": due, "completed_at": completed}
    completed = [issue("A-1", "client", "2026-11-03T15:00:00Z", client="Globex"),
                 issue("A-2", "dev", "2026-11-04T15:00:00Z"), issue("A-3", "dev", "2026-11-05T15:00:00Z"),
                 issue("A-4", "dev", "2026-11-05T16:00:00Z"),
                 issue("A-5", "dev", "2026-10-28T15:00:00Z")]           # last week
    open_issues = [issue("B-1", "client", due="2026-11-01", client="Globex"), issue("B-2", "dev", due="2026-11-09")]
    slips = {"slips": {"x": {"identifier": "B-1", "title": "T", "client": "Globex", "url": "u/B-1", "count": 3, "days": 9,
                             "due_date": "2026-11-01"},
                       "y": {"identifier": "B-2", "title": "T", "client": None, "url": "u/B-2", "count": 1, "days": 2,
                             "due_date": "2026-11-09"}}, "checked": 2, "error": None}
    decisions = ([{"source": "gmail", "status": "dropped", "decided_at": "2026-11-03T15:00:00Z"}] * 5
                 + [{"source": "gmail", "status": "approved", "decided_at": "2026-11-03T15:00:00Z"}]
                 + [{"source": "slack", "status": "approved", "decided_at": "2026-11-04T15:00:00Z"}]
                 + [{"source": "slack", "status": "dropped", "decided_at": "2026-10-29T15:00:00Z"}])  # last week
    runs = [{"trigger": "schedule", "started_at": "2026-11-03T13:00:00Z", "cost_usd": 0.4},
            {"trigger": "capture", "started_at": "2026-11-03T14:00:00Z", "cost_usd": 0.1},
            {"trigger": "schedule", "started_at": "2026-10-30T13:00:00Z", "cost_usd": 0.5}]
    d = digest.build(week_offset=0, completed=completed, open_issues=open_issues, slips=slips,
                     decisions=decisions, runs=runs, today=today)
    assert d["week"] == "2026-11-02" and d["week_end"] == "2026-11-08" and d["current"]
    assert d["closed"] == {"total": 4, "client": 1, "dev": 3, "client_share": 0.25, "prev_total": 1, "target": 0.5}
    assert d["headline"] == "4 issues closed. Client work fell behind."
    assert [w["identifier"] for w in d["wins"]] == ["A-4", "A-3", "A-2", "A-1"]
    assert [s["identifier"] for s in d["slipping"]] == ["B-1"]
    assert [o["identifier"] for o in d["overdue"]] == ["B-1"]
    assert d["inbox"] == {"approved": 2, "dropped": 5, "noisy": "Gmail",
                          "by_source": {"Gmail": {"approved": 1, "dropped": 5}, "Slack": {"approved": 1, "dropped": 0}}}
    assert d["sweeps"] == {"runs": 1, "cost_usd": 0.4}
    recs = d["recommendations"]
    assert len(recs) == 3 and recs[0]["url"] == "u/B-1" and "pushed 3 times (9 days)" in recs[0]["text"]
    assert recs[1]["tab"] == "client" and "25%" in recs[1]["text"]
    assert recs[2]["tab"] == "client" and "1 open issue is overdue. Re-date or close it." in recs[2]["text"]
    assert recs[2]["issues"] == ["B-1"] and recs[2]["label"] == "Show B-1"

    last = digest.build(week_offset=1, completed=completed, open_issues=open_issues, slips=slips,
                        decisions=decisions, runs=runs, today=today)
    assert last["week"] == "2026-10-26" and not last["current"]
    assert last["closed"]["total"] == 1 and last["headline"] == "1 issue closed."
    assert last["inbox"]["dropped"] == 1 and last["sweeps"]["runs"] == 1


def test_digest_names_hubspot():
    from todohub import digest
    decisions = [{"source": "hubspot", "status": "dropped", "decided_at": "2026-11-03T15:00:00Z"}] * 5
    d = digest.build(week_offset=0, completed=[], open_issues=[], slips={"slips": {}, "checked": 0, "error": None},
                     decisions=decisions, runs=[], today=date(2026, 11, 5))
    assert d["inbox"]["by_source"] == {"HubSpot": {"approved": 0, "dropped": 5}}
