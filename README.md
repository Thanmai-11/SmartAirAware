# SmartAirAware

Intelligent HVAC scheduling and indoor air quality (IAQ) optimization engine for a commercial building in Delhi. Every hour it fetches a 48-hour weather + PM2.5 forecast, runs four EnergyPlus building energy simulations in parallel, solves a CP-SAT optimization problem to find the best 24-hour mode schedule, and publishes results via a REST API and web dashboard.

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│  worker/main.py  (APScheduler — runs at :05 every hour) │
│    └─ worker/pipeline.py  (end-to-end pipeline)         │
├─────────────────────────────────────────────────────────┤
│  backend/app.py  (FastAPI REST API — port 8000)         │
├─────────────────────────────────────────────────────────┤
│  frontend/       (React + Vite dashboard — port 5173)   │
└─────────────────────────────────────────────────────────┘
         │                    │
    engine/              db/ (SQLite)
    ingest, epw_builder,  models, seed,
    idf_builder, runner,  session
    parser, iaq, mask,
    optimizer, verify,
    outputs
```

### Four HVAC Modes

| Mode | Cooling Setpoint | OA Multiplier | Intent |
|---|---|---|---|
| Ventilate | 24.0 °C | 1.5× | Flush IAQ |
| Maintain | 24.5 °C | 1.0× | Normal baseline |
| Reduce HVAC | 26.5 °C | 0.6× | Peak demand reduction |
| Shift Load | 23.0 °C | 0.8× | Pre-cool before peak |

---

## Prerequisites

- **Python 3.11+**
- **EnergyPlus 26.2.0** installed at `/Applications/EnergyPlus-26-2-0` (macOS) or equivalent
- **Node.js 18+** and npm (for the frontend)

---

## Setup

### 1. Clone and create virtual environment

```bash
git clone <repo-url>
cd SmartAirAware
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

### 2. Configure environment

```bash
cp .env.example .env
```

Edit `.env` and set at minimum:

```
ENERGYPLUS_DIR=/Applications/EnergyPlus-26-2-0
ENERGYPLUS_IDD=/Applications/EnergyPlus-26-2-0/Energy+.idd
ADMIN_KEY=<generate with: python -c "import secrets; print(secrets.token_hex(32))">
```

### 3. Seed the database

```bash
python -m db.seed
```

### 4. Start the API server

```bash
uvicorn backend.app:app --host 0.0.0.0 --port 8000 --reload
```

### 5. Start the worker

In a separate terminal:

```bash
python -m worker.main
```

The worker runs a pipeline immediately at :05 of every hour and also polls every 10 seconds for manually queued runs (triggered via `POST /api/run`).

### 6. Start the frontend

```bash
cd frontend
npm install
npm run dev
```

Open **http://localhost:5173** (or the next available port) in your browser.

---

## Running Tests

```bash
pytest tests/ -v
```

All 15 tests should pass. Tests use an in-memory SQLite database and mock out EnergyPlus calls.

Set `FORECAST_SOURCE=fixture` in `.env` (or the test already sets it automatically via `conftest.py`) to avoid live API calls during testing.

---

## API Endpoints

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/health` | — | Health check |
| GET | `/api/schedule/latest` | — | Latest 24-hour schedule + KPI summary |
| GET | `/api/schedule/latest.csv` | — | CSV download |
| GET | `/api/forecast/latest` | — | Latest 48-hour forecast |
| GET | `/api/kpis/latest` | — | KPIs for latest run |
| GET | `/api/runs` | — | Run history (last 50) |
| GET | `/api/settings` | — | Read optimizer settings |
| PUT | `/api/settings` | ✓ | Update settings |
| GET | `/api/occupancy` | — | Read occupancy profile |
| PUT | `/api/occupancy` | ✓ | Update occupancy profile |
| POST | `/api/run` | ✓ | Manually queue a pipeline run |

Admin endpoints require the `X-Admin-Key` header set to the value of `ADMIN_KEY` in `.env`.

---

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `ENERGYPLUS_DIR` | *(required)* | Path to EnergyPlus installation directory |
| `ENERGYPLUS_IDD` | *(required)* | Path to `Energy+.idd` file |
| `DB_PATH` | `./data/smartair.db` | SQLite database path |
| `RUNS_DIR` | `./runs` | Directory for EnergyPlus run outputs |
| `ADMIN_KEY` | *(required)* | Secret key for admin API operations |
| `FORECAST_SOURCE` | `live` | `live` or `fixture` |
| `FIXTURE_PATH` | `./data/fixtures` | Path to fixture JSON files (offline testing) |
| `TIMEZONE` | `Asia/Kolkata` | Local timezone for pipeline scheduling |
| `SIM_TIMEOUT_S` | `300` | EnergyPlus simulation timeout (seconds) |
| `PIPELINE_TIMEOUT_S` | `900` | Total pipeline timeout (seconds) |
| `CORS_ORIGINS` | `http://localhost:3000,http://localhost:5173` | Allowed CORS origins (comma-separated) |
