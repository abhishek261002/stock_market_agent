# Arena

AI stock research for NSE/BSE. Educational only, not investment advice.

## Requirements

- Python 3.12
- Node.js 20+
- A Gemini API key from https://aistudio.google.com/apikey

## Setup

```bash
git clone https://github.com/abhishek261002/stock_market_agent.git
cd stock_market_agent

# Backend
python -m venv venv
venv\Scripts\activate          # macOS/Linux: source venv/bin/activate
pip install -r requirements.txt
copy .env.example .env         # macOS/Linux: cp .env.example .env
# edit .env and set GOOGLE_API_KEY

# Frontend
cd frontend
npm install
```

## Run

Backend (project root, venv active):

```bash
uvicorn api.main:app --port 8000
```

Frontend (second terminal):

```bash
cd frontend
npm run dev
```

Open http://localhost:5173.

Set `LLM_MOCK=1` in `.env` to try the app without using Gemini quota. Run tests with `python -m pytest tests -q`.
