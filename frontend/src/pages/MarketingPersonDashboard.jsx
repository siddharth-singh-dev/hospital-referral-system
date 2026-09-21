import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import axios from "axios";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";
import { Lock, TrendingUp, LogOut, UserPlus, Paperclip, ChevronRight, X } from "lucide-react";
import Modal from "../components/Modal";
import CardScanUpload from "../components/CardScanUpload";
import { PANEL_OPTIONS } from "../utils/panels";

const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:4000/api";

const CURRENT_YEAR = new Date().getFullYear();
// Newborn (this year) down to 110 years old — covers realistic patient ages without asking
// for a full date of birth, which the hospital doesn't otherwise collect for a quick lead.
const BIRTH_YEARS = Array.from({ length: 111 }, (_, i) => CURRENT_YEAR - i);

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

  const [showLeadersModal, setShowLeadersModal] = useState(false);

  // -------------------- Submit a lead --------------------
  const [showLeadForm, setShowLeadForm] = useState(false);
  const [leaderChoice, setLeaderChoice] = useState(""); // an existing leader's id, or "" / "__new__"
  const [newLeaderName, setNewLeaderName] = useState("");
  const [leadName, setLeadName] = useState("");
  const [birthYear, setBirthYear] = useState("");
  const [leadGender, setLeadGender] = useState("MALE");
  const [leadPanel, setLeadPanel] = useState("");
  const [attachmentFile, setAttachmentFile] = useState(null);
  const [attachmentCardType, setAttachmentCardType] = useState("");
  const [submittingLead, setSubmittingLead] = useState(false);
  const [leadError, setLeadError] = useState("");
  const [leadSuccess, setLeadSuccess] = useState("");

  const computedAge = birthYear ? CURRENT_YEAR - Number(birthYear) : "";

  function resetLeadForm() {
    setLeaderChoice("");
    setNewLeaderName("");
    setLeadName("");
    setBirthYear("");
    setLeadGender("MALE");
    setLeadPanel("");
    setAttachmentFile(null);
    setAttachmentCardType("");
  }

  // Called by CardScanUpload once a photo's been captured/chosen — `ocrResult` is the OCR
  // read (null if the type was "Other" or the read failed), `meta.file`/`meta.cardType` are
  // always present regardless, since the photo itself should still attach either way.
  function handleCardScanned(ocrResult, meta) {
    setAttachmentFile(meta.file);
    setAttachmentCardType(meta.cardType);
    if (ocrResult) {
      if (ocrResult.patientName) setLeadName(ocrResult.patientName);
      // dob can arrive as ISO (1943-11-26), Indian-format (26/11/1943), or "26 Nov 1943" —
      // pull the 4-digit year out regardless of which; only fall back to age if that fails,
      // rather than skipping the fallback just because *a* dob string was present.
      const yearFromDob = ocrResult.dob?.match(/^(\d{4})-/)?.[1] || ocrResult.dob?.match(/(\d{4})\s*$/)?.[1];
      if (yearFromDob) {
        setBirthYear(yearFromDob);
      } else if (ocrResult.patientAge) {
        setBirthYear(String(CURRENT_YEAR - ocrResult.patientAge));
      }
      if (ocrResult.patientGender) setLeadGender(ocrResult.patientGender);
      if (ocrResult.panel) setLeadPanel(ocrResult.panel);
    }
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
    if (!birthYear) {
      setLeadError("Select the patient's birth year.");
      return;
    }
    setSubmittingLead(true);
    try {
      const formData = new FormData();
      formData.append("patientName", leadName.trim());
      formData.append("patientAge", computedAge);
      formData.append("patientGender", leadGender);
      if (leadPanel) formData.append("panel", leadPanel);
      if (leaderChoice === "__new__") formData.append("newLeaderName", newLeaderName.trim());
      else formData.append("leaderId", leaderChoice);
      if (attachmentFile) {
        formData.append("attachment", attachmentFile);
        formData.append("cardType", attachmentCardType);
      }

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
        <button style={{ width: "auto", padding: "8px 16px" }} onClick={() => { setLeadSuccess(""); setShowLeadForm(true); }}>
          <UserPlus size={16} />New lead
        </button>
      </div>

      <div className="container" style={{ maxWidth: 1000 }}>
        <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
          <button
            type="button"
            className="card"
            onClick={() => setShowLeadersModal(true)}
            style={{ padding: "10px 8px", flex: 1, minWidth: 0, textAlign: "left", cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "flex-start" }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 2, fontSize: 10, color: "var(--ink-soft)", fontWeight: 700, textTransform: "uppercase" }}>
              Your leaders<ChevronRight size={12} />
            </div>
            <div style={{ fontSize: 19, fontWeight: 700 }}>{data.leaders.length}</div>
          </button>
          <div className="card" style={{ padding: "10px 8px", flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 10, color: "var(--ink-soft)", fontWeight: 700, textTransform: "uppercase" }}>Total leads</div>
            <div style={{ fontSize: 19, fontWeight: 700 }}>{data.totalReferrals}</div>
          </div>
          <div className="card" style={{ padding: "10px 8px", flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 10, color: "var(--ink-soft)", fontWeight: 700, textTransform: "uppercase" }}>Total credited</div>
            <div style={{ fontSize: 19, fontWeight: 700 }}>{data.totalCredited.toFixed(2)} <span style={{ fontSize: 12, fontWeight: 600 }}>pts</span></div>
          </div>
        </div>

        {leadSuccess && <p style={{ color: "var(--teal-700)", fontSize: 13.5, marginBottom: 20 }}>{leadSuccess}</p>}

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

        <div style={{ marginTop: 8 }}>
          <button className="secondary" style={{ width: "auto", padding: "8px 16px" }} onClick={handleLogout}>
            <LogOut size={15} />Log out
          </button>
        </div>
      </div>

      {showLeadersModal && (
        <Modal title="Your leaders" onClose={() => setShowLeadersModal(false)} width={560}>
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
        </Modal>
      )}

      {showLeadForm && (
        <Modal title="Submit a lead" onClose={() => { if (!submittingLead) { resetLeadForm(); setLeadError(""); setShowLeadForm(false); } }} width={480}>
          <form onSubmit={handleSubmitLead}>
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

            <label>Birth year</label>
            <select value={birthYear} onChange={(e) => setBirthYear(e.target.value)} required>
              <option value="">— Select birth year —</option>
              {BIRTH_YEARS.map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
            {computedAge !== "" && (
              <p style={{ fontSize: 12.5, color: "var(--ink-soft)", marginTop: -6, marginBottom: 10 }}>Age: {computedAge} yrs</p>
            )}

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

            <label>Panel (optional)</label>
            <select value={leadPanel} onChange={(e) => setLeadPanel(e.target.value)}>
              <option value="">— None —</option>
              {PANEL_OPTIONS.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>

            <label>Card / document photo (optional)</label>
            <CardScanUpload authToken={token} onExtracted={handleCardScanned} />
            {attachmentFile && (
              <p style={{ fontSize: 12.5, color: "var(--ink-soft)", marginTop: -10, marginBottom: 8, display: "flex", alignItems: "center", gap: 6 }}>
                <Paperclip size={12} />Attached — {attachmentCardType === "OTHER" ? "other document" : `${attachmentCardType} card`}
                <button
                  type="button"
                  className="secondary"
                  style={{ width: "auto", padding: "2px 6px", marginLeft: "auto" }}
                  onClick={() => { setAttachmentFile(null); setAttachmentCardType(""); }}
                >
                  <X size={12} />
                </button>
              </p>
            )}
            <p style={{ fontSize: 11.5, color: "var(--ink-soft)", marginTop: -2, marginBottom: 8 }}>
              Only an Ayushman card needs reception to verify it before the lead moves to Pending — every other type (or no photo at all) goes straight to Pending.
            </p>

            {leadError && <p className="error">{leadError}</p>}

            <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
              <button type="submit" disabled={submittingLead}>{submittingLead ? "Submitting…" : "Submit lead"}</button>
              <button type="button" className="secondary" onClick={() => { resetLeadForm(); setLeadError(""); setShowLeadForm(false); }}>Cancel</button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}

