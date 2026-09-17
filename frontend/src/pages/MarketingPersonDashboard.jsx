import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import axios from "axios";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";
import { Lock, TrendingUp, Users, LogOut, UserPlus, Paperclip } from "lucide-react";
import { PANEL_OPTIONS } from "../utils/panels";

const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:4000/api";

// Self-service portal for a hospital marketing-team member. Reached via their personal
// QR/link (/marketing/:id) + a password only they know. Shows their own stats plus one
// action: submitting a lead on behalf of one of their own leaders (lands as Pending, same as
// a leader's own QR submission — unless a card photo is attached, in which case it first sits
// in reception's "Card Activity" queue until the card is verified). No confirm/credit powers
// here. No way to see any other marketing person's data, and no way to edit/manage existing
// referrals at all — that part is still true. Uses its own token storage (keyed by this
// person's id) rather than the shared staff `api` client, so it never collides with a
// hospital-staff login open in the same browser.
export default function MarketingPersonDashboard() {
  const { id } = useParams();
  const tokenKey = `marketing_token_${id}`;

  const [token, setToken] = useState(() => localStorage.getItem(tokenKey) || "");
  const [password, setPassword] = useState("");
  const [loggingIn, setLoggingIn] = useState(false);
  const [loginError, setLoginError] = useState("");

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");

  // -------------------- Submit a lead --------------------
  const [showLeadForm, setShowLeadForm] = useState(false);
  const [leaderChoice, setLeaderChoice] = useState(""); // an existing leader's id, or "" / "__new__"
  const [newLeaderName, setNewLeaderName] = useState("");
  const [leadName, setLeadName] = useState("");
  const [leadAge, setLeadAge] = useState("");
  const [leadGender, setLeadGender] = useState("MALE");
  const [leadPhone, setLeadPhone] = useState("");
  const [leadPanel, setLeadPanel] = useState("");
  const [leadIdNumber, setLeadIdNumber] = useState("");
  const [leadForceType, setLeadForceType] = useState("");
  const [leadWardType, setLeadWardType] = useState("");
  const [attachmentFile, setAttachmentFile] = useState(null);
  const [submittingLead, setSubmittingLead] = useState(false);
  const [leadError, setLeadError] = useState("");
  const [leadSuccess, setLeadSuccess] = useState("");

  function resetLeadForm() {
    setLeaderChoice("");
    setNewLeaderName("");
    setLeadName("");
    setLeadAge("");
    setLeadGender("MALE");
    setLeadPhone("");
    setLeadPanel("");
    setLeadIdNumber("");
    setLeadForceType("");
    setLeadWardType("");
    setAttachmentFile(null);
  }

  async function handleSubmitLead(e) {
    e.preventDefault();
    setLeadError("");
    if (!leaderChoice) {
      setLeadError("Tell us which leader passed you this lead.");
      return;
    }
    if (leaderChoice === "__new__" && !newLeaderName.trim()) {
      setLeadError("Type the new leader's name.");
      return;
    }
    setSubmittingLead(true);
    try {
      const formData = new FormData();
      formData.append("patientName", leadName.trim());
      formData.append("patientAge", leadAge);
      formData.append("patientGender", leadGender);
      if (leadPhone.trim()) formData.append("patientPhone", leadPhone.trim());
      if (leadPanel) formData.append("panel", leadPanel);
      if (leadIdNumber.trim()) formData.append("idNumber", leadIdNumber.trim());
      if (leadForceType.trim()) formData.append("forceType", leadForceType.trim());
      if (leadWardType.trim()) formData.append("wardType", leadWardType.trim());
      if (leaderChoice === "__new__") formData.append("newLeaderName", newLeaderName.trim());
      else formData.append("leaderId", leaderChoice);
      if (attachmentFile) formData.append("attachment", attachmentFile);

      const res = await axios.post(`${API_BASE}/referrals/marketing-submit`, formData, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setLeadSuccess(res.data.message || "Lead submitted.");
      resetLeadForm();
      setShowLeadForm(false);
      loadReport(token); // refresh stats + leaders list, in case a new leader was just created
    } catch (err) {
      setLeadError(err.response?.data?.error || "Failed to submit this lead.");
    } finally {
      setSubmittingLead(false);
    }
  }

  async function loadReport(activeToken) {
    setLoading(true);
    setLoadError("");
    try {
      const res = await axios.get(`${API_BASE}/marketing-persons/public/me`, {
        headers: { Authorization: `Bearer ${activeToken}` },
      });
      setData(res.data);
    } catch (err) {
      if (err.response?.status === 401) {
        // token expired or invalid — drop it and show the password screen again
        localStorage.removeItem(tokenKey);
        setToken("");
      } else {
        setLoadError(err.response?.data?.error || "Failed to load your report.");
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (token) loadReport(token);
  }, [token]);

  async function handleLogin(e) {
    e.preventDefault();
    setLoginError("");
    setLoggingIn(true);
    try {
      const res = await axios.post(`${API_BASE}/marketing-persons/public/${id}/login`, { password });
      localStorage.setItem(tokenKey, res.data.token);
      setToken(res.data.token);
    } catch (err) {
      setLoginError(err.response?.data?.error || "Failed to log in.");
    } finally {
      setLoggingIn(false);
    }
  }

  function handleLogout() {
    localStorage.removeItem(tokenKey);
    setToken("");
    setData(null);
    setPassword("");
  }

  // -------------------- Password gate --------------------
  if (!token) {
    return (
      <div className="container" style={{ maxWidth: 420, paddingTop: 60 }}>
        <div className="card" style={{ textAlign: "center" }}>
          <div style={{ display: "inline-flex", width: 48, height: 48, borderRadius: 12, background: "var(--teal-600)", color: "#fff", alignItems: "center", justifyContent: "center", marginBottom: 12 }}>
            <Lock size={22} />
          </div>
          <h2 style={{ margin: "0 0 4px" }}>Marketing Portal</h2>
          <p style={{ color: "var(--ink-soft)", fontSize: 14, marginTop: 0 }}>Enter your password to view your stats.</p>
          <form onSubmit={handleLogin} style={{ textAlign: "left" }}>
            <label>Password</label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus required />
            {loginError && <p className="error">{loginError}</p>}
            <button type="submit" disabled={loggingIn} style={{ marginTop: 8 }}>{loggingIn ? "Checking…" : "View my stats"}</button>
          </form>
        </div>
      </div>
    );
  }

  // -------------------- Loading / error --------------------
  if (loading && !data) {
    return <div className="container" style={{ paddingTop: 60 }}><p>Loading…</p></div>;
  }
  if (loadError && !data) {
    return (
      <div className="container" style={{ maxWidth: 420, paddingTop: 60 }}>
        <div className="card">
          <p className="error">{loadError}</p>
          <button className="secondary" onClick={handleLogout}>Try again</button>
        </div>
      </div>
    );
  }
  if (!data) return null;

  // -------------------- Report --------------------
  return (
    <div>
      <div className="topbar">
        <div className="topbar-brand">
          <img src="/logo.png" alt="" />
          <div>
            <strong>{data.person.name}</strong>
            <span className="brand-sub">Marketing portal</span>
          </div>
        </div>
        <button className="secondary" style={{ width: "auto", padding: "8px 16px" }} onClick={handleLogout}>
          <LogOut size={15} />Log out
        </button>
      </div>

      <div className="container" style={{ maxWidth: 1000 }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12, marginBottom: 20 }}>
          <div className="card" style={{ padding: 16 }}>
            <div style={{ fontSize: 12, color: "var(--ink-soft)", fontWeight: 700, textTransform: "uppercase" }}>Your leaders</div>
            <div style={{ fontSize: 24, fontWeight: 700 }}>{data.leaders.length}</div>
          </div>
          <div className="card" style={{ padding: 16 }}>
            <div style={{ fontSize: 12, color: "var(--ink-soft)", fontWeight: 700, textTransform: "uppercase" }}>Total leads</div>
            <div style={{ fontSize: 24, fontWeight: 700 }}>{data.totalReferrals}</div>
          </div>
          <div className="card" style={{ padding: 16 }}>
            <div style={{ fontSize: 12, color: "var(--ink-soft)", fontWeight: 700, textTransform: "uppercase" }}>Total credited</div>
            <div style={{ fontSize: 24, fontWeight: 700 }}>{data.totalCredited.toFixed(2)} pts</div>
          </div>
        </div>

        <div className="card" style={{ marginBottom: 20 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <UserPlus size={16} color="var(--teal-600)" />
              <h4 style={{ margin: 0 }}>Submit a lead</h4>
            </div>
            {!showLeadForm && (
              <button style={{ width: "auto", padding: "7px 14px" }} onClick={() => { setLeadSuccess(""); setShowLeadForm(true); }}>
                <UserPlus size={15} />New lead
              </button>
            )}
          </div>
          {!showLeadForm && (
            <p style={{ fontSize: 13, color: "var(--ink-soft)", margin: "6px 0 0" }}>
              Bringing in a patient yourself? Submit it here — it'll show up as Pending for reception to confirm, same as a leader's own QR submission. If you attach a card photo, reception verifies the card first.
            </p>
          )}
          {leadSuccess && !showLeadForm && <p style={{ color: "var(--teal-700)", fontSize: 13.5, marginTop: 10, marginBottom: 0 }}>{leadSuccess}</p>}

          {showLeadForm && (
            <form onSubmit={handleSubmitLead} style={{ marginTop: 14 }}>
              <label>Which leader passed you this lead?</label>
              <select value={leaderChoice} onChange={(e) => setLeaderChoice(e.target.value)} required>
                <option value="">— Select a leader —</option>
                {data.leaders.map((l) => (
                  <option key={l.id} value={l.id}>{l.name}{l.clinicName ? ` (${l.clinicName})` : ""}</option>
                ))}
                <option value="__new__">+ Someone not in this list</option>
              </select>
              {leaderChoice === "__new__" && (
                <>
                  <label>New leader's name</label>
                  <input value={newLeaderName} onChange={(e) => setNewLeaderName(e.target.value)} required />
                </>
              )}

              <label>Patient name</label>
              <input value={leadName} onChange={(e) => setLeadName(e.target.value)} required />

              <label>Patient age</label>
              <input type="number" min="0" max="130" value={leadAge} onChange={(e) => setLeadAge(e.target.value)} required />

              <label>Patient gender</label>
              <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
                {["MALE", "FEMALE", "OTHER"].map((g) => (
                  <button
                    key={g}
                    type="button"
                    className={leadGender === g ? "" : "secondary"}
                    style={{ width: "auto", flex: 1, padding: "8px 0" }}
                    onClick={() => setLeadGender(g)}
                  >
                    {g.charAt(0) + g.slice(1).toLowerCase()}
                  </button>
                ))}
              </div>

              <label>Patient phone (optional)</label>
              <input value={leadPhone} onChange={(e) => setLeadPhone(e.target.value)} placeholder="e.g. 98765 43210" />

              <label>Panel (optional)</label>
              <select value={leadPanel} onChange={(e) => setLeadPanel(e.target.value)}>
                <option value="">— None —</option>
                {PANEL_OPTIONS.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>

              <label>ID number (optional)</label>
              <input value={leadIdNumber} onChange={(e) => setLeadIdNumber(e.target.value)} placeholder="Aadhaar, Ayushman, CGHS/ECHS/CAPF card number, etc." />

              <label>Force / category (optional)</label>
              <input value={leadForceType} onChange={(e) => setLeadForceType(e.target.value)} placeholder="e.g. Cash Patient, Ayushman Bharat, BSF, Pensioner" />

              <label>Ward type (optional)</label>
              <input value={leadWardType} onChange={(e) => setLeadWardType(e.target.value)} placeholder="e.g. General Ward, Semi-Private Ward, ICU, NICU" />

              <label>Attach a card photo (optional)</label>
              <input
                type="file"
                accept="image/*,.pdf"
                onChange={(e) => setAttachmentFile(e.target.files?.[0] || null)}
              />
              <p style={{ fontSize: 11.5, color: "var(--ink-soft)", marginTop: -6, marginBottom: 8 }}>
                <Paperclip size={11} style={{ verticalAlign: "middle", marginRight: 3 }} />
                A photo of their ID/insurance card (e.g. Ayushman), a prescription, anything useful as proof of the lead. If you attach a card photo, reception will check it's active before the lead moves to Pending.
              </p>

              {leadError && <p className="error">{leadError}</p>}

              <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                <button type="submit" disabled={submittingLead}>{submittingLead ? "Submitting…" : "Submit lead"}</button>
                <button type="button" className="secondary" onClick={() => { resetLeadForm(); setLeadError(""); setShowLeadForm(false); }}>Cancel</button>
              </div>
            </form>
          )}
        </div>

        <div className="card" style={{ marginBottom: 20 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
            <TrendingUp size={16} color="var(--teal-600)" />
            <h4 style={{ margin: 0 }}>Weekly — last 8 weeks</h4>
          </div>
          <div style={{ width: "100%", height: 180 }}>
            <ResponsiveContainer>
              <BarChart data={data.weekly} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="weekStart" tickFormatter={(d) => { const [, m, day] = d.split("-"); return `${day}/${m}`; }} fontSize={11} stroke="var(--ink-soft)" />
                <YAxis allowDecimals={false} fontSize={11} stroke="var(--ink-soft)" width={28} />
                <Tooltip labelFormatter={(d) => `Week of ${d}`} formatter={(value, name) => [value, name === "count" ? "Leads" : "Credited (pts)"]} />
                <Bar dataKey="count" fill="var(--teal-500)" radius={[4, 4, 0, 0]} name="count" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="card" style={{ marginBottom: 20 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
            <TrendingUp size={16} color="var(--teal-600)" />
            <h4 style={{ margin: 0 }}>Monthly — last 6 months</h4>
          </div>
          <div style={{ width: "100%", height: 180 }}>
            <ResponsiveContainer>
              <BarChart data={data.monthly} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="month" fontSize={11} stroke="var(--ink-soft)" />
                <YAxis allowDecimals={false} fontSize={11} stroke="var(--ink-soft)" width={28} />
                <Tooltip formatter={(value, name) => [value, name === "count" ? "Leads" : "Credited (pts)"]} />
                <Bar dataKey="count" fill="var(--navy-700)" radius={[4, 4, 0, 0]} name="count" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="card">
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
            <Users size={16} color="var(--teal-600)" />
            <h4 style={{ margin: 0 }}>Your leaders</h4>
          </div>
          {data.leaders.length === 0 ? (
            <p style={{ color: "var(--ink-soft)", fontSize: 14 }}>No leaders associated with you yet — ask your admin.</p>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr><th>Leader</th><th>Leads</th><th>Credited</th><th>Status</th></tr>
                </thead>
                <tbody>
                  {data.leaders.map((l) => (
                    <tr key={l.id}>
                      <td>{l.name}{l.clinicName ? ` (${l.clinicName})` : ""}</td>
                      <td>{l.totalReferrals}</td>
                      <td>{l.totalCredited.toFixed(2)} pts</td>
                      <td><span className={`badge ${l.active ? "CREDITED" : "REJECTED"}`}>{l.active ? "Active" : "Inactive"}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
