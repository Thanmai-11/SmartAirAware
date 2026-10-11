import { useState, useEffect, useCallback } from 'react'
import { api } from '../api.js'
import { fmtDateTime } from '../util.js'

const ADMIN_KEY_STORAGE = 'smartair_admin_key'

export default function History() {
  const [runs, setRuns]       = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(null)
  const [adminKey]            = useState(() => localStorage.getItem(ADMIN_KEY_STORAGE) ?? '')
  const [clearing, setClearing] = useState(null)   // 'failed' | 'all' | null
  const [clearMsg, setClearMsg] = useState(null)
  const [confirm, setConfirm]   = useState(null)   // 'failed' | 'all' | null

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try { setRuns(await api.runs() ?? []) }
    catch (e) { setError(e.message) }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  const clearRuns = async (scope) => {
    setConfirm(null)
    setClearing(scope)
    setClearMsg(null)
    try {
      const data = scope === 'all'
        ? await api.clearAll(adminKey)
        : await api.clearFailed(adminKey)
      setClearMsg({ ok: true, text: data.message })
      await load()
    } catch (e) {
      setClearMsg({ ok: false, text: e.message })
    } finally {
      setClearing(null)
    }
  }

  const failedCount   = runs?.filter(r => r.status === 'failed').length ?? 0
  const successCount  = runs?.filter(r => r.status === 'success').length ?? 0

  if (loading) return <div className="page"><div className="empty"><span className="spinner" /></div></div>
  if (error)   return <div className="page"><div className="error-box">⚠️ {error}</div></div>

  return (
    <div className="page">
      {/* Header + action buttons */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
        <div>
          <div className="section-head" style={{ marginBottom: 0 }}>
            <h2>Run History</h2>
            <span className="sub">Last 50 pipeline executions</span>
          </div>
          <div style={{ fontSize: '.75rem', color: 'var(--muted)', marginTop: '.2rem' }}>
            {successCount} successful &nbsp;·&nbsp; {failedCount} failed
          </div>
        </div>

        <div style={{ marginLeft: 'auto', display: 'flex', gap: '.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
          {!adminKey && (
            <span style={{ fontSize: '.75rem', color: 'var(--muted)' }}>
              Set admin key in Settings to enable clearing
            </span>
          )}

          {/* Clear failed */}
          {confirm === 'failed' ? (
            <div style={{ display: 'flex', gap: '.4rem', alignItems: 'center' }}>
              <span style={{ fontSize: '.75rem', color: 'var(--warn)' }}>Remove {failedCount} failed runs?</span>
              <button className="btn btn-sm danger" onClick={() => clearRuns('failed')}
                disabled={!!clearing}>Yes, delete</button>
              <button className="btn btn-sm" onClick={() => setConfirm(null)}>Cancel</button>
            </div>
          ) : (
            <button
              className="btn btn-sm"
              onClick={() => setConfirm('failed')}
              disabled={!adminKey || failedCount === 0 || !!clearing}
              title={failedCount === 0 ? 'No failed runs' : `Remove ${failedCount} failed run(s)`}
            >
              {clearing === 'failed' ? <span className="spinner" /> : '🗑 Clear failed'}
              {failedCount > 0 && <span style={{
                background: 'var(--danger)', color: '#fff',
                borderRadius: '99px', padding: '0 5px', fontSize: '.65rem', marginLeft: '.25rem'
              }}>{failedCount}</span>}
            </button>
          )}

          {/* Clear all */}
          {confirm === 'all' ? (
            <div style={{ display: 'flex', gap: '.4rem', alignItems: 'center' }}>
              <span style={{ fontSize: '.75rem', color: 'var(--danger)' }}>Delete ALL {runs.length} runs?</span>
              <button className="btn btn-sm danger" onClick={() => clearRuns('all')}
                disabled={!!clearing}>Yes, delete all</button>
              <button className="btn btn-sm" onClick={() => setConfirm(null)}>Cancel</button>
            </div>
          ) : (
            <button
              className="btn btn-sm"
              onClick={() => setConfirm('all')}
              disabled={!adminKey || !runs?.length || !!clearing}
              title="Delete entire run history"
            >
              {clearing === 'all' ? <span className="spinner" /> : '🗑 Clear all'}
            </button>
          )}

          <button className="btn btn-sm" onClick={load} disabled={loading}>↻ Refresh</button>
        </div>
      </div>

      {/* Feedback message */}
      {clearMsg && (
        <div style={{
          padding: '.5rem .85rem', borderRadius: 7, marginBottom: '.75rem',
          background: clearMsg.ok ? '#1a2e20' : '#3a1a1a',
          border: `1px solid ${clearMsg.ok ? 'var(--accent)' : 'var(--danger)'}`,
          color: clearMsg.ok ? 'var(--accent)' : 'var(--danger)',
          fontSize: '.8rem'
        }}>
          {clearMsg.text}
        </div>
      )}

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
