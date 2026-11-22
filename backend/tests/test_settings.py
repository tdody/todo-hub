from types import SimpleNamespace

from fastapi.testclient import TestClient

from todohub import config, schedule
from todohub.api import create_app
from todohub.config import load_settings
from todohub.db import DB
from conftest import FakeLinear


class FakeScheduler:
    ScheduleError = schedule.ScheduleError

    def __init__(self, installed=True, fail=False):
        self.is_installed, self.fail, self.installs = installed, fail, []

    def installed(self):
        return self.is_installed

    def supported(self):
        return True

    def install(self, settings):
        if self.fail:
            raise schedule.ScheduleError("launchctl said no")
        self.installs.append(settings.schedule_hours())
        self.is_installed = True


def client_for(scheduler=None):
    settings = load_settings()
    db = DB(settings.db_path)
    sched = scheduler or FakeScheduler()
    app = create_app(settings, db, linear_factory=lambda: FakeLinear(), scheduler=sched)
    return TestClient(app), settings, sched


def test_overrides_turn_sources_off_and_back_on(tmp_home):
    tmp_home.mkdir(parents=True, exist_ok=True)
    (tmp_home / "config.toml").write_text("[sweep]\ngmail_tools = []\ngithub_reviews = false\n")
    s = load_settings()
    assert config.source_state(s, "gmail") == "removed" and config.source_state(s, "slack") == "on"
    config.write_overrides({"sources": {"gmail": "on", "slack": "paused", "github": "on", "linear": "removed",
                                        "nope": "on", "grain": "maybe"}})
    s = load_settings()
    assert s.gmail_tools == config.DEFAULT_GMAIL_TOOLS        # back to the read-only defaults
    assert s.slack_tools == [] and config.source_state(s, "slack") == "paused"
    assert s.github_reviews is True and s.linear_mentions is False
    assert s.grain_tools == config.DEFAULT_GRAIN_TOOLS        # a bad state is ignored
    assert set(s.enabled_sources()) == {"gmail", "grain", "calendar", "hubspot", "github"}


def test_schedule_overrides_and_hours():
    s = load_settings()
    assert s.schedule_hours() == [8, 10, 12, 14, 16]
    config.write_overrides({"schedule": {"every": 3, "start": 7, "end": 18, "days": "every day"}})
    s = load_settings()
    assert s.schedule_hours() == [7, 10, 13, 16] and s.schedule_days == "every day"
    p = schedule.schedule_plist(s)
    assert all("Weekday" not in t for t in p["StartCalendarInterval"]) and len(p["StartCalendarInterval"]) == 4
    d = schedule.describe(s, True)
    assert d["plan_hour"] == 7 and d["wrapup_hour"] == 16
    config.write_overrides({"schedule": {"every": 5, "start": 7, "end": 18}})       # invalid: ignored
    assert load_settings().schedule_hours() == [8, 10, 12, 14, 16]


def test_settings_api_sources():
    client, settings, _ = client_for()
    body = client.get("/api/settings").json()
    assert [x["key"] for x in body["sources"]][:2] == ["slack", "gmail"]
    assert all(x["state"] == "on" for x in body["sources"])
    r = client.put("/api/settings/sources/hubspot", json={"state": "paused"})
    assert r.status_code == 200
    assert next(x for x in r.json()["sources"] if x["key"] == "hubspot")["state"] == "paused"
    assert "hubspot" not in settings.enabled_sources()          # this process sees it at once
    client.put("/api/settings/sources/github", json={"state": "removed"})
    assert config.read_overrides()["sources"] == {"hubspot": "paused", "github": "removed"}
    assert client.put("/api/settings/sources/zoom", json={"state": "on"}).status_code == 404
    assert client.put("/api/settings/sources/slack", json={"state": "off"}).status_code == 422


def test_settings_api_schedule_reloads_launchd():
    client, settings, sched = client_for()
    r = client.put("/api/settings/schedule", json={"every": 1, "start": 9, "end": 17, "days": "weekdays"})
    assert r.status_code == 200, r.text
    assert r.json()["schedule"]["hours"] == list(range(9, 18))
    assert sched.installs == [list(range(9, 18))]
    assert client.put("/api/settings/schedule", json={"every": 5, "start": 9, "end": 17}).status_code == 400
    assert client.put("/api/settings/schedule", json={"every": 2, "start": 12, "end": 9}).status_code == 400
    assert client.put("/api/settings/schedule", json={"every": 2, "start": 2, "end": 9}).status_code == 422


def test_settings_api_schedule_not_installed_and_failure():
    client, _, sched = client_for(FakeScheduler(installed=False))
    client.put("/api/settings/schedule", json={"every": 2, "start": 8, "end": 16})
    assert sched.installs == []                                   # saved only
    assert client.post("/api/settings/schedule/install").json()["schedule"]["installed"] is True
    client, _, _ = client_for(FakeScheduler(fail=True))
    r = client.put("/api/settings/schedule", json={"every": 2, "start": 8, "end": 14})
    assert r.status_code == 502 and "Saved" in r.json()["error"]
    assert load_settings().schedule_end == 14


def test_settings_api_daylight():
    client, _, _ = client_for()
    r = client.put("/api/settings/daylight", json={"place": "Shelburne, VT", "latitude": 44.39, "longitude": -73.23})
    assert r.json()["daylight"]["place"] == "Shelburne, VT"
    assert client.get("/api/daylight").json()["location"] == {"lat": 44.39, "lon": -73.23, "place": "Shelburne, VT"}
    assert client.put("/api/settings/daylight", json={"place": "x", "latitude": 44}).status_code == 400
    client.put("/api/settings/daylight", json={"place": ""})
    assert client.get("/api/daylight").json()["location"] is None


def test_install_keeps_the_program_of_an_existing_schedule(tmp_path, monkeypatch):
    import plistlib
    monkeypatch.setattr(schedule, "plist_path", lambda: tmp_path / "agent.plist")
    monkeypatch.setattr(schedule, "supported", lambda: True)
    calls = []
    monkeypatch.setattr(schedule.subprocess, "call", lambda *a, **k: calls.append(a) or 0)
    monkeypatch.setattr(schedule.subprocess, "run", lambda *a, **k: calls.append(a) or SimpleNamespace(returncode=0, stderr=""))
    with open(tmp_path / "agent.plist", "wb") as fh:
        plistlib.dump({"ProgramArguments": ["/checkout/.venv/bin/todohub", "sweep"], "EnvironmentVariables": {"PATH": "/x"}}, fh)
    config.write_overrides({"schedule": {"every": 4, "start": 8, "end": 16}})
    schedule.install(load_settings())
    with open(tmp_path / "agent.plist", "rb") as fh:
        p = plistlib.load(fh)
    assert p["ProgramArguments"] == ["/checkout/.venv/bin/todohub", "sweep"] and p["EnvironmentVariables"] == {"PATH": "/x"}
    assert {t["Hour"] for t in p["StartCalendarInterval"]} == {8, 12, 16}
    assert any("bootstrap" in a[0] for a in calls)


def test_periscope_prompt_from_the_settings_page():
    assert load_settings().periscope_prompt == config.DEFAULT_PERISCOPE_PROMPT
    config.write_overrides({"periscope": {"prompt": "Read {identifier}."}})
    assert load_settings().periscope_prompt == "Read {identifier}."
    config.write_overrides({"periscope": {"prompt": "   "}})
    assert load_settings().periscope_prompt == config.DEFAULT_PERISCOPE_PROMPT


def test_periscope_review_prompt_from_the_settings_page():
    assert load_settings().periscope_review_prompt == config.DEFAULT_PERISCOPE_REVIEW_PROMPT
    config.write_overrides({"periscope": {"review_prompt": "Review {pr}."}})
    s = load_settings()
    assert s.periscope_review_prompt == "Review {pr}." and s.periscope_prompt == config.DEFAULT_PERISCOPE_PROMPT
    config.write_overrides({"periscope": {"review_prompt": "   "}})
    assert load_settings().periscope_review_prompt == config.DEFAULT_PERISCOPE_REVIEW_PROMPT


def test_periscope_is_off_by_default():
    s = load_settings()
    assert s.periscope_url == "" and s.periscope_app_id == "" and not s.periscope_on


def test_periscope_url_and_app_id_from_config_toml(tmp_home):
    load_settings()   # writes the default config.toml
    cfg = tmp_home / "config.toml"
    cfg.write_text(cfg.read_text().replace(
        "[app]\n", '[app]\nperiscope_url = "http://127.0.0.1:17375"\nperiscope_app_id = "com.example.periscope"\n'))
    s = load_settings()
    assert s.periscope_url == "http://127.0.0.1:17375" and s.periscope_on
    assert s.periscope_app_id == "com.example.periscope"


def test_settings_api_periscope_prompts():
    client, _, _ = client_for()
    default = {"enabled": False,
               "prompt": config.DEFAULT_PERISCOPE_PROMPT, "default_prompt": config.DEFAULT_PERISCOPE_PROMPT,
               "review_prompt": config.DEFAULT_PERISCOPE_REVIEW_PROMPT,
               "default_review_prompt": config.DEFAULT_PERISCOPE_REVIEW_PROMPT}
    assert client.get("/api/settings").json()["periscope"] == default
    r = client.put("/api/settings/periscope", json={"prompt": "Read {identifier}.", "review_prompt": "Review {pr}."})
    assert r.status_code == 200
    assert r.json()["periscope"] == {**default, "prompt": "Read {identifier}.", "review_prompt": "Review {pr}."}
    # One prompt back to its default: the other stays as it was.
    assert client.put("/api/settings/periscope", json={"prompt": ""}).json()["periscope"] == \
        {**default, "review_prompt": "Review {pr}."}
    assert client.put("/api/settings/periscope", json={"review_prompt": ""}).json()["periscope"] == default
