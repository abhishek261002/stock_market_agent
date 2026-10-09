# =============================================================================
# data/universe.py
# =============================================================================
# The investable universe the screener scans, plus index symbols for the
# market overview. Large/mid caps from the Nifty 50 and Nifty Next 50, with
# normalised sector labels so the UI can group and colour them consistently.
#
# Symbols are Yahoo Finance tickers (.NS = NSE). Tickers that Yahoo stops
# serving are skipped automatically at scan time, so a stale entry is harmless.
# =============================================================================

UNIVERSE: list[dict] = [
    # --- IT ---
    {"symbol": "TCS.NS",        "name": "Tata Consultancy Services", "sector": "IT"},
    {"symbol": "INFY.NS",       "name": "Infosys",                   "sector": "IT"},
    {"symbol": "HCLTECH.NS",    "name": "HCL Technologies",          "sector": "IT"},
    {"symbol": "WIPRO.NS",      "name": "Wipro",                     "sector": "IT"},
    {"symbol": "TECHM.NS",      "name": "Tech Mahindra",             "sector": "IT"},
    {"symbol": "PERSISTENT.NS", "name": "Persistent Systems",        "sector": "IT"},
    {"symbol": "COFORGE.NS",    "name": "Coforge",                   "sector": "IT"},
    # --- Banking ---
    {"symbol": "HDFCBANK.NS",   "name": "HDFC Bank",                 "sector": "Banking"},
    {"symbol": "ICICIBANK.NS",  "name": "ICICI Bank",                "sector": "Banking"},
    {"symbol": "SBIN.NS",       "name": "State Bank of India",       "sector": "Banking"},
    {"symbol": "KOTAKBANK.NS",  "name": "Kotak Mahindra Bank",       "sector": "Banking"},
    {"symbol": "AXISBANK.NS",   "name": "Axis Bank",                 "sector": "Banking"},
    {"symbol": "INDUSINDBK.NS", "name": "IndusInd Bank",             "sector": "Banking"},
    {"symbol": "BANKBARODA.NS", "name": "Bank of Baroda",            "sector": "Banking"},
    {"symbol": "PNB.NS",        "name": "Punjab National Bank",      "sector": "Banking"},
    {"symbol": "CANBK.NS",      "name": "Canara Bank",               "sector": "Banking"},
    # --- Financial Services ---
    {"symbol": "BAJFINANCE.NS", "name": "Bajaj Finance",             "sector": "Financial Services"},
    {"symbol": "BAJAJFINSV.NS", "name": "Bajaj Finserv",             "sector": "Financial Services"},
    {"symbol": "SHRIRAMFIN.NS", "name": "Shriram Finance",           "sector": "Financial Services"},
    {"symbol": "JIOFIN.NS",     "name": "Jio Financial Services",    "sector": "Financial Services"},
    {"symbol": "CHOLAFIN.NS",   "name": "Cholamandalam Investment",  "sector": "Financial Services"},
    {"symbol": "PFC.NS",        "name": "Power Finance Corp",        "sector": "Financial Services"},
    {"symbol": "RECLTD.NS",     "name": "REC Ltd",                   "sector": "Financial Services"},
    {"symbol": "MUTHOOTFIN.NS", "name": "Muthoot Finance",           "sector": "Financial Services"},
    # --- Insurance ---
    {"symbol": "HDFCLIFE.NS",   "name": "HDFC Life Insurance",       "sector": "Insurance"},
    {"symbol": "SBILIFE.NS",    "name": "SBI Life Insurance",        "sector": "Insurance"},
    {"symbol": "ICICIGI.NS",    "name": "ICICI Lombard",             "sector": "Insurance"},
    # --- Energy ---
    {"symbol": "RELIANCE.NS",   "name": "Reliance Industries",       "sector": "Energy"},
    {"symbol": "ONGC.NS",       "name": "Oil & Natural Gas Corp",    "sector": "Energy"},
    {"symbol": "BPCL.NS",       "name": "Bharat Petroleum",          "sector": "Energy"},
    {"symbol": "IOC.NS",        "name": "Indian Oil Corp",           "sector": "Energy"},
    {"symbol": "GAIL.NS",       "name": "GAIL (India)",              "sector": "Energy"},
    {"symbol": "COALINDIA.NS",  "name": "Coal India",                "sector": "Energy"},
    # --- Power & Utilities ---
    {"symbol": "NTPC.NS",       "name": "NTPC",                      "sector": "Power & Utilities"},
    {"symbol": "POWERGRID.NS",  "name": "Power Grid Corp",           "sector": "Power & Utilities"},
    {"symbol": "TATAPOWER.NS",  "name": "Tata Power",                "sector": "Power & Utilities"},
    {"symbol": "ADANIGREEN.NS", "name": "Adani Green Energy",        "sector": "Power & Utilities"},
    # --- Auto ---
    {"symbol": "MARUTI.NS",     "name": "Maruti Suzuki",             "sector": "Auto"},
    {"symbol": "M&M.NS",        "name": "Mahindra & Mahindra",       "sector": "Auto"},
    {"symbol": "TMPV.NS",       "name": "Tata Motors Passenger Vehicles", "sector": "Auto"},
    {"symbol": "TMCV.NS",       "name": "Tata Motors Commercial Vehicles", "sector": "Auto"},
    {"symbol": "BAJAJ-AUTO.NS", "name": "Bajaj Auto",                "sector": "Auto"},
    {"symbol": "EICHERMOT.NS",  "name": "Eicher Motors",             "sector": "Auto"},
    {"symbol": "HEROMOTOCO.NS", "name": "Hero MotoCorp",             "sector": "Auto"},
    {"symbol": "TVSMOTOR.NS",   "name": "TVS Motor",                 "sector": "Auto"},
    # --- FMCG ---
    {"symbol": "HINDUNILVR.NS", "name": "Hindustan Unilever",        "sector": "FMCG"},
    {"symbol": "ITC.NS",        "name": "ITC",                       "sector": "FMCG"},
    {"symbol": "NESTLEIND.NS",  "name": "Nestle India",              "sector": "FMCG"},
    {"symbol": "BRITANNIA.NS",  "name": "Britannia Industries",      "sector": "FMCG"},
    {"symbol": "TATACONSUM.NS", "name": "Tata Consumer Products",    "sector": "FMCG"},
    {"symbol": "DABUR.NS",      "name": "Dabur India",               "sector": "FMCG"},
    {"symbol": "GODREJCP.NS",   "name": "Godrej Consumer Products",  "sector": "FMCG"},
    # --- Pharma & Healthcare ---
    {"symbol": "SUNPHARMA.NS",  "name": "Sun Pharmaceutical",        "sector": "Pharma & Healthcare"},
    {"symbol": "DRREDDY.NS",    "name": "Dr. Reddy's Laboratories",  "sector": "Pharma & Healthcare"},
    {"symbol": "CIPLA.NS",      "name": "Cipla",                     "sector": "Pharma & Healthcare"},
    {"symbol": "DIVISLAB.NS",   "name": "Divi's Laboratories",       "sector": "Pharma & Healthcare"},
    {"symbol": "APOLLOHOSP.NS", "name": "Apollo Hospitals",          "sector": "Pharma & Healthcare"},
    {"symbol": "ZYDUSLIFE.NS",  "name": "Zydus Lifesciences",        "sector": "Pharma & Healthcare"},
    {"symbol": "MAXHEALTH.NS",  "name": "Max Healthcare",            "sector": "Pharma & Healthcare"},
    # --- Metals ---
    {"symbol": "TATASTEEL.NS",  "name": "Tata Steel",                "sector": "Metals"},
    {"symbol": "JSWSTEEL.NS",   "name": "JSW Steel",                 "sector": "Metals"},
    {"symbol": "HINDALCO.NS",   "name": "Hindalco Industries",       "sector": "Metals"},
    {"symbol": "VEDL.NS",       "name": "Vedanta",                   "sector": "Metals"},
    # --- Cement & Materials ---
    {"symbol": "ULTRACEMCO.NS", "name": "UltraTech Cement",          "sector": "Cement & Materials"},
    {"symbol": "GRASIM.NS",     "name": "Grasim Industries",         "sector": "Cement & Materials"},
    {"symbol": "AMBUJACEM.NS",  "name": "Ambuja Cements",            "sector": "Cement & Materials"},
    {"symbol": "ASIANPAINT.NS", "name": "Asian Paints",              "sector": "Cement & Materials"},
    {"symbol": "PIDILITIND.NS", "name": "Pidilite Industries",       "sector": "Cement & Materials"},
    # --- Infrastructure & Capital Goods ---
    {"symbol": "LT.NS",         "name": "Larsen & Toubro",           "sector": "Capital Goods"},
    {"symbol": "BEL.NS",        "name": "Bharat Electronics",        "sector": "Capital Goods"},
    {"symbol": "HAL.NS",        "name": "Hindustan Aeronautics",     "sector": "Capital Goods"},
    {"symbol": "SIEMENS.NS",    "name": "Siemens",                   "sector": "Capital Goods"},
    {"symbol": "ADANIENT.NS",   "name": "Adani Enterprises",         "sector": "Capital Goods"},
    {"symbol": "ADANIPORTS.NS", "name": "Adani Ports & SEZ",         "sector": "Capital Goods"},
    {"symbol": "HAVELLS.NS",    "name": "Havells India",             "sector": "Capital Goods"},
    {"symbol": "POLYCAB.NS",    "name": "Polycab India",             "sector": "Capital Goods"},
    # --- Consumer & Retail ---
    {"symbol": "TITAN.NS",      "name": "Titan Company",             "sector": "Consumer"},
    {"symbol": "TRENT.NS",      "name": "Trent",                     "sector": "Consumer"},
    {"symbol": "DMART.NS",      "name": "Avenue Supermarts (DMart)", "sector": "Consumer"},
    {"symbol": "ETERNAL.NS",    "name": "Eternal (Zomato)",          "sector": "Consumer"},
    {"symbol": "NAUKRI.NS",     "name": "Info Edge (Naukri)",        "sector": "Consumer"},
    {"symbol": "INDIGO.NS",     "name": "InterGlobe Aviation",       "sector": "Consumer"},
    {"symbol": "IRCTC.NS",      "name": "IRCTC",                     "sector": "Consumer"},
    {"symbol": "DIXON.NS",      "name": "Dixon Technologies",        "sector": "Consumer"},
    # --- Telecom ---
    {"symbol": "BHARTIARTL.NS", "name": "Bharti Airtel",             "sector": "Telecom"},
    # --- Realty ---
    {"symbol": "DLF.NS",        "name": "DLF",                       "sector": "Realty"},
    {"symbol": "LODHA.NS",      "name": "Macrotech Developers (Lodha)", "sector": "Realty"},
]

INDICES: list[dict] = [
    {"symbol": "^NSEI",     "name": "NIFTY 50"},
    {"symbol": "^BSESN",    "name": "SENSEX"},
    {"symbol": "^NSEBANK",  "name": "NIFTY BANK"},
    {"symbol": "^CNXIT",    "name": "NIFTY IT"},
    {"symbol": "^NSEMDCP50", "name": "NIFTY MIDCAP 50"},
    {"symbol": "USDINR=X",  "name": "USD / INR"},
]

BENCHMARK = "^NSEI"

_BY_SYMBOL = {u["symbol"]: u for u in UNIVERSE}


def universe_symbols() -> list[str]:
    return [u["symbol"] for u in UNIVERSE]


def lookup(symbol: str) -> dict | None:
    return _BY_SYMBOL.get(symbol.upper())


def sector_of(symbol: str) -> str | None:
    u = lookup(symbol)
    return u["sector"] if u else None


def peers_of(symbol: str, limit: int = 5) -> list[str]:
    """Other universe members in the same sector (order = list order ≈ size)."""
    sec = sector_of(symbol)
    if not sec:
        return []
    return [u["symbol"] for u in UNIVERSE if u["sector"] == sec and u["symbol"] != symbol.upper()][:limit]


def normalise_symbol(raw: str) -> str:
    """'infy' → 'INFY.NS'; keeps explicit .NS/.BO suffixes and index symbols."""
    s = raw.strip().upper()
    if not s:
        return s
    if s.startswith("^") or "." in s or "=" in s:
        return s
    return f"{s}.NS"


def search_universe(query: str, limit: int = 8) -> list[dict]:
    q = query.strip().upper()
    if not q:
        return []
    scored = []
    for u in UNIVERSE:
        sym = u["symbol"].split(".")[0]
        name = u["name"].upper()
        if sym == q:
            score = 0
        elif sym.startswith(q):
            score = 1
        elif name.startswith(q):
            score = 2
        elif q in sym or q in name:
            score = 3
        else:
            continue
        scored.append((score, u))
    scored.sort(key=lambda x: x[0])
    return [u for _, u in scored[:limit]]
