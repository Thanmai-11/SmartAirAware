import csv
import os
from .config_modes import MODES

def build_outputs(
    run_folder: str,
    schedule: list,
    verify_results: list,
    maintain_results: list,
    mode_table: dict,
    headcount: list,
    local_hours: list,
    forecast: list,
    settings: dict,
    oa_per_person_m3s: float,
    oa_per_area_m3s: float,
    floor_area_m2: float
):
    """
    Builds the final schedule table, KPIs, and writes latest.csv
    """
    
    # 1. Build Schedule Table
    final_schedule = []
    for h in range(24):
        mode = schedule[h]
        
        # Action
        if h == 0:
            action = "Set now"
        elif schedule[h] != schedule[h-1]:
            action = f"Change at {local_hours[h]:02d}:00"
        else:
            action = "No change"
            
        # Outdoor air calculation
        q_oa_m3s = MODES[mode]['oa_multiplier'] * (oa_per_person_m3s * headcount[h] + oa_per_area_m3s * floor_area_m2)
        q_oa_lps = q_oa_m3s * 1000.0
        
        indoor_pm25 = mode_table[mode][h]['indoor_pm25']
        
        row = {
            "datetime": forecast[h]['hour_utc'],  # from forecast
            "mode_label": mode,
            "cooling_setpoint_c": MODES[mode]['cooling_setpoint_c'],
            "outdoor_air_lps": round(q_oa_lps, 1),
            "action": action,
            "headcount": headcount[h],
            "outdoor_temp_c": forecast[h]['temp_c'],
            "outdoor_pm25": forecast[h].get('pm25', 0.0), # Assuming forecast has pm25
            "expected_zone_temp_c": round(verify_results[h]['zone_temp_max_c'], 1),
            "expected_indoor_pm25": round(indoor_pm25, 1),
            "expected_kw": round(verify_results[h]['kw'], 2)
        }
        final_schedule.append(row)
        
    # 2. Build KPIs
    baseline_kwh = sum(r['kwh'] for r in maintain_results)
    optimized_kwh = sum(r['kwh'] for r in verify_results)
    baseline_peak_kw = max(r['kw'] for r in maintain_results)
    optimized_peak_kw = max(r['kw'] for r in verify_results)
    
    comfort_met = 0
    iaq_violations = 0
    occupied_hours = 0
    
    flex_kw_sum = 0
    flex_hours = 0
    
    for h in range(24):
        clock_h = local_hours[h]
        if headcount[h] > 0:
            occupied_hours += 1
            # Lower-bound check uses zone_temp_min_c (coldest zone must stay above comfort_min),
            # upper-bound check uses zone_temp_max_c (hottest zone must stay below comfort_max).
            if (verify_results[h]['zone_temp_min_c'] >= settings['comfort_min_c'] and
                    verify_results[h]['zone_temp_max_c'] <= settings['comfort_max_c']):
                comfort_met += 1
            if mode_table[schedule[h]][h]['indoor_pm25'] > settings['pm25_limit']:
                iaq_violations += 1
                
        if settings['peak_start_h'] <= clock_h < settings['peak_end_h']:
            flex_kw_sum += (maintain_results[h]['kw'] - verify_results[h]['kw'])
            flex_hours += 1
            
    flexible_kw = (flex_kw_sum / flex_hours) if flex_hours > 0 else 0.0
    
    kpis = {
        "baseline_kwh": baseline_kwh,
        "optimized_kwh": optimized_kwh,
        "baseline_peak_kw": baseline_peak_kw,
        "optimized_peak_kw": optimized_peak_kw,
        "comfort_hours_met": comfort_met,
        "occupied_hours": occupied_hours,
        "iaq_violations": iaq_violations,
        "flexible_kw": flexible_kw
    }
    
    # 3. CSV Writer
    csv_path = os.path.join(run_folder, "latest.csv")
    fields = [
        "datetime", "mode_label", "cooling_setpoint_c", "outdoor_air_lps", "action", "headcount", 
        "outdoor_temp_c", "outdoor_pm25", "expected_zone_temp_c", "expected_indoor_pm25", "expected_kw"
    ]
    with open(csv_path, 'w', newline='') as f:
        writer = csv.DictWriter(f, fieldnames=fields)
        writer.writeheader()
        for row in final_schedule:
            writer.writerow(row)
            
    return final_schedule, kpis
