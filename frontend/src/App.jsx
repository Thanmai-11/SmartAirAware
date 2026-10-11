import { useState, useEffect, useCallback } from 'react'
import Dashboard from './pages/Dashboard.jsx'
import Settings from './pages/Settings.jsx'
import History from './pages/History.jsx'
import { api } from './api.js'

export default function App() {
  const hash = () => window.location.hash.replace('#', '') || 'dashboard'
  const [page, setPage]     = useState(hash)
  const [apiOk, setApiOk]   = useState(null)

  const go = (p) => {
    window.location.hash = p === 'dashboard' ? '' : p
    setPage(p)
  }

  // poll API health every 30 s
  const checkHealth = useCallback(async () => {
    try { await api.health(); setApiOk(true) }
    catch { setApiOk(false) }
  }, [])

  useEffect(() => {
    checkHealth()
    const t = setInterval(checkHealth, 30_000)
    return () => clearInterval(t)
  }, [checkHealth])

  useEffect(() => {
    const handler = () => setPage(hash())
    window.addEventListener('hashchange', handler)
    return () => window.removeEventListener('hashchange', handler)
  }, [])

  const tabs = [
    { id: 'dashboard', label: '📅 Schedule' },
    { id: 'history',   label: '🕒 History'  },
    { id: 'settings',  label: '⚙️ Settings' },
  ]

  return (
    <div className="app">
      <nav className="topbar" aria-label="Main navigation">
        <div className="brand">
          <span className="brand-icon">🌬️</span>
          SmartAirAware
          <span className="brand-sub">HVAC · IAQ Optimizer</span>
        </div>
        <div className="nav-tabs">
          {tabs.map(t => (
            <button
              key={t.id}
              className={`nav-tab${page === t.id ? ' active' : ''}`}
              onClick={() => go(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="topbar-right">
          <div className={`status-pill ${apiOk === true ? 'ok' : apiOk === false ? 'err' : ''}`}>
            <span className="status-dot" />
            {apiOk === true ? 'API online' : apiOk === false ? 'API offline' : 'Checking…'}
          </div>
        </div>
      </nav>

      <main>
        {page === 'dashboard' && <Dashboard />}
        {page === 'history'   && <History />}
        {page === 'settings'  && <Settings />}
      </main>
    </div>
  )
}
