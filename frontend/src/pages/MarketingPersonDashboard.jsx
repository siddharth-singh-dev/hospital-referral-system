import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import axios from "axios";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";
import { Lock, TrendingUp, LogOut, UserPlus, Paperclip, ChevronRight, X, RefreshCw } from "lucide-react";
import Modal from "../components/Modal";
import CardScanUpload, { CARD_TYPES } from "../components/CardScanUpload";
import { PANEL_OPTIONS } from "../utils/panels";

const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:4000/api";

const CURRENT_YEAR = new Date().getFullYear();
// Newborn (this year) down to 110 years old — covers realistic patient ages without asking
// for a full date of birth, which the hospital doesn't otherwise collect for a quick lead.
const BIRTH_YEARS = Array.from({ length: 111 }, (_, i) => CURRENT_YEAR - i);

import { STAGE_META, LEAD_FILTERS } from "../utils/leadStages";

// Self-service portal for a hospital marketing-team member. Reached via their personal
// QR/link (/marketing/:id) + a password only they know. Shows their own stats plus one
// action: submitting a lead on behalf of one of their own leaders. A card/document photo is
// required on every submission (with an ID number for every type except "Other") — this is
// what makes hospital-wide duplicate detection possible, so it's no longer optional the way it
// once was. Only an AYUSHMAN card routes through reception's "Card Activity" queue for
// verification; everything else lands straight in Pending, same as a leader's own QR
// submission. No confirm/credit powers here. No way to see any other marketing person's data
// beyond the deliberately minimal name+card-number "active patients" list (used to self-check
// for duplicates before submitting), and no way to edit/manage existing referrals at all —
// that part is still true. Uses its own token storage (keyed by this person's id) rather than
// the shared staff `api` client, so it never collides with a hospital-staff login open in the
// same browser.
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

  const [activeDirectory, setActiveDirectory] = useState([]);
  const [directorySearch, setDirectorySearch] = useState("");

  // "My leads" — every lead this person submitted and where it stands (card check, awaiting
  // arrival, admitted, rejected...), so they find out how a card check went without asking.
  const [myLeads, setMyLeads] = useState([]);
  const [myLeadsFilter, setMyLeadsFilter] = useState("ALL");
  const [myLeadsLoading, setMyLeadsLoading] = useState(false);

  // -------------------- Submit a lead --------------------
  const [showLeadForm, setShowLeadForm] = useState(false);
  const [leaderChoice, setLeaderChoice] = useState(""); // an existing leader's id, or "" / "__new__"
  const [newLeaderName, setNewLeaderName] = useState("");
  const [leadName, setLeadName] = useState("");
  const [birthYear, setBirthYear] = useState("");
  const [leadGender, setLeadGender] = useState("MALE");
  const [leadPanel, setLeadPanel] = useState("");
  const [leadNote, setLeadNote] = useState(""); // optional message for reception, shown on the lead
  const [idNumber, setIdNumber] = useState("");
  const [havePhoto, setHavePhoto] = useState(true); // false = "no photo available" — declare type/ID manually instead
  const [attachmentFile, setAttachmentFile] = useState(null);
  const [attachmentCardType, setAttachmentCardType] = useState("");
  const [submittingLead, setSubmittingLead] = useState(false);
  const [leadError, setLeadError] = useState("");
  const [leadSuccess, setLeadSuccess] = useState("");
  const [pendingDuplicateWarning, setPendingDuplicateWarning] = useState(""); // set once the backend warns of a possible (non-card) duplicate; submitting again proceeds past it

  const computedAge = birthYear ? CURRENT_YEAR - Number(birthYear) : "";

  function resetLeadForm() {
    setLeaderChoice("");
    setNewLeaderName("");
    setLeadName("");
    setBirthYear("");
    setLeadGender("MALE");
    setLeadPanel("");
    setLeadNote("");
    setIdNumber("");
    setHavePhoto(true);
    setAttachmentFile(null);
    setAttachmentCardType("");
    setPendingDuplicateWarning("");
  }

  async function loadActiveDirectory(activeToken) {
    try {
      const res = await axios.get(`${API_BASE}/referrals/active-directory`, {
        headers: { Authorization: `Bearer ${activeToken || token}` },
      });
      setActiveDirectory(res.data);
    } catch {
      // non-critical — the self-check list just stays empty/stale; the backend still enforces
      // the actual duplicate block regardless
    }
  }

  async function loadMyLeads(activeToken) {
    setMyLeadsLoading(true);
    try {
      const res = await axios.get(`${API_BASE}/marketing-persons/public/me/leads`, {
        headers: { Authorization: `Bearer ${activeToken || token}` },
      });
      setMyLeads(res.data);
    } catch {
      // non-critical — the table just keeps whatever it last showed
    } finally {
      setMyLeadsLoading(false);
    }
  }

  // Called by CardScanUpload once a photo's been captured/chosen — `ocrResult` is the OCR
  // read (null if the type was "Other" or the read failed), `meta.file`/`meta.cardType` are
  // always present regardless, since the photo itself should still attach either way.
  function handleCardScanned(ocrResult, meta) {
    setAttachmentFile(meta.file);
    setAttachmentCardType(meta.cardType);
    setPendingDuplicateWarning(""); // a changed/re-scanned photo invalidates any earlier warning
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
      if (ocrResult.idNumberMasked) setIdNumber(ocrResult.idNumberMasked);
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
    if (!leadPanel) {
      setLeadError("Select the patient's panel.");
      return;
    }
    if (!attachmentCardType) {
      setLeadError("Select what kind of card/document this is.");
      return;
    }
    if (attachmentCardType !== "OTHER" && !idNumber.trim()) {
      setLeadError("Enter the card/ID number (or re-scan if it wasn't read correctly).");
      return;
    }
    setSubmittingLead(true);
    try {
      const formData = new FormData();
      formData.append("patientName", leadName.trim());
      formData.append("patientAge", computedAge);
      formData.append("patientGender", leadGender);
      formData.append("panel", leadPanel);
      if (leadNote.trim()) formData.append("leadNote", leadNote.trim());
      if (leaderChoice === "__new__") formData.append("newLeaderName", newLeaderName.trim());
      else formData.append("leaderId", leaderChoice);
      if (attachmentFile) formData.append("attachment", attachmentFile);
      formData.append("cardType", attachmentCardType);
      if (idNumber.trim()) formData.append("idNumber", idNumber.trim());
      if (pendingDuplicateWarning) formData.append("confirmDuplicate", "true");

      const res = await axios.post(`${API_BASE}/referrals/marketing-submit`, formData, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setLeadSuccess(res.data.message || "Lead submitted.");
      resetLeadForm();
      setShowLeadForm(false);
      loadReport(token); // refresh stats + leaders list, in case a new leader was just created
      loadActiveDirectory(token);
      loadMyLeads(token);
    } catch (err) {
      if (err.response?.status === 409 && err.response?.data?.possibleDuplicate) {
        // Fuzzy (name + birth year) match, not a hard block — let them decide.
        setPendingDuplicateWarning(err.response.data.error);
      } else {
        setLeadError(err.response?.data?.error || "Failed to submit this lead.");
      }
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
    if (token) {
      loadReport(token);
      loadActiveDirectory(token);
      loadMyLeads(token);
    }
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
            <div style={{ fontSize: 19, fontWeight: 700, color: "var(--ink)" }}>{data.leaders.length}</div>
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
          <h4 style={{ margin: "0 0 10px" }}>Active patients</h4>
          <input
            placeholder="Search by name, card number, or panel…"
            value={directorySearch}
            onChange={(e) => setDirectorySearch(e.target.value)}
            style={{ marginBottom: 10 }}
          />
          {activeDirectory.length > 0 && (
            <div style={{ display: "grid", gridTemplateColumns: "1.3fr 1fr 1fr", gap: 8, padding: "0 2px 6px", borderBottom: "1.5px solid #e4e7ee", fontSize: 11, fontWeight: 700, color: "var(--ink-soft)", textTransform: "uppercase" }}>
              <span>Name</span>
              <span>Panel</span>
              <span style={{ textAlign: "right" }}>Card No.</span>
            </div>
          )}
          <div style={{ maxHeight: 240, overflowY: "auto" }}>
            {activeDirectory.length === 0 ? (
              <p style={{ color: "var(--ink-soft)", fontSize: 13.5, margin: "8px 2px" }}>No active patients right now.</p>
            ) : (
              (() => {
                const q = directorySearch.trim().toLowerCase();
                const filtered = q
                  ? activeDirectory.filter((p) =>
                      p.patientName.toLowerCase().includes(q) ||
                      (p.idNumber || "").toLowerCase().includes(q) ||
                      (p.panel || "").toLowerCase().includes(q)
                    )
                  : activeDirectory;
                return filtered.length === 0 ? (
                  <p style={{ color: "var(--ink-soft)", fontSize: 13.5, margin: "8px 2px" }}>No matches.</p>
                ) : (
                  filtered.map((p, i) => (
                    <div
                      key={i}
                      style={{
                        display: "grid", gridTemplateColumns: "1.3fr 1fr 1fr", gap: 8, alignItems: "center",
                        padding: "8px 2px", borderBottom: "1px solid #f0f1f5", fontSize: 13,
                      }}
                    >
                      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.patientName}</span>
                      <span style={{ color: "var(--ink-soft)", fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.panel || "—"}</span>
                      <span style={{ color: "var(--ink-soft)", textAlign: "right", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.idNumber || "—"}</span>
                    </div>
                  ))
                );
              })()
            )}
          </div>
        </div>

        <div className="card" style={{ marginBottom: 20 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
            <h4 style={{ margin: 0 }}>My leads</h4>
            <button
              type="button"
              className="secondary"
              title="Refresh"
              disabled={myLeadsLoading}
              style={{ width: "auto", padding: "5px 9px" }}
              onClick={() => loadMyLeads(token)}
            >
              <RefreshCw size={14} className={myLeadsLoading ? "spin" : ""} />
            </button>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
            {LEAD_FILTERS.map((f) => {
              const n = f.key === "ALL" ? myLeads.length : myLeads.filter((l) => STAGE_META[l.stage]?.group === f.key).length;
              return (
                <button
                  key={f.key}
                  type="button"
                  className={myLeadsFilter === f.key ? "" : "secondary"}
                  style={{ width: "auto", padding: "4px 10px", fontSize: 12 }}
                  onClick={() => setMyLeadsFilter(f.key)}
                >
                  {f.label} ({n})
                </button>
              );
            })}
          </div>
          {(() => {
            const rows = myLeadsFilter === "ALL" ? myLeads : myLeads.filter((l) => STAGE_META[l.stage]?.group === myLeadsFilter);
            if (rows.length === 0) {
              return (
                <p style={{ color: "var(--ink-soft)", fontSize: 13.5, margin: "8px 2px" }}>
                  {myLeads.length === 0 ? "You haven't submitted any leads yet." : "No leads in this group."}
                </p>
              );
            }
            return (
              <>
                <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1.3fr 0.6fr", gap: 8, padding: "0 2px 6px", borderBottom: "1.5px solid #e4e7ee", fontSize: 11, fontWeight: 700, color: "var(--ink-soft)", textTransform: "uppercase" }}>
                  <span>Patient</span>
                  <span>Status</span>
                  <span style={{ textAlign: "right" }}>Sent</span>
                </div>
                <div style={{ maxHeight: 360, overflowY: "auto" }}>
                  {rows.map((l) => {
                    const meta = STAGE_META[l.stage] || { bg: "#eef0f4", color: "var(--ink-soft)" };
                    return (
                      <div
                        key={l.id}
                        style={{ display: "grid", gridTemplateColumns: "1.4fr 1.3fr 0.6fr", gap: 8, alignItems: "start", padding: "9px 2px", borderBottom: "1px solid #f0f1f5", fontSize: 13 }}
                      >
                        <div style={{ minWidth: 0 }}>
                          <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{l.patientName}</div>
                          <div style={{ color: "var(--ink-soft)", fontSize: 11.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            via {l.leaderName}{l.cardType ? ` · ${l.cardType.charAt(0) + l.cardType.slice(1).toLowerCase()}` : ""}
                          </div>
                        </div>
                        <div style={{ minWidth: 0 }}>
                          <span className="badge" style={{ background: meta.bg, color: meta.color, fontSize: 11.5, padding: "2px 9px" }}>{l.label}</span>
                          {l.note && <div style={{ color: "var(--ink-soft)", fontSize: 11.5, marginTop: 2, wordBreak: "break-word" }}>{l.note}</div>}
                        </div>
                        <span style={{ color: "var(--ink-soft)", fontSize: 12, textAlign: "right" }}>
                          {new Date(l.submittedAt).toLocaleDateString("en-IN", { day: "2-digit", month: "short" })}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </>
            );
          })()}
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

            <label>Panel</label>
            <select value={leadPanel} onChange={(e) => setLeadPanel(e.target.value)} required>
              <option value="">Select panel…</option>
              {PANEL_OPTIONS.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>

            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 4 }}>
              <label style={{ margin: 0 }}>{havePhoto ? "Card / document photo" : "Card / document details"}</label>
              <button
                type="button"
                className="secondary"
                style={{ width: "auto", padding: "3px 10px", fontSize: 12 }}
                onClick={() => {
                  const next = !havePhoto;
                  setHavePhoto(next);
                  setAttachmentFile(null);
                  if (next) setAttachmentCardType(""); // switching back to photo mode: let a scan set it fresh
                }}
              >
                {havePhoto ? "No photo available" : "I have a photo"}
              </button>
            </div>

            {havePhoto ? (
              <>
                <CardScanUpload authToken={token} onExtracted={handleCardScanned} />
                {attachmentFile && (
                  <p style={{ fontSize: 12.5, color: "var(--ink-soft)", marginTop: -10, marginBottom: 8, display: "flex", alignItems: "center", gap: 6 }}>
                    <Paperclip size={12} />Attached — {attachmentCardType === "OTHER" ? "other document" : `${attachmentCardType} card`}
                    <button
                      type="button"
                      className="secondary"
                      style={{ width: "auto", padding: "2px 6px", marginLeft: "auto" }}
                      onClick={() => { setAttachmentFile(null); setAttachmentCardType(""); setIdNumber(""); }}
                    >
                      <X size={12} />
                    </button>
                  </p>
                )}
              </>
            ) : (
              <>
                <label>What kind of card is this?</label>
                <select value={attachmentCardType} onChange={(e) => { setAttachmentCardType(e.target.value); setPendingDuplicateWarning(""); }} required>
                  <option value="">— Select —</option>
                  {CARD_TYPES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                </select>
              </>
            )}

            {attachmentCardType && attachmentCardType !== "OTHER" && (
              <>
                <label>Card / ID number</label>
                <input value={idNumber} onChange={(e) => { setIdNumber(e.target.value); setPendingDuplicateWarning(""); }} placeholder="As printed on the card" required />
              </>
            )}

            <p style={{ fontSize: 11.5, color: "var(--ink-soft)", marginTop: -2, marginBottom: 8 }}>
              Ayushman cards need reception to verify them before the lead moves to Pending — every other lead goes straight to Pending.
            </p>

            <label>Note for reception (optional)</label>
            <textarea
              className="note-input"
              rows={3}
              maxLength={300}
              value={leadNote}
              onChange={(e) => setLeadNote(e.target.value)}
              placeholder="e.g. Cash patient, prescription attached — needs admission today"
            />
            <div style={{ fontSize: 11.5, color: "var(--ink-soft)", textAlign: "right", marginBottom: 10 }}>{leadNote.length}/300</div>

            {pendingDuplicateWarning && (
              <p style={{ fontSize: 13, color: "var(--amber-700, #b45309)", background: "var(--amber-50, #fffbeb)", padding: "8px 10px", borderRadius: 8, marginBottom: 8 }}>
                {pendingDuplicateWarning} Press "Submit anyway" below to confirm this is genuinely a different person.
              </p>
            )}
            {leadError && <p className="error">{leadError}</p>}

            <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
              <button type="submit" disabled={submittingLead}>{submittingLead ? "Submitting…" : pendingDuplicateWarning ? "Submit anyway" : "Submit lead"}</button>
              <button type="button" className="secondary" onClick={() => { resetLeadForm(); setLeadError(""); setShowLeadForm(false); }}>Cancel</button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}

