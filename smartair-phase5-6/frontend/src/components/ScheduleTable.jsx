import { fmt } from "../util.js";

export default function ScheduleTable({ rows, limits }) {
  const { pm25, tmin, tmax } = limits;
  return (
    <div className="table-wrap">
      <table className="sched">
        <caption className="sr">Hour-by-hour schedule for the next 24 hours</caption>
        <thead>
          <tr>
            <th>Time</th><th>Mode</th><th>Cooling setpoint</th><th>Outdoor air</th>
            <th>Action</th><th>People</th><th>Zone temp</th><th>Indoor PM2.5</th><th>Power</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const occupied = Number(r.headcount) > 0;
            const t = Number(r.expected_zone_temp_c);
            const p = Number(r.expected_indoor_pm25);
            const badT = occupied && r.expected_zone_temp_c != null && (t > tmax || t < tmin);
            const badP = occupied && r.expected_indoor_pm25 != null && p > pm25;
            return (
              <tr key={i} className={r.isNow ? "now-row" : ""} aria-current={r.isNow ? "time" : undefined}>
                <td className="num">{r.label}</td>
                <td><span className="chip" style={{ "--c": r.m.color }}>{r.m.label}</span></td>
                <td className="num">{fmt(r.cooling_setpoint_c)} °C</td>
                <td className="num">{fmt(r.outdoor_air_lps, 0)} L/s</td>
                <td className={/^change|^set/i.test(r.action ?? "") ? "act" : "muted"}>{r.action}</td>
                <td className="num">{r.headcount ?? 0}</td>
                <td className={badT ? "num bad" : "num"} title={badT ? "Outside the comfort range" : undefined}>
                  {fmt(r.expected_zone_temp_c)} °C{badT && <b className="flag"> outside range</b>}
                </td>
                <td className={badP ? "num bad" : "num"} title={badP ? "Above the PM2.5 limit" : undefined}>
                  {fmt(r.expected_indoor_pm25)}{badP && <b className="flag"> over limit</b>}
                </td>
                <td className="num">{fmt(r.expected_kw)} kW</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
