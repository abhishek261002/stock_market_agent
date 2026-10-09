# =============================================================================
# config.py
# =============================================================================
# Central settings read from environment variables (.env).
# .NET ANALOGY: this is appsettings.json bound to an IOptions<Settings> class.
# =============================================================================

import os
from dotenv import load_dotenv

load_dotenv()

BASE_DIR = os.path.dirname(os.path.abspath(__file__))


def _int(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, default))
    except ValueError:
        return default


def _bool(name: str, default: bool) -> bool:
    return os.getenv(name, str(default)).strip().lower() in ("1", "true", "yes", "on")


# --- LLM ---------------------------------------------------------------------
LLM_MODEL       = os.getenv("LLM_MODEL", "gemini-3.6-flash")
# Tried in order when the primary model hits its (per-model, per-day) quota or is unavailable
LLM_FALLBACK_MODELS = [m.strip() for m in os.getenv(
    "LLM_FALLBACK_MODELS", "gemini-3.5-flash,gemini-3.8-flash,gemini-3.1-flash-lite"
).split(",") if m.strip()]
GOOGLE_API_KEY  = os.getenv("GOOGLE_API_KEY")

# --- Debate ------------------------------------------------------------------
DEBATE_ROUNDS     = _int("DEBATE_ROUNDS", 2)   # default rounds (opening + rebuttals)
MAX_DEBATE_ROUNDS = 4                          # hard cap a client can request

# --- Storage -----------------------------------------------------------------
DB_PATH = os.getenv("DB_PATH", os.path.join(BASE_DIR, "storage", "screener.db"))

# --- API ---------------------------------------------------------------------
CORS_ORIGINS = [o.strip() for o in os.getenv(
    "CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173"
).split(",") if o.strip()]
ANALYSE_RATE_LIMIT_PER_MIN = _int("ANALYSE_RATE_LIMIT_PER_MIN", 10)

# --- Scheduler ---------------------------------------------------------------
SCHEDULER_ENABLED         = _bool("SCHEDULER_ENABLED", True)
WATCHLIST_REFRESH_HOUR    = _int("WATCHLIST_REFRESH_HOUR", 16)    # IST, after market close
WATCHLIST_REFRESH_MINUTE  = _int("WATCHLIST_REFRESH_MINUTE", 15)
PRICE_ALERT_INTERVAL_SEC  = _int("PRICE_ALERT_INTERVAL_SEC", 600)

DISCLAIMER = (
    "AI-generated research for educational purposes only. Not investment advice and not a "
    "recommendation by a SEBI-registered research analyst. Markets carry risk; do your own research."
)
