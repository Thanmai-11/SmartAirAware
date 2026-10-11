import os
import sys
import json
import uuid
from datetime import datetime
from dotenv import load_dotenv

# Add parent directory to path to import engine
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from engine.epw_builder import build_epw
from engine.idf_builder import build_mode_idfs
from engine.runner import run_all_modes
from engine.parser import parse_sql
from engine.config_modes import MODES

def main():
    load_dotenv()
    
    # Inputs
    window_date = "2026-10-08" # Use date from Phase 1 weather API
    
    # Mock forecast for 2026-10-08 (48 hours)
    forecast = []
    for d in ["2026-10-08", "2026-10-09"]:
        for h in range(24):
            forecast.append({
                "hour_utc": f"{d}T{h:02d}:00",
                "temp_c": 30.0 + (h % 10),
                "dewpoint_c": 20.0,
                "rh_pct": 50.0
            })
            
    # Mock headcount (full capacity in the middle of the day)
    from engine.config_modes import MAX_CAPACITY
    headcount = [0]*8 + [MAX_CAPACITY]*10 + [0]*6
    
    run_id = f"test_run_{uuid.uuid4().hex[:8]}"
    runs_dir = os.getenv("RUNS_DIR", "./runs")
    run_folder = os.path.abspath(os.path.join(runs_dir, run_id))
    os.makedirs(run_folder, exist_ok=True)
    
    print(f"Starting Phase 2 Simulation Test in {run_folder}")
    
    # 1. Build EPW
    base_epw = os.path.abspath(r"data\base_delhi.epw")
    out_epw = os.path.join(run_folder, "forecast.epw")
    print("Building EPW...")
    build_epw(base_epw, out_epw, forecast)
    
    # 2. Build IDFs
    base_idf = os.path.abspath(r"data\building.idf")
    print("Building IDFs for all modes...")
    build_mode_idfs(base_idf, run_folder, headcount, window_date)
    
    # 3. Run all modes
    print("Running EnergyPlus for all modes (this takes a few minutes)...")
    results = run_all_modes(run_folder, out_epw)
    print("Run results:", results)
    
    # 4. Parse results
    print("Parsing SQL results...")
    mode_table = {}
    for mode_name in MODES.keys():
        sql_path = os.path.join(run_folder, mode_name, "eplusout.sql")
        mode_table[mode_name] = parse_sql(sql_path, window_date)
        
    # Output Table for hour 14 (Peak hour) to demonstrate
    print("\nSample Hourly Table (Hour 14 local):")
    print(f"{'Mode':<15} | {'kWh':<8} | {'Zone Mean Temp °C':<20} | {'Zone Max Temp °C'}")
    print("-" * 65)
    for mode_name, hours in mode_table.items():
        h14 = hours[14]
        print(f"{mode_name:<15} | {h14['kwh']:<8.2f} | {h14['zone_temp_mean_c']:<20.2f} | {h14['zone_temp_max_c']:.2f}")

if __name__ == "__main__":
    main()
