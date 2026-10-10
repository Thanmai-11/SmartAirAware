export const TZ = "Asia/Kolkata";

export function parseUtc(v) {
  if (v == null) return null;
  if (v instanceof Date) return v;
  let s = String(v);
  if (!/[zZ]|[+-]\d\d:?\d\d$/.test(s)) s = s.replace(" ", "T") + "Z"; // server stores UTC
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

const hourFmt = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", hour12: false });
export const istHour = (d) => Number(hourFmt.format(d)) % 24;

const dtFmt = new Intl.DateTimeFormat("en-GB", {
  timeZone: TZ, day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: false,
});
export const formatDateTime = (d) => (d ? dtFmt.format(d) : "-");

export const pad2 = (n) => String(n).padStart(2, "0");
export const fmt = (n, digits = 1) =>
  n == null || Number.isNaN(Number(n)) ? "-" : Number(n).toFixed(digits);

export const MODES = {
  ventilate: { key: "ventilate", label: "Ventilate", color: "#3C9D8F" },
  maintain: { key: "maintain", label: "Maintain", color: "#8FA0AA" },
  reduce: { key: "reduce", label: "Reduce HVAC", color: "#D9902F" },
  shift: { key: "shift", label: "Shift Load", color: "#5B6FD1" },
};

export function modeInfo(mode) {
  const s = String(mode ?? "").toLowerCase();
  if (s.includes("vent")) return MODES.ventilate;
  if (s.includes("reduce")) return MODES.reduce;
  if (s.includes("shift")) return MODES.shift;
  return MODES.maintain;
}

export const rowsOf = (data) =>
  Array.isArray(data) ? data : data?.rows ?? data?.schedule ?? data?.items ?? data?.runs ?? [];
