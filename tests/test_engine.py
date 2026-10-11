import os
import csv
from engine.iaq import compute_indoor_pm25
from engine.mask import get_violations
from engine.optimizer import optimize_schedule
from engine.outputs import build_outputs
from engine.config_modes import MODES, DEFAULT_SETTINGS

def test_iaq_formula():
    c_out = 100.0
    headcount = 200
    floor_area = 5000.0
    volume = 15000.0

    # Base indoor PM2.5 with standard filter 0.8
    cin_base = compute_indoor_pm25(
        c_out=c_out, headcount=headcount, oa_multiplier=1.0,
        oa_per_person_m3s=0.0025, oa_per_area_m3s=0.0003,
        floor_area_m2=floor_area, volume_m3=volume,
        filter_eff=0.8, infiltration_ach=0.3, penetration=1.0, deposition_per_h=0.5
    )
    # Indoor must be between 0 and outdoor concentration
    assert 0.0 < cin_base < c_out

    # With filter_eff=0.8, higher ventilation multiplier REDUCES indoor PM2.5
    # because 80% of pollutants are captured — denominator grows faster than numerator.
    cin_vent = compute_indoor_pm25(
        c_out=c_out, headcount=headcount, oa_multiplier=1.5,
        oa_per_person_m3s=0.0025, oa_per_area_m3s=0.0003,
        floor_area_m2=floor_area, volume_m3=volume,
        filter_eff=0.8, infiltration_ach=0.3, penetration=1.0, deposition_per_h=0.5
    )
    assert cin_vent < cin_base

    # With NO filter (filter_eff=0.0), higher ventilation multiplier INCREASES indoor PM2.5
    # because all outdoor PM2.5 enters unfiltered.
    cin_no_filter_low = compute_indoor_pm25(
        c_out=c_out, headcount=headcount, oa_multiplier=1.0,
        oa_per_person_m3s=0.0025, oa_per_area_m3s=0.0003,
        floor_area_m2=floor_area, volume_m3=volume,
        filter_eff=0.0, infiltration_ach=0.3, penetration=1.0, deposition_per_h=0.5
    )
    cin_no_filter_high = compute_indoor_pm25(
        c_out=c_out, headcount=headcount, oa_multiplier=1.5,
        oa_per_person_m3s=0.0025, oa_per_area_m3s=0.0003,
        floor_area_m2=floor_area, volume_m3=volume,
        filter_eff=0.0, infiltration_ach=0.3, penetration=1.0, deposition_per_h=0.5
    )
    assert cin_no_filter_high > cin_no_filter_low

    # Higher filter efficiency should reduce indoor PM2.5
    cin_high_filter = compute_indoor_pm25(
        c_out=c_out, headcount=headcount, oa_multiplier=1.0,
        oa_per_person_m3s=0.0025, oa_per_area_m3s=0.0003,
        floor_area_m2=floor_area, volume_m3=volume,
        filter_eff=0.95, infiltration_ach=0.3, penetration=1.0, deposition_per_h=0.5
    )
    assert cin_high_filter < cin_base

def test_violation_flags():
    # Unoccupied: no violation even with extreme temperature or PM2.5
    assert get_violations(0, 150.0, 15.0, 35.0, 35.0, 23.0, 27.0) == 0

    # Occupied: within limits
    assert get_violations(50, 20.0, 23.5, 26.0, 35.0, 23.0, 27.0) == 0

    # Occupied: PM2.5 breach
    assert get_violations(50, 45.0, 23.5, 26.0, 35.0, 23.0, 27.0) == 1

    # Occupied: Overheating breach
    assert get_violations(50, 20.0, 24.0, 28.5, 35.0, 23.0, 27.0) == 1

    # Occupied: Under-cooling breach
    assert get_violations(50, 20.0, 21.0, 25.0, 35.0, 23.0, 27.0) == 1

def test_optimizer_rules():
    local_hours = list(range(24))
    headcount = [0] * 8 + [200] * 10 + [0] * 6

    mode_table = {}
    for m in MODES.keys():
        mode_table[m] = []
        for h in range(24):
            mode_table[m].append({
                "kwh": 20.0 if m != "Reduce HVAC" else 15.0,
                "kw": 20.0 if m != "Reduce HVAC" else 15.0,
                "indoor_pm25": 15.0,
                "violation": 0
            })

    schedule = optimize_schedule(
        mode_table, headcount, local_hours,
        last_mode="Maintain", last_h0_mode="Maintain",
        lambda_peak=1.0, gamma_switch=0.5, violation_penalty=1000.0,
        peak_start_h=14, peak_end_h=18
    )

    assert len(schedule) == 24
    # Rule 1: Current hour h0 is fixed to last_h0_mode
    assert schedule[0] == "Maintain"

    # Rule 2: 2-hour minimum dwell time
    for h in range(23):
        if h > 0 and schedule[h] != schedule[h-1]:
            assert schedule[h+1] == schedule[h], f"Mode did not persist for at least 2 hours at hour {h}"

def test_action_labels_and_csv_columns(tmp_path):
    schedule = ["Maintain"] * 5 + ["Ventilate"] * 5 + ["Maintain"] * 14
    # zone_temp_min_c is required by the comfort KPI check (lower bound uses min temp)
    verify_results  = [{"zone_temp_max_c": 24.5, "zone_temp_min_c": 23.5, "kw": 15.0, "kwh": 15.0} for _ in range(24)]
    maintain_results = [{"zone_temp_max_c": 24.5, "zone_temp_min_c": 23.5, "kw": 16.0, "kwh": 16.0} for _ in range(24)]
    mode_table = {m: [{"indoor_pm25": 10.0} for _ in range(24)] for m in MODES.keys()}
    headcount = [100] * 24
    local_hours = list(range(24))
    forecast = [{"hour_utc": f"2026-10-08T{h:02d}:00", "temp_c": 25.0, "pm25": 12.0} for h in range(24)]

    final_table, kpis = build_outputs(
        str(tmp_path), schedule, verify_results, maintain_results, mode_table,
        headcount, local_hours, forecast, DEFAULT_SETTINGS,
        0.0025, 0.0003, 5000.0
    )

    # Action labels
    assert final_table[0]["action"] == "Set now"
    assert final_table[1]["action"] == "No change"
    assert final_table[5]["action"] == "Change at 05:00"
    assert final_table[6]["action"] == "No change"
    assert final_table[10]["action"] == "Change at 10:00"

    # CSV headers
    csv_file = os.path.join(str(tmp_path), "latest.csv")
    assert os.path.exists(csv_file)
    with open(csv_file, "r") as f:
        reader = csv.reader(f)
        header = next(reader)
        expected_cols = [
            "datetime", "mode_label", "cooling_setpoint_c", "outdoor_air_lps", "action", "headcount",
            "outdoor_temp_c", "outdoor_pm25", "expected_zone_temp_c", "expected_indoor_pm25", "expected_kw"
        ]
        assert header == expected_cols
