import { useState, useEffect, useCallback, useRef } from 'react'
import { api, csvUrl, ApiError } from '../api.js'
import { fmtDateTime, fmtTime, modeCls, pmClass, fcPmClass, savingsPct } from '../util.js'
import EnergyChart from '../components/EnergyChart.jsx'
import ModeTimeline from '../components/ModeTimeline.jsx'
import ForecastStrip from '../components/ForecastStrip.jsx'

const ADMIN_KEY_STORAGE = 'smartair_admin_key'

function useAdminKey() {
  const [key, setKey] = useState(() => localStorage.getItem(ADMIN_KEY_STORAGE) ?? '')
  const save = (v) => { setKey(v); localStorage.setItem(ADMIN_KEY_STORAGE, v) }
  return [key, save]
}

export default function Dashboard() {
  const [schedule, setSchedule]   = useState(null)
  const [forecast, setForecast]   = useState(null)
  const [loading, setLoading]     = useState(true)
  const [error, setError]         = useState(null)
  const [running, setRunning]     = useState(false)
  const [runMsg, setRunMsg]       = useState(null)
  const [adminKey, setAdminKey]   = useAdminKey()
  const [showKey, setShowKey]     = useState(false)
  const pollRef                   = useRef(null)

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    setError(null)
    try {
      const [sched, fc] = await Promise.all([api.schedule(), api.forecast()])
      setSchedule(sched)
      setForecast(fc)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
    // auto-refresh every 60 s
    pollRef.current = setInterval(() => load(true), 60_000)
    return () => clearInterval(pollRef.current)
  }, [load])

  const triggerRun = async () => {
    setRunning(true)
    setRunMsg(null)
    try {
      const r = await api.runNow(adminKey)
      setRunMsg({ ok: true, text: `Run queued: ${r.run_id.slice(0, 8)}… — worker will pick it up within 10 s` })
      // poll faster for 2 min to catch the result
      let polls = 0
      const t = setInterval(async () => {
        await load(true)
        if (++polls >= 24) clearInterval(t)
      }, 5_000)
    } catch (e) {
      setRunMsg({ ok: false, text: e.message })
    } finally {
      setRunning(false)
    }
  }

  // find which row is current (nearest past hour)
  const nowIndex = (() => {
    if (!schedule?.schedule?.length) return -1
    const nowMs = Date.now()
    let best = 0
    schedule.schedule.forEach((r, i) => {
      const rMs = new Date(r.datetime + 'Z').getTime()
      if (rMs <= nowMs) best = i
    })
    return best
  })()

  if (loading) return (
    <div className="page"><div className="empty"><span className="spinner" /></div></div>
  )

  if (error && !schedule) return (
    <div className="page">
      <div className="error-box">⚠️ {error}</div>
      <button className="btn primary" onClick={() => load()}>Retry</button>
    </div>
  )

  if (!schedule?.schedule?.length) return (
    <div className="page">
      <div className="empty">
        <p>No schedule data yet.</p>
        <p style={{ marginTop: '.5rem', fontSize: '.8rem' }}>Trigger a run below to generate one.</p>
        <div style={{ marginTop: '1rem' }}>
          {renderRunBar(adminKey, setAdminKey, showKey, setShowKey, running, triggerRun, runMsg)}
        </div>
      </div>
    </div>
  )

  const s = schedule.summary
  const energySaving = savingsPct(s.baseline_kwh, s.optimized_kwh)
  const peakSaving   = savingsPct(s.baseline_peak_kw, s.optimized_peak_kw)
  const comfortPct   = s.occupied_hours > 0
    ? ((s.comfort_hours_met / s.occupied_hours) * 100).toFixed(0)
    : 100

  return (
    <div className="page">
      {/* Run info bar */}
      <div className="run-bar">
        <span>Last run: <strong>{fmtDateTime(schedule.run_time)}</strong></span>
        <span>Forecast age: <strong>{schedule.forecast_age_min} min</strong></span>
        {schedule.stale_forecast && <span className="stale">⚠ Stale forecast</span>}
        <span style={{ marginLeft: 'auto', display: 'flex', gap: '.5rem', alignItems: 'center' }}>
          {renderRunBar(adminKey, setAdminKey, showKey, setShowKey, running, triggerRun, runMsg)}
        </span>
      </div>

      {/* KPI cards */}
      <div className="kpi-grid">
        <KpiCard label="Energy Saved" value={energySaving} unit="%" cls={energySaving > 0 ? 'good' : 'warn'} />
        <KpiCard label="Optimised kWh" value={s.optimized_kwh.toFixed(1)} unit="kWh" cls="blue" />
        <KpiCard label="Peak Demand" value={s.optimized_peak_kw.toFixed(1)} unit="kW"
          cls={s.optimized_peak_kw < s.baseline_peak_kw ? 'good' : 'warn'} />
        <KpiCard label="Peak Reduction" value={peakSaving} unit="%" cls={peakSaving > 0 ? 'good' : 'warn'} />
        <KpiCard label="Comfort Hours" value={`${s.comfort_hours_met}/${s.occupied_hours}`}
          unit={`${comfortPct}%`} cls={comfortPct >= 80 ? 'good' : comfortPct >= 50 ? 'warn' : 'bad'} />
        <KpiCard label="IAQ Violations" value={s.iaq_violations} unit="hours" cls={s.iaq_violations === 0 ? 'good' : 'bad'} />
        <KpiCard label="Flex Demand" value={s.flexible_kw.toFixed(1)} unit="kW avg" cls="blue" />
        <KpiCard label="Baseline kWh" value={s.baseline_kwh.toFixed(1)} unit="kWh" cls="" />
      </div>

      {/* Charts row */}
      <div className="charts-row">
        <EnergyChart schedule={schedule.schedule} />
        <ModeTimeline schedule={schedule.schedule} />
      </div>

      {/* Forecast strip */}
      {forecast?.length > 0 && (
        <div className="card" style={{ marginBottom: '1.25rem' }}>
          <div className="section-head">
            <h2>48-hour Forecast</h2>
            <span className="sub">Delhi · temp (°C) · PM2.5 (µg/m³)</span>
          </div>
          <ForecastStrip forecast={forecast} />
        </div>
      )}

      {/* Schedule table */}
      <div className="card">
        <div className="section-head">
          <h2>24-hour Schedule</h2>
          <span className="sub">All times UTC</span>
          <a href={csvUrl} download className="btn btn-sm" style={{ marginLeft: 'auto' }}>
            ⬇ CSV
          </a>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Time UTC</th>
                <th>Mode</th>
                <th>Action</th>
                <th>Headcount</th>
                <th>Setpoint</th>
                <th>OA (L/s)</th>
                <th>Zone Temp</th>
                <th>Indoor PM2.5</th>
                <th>kW</th>
                <th>Out Temp</th>
                <th>Out PM2.5</th>
              </tr>
            </thead>
            <tbody>
              {schedule.schedule.map((row, i) => (
                <tr key={i} className={i === nowIndex ? 'current' : ''}>
                  <td>
                    {fmtTime(row.datetime)}
                    {i === nowIndex && <span className="now-chip">NOW</span>}
                  </td>
                  <td>
                    <span className={`mode-badge ${modeCls(row.mode_label)}`}>
                      {row.mode_label}
                    </span>
                  </td>
                  <td className="muted">{row.action}</td>
                  <td>{row.headcount}</td>
                  <td>{row.cooling_setpoint_c} °C</td>
                  <td>{row.outdoor_air_lps}</td>
                  <td>{row.expected_zone_temp_c} °C</td>
                  <td className={pmClass(row.expected_indoor_pm25)}>
                    {row.expected_indoor_pm25} µg/m³
                  </td>
                  <td>{row.expected_kw}</td>
                  <td>{row.outdoor_temp_c?.toFixed(1)} °C</td>
                  <td className={pmClass(row.outdoor_pm25)}>
                    {row.outdoor_pm25?.toFixed(1)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

function KpiCard({ label, value, unit, cls }) {
  return (
    <div className={`kpi-card ${cls}`}>
      <div className="label">{label}</div>
      <div className="value">{value}</div>
      {unit && <div className="unit">{unit}</div>}
    </div>
  )
}

function renderRunBar(adminKey, setAdminKey, showKey, setShowKey, running, triggerRun, runMsg) {
  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem' }}>
        <span style={{ fontSize: '.75rem', color: 'var(--muted)', whiteSpace: 'nowrap' }}>Admin key:</span>
        <input
          type={showKey ? 'text' : 'password'}
          value={adminKey}
          onChange={e => setAdminKey(e.target.value)}
          placeholder="paste key…"
          style={{
            background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 6,
            color: 'var(--text)', padding: '.25rem .6rem', fontSize: '.78rem',
            fontFamily: 'monospace', width: 160, outline: 'none'
          }}
        />
        <button className="btn btn-sm" onClick={() => setShowKey(s => !s)} style={{ padding: '.25rem .5rem' }}>
          {showKey ? '🙈' : '👁'}
        </button>
      </div>
      <button className="btn primary btn-sm" onClick={triggerRun} disabled={running}>
        {running ? <span className="spinner" /> : '▶ Run Now'}
      </button>
      {runMsg && (
        <span style={{ fontSize: '.75rem', color: runMsg.ok ? 'var(--accent)' : 'var(--danger)' }}>
          {runMsg.text}
        </span>
      )}
    </>
  )
}
