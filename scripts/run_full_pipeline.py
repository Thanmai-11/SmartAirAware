import os
import sys
import uuid
import pprint
from datetime import datetime
from dotenv import load_dotenv

# Add parent directory to path to import engine
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from engine.epw_builder import build_epw
from engine.idf_builder import build_mode_idfs
from engine.runner import run_all_modes
from engine.parser import parse_sql
from engine.iaq import compute_indoor_pm25
from engine.mask import get_violations
from engine.optimizer import optimize_schedule
from engine.verify import verify_loop
from engine.outputs import build_outputs
from engine.config_modes import MODES, DEFAULT_SETTINGS, MAX_CAPACITY

def main():
    load_dotenv()
    
    # 1. Setup Mock Data (Clean Air Scenario)
    window_date = "2026-10-08"
    forecast = []
    for d in ["2026-10-08", "2026-10-09"]:
        for h in range(24):
            forecast.append({
                "hour_utc": f"{d}T{h:02d}:00",
                "temp_c": 24.0, # pleasant
                "dewpoint_c": 15.0,
                "rh_pct": 50.0,
                "pm25": 10.0 # Clean air
            })
            
    headcount = [0]*8 + [MAX_CAPACITY]*10 + [0]*6
    local_hours = list(range(24))
    
    run_id = f"test_run_{uuid.uuid4().hex[:8]}"
    runs_dir = os.getenv("RUNS_DIR", "./runs")
    run_folder = os.path.abspath(os.path.join(runs_dir, run_id))
    os.makedirs(run_folder, exist_ok=True)
    
    print(f"Starting Phase 3 Test in {run_folder}")
    
    # Run Phase 2 Pipeline
    base_epw = os.path.abspath(r"data\base_delhi.epw")
    out_epw = os.path.join(run_folder, "forecast.epw")
    build_epw(base_epw, out_epw, forecast)
    
    base_idf = os.path.abspath(r"data\building.idf")
    build_mode_idfs(base_idf, run_folder, headcount, window_date)
    
    print("Running 4 uniform modes...")
    run_all_modes(run_folder, out_epw)
    
    mode_table = {}
    for mode_name in MODES.keys():
        sql_path = os.path.join(run_folder, mode_name, "eplusout.sql")
        mode_table[mode_name] = parse_sql(sql_path, window_date)
        
    # Phase 3: IAQ and Constraints
    # We need floor area and volume. For DOE Medium Office:
    floor_area_m2 = 4982.19
    volume_m3 = 15000.0
    oa_per_person_m3s = 0.0025 # 2.5 L/s/person
    oa_per_area_m3s = 0.0003 # 0.3 L/s/m2
    
    for mode in MODES.keys():
        for h in range(24):
            row = mode_table[mode][h]
            indoor_pm25 = compute_indoor_pm25(
                c_out=forecast[h]['pm25'], headcount=headcount[h], oa_multiplier=MODES[mode]['oa_multiplier'],
                oa_per_person_m3s=oa_per_person_m3s, oa_per_area_m3s=oa_per_area_m3s,
                floor_area_m2=floor_area_m2, volume_m3=volume_m3,
                filter_eff=DEFAULT_SETTINGS['filter_eff'], infiltration_ach=DEFAULT_SETTINGS['infiltration_ach'],
                penetration=DEFAULT_SETTINGS['penetration'], deposition_per_h=DEFAULT_SETTINGS['deposition_per_h'],
                person_source_ugps=DEFAULT_SETTINGS['person_source_ugps']
            )
            row['indoor_pm25'] = indoor_pm25
            row['violation'] = get_violations(
                headcount[h], indoor_pm25, row['zone_temp_min_c'], row['zone_temp_max_c'],
                DEFAULT_SETTINGS['pm25_limit'], DEFAULT_SETTINGS['comfort_min_c'], DEFAULT_SETTINGS['comfort_max_c']
            )

    print("Optimizing...")
    initial_schedule = optimize_schedule(
        mode_table, headcount, local_hours, "Maintain", "Maintain",
        DEFAULT_SETTINGS['lambda_peak'], DEFAULT_SETTINGS['gamma_switch'],
        DEFAULT_SETTINGS['violation_penalty'], DEFAULT_SETTINGS['peak_start_h'], DEFAULT_SETTINGS['peak_end_h']
    )
    
    print("Verifying...")
    final_schedule, verify_results = verify_loop(
        initial_schedule, mode_table, headcount, local_hours, "Maintain", "Maintain",
        DEFAULT_SETTINGS, base_idf, run_folder, out_epw, window_date, optimize_schedule
    )
    
    print("Building Outputs...")
    final_table, kpis = build_outputs(
        run_folder, final_schedule, verify_results, mode_table['Maintain'], mode_table,
        headcount, local_hours, forecast, DEFAULT_SETTINGS,
        oa_per_person_m3s, oa_per_area_m3s, floor_area_m2
    )
    
    print("\n--- FINAL KPIs ---")
    pprint.pprint(kpis)
    print("\n--- SCHEDULE SAMPLE (Hours 12-16) ---")
    for i in range(12, 17):
        row = final_table[i]
        print(f"H{i:02d}: {row['mode_label']:<12} | {row['action']:<15} | {row['expected_zone_temp_c']}°C | PM2.5: {row['expected_indoor_pm25']}")

if __name__ == "__main__":
    main()
