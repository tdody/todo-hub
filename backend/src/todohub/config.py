"""Settings, file locations and the Linear API key.

Everything lives in one folder, ``~/Library/Application Support/TodoHub`` on macOS
(override with the ``TODOHUB_HOME`` environment variable, which the tests use):

    config.toml      settings you can edit
    settings.json    what the app's Settings page changed (sources, schedule, Daylight place,
                     the Start Claude repos and prompts);
                     it wins over config.toml for those keys
    todohub.db       SQLite: candidate queue, runs, source status
    sweep/           the folder Claude Code runs in (so no repo .mcp.json is picked up)
    logs/            one log file per sweep run
"""

from __future__ import annotations

import json
import os
import sys
import tomllib
from dataclasses import dataclass, field
from pathlib import Path

KEYRING_SERVICE = "todohub"
KEYRING_LINEAR = "linear-api-key"

# Read-only tools the sweep may call. Anything not listed here is unavailable to the
# headless run, so a message that says "reply to this" cannot make it send anything.
DEFAULT_SLACK_TOOLS = [
    "mcp__claude_ai_Slack__slack_search_public_and_private",
    "mcp__claude_ai_Slack__slack_read_thread",
    "mcp__claude_ai_Slack__slack_read_channel",
    "mcp__claude_ai_Slack__slack_read_user_profile",
]
DEFAULT_GRAIN_TOOLS = [
    "mcp__claude_ai_Grain__list_attended_meetings",
    "mcp__claude_ai_Grain__fetch_meeting",
    "mcp__claude_ai_Grain__fetch_meeting_action_items",
    "mcp__claude_ai_Grain__fetch_meeting_notes",
    "mcp__claude_ai_Grain__search_in_transcripts",
    "mcp__claude_ai_Grain__resolve_urls",
]

DEFAULT_GMAIL_TOOLS = [
    "mcp__claude_ai_Gmail__search_threads",
    "mcp__claude_ai_Gmail__get_thread",
    "mcp__claude_ai_Gmail__get_message",
    "mcp__claude_ai_Gmail__list_labels",
]
DEFAULT_CALENDAR_TOOLS = [
    "mcp__claude_ai_Google_Calendar__list_events",
    "mcp__claude_ai_Google_Calendar__get_event",
    "mcp__claude_ai_Google_Calendar__search_events",
    "mcp__claude_ai_Google_Calendar__list_calendars",
]

# HubSpot: your owner id, ticket stages, searches over tickets and notes, and note authors.
DEFAULT_HUBSPOT_TOOLS = [
    "mcp__claude_ai_HubSpot__get_user_details",
    "mcp__claude_ai_HubSpot__search_crm_objects",
    "mcp__claude_ai_HubSpot__get_crm_objects",
    "mcp__claude_ai_HubSpot__discover_hubspot_schema",
    "mcp__claude_ai_HubSpot__search_owners",
]

DEFAULT_CONFIG = """\
# TodoHub settings. Edit, then restart the app. Missing keys fall back to defaults.

[linear]
team_key = ""              # key of the team new issues are created in, e.g. "ENG"
client_label_group = "client"
todo_state = "Todo"        # status for approved tasks
waiting_state = "Pending"  # status for "waiting on someone" items
done_state = "Done"        # completed status for Mark done, ticked sub-issues and approved closes
followup_days = 3          # working days before a "waiting on" item comes due
default_priority = 4       # 0 none, 1 urgent, 2 high, 3 medium, 4 low
missions_initiative = "Q4 Missions"   # the initiative your missions live in (weekly check-in draft)

# Your team's Linear labels -> task type (code, analysis, model, review, meeting, email,
# writing, admin). Checked before the title. Bug, Feature and Improvement are built in.
# [linear.label_types]
# "data quality" = "analysis"

[sweep]
claude_path = "claude"     # full path if launchd can't find it, e.g. "/Users/you/.local/bin/claude"
model = "sonnet"
max_turns = 60
timeout_minutes = 20
first_run_lookback_hours = 72
snitch_url = ""            # Dead Man's Snitch URL, e.g. "https://nosnch.in/abc123"
restricted = true          # run Claude Code with --restricted (ignores ~/.claude settings); keep on

# Read-only tool allowlists (slack_tools, gmail_tools, grain_tools, calendar_tools, hubspot_tools) default
# to the built-in lists. Set one to [] to switch that source off, e.g.:
# gmail_tools = []
gmail_account = ""         # your Gmail address, used to build "open in Gmail" links
linear_mentions = true     # read Linear notifications where someone @-mentions you
github_reviews = true      # read open PRs requesting your review, with the gh command
gh_path = "gh"
# extra_denied_servers = []  # your own MCP servers the sweep must never use, on top of the built-in list

[app]
port = 8765
# Daylight theme: where sunset is worked out. Leave the coordinates out to use the city your
# Mac's time zone is named after (America/New_York -> New York).
# daylight_place = "Shelburne, VT"
# daylight_latitude = 44.39
# daylight_longitude = -73.23
# Periscope, for Start in periscope on an issue. Setting periscope_url turns Start in periscope on.
# periscope_url = "http://127.0.0.1:17374"
# periscope_app_id = "com.tom.periscope.app"  # lets Show bring the app to the front
"""


def home() -> Path:
    override = os.environ.get("TODOHUB_HOME")
    if override:
        return Path(override).expanduser()
    if sys.platform == "darwin":
        return Path.home() / "Library" / "Application Support" / "TodoHub"
    return Path.home() / ".todohub"


# Start in periscope and Start in Claude Code send the code prompt. Start in periscope sends the review prompt for a
# review ticket's PR. Start in Claude Desktop puts the chat prompt in a new chat. {identifier}, {title} and {url}
# become the issue's, and {pr} in the review prompt becomes the PR's URL.
DEFAULT_CODE_PROMPT = (
    "Read Linear ticket {identifier} ({url}) and its comments with the Linear tools. "
    "Sum up the ask, then propose a plan. Do not change code until I agree."
)
DEFAULT_REVIEW_PROMPT = (
    "Read Linear ticket {identifier} ({url}) and its comments with the Linear tools. "
    "Then review {pr} in this worktree: sum up the change and list the problems you find. "
    "Do not post anything on GitHub."
)
DEFAULT_CHAT_PROMPT = (
    "Read Linear ticket {identifier} ({url}) and its comments with the Linear connector. "
    "Sum up the ask, then help me with it."
)


@dataclass
class Settings:
    team_key: str = ""
    client_label_group: str = "client"
    todo_state: str = "Todo"
    waiting_state: str = "Pending"
    done_state: str = "Done"
    followup_days: int = 3
    default_priority: int = 4
    missions_initiative: str = "Q4 Missions"
    label_types: dict[str, str] = field(default_factory=dict)
    claude_path: str = "claude"
    model: str = "sonnet"
    max_turns: int = 60
    timeout_minutes: int = 20
    first_run_lookback_hours: int = 72
    snitch_url: str = ""
    restricted: bool = True
    slack_tools: list[str] = field(default_factory=lambda: list(DEFAULT_SLACK_TOOLS))
    grain_tools: list[str] = field(default_factory=lambda: list(DEFAULT_GRAIN_TOOLS))
    gmail_tools: list[str] = field(default_factory=lambda: list(DEFAULT_GMAIL_TOOLS))
    linear_mentions: bool = True
    github_reviews: bool = True
    gh_path: str = "gh"
    calendar_tools: list[str] = field(default_factory=lambda: list(DEFAULT_CALENDAR_TOOLS))
    hubspot_tools: list[str] = field(default_factory=lambda: list(DEFAULT_HUBSPOT_TOOLS))
    calendar_create_tool: str = "mcp__claude_ai_Google_Calendar__create_event"
    gmail_draft_tool: str = "mcp__claude_ai_Gmail__create_draft"   # used only by "Save as Gmail draft"
    gmail_account: str = ""
    extra_denied_servers: list[str] = field(default_factory=list)
    port: int = 8765
    daylight_place: str = ""
    daylight_latitude: float | None = None
    daylight_longitude: float | None = None
    periscope_url: str = ""
    periscope_app_id: str = ""
    code_prompt: str = DEFAULT_CODE_PROMPT
    review_prompt: str = DEFAULT_REVIEW_PROMPT
    chat_prompt: str = DEFAULT_CHAT_PROMPT
    repos: list[str] = field(default_factory=list)     # Start in Claude Code's repos: absolute top folders
    # Settings page: each source's state ("on", "paused", "removed"); a source not listed follows
    # config.toml. And when the sweep runs on its own.
    source_states: dict[str, str] = field(default_factory=dict)
    schedule_every: int = 2          # hours between sweeps
    schedule_start: int = 8          # first sweep of the day (hour)
    schedule_end: int = 16           # last possible sweep (hour)
    schedule_days: str = "weekdays"  # or "every day"

    @property
    def home(self) -> Path:
        return home()

    @property
    def db_path(self) -> Path:
        return self.home / "todohub.db"

    @property
    def sweep_dir(self) -> Path:
        return self.home / "sweep"

    @property
    def log_dir(self) -> Path:
        return self.home / "logs"

    @property
    def config_path(self) -> Path:
        return self.home / "config.toml"

    @property
    def overrides_path(self) -> Path:
        return self.home / "settings.json"

    def schedule_hours(self) -> list[int]:
        """The hours the sweep runs at, e.g. [8, 10, 12, 14, 16]."""
        return list(range(self.schedule_start, self.schedule_end + 1, self.schedule_every))

    def only(self, source: str) -> "Settings":
        """A copy with every source but ``source`` turned off, for a one-source sweep."""
        from dataclasses import replace
        return replace(
            self,
            slack_tools=self.slack_tools if source == "slack" else [],
            gmail_tools=self.gmail_tools if source == "gmail" else [],
            grain_tools=self.grain_tools if source == "grain" else [],
            calendar_tools=self.calendar_tools if source == "calendar" else [],
            hubspot_tools=self.hubspot_tools if source == "hubspot" else [],
            linear_mentions=self.linear_mentions and source == "linear",
            github_reviews=self.github_reviews and source == "github",
        )

    @property
    def periscope_on(self) -> bool:
        return bool(self.periscope_url)

    @property
    def claude_code_on(self) -> bool:
        return bool(self.repos)

    def enabled_sources(self) -> list[str]:
        return [
            name
            for name, tools in (
                ("slack", self.slack_tools), ("gmail", self.gmail_tools),
                ("grain", self.grain_tools), ("calendar", self.calendar_tools), ("hubspot", self.hubspot_tools),
                ("linear", self.linear_mentions), ("github", self.github_reviews),
            )
            if tools
        ]


# The first release wrote this line, which kept Gmail off; it's now on by default.
_OLD_GMAIL_OFF = "# Gmail stays off until its exact read-only tool names are confirmed.\ngmail_tools = []\n"


def ensure_home() -> Path:
    h = home()
    for p in (h, h / "sweep", h / "logs"):
        p.mkdir(parents=True, exist_ok=True)
    cfg = h / "config.toml"
    if not cfg.exists():
        cfg.write_text(DEFAULT_CONFIG)
    elif _OLD_GMAIL_OFF in (text := cfg.read_text()):
        cfg.write_text(text.replace(_OLD_GMAIL_OFF, "# gmail_tools = []   # uncomment to switch Gmail off\n"))
    return h


def load_settings() -> Settings:
    ensure_home()
    raw = tomllib.loads((home() / "config.toml").read_text())
    s = Settings()
    linear = raw.get("linear", {})
    sweep = raw.get("sweep", {})
    app = raw.get("app", {})
    s.team_key = linear.get("team_key", s.team_key)
    s.client_label_group = linear.get("client_label_group", s.client_label_group)
    s.todo_state = linear.get("todo_state", s.todo_state)
    s.waiting_state = linear.get("waiting_state", s.waiting_state)
    s.done_state = linear.get("done_state", s.done_state)
    s.followup_days = int(linear.get("followup_days", s.followup_days))
    s.default_priority = int(linear.get("default_priority", s.default_priority))
    s.missions_initiative = str(linear.get("missions_initiative", s.missions_initiative))
    s.label_types = {k.lower(): v for k, v in linear.get("label_types", {}).items()}
    s.claude_path = sweep.get("claude_path", s.claude_path)
    s.model = sweep.get("model", s.model)
    s.max_turns = int(sweep.get("max_turns", s.max_turns))
    s.timeout_minutes = int(sweep.get("timeout_minutes", s.timeout_minutes))
    s.first_run_lookback_hours = int(sweep.get("first_run_lookback_hours", s.first_run_lookback_hours))
    s.snitch_url = sweep.get("snitch_url", s.snitch_url)
    s.restricted = bool(sweep.get("restricted", s.restricted))
    s.slack_tools = list(sweep.get("slack_tools", s.slack_tools))
    s.grain_tools = list(sweep.get("grain_tools", s.grain_tools))
    s.gmail_tools = list(sweep.get("gmail_tools", s.gmail_tools))
    s.gmail_account = sweep.get("gmail_account", s.gmail_account)
    s.calendar_tools = list(sweep.get("calendar_tools", s.calendar_tools))
    s.hubspot_tools = list(sweep.get("hubspot_tools", s.hubspot_tools))
    s.calendar_create_tool = sweep.get("calendar_create_tool", s.calendar_create_tool)
    s.gmail_draft_tool = sweep.get("gmail_draft_tool", s.gmail_draft_tool)
    s.linear_mentions = bool(sweep.get("linear_mentions", s.linear_mentions))
    s.github_reviews = bool(sweep.get("github_reviews", s.github_reviews))
    s.gh_path = sweep.get("gh_path", s.gh_path)
    s.extra_denied_servers = list(sweep.get("extra_denied_servers", s.extra_denied_servers))
    s.port = int(app.get("port", s.port))
    s.daylight_place = str(app.get("daylight_place", s.daylight_place))
    s.daylight_latitude = _coord(app.get("daylight_latitude"), 90)
    s.daylight_longitude = _coord(app.get("daylight_longitude"), 180)
    s.periscope_url = str(app.get("periscope_url", s.periscope_url))
    s.periscope_app_id = str(app.get("periscope_app_id", s.periscope_app_id))
    apply_overrides(s, read_overrides())
    return s


# ---- the Settings page's choices ---------------------------------------------------------------
# Sources the Settings page can add, pause or remove: (key, name, Settings field, default).
SOURCE_FIELDS = {
    "slack": ("slack_tools", DEFAULT_SLACK_TOOLS),
    "gmail": ("gmail_tools", DEFAULT_GMAIL_TOOLS),
    "grain": ("grain_tools", DEFAULT_GRAIN_TOOLS),
    "calendar": ("calendar_tools", DEFAULT_CALENDAR_TOOLS),
    "hubspot": ("hubspot_tools", DEFAULT_HUBSPOT_TOOLS),
    "linear": ("linear_mentions", True),
    "github": ("github_reviews", True),
}
SOURCE_STATES = ("on", "paused", "removed")
SCHEDULE_EVERY = (1, 2, 3, 4)
SCHEDULE_DAYS = ("weekdays", "every day")
SCHEDULE_FIRST, SCHEDULE_LAST = 5, 22      # hours the schedule may start and end at


def read_overrides() -> dict:
    """The Settings page's file; {} when it's missing or unreadable (config.toml then decides)."""
    try:
        data = json.loads((home() / "settings.json").read_text())
    except (OSError, ValueError):
        return {}
    return data if isinstance(data, dict) else {}


def write_overrides(data: dict) -> None:
    path = ensure_home() / "settings.json"
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, indent=2, sort_keys=True))
    tmp.replace(path)


def apply_overrides(s: Settings, data: dict) -> None:
    """Lay the Settings page's choices over config.toml. Values that don't make sense are ignored."""
    for key, state in (data.get("sources") or {}).items():
        if key not in SOURCE_FIELDS or state not in SOURCE_STATES:
            continue
        s.source_states[key] = state
        name, default = SOURCE_FIELDS[key]
        if isinstance(default, bool):
            setattr(s, name, state == "on")
        elif state != "on":
            setattr(s, name, [])
        elif not getattr(s, name):            # turned off in config.toml: back to the read-only defaults
            setattr(s, name, list(default))
    sched = data.get("schedule") or {}
    try:
        every, start, end = int(sched.get("every", s.schedule_every)), int(sched.get("start", s.schedule_start)), \
            int(sched.get("end", s.schedule_end))
    except (TypeError, ValueError):
        every, start, end = s.schedule_every, s.schedule_start, s.schedule_end
    if every in SCHEDULE_EVERY and SCHEDULE_FIRST <= start <= end <= SCHEDULE_LAST:
        s.schedule_every, s.schedule_start, s.schedule_end = every, start, end
    if sched.get("days") in SCHEDULE_DAYS:
        s.schedule_days = sched["days"]
    day = data.get("daylight")
    if isinstance(day, dict):
        s.daylight_place = str(day.get("place") or "")[:80]
        s.daylight_latitude = _coord(day.get("latitude"), 90)
        s.daylight_longitude = _coord(day.get("longitude"), 180)
    start = data.get("start")
    if isinstance(start, dict):
        if isinstance(start.get("repos"), list):
            s.repos = [r for r in start["repos"] if isinstance(r, str)]
        for key in ("code_prompt", "review_prompt", "chat_prompt"):
            if isinstance(start.get(key), str) and start[key].strip():
                setattr(s, key, start[key])


def source_state(s: Settings, key: str) -> str:
    """on, paused or removed: the Settings page's choice, else whether config.toml has it on."""
    if key in s.source_states:
        return s.source_states[key]
    return "on" if getattr(s, SOURCE_FIELDS[key][0]) else "removed"


def _coord(value, limit: float) -> float | None:
    """A latitude or longitude from config.toml, or None if it's missing or out of range."""
    try:
        v = float(value)
    except (TypeError, ValueError):
        return None
    return v if -limit <= v <= limit else None


def get_linear_key() -> str:
    """The Linear personal API key: macOS Keychain first, then $LINEAR_API_KEY."""
    env = os.environ.get("LINEAR_API_KEY")
    if env:
        return env
    import keyring

    key = keyring.get_password(KEYRING_SERVICE, KEYRING_LINEAR)
    if not key:
        raise RuntimeError("No Linear API key. Run `todohub set-linear-key` first.")
    return key


def set_linear_key(key: str) -> None:
    import keyring

    keyring.set_password(KEYRING_SERVICE, KEYRING_LINEAR, key)
