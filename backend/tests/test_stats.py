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
