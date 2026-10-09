# =============================================================================
# data/cache.py
# =============================================================================
# Tiny thread-safe in-memory TTL cache. Yahoo Finance is slow and rate-limited,
# so every data function that hits the network is wrapped in @ttl_cache.
# .NET ANALOGY: IMemoryCache with AbsoluteExpirationRelativeToNow.
# =============================================================================

import copy
import functools
import threading
import time
from typing import Any, Callable

_store: dict[tuple, tuple[float, Any]] = {}
_lock = threading.Lock()
_key_locks: dict[tuple, threading.Lock] = {}


def ttl_cache(seconds: int) -> Callable:
    """Caches a function's return value per-arguments for `seconds`.

    Concurrent callers with the same key wait for the first one instead of
    all hitting Yahoo at once. Exceptions are never cached. Returned values
    are deep-copied so callers can't mutate the cached object.
    """
    def decorator(fn: Callable) -> Callable:
        @functools.wraps(fn)
        def wrapper(*args, **kwargs):
            key = (fn.__module__, fn.__qualname__, args, tuple(sorted(kwargs.items())))
            now = time.time()
            with _lock:
                hit = _store.get(key)
                if hit and hit[0] > now:
                    return copy.deepcopy(hit[1])
                key_lock = _key_locks.setdefault(key, threading.Lock())

            with key_lock:
                with _lock:
                    hit = _store.get(key)
                    if hit and hit[0] > time.time():
                        return copy.deepcopy(hit[1])
                value = fn(*args, **kwargs)
                with _lock:
                    _store[key] = (time.time() + seconds, value)
                return copy.deepcopy(value)

        wrapper.cache_clear = clear_cache  # type: ignore[attr-defined]
        return wrapper
    return decorator


def clear_cache() -> None:
    with _lock:
        _store.clear()
