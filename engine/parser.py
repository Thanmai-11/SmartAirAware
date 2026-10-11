import sqlite3
import pandas as pd
from datetime import datetime

def parse_sql(sql_path: str, window_start_date_str: str, start_hour: int = 0):
    """
    Reads eplusout.sql and extracts hourly HVAC electricity (kWh, kW),
    and max/mean zone temperature.
    Slices the 24-hour window from the two-day run starting at start_hour.
    """
    from datetime import timedelta
    dt_start = datetime.fromisoformat(window_start_date_str)
    dt_next = dt_start + timedelta(days=1)
    
    conn = sqlite3.connect(sql_path)
    
    query_dict = """
    SELECT ReportDataDictionaryIndex, KeyValue, Name, Units 
    FROM ReportDataDictionary 
    WHERE ReportingFrequency = 'Hourly'
    """
    rdd = pd.read_sql(query_dict, conn)
    
    hvac_elec_idx = rdd[rdd['Name'].str.lower() == 'electricity:hvac']['ReportDataDictionaryIndex'].tolist()
    if not hvac_elec_idx:
        hvac_elec_idx = rdd[rdd['Name'].str.lower().isin(['cooling:electricity', 'heating:electricity', 'fans:electricity'])]['ReportDataDictionaryIndex'].tolist()
        
    zone_temp_idx = rdd[rdd['Name'].str.lower() == 'zone mean air temperature']['ReportDataDictionaryIndex'].tolist()
    
    query_data = f"""
    SELECT d.ReportDataDictionaryIndex, t.Month, t.Day, t.Hour, d.Value
    FROM ReportData d
    JOIN Time t ON d.TimeIndex = t.TimeIndex
    WHERE d.ReportDataDictionaryIndex IN ({",".join(map(str, hvac_elec_idx + zone_temp_idx))})
    """
    data = pd.read_sql(query_data, conn)
    conn.close()
    
    def map_date(dt):
        m, d = dt.month, dt.day
        if m == 2 and d == 29:
            d = 28
        return m, d

    m1, d1 = map_date(dt_start)
    m2, d2 = map_date(dt_next)

    hours_seq = []
    # Day 1 hours
    for h in range(start_hour + 1, 25):
        hours_seq.append((m1, d1, h, h - 1))
    # Day 2 hours
    for h in range(1, start_hour + 1):
        hours_seq.append((m2, d2, h, h - 1))
        
    results = []
    for m, d, ep_h, l_h in hours_seq:
        h_data = data[(data['Month'] == m) & (data['Day'] == d) & (data['Hour'] == ep_h)]
        
        elec_data = h_data[h_data['ReportDataDictionaryIndex'].isin(hvac_elec_idx)]
        elec_joules = elec_data['Value'].sum()
        # EnergyPlus reports Joules per 1-hour interval.
        # kWh = J / 3,600,000.  For 1-hour intervals kW == kWh numerically,
        # so both values are derived from the same division — kept separate so
        # callers that track peak demand (kW) vs. cumulative energy (kWh) remain
        # semantically correct if interval length ever changes.
        elec_kwh = elec_joules / 3_600_000.0
        elec_kw = elec_kwh  # valid for 1-hour EnergyPlus timestep
        
        temp_data = h_data[h_data['ReportDataDictionaryIndex'].isin(zone_temp_idx)]
        if not temp_data.empty:
            temp_mean = float(temp_data['Value'].mean())
            temp_max = float(temp_data['Value'].max())
            temp_min = float(temp_data['Value'].min())
        else:
            temp_mean = 0.0
            temp_max = 0.0
            temp_min = 0.0
            
        results.append({
            "local_hour": l_h,
            "kwh": elec_kwh,
            "kw": elec_kw,
            "zone_temp_mean_c": temp_mean,
            "zone_temp_max_c": temp_max,
            "zone_temp_min_c": temp_min
        })
        
    return results
