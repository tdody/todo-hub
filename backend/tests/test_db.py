from todohub.db import DB


def test_source_overview_counts_failures_in_a_row(tmp_path):
    db = DB(tmp_path / "t.db")
    def run(when, gmail_ok, trigger="schedule"):
        rid = db.start_run(trigger, when)
        db.report_source_status(rid, "gmail", gmail_ok, None if gmail_ok else "claude.ai Gmail needs sign-in", 0)
        db.report_source_status(rid, "slack", True, None, 3)
        db.finish_run(rid, "ok")
        return rid
    run("2026-11-06T13:00:00+00:00", True)
    first_fail = run("2026-11-06T15:00:00+00:00", False)
    run("2026-11-06T17:00:00+00:00", True, trigger="plan")          # not a sweep: ignored
    run("2026-11-07T13:00:00+00:00", False, trigger="manual")
    over = {o["source"]: o for o in db.source_overview(["gmail", "slack", "grain"])}
    with db.connect() as c:
        started = c.execute("SELECT started_at FROM runs WHERE id = ?", (first_fail,)).fetchone()["started_at"]
    assert over["gmail"]["fail_streak"] == 2 and over["gmail"]["failing_since"] == started
    assert over["gmail"]["detail"] == "claude.ai Gmail needs sign-in"
    assert over["slack"]["fail_streak"] == 0 and over["slack"]["failing_since"] is None
    assert over["grain"]["fail_streak"] == 0 and over["grain"]["ok"] is None
    run("2026-11-07T15:00:00+00:00", True)
    assert db.source_overview(["gmail"])[0]["fail_streak"] == 0


def test_new_client_label_and_setting_the_client(tmp_path):
    db = DB(tmp_path / "t.db")
    _, cid = db.add_candidate(None, source="slack", source_id="C1:1", title="Send Sam the deck", signal="ask",
                              new_client_label="Hooli")
    assert db.get_candidate(cid)["new_client_label"] == "Hooli"
    db.update_candidate(cid, priority=2)                     # another field leaves it
    assert db.get_candidate(cid)["new_client_label"] == "Hooli"
    c = db.update_candidate(cid, client_label="Globex")      # a client, or None, replaces it
    assert c["client_label"] == "Globex" and c["new_client_label"] is None
    db.update_candidate(cid, new_client_label="Pied Piper")  # not an editable field
    assert db.get_candidate(cid)["new_client_label"] is None
