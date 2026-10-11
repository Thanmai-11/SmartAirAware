# SmartAirAware

**Cleaner indoor air without a runaway energy bill.** SmartAirAware is an HVAC scheduling engine for commercial buildings in Delhi. Every hour it reads a 48-hour weather and PM2.5 forecast, simulates the building under four HVAC modes, and picks the best 24-hour schedule so the building flushes out pollution when the outdoor air allows it and saves energy when it doesn't.

> Built for **Environmental Hacks** (Bharat Builds Tour, Oct 8-11 2026) · Track: **Air → Indoor air**

---

## The problem

People spend most of their day indoors, but indoor air in a polluted city is mostly decided by one choice: how much outside air the HVAC lets in.

- Let in **more** outside air and you dilute indoor CO₂ and odours, but on a bad-AQI day you also pull in PM2.5.
- Let in **less** and the building stays cleaner from outdoor pollution, but stale air builds up and the cooling load changes.
- Most buildings run a fixed schedule that ignores both the forecast and the pollution.

For example, the live forecast for Delhi on 11 Oct 2026 showed PM2.5 of roughly 55-70 µg/m³ (US AQI around 160) through the evening and night. A fixed schedule can't react to that.

## Who it's for

Facility managers of offices, campuses and other commercial buildings who want to protect occupants' air quality and cut cooling energy, without hiring a building-simulation expert. They open the dashboard, see the next 24 hours of recommended modes, and follow the schedule.

## What it does

1. **Fetches** a 48-hour temperature, humidity, dewpoint and PM2.5 forecast for Delhi from Open-Meteo (no API key needed).
2. **Simulates** the building with EnergyPlus under four HVAC modes, in parallel.
3. **Computes** an indoor air quality (IAQ) score for each mode and hour, accounting for outdoor PM2.5, ventilation and occupancy.
4. **Optimizes** a 24-hour mode schedule with Google OR-Tools CP-SAT, balancing energy, comfort and IAQ, and penalising rapid mode switching.
5. **Verifies** the schedule by running a fifth full simulation to confirm the combined plan holds up.
6. **Publishes** the schedule, KPIs and forecast through a REST API and a React dashboard. It re-runs automatically at :05 every hour.

### Four HVAC modes

| Mode | Cooling Setpoint | OA Multiplier | Intent |
|---|---|---|---|
| Ventilate | 24.0 °C | 1.5× | Flush IAQ |
| Maintain | 24.5 °C | 1.0× | Normal baseline |
| Reduce HVAC | 26.5 °C | 0.6× | Peak demand reduction |
| Shift Load | 23.0 °C | 0.8× | Pre-cool before peak |

### What the dashboard shows

- The recommended mode for each of the next 24 hours, as a timeline.
- KPIs for the run: energy use, comfort and indoor air quality.
- Energy chart and a forecast strip with temperature, humidity and PM2.5.
- Run history, plus settings and occupancy controls for the building.

The pipeline has been run end to end on live Delhi data: forecast fetched, four simulations run in parallel, schedule optimized, a fifth simulation run to verify it, and the results stored and served through the API.

---

## Built for AWS

SmartAirAware is designed to run on AWS:

| Layer | AWS service / tool |
|---|---|
| Compute | **Amazon EC2** (t3.medium, Ubuntu 22.04) runs the API, the hourly worker and EnergyPlus |
| Networking | **Elastic IP**, with **nginx** as the reverse proxy and static frontend host |
| Process management | **systemd** units for the API and worker (`deploy/`) |

The full deployment is scripted in [`deploy/`](deploy/) (`setup.sh`, `nginx.conf`, `smartair-api.service`, `smartair-worker.service`) and documented step by step in [`docs/RUNBOOK.md`](docs/RUNBOOK.md).

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

**Stack:** Python 3.11 · FastAPI · SQLAlchemy/SQLite · APScheduler · EnergyPlus 26.2.0 · OR-Tools CP-SAT · React · Vite · Recharts · nginx · AWS EC2

---

## Run it locally

### Prerequisites

- **Python 3.11+**
- **EnergyPlus 26.2.0** (pinned) installed at `/Applications/EnergyPlus-26-2-0` (macOS) or equivalent
- **Node.js 18+** and npm (for the frontend)

> **Other platforms:** The EnergyPlus path above is for macOS. For Windows or Linux (including the EC2 deployment), see the examples in `.env.example` and the steps in `docs/RUNBOOK.md`.

### 1. Clone and create a virtual environment

```bash
git clone https://github.com/Thanmai-11/SmartAirAware.git
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

### No EnergyPlus or internet? Use fixtures

Set `FORECAST_SOURCE=fixture` in `.env` to run on frozen forecasts from `data/fixtures/` (`default`, `clean_air`, `high_pm25`, `hot_day`). This is handy for demoing how the schedule changes on a clean-air day versus a high-pollution day.

---

## Running tests

```bash
pytest tests/ -v
```

All 15 tests should pass. Tests use an in-memory SQLite database and mock out EnergyPlus calls. `conftest.py` sets `FORECAST_SOURCE=fixture` automatically, so no live API calls are made.

We also checked the stored forecast against the live Open-Meteo API: temperature, humidity, dewpoint and PM2.5 matched exactly.

---

## API endpoints

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
| POST | `/api/occupancy/csv` | ✓ | Upload occupancy profile as CSV |
| POST | `/api/upload-energy` | ✓ | Upload building energy records (CSV) |
| POST | `/api/run` | ✓ | Manually queue a pipeline run |
| DELETE | `/api/runs/failed` | ✓ | Clear all failed runs from history |
| DELETE | `/api/runs/all` | ✓ | Clear the entire run history (irreversible) |

Admin endpoints require the `X-Admin-Key` header set to the value of `ADMIN_KEY` in `.env`.

---

## Environment variables

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

---
## Screenshots
![Dashboard KPIs and mode timeline]<img width="1253" height="623" alt="1" src="https://github.com/user-attachments/assets/6887f989-a06d-4ff0-9b0e-6d0cb0fb8f64" />

![Forecast and schedule]<img width="1253" height="623" alt="2" src="https://github.com/user-attachments/assets/1ec035d1-5c15-4c47-a60e-2a3d21fa2174" />

![Hourly schedule]<img width="1253" height="623" alt="3" src="https://github.com/user-attachments/assets/afa927be-9d0c-4158-82f7-34594337fed8" />

![Optimizer settings]<img width="1253" height="623" alt="4" src="https://github.com/user-attachments/assets/df2e8e27-05b8-427b-af7d-5f51287b8f91" />

![Occupancy profile]<img width="1253" height="623" alt="5" src="https://github.com/user-attachments/assets/b3963fec-4b65-47d1-8a3d-a275eaab504c" />



## Data sources

- **Weather and air quality:** [Open-Meteo](https://open-meteo.com/) forecast and air-quality APIs, for New Delhi (28.6139° N, 77.2090° E).
- **Building model:** an EnergyPlus IDF (`data/building.idf`) with a Delhi weather file (`data/base_delhi.epw`).

## What's next

- Support multiple buildings and cities.
- Push alerts to facility managers when a high-pollution night is forecast.
- Calibrate the building model with real meter data via `/api/upload-energy`.
