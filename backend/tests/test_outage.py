import httpx
import pytest

from todohub import outage

# Claude Code's --debug=claudeai-mcp lines. The first three are from the 2026-11-13 outage; the last
# two follow Claude Code's message templates for giving up.
FETCHING = ("2026-11-13T13:49:14.868Z [DEBUG] [claudeai-mcp] Fetching from "
            "https://api.anthropic.com/v1/mcp_servers?limit=1000&include_additional_installs=true")
OUTAGE = [
    FETCHING,
    "2026-11-13T13:49:16.587Z [DEBUG] [claudeai-mcp] Transient fetch error (503), retrying in 500ms (attempt 1/3)",
    "2026-11-13T13:49:17.582Z [DEBUG] [claudeai-mcp] Transient fetch error (503), retrying in 1500ms (attempt 2/3)",
    "2026-11-13T13:49:19.301Z [DEBUG] [claudeai-mcp] Fetch failed (503) after 3 attempt(s)",
    "2026-11-13T13:49:19.302Z [DEBUG] [claudeai-mcp] Connector-list fetch failed transiently; background retry 1/3 in 4000ms",
]
FETCHED = "2026-11-13T14:41:46.119Z [DEBUG] [claudeai-mcp] Fetched 14 servers"


@pytest.mark.parametrize("lines, expected", [
    (OUTAGE, "HTTP 503"),                    # the last line has no status: the latest one counts
    ([FETCHING, FETCHED], None),             # a healthy start
    ([*OUTAGE, FETCHED], None),              # a background retry that worked
    ([FETCHING, "2026-11-13T13:49:19.301Z [DEBUG] [claudeai-mcp] Fetch failed (ECONNRESET) after 3 attempt(s)"],
     "ECONNRESET"),
    ([FETCHING, OUTAGE[-1]], ""),            # failed, with no status anywhere
    ([FETCHING, "2026-11-13T13:49:19.301Z [DEBUG] [claudeai-mcp] Something new"], None),  # wording it doesn't know
    ([], None),                              # no debug file
])
def test_fetch_failure(lines, expected):
    assert outage.fetch_failure(lines) == expected


# status.claude.com's summary.json during the outage, trimmed to what open_incident reads. The Microsoft
# 365 one comes first and doesn't list Claude Code, so it must be skipped.
SUMMARY = {"incidents": [
    {"name": "Elevated errors affecting the Microsoft 365 connector", "status": "identified",
     "components": [{"name": "claude.ai"}, {"name": "Claude Cowork"}]},
    {"name": "Elevated errors on claude.ai, the Claude API, and Claude Code", "status": "investigating",
     "components": [{"name": "claude.ai"}, {"name": "Claude API (api.anthropic.com)"}, {"name": "Claude Code"},
                    {"name": "Claude Cowork"}]},
]}


def fake_get(body=None, status=200, error=None):
    def get(url, timeout):
        assert url == outage.STATUS_URL and timeout == 5
        if error:
            raise error
        return httpx.Response(status, json=body, request=httpx.Request("GET", url))
    return get


def test_open_incident_names_the_one_listing_claude_code():
    assert outage.open_incident(fake_get(SUMMARY)) == "Elevated errors on claude.ai, the Claude API, and Claude Code"


@pytest.mark.parametrize("get", [
    fake_get({"incidents": []}),
    fake_get({}, status=503),
    fake_get(error=httpx.ConnectTimeout("slow")),
    fake_get(["not", "a", "summary"]),
])
def test_open_incident_is_none_without_one(get):
    assert outage.open_incident(get) is None


def test_message():
    assert outage.message("HTTP 503", None) == \
        "Anthropic's connector service didn't respond (HTTP 503), so it wasn't read."
    assert outage.message("", "Elevated errors on Claude Code") == (
        "Anthropic's connector service didn't respond, so it wasn't read. "
        'Anthropic reports "Elevated errors on Claude Code" (status.claude.com).')
