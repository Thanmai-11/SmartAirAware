import { fmtTime } from '../util.js'

const MODE_COLORS = {
  'Ventilate':   '#58a6ff',
  'Maintain':    '#3fb950',
  'Reduce HVAC': '#d29922',
  'Shift Load':  '#bc8cff',
}

const MODES = ['Ventilate', 'Maintain', 'Reduce HVAC', 'Shift Load']

export default function ModeTimeline({ schedule }) {
  // Build segments: consecutive same-mode hours merged
  const segments = []
  schedule.forEach((r, i) => {
    const last = segments[segments.length - 1]
    if (last && last.mode === r.mode_label) {
      last.end = i + 1
    } else {
      segments.push({ mode: r.mode_label, start: i, end: i + 1 })
    }
  })
  const total = schedule.length

  return (
    <div className="chart-card" style={{ paddingBottom: '1rem' }}>
      <h3>Mode Timeline</h3>

      {/* Gantt bar */}
      <div style={{ display: 'flex', borderRadius: 6, overflow: 'hidden', height: 28, marginBottom: '1rem' }}>
        {segments.map((seg, i) => (
          <div
            key={i}
            title={`${seg.mode} (${fmtTime(schedule[seg.start]?.datetime)}–${fmtTime(schedule[Math.min(seg.end, total-1)]?.datetime)})`}
            style={{
              flex: seg.end - seg.start,
              background: MODE_COLORS[seg.mode] ?? '#8b949e',
              opacity: .85,
              borderRight: i < segments.length - 1 ? '2px solid #0d1117' : 'none',
            }}
          />
        ))}
      </div>

      {/* Hour tick marks */}
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--muted)', marginBottom: '1rem' }}>
        {schedule.filter((_, i) => i % 6 === 0).map((r, i) => (
          <span key={i}>{fmtTime(r.datetime)}</span>
        ))}
        <span>{fmtTime(schedule[schedule.length - 1]?.datetime)}</span>
      </div>

      {/* Legend */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '.5rem' }}>
        {MODES.map(m => (
          <div key={m} style={{ display: 'flex', alignItems: 'center', gap: '.35rem', fontSize: 11 }}>
            <span style={{
              display: 'inline-block', width: 10, height: 10,
              borderRadius: 2, background: MODE_COLORS[m]
            }} />
            {m}
          </div>
        ))}
      </div>

      {/* Per-mode hour count */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '.5rem', marginTop: '.75rem' }}>
        {MODES.map(m => {
          const hrs = schedule.filter(r => r.mode_label === m).length
          if (!hrs) return null
          return (
            <div key={m} style={{
              background: 'var(--surface2)', border: '1px solid var(--border)',
              borderRadius: 6, padding: '.2rem .55rem', fontSize: 11,
              display: 'flex', gap: '.3rem', alignItems: 'center'
            }}>
              <span style={{ color: MODE_COLORS[m], fontWeight: 600 }}>{m}</span>
              <span style={{ color: 'var(--muted)' }}>{hrs}h</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
