import { useEffect, useRef, useState } from "react";
import { api } from "../api.js";
import { rowsOf, pad2 } from "../util.js";

const KEY_STORE = "smartair_admin_key";

function parseHeadcountCsv(text) {
  const rows = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((l) => l.split(",").map((c) => c.trim()));
  if (!rows.length) throw new Error("The file is empty.");
  const data = Number.isNaN(Number(rows[0][0])) ? rows.slice(1) : rows; // skip a header row
  if (data.length !== 24) throw new Error(`Expected 24 rows, found ${data.length}.`);
  const out = Array(24).fill("");
  data.forEach((c, i) => {
    const hour = c.length > 1 ? Number(c[0]) : i;
    const val = c.length > 1 ? c[1] : c[0];
    if (!Number.isInteger(hour) || hour < 0 || hour > 23) throw new Error(`Row ${i + 1}: hour must be 0 to 23.`);
    out[hour] = val;
  });
  if (out.some((v) => !/^\d+$/.test(v))) throw new Error("Headcounts must be whole numbers for every hour from 0 to 23.");
  return out;
}

function Field({ label, name, value, onChange, errors, step = "any", hint }) {
  const err = errors?.fields?.[name];
  return (
    <label className="field">
      <span>{label}</span>
      <input type="number" step={step} value={value} onChange={(e) => onChange(e.target.value)}
        aria-invalid={!!err} aria-describedby={err ? `${name}-e` : undefined} />
      {hint && <small className="muted">{hint}</small>}
      {err && <small id={`${name}-e`} className="err">{err}</small>}
    </label>
  );
}

function Msg({ ok, err }) {
  if (err) return <p className="err" role="alert">{err.message}</p>;
  if (ok) return <p className="ok" role="status">{ok}</p>;
  return null;
}

export default function Settings() {
  const [adminKey, setAdminKey] = useState(() => localStorage.getItem(KEY_STORE) ?? "");
  const [loadErr, setLoadErr] = useState(null);
  const [loading, setLoading] = useState(true);

  const [maxCap, setMaxCap] = useState("");
  const [hours, setHours] = useState(Array(24).fill(""));
  const [limits, setLimits] = useState({ comfort_min_c: "", comfort_max_c: "", pm25_limit: "", peak_start_h: "", peak_end_h: "" });

  const [occ, setOcc] = useState({}); // { ok, err }
  const [lim, setLim] = useState({});
  const [en, setEn] = useState({});
  const [run, setRun] = useState({});
  const [runStatus, setRunStatus] = useState(null);
  const csvRef = useRef(null);

  useEffect(() => {
    (async () => {
      try {
        const [s, o] = await Promise.all([api.settings(), api.occupancy()]);
        setLimits({
          comfort_min_c: s.comfort_min_c ?? "", comfort_max_c: s.comfort_max_c ?? "", pm25_limit: s.pm25_limit ?? "",
          peak_start_h: s.peak_start_h ?? "", peak_end_h: s.peak_end_h ?? "",
        });
        const list = Array.isArray(o) ? o : o.occupancy ?? o.rows ?? o.hours ?? rowsOf(o);
        const h = Array(24).fill("");
        list.forEach((r) => { if (r.hour >= 0 && r.hour < 24) h[r.hour] = String(r.headcount); });
        setHours(h);
        setMaxCap(String(o.max_capacity ?? s.max_capacity ?? ""));
      } catch (e) {
        setLoadErr(e);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const saveKey = (v) => { setAdminKey(v); localStorage.setItem(KEY_STORE, v); };

  async function saveOccupancy(e) {
    e.preventDefault();
    setOcc({});
    try {
      await api.putOccupancy(adminKey, {
        max_capacity: Number(maxCap),
        occupancy: hours.map((v, hour) => ({ hour, headcount: Number(v) })),
      });
      setOcc({ ok: "Headcount saved. It applies from the next run." });
    } catch (err) { setOcc({ err }); }
  }

  function onCsv(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try { setHours(parseHeadcountCsv(String(reader.result))); setOcc({ ok: "CSV loaded into the table. Review it, then select Save headcount." }); }
      catch (err) { setOcc({ err }); }
    };
    reader.readAsText(file);
    e.target.value = "";
  }

  async function saveLimits(e) {
    e.preventDefault();
    setLim({});
    try {
      const body = Object.fromEntries(Object.entries(limits).map(([k, v]) => [k, Number(v)]));
      await api.putSettings(adminKey, body);
      setLim({ ok: "Limits saved. They apply from the next run." });
    } catch (err) { setLim({ err }); }
  }

  async function uploadEnergy(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setEn({});
    try { await api.uploadEnergy(adminKey, file); setEn({ ok: `Uploaded ${file.name}.` }); }
    catch (err) { setEn({ err }); }
  }

  async function runNow() {
    setRun({}); setRunStatus(null);
    try {
      await api.runNow(adminKey);
      setRun({ ok: "Run queued. The worker starts it within a minute and it takes 2 to 5 minutes." });
      setRunStatus("pending");
    } catch (err) { setRun({ err }); }
  }

  useEffect(() => {
    if (runStatus !== "pending" && runStatus !== "running") return undefined;
    const id = setInterval(async () => {
      try {
        const runs = rowsOf(await api.runs());
        const latest = [...runs].sort((a, b) => String(b.started_utc ?? "").localeCompare(String(a.started_utc ?? "")))[0];
        if (latest) setRunStatus(latest.status === "failed" ? `failed: ${latest.error_text ?? "see the worker log"}` : latest.status);
      } catch { /* keep polling */ }
    }, 10_000);
    return () => clearInterval(id);
  }, [runStatus]);

  if (loading) return <main className="page"><p className="muted" role="status">Loading settings...</p></main>;

  return (
    <main className="page narrow">
      <h1>Settings</h1>
      {loadErr && <div className="notice error" role="alert"><strong>Could not load settings.</strong> {loadErr.message}</div>}

      <section className="panel">
        <h2>Admin key</h2>
        <p className="muted">Needed to save anything on this page. It is stored only in this browser.</p>
        <label className="field"><span>Admin key</span>
          <input type="password" value={adminKey} autoComplete="off" onChange={(e) => saveKey(e.target.value)} />
        </label>
      </section>

      <form className="panel" onSubmit={saveOccupancy}>
        <h2>Headcount by hour</h2>
        <p className="muted">People expected in the building for each clock hour (IST). Each value must be a whole number from 0 up to the maximum capacity.</p>
        <Field label="Maximum capacity" name="max_capacity" value={maxCap} onChange={setMaxCap} errors={occ.err} step="1" />
        <div className="hours">
          {hours.map((v, i) => (
            <label key={i} className="hour">
              <span>{pad2(i)}:00</span>
              <input type="number" min="0" step="1" value={v}
                onChange={(e) => setHours((h) => h.map((x, j) => (j === i ? e.target.value : x)))} />
            </label>
          ))}
        </div>
        <div className="row">
          <button className="btn primary" type="submit">Save headcount</button>
          <button className="btn" type="button" onClick={() => csvRef.current?.click()}>Upload CSV</button>
          <input ref={csvRef} type="file" accept=".csv,text/csv" hidden onChange={onCsv} />
        </div>
        <p className="muted">CSV format: 24 rows, either <code>hour,headcount</code> or one headcount per line starting at 00:00.</p>
        <Msg ok={occ.ok} err={occ.err} />
      </form>

      <form className="panel" onSubmit={saveLimits}>
        <h2>Comfort, air quality and peak window</h2>
        <div className="grid2">
          <Field label="Comfort minimum (°C)" name="comfort_min_c" value={limits.comfort_min_c} onChange={(v) => setLimits({ ...limits, comfort_min_c: v })} errors={lim.err} />
          <Field label="Comfort maximum (°C)" name="comfort_max_c" value={limits.comfort_max_c} onChange={(v) => setLimits({ ...limits, comfort_max_c: v })} errors={lim.err} />
          <Field label="PM2.5 limit (µg/m³)" name="pm25_limit" value={limits.pm25_limit} onChange={(v) => setLimits({ ...limits, pm25_limit: v })} errors={lim.err} />
          <span />
          <Field label="Peak window starts (hour)" name="peak_start_h" value={limits.peak_start_h} step="1" onChange={(v) => setLimits({ ...limits, peak_start_h: v })} errors={lim.err} hint="0 to 23" />
          <Field label="Peak window ends (hour)" name="peak_end_h" value={limits.peak_end_h} step="1" onChange={(v) => setLimits({ ...limits, peak_end_h: v })} errors={lim.err} hint="Must be after the start" />
        </div>
        <div className="row"><button className="btn primary" type="submit">Save limits</button></div>
        <Msg ok={lim.ok} err={lim.err} />
      </form>

      <section className="panel">
        <h2>Past energy data</h2>
        <p className="muted">Optional. CSV with the columns <code>hour</code> and <code>kWh</code>.</p>
        <label className="btn">Upload energy CSV<input type="file" accept=".csv,text/csv" hidden onChange={uploadEnergy} /></label>
        <Msg ok={en.ok} err={en.err} />
      </section>

      <section className="panel">
        <h2>Run now</h2>
        <p className="muted">Builds a fresh schedule from the latest forecast instead of waiting for the next hourly run.</p>
        <button className="btn primary" onClick={runNow}>Run now</button>
        <Msg ok={run.ok} err={run.err} />
        {runStatus && <p role="status">Run status: <strong>{runStatus}</strong>{runStatus === "success" && " Open the Schedule tab to see it."}</p>}
      </section>
    </main>
  );
}
