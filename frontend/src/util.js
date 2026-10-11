export function fmtTime(isoStr) {
  if (!isoStr) return '—'
  const d = new Date(isoStr + (isoStr.endsWith('Z') ? '' : 'Z'))
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })
}

export function fmtDateTime(isoStr) {
  if (!isoStr) return '—'
  const d = new Date(isoStr + (isoStr.endsWith('Z') ? '' : 'Z'))
  return d.toLocaleString([], {
    month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: false,
  })
}

export function modeCls(label) {
  return label?.replace(/\s+/g, '') ?? ''
}

export function pmClass(pm25) {
  if (pm25 === null || pm25 === undefined) return ''
  if (pm25 <= 12)  return 'pm-good'
  if (pm25 <= 35)  return 'pm-mod'
  return 'pm-bad'
}

export function fcPmClass(pm25) {
  // WHO / US-AQI breakpoints for outdoor PM2.5 colour coding on forecast strip
  if (pm25 <= 12)  return 'good'   // Good
  if (pm25 <= 35)  return 'mod'    // Moderate
  return 'bad'                     // Unhealthy+
}

export function tempColor(t) {
  if (t === null || t === undefined) return '#8b949e'
  if (t < 22) return '#58a6ff'
  if (t < 26) return '#3fb950'
  return '#d29922'
}

export function savingsPct(baseline, optimized) {
  if (!baseline) return 0
  return ((baseline - optimized) / baseline * 100).toFixed(1)
}
