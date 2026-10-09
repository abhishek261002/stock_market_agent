# =============================================================================
# agents/llm.py
# =============================================================================
# One place that knows how to build the chat model and call it reliably.
#
#   get_llm(temperature)        → a ChatGoogleGenerativeAI (or a test fake)
#   structured(schema, temp)    → llm.with_structured_output(schema)
#   invoke_with_retry(chain, x) → rate-limited chain.invoke(x) with smart retries
#   acquire_slot()              → call before any direct llm.invoke/stream
#
# RATE LIMITING: Gemini's free tier allows only a few requests per minute per
# model (LLM_RPM, default 5). A full debate makes ~10 calls, so instead of
# failing with 429s we queue calls in a process-wide sliding-window limiter.
# Nodes can register an `on_wait` hook (contextvar) so the UI can show
# "waiting for a rate-limit slot".
#
# Tests call set_llm_factory() to swap in a fake model so the whole graph can
# run offline. .NET ANALOGY: an IChatClient registered in DI, mocked in tests,
# behind a System.Threading.RateLimiting.SlidingWindowRateLimiter.
# =============================================================================

from __future__ import annotations

import contextvars
import os
import re
import threading
import time
from collections import deque
from typing import Any, Callable, Optional, Type

from dotenv import load_dotenv
from pydantic import BaseModel

load_dotenv()

_factory: Optional[Callable[[float], Any]] = None

# Hook the current pipeline node sets so throttling waits can be reported to the UI
on_wait: contextvars.ContextVar[Optional[Callable[[float], None]]] = contextvars.ContextVar("on_wait", default=None)


# =============================================================================
# RATE LIMITER
# =============================================================================

class SlidingWindowLimiter:
    def __init__(self, per_minute: int):
        self.per_minute = max(1, per_minute)
        self._calls: deque[float] = deque()
        self._lock = threading.Lock()

    def acquire(self) -> float:
        """Blocks until a slot is free. Returns seconds waited."""
        waited = 0.0
        while True:
            with self._lock:
                now = time.time()
                while self._calls and self._calls[0] <= now - 60:
                    self._calls.popleft()
                if len(self._calls) < self.per_minute:
                    self._calls.append(now)
                    return waited
                wait = 60 - (now - self._calls[0]) + 0.1
            hook = on_wait.get()
            if hook:
                try:
                    hook(round(wait, 1))
                except Exception:
                    pass
            time.sleep(wait)
            waited += wait

    def penalise(self, seconds: float) -> None:
        """After a 429, block new calls for `seconds` by filling the window."""
        with self._lock:
            until = time.time() + seconds - 60
            self._calls = deque([until] * self.per_minute)


_limiter = SlidingWindowLimiter(int(os.getenv("LLM_RPM", "5")))


def acquire_slot() -> float:
    if _factory is not None or demo_mode():      # fakes are free
        return 0.0
    return _limiter.acquire()


# =============================================================================
# FACTORY
# =============================================================================

def set_llm_factory(factory: Optional[Callable[[float], Any]]) -> None:
    """Override how LLMs are built (pass None to restore the real one)."""
    global _factory
    _factory = factory


def demo_mode() -> bool:
    return os.getenv("LLM_MOCK", "").strip().lower() in ("1", "true", "yes", "on")


_demo_script: dict = {}


def get_llm(temperature: float = 0.2):
    if _factory is not None:
        return _factory(temperature)
    if demo_mode():
        from agents.mock_llm import FakeLLM
        return FakeLLM(temperature, _demo_script, latency=(0.8, 2.2))
    if not os.getenv("GOOGLE_API_KEY"):
        raise RuntimeError("GOOGLE_API_KEY is not set. Add it to your .env file.")
    return ResilientChat(temperature)


# =============================================================================
# MODEL FAILOVER
# =============================================================================
# Free-tier quotas are per model and per day. ResilientChat walks a chain of
# models (LLM_MODEL first, then LLM_FALLBACK_MODELS); when one hits its daily
# quota or is unavailable, it's skipped until the next UTC day.

_exhausted: dict[str, str] = {}          # model → UTC date it was exhausted
_exhausted_lock = threading.Lock()
_clients: dict[tuple[str, float], Any] = {}


def model_chain() -> list[str]:
    from config import LLM_FALLBACK_MODELS, LLM_MODEL
    seen, out = set(), []
    for m in [LLM_MODEL, *LLM_FALLBACK_MODELS]:
        if m and m not in seen:
            seen.add(m)
            out.append(m)
    return out


def _today() -> str:
    return time.strftime("%Y-%m-%d", time.gmtime())


def available_models() -> list[str]:
    today = _today()
    with _exhausted_lock:
        return [m for m in model_chain() if _exhausted.get(m) != today]


def model_status() -> dict:
    avail = available_models()
    return {"chain": model_chain(), "active": avail[0] if avail else None,
            "exhausted": [m for m in model_chain() if m not in avail], "demo": demo_mode()}


def _is_daily_or_unavailable(err: Exception) -> bool:
    s = str(err)
    return ("PerDay" in s or "per day" in s.lower() or "404" in s or "NotFound" in s
            or "no longer available" in s or "not found for API version" in s)


def _client(model: str, temperature: float):
    key = (model, temperature)
    if key not in _clients:
        from langchain_google_genai import ChatGoogleGenerativeAI
        _clients[key] = ChatGoogleGenerativeAI(
            model=model, temperature=temperature, google_api_key=os.getenv("GOOGLE_API_KEY"),
            max_retries=0,     # retries are handled (rate-limit aware) in invoke_with_retry
            timeout=120,
        )
    return _clients[key]


class ResilientChat:
    """Duck-types the bits of a LangChain chat model we use, with model failover."""

    def __init__(self, temperature: float):
        self.temperature = temperature

    def _call(self, fn: Callable[[Any], Any]):
        last: Exception | None = None
        for model in available_models():
            try:
                return fn(_client(model, self.temperature))
            except Exception as e:
                if _is_daily_or_unavailable(e):
                    print(f"[LLM] {model} unavailable/exhausted today — failing over")
                    with _exhausted_lock:
                        _exhausted[model] = _today()
                    last = e
                    continue
                raise
        raise RuntimeError("Daily Gemini quota exhausted on every configured model "
                           f"({', '.join(model_chain())}). Try again tomorrow or use a paid API key.") from last

    def invoke(self, messages):
        return self._call(lambda m: m.invoke(messages))

    def stream(self, messages):
        models = available_models()
        if not models:
            raise RuntimeError("Daily Gemini quota exhausted on every configured model.")
        yield from _client(models[0], self.temperature).stream(messages)

    def with_structured_output(self, schema):
        from langchain_core.runnables import RunnableLambda
        return RunnableLambda(lambda x: self._call(lambda m: m.with_structured_output(schema).invoke(x)))


def structured(schema: Type[BaseModel], temperature: float = 0.2):
    return get_llm(temperature).with_structured_output(schema)


# =============================================================================
# RETRYING INVOKE
# =============================================================================

_RETRY_HINT = re.compile(r"retry in ([\d.]+)s|seconds:\s*(\d+)", re.I)


def _is_rate_limit(err: Exception) -> bool:
    s = str(err)
    return "429" in s or "RESOURCE_EXHAUSTED" in s or "quota" in s.lower()


def _retry_after(err: Exception) -> float:
    m = _RETRY_HINT.search(str(err))
    if m:
        return min(70.0, float(m.group(1) or m.group(2)) + 1)
    return 30.0


def invoke_with_retry(chain, inputs: Any, attempts: int = 4, schema: Type[BaseModel] | None = None):
    """Invokes a runnable under the rate limiter, retrying on transient errors,
    429s (honouring the server's retry hint) and empty structured results."""
    last_err: Exception | None = None
    for i in range(attempts):
        try:
            acquire_slot()
            out = chain.invoke(inputs)
            if schema is not None:
                if out is None:
                    raise ValueError("model returned no structured output")
                data = out if isinstance(out, dict) else out.model_dump()
                out = schema.model_validate(scrub_dashes(data))
            return out
        except Exception as e:  # rate limits, safety blocks, malformed JSON...
            last_err = e
            if i == attempts - 1:
                break
            if "quota exhausted on every configured model" in str(e):
                break
            if _is_rate_limit(e):
                delay = _retry_after(e)
                if "PerDay" in str(e) or "per day" in str(e).lower():
                    raise RuntimeError("Daily Gemini quota exhausted for this API key. "
                                       "Try again tomorrow or use a paid key.") from e
                print(f"[LLM] rate limited — retrying in {delay:.0f}s")
                _limiter.penalise(delay)
                hook = on_wait.get()
                if hook:
                    try:
                        hook(round(delay, 1))
                    except Exception:
                        pass
            else:
                delay = 1.5 * (2 ** i)
                print(f"[LLM] attempt {i + 1}/{attempts} failed: {str(e)[:200]}")
                time.sleep(delay)
    raise RuntimeError(f"LLM call failed after {attempts} attempts: {str(last_err)[:300]}")


_EM_DASH = re.compile(r"\s*—\s*|\s+–\s+")


def scrub_dashes(obj: Any) -> Any:
    """Replaces em-dashes (and spaced en-dashes) in model text with commas. House style: no em-dashes."""
    if isinstance(obj, str):
        return _EM_DASH.sub(", ", obj)
    if isinstance(obj, dict):
        return {k: scrub_dashes(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [scrub_dashes(v) for v in obj]
    return obj


def text_of(message) -> str:
    """Normalises AIMessage.content (str or list of parts) to a string."""
    content = getattr(message, "content", message)
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return "".join(p.get("text", "") if isinstance(p, dict) else str(p) for p in content)
    return str(content)
