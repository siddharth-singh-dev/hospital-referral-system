import { useEffect, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { RefreshCw } from "lucide-react";
import api from "../api/client";
import { formatDate, formatDateTime } from "../utils/date";
import { STAGE_META, LEAD_FILTERS } from "../utils/leadStages";

const TEAM_PERMISSION = "VIEW_MY_MARKETING_TEAM";
// If the same account also has any of these, offer a way over to the referrals portal.
const REFERRAL_PERMISSIONS = ["VIEW_REFERRALS", "MANAGE_REFERRALS", "REDEEM_CREDITS", "EXPORT_REPORTS"];

// How many of a {stage: count} map fall into one filter group (REVIEW / WAITING / ADMITTED / REJECTED).
const inGroup = (stages, group) =>
  Object.entries(stages || {}).reduce((n, [stage, c]) => n + (STAGE_META[stage]?.group === group ? c : 0), 0);

function StatCard({ label, value }) {
  return (
    <div className="card" style={{ margin: 0, padding: "14px 16px" }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: "var(--ink-soft)", textTransform: "uppercase" }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 700, color: "var(--ink)", marginTop: 4 }}>{value}</div>
    </div>
  );
}

// Dashboard for a "team head": a staff account whose role grants VIEW_MY_MARKETING_TEAM. The
// server only ever returns the marketing people assigned to this account (and their leads) —
// nothing here can reach anyone else's data, and nothing here can change anything.
export default function MarketingHeadPortal() {
  const navigate = useNavigate();
  const user = JSON.parse(localStorage.getItem("user") || "null");
  const permissions = user?.permissions || [];
  const allowed = permissions.includes(TEAM_PERMISSION);

  const [overview, setOverview] = useState(null);
  const [leads, setLeads] = useState([]);
  const [memberId, setMemberId] = useState(""); // "" = the whole team
  const [filter, setFilter] = useState("ALL");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function loadOverview() {
    try {
      const { data } = await api.get("/marketing-persons/team/overview");
      setOverview(data);
    } catch (err) {
      setError(err?.response?.data?.error || "Could not load your team.");
    }
  }
  async function loadLeads() {
    setLoading(true);
    try {
      const { data } = await api.get("/marketing-persons/team/leads", { params: memberId ? { memberId } : {} });
      setLeads(data);
    } catch (err) {
      setError(err?.response?.data?.error || "Could not load leads.");
    } finally {
      setLoading(false);
    }
  }
  function refresh() {
    setError("");
    loadOverview();
    loadLeads();
  }

  useEffect(() => { if (allowed) loadOverview(); }, []);
  useEffect(() => { if (allowed) loadLeads(); }, [memberId]);

  if (!allowed) return <Navigate to="/login" replace />;

  function logout() {
    localStorage.clear();
    navigate("/login");
  }

  const totals = overview?.totals;
  const selected = overview?.members.find((m) => m.id === memberId);
  const q = search.trim().toLowerCase();
  const rows = leads.filter(
    (l) =>
      (filter === "ALL" || STAGE_META[l.stage]?.group === filter) &&
      (!q || l.patientName.toLowerCase().includes(q) || (l.leaderName || "").toLowerCase().includes(q) || (l.memberName || "").toLowerCase().includes(q))
  );

  return (
    <div>
      <div className="topbar">
        <div className="topbar-brand">
          <img src="/logo.png" alt="Vedansh Medicare" />
          <div>
            <strong>{user?.customRoleName || "Team head"} Portal</strong>
            <span className="brand-sub">{user?.hospitalName}{user?.hospitalBranchName ? ` · ${user.hospitalBranchName}` : ""}</span>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", justifyContent: "flex-end" }}>
          <span style={{ color: "var(--ink-soft)" }}>{user?.name}</span>
          {permissions.some((p) => REFERRAL_PERMISSIONS.includes(p)) && (
            <button className="secondary" style={{ width: "auto", padding: "6px 14px" }} onClick={() => navigate("/staff")}>Referrals</button>
          )}
          <button className="secondary" style={{ width: "auto", padding: "6px 14px" }} onClick={logout}>Log out</button>
        </div>
      </div>

      <div className="container-wide">
        {error && <p className="error">{error}</p>}

        {overview && overview.members.length === 0 && (
          <div className="card">
            <p style={{ color: "var(--ink-soft)", margin: 0 }}>
              No marketing people are assigned to you yet. Ask your hospital admin to set you as the “Team head” on their profile.
            </p>
          </div>
        )}

        {totals && totals.members > 0 && (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12, marginBottom: 20 }}>
              <StatCard label="Team members" value={totals.members} />
              <StatCard label="Leaders" value={totals.leaders} />
              <StatCard label="Total leads" value={totals.leads} />
              <StatCard label="Awaiting" value={inGroup(totals.stages, "REVIEW") + inGroup(totals.stages, "WAITING")} />
              <StatCard label="Admitted" value={inGroup(totals.stages, "ADMITTED")} />
              <StatCard label="Rejected" value={inGroup(totals.stages, "REJECTED")} />
              <StatCard label="Credited" value={`${totals.credited.toFixed(2)} pts`} />
            </div>

            <div className="card" style={{ marginBottom: 20 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <h3 style={{ margin: 0 }}>My team</h3>
                <span style={{ color: "var(--ink-soft)", fontSize: 13 }}>Click a person to see just their leads</span>
              </div>
              <div className="table-wrap">
                <table style={{ marginTop: 10 }}>
                  <thead>
                    <tr><th>Name</th><th>Leaders</th><th>Leads</th><th>Awaiting</th><th>Admitted</th><th>Rejected</th><th>Credited</th><th>Last lead</th><th>Status</th></tr>
                  </thead>
                  <tbody>
                    {overview.members.map((m) => (
                      <tr
                        key={m.id}
                        style={{ cursor: "pointer", background: memberId === m.id ? "var(--teal-50)" : undefined }}
                        onClick={() => { setMemberId(memberId === m.id ? "" : m.id); setFilter("ALL"); }}
                      >
                        <td>
                          <div style={{ fontWeight: 600 }}>{m.name}</div>
                          <div style={{ fontSize: 12, color: "var(--ink-soft)" }}>{m.phone || "—"}</div>
                        </td>
                        <td>{m.leaderCount}</td>
                        <td>{m.totalLeads}</td>
                        <td>{inGroup(m.stages, "REVIEW") + inGroup(m.stages, "WAITING")}</td>
                        <td>{inGroup(m.stages, "ADMITTED")}</td>
                        <td>{inGroup(m.stages, "REJECTED")}</td>
                        <td>{m.totalCredited.toFixed(2)} pts</td>
                        <td>{m.lastLeadAt ? formatDateTime(m.lastLeadAt) : "—"}</td>
                        <td><span className={`badge ${m.active ? "CREDITED" : "REJECTED"}`}>{m.active ? "Active" : "Inactive"}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="card" style={{ marginBottom: 20 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
                <h3 style={{ margin: 0 }}>Leads — {selected ? selected.name : "whole team"}</h3>
                <div style={{ display: "flex", gap: 8 }}>
                  {selected && (
                    <button type="button" className="secondary" style={{ width: "auto", padding: "5px 12px" }} onClick={() => setMemberId("")}>Show whole team</button>
                  )}
                  <button type="button" className="secondary" title="Refresh" disabled={loading} style={{ width: "auto", padding: "5px 10px" }} onClick={refresh}>
                    <RefreshCw size={14} className={loading ? "spin" : ""} />
                  </button>
                </div>
              </div>

              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 6 }}>
                {LEAD_FILTERS.map((f) => {
                  const n = f.key === "ALL" ? leads.length : leads.filter((l) => STAGE_META[l.stage]?.group === f.key).length;
                  return (
                    <button key={f.key} type="button" className={filter === f.key ? "" : "secondary"} style={{ width: "auto", padding: "4px 10px", fontSize: 12 }} onClick={() => setFilter(f.key)}>
                      {f.label} ({n})
                    </button>
                  );
                })}
              </div>
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search patient, leader or marketing person…" />

              {rows.length === 0 ? (
                <p style={{ color: "var(--ink-soft)", fontSize: 14 }}>{leads.length === 0 ? "No leads yet." : "No leads match."}</p>
              ) : (
                <div className="table-wrap" style={{ maxHeight: 480, overflowY: "auto" }}>
                  <table>
                    <thead><tr><th>Patient</th><th>Marketing person</th><th>Leader</th><th>Status</th><th>Sent</th></tr></thead>
                    <tbody>
                      {rows.map((l) => {
                        const meta = STAGE_META[l.stage] || { bg: "#eef0f4", color: "var(--ink-soft)" };
                        return (
                          <tr key={l.id}>
                            <td>
                              {l.patientName}
                              {l.cardType && <div style={{ fontSize: 12, color: "var(--ink-soft)" }}>{l.cardType.charAt(0) + l.cardType.slice(1).toLowerCase()}{l.panel ? ` · ${l.panel}` : ""}</div>}
                            </td>
                            <td>{l.memberName || "—"}</td>
                            <td>{l.leaderName}</td>
                            <td style={{ whiteSpace: "normal" }}>
                              <span className="badge" style={{ background: meta.bg, color: meta.color }}>{l.label}</span>
                              {l.note && <div style={{ fontSize: 12, color: "var(--ink-soft)", marginTop: 2 }}>{l.note}</div>}
                            </td>
                            <td>{formatDate(l.submittedAt)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
              {leads.length >= 500 && <p style={{ fontSize: 12, color: "var(--ink-soft)" }}>Showing the latest 500 leads.</p>}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
