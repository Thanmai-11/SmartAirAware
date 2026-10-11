import io
import csv
import uuid
from datetime import datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, status, UploadFile, File, Response
from sqlalchemy.orm import Session

from db.session import get_db
from db.models import Building, Settings, OccupancyHourly, Run, Forecast, Schedule, KPI, Actuals
from backend.auth import verify_admin_key
from backend.schemas import (
    SettingsSchema,
    OccupancyUpdateSchema,
    OccupancyResponseSchema,
    OccupancyItemSchema,
    ScheduleLatestResponse,
    ScheduleRowSchema,
    ForecastRowSchema,
    KPISchema,
    RunSchema,
    ActionResponse
)

router = APIRouter(prefix="/api")

@router.get("/schedule/latest")
def get_latest_schedule(db: Session = Depends(get_db)):
    latest_run = (
        db.query(Run)
        .filter(Run.status == "success")
        .order_by(Run.started_utc.desc())
        .first()
    )
    if not latest_run:
        return {
            "run_id": "",
            "run_time": "",
            "forecast_age_min": 0.0,
            "stale_forecast": False,
            "summary": {},
            "schedule": []
        }

    schedules = (
        db.query(Schedule)
        .filter(Schedule.run_id == latest_run.id)
        .order_by(Schedule.hour_utc.asc())
        .all()
    )

    forecast_rows = (
        db.query(Forecast)
        .filter(Forecast.run_id == latest_run.id)
        .order_by(Forecast.hour_utc.asc())
        .all()
    )
    fc_map = {f.hour_utc: f for f in forecast_rows}

    kpi = db.query(KPI).filter(KPI.run_id == latest_run.id).first()
    summary = {}
    if kpi:
        summary = {
            "baseline_kwh": kpi.baseline_kwh,
            "optimized_kwh": kpi.optimized_kwh,
            "baseline_peak_kw": kpi.baseline_peak_kw,
            "optimized_peak_kw": kpi.optimized_peak_kw,
            "comfort_hours_met": kpi.comfort_hours_met,
            "occupied_hours": kpi.occupied_hours,
            "iaq_violations": kpi.iaq_violations,
            "flexible_kw": kpi.flexible_kw
        }

    now_utc = datetime.now(timezone.utc).replace(tzinfo=None)
    age_min = round((now_utc - latest_run.started_utc).total_seconds() / 60.0, 1)

    schedule_data = []
    for s in schedules:
        fc = fc_map.get(s.hour_utc)
        out_temp = fc.temp_c if fc else 25.0
        out_pm25 = fc.pm25 if fc else 0.0
        schedule_data.append(
            ScheduleRowSchema(
                datetime=s.hour_utc.isoformat(),
                mode_label=s.mode,
                cooling_setpoint_c=s.cooling_setpoint_c,
                outdoor_air_lps=s.outdoor_air_lps,
                action=s.action,
                headcount=s.headcount,
                outdoor_temp_c=out_temp,
                outdoor_pm25=out_pm25,
                expected_zone_temp_c=s.expected_zone_temp_c,
                expected_indoor_pm25=s.expected_indoor_pm25,
                expected_kw=s.expected_kw,
                locked=s.locked
            )
        )

    run_time_str = latest_run.ended_utc.isoformat() if latest_run.ended_utc else latest_run.started_utc.isoformat()

    return ScheduleLatestResponse(
        run_id=latest_run.id,
        run_time=run_time_str,
        forecast_age_min=max(0.0, age_min),
        stale_forecast=latest_run.stale_forecast,
        summary=summary,
        schedule=schedule_data
    )

@router.get("/schedule/latest.csv")
def download_latest_csv(db: Session = Depends(get_db)):
    latest_run = (
        db.query(Run)
        .filter(Run.status == "success")
        .order_by(Run.started_utc.desc())
        .first()
    )
    if not latest_run:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No successful run schedule available"
        )

    schedules = (
        db.query(Schedule)
        .filter(Schedule.run_id == latest_run.id)
        .order_by(Schedule.hour_utc.asc())
        .all()
    )

    forecast_rows = (
        db.query(Forecast)
        .filter(Forecast.run_id == latest_run.id)
        .order_by(Forecast.hour_utc.asc())
        .all()
    )
    fc_map = {f.hour_utc: f for f in forecast_rows}

    output = io.StringIO()
    fields = [
        "datetime", "mode_label", "cooling_setpoint_c", "outdoor_air_lps",
        "action", "headcount", "outdoor_temp_c", "outdoor_pm25",
        "expected_zone_temp_c", "expected_indoor_pm25", "expected_kw"
    ]
    writer = csv.DictWriter(output, fieldnames=fields)
    writer.writeheader()

    for s in schedules:
        fc = fc_map.get(s.hour_utc)
        writer.writerow({
            "datetime": s.hour_utc.isoformat(),
            "mode_label": s.mode,
            "cooling_setpoint_c": s.cooling_setpoint_c,
            "outdoor_air_lps": s.outdoor_air_lps,
            "action": s.action,
            "headcount": s.headcount,
            "outdoor_temp_c": fc.temp_c if fc else 25.0,
            "outdoor_pm25": fc.pm25 if fc else 0.0,
            "expected_zone_temp_c": s.expected_zone_temp_c,
            "expected_indoor_pm25": s.expected_indoor_pm25,
            "expected_kw": s.expected_kw
        })

    csv_content = output.getvalue()
    return Response(
        content=csv_content,
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=latest.csv"}
    )

@router.get("/forecast/latest", response_model=List[ForecastRowSchema])
def get_latest_forecast(db: Session = Depends(get_db)):
    latest_run = (
        db.query(Run)
        .filter(Run.status == "success")
        .order_by(Run.started_utc.desc())
        .first()
    )
    if not latest_run:
        return []

    forecasts = (
        db.query(Forecast)
        .filter(Forecast.run_id == latest_run.id)
        .order_by(Forecast.hour_utc.asc())
        .all()
    )

    return [
        ForecastRowSchema(
            hour_utc=f.hour_utc.isoformat(),
            temp_c=f.temp_c,
            rh_pct=f.rh_pct,
            dewpoint_c=f.dewpoint_c,
            pm25=f.pm25,
            us_aqi=f.us_aqi
        )
        for f in forecasts
    ]

@router.get("/kpis/latest")
def get_latest_kpis(db: Session = Depends(get_db)):
    latest_run = (
        db.query(Run)
        .filter(Run.status == "success")
        .order_by(Run.started_utc.desc())
        .first()
    )
    if not latest_run:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No successful run available"
        )

    kpi = db.query(KPI).filter(KPI.run_id == latest_run.id).first()
    if not kpi:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="KPIs not found for latest run"
        )

    return KPISchema(
        baseline_kwh=kpi.baseline_kwh,
        optimized_kwh=kpi.optimized_kwh,
        baseline_peak_kw=kpi.baseline_peak_kw,
        optimized_peak_kw=kpi.optimized_peak_kw,
        comfort_hours_met=kpi.comfort_hours_met,
        occupied_hours=kpi.occupied_hours,
        iaq_violations=kpi.iaq_violations,
        flexible_kw=kpi.flexible_kw
    )

@router.get("/runs", response_model=List[RunSchema])
def get_runs(limit: int = 50, db: Session = Depends(get_db)):
    runs = (
        db.query(Run)
        .order_by(Run.started_utc.desc())
        .limit(limit)
        .all()
    )

    return [
        RunSchema(
            id=r.id,
            started_utc=r.started_utc.isoformat(),
            ended_utc=r.ended_utc.isoformat() if r.ended_utc else None,
            status=r.status,
            window_start_utc=r.window_start_utc.isoformat() if r.window_start_utc else None,
            stale_forecast=r.stale_forecast,
            error_text=r.error_text
        )
        for r in runs
    ]

@router.get("/settings", response_model=SettingsSchema)
def get_settings(db: Session = Depends(get_db)):
    settings = db.query(Settings).first()
    if not settings:
        raise HTTPException(status_code=404, detail="Settings not found")

    return SettingsSchema(
        comfort_min_c=settings.comfort_min_c,
        comfort_max_c=settings.comfort_max_c,
        pm25_limit=settings.pm25_limit,
        peak_start_h=settings.peak_start_h,
        peak_end_h=settings.peak_end_h,
        filter_eff=settings.filter_eff,
        infiltration_ach=settings.infiltration_ach,
        penetration=settings.penetration,
        deposition_per_h=settings.deposition_per_h,
        person_source_ugps=settings.person_source_ugps,
        lambda_peak=settings.lambda_peak,
        gamma_switch=settings.gamma_switch,
        violation_penalty=settings.violation_penalty
    )

@router.put("/settings", response_model=SettingsSchema)
def update_settings(
    payload: SettingsSchema,
    db: Session = Depends(get_db),
    authorized: bool = Depends(verify_admin_key)
):
    settings = db.query(Settings).first()
    if not settings:
        settings = Settings(id=1)
        db.add(settings)

    for key, val in payload.model_dump().items():
        setattr(settings, key, val)

    db.commit()
    db.refresh(settings)
    return payload

@router.get("/occupancy", response_model=OccupancyResponseSchema)
def get_occupancy(db: Session = Depends(get_db)):
    building = db.query(Building).first()
    max_cap = building.max_capacity if building else 268

    rows = db.query(OccupancyHourly).order_by(OccupancyHourly.hour.asc()).all()
    items = [OccupancyItemSchema(hour=r.hour, headcount=r.headcount) for r in rows]

    return OccupancyResponseSchema(max_capacity=max_cap, occupancy=items)

@router.put("/occupancy")
def update_occupancy(
    payload: OccupancyUpdateSchema,
    db: Session = Depends(get_db),
    authorized: bool = Depends(verify_admin_key)
):
    building = db.query(Building).first()
    if payload.max_capacity is not None and building:
        building.max_capacity = payload.max_capacity

    current_max_capacity = building.max_capacity if building else 268
    for item in payload.occupancy:
        if item.headcount > current_max_capacity:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"Headcount {item.headcount} at hour {item.hour} exceeds max capacity {current_max_capacity}"
            )

    db.query(OccupancyHourly).delete()
    for item in payload.occupancy:
        db.add(OccupancyHourly(hour=item.hour, headcount=item.headcount))

    db.commit()
    return {"message": "Occupancy profile updated successfully"}

@router.post("/occupancy/csv")
async def upload_occupancy_csv(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    authorized: bool = Depends(verify_admin_key)
):
    content = await file.read()
    text = content.decode("utf-8")
    reader = csv.DictReader(io.StringIO(text))

    rows = []
    for r in reader:
        try:
            h = int(r.get("hour", r.get("Hour", -1)))
            hc = int(r.get("headcount", r.get("Headcount", -1)))
            if 0 <= h <= 23 and hc >= 0:
                rows.append({"hour": h, "headcount": hc})
        except ValueError:
            pass

    if len(rows) != 24:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="CSV must contain exactly 24 valid rows for hours 0 through 23"
        )

    building = db.query(Building).first()
    max_cap = building.max_capacity if building else 268
    for r in rows:
        if r["headcount"] > max_cap:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"Headcount {r['headcount']} exceeds max capacity {max_cap}"
            )

    db.query(OccupancyHourly).delete()
    for r in rows:
        db.add(OccupancyHourly(hour=r["hour"], headcount=r["headcount"]))
    db.commit()

    return {"message": "Occupancy profile updated from CSV successfully"}

@router.post("/upload-energy")
async def upload_energy(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    authorized: bool = Depends(verify_admin_key)
):
    content = await file.read()
    text = content.decode("utf-8")
    reader = csv.DictReader(io.StringIO(text))

    fieldnames = [f.strip().lower() for f in (reader.fieldnames or [])]
    if "kwh" not in fieldnames or not any(c in fieldnames for c in ["hour", "datetime"]):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="CSV must have numeric columns 'hour' (or 'datetime') and 'kWh'"
        )

    rows_saved = 0
    for row in reader:
        # Match case-insensitively
        row_norm = {k.strip().lower(): v.strip() for k, v in row.items()}
        kwh_val = float(row_norm["kwh"])
        dt_val = row_norm.get("datetime") or row_norm.get("hour")
        try:
            dt_parsed = datetime.fromisoformat(dt_val)
        except ValueError:
            dt_parsed = datetime.utcnow()

        db.merge(Actuals(hour_utc=dt_parsed, kwh=kwh_val))
        rows_saved += 1

    db.commit()
    return {"message": f"Successfully processed {rows_saved} energy records", "rows_processed": rows_saved}

@router.delete("/runs/failed", response_model=ActionResponse)
def clear_failed_runs(
    db: Session = Depends(get_db),
    authorized: bool = Depends(verify_admin_key)
):
    """Delete all runs with status 'failed' and their cascade-deleted child rows."""
    deleted = db.query(Run).filter(Run.status == "failed").delete(synchronize_session=False)
    db.commit()
    return ActionResponse(message=f"Deleted {deleted} failed run(s)", run_id=None, status=None)


@router.delete("/runs/all", response_model=ActionResponse)
def clear_all_runs(
    db: Session = Depends(get_db),
    authorized: bool = Depends(verify_admin_key)
):
    """Delete ALL run history (failed + successful). Use with care."""
    deleted = db.query(Run).delete(synchronize_session=False)
    db.commit()
    return ActionResponse(message=f"Deleted {deleted} run(s)", run_id=None, status=None)


@router.post("/run", response_model=ActionResponse)
def trigger_run(
    db: Session = Depends(get_db),
    authorized: bool = Depends(verify_admin_key)
):
    run_id = str(uuid.uuid4())
    run_row = Run(
        id=run_id,
        started_utc=datetime.now(timezone.utc).replace(tzinfo=None),
        status="pending"
    )
    db.add(run_row)
    db.commit()

    return ActionResponse(
        message="Optimization run successfully queued",
        run_id=run_id,
        status="pending"
    )
