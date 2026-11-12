"""Runtime system settings overrides (set by the admin panel, persisted to disk)."""
from __future__ import annotations

import json
import os
from typing import Any, Dict

from app.config import get_settings

_SETTINGS_PATH = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "data", "system_settings.json")
_overrides: Dict[str, Any] = {}


def _load() -> None:
    global _overrides
    try:
        with open(_SETTINGS_PATH) as fh:
            _overrides = json.load(fh)
    except Exception:
        _overrides = {}


def _save() -> None:
    try:
        os.makedirs(os.path.dirname(_SETTINGS_PATH), exist_ok=True)
        with open(_SETTINGS_PATH, "w") as fh:
            json.dump(_overrides, fh)
    except Exception:
        pass


_load()


def get_override(key: str, default: Any = None) -> Any:
    return _overrides.get(key, default)


def set_overrides(values: Dict[str, Any]) -> None:
    _overrides.update({k: v for k, v in values.items() if v is not None})
    _save()


def is_maintenance_mode() -> bool:
    return bool(_overrides.get("maintenance_mode", get_settings().maintenance_mode))


def registration_allowed() -> bool:
    return bool(_overrides.get("registration_enabled", get_settings().registration_enabled))
