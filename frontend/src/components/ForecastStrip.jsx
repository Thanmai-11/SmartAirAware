import { fmtTime, fcPmClass } from '../util.js'

export default function ForecastStrip({ forecast }) {
  return (
    <div className="forecast-strip">
      {forecast.map((f, i) => (
        <div className="fc-card" key={i}>
          <span className="fc-time">{fmtTime(f.hour_utc)}</span>
          <span className="fc-temp">{f.temp_c?.toFixed(0)}°</span>
          <span className="fc-rh" style={{ fontSize: '.65rem', color: 'var(--muted)' }}>
            {f.rh_pct?.toFixed(0)}% RH
          </span>
          <span className={`fc-pm ${fcPmClass(f.pm25)}`}>
            PM {f.pm25?.toFixed(0)}
          </span>
        </div>
      ))}
    </div>
  )
}
