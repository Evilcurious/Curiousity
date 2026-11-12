"""Built-in agent tools: always available, no external credentials needed."""
from __future__ import annotations

import ast
import datetime as _dt
import json
import operator as _op
import re
from typing import Any, Dict

import httpx

from app.agent.tools.base import BaseTool, ToolContext, ToolError, ToolSpec


class GetCurrentTimeTool(BaseTool):
    spec = ToolSpec(
        name="get_current_time",
        description="Get the current date and time (UTC, ISO 8601) with the local weekday.",
        parameters={"type": "object", "properties": {}},
    )

    async def execute(self, arguments: Dict[str, Any], ctx: ToolContext) -> str:
        now = _dt.datetime.now(_dt.timezone.utc)
        return json.dumps({
            "iso": now.isoformat(),
            "weekday": now.strftime("%A"),
            "unix": int(now.timestamp()),
        })


_SAFE_OPS = {
    ast.Add: _op.add, ast.Sub: _op.sub, ast.Mult: _op.mul, ast.Div: _op.truediv,
    ast.FloorDiv: _op.floordiv, ast.Mod: _op.mod, ast.Pow: _op.pow,
    ast.USub: _op.neg, ast.UAdd: _op.pos,
}


def _eval_node(node):
    if isinstance(node, ast.Constant) and isinstance(node.value, (int, float)):
        return node.value
    if isinstance(node, ast.BinOp) and type(node.op) in _SAFE_OPS:
        return _SAFE_OPS[type(node.op)](_eval_node(node.left), _eval_node(node.right))
    if isinstance(node, ast.UnaryOp) and type(node.op) in _SAFE_OPS:
        return _SAFE_OPS[type(node.op)](_eval_node(node.operand))
    raise ValueError("Unsupported expression")


class CalculatorTool(BaseTool):
    spec = ToolSpec(
        name="calculator",
        description="Evaluate an arithmetic expression (numbers and + - * / // % ** parentheses).",
        parameters={
            "type": "object",
            "properties": {
                "expression": {"type": "string", "description": "Arithmetic expression, e.g. '2*(3+4)'"},
            },
            "required": ["expression"],
        },
    )

    async def execute(self, arguments: Dict[str, Any], ctx: ToolContext) -> str:
        expr = str(arguments.get("expression", "")).strip()
        if not expr:
            raise ToolError("Empty expression")
        try:
            tree = ast.parse(expr, mode="eval")
            result = _eval_node(tree.body)
        except Exception as exc:
            raise ToolError(f"Cannot evaluate expression: {exc}")
        return json.dumps({"expression": expr, "result": result})


class WebSearchTool(BaseTool):
    spec = ToolSpec(
        name="web_search",
        description="Search the web and return the top result titles, URLs and snippets.",
        parameters={
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": "Search query"},
                "max_results": {"type": "integer", "description": "Number of results (1-10)", "default": 5},
            },
            "required": ["query"],
        },
    )

    async def execute(self, arguments: Dict[str, Any], ctx: ToolContext) -> str:
        query = str(arguments.get("query", "")).strip()
        if not query:
            raise ToolError("Empty query")
        max_results = max(1, min(int(arguments.get("max_results", 5)), 10))
        try:
            async with httpx.AsyncClient(timeout=20, follow_redirects=True) as client:
                resp = await client.get(
                    "https://html.duckduckgo.com/html/",
                    params={"q": query},
                    headers={"User-Agent": "Curiousity/1.0"},
                )
                resp.raise_for_status()
                html = resp.text
        except Exception as exc:
            raise ToolError(f"Web search failed: {exc}")
        results = []
        for m in re.finditer(
            r'class="result__a"[^>]*href="([^"]+)"[^>]*>(.*?)</a>[\s\S]*?class="result__snippet"[^>]*>(.*?)</a>',
            html,
        ):
            url, title, snippet = m.group(1), m.group(2), m.group(3)
            clean = lambda s: re.sub(r"<[^>]+>", "", s).strip()
            results.append({"title": clean(title), "url": url, "snippet": clean(snippet)})
            if len(results) >= max_results:
                break
        return json.dumps({"query": query, "results": results})


class HttpFetchTool(BaseTool):
    spec = ToolSpec(
        name="http_fetch",
        description="Fetch a URL over HTTP GET and return the response body as text (truncated).",
        parameters={
            "type": "object",
            "properties": {
                "url": {"type": "string", "description": "Absolute http(s) URL to fetch"},
                "max_chars": {"type": "integer", "description": "Truncate body to this many characters", "default": 4000},
            },
            "required": ["url"],
        },
    )

    async def execute(self, arguments: Dict[str, Any], ctx: ToolContext) -> str:
        url = str(arguments.get("url", "")).strip()
        if not re.match(r"^https?://", url):
            raise ToolError("Only http(s) URLs are allowed")
        max_chars = max(200, min(int(arguments.get("max_chars", 4000)), 20000))
        try:
            async with httpx.AsyncClient(timeout=25, follow_redirects=True) as client:
                resp = await client.get(url, headers={"User-Agent": "Curiousity/1.0"})
                body = resp.text[:max_chars]
                return json.dumps({"status": resp.status_code, "body": body})
        except Exception as exc:
            raise ToolError(f"Fetch failed: {exc}")


class JsonReadTool(BaseTool):
    spec = ToolSpec(
        name="json_query",
        description="Parse a JSON document and extract a value by simple dot-path (e.g. 'data.items.0.name').",
        parameters={
            "type": "object",
            "properties": {
                "document": {"type": "string", "description": "JSON document as text"},
                "path": {"type": "string", "description": "Dot path to extract; empty returns the whole document"},
            },
            "required": ["document"],
        },
    )

    async def execute(self, arguments: Dict[str, Any], ctx: ToolContext) -> str:
        try:
            data = json.loads(arguments.get("document", ""))
        except json.JSONDecodeError as exc:
            raise ToolError(f"Invalid JSON: {exc}")
        path = str(arguments.get("path", "")).strip()
        cur: Any = data
        if path:
            for part in path.split("."):
                if isinstance(cur, list):
                    try:
                        cur = cur[int(part)]
                    except (ValueError, IndexError):
                        raise ToolError(f"Path segment '{part}' not found")
                elif isinstance(cur, dict):
                    if part not in cur:
                        raise ToolError(f"Path segment '{part}' not found")
                    cur = cur[part]
                else:
                    raise ToolError(f"Cannot descend into {type(cur).__name__}")
        return json.dumps({"value": cur}, default=str)


BUILTIN_TOOLS: list[BaseTool] = [
    GetCurrentTimeTool(),
    CalculatorTool(),
    WebSearchTool(),
    HttpFetchTool(),
    JsonReadTool(),
]
