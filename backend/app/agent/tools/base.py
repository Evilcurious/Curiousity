"""Tool abstraction — every agent capability implements this interface."""
from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable, Dict, Optional


@dataclass
class ToolContext:
    user_id: str
    conversation_id: Optional[str] = None
    message_id: Optional[str] = None
    db: Any = None
    extras: Dict[str, Any] = field(default_factory=dict)


@dataclass
class ToolSpec:
    """Definition of a callable tool (mirrors OpenAI function-calling schema)."""
    name: str
    description: str
    parameters: Dict[str, Any]           # JSON Schema
    source: str = "builtin"              # builtin | mcp | composio | custom
    tool_id: Optional[str] = None        # DB Tool row id
    requires_approval: bool = False

    def to_openai_schema(self) -> Dict[str, Any]:
        return {
            "type": "function",
            "function": {
                "name": self.name,
                "description": self.description,
                "parameters": self.parameters or {"type": "object", "properties": {}},
            },
        }


class ToolError(Exception):
    pass


class BaseTool(ABC):
    spec: ToolSpec

    @abstractmethod
    async def execute(self, arguments: Dict[str, Any], ctx: ToolContext) -> str:
        """Run the tool and return a string result for the model."""
