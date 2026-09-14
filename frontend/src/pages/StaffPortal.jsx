import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronLeft, ChevronRight, ArrowUpCircle, LogOut } from "lucide-react";
import api from "../api/client";
import { formatDate, formatDateTime } from "../utils/date";
import RedeemModal from "../components/RedeemModal";
import ConfirmLeadModal from "../components/ConfirmLeadModal";
import ConvertToIpdModal from "../components/ConvertToIpdModal";
import DateRangePicker from "../components/DateRangePicker";
import AttachmentIcon from "../components/AttachmentIcon";
import { PANEL_OPTIONS } from "../utils/panels";

const PAGE_SIZE = 10;

const REFERRAL_TABS = [
  { key: "PENDING", label: "Pending" },
  { key: "CREDITED", label: "Credited" },
  { key: "REJECTED", label: "Rejected" },
  { key: "", label: "All" },
];

export default function StaffPortal() {
  const navigate = useNavigate();
  const user = JSON.parse(localStorage.getItem("user") || "null");
  const permissions = user?.permissions || [];
  const canView = permissions.includes("VIEW_REFERRALS") || permissions.includes("MANAGE_REFERRALS") || permissions.includes("REDEEM_CREDITS");
  const canManage = permissions.includes("MANAGE_REFERRALS");
  const canExport = permissions.includes("EXPORT_REPORTS");
  const canRedeem = permissions.includes("REDEEM_CREDITS");

  const [referrals, setReferrals] = useState([]);
  const [doctors, setDoctors] = useState([]);
  const [tab, setTab] = useState("PENDING");
  const [search, setSearch] = useState("");
  const [doctorId, setDoctorId] = useState("");
  const [payoutFilter, setPayoutFilter] = useState(""); // "" | "unpaid" | "paid" — only shown/used on the Credited tab
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [redeemModal, setRedeemModal] = useState(null);
  const [confirmModal, setConfirmModal] = useState(null);
  const [convertModal, setConvertModal] = useState(null);
  const [page, setPage] = useState(1);

  async function load() {
    if (!canView) return;
    setLoading(true);
    try {
      const { data } = await api.get("/referrals", {
        params: {
          status: tab || undefined,
          search: search || undefined,
          doctorId: doctorId || undefined,
          from: dateFrom || undefined,
          to: dateTo || undefined,
          unpaidOnly: payoutFilter === "unpaid" || undefined,
          paidOnly: payoutFilter === "paid" || undefined,
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
  useEffect(() => { load(); }, [tab, doctorId, dateFrom, dateTo, payoutFilter]);
  useEffect(() => { setPage(1); }, [tab, doctorId, dateFrom, dateTo, payoutFilter, referrals.length]);

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

  async function confirmSingleRedeem({ amount, paymentMethod, referenceNumber, remarks }) {
    const referral = redeemModal.referral;
    await api.post(`/referrals/${referral.id}/redeem`, { amount, paymentMethod, referenceNumber, remarks });
    setMessage("Marked as paid out.");
    setRedeemModal(null);
    load();
  }

  async function confirmBulkRedeem({ paymentMethod, referenceNumber, remarks }) {
    const { doctor } = redeemModal;
    const { data } = await api.post(`/doctors/${doctor.id}/redeem-all`, { paymentMethod, referenceNumber, remarks });
    setMessage(data.message);
    setRedeemModal(null);
    load();
  }

  async function exportReferrals(format) {
    setError("");
    try {
      const res = await api.get(`/referrals/export/${format}`, {
        params: {
          status: tab || undefined,
          search: search || undefined,
          doctorId: doctorId || undefined,
          from: dateFrom || undefined,
          to: dateTo || undefined,
          unpaidOnly: payoutFilter === "unpaid" || undefined,
          paidOnly: payoutFilter === "paid" || undefined,
        },
        responseType: "blob",
      });
      const blob = new Blob([res.data]);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `referrals.${format === "excel" ? "xlsx" : "pdf"}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      setError("Failed to export referrals");
    }
  }

  function logout() {
    localStorage.clear();
    navigate("/login");
  }

  const showActionsColumn = canManage || canRedeem;

  return (
    <div>
      <div className="topbar">
        <div className="topbar-brand">
          <img src="/logo.png" alt="Vedansh Medicare" />
          <div>
            <strong>{user?.customRoleName || "Staff"} Portal</strong>
            <span className="brand-sub">{user?.hospitalName}{user?.hospitalBranchName ? ` · ${user.hospitalBranchName}` : ""}</span>
          </div>
        </div>
        <div>
          <span style={{ marginRight: 16, color: "var(--ink-soft)" }}>{user?.name}</span>
          <button className="secondary" style={{ width: "auto", padding: "6px 14px" }} onClick={logout}>Log out</button>
        </div>
      </div>

      <div className="container-wide">
        {message && <p className="success">{message}</p>}
        {error && <p className="error">{error}</p>}

        {!canView && !canExport && (
          <div className="card">
            <p style={{ color: "var(--ink-soft)" }}>Your role currently doesn't have any assigned capabilities yet. Contact your hospital admin.</p>
          </div>
        )}

        {(canView || canExport) && (
          <div className="card" style={{ marginBottom: 20 }}>
            <h3 style={{ marginTop: 0 }}>Filters</h3>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
              <div style={{ flex: 1, minWidth: 200, maxWidth: 360 }}>
                <label>Doctor</label>
                <select value={doctorId} onChange={(e) => setDoctorId(e.target.value)}>
                  <option value="">All doctors</option>
                  {doctors.map((d) => (
                    <option key={d.id} value={d.id}>{d.name}{d.clinicName ? ` (${d.clinicName})` : ""}</option>
                  ))}
                </select>
              </div>
              {tab === "CREDITED" && (
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  <label>Payout status</label>
                  <div style={{ display: "flex", gap: 6 }}>
                    {[["", "All"], ["unpaid", "Unpaid"], ["paid", "Paid"]].map(([key, label]) => (
                      <button
                        key={key || "all"}
                        type="button"
                        className={payoutFilter === key ? "" : "secondary"}
                        style={{ width: "auto", padding: "8px 16px" }}
                        onClick={() => setPayoutFilter(key)}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
            <DateRangePicker from={dateFrom} to={dateTo} onChange={({ from, to }) => { setDateFrom(from); setDateTo(to); }} />

            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
              {canExport && (
                <>
                  <button style={{ width: "auto", padding: "8px 16px" }} onClick={() => exportReferrals("excel")}>⬇ Export Excel</button>
                  <button className="secondary" style={{ width: "auto", padding: "8px 16px" }} onClick={() => exportReferrals("pdf")}>⬇ Export PDF</button>
                </>
              )}
              {canRedeem && doctorId && (
                <button
                  className="btn-redeem"
                  style={{ width: "auto", padding: "6px 14px" }}
                  onClick={() => {
                    const doctor = doctors.find((d) => d.id === doctorId);
                    if (!doctor) return;
                    if (!doctor.pendingCount) { setMessage(`${doctor.name} has no pending credits to redeem.`); return; }
                    setRedeemModal({ mode: "bulk", doctor, defaultAmount: doctor.pendingAmount, count: doctor.pendingCount });
                  }}
                >
                  💰 Redeem all pending for this doctor
                </button>
              )}
            </div>
            {canExport && <p style={{ color: "var(--ink-soft)", fontSize: 13, marginTop: 8 }}>Exports respect the filters above plus the status tab and search below.</p>}
          </div>
        )}

        {canView && (
          <div className="card">
            <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
              {REFERRAL_TABS.map((t) => (
                <button key={t.key} className={`tab-btn ${tab === t.key ? "" : "secondary"}`} style={{ width: "auto" }} onClick={() => setTab(t.key)}>
                  {t.label}
                </button>
              ))}
            </div>

            <label>Search by patient name or phone</label>
            <div style={{ display: "flex", gap: 8 }}>
              <input value={search} onChange={(e) => setSearch(e.target.value)} onKeyDown={(e) => e.key === "Enter" && load()} placeholder="e.g. Ramesh or 98765..." />
              <button style={{ width: 120 }} onClick={load} disabled={loading}>{loading ? "…" : "Search"}</button>
            </div>

            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Patient</th><th>File No.</th><th>Age</th><th>Gender</th><th>Referred by</th><th>Through</th><th>Status</th><th>Visit</th><th>Credit</th><th>Payout</th><th>Discharged</th><th>Panel</th><th>Location</th><th>Submitted</th>
                    {showActionsColumn && <th></th>}
                  </tr>
                </thead>
                <tbody>
                  {referrals.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE).map((r) => (
                    <tr key={r.id}>
                      <td>{r.patientName}{r.attachmentPath && <AttachmentIcon referralId={r.id} />}</td>
                      <td>{r.fileNumber || "—"}</td>
                      <td>{r.patientAge}</td>
                      <td>{r.patientGender ? r.patientGender.charAt(0) + r.patientGender.slice(1).toLowerCase() : "—"}</td>
                      <td>{r.doctor?.name}{r.doctor?.clinicName ? ` (${r.doctor.clinicName})` : ""}</td>
                      <td>{r.doctor?.marketingPerson?.name || "—"}</td>
                      <td><span className={`badge ${r.status}`}>{r.status}</span></td>
                      <td>{r.visitType || "—"}{r.convertedAt && r.visitType === "IPD" ? <span style={{ marginLeft: 4, fontSize: 11, color: "var(--ink-soft)" }}>(from OPD)</span> : null}</td>
                      <td>{r.transaction ? `${Number(r.transaction.amount).toFixed(2)} pts` : "—"}</td>
                      <td>
                        {r.transaction ? (
                          <span className={`badge ${r.transaction.redeemed ? "CREDITED" : "PENDING"}`}>{r.transaction.redeemed ? "Paid" : "Unpaid"}</span>
                        ) : "—"}
                      </td>
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
                            {r.scanAddress ? r.scanAddress.slice(0, 25) + "…" : "View on map"}
                          </a>
                        ) : <span style={{ color: "var(--ink-soft)" }}>Not shared</span>}
                      </td>
                      <td>{formatDate(r.createdAt)}</td>
                      {showActionsColumn && (
                        <td style={{ whiteSpace: "nowrap" }}>
                          <div style={{ display: "flex", gap: 6 }}>
                            {canManage && r.status === "PENDING" && (
                              <>
                                <button style={{ width: "auto", padding: "6px 10px" }} onClick={() => openConfirmModal(r)}>Confirm arrival</button>
                                <button className="danger" style={{ width: "auto", padding: "6px 10px" }} onClick={() => reject(r.id)}>Reject</button>
                              </>
                            )}
                            {canManage && r.status === "CREDITED" && r.visitType === "OPD" && (
                              <button style={{ width: "auto", padding: "6px 10px" }} onClick={() => openConvertModal(r)}><ArrowUpCircle size={14} />Convert to IPD</button>
                            )}
                            {canManage && r.status === "CREDITED" && !r.dischargedAt && (
                              <button style={{ width: "auto", padding: "6px 10px" }} onClick={() => discharge(r)}><LogOut size={14} />Discharge</button>
                            )}
                            {canRedeem && r.transaction && !r.transaction.redeemed && (
                              <button className="btn-redeem" style={{ width: "auto", padding: "6px 14px" }} onClick={() => setRedeemModal({ mode: "single", referral: r, defaultAmount: Number(r.transaction.amount) })}>Redeem</button>
                            )}
                          </div>
                        </td>
                      )}
                    </tr>
                  ))}
                  {referrals.length === 0 && !loading && (
                    <tr><td colSpan={showActionsColumn ? 15 : 14} style={{ color: "var(--ink-soft)" }}>No referrals found.</td></tr>
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
        )}
      </div>

      {redeemModal && redeemModal.mode === "bulk" && (
        <RedeemModal
          mode="bulk"
          doctorName={redeemModal.doctor.name}
          defaultAmount={redeemModal.defaultAmount}
          count={redeemModal.count}
          onClose={() => setRedeemModal(null)}
          onConfirm={confirmBulkRedeem}
        />
      )}
      {redeemModal && redeemModal.mode === "single" && (
        <RedeemModal
          mode="single"
          doctorName={redeemModal.referral.doctor?.name}
          defaultAmount={redeemModal.defaultAmount}
          onClose={() => setRedeemModal(null)}
          onConfirm={confirmSingleRedeem}
        />
      )}
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
    </div>
  );
}
