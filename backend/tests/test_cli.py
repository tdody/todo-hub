import json

from todohub import cli
from todohub.config import load_settings


def test_broad_allow_rules(tmp_path):
    f = tmp_path / "settings.json"
    f.write_text(json.dumps({"permissions": {"allow": [
        "mcp__claude_ai_Slack", "mcp__claude_ai_Slack__slack_read_thread",
        "mcp__claude_ai_Gmail__forward", "Bash(git status)"]}}))
    assert cli.broad_allow_rules(load_settings(), f) == ["mcp__claude_ai_Slack", "mcp__claude_ai_Gmail__forward"]
    assert cli.broad_allow_rules(load_settings(), tmp_path / "missing.json") == []


def test_schedule_is_weekdays_five_times():
    p = cli.schedule_plist()
    slots = p["StartCalendarInterval"]
    assert len(slots) == 25
    assert {s["Weekday"] for s in slots} == {1, 2, 3, 4, 5}
    assert {s["Hour"] for s in slots} == {8, 10, 12, 14, 16}
    assert p["ProgramArguments"][-2:] == ["--trigger", "schedule"]


def test_old_config_turns_gmail_on(tmp_home):
    from todohub import config
    tmp_home.mkdir(parents=True, exist_ok=True)
    (tmp_home / "config.toml").write_text(
        "[sweep]\n# Read-only tool allowlists. Leave a list empty to switch that source off.\n"
        "# Gmail stays off until its exact read-only tool names are confirmed.\ngmail_tools = []\n")
    s = config.load_settings()
    assert s.gmail_tools == config.DEFAULT_GMAIL_TOOLS and "gmail" in s.enabled_sources()
    assert "# gmail_tools = []" in (tmp_home / "config.toml").read_text()


def test_local_label_types_and_denied_servers(tmp_home):
    from todohub import config, sweep
    tmp_home.mkdir(parents=True, exist_ok=True)
    (tmp_home / "config.toml").write_text(
        '[linear]\nteam_key = "ENG"\n[linear.label_types]\n"Data Quality" = "analysis"\n'
        '[sweep]\nextra_denied_servers = ["mcp__acme_internal"]\n')
    s = config.load_settings()
    assert s.team_key == "ENG" and s.label_types == {"data quality": "analysis"}
    assert sweep.denied_servers(s) == [*sweep.DENIED_SERVERS, "mcp__acme_internal"]


def test_hubspot_is_on_by_default_and_can_be_switched_off(tmp_home):
    from todohub import config
    s = config.load_settings()
    assert s.hubspot_tools == config.DEFAULT_HUBSPOT_TOOLS and "hubspot" in s.enabled_sources()
    assert "hubspot_tools" in (tmp_home / "config.toml").read_text()
    (tmp_home / "config.toml").write_text("[sweep]\nhubspot_tools = []\n")
    assert "hubspot" not in config.load_settings().enabled_sources()


def test_hubspot_read_tools_are_not_broad_rules(tmp_path):
    f = tmp_path / "settings.json"
    f.write_text(json.dumps({"permissions": {"allow": [
        "mcp__claude_ai_HubSpot__search_crm_objects", "mcp__claude_ai_HubSpot__manage_crm_objects"]}}))
    assert cli.broad_allow_rules(load_settings(), f) == ["mcp__claude_ai_HubSpot__manage_crm_objects"]
    assert cli.CONNECTORS["hubspot"] == "claude.ai HubSpot"
