import {
  ComposedChart, Bar, Cell, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer
} from 'recharts'
import { fmtTime } from '../util.js'

const MODE_COLORS = {
  'Ventilate':   '#58a6ff',
  'Maintain':    '#3fb950',
  'Reduce HVAC': '#d29922',
  'Shift Load':  '#bc8cff',
}

function CustomTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  return (
    <div className="custom-tooltip">
      <div className="tt-label">{label}</div>
      {payload.map((p, i) => (
        <div className="tt-row" key={i}>
          <span>{p.name}</span>
          <span>{typeof p.value === 'number' ? p.value.toFixed(2) : p.value}</span>
        </div>
      ))}
    </div>
  )
}

export default function EnergyChart({ schedule }) {
  const data = schedule.map((r) => ({
    time: fmtTime(r.datetime),
    kW: r.expected_kw,
    PM25: r.expected_indoor_pm25,
    mode: r.mode_label,
    fill: MODE_COLORS[r.mode_label] ?? '#8b949e',
  }))

  return (
    <div className="chart-card">
      <h3>Expected kW &amp; Indoor PM2.5</h3>
      <ResponsiveContainer width="100%" height={220}>
        <ComposedChart data={data} margin={{ top: 4, right: 8, bottom: 4, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="time" tick={{ fontSize: 10 }} interval={3} />
          <YAxis yAxisId="kw"  orientation="left"  tick={{ fontSize: 10 }} unit=" kW" />
          <YAxis yAxisId="pm"  orientation="right" tick={{ fontSize: 10 }} unit=" µg" />
          <Tooltip content={<CustomTooltip />} />
          <Legend wrapperStyle={{ fontSize: 11, paddingTop: 4 }} />
          <Bar yAxisId="kw" dataKey="kW" name="kW" radius={[3,3,0,0]}
            fill="#3fb950" isAnimationActive={false}
          >
            {data.map((d, i) => (
              <Cell key={i} fill={d.fill} />
            ))}
          </Bar>
          <Line yAxisId="pm" type="monotone" dataKey="PM25" name="PM2.5"
            stroke="#f85149" dot={false} strokeWidth={1.5} isAnimationActive={false} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
}
