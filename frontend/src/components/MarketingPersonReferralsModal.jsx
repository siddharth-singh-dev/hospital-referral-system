import { useEffect, useState } from "react";
import Modal from "./Modal";
import EmptyState from "./EmptyState";
import api from "../api/client";
import { formatDate } from "../utils/date";
import { ClipboardList } from "lucide-react";

const PERIOD_LABELS = { week: "Weekly", fortnight: "Fortnightly", month: "Monthly", "3months": "3 months", "6months": "6 months" };

// Opened by clicking a slice of one of the "Marketing employee comparison" pie charts —
// lists every referral behind that slice for the same marketing person + window, one row
// per patient: file number, name, admission date, and whichever of paid/pending credit
// applies (a referral only has one or the other, never both, and can have neither if it
// hasn't been credited at all yet).
export default function MarketingPersonReferralsModal({ marketingPersonId, marketingPersonName, period, onClose }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [referrals, setReferrals] = useState([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError("");
      try {
        const { data } = await api.get(`/dashboard/marketing-comparison/${marketingPersonId}/referrals`, { params: { period } });
        if (!cancelled) setReferrals(data.referrals);
      } catch {
        if (!cancelled) setError("Could not load these referrals. Try again in a moment.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [marketingPersonId, period]);

  return (
    <Modal title={`${marketingPersonName} — ${PERIOD_LABELS[period] || period}`} onClose={onClose} width={620}>
      {loading ? (
        <p style={{ color: "var(--ink-soft)" }}>Loading…</p>
      ) : error ? (
        <p className="error">{error}</p>
      ) : referrals.length === 0 ? (
        <EmptyState icon={ClipboardList} title="No referrals in this window" />
      ) : (
        <div className="table-wrap" style={{ maxHeight: 440, overflowY: "auto" }}>
          <table>
            <thead>
              <tr>
                <th>File No.</th>
                <th>Patient</th>
                <th>DOA</th>
                <th>Paid</th>
                <th>Pending</th>
              </tr>
            </thead>
            <tbody>
              {referrals.map((r) => (
                <tr key={r.id}>
                  <td>{r.fileNumber || "—"}</td>
                  <td>{r.patientName}</td>
                  <td>{formatDate(r.doa)}</td>
                  <td style={{ color: "var(--teal-700)", fontWeight: r.paidAmount != null ? 600 : 400 }}>
                    {r.paidAmount != null ? `${r.paidAmount.toFixed(2)} pts` : "—"}
                  </td>
                  <td style={{ color: "#b45309", fontWeight: r.pendingAmount != null ? 600 : 400 }}>
                    {r.pendingAmount != null ? `${r.pendingAmount.toFixed(2)} pts` : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  );
}
