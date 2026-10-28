// The calendar date as read in India — toISOString() would give the UTC date, which is still
// "yesterday" between midnight and 5:30 am IST, so "Today" would pick the wrong day then.
function toDateInputValue(d) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

// Controlled: { from, to } are "YYYY-MM-DD" strings or "". Quick-select buttons just
// fill in the two date fields — the actual filtering always goes through from/to.
export default function DateRangePicker({ from, to, onChange }) {
  function setPreset(daysAgo) {
    const today = new Date();
    const start = new Date(today.getTime() - daysAgo * 24 * 60 * 60 * 1000);
    onChange({ from: toDateInputValue(start), to: toDateInputValue(today) });
  }

  function setToday() {
    const today = toDateInputValue(new Date());
    onChange({ from: today, to: today });
  }

  function clear() {
    onChange({ from: "", to: "" });
  }

  return (
    <div>
      <label>Date range</label>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginTop: 6, marginBottom: 16 }}>
        <input type="date" value={from} max={to || undefined} onChange={(e) => onChange({ from: e.target.value, to })} style={{ width: 150, margin: 0, flex: "0 0 auto" }} />
        <span style={{ color: "var(--ink-soft)", fontSize: 13 }}>to</span>
        <input type="date" value={to} min={from || undefined} onChange={(e) => onChange({ from, to: e.target.value })} style={{ width: 150, margin: 0, flex: "0 0 auto" }} />

        <span style={{ width: 1, alignSelf: "stretch", background: "var(--border)", margin: "0 4px" }} />

        <button type="button" className="secondary" style={{ width: "auto", padding: "6px 10px", fontSize: 12 }} onClick={setToday}>Today</button>
        <button type="button" className="secondary" style={{ width: "auto", padding: "6px 10px", fontSize: 12 }} onClick={() => setPreset(6)}>Last 7 days</button>
        <button type="button" className="secondary" style={{ width: "auto", padding: "6px 10px", fontSize: 12 }} onClick={() => setPreset(29)}>Last 30 days</button>
        <button type="button" className="secondary" style={{ width: "auto", padding: "6px 10px", fontSize: 12 }} onClick={() => setPreset(89)}>Last 3 months</button>
        {(from || to) && (
          <button type="button" className="secondary" style={{ width: "auto", padding: "6px 10px", fontSize: 12 }} onClick={clear}>Clear</button>
        )}
      </div>
    </div>
  );
}
