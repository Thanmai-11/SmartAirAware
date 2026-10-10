import os
import uuid
import time
from datetime import datetime, timezone, timedelta
from zoneinfo import ZoneInfo
from typing import Optional

from sqlalchemy.orm import Session
from db.session import SessionLocal
from db.models import Building, Settings, OccupancyHourly, Run, Forecast, ModeTable, Schedule, KPI
from engine.config_modes import MODES, MAX_CAPACITY
from engine.ingest import ingest_forecast
from engine.epw_builder import build_epw
from engine.idf_builder import build_mode_idfs
from engine.runner import run_all_modes
from engine.parser import parse_sql
from engine.iaq import compute_indoor_pm25
from engine.mask import get_violations
from engine.optimizer import optimize_schedule
from engine.verify import verify_loop
from engine.outputs import build_outputs

OA_PER_PERSON_M3S = 0.0025
OA_PER_AREA_M3S = 0.0003

def run_pipeline(existing_run_id: Optional[str] = None) -> str:
    """
    Executes the end-to-end optimization pipeline atomically.
    Returns the run_id.
    """
    start_time = time.time()
    pipeline_timeout_s = int(os.getenv("PIPELINE_TIMEOUT_S", "900"))
    
    db: Session = SessionLocal()
    run_id = existing_run_id or str(uuid.uuid4())
    run_folder = None
    
    try:
        # 1. Initialize or update Run row — committed immediately and independently
        # so that a later rollback does not erase the record.
        run_record = db.query(Run).filter(Run.id == run_id).first()
        now_utc = datetime.now(timezone.utc)
        if not run_record:
            run_record = Run(
                id=run_id,
                started_utc=now_utc.replace(tzinfo=None),
                status="running"
            )
            db.add(run_record)
        else:
            run_record.started_utc = now_utc.replace(tzinfo=None)
            run_record.status = "running"
            run_record.error_text = None
        db.commit()

        # Check timeout helper
        def check_timeout():
            if time.time() - start_time > pipeline_timeout_s:
                raise TimeoutError(f"Pipeline exceeded maximum execution time of {pipeline_timeout_s} seconds")

        # 2. Compute 24-hour window
        tz_ist = ZoneInfo(os.getenv("TIMEZONE", "Asia/Kolkata"))
        now_ist = datetime.now(tz_ist)
        h0 = now_ist.hour
        d_str = now_ist.date().isoformat()
        
        local_hours = [(h0 + i) % 24 for i in range(24)]
        window_dts_ist = [
            now_ist.replace(minute=0, second=0, microsecond=0) + timedelta(hours=i)
            for i in range(24)
        ]
        window_dts_utc = [dt.astimezone(timezone.utc) for dt in window_dts_ist]
        window_start_utc = window_dts_utc[0].replace(tzinfo=None)

        run_record.window_start_utc = window_start_utc
        db.commit()

        # 3. Read Building, Settings, Occupancy
        building = db.query(Building).first()
        if not building:
            raise RuntimeError("Building row not found in database. Please run seed_db.")

        settings_row = db.query(Settings).first()
        if not settings_row:
            raise RuntimeError("Settings row not found in database. Please run seed_db.")

        settings_dict = {
            "comfort_min_c": settings_row.comfort_min_c,
            "comfort_max_c": settings_row.comfort_max_c,
            "pm25_limit": settings_row.pm25_limit,
            "peak_start_h": settings_row.peak_start_h,
            "peak_end_h": settings_row.peak_end_h,
            "filter_eff": settings_row.filter_eff,
            "infiltration_ach": settings_row.infiltration_ach,
            "penetration": settings_row.penetration,
            "deposition_per_h": settings_row.deposition_per_h,
            "person_source_ugps": settings_row.person_source_ugps,
            "lambda_peak": settings_row.lambda_peak,
            "gamma_switch": settings_row.gamma_switch,
            "violation_penalty": settings_row.violation_penalty,
        }

        occ_rows = db.query(OccupancyHourly).all()
        occ_dict = {r.hour: r.headcount for r in occ_rows}
        window_headcount = [occ_dict.get(lh, 0) for lh in local_hours]
        clock_headcount = [occ_dict.get(h, 0) for h in range(24)]

        # Mode continuity from previous successful run
        last_success = (
            db.query(Run)
            .filter(Run.status == "success")
            .filter(Run.id != run_id)
            .order_by(Run.started_utc.desc())
            .first()
        )
        last_h0_mode = "Maintain"
        last_mode = "Maintain"
        if last_success:
            prev_sched = (
                db.query(Schedule)
                .filter(Schedule.run_id == last_success.id)
                .filter(Schedule.hour_utc == window_start_utc)
                .first()
            )
            if prev_sched:
                last_h0_mode = prev_sched.mode
                last_mode = prev_sched.mode

        check_timeout()

        # 4. Ingest Forecast
        forecast_data, is_stale = ingest_forecast(
            db, lat=building.lat, lon=building.lon
        )
        run_record.stale_forecast = is_stale
        db.commit()

        # 5. Build inputs
        runs_dir = os.path.abspath(os.getenv("RUNS_DIR", "./runs"))
        run_folder = os.path.join(runs_dir, run_id)
        os.makedirs(run_folder, exist_ok=True)

        out_epw = os.path.join(run_folder, "forecast.epw")
        build_epw(os.path.abspath(building.epw_path), out_epw, forecast_data)
        build_mode_idfs(
            os.path.abspath(building.idf_path),
            run_folder,
            clock_headcount,
            d_str
        )

        check_timeout()

        # 6. Simulate 4 uniform modes
        run_all_modes(run_folder, out_epw)
        mode_table = {}
        for m_name in MODES.keys():
            sql_path = os.path.join(run_folder, m_name, "eplusout.sql")
            mode_table[m_name] = parse_sql(sql_path, d_str, start_hour=h0)

        check_timeout()

        # 7. IAQ & Constraint Costs
        # Map 24 window forecast hours
        fc_dict = {f["hour_utc"][:13]: f for f in forecast_data}
        window_forecast = []
        for w_dt in window_dts_utc:
            key = w_dt.strftime("%Y-%m-%dT%H")
            matched = fc_dict.get(key)
            if not matched:
                matched = {
                    "hour_utc": w_dt.strftime("%Y-%m-%dT%H:00"),
                    "temp_c": 25.0,
                    "rh_pct": 50.0,
                    "dewpoint_c": 14.0,
                    "pm25": 25.0,
                    "us_aqi": 50
                }
            window_forecast.append(matched)

        for mode_name in MODES.keys():
            for h in range(24):
                row = mode_table[mode_name][h]
                c_out = window_forecast[h]["pm25"]
                indoor_pm25 = compute_indoor_pm25(
                    c_out=c_out,
                    headcount=window_headcount[h],
                    oa_multiplier=MODES[mode_name]["oa_multiplier"],
                    oa_per_person_m3s=OA_PER_PERSON_M3S,
                    oa_per_area_m3s=OA_PER_AREA_M3S,
                    floor_area_m2=building.floor_area_m2,
                    volume_m3=building.volume_m3,
                    filter_eff=settings_dict["filter_eff"],
                    infiltration_ach=settings_dict["infiltration_ach"],
                    penetration=settings_dict["penetration"],
                    deposition_per_h=settings_dict["deposition_per_h"],
                    person_source_ugps=settings_dict["person_source_ugps"]
                )
                row["indoor_pm25"] = indoor_pm25
                row["violation"] = get_violations(
                    window_headcount[h],
                    indoor_pm25,
                    row["zone_temp_min_c"],
                    row["zone_temp_max_c"],
                    settings_dict["pm25_limit"],
                    settings_dict["comfort_min_c"],
                    settings_dict["comfort_max_c"]
                )

        check_timeout()

        # 8. Optimize
        schedule_opt = optimize_schedule(
            mode_table,
            window_headcount,
            local_hours,
            last_h0_mode,
            last_mode,
            settings_dict["lambda_peak"],
            settings_dict["gamma_switch"],
            settings_dict["violation_penalty"],
            settings_dict["peak_start_h"],
            settings_dict["peak_end_h"]
        )

        check_timeout()

        # 9. Verify
        final_schedule, verify_results = verify_loop(
            schedule_opt,
            mode_table,
            window_headcount,
            local_hours,
            last_mode,
            last_h0_mode,
            settings_dict,
            os.path.abspath(building.idf_path),
            run_folder,
            out_epw,
            d_str,
            optimize_schedule,
            start_hour=h0
        )

        check_timeout()

        # 10. Build outputs
        final_table, kpis = build_outputs(
            run_folder,
            final_schedule,
            verify_results,
            mode_table["Maintain"],
            mode_table,
            window_headcount,
            local_hours,
            window_forecast,
            settings_dict,
            OA_PER_PERSON_M3S,
            OA_PER_AREA_M3S,
            building.floor_area_m2
        )

        check_timeout()

        # 11. Atomic Publish: Persist all rows in single transaction
        # Forecast rows
        for wf, w_dt in zip(window_forecast, window_dts_utc):
            db.add(Forecast(
                run_id=run_id,
                hour_utc=w_dt.replace(tzinfo=None),
                temp_c=wf["temp_c"],
                rh_pct=wf["rh_pct"],
                dewpoint_c=wf["dewpoint_c"],
                pm25=wf["pm25"],
                us_aqi=wf.get("us_aqi", 0)
            ))

        # Mode table rows
        for m_name, rows in mode_table.items():
            for h, r in enumerate(rows):
                db.add(ModeTable(
                    run_id=run_id,
                    mode=m_name,
                    hour_utc=window_dts_utc[h].replace(tzinfo=None),
                    kwh=r["kwh"],
                    kw=r["kw"],
                    zone_temp_max_c=r["zone_temp_max_c"],
                    zone_temp_mean_c=r["zone_temp_mean_c"],
                    indoor_pm25=r["indoor_pm25"]
                ))

        # Schedule rows
        for h, row in enumerate(final_table):
            db.add(Schedule(
                run_id=run_id,
                hour_utc=window_dts_utc[h].replace(tzinfo=None),
                mode=row["mode_label"],
                cooling_setpoint_c=row["cooling_setpoint_c"],
                outdoor_air_lps=row["outdoor_air_lps"],
                action=row["action"],
                headcount=row["headcount"],
                expected_zone_temp_c=row["expected_zone_temp_c"],
                expected_indoor_pm25=row["expected_indoor_pm25"],
                expected_kw=row["expected_kw"],
                locked=False
            ))

        # KPI row
        db.add(KPI(
            run_id=run_id,
            baseline_kwh=float(kpis["baseline_kwh"]),
            optimized_kwh=float(kpis["optimized_kwh"]),
            baseline_peak_kw=float(kpis["baseline_peak_kw"]),
            optimized_peak_kw=float(kpis["optimized_peak_kw"]),
            comfort_hours_met=int(kpis["comfort_hours_met"]),
            occupied_hours=int(kpis["occupied_hours"]),
            iaq_violations=int(kpis["iaq_violations"]),
            flexible_kw=float(kpis["flexible_kw"])
        ))

        # Finalize Run status
        run_record.status = "success"
        run_record.ended_utc = datetime.now(timezone.utc).replace(tzinfo=None)
        run_record.error_text = None

        db.commit()
        return run_id

    except Exception as exc:
        try:
            db.rollback()
        except Exception:
            pass
        # Use a fresh session so the main session's rollback doesn't prevent recording the failure.
        fail_db = SessionLocal()
        try:
            fail_record = fail_db.query(Run).filter(Run.id == run_id).first()
            if fail_record:
                fail_record.status = "failed"
                fail_record.error_text = str(exc)
                fail_record.ended_utc = datetime.now(timezone.utc).replace(tzinfo=None)
                fail_db.commit()
            else:
                # The initial commit never landed (e.g. DB error on first write); insert now.
                fail_db.add(Run(
                    id=run_id,
                    started_utc=datetime.now(timezone.utc).replace(tzinfo=None),
                    ended_utc=datetime.now(timezone.utc).replace(tzinfo=None),
                    status="failed",
                    error_text=str(exc)
                ))
                fail_db.commit()
        except Exception:
            fail_db.rollback()
        finally:
            fail_db.close()
        raise exc
    finally:
        db.close()
