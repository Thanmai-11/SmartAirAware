import { useState, useEffect } from 'react'
import { api, ApiError } from '../api.js'

const ADMIN_KEY_STORAGE = 'smartair_admin_key'

const SETTINGS_FIELDS = [
  { key: 'comfort_min_c',      label: 'Comfort Min (°C)',      hint: 'Lower temp comfort bound', step: 0.5, min: 16, max: 30 },
  { key: 'comfort_max_c',      label: 'Comfort Max (°C)',      hint: 'Upper temp comfort bound', step: 0.5, min: 20, max: 35 },
  { key: 'pm25_limit',         label: 'PM2.5 Limit (µg/m³)',   hint: 'Indoor air quality limit', step: 1,   min: 5,  max: 150 },
  { key: 'peak_start_h',       label: 'Peak Start Hour',       hint: '24-h clock, e.g. 10',     step: 1,   min: 0,  max: 23 },
  { key: 'peak_end_h',         label: 'Peak End Hour',         hint: '24-h clock, e.g. 17',     step: 1,   min: 0,  max: 24 },
  { key: 'filter_eff',         label: 'Filter Efficiency',     hint: '0–1 fraction',             step: 0.01,min: 0,  max: 1 },
  { key: 'infiltration_ach',   label: 'Infiltration ACH',      hint: 'Air changes per hour',     step: 0.01,min: 0,  max: 2 },
  { key: 'penetration',        label: 'PM2.5 Penetration',     hint: '0–1 fraction',             step: 0.01,min: 0,  max: 1 },
  { key: 'deposition_per_h',   label: 'Deposition Rate (1/h)', hint: 'PM2.5 deposition',        step: 0.01,min: 0,  max: 2 },
  { key: 'person_source_ugps', label: 'Person Source (µg/s)',  hint: 'PM2.5 emitted per person', step: 0.1, min: 0,  max: 50 },
  { key: 'lambda_peak',        label: 'λ Peak Weight',         hint: 'Peak demand cost weight',  step: 0.1, min: 0,  max: 20 },
  { key: 'gamma_switch',       label: 'γ Switch Weight',       hint: 'Mode-change penalty',      step: 0.1, min: 0,  max: 20 },
  { key: 'violation_penalty',  label: 'Violation Penalty',     hint: 'Comfort/IAQ breach cost',  step: 10,  min: 0,  max: 5000 },
]

export default function Settings() {
  const [adminKey, setAdminKey]   = useState(() => localStorage.getItem(ADMIN_KEY_STORAGE) ?? '')
  const [showKey, setShowKey]     = useState(false)
  const [form, setForm]           = useState(null)
  const [occ,  setOcc]            = useState(null)
  const [maxCap, setMaxCap]       = useState(268)
  const [errors, setErrors]       = useState({})
  const [saving, setSaving]       = useState(false)
  const [savingOcc, setSavingOcc] = useState(false)
  const [msg, setMsg]             = useState(null)
  const [occMsg, setOccMsg]       = useState(null)
  const [loadErr, setLoadErr]     = useState(null)

  useEffect(() => {
    Promise.all([api.settings(), api.occupancy()])
      .then(([s, o]) => {
        setForm({ ...s })
        setOcc(o.occupancy.map(r => ({ ...r })))
        setMaxCap(o.max_capacity)
      })
      .catch(e => setLoadErr(e.message))
  }, [])

  const saveAdminKey = (v) => {
    setAdminKey(v)
    localStorage.setItem(ADMIN_KEY_STORAGE, v)
  }

  const handleChange = (key, val) => {
    setForm(f => ({ ...f, [key]: parseFloat(val) }))
    setErrors(e => ({ ...e, [key]: undefined }))
  }

  const saveSettings = async () => {
    setSaving(true); setMsg(null)
    try {
      await api.putSettings(adminKey, form)
      setMsg({ ok: true, text: 'Settings saved.' })
    } catch (e) {
      if (e instanceof ApiError && Object.keys(e.fields).length) setErrors(e.fields)
      setMsg({ ok: false, text: e.message })
    } finally { setSaving(false) }
  }

  const saveOccupancy = async () => {
    setSavingOcc(true); setOccMsg(null)
    try {
      await api.putOccupancy(adminKey, { max_capacity: maxCap, occupancy: occ })
      setOccMsg({ ok: true, text: 'Occupancy saved.' })
    } catch (e) {
      setOccMsg({ ok: false, text: e.message })
    } finally { setSavingOcc(false) }
  }

  if (loadErr) return <div className="page"><div className="error-box">⚠️ {loadErr}</div></div>
  if (!form || !occ) return <div className="page"><div className="empty"><span className="spinner" /></div></div>

  return (
    <div className="page">
      {/* Admin key */}
      <div className="admin-bar">
        <label>Admin Key</label>
        <input
          type={showKey ? 'text' : 'password'}
          value={adminKey}
          onChange={e => saveAdminKey(e.target.value)}
          placeholder="Paste your ADMIN_KEY here…"
        />
        <button className="btn btn-sm" onClick={() => setShowKey(s => !s)}>
          {showKey ? '🙈 Hide' : '👁 Show'}
        </button>
      </div>

      {/* Settings */}
      <div className="card" style={{ marginBottom: '1.25rem' }}>
        <div className="section-head">
          <h2>Optimizer Settings</h2>
        </div>
        <div className="settings-grid">
          {SETTINGS_FIELDS.map(f => (
            <div className="field" key={f.key}>
              <label htmlFor={f.key}>{f.label}</label>
              <input
                id={f.key}
                type="number"
                step={f.step}
                min={f.min}
                max={f.max}
                value={form[f.key] ?? ''}
                onChange={e => handleChange(f.key, e.target.value)}
              />
              {f.hint && <span className="hint">{f.hint}</span>}
              {errors[f.key] && <span className="field-error">{errors[f.key]}</span>}
            </div>
          ))}
        </div>
        <div className="form-actions">
          <button className="btn primary" onClick={saveSettings} disabled={saving}>
            {saving ? <span className="spinner" /> : 'Save Settings'}
          </button>
          {msg && <span className="save-msg" style={{ color: msg.ok ? 'var(--accent)' : 'var(--danger)' }}>{msg.text}</span>}
        </div>
      </div>

      {/* Occupancy */}
      <div className="card">
        <div className="section-head">
          <h2>Occupancy Profile</h2>
          <span className="sub">Headcount per clock hour (0–23)</span>
        </div>
        <div className="field" style={{ maxWidth: 220, marginBottom: '1rem' }}>
          <label>Max Capacity</label>
          <input
            type="number" min={1} step={1}
            value={maxCap}
            onChange={e => setMaxCap(parseInt(e.target.value, 10))}
          />
        </div>
        <div className="occ-grid">
          {occ.map((row, i) => (
            <div className="occ-cell" key={row.hour}>
              <span className="occ-h">{String(row.hour).padStart(2,'0')}:00</span>
              <input
                type="number" min={0} max={maxCap} step={1}
                value={row.headcount}
                onChange={e => {
                  const updated = [...occ]
                  updated[i] = { ...row, headcount: parseInt(e.target.value, 10) || 0 }
                  setOcc(updated)
                }}
              />
            </div>
          ))}
        </div>
        <div className="form-actions">
          <button className="btn primary" onClick={saveOccupancy} disabled={savingOcc}>
            {savingOcc ? <span className="spinner" /> : 'Save Occupancy'}
          </button>
          {occMsg && (
            <span style={{ fontSize: '.78rem', color: occMsg.ok ? 'var(--accent)' : 'var(--danger)' }}>
              {occMsg.text}
            </span>
          )}
        </div>
      </div>
    </div>
  )
}
