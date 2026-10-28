import { useEffect, useState } from "react";
import { BarChart3, Download } from "lucide-react";
import api from "../api/client";
import DateRangePicker from "./DateRangePicker";
import EmptyState from "./EmptyState";

// Admin → Reports. Pick a report, a date range (and optionally one marketing person); the server
// does the counting (backend/src/utils/reports.js) and sends back a generic shape —
// { summary, sections: [{ columns, rows }], notes } — that is drawn here and exported to Excel / PDF
// by the same server code, so the screen and the downloads always agree.

function istDay(daysAgo = 0) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(Date.now() - daysAgo * 86400000));
}

// Mirrors formatCell() in backend/src/utils/reports.js
function formatDuration(hours) {
  if (hours === null || hours === undefined || Number.isNaN(hours)) return "—";
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))} min`;
  if (hours < 48) return `${hours.toFixed(1)} h`;
  return `${(hours / 24).toFixed(1)} days`;
}
function formatCell(type, value) {
  if (value === null || value === undefined || value === "") return "—";
  switch (type) {
    case "int": return Number(value).toLocaleString("en-IN");
    case "pct": return `${value}%`;
    case "pts": return `${Number(value).toLocaleString("en-IN", { maximumFractionDigits: 2 })} pts`;
    case "duration": return formatDuration(value);
    default: return String(value);
  }
}

function Cell({ column, value }) {
  if (column.type === "pct" && value !== null && value !== undefined) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 8 }}>
        <div style={{ width: 56, height: 6, borderRadius: 3, background: "var(--navy-50)", overflow: "hidden" }}>
          <div style={{ width: `${Math.max(0, Math.min(100, value))}%`, height: "100%", background: "var(--teal-500)" }} />
        </div>
        <span>{value}%</span>
      </div>
    );
  }
  return <>{formatCell(column.type, value)}</>;
}

export default function ReportsPanel() {
  const [reports, setReports] = useState([]);
  const [people, setPeople] = useState([]);
  const [reportKey, setReportKey] = useState("funnel");
  const [from, setFrom] = useState(istDay(29));
  const [to, setTo] = useState(istDay(0));
  const [marketingPersonId, setMarketingPersonId] = useState("");
  const [includeDirect, setIncludeDirect] = useState(false);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [exporting, setExporting] = useState("");

  useEffect(() => {
    api.get("/reports").then((r) => setReports(r.data)).catch(() => setError("Couldn't load the list of reports"));
    api.get("/marketing-persons/lite").then((r) => setPeople(r.data)).catch(() => {});
  }, []);

  const current = reports.find((r) => r.key === reportKey);
  const params = { from, to, marketingPersonId: marketingPersonId || undefined, includeDirect: current?.usesCohort && includeDirect ? true : undefined };

  useEffect(() => {
    if (!from || !to) { setData(null); return undefined; }
    let cancelled = false;
    setLoading(true);
    setError("");
    api
      .get(`/reports/${reportKey}`, { params: { from, to, marketingPersonId: marketingPersonId || undefined, includeDirect: includeDirect || undefined } })
      .then((res) => { if (!cancelled) setData(res.data); })
      .catch((err) => { if (!cancelled) { setData(null); setError(err.response?.data?.error || "Couldn't build this report"); } })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [reportKey, from, to, marketingPersonId, includeDirect]);

  async function exportReport(format) {
    setExporting(format);
    setError("");
    try {
      const res = await api.get(`/reports/${reportKey}/export`, { params: { ...params, format }, responseType: "blob" });
      const url = URL.createObjectURL(new Blob([res.data]));
      const a = document.createElement("a");
      a.href = url;
      a.download = `report-${reportKey}-${from}-to-${to}.${format === "pdf" ? "pdf" : "xlsx"}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      setError("Couldn't export this report");
    } finally {
      setExporting("");
    }
  }

  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10, marginBottom: 20 }}>
        {reports.map((r) => {
          const selected = r.key === reportKey;
          return (
            <div
              key={r.key}
              role="button"
              tabIndex={0}
              onClick={() => setReportKey(r.key)}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setReportKey(r.key); } }}
              style={{
                cursor: "pointer", padding: "12px 14px", borderRadius: 12,
                border: `1.5px solid ${selected ? "var(--teal-500)" : "var(--border)"}`,
                background: selected ? "var(--teal-50)" : "#fff",
              }}
            >
              <div style={{ fontWeight: 700, fontSize: 14, color: "var(--navy-700)" }}>{r.title}</div>
              <div style={{ fontSize: 12, color: "var(--ink-soft)", marginTop: 3, lineHeight: 1.35 }}>{r.description}</div>
            </div>
          );
        })}
      </div>

      <div className="card" style={{ marginBottom: 20 }}>
        <DateRangePicker from={from} to={to} onChange={({ from: f, to: t }) => { setFrom(f); setTo(t); }} />

        <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "flex-end" }}>
          <div style={{ minWidth: 220 }}>
            <label>Marketing person</label>
            <select value={marketingPersonId} onChange={(e) => setMarketingPersonId(e.target.value)} style={{ margin: "6px 0 0" }}>
              <option value="">All marketing people</option>
              {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>

          {current?.usesCohort && (
            <label style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 500, margin: "0 0 10px", cursor: "pointer" }}>
              <input type="checkbox" checked={includeDirect} onChange={(e) => setIncludeDirect(e.target.checked)} style={{ width: "auto", margin: 0 }} />
              Include imported &amp; manually added patients
            </label>
          )}

          <div style={{ display: "flex", gap: 8, marginLeft: "auto" }}>
            <button className="secondary" style={{ width: "auto", padding: "8px 14px" }} disabled={!data || Boolean(exporting)} onClick={() => exportReport("excel")}>
              <Download size={14} />{exporting === "excel" ? "Preparing…" : "Excel"}
            </button>
            <button className="secondary" style={{ width: "auto", padding: "8px 14px" }} disabled={!data || Boolean(exporting)} onClick={() => exportReport("pdf")}>
              <Download size={14} />{exporting === "pdf" ? "Preparing…" : "PDF"}
            </button>
          </div>
        </div>
      </div>

      {error && <div className="error">{error}</div>}
      {!from || !to ? (
        <EmptyState icon={BarChart3} title="Choose a date range" subtitle="Pick a start and end date above to build the report" />
      ) : loading && !data ? (
        <p style={{ color: "var(--ink-soft)" }}>Building report…</p>
      ) : data ? (
        <div style={{ opacity: loading ? 0.55 : 1, transition: "opacity 0.15s ease" }}>
          <h3 style={{ margin: "0 0 4px" }}>{data.title}</h3>
          <p style={{ margin: "0 0 16px", fontSize: 13, color: "var(--ink-soft)" }}>
            {data.usesCohort
              ? "Counts the leads that came in during these dates, and what has become of them."
              : "Counts what happened during these dates."}
          </p>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12, marginBottom: 20 }}>
            {data.summary.map((s) => (
              <div key={s.label} className="stat-card" style={{ minWidth: 0 }}>
                <div className="stat-label">{s.label}</div>
                <div className="stat-value" style={{ fontSize: 22, overflowWrap: "anywhere" }}>{s.display}</div>
                {s.sub && <div style={{ fontSize: 11.5, color: "var(--ink-soft)", marginTop: 2 }}>{s.sub}</div>}
              </div>
            ))}
          </div>

          {data.sections.map((section) => (
            <div key={section.title} className="card" style={{ marginBottom: 16 }}>
              <h4 style={{ margin: 0 }}>{section.title}</h4>
              {section.note && <p style={{ margin: "4px 0 0", fontSize: 12.5, color: "var(--ink-soft)" }}>{section.note}</p>}
              {section.rows.length === 0 ? (
                <p style={{ color: "var(--ink-soft)", fontSize: 13.5, marginBottom: 0 }}>No data in this period.</p>
              ) : (
                <div className="table-wrap" style={{ maxHeight: 420, overflowY: "auto" }}>
                  <table>
                    <thead>
                      <tr>
                        {section.columns.map((c) => (
                          <th key={c.key} style={{ textAlign: c.type === "text" ? "left" : "right" }}>{c.label}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {section.rows.map((row, i) => (
                        <tr key={i}>
                          {section.columns.map((c, ci) => (
                            <td key={c.key} style={{ textAlign: c.type === "text" ? "left" : "right", fontWeight: ci === 0 ? 600 : 400 }}>
                              <Cell column={c} value={row[c.key]} />
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          ))}

          {data.notes.length > 0 && (
            <div style={{ fontSize: 12.5, color: "var(--ink-soft)", lineHeight: 1.5, padding: "0 4px 20px" }}>
              {data.notes.map((n, i) => <p key={i} style={{ margin: "0 0 6px" }}>• {n}</p>)}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
