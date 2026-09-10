import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Search, CheckCircle2, XCircle, MapPin, ChevronLeft, ChevronRight, ArrowUpCircle, UserPlus, LogOut } from "lucide-react";
import api from "../api/client";
import { formatDate, formatDateTime } from "../utils/date";
import DateRangePicker from "../components/DateRangePicker";
import ConfirmLeadModal from "../components/ConfirmLeadModal";
import ConvertToIpdModal from "../components/ConvertToIpdModal";
import AddPatientModal from "../components/AddPatientModal";
import { PANEL_OPTIONS } from "../utils/panels";

const PAGE_SIZE = 10;
const TABS = [
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

  useEffect(() => { loadDoctors(); }, []);
  useEffect(() => { load(); }, [tab, doctorId, dateFrom, dateTo]);
  useEffect(() => { setPage(1); }, [tab, doctorId, dateFrom, dateTo, referrals.length]);

  function openConfirmModal(referral) {
    setMessage("");
    setConfirmModal(referral);
  }

  async function handleConfirmLead({ fileNumber, visitType }) {
    const referral = confirmModal;
    await api.post(`/referrals/${referral.id}/arrive`, { fileNumber, visitType });
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
        <div>
          <span style={{ marginRight: 16, color: "#667085" }}>{user?.name}</span>
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

          <div className="table-wrap">
          <table>
            <thead>
              <tr><th>Patient</th><th>File No.</th><th>Age</th><th>Gender</th><th>Phone</th><th>Referred by</th><th>Through</th><th>Status</th><th>Visit</th><th>Credit</th><th>Discharged</th><th>Panel</th><th>Location</th><th>Submitted</th><th></th></tr>
            </thead>
            <tbody>
              {referrals.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE).map((r) => (
                <tr key={r.id}>
                  <td>{r.patientName}</td>
                  <td>{r.fileNumber || "—"}</td>
                  <td>{r.patientAge}</td>
                  <td>{r.patientGender ? r.patientGender.charAt(0) + r.patientGender.slice(1).toLowerCase() : "—"}</td>
                  <td>{r.patientPhone || "—"}</td>
                  <td>{r.doctor?.name}{r.doctor?.clinicName ? ` (${r.doctor.clinicName})` : ""}</td>
                  <td>{r.doctor?.marketingPerson?.name || "—"}</td>
                  <td><span className={`badge ${r.status}`}>{r.status}</span></td>
                  <td>{r.visitType || "—"}{r.convertedAt && r.visitType === "IPD" ? <span style={{ marginLeft: 4, fontSize: 11, color: "var(--ink-soft)" }}>(from OPD)</span> : null}</td>
                  <td>{r.transaction ? `${Number(r.transaction.amount).toFixed(2)} pts` : "—"}</td>
                  <td>{r.dischargedAt ? formatDateTime(r.dischargedAt) : "—"}</td>
                  <td>
                    <select
                      value={r.panel || ""}
                      onChange={(e) => updatePanel(r.id, e.target.value)}
                      style={{ minWidth: 140, fontSize: 13, padding: "6px 8px" }}
                    >
                      <option value="">— None —</option>
                      {PANEL_OPTIONS.map((p) => (
                        <option key={p} value={p}>{p}</option>
                      ))}
                    </select>
                  </td>
                  <td>
                    {r.scanLatitude != null ? (
                      <a href={`https://www.google.com/maps?q=${r.scanLatitude},${r.scanLongitude}`} target="_blank" rel="noreferrer">
                        {r.scanAddress ? r.scanAddress.slice(0, 30) + (r.scanAddress.length > 30 ? "…" : "") : "View on map"}
                      </a>
                    ) : (
                      <span style={{ color: "var(--ink-soft)" }}>Not shared</span>
                    )}
                  </td>
                  <td>{formatDate(r.createdAt)}</td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    <div style={{ display: "flex", gap: 6 }}>
                      {r.status === "PENDING" && (
                        <>
                          <button style={{ width: "auto", padding: "6px 10px" }} onClick={() => openConfirmModal(r)}><CheckCircle2 size={14} />Confirm</button>
                          <button className="danger" style={{ width: "auto", padding: "6px 10px" }} onClick={() => reject(r.id)}><XCircle size={14} />Reject</button>
                        </>
                      )}
                      {r.status === "CREDITED" && r.visitType === "OPD" && (
                        <button style={{ width: "auto", padding: "6px 10px" }} onClick={() => openConvertModal(r)}><ArrowUpCircle size={14} />Convert to IPD</button>
                      )}
                      {r.status === "CREDITED" && !r.dischargedAt && (
                        <button style={{ width: "auto", padding: "6px 10px" }} onClick={() => discharge(r)}><LogOut size={14} />Discharge</button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {referrals.length === 0 && !loading && (
                <tr><td colSpan={15} style={{ color: "var(--ink-soft)" }}>No referrals found.</td></tr>
              )}
            </tbody>
          </table>
          </div>

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
          onClose={() => setConfirmModal(null)}
          onConfirm={handleConfirmLead}
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
