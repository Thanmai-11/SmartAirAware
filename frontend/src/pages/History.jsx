import { useState, useEffect } from 'react'
import { api } from '../api.js'
import { fmtDateTime } from '../util.js'

export default function History() {
  const [runs, setRuns]     = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]   = useState(null)

  useEffect(() => {
    api.runs()
      .then(r => { setRuns(r ?? []); setLoading(false) })
      .catch(e => { setError(e.message); setLoading(false) })
  }, [])

  if (loading) return <div className="page"><div className="empty"><span className="spinner" /></div></div>
  if (error)   return <div className="page"><div className="error-box">⚠️ {error}</div></div>

  return (
    <div className="page">
      <div className="section-head" style={{ marginBottom: '1rem' }}>
        <h2>Run History</h2>
        <span className="sub">Last 50 pipeline executions</span>
      </div>
      {runs.length === 0
        ? <div className="empty">No runs yet.</div>
        : (
          <div className="runs-list">
            {runs.map(r => (
              <div className="run-row" key={r.id}>
                <span className={`run-status ${r.status}`}>{r.status}</span>
                <span className="run-id">{r.id.slice(0, 16)}…</span>
                <span>Started: <strong>{fmtDateTime(r.started_utc)}</strong></span>
                {r.ended_utc && <span>Ended: <strong>{fmtDateTime(r.ended_utc)}</strong></span>}
                {r.window_start_utc && (
                  <span style={{ color: 'var(--muted)', fontSize: '.72rem' }}>
                    Window: {fmtDateTime(r.window_start_utc)}
                  </span>
                )}
                {r.stale_forecast && (
                  <span style={{ color: 'var(--warn)', fontSize: '.72rem' }}>⚠ stale forecast</span>
                )}
                {r.error_text && (
                  <span style={{ color: 'var(--danger)', fontSize: '.72rem', flex: '1 0 100%' }}>
                    {r.error_text}
                  </span>
                )}
              </div>
            ))}
          </div>
        )
      }
    </div>
  )
}
