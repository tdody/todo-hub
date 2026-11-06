import asyncio

import pytest
from mcp.server.mcpserver.exceptions import ToolError, UnexpectedToolError

from todohub import mcp_server


def test_validation_errors_reach_claude_with_their_message():
    """An anticipated ToolError keeps its message; a crash would only say 'Error executing tool'."""
    async def go():
        return await mcp_server.server.call_tool("add_candidate", {
            "source": "grain", "source_id": "m-1", "title": "Send deck", "signal": "action_item",
            "why": "w", "excerpt": "e", "source_url": "",
        })

    with pytest.raises(ToolError, match="resolve_urls") as info:
        asyncio.run(go())
    assert not isinstance(info.value, UnexpectedToolError)


def test_schema_requires_source_url_and_types_links():
    tools = {t.name: t for t in asyncio.run(mcp_server.server.list_tools())}
    schema = tools["add_candidate"].input_schema
    assert "source_url" in schema["required"]
    assert {"links", "subtasks"} <= set(schema["properties"])


def test_hubspot_is_a_source_for_every_tool():
    tools = {t.name: t for t in asyncio.run(mcp_server.server.list_tools())}
    for name in ("is_seen", "mark_seen", "add_candidate", "propose_close", "propose_update", "report_source_status"):
        assert "hubspot" in tools[name].input_schema["properties"]["source"]["enum"], name
