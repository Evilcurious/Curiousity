"""Integration connector interface — add new connectors without touching the backend core."""
from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any, Dict, List, Tuple


class IntegrationError(Exception):
    pass


class IntegrationConnector(ABC):
    """A connector exposes: connection testing, tool discovery and tool execution."""

    key: str = "base"

    @abstractmethod
    async def test_connection(self, config: Dict[str, Any], credentials: Dict[str, str]) -> Tuple[bool, str]:
        ...

    @abstractmethod
    async def discover_tools(self, config: Dict[str, Any], credentials: Dict[str, str]) -> List[Dict[str, Any]]:
        """Return a list of {external_id, name, display_name, description, parameters_schema}."""
        ...

    @abstractmethod
    async def execute(self, config: Dict[str, Any], credentials: Dict[str, str],
                      external_id: str, arguments: Dict[str, Any]) -> str:
        ...
