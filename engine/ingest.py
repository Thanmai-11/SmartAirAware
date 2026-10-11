import os
import json
import time
from typing import Tuple, List, Dict, Any, Optional
import httpx
from sqlalchemy.orm import Session
from db.models import Run, Forecast

OPEN_METEO_WEATHER_URL = "https://api.open-meteo.com/v1/forecast"
OPEN_METEO_AQ_URL = "https://air-quality-api.open-meteo.com/v1/air-quality"

def _fetch_with_retries(client: httpx.Client, url: str, params: dict, max_retries: int = 3) -> dict:
    for attempt in range(max_retries):
        try:
            resp = client.get(url, params=params)
            resp.raise_for_status()
            return resp.json()
        except (httpx.HTTPError, httpx.TimeoutException) as exc:
            if attempt == max_retries - 1:
                raise exc
            time.sleep(0.5 * (2 ** attempt))
    raise RuntimeError("Unexpected retry loop termination")

def _load_fixture(fixture_path: str) -> List[Dict[str, Any]]:
    if os.path.isdir(fixture_path):
        target = os.path.join(fixture_path, "default.json")
        if not os.path.exists(target):
            target = os.path.join(fixture_path, "clean_air.json")
    else:
        target = fixture_path

    if not os.path.exists(target):
        raise FileNotFoundError(f"Fixture file not found at {target}")

    with open(target, "r", encoding="utf-8") as f:
        data = json.load(f)

    if isinstance(data, list):
        return data
    elif isinstance(data, dict) and "hourly" in data:
        # Raw open meteo dictionary
        times = data["hourly"].get("time", [])
        temps = data["hourly"].get("temperature_2m", [0.0] * len(times))
        rhs = data["hourly"].get("relative_humidity_2m", [0.0] * len(times))
        dews = data["hourly"].get("dew_point_2m", [0.0] * len(times))
        pm25s = data["hourly"].get("pm2_5", [0.0] * len(times))
        aqis = data["hourly"].get("us_aqi", [0] * len(times))
        
        result = []
        for i, t in enumerate(times):
            result.append({
                "hour_utc": t,
                "temp_c": float(temps[i]),
                "rh_pct": float(rhs[i]),
                "dewpoint_c": float(dews[i]),
                "pm25": float(pm25s[i]),
                "us_aqi": int(aqis[i]) if aqis[i] is not None else 0
            })
        return result
    else:
        raise ValueError(f"Unrecognized fixture format in {target}")

def _get_stale_forecast(db: Optional[Session]) -> List[Dict[str, Any]]:
    if not db:
        raise RuntimeError("No database session provided to retrieve stale forecast")
    
    last_success_run = (
        db.query(Run)
        .filter(Run.status == "success")
        .order_by(Run.started_utc.desc())
        .first()
    )
    if not last_success_run:
        raise RuntimeError("No previous successful run available to provide fallback forecast")

    forecast_rows = (
        db.query(Forecast)
        .filter(Forecast.run_id == last_success_run.id)
        .order_by(Forecast.hour_utc.asc())
        .all()
    )
    if not forecast_rows:
        raise RuntimeError(f"Run {last_success_run.id} has no forecast records")

    return [
        {
            "hour_utc": r.hour_utc.strftime("%Y-%m-%dT%H:00"),
            "temp_c": r.temp_c,
            "rh_pct": r.rh_pct,
            "dewpoint_c": r.dewpoint_c,
            "pm25": r.pm25,
            "us_aqi": r.us_aqi or 0
        }
        for r in forecast_rows
    ]

def ingest_forecast(
    db: Optional[Session] = None,
    lat: float = 28.6139,
    lon: float = 77.2090,
    forecast_source: Optional[str] = None,
    fixture_path: Optional[str] = None
) -> Tuple[List[Dict[str, Any]], bool]:
    """
    Ingests weather and air quality forecast.
    Returns (forecast_list, is_stale).
    """
    source = forecast_source or os.getenv("FORECAST_SOURCE", "live")
    fix_path = fixture_path or os.getenv("FIXTURE_PATH", "./data/fixtures")

    if source.lower() == "fixture":
        data = _load_fixture(fix_path)
        return data, False

    # Live call with retries
    try:
        with httpx.Client(timeout=10.0) as client:
            weather_data = _fetch_with_retries(
                client,
                OPEN_METEO_WEATHER_URL,
                {
                    "latitude": lat,
                    "longitude": lon,
                    # "dewpoint_2m" is the correct Open-Meteo weather API variable name;
                    # "dew_point_2m" is only available in the air-quality API.
                    "hourly": "temperature_2m,relative_humidity_2m,dewpoint_2m",
                    "timezone": "UTC",
                    "forecast_days": 3
                }
            )

            aq_data = _fetch_with_retries(
                client,
                OPEN_METEO_AQ_URL,
                {
                    "latitude": lat,
                    "longitude": lon,
                    "hourly": "pm2_5,us_aqi",
                    "timezone": "UTC",
                    "forecast_days": 3
                }
            )

        w_hourly = weather_data.get("hourly", {})
        aq_hourly = aq_data.get("hourly", {})

        times = w_hourly.get("time", [])
        temps = w_hourly.get("temperature_2m", [])
        rhs = w_hourly.get("relative_humidity_2m", [])
        dews = w_hourly.get("dewpoint_2m", [])

        pm25_map = dict(zip(aq_hourly.get("time", []), aq_hourly.get("pm2_5", [])))
        aqi_map = dict(zip(aq_hourly.get("time", []), aq_hourly.get("us_aqi", [])))

        merged = []
        for i, t in enumerate(times):
            merged.append({
                "hour_utc": t,
                "temp_c": float(temps[i]),
                "rh_pct": float(rhs[i]),
                "dewpoint_c": float(dews[i]),
                "pm25": float(pm25_map.get(t, 25.0)),
                "us_aqi": int(aqi_map.get(t, 50)) if aqi_map.get(t) is not None else 50
            })

        return merged, False

    except Exception:
        # Fall back to stale forecast from DB
        stale_data = _get_stale_forecast(db)
        return stale_data, True
