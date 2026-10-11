from ortools.sat.python import cp_model
from .config_modes import MODES

def optimize_schedule(
    mode_table: dict,
    headcount: list,
    local_hours: list,
    last_mode: str,
    last_h0_mode: str,
    lambda_peak: float,
    gamma_switch: float,
    violation_penalty: float,
    peak_start_h: int,
    peak_end_h: int
):
    """
    CP-SAT Optimizer to find the best 24-hour mode schedule.
    mode_table: {mode_name: [24 dicts with kwh, kw, violations]}
    local_hours: [24 ints] corresponding to the clock hour (0-23)
    """
    model = cp_model.CpModel()
    modes_list = list(MODES.keys())
    H = 24
    M = len(modes_list)
    
    # Scale factor for floating point to integer conversion
    SCALE = 1000
    
    # 1. Variables
    x = {}
    for h in range(H):
        for m, mode in enumerate(modes_list):
            x[h, mode] = model.NewBoolVar(f'x_{h}_{mode}')
            
    # Exactly one mode per hour
    for h in range(H):
        model.AddExactlyOne([x[h, mode] for mode in modes_list])
        
    # 2. Objective components
    total_energy = 0
    total_violations = 0
    
    for h in range(H):
        for mode in modes_list:
            data = mode_table[mode][h]
            kwh = int(data['kwh'] * SCALE)
            viol = int(data['violation'])  # 1 or 0
            
            total_energy += x[h, mode] * kwh
            total_violations += x[h, mode] * viol * int(violation_penalty * SCALE)
            
    # Peak Demand
    # P >= kW[h] for all h
    P = model.NewIntVar(0, 10000000, 'Peak_kW')
    for h in range(H):
        for mode in modes_list:
            data = mode_table[mode][h]
            kw = int(data['kw'] * SCALE)
            # P >= x[h, mode] * kw
            model.Add(P >= kw).OnlyEnforceIf(x[h, mode])
            
    # Mode Changes — one BoolVar per (h, mode) reused for both the objective cost
    # and Rule B (minimum 2-hour duration), avoiding duplicate variables.
    # started[h, mode] == 1  iff  x[h, mode] == 1 AND x[h-1, mode] == 0
    started = {}
    for h in range(1, H):
        for mode in modes_list:
            bv = model.NewBoolVar(f'started_{h}_{mode}')
            model.Add(x[h, mode] - x[h-1, mode] == 1).OnlyEnforceIf(bv)
            model.Add(x[h, mode] - x[h-1, mode] <= 0).OnlyEnforceIf(bv.Not())
            started[h, mode] = bv

    # Total switch cost: sum all start events, weighted by gamma_switch.
    # Use a dedicated IntVar so OR-Tools builds the linear expression correctly
    # (avoids the fragile Python sum(BoolVars) * int(...) pattern).
    gamma_scaled = int(gamma_switch * SCALE)
    switch_cost = model.NewIntVar(0, H * M * gamma_scaled, 'switch_cost')
    model.Add(switch_cost == gamma_scaled * sum(started.values()))

    model.Minimize(total_energy + P * int(lambda_peak) + switch_cost + total_violations)

    # 3. Rules
    # Rule A: The current hour h0 (index 0) is fixed to last_h0_mode (or Maintain)
    if not last_h0_mode or last_h0_mode not in modes_list:
        last_h0_mode = "Maintain"
    model.Add(x[0, last_h0_mode] == 1)

    # Rule B: Minimum duration of 2 hours.
    # Reuse the started BoolVars computed above — if a mode starts at h, it must
    # still be active at h+1.
    for h in range(1, H - 1):
        for mode in modes_list:
            model.Add(x[h+1, mode] == 1).OnlyEnforceIf(started[h, mode])
            
    # If h=0 just started (differs from last_mode), h=1 must be the same
    if last_mode and last_mode != last_h0_mode:
        model.Add(x[1, last_h0_mode] == 1)
        
    # Rule C: Peak window for Reduce HVAC
    for h in range(1, H):
        clock_h = local_hours[h]
        clock_prev = local_hours[h-1]
        
        is_peak = peak_start_h <= clock_h < peak_end_h
        is_prev_peak = peak_start_h <= clock_prev < peak_end_h
        
        if is_peak:
            # Reduce HVAC at hour h needs Reduce or Shift Load at h-1
            # If h is the first window hour, it needs Shift Load at h-1
            if not is_prev_peak:
                # First window hour
                model.Add(x[h-1, 'Shift Load'] == 1).OnlyEnforceIf(x[h, 'Reduce HVAC'])
            else:
                # Needs Reduce or Shift at h-1
                # x[h, Reduce] => x[h-1, Reduce] + x[h-1, Shift Load] >= 1
                model.Add(x[h-1, 'Reduce HVAC'] + x[h-1, 'Shift Load'] >= 1).OnlyEnforceIf(x[h, 'Reduce HVAC'])
                
    # Rule D: Shift Load at hour h needs Shift Load at h+1, or rise in headcount at h+1, or h+1 inside peak window
    for h in range(H - 1):
        clock_next = local_hours[h+1]
        next_is_peak = peak_start_h <= clock_next < peak_end_h
        headcount_rises = headcount[h+1] > headcount[h]
        
        if not next_is_peak and not headcount_rises:
            # Must have Shift Load at h+1
            model.Add(x[h+1, 'Shift Load'] == 1).OnlyEnforceIf(x[h, 'Shift Load'])
            
    # 4. Solve
    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = 10.0
    status = solver.Solve(model)
    
    if status in [cp_model.OPTIMAL, cp_model.FEASIBLE]:
        schedule = []
        for h in range(H):
            for mode in modes_list:
                if solver.Value(x[h, mode]) == 1:
                    schedule.append(mode)
                    break
        return schedule
    else:
        # Fallback if somehow infeasible (should not happen with soft constraints)
        return ["Maintain"] * H
