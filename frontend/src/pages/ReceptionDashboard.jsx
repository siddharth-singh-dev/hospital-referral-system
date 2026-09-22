import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Search, CheckCircle2, XCircle, MapPin, ChevronLeft, ChevronRight, ArrowUpCircle, UserPlus, LogOut, IdCard, Pencil, ClipboardList } from "lucide-react";
import api from "../api/client";
import { formatDate } from "../utils/date";
import DateRangePicker from "../components/DateRangePicker";
import ConfirmLeadModal from "../components/ConfirmLeadModal";
import ConvertToIpdModal from "../components/ConvertToIpdModal";
import AddPatientModal from "../components/AddPatientModal";
import EditReferralModal from "../components/EditReferralModal";
import AttachmentIcon from "../components/AttachmentIcon";
import NotificationBell from "../components/NotificationBell";
import EmptyState from "../components/EmptyState";
import { PANEL_OPTIONS } from "../utils/panels";

const PAGE_SIZE = 10;
const TABS = [
  { key: "CARD_REVIEW", label: "Card Activity" },
  { key: "PENDING", label: "Pending" },
  { key: "CREDITED", label: "Credited" },
  { key: "REJECTED", label: "Rejected" },
  { key: "", label: "All" },
];

export default function ReceptionDashboard() {
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState("PENDING");
  const [doctorId, setDoctorId] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [doctors, setDoctors] = useState([]);
  const [referrals, setReferrals] = useState([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [page, setPage] = useState(1);
  const [confirmModal, setConfirmModal] = useState(null);
  const [convertModal, setConvertModal] = useState(null);
  const [showAddPatient, setShowAddPatient] = useState(false);
  const [editReferralModal, setEditReferralModal] = useState(null);
  const [statusCounts, setStatusCounts] = useState({});
  const navigate = useNavigate();
  const user = JSON.parse(localStorage.getItem("user") || "null");

  async function load() {
    setLoading(true);
    try {
      const { data } = await api.get("/referrals", {
        params: {
          status: tab || undefined,
          search: search || undefined,
          doctorId: doctorId || undefined,
          from: dateFrom || undefined,
          to: dateTo || undefined,
          page: 1,
          pageSize: 100,
        },
      });
      setReferrals(data.referrals);
    } finally {
      setLoading(false);
    }
  }

  async function loadDoctors() {
    try {
      const { data } = await api.get("/doctors/lite");
      setDoctors(data);
    } catch {
      // non-critical — filter dropdown just stays empty
    }
  }

  async function loadStatusCounts() {
    try {
      const { data } = await api.get("/referrals/status-counts");
      setStatusCounts(data);
    } catch {
      // non-critical — tab badges just stay hidden
    }
  }

  useEffect(() => { loadDoctors(); }, []);
  useEffect(() => { load(); }, [tab, doctorId, dateFrom, dateTo]);
  useEffect(() => { setPage(1); }, [tab, doctorId, dateFrom, dateTo, referrals.length]);
  // Keep the Card Activity badge fresh even while looking at another tab — reception
  // shouldn't have to click over to Card Activity just to notice new cards came in.
  useEffect(() => {
    loadStatusCounts();
    const interval = setInterval(loadStatusCounts, 30000);
    return () => clearInterval(interval);
  }, []);
  // Also refresh right away whenever an action changes referral counts (confirm/reject/
  // verify-card all call load() via their own handlers, and referrals.length changing is
  // a reasonable signal that counts moved).
  useEffect(() => { loadStatusCounts(); }, [referrals.length]);

  function openConfirmModal(referral) {
    setMessage("");
    setConfirmModal(referral);
  }

  async function handleConfirmLead({ fileNumber, visitType, idNumber }) {
    const referral = confirmModal;
    await api.post(`/referrals/${referral.id}/arrive`, { fileNumber, visitType, idNumber });
    setMessage(`Patient confirmed as ${visitType} (File No. ${fileNumber}) — credited to ${referral.doctor?.name}.`);
    setConfirmModal(null);
    load();
  }

  function openConvertModal(referral) {
    setMessage("");
    setConvertModal(referral);
  }

  async function handleConvertToIpd({ fileNumber }) {
    const referral = convertModal;
    await api.post(`/referrals/${referral.id}/convert-to-ipd`, { fileNumber });
    setMessage(`${referral.patientName} converted to IPD (File No. ${fileNumber}) — ${referral.doctor?.name}'s credit updated.`);
    setConvertModal(null);
    load();
  }

  async function discharge(referral) {
    if (!confirm(`Mark ${referral.patientName} as discharged now?`)) return;
    setMessage("");
    try {
      await api.post(`/referrals/${referral.id}/discharge`);
      setMessage(`${referral.patientName} marked as discharged.`);
      load();
    } catch (err) {
      setMessage(err.response?.data?.error || "Failed to mark as discharged");
    }
  }

  async function updatePanel(referralId, panel) {
    try {
      await api.patch(`/referrals/${referralId}/panel`, { panel: panel || null });
      load();
    } catch (err) {
      setMessage(err.response?.data?.error || "Failed to update panel");
    }
  }

  async function reject(id) {
    const reason = prompt("Reason for rejecting this match (optional):") || "";
    try {
      await api.post(`/referrals/${id}/reject`, { reason });
      load();
    } catch (err) {
      setMessage(err.response?.data?.error || "Failed to update referral");
    }
  }

  async function markCardActive(referral) {
    if (!confirm(`Mark ${referral.patientName}'s card as active? This will move the lead into Pending.`)) return;
    setMessage("");
    try {
      await api.post(`/referrals/${referral.id}/verify-card`, { active: true });
      setMessage(`Card verified — ${referral.patientName} is now in Pending.`);
      load();
    } catch (err) {
      setMessage(err.response?.data?.error || "Failed to verify card");
    }
  }

  async function markCardInactive(referral) {
    const reason = prompt("Reason the card isn't active (optional):") || "";
    setMessage("");
    try {
      await api.post(`/referrals/${referral.id}/verify-card`, { active: false, reason });
      setMessage(`${referral.patientName}'s card was marked inactive — moved to Rejected.`);
      load();
    } catch (err) {
      setMessage(err.response?.data?.error || "Failed to verify card");
    }
  }

  function logout() {
    localStorage.clear();
    navigate("/login");
  }

  return (
    <div>
      <div className="topbar">
        <div className="topbar-brand">
          <img src="/logo.png" alt="Vedansh Medicare" />
          <div><strong>Reception — Referral Matching</strong><span className="brand-sub">{user?.hospitalName}{user?.hospitalBranchName ? ` · ${user.hospitalBranchName}` : ""}</span></div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", justifyContent: "flex-end" }}>
          <span style={{ color: "#667085" }}>{user?.name}</span>
          <NotificationBell />
          <button className="secondary" style={{ width: "auto", padding: "6px 14px" }} onClick={logout}>Log out</button>
        </div>
      </div>

      <div className="container-wide">
        <div className="card">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10, marginBottom: 16 }}>
            <div style={{ display: "flex", gap: 8 }}>
              {TABS.map((t) => (
                <button
                  key={t.key}
                  className={`tab-btn ${tab === t.key ? "" : "secondary"}`}
                  style={{ width: "auto" }}
                  onClick={() => setTab(t.key)}
                >
                  {t.label}
                  {t.key === "CARD_REVIEW" && statusCounts.CARD_REVIEW > 0 && (
                    <span
                      style={{
                        marginLeft: 7, background: tab === t.key ? "rgba(255,255,255,0.35)" : "var(--amber-500, #f59e0b)",
                        color: tab === t.key ? "inherit" : "#fff", borderRadius: 999, padding: "1px 7px",
                        fontSize: 12, fontWeight: 700,
                      }}
                    >
                      {statusCounts.CARD_REVIEW}
                    </span>
                  )}
                </button>
              ))}
            </div>
            <button style={{ width: "auto", padding: "8px 16px" }} onClick={() => setShowAddPatient(true)}>
              <UserPlus size={16} />Add patient
            </button>
          </div>

          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 4 }}>
            <div style={{ flex: 1, minWidth: 200, maxWidth: 360 }}>
              <label>Doctor</label>
              <select value={doctorId} onChange={(e) => setDoctorId(e.target.value)}>
                <option value="">All doctors</option>
                {doctors.map((d) => (
                  <option key={d.id} value={d.id}>{d.name}{d.clinicName ? ` (${d.clinicName})` : ""}</option>
                ))}
              </select>
            </div>
          </div>
          <DateRangePicker from={dateFrom} to={dateTo} onChange={({ from, to }) => { setDateFrom(from); setDateTo(to); }} />

          <label>Search by patient name or phone</label>
          <div style={{ display: "flex", gap: 8 }}>
            <input value={search} onChange={(e) => setSearch(e.target.value)} onKeyDown={(e) => e.key === "Enter" && load()} placeholder="e.g. Ramesh or 98765..." />
            <button style={{ width: 120 }} onClick={load} disabled={loading}>{loading ? "…" : <><Search size={15} />Search</>}</button>
          </div>

          {message && <p className="success">{message}</p>}

          {referrals.length === 0 && !loading ? (
            <EmptyState icon={ClipboardList} title="No referrals found" subtitle="Try adjusting your filters or search" />
          ) : (
            <div className="table-wrap">
            <table className="referrals-table">
              <thead>
                <tr>
                  <th>Patient</th><th>Referred by</th><th>Status</th><th>Visit</th><th>Credit</th>
                  <th>Panel</th><th>ID / Card</th><th>Dates</th><th style={{ width: 32 }}></th><th></th>
                </tr>
              </thead>
              <tbody>
                {referrals.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE).map((r) => (
                  <tr key={r.id} style={r.status === "CREDITED" && r.dischargedAt ? { background: "#f4f6fa" } : undefined}>
                    <td>
                      <div className="cell-primary">{r.patientName}{r.attachmentPath && <AttachmentIcon referralId={r.id} />}</div>
                      <div className="cell-secondary">
                        {r.patientAge}{r.patientGender ? `${r.patientGender.charAt(0)}` : ""}
                        {r.fileNumber ? ` · ${r.fileNumber}` : ""}
                        {r.patientPhone ? ` · ${r.patientPhone}` : ""}
                      </div>
                    </td>
                    <td>
                      <div className="cell-primary">{r.doctor?.name}{r.doctor?.clinicName ? ` (${r.doctor.clinicName})` : ""}</div>
                      {r.doctor?.marketingPerson?.name && <div className="cell-secondary">via {r.doctor.marketingPerson.name}</div>}
                    </td>
                    <td><span className={`badge ${r.status}`}>{r.status}</span></td>
                    <td>
                      {r.visitType || "—"}
                      {r.convertedAt && r.visitType === "IPD" ? <div className="cell-secondary">from OPD</div> : null}
                    </td>
                    <td>{r.transaction ? `${Number(r.transaction.amount).toFixed(0)} pts` : "—"}</td>
                    <td>
                      <select
                        value={r.panel || ""}
                        onChange={(e) => updatePanel(r.id, e.target.value)}
                        style={{ minWidth: 120, fontSize: 12.5, padding: "5px 6px" }}
                      >
                        <option value="">— None —</option>
                        {PANEL_OPTIONS.map((p) => (
                          <option key={p} value={p}>{p}</option>
                        ))}
                      </select>
                    </td>
                    <td>
                      {(r.idNumber || r.forceType || r.wardType) ? (
                        <>
                          {r.idNumber && <div className="cell-primary">{r.idNumber}</div>}
                          {(r.forceType || r.wardType) && (
                            <div className="cell-secondary">{[r.forceType, r.wardType].filter(Boolean).join(" · ")}</div>
                          )}
                        </>
                      ) : "—"}
                    </td>
                    <td>
                      <div className="cell-secondary">In: {formatDate(r.createdAt)}</div>
                      {r.dischargedAt && <div className="cell-secondary">Out: {formatDate(r.dischargedAt)}</div>}
                    </td>
                    <td>
                      {r.scanLatitude != null ? (
                        <a
                          href={`https://www.google.com/maps?q=${r.scanLatitude},${r.scanLongitude}`}
                          target="_blank" rel="noreferrer"
                          title={r.scanAddress || "View on map"}
                          style={{ display: "inline-flex" }}
                        >
                          <MapPin size={14} />
                        </a>
                      ) : (
                        <span style={{ color: "var(--border)" }} title="Location not shared"><MapPin size={14} /></span>
                      )}
                    </td>
                    <td className="row-hover-actions" style={{ whiteSpace: "nowrap" }}>
                      <div style={{ display: "flex", gap: 4, justifyContent: "flex-end" }}>
                        {r.status === "CARD_REVIEW" && (
                          <>
                            <button style={{ width: "auto", padding: 7 }} title="Mark card active" onClick={() => markCardActive(r)}><IdCard size={14} /></button>
                            <button className="danger" style={{ width: "auto", padding: 7 }} title="Mark card inactive" onClick={() => markCardInactive(r)}><XCircle size={14} /></button>
                          </>
                        )}
                        {r.status === "PENDING" && (
                          <>
                            <button style={{ width: "auto", padding: 7 }} title="Confirm" onClick={() => openConfirmModal(r)}><CheckCircle2 size={14} /></button>
                            <button className="danger" style={{ width: "auto", padding: 7 }} title="Reject" onClick={() => reject(r.id)}><XCircle size={14} /></button>
                          </>
                        )}
                        {r.status === "CREDITED" && r.visitType === "OPD" && (
                          <button style={{ width: "auto", padding: 7 }} title="Convert to IPD" onClick={() => openConvertModal(r)}><ArrowUpCircle size={14} /></button>
                        )}
                        {r.status === "CREDITED" && !r.dischargedAt && (
                          <button style={{ width: "auto", padding: 7 }} title="Discharge" onClick={() => discharge(r)}><LogOut size={14} /></button>
                        )}
                        <button className="secondary" style={{ width: "auto", padding: 7 }} title="Edit" onClick={() => setEditReferralModal(r)}><Pencil size={14} /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          )}

          {referrals.length > PAGE_SIZE && (
            <div className="pagination">
              <button disabled={page === 1} onClick={() => setPage((p) => p - 1)}><ChevronLeft size={14} /></button>
              {Array.from({ length: Math.ceil(referrals.length / PAGE_SIZE) }, (_, i) => i + 1).map((p) => (
                <button key={p} className={p === page ? "active" : ""} onClick={() => setPage(p)}>{p}</button>
              ))}
              <button disabled={page === Math.ceil(referrals.length / PAGE_SIZE)} onClick={() => setPage((p) => p + 1)}><ChevronRight size={14} /></button>
            </div>
          )}
        </div>
      </div>

      {confirmModal && (
        <ConfirmLeadModal
          patientName={confirmModal.patientName}
          doctorName={confirmModal.doctor?.name}
          initialIdNumber={confirmModal.idNumber}
          onClose={() => setConfirmModal(null)}
          onConfirm={handleConfirmLead}
        />
      )}
      {editReferralModal && (
        <EditReferralModal
          referral={editReferralModal}
          onClose={() => setEditReferralModal(null)}
          onSaved={() => {
            setEditReferralModal(null);
            setMessage("Referral updated.");
            load();
          }}
        />
      )}
      {convertModal && (
        <ConvertToIpdModal
          patientName={convertModal.patientName}
          doctorName={convertModal.doctor?.name}
          currentAmount={convertModal.transaction ? Number(convertModal.transaction.amount) : 0}
          onClose={() => setConvertModal(null)}
          onConvert={handleConvertToIpd}
        />
      )}
      {showAddPatient && (
        <AddPatientModal
          onClose={() => setShowAddPatient(false)}
          onAdded={(data) => {
            setShowAddPatient(false);
            const statusLabel = data?.credited ? "Credited" : "Pending";
            setMessage(
              data?.newLeaderCreated
                ? `Patient added — "${data.doctorName}" was created as a new leader. Now showing under ${statusLabel}.`
                : `Patient added — now showing under ${statusLabel}.`
            );
            setTab(data?.credited ? "CREDITED" : "PENDING");
            load();
          }}
        />
      )}
    </div>
  );
}
