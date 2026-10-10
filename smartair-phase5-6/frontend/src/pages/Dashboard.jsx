import { useCallback, useEffect, useMemo, useState } from "react";
import { api, csvUrl } from "../api.js";
import { fmt, formatDateTime, istHour, modeInfo, pad2, parseUtc, rowsOf } from "../util.js";
import ScheduleTable from "../components/ScheduleTable.jsx";
import { ModeStrip, OutdoorChart, IndoorChart, EnergyChart, HeadcountChart } from "../components/Charts.jsx";

const num = (v) => (v == null || v === "" ? null : Number(v));

function normalise(schedule, forecast, settings) {
  const fcMap = new Map();
  rowsOf(forecast).forEach((f) => {
    const d = parseUtc(f.hour_utc ?? f.datetime);
    if (d) fcMap.set(d.getTime(), f);
  });
  const now = Date.now();
  const start = num(settings?.peak_start_h);
  const end = num(settings?.peak_end_h);
  return rowsOf(schedule).map((r) => {
    const t = parseUtc(r.hour_utc ?? r.datetime);
    const h = t ? istHour(t) : null;
    const f = t ? fcMap.get(t.getTime()) : null;
    return {
      ...r,
      t,
      h,
      label: h == null ? "" : `${pad2(h)}:00`,
      m: modeInfo(r.mode ?? r.mode_label),
      isNow: !!t && t.getTime() <= now && now < t.getTime() + 3600_000,
      inPeak: h != null && start != null && end != null && h >= start && h < end,
      temp: num(f?.temp_c ?? r.outdoor_temp_c),
      pm25: num(f?.pm25 ?? r.outdoor_pm25),
      indoor: num(r.expected_indoor_pm25),
      kw: num(r.expected_kw),
      baseline: num(r.baseline_kw), // optional: shown only if the API provides it
    };
  });
}

function Notice({ tone = "info", title, children }) {
  return (
    <div className={`notice ${tone}`} role={tone === "error" ? "alert" : "status"}>
      <strong>{title}</strong> {children}
    </div>
  );
}

function NowBand({ rows }) {
  const idx = Math.max(0, rows.findIndex((r) => r.isNow));
  const cur = rows[idx];
  const next = rows.slice(idx + 1).find((r) => /^change/i.test(r.action ?? ""));
  return (
    <section className="now" style={{ "--mode": cur.m.color }} aria-label="Current instruction">
      <div>
        <p className="now-when">Now, {cur.label}</p>
        <h2>Run in {cur.m.label} mode</h2>
      </div>
      <dl className="now-facts">
        <div><dt>Cooling setpoint</dt><dd>{fmt(cur.cooling_setpoint_c)} °C</dd></div>
        <div><dt>Outdoor air</dt><dd>{fmt(cur.outdoor_air_lps, 0)} L/s</dd></div>
        <div><dt>Next change</dt><dd>{next ? `${next.label}, ${next.m.label}` : "None today"}</dd></div>
      </dl>
    </section>
  );
}

function Stat({ title, value, unit, detail, tone }) {
  return (
    <div className={`stat ${tone ?? ""}`}>
      <h3>{title}</h3>
      <p className="stat-v">{value}{unit && <span className="unit"> {unit}</span>}</p>
      <p className="muted">{detail}</p>
    </div>
  );
}

function Stats({ k, peakLabel }) {
  if (!k) return null;
  const saved = k.baseline_kwh > 0 ? ((k.baseline_kwh - k.optimized_kwh) / k.baseline_kwh) * 100 : null;
  const peakCut = k.baseline_peak_kw > 0 ? ((k.baseline_peak_kw - k.optimized_peak_kw) / k.baseline_peak_kw) * 100 : null;
  return (
    <section className="stats" aria-label="Key results">
      <Stat title="Energy" value={fmt(k.optimized_kwh, 0)} unit="kWh"
        detail={`Baseline ${fmt(k.baseline_kwh, 0)} kWh${saved != null ? `, ${fmt(saved, 0)}% less` : ""}`} />
      <Stat title="Peak power" value={fmt(k.optimized_peak_kw)} unit="kW"
        detail={`Baseline ${fmt(k.baseline_peak_kw)} kW${peakCut != null ? `, ${fmt(peakCut, 0)}% lower` : ""}`} />
      <Stat title="Comfort" value={`${k.comfort_hours_met} of ${k.occupied_hours}`} unit="occupied hours"
        detail="Zone temperature inside your comfort range"
        tone={k.comfort_hours_met < k.occupied_hours ? "warn" : ""} />
      <Stat title="Air quality" value={k.iaq_violations ?? 0} unit={k.iaq_violations === 1 ? "hour over limit" : "hours over limit"}
        detail="Occupied hours with indoor PM2.5 above the limit" tone={k.iaq_violations > 0 ? "warn" : ""} />
      <Stat title="Flexible load" value={fmt(k.flexible_kw)} unit="kW"
        detail={`Average cut during ${peakLabel}`} />
    </section>
  );
}

export default function Dashboard({ onGoSettings }) {
  const [state, setState] = useState({ status: "loading" });

  const load = useCallback(async () => {
    try {
      const [schedule, kpis, forecast, settings, runs] = await Promise.all([
        api.schedule(), api.kpis(), api.forecast(), api.settings(), api.runs().catch(() => null),
      ]);
      setState({ status: "ready", schedule, kpis, forecast, settings, runs, loadedAt: Date.now() });
    } catch (e) {
      setState((prev) =>
        prev.status === "ready" ? { ...prev, refreshError: e.message } : { status: "error", message: e.message }
      );
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 60_000);
    return () => clearInterval(id);
  }, [load]);

  const view = useMemo(() => {
    if (state.status !== "ready") return null;
    const rows = normalise(state.schedule, state.forecast, state.settings);
    const peakRows = rows.filter((r) => r.inPeak);
    const s = state.settings ?? {};
    return {
      rows,
      peak: peakRows.length ? { from: peakRows[0].label, to: peakRows[peakRows.length - 1].label } : null,
      limits: { pm25: Number(s.pm25_limit ?? 35), tmin: Number(s.comfort_min_c ?? 23), tmax: Number(s.comfort_max_c ?? 27) },
      peakLabel: `${pad2(s.peak_start_h ?? 14)}:00 to ${pad2(s.peak_end_h ?? 18)}:00`,
    };
  }, [state]);

  if (state.status === "loading") return <main className="page"><p className="muted" role="status">Loading the latest schedule...</p></main>;
  if (state.status === "error")
    return (
      <main className="page">
        <Notice tone="error" title="Could not load the schedule.">{state.message}</Notice>
        <button className="btn" onClick={load}>Try again</button>
      </main>
    );

  if (!view.rows.length)
    return (
      <main className="page">
        <h1>No schedule yet</h1>
        <p>The first schedule appears after the worker finishes a run. Set the headcount profile, then start a run.</p>
        <button className="btn primary" onClick={onGoSettings}>Go to Settings</button>
      </main>
    );

  const sched = state.schedule ?? {};
  const runList = rowsOf(state.runs);
  const latestRun = [...runList].sort((a, b) => String(b.started_utc).localeCompare(String(a.started_utc)))[0];
  const stale = sched.stale_forecast === true || sched.stale_forecast === 1;
  const kpis = state.kpis ?? sched.summary ?? null;
  const runTime = parseUtc(sched.run_time);
  const maxPeople = Math.max(...view.rows.map((r) => Number(r.headcount) || 0));

  return (
    <main className="page">
      <header className="page-head">
        <div>
          <h1>{sched.building_name ?? sched.building ?? "Office building"}: next 24 hours</h1>
          <p className="muted">
            Updated {formatDateTime(runTime)} IST. Refreshes every minute.
            {maxPeople === 0 && " The headcount profile is empty, so every hour is unoccupied."}
          </p>
        </div>
        <a className="btn" href={csvUrl} download>Download CSV</a>
      </header>

      {stale && (
        <Notice tone="warn" title="Using an older forecast.">
          The weather service could not be reached
          {sched.forecast_age_min != null ? `, so this plan uses a forecast from ${Math.round(sched.forecast_age_min)} minutes ago` : ""}.
          Results update automatically when it comes back.
        </Notice>
      )}
      {latestRun?.status === "failed" && (
        <Notice tone="error" title="The latest run failed.">
          You are seeing the last successful schedule. {latestRun.error_text ?? ""}
        </Notice>
      )}
      {state.refreshError && <Notice tone="warn" title="Could not refresh.">{state.refreshError} Showing the data from the last successful refresh.</Notice>}

      <NowBand rows={view.rows} />
      <Stats k={kpis} peakLabel={view.peakLabel} />
      <ModeStrip rows={view.rows} />

      <h2>Hour-by-hour schedule</h2>
      <ScheduleTable rows={view.rows} limits={view.limits} />

      <h2>Why these choices</h2>
      <div className="charts">
        <OutdoorChart data={view.rows} />
        <IndoorChart data={view.rows} limit={view.limits.pm25} />
        <EnergyChart data={view.rows} peak={view.peak} />
        <HeadcountChart data={view.rows} />
      </div>
    </main>
  );
}
