import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { Search, ChevronLeft, ChevronRight, TrendingUp, Users } from "lucide-react";
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";
import api from "../api/client";
import { formatDateTime } from "../utils/date";

const STATUS_LABELS = {
  CARD_REVIEW: "Card being verified",
  PENDING: "Awaiting patient arrival",
  CREDITED: "Confirmed & admitted",
  REJECTED: "Not matched / rejected",
};
const HISTORY_PAGE_SIZE = 8;
const GENDER_LABELS = { MALE: "Male", FEMALE: "Female", OTHER: "Other" };
const GENDER_COLORS = { MALE: "var(--teal-500)", FEMALE: "#db2777", OTHER: "#7c3aed" };

export default function DoctorDashboard() {
  const { doctorCode } = useParams();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [showQr, setShowQr] = useState(false);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);

  async function load() {
    setLoading(true);
    setNotFound(false);
    try {
      const res = await api.get(`/doctors/public/${doctorCode}`);
      setData(res.data);
    } catch {
      setNotFound(true);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [doctorCode]);

  if (loading) {
    return <div className="container" style={{ paddingTop: 60 }}><p>Loading…</p></div>;
  }

  if (notFound || !data) {
    return (
      <div className="container" style={{ paddingTop: 60 }}>
        <div className="card">
          <h2>Link not found</h2>
          <p>This dashboard link isn't valid, or the doctor account is inactive. Please check the link or contact the hospital admin.</p>
        </div>
      </div>
    );
  }

  const { doctor, referrals, stats } = data;
  const filteredReferrals = search
    ? referrals.filter((r) => r.patientName.toLowerCase().includes(search.toLowerCase()))
    : referrals;
  const pageCount = Math.max(1, Math.ceil(filteredReferrals.length / HISTORY_PAGE_SIZE));

  // 14-day lead trend, computed client-side from the already-loaded history
  const trend = [];
  for (let i = 13; i >= 0; i--) {
    const day = new Date();
    day.setHours(0, 0, 0, 0);
    day.setDate(day.getDate() - i);
    const next = new Date(day.getTime() + 24 * 60 * 60 * 1000);
    const count = referrals.filter((r) => {
      const t = new Date(r.createdAt);
      return t >= day && t < next;
    }).length;
    trend.push({ label: `${String(day.getDate()).padStart(2, "0")}/${String(day.getMonth() + 1).padStart(2, "0")}`, count });
  }

  // Gender breakdown across all submitted leads
  const genderCounts = { MALE: 0, FEMALE: 0, OTHER: 0, unspecified: 0 };
  referrals.forEach((r) => {
    if (r.patientGender && genderCounts[r.patientGender] !== undefined) genderCounts[r.patientGender] += 1;
    else genderCounts.unspecified += 1;
  });
  const genderMax = Math.max(1, ...Object.values(genderCounts));

  return (
    <div>
      <div className="topbar">
        <div className="topbar-brand">
          <img src="/logo.png" alt="Vedansh Medicare" />
          <div>
            <strong>Leader Dashboard</strong>
            <span className="brand-sub">{data.hospital?.name}{data.hospital?.branchName ? ` · ${data.hospital.branchName}` : ""}</span>
          </div>
        </div>
      </div>

      <div className="container" style={{ maxWidth: 1080 }}>
        <div className="card" style={{ marginBottom: 20 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12 }}>
            <div>
              <h3 style={{ margin: 0 }}>Welcome, {doctor.name}</h3>
              <p style={{ color: "var(--ink-soft)", margin: "4px 0 0", fontSize: 14 }}>
                {doctor.clinicName} {doctor.city ? `· ${doctor.city}` : ""}
              </p>
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button className="secondary" style={{ width: "auto", padding: "8px 16px" }} onClick={() => setShowQr(!showQr)}>
                {showQr ? "Hide my QR" : "Show my QR"}
              </button>
              <a href={data.referralUrl}>
                <button style={{ width: "auto", padding: "8px 16px" }}>+ Submit a lead</button>
              </a>
            </div>
          </div>

          {showQr && (
            <div style={{ marginTop: 16, textAlign: "center", border: "1.5px dashed var(--sky-200)", borderRadius: 12, padding: 16, background: "var(--sky-50)" }}>
              <img src={data.qrDataUrl} alt="QR code" style={{ width: 170, height: 170, borderRadius: 8 }} />
              <p style={{ fontSize: 12, wordBreak: "break-all", color: "var(--ink-soft)" }}>{data.referralUrl}</p>
              <a href={data.qrDataUrl} download={`${doctor.name}-qr.png`}>
                <button style={{ width: "auto", padding: "6px 14px" }}>Download QR</button>
              </a>
            </div>
          )}

          <div style={{ display: "flex", gap: 12, marginTop: 20, flexWrap: "wrap" }}>
            <div className="stat-card"><div className="stat-label">Total leads</div><div className="stat-value">{stats.total}</div></div>
            <div className="stat-card"><div className="stat-label">Awaiting arrival</div><div className="stat-value" style={{ color: "#92400e" }}>{stats.pending}</div></div>
            <div className="stat-card"><div className="stat-label">Credited</div><div className="stat-value" style={{ color: "var(--green-700)" }}>{stats.credited}</div></div>
            <div className="stat-card"><div className="stat-label">Not matched</div><div className="stat-value" style={{ color: "#991b1b" }}>{stats.rejected}</div></div>
            <div className="stat-card"><div className="stat-label">Total earned (paid out)</div><div className="stat-value" style={{ color: "var(--green-700)" }}>{stats.totalEarned.toFixed(2)} pts</div></div>
            <div className="stat-card"><div className="stat-label">Pending credits (not yet paid)</div><div className="stat-value" style={{ color: "#92400e" }}>{stats.pendingCredits.toFixed(2)} pts</div></div>
          </div>
        </div>

        <div className="dd-grid" style={{ marginBottom: 20 }}>
          <div className="card">
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
              <TrendingUp size={16} color="var(--teal-600)" />
              <h3 style={{ margin: 0 }}>Lead activity — last 14 days</h3>
            </div>
            <div style={{ width: "100%", height: 180 }}>
              <ResponsiveContainer>
                <AreaChart data={trend} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                  <defs>
                    <linearGradient id="doctorTrendFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="var(--teal-500)" stopOpacity={0.35} />
                      <stop offset="100%" stopColor="var(--teal-500)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis dataKey="label" fontSize={11} stroke="var(--ink-soft)" />
                  <YAxis allowDecimals={false} fontSize={11} stroke="var(--ink-soft)" width={28} />
                  <Tooltip />
                  <Area type="monotone" dataKey="count" name="Leads" stroke="var(--teal-600)" fill="url(#doctorTrendFill)" strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="card">
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
              <Users size={16} color="var(--teal-600)" />
              <h3 style={{ margin: 0 }}>Patients by gender</h3>
            </div>
            {Object.entries(genderCounts).map(([key, count]) => (
              <div key={key} style={{ marginBottom: 12 }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 4 }}>
                  <span>{GENDER_LABELS[key] || "Not recorded"}</span>
                  <span style={{ fontWeight: 700 }}>{count}</span>
                </div>
                <div style={{ height: 8, borderRadius: 6, background: "var(--teal-50)", overflow: "hidden" }}>
                  <div style={{ height: "100%", width: `${(count / genderMax) * 100}%`, background: GENDER_COLORS[key] || "#94a3b8", borderRadius: 6 }} />
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="card">
          <h3 style={{ marginTop: 0 }}>Your lead history</h3>

          <label>Search by patient name</label>
          <div style={{ display: "flex", gap: 8 }}>
            <div style={{ position: "relative", flex: 1 }}>
              <Search size={15} style={{ position: "absolute", left: 12, top: 13, color: "var(--ink-soft)" }} />
              <input
                style={{ paddingLeft: 34 }}
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(1); }}
                placeholder="e.g. Ramesh"
              />
            </div>
            <button style={{ width: 120 }} onClick={() => setPage(1)}><Search size={15} />Search</button>
          </div>

          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>Patient</th><th>Age</th><th>Gender</th><th>Status</th><th>Credit</th><th>Payout status</th><th>Submitted</th><th>Resolved</th><th>Discharged</th></tr>
              </thead>
              <tbody>
                {filteredReferrals.slice((page - 1) * HISTORY_PAGE_SIZE, page * HISTORY_PAGE_SIZE).map((r) => (
                  <tr key={r.id}>
                    <td>{r.patientName}</td>
                    <td>{r.patientAge}</td>
                    <td>{r.patientGender ? r.patientGender.charAt(0) + r.patientGender.slice(1).toLowerCase() : "—"}</td>
                    <td><span className={`badge ${r.status}`}>{STATUS_LABELS[r.status] || r.status}</span></td>
                    <td>{r.transaction ? `${Number(r.transaction.amount).toFixed(2)} pts` : "—"}</td>
                    <td>
                      {r.transaction ? (
                        <span className={`badge ${r.transaction.redeemed ? "CREDITED" : "PENDING"}`}>
                          {r.transaction.redeemed ? "Paid out" : "Awaiting payout"}
                        </span>
                      ) : "—"}
                    </td>
                    <td>{formatDateTime(r.createdAt)}</td>
                    <td>{r.arrivedAt ? formatDateTime(r.arrivedAt) : "—"}</td>
                    <td>{r.dischargedAt ? formatDateTime(r.dischargedAt) : "—"}</td>
                  </tr>
                ))}
                {filteredReferrals.length === 0 && (
                  <tr><td colSpan={9} style={{ color: "var(--ink-soft)" }}>{search ? "No leads match that search." : "No leads submitted yet."}</td></tr>
                )}
              </tbody>
            </table>
          </div>

          {pageCount > 1 && (
            <div className="pagination">
              <button disabled={page === 1} onClick={() => setPage((p) => p - 1)}><ChevronLeft size={14} /></button>
              {Array.from({ length: pageCount }, (_, i) => i + 1).map((p) => (
                <button key={p} className={p === page ? "active" : ""} onClick={() => setPage(p)}>{p}</button>
              ))}
              <button disabled={page === pageCount} onClick={() => setPage((p) => p + 1)}><ChevronRight size={14} /></button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
