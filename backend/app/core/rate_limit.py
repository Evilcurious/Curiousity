"""Sliding-window rate limiting backed by Redis, with in-memory fallback."""
from __future__ import annotations

import threading
import time
from typing import Optional

from app.config import get_settings

_lock = threading.Lock()
_memory: dict[str, list[float]] = {}
_redis = None
_redis_checked = False


def _get_redis():
    global _redis, _redis_checked
    if _redis_checked:
        return _redis
    _redis_checked = True
    try:
        import redis as redis_lib
        _redis = redis_lib.Redis.from_url(get_settings().redis_url, socket_connect_timeout=1, decode_responses=True)
        _redis.ping()
    except Exception:
        _redis = None
    return _redis


def reset_redis_state() -> None:
    """Used in tests to re-probe the Redis connection."""
    global _redis, _redis_checked
    _redis, _redis_checked = None, False


def rate_limit_exceeded(key: str, limit: int, window_seconds: int = 60) -> bool:
    """Return True when the caller exceeded `limit` events per window."""
    if not get_settings().rate_limit_enabled:
        return False
    now = time.time()
    r = _get_redis()
    if r is not None:
        try:
            pipe = r.pipeline()
            bucket = f"rl:{key}:{int(now // window_seconds)}"
            pipe.incr(bucket)
            pipe.expire(bucket, window_seconds + 1)
            count = int(pipe.execute()[0])
            return count > limit
        except Exception:
            pass  # fall back to memory
    with _lock:
        hits = [t for t in _memory.get(key, []) if now - t < window_seconds]
        hits.append(now)
        _memory[key] = hits
        return len(hits) > limit


def client_ip_from_scope(scope) -> Optional[str]:  # pragma: no cover - ASGI helper
    client = scope.get("client")
    return client[0] if client else None
