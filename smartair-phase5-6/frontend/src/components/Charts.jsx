import {
  ResponsiveContainer, ComposedChart, Line, Bar, XAxis, YAxis, Tooltip,
  CartesianGrid, ReferenceLine, ReferenceArea, Legend,
} from "recharts";
import { MODES } from "../util.js";

const AXIS = { fontSize: 12, fill: "#4C6068" };
const GRID = "#E1E8EB";

function Frame({ title, note, children }) {
  return (
    <figure className="chart">
      <figcaption>
        <h3>{title}</h3>
        {note && <p className="muted">{note}</p>}
      </figcaption>
      <div className="chart-body">
        <ResponsiveContainer width="100%" height={230}>{children}</ResponsiveContainer>
      </div>
    </figure>
  );
}

/** 24 coloured cells, one per hour, each holding a bar for that hour's headcount. */
export function ModeStrip({ rows }) {
  const maxPeople = Math.max(1, ...rows.map((r) => Number(r.headcount) || 0));
  return (
    <section className="strip-wrap" aria-label="Mode for each hour">
      <div className="strip-head">
        <h2>Mode by hour</h2>
        <ul className="legend">
          {Object.values(MODES).map((m) => (
            <li key={m.key}><i style={{ background: m.color }} />{m.label}</li>
          ))}
        </ul>
      </div>
      <div className="strip" role="list">
        {rows.map((r, i) => (
          <div
            key={i}
            role="listitem"
            className={r.isNow ? "cell now" : "cell"}
            style={{ background: r.m.color }}
            title={`${r.label}  ${r.m.label}  ${r.headcount ?? 0} people`}
          >
            <span className="bar" style={{ height: `${((Number(r.headcount) || 0) / maxPeople) * 100}%` }} />
          </div>
        ))}
      </div>
      <div className="strip-axis" aria-hidden="true">
        {rows.map((r, i) => (<span key={i}>{i % 3 === 0 ? r.label.slice(0, 2) : ""}</span>))}
      </div>
      <p className="muted">White bars show how many people are in the building each hour.</p>
    </section>
  );
}

export function OutdoorChart({ data }) {
  return (
    <Frame title="Outdoor temperature and PM2.5" note="From the forecast used for this schedule.">
      <ComposedChart data={data} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis dataKey="label" tick={AXIS} interval={2} />
        <YAxis yAxisId="t" tick={AXIS} unit=" °C" width={56} />
        <YAxis yAxisId="p" orientation="right" tick={AXIS} unit=" µg" width={56} />
        <Tooltip />
        <Legend />
        <Line yAxisId="t" dataKey="temp" name="Temperature (°C)" stroke="#2B7AA6" strokeWidth={2} dot={false} />
        <Line yAxisId="p" dataKey="pm25" name="Outdoor PM2.5 (µg/m³)" stroke="#B5483A" strokeWidth={2} dot={false} />
      </ComposedChart>
    </Frame>
  );
}

export function IndoorChart({ data, limit }) {
  return (
    <Frame title="Expected indoor PM2.5" note="Dashed line is your PM2.5 limit.">
      <ComposedChart data={data} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis dataKey="label" tick={AXIS} interval={2} />
        <YAxis tick={AXIS} unit=" µg" width={56} />
        <Tooltip />
        <Line dataKey="indoor" name="Indoor PM2.5 (µg/m³)" stroke="#3C9D8F" strokeWidth={2} dot={false} />
        {limit != null && (
          <ReferenceLine y={Number(limit)} stroke="#C23B3B" strokeDasharray="5 4"
            label={{ value: `Limit ${limit}`, fill: "#C23B3B", fontSize: 12, position: "insideTopRight" }} />
        )}
      </ComposedChart>
    </Frame>
  );
}

export function EnergyChart({ data, peak }) {
  const hasBaseline = data.some((d) => d.baseline != null);
  return (
    <Frame title="Power by hour" note="Shaded band is the peak window.">
      <ComposedChart data={data} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis dataKey="label" tick={AXIS} interval={2} />
        <YAxis tick={AXIS} unit=" kW" width={60} />
        <Tooltip />
        <Legend />
        {peak && <ReferenceArea x1={peak.from} x2={peak.to} fill="#D9902F" fillOpacity={0.14} />}
        {hasBaseline && (
          <Line type="stepAfter" dataKey="baseline" name="Baseline (always Maintain)" stroke="#8FA0AA"
            strokeDasharray="5 4" strokeWidth={2} dot={false} />
        )}
        <Line type="stepAfter" dataKey="kw" name="Optimized" stroke="#14262E" strokeWidth={2.5} dot={false} />
      </ComposedChart>
    </Frame>
  );
}

export function HeadcountChart({ data }) {
  return (
    <Frame title="People in the building">
      <ComposedChart data={data} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis dataKey="label" tick={AXIS} interval={2} />
        <YAxis tick={AXIS} width={48} allowDecimals={false} />
        <Tooltip />
        <Bar dataKey="headcount" name="People" fill="#9FB4BD" radius={[3, 3, 0, 0]} />
      </ComposedChart>
    </Frame>
  );
}
