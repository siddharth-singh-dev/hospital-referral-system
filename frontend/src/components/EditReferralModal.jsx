import { useEffect, useState } from "react";
import { Save } from "lucide-react";
import Modal from "./Modal";
import api from "../api/client";
import { PANEL_OPTIONS } from "../utils/panels";

// Converts an ISO timestamp from the API into the "YYYY-MM-DDTHH:mm" shape a
// <input type="datetime-local"> expects, in the browser's local time. Empty/missing
// input just clears the field rather than throwing.
function toDatetimeLocal(isoString) {
  if (!isoString) return "";
  const d = new Date(isoString);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// Full-row edit for a referral, opened from the pencil icon in the "All Referrals" table.
// Covers the same fields the manual "Add patient" form captures, plus the admission/discharge
// dates and credit amount that get set later by Confirm/Discharge/Redeem — this is the admin's
// fix-up path for a bad OCR read, a mistyped bulk-import row, or anything else that needs
// correcting after the fact. "Referred by" and Marketing Person are intentionally NOT editable
// here: the referring leader is fixed once a referral exists, and Marketing Person always
// follows from that leader rather than being entered directly.
export default function EditReferralModal({ referral, onClose, onSaved }) {
  const [patientName, setPatientName] = useState(referral.patientName || "");
  const [patientAge, setPatientAge] = useState(referral.patientAge != null ? String(referral.patientAge) : "");
  const [patientGender, setPatientGender] = useState(referral.patientGender || "MALE");
  const [patientPhone, setPatientPhone] = useState(referral.patientPhone || "");
  const [fileNumber, setFileNumber] = useState(referral.fileNumber || "");
  const [visitType, setVisitType] = useState(referral.visitType || "");
  const [panel, setPanel] = useState(referral.panel || "");
  const [idNumber, setIdNumber] = useState(referral.idNumber || "");
  const [forceType, setForceType] = useState(referral.forceType || "");
  const [wardType, setWardType] = useState(referral.wardType || "");
  const [admissionDate, setAdmissionDate] = useState(toDatetimeLocal(referral.createdAt));
  const [dischargedDate, setDischargedDate] = useState(toDatetimeLocal(referral.dischargedAt));
  const [creditAmount, setCreditAmount] = useState(referral.transaction ? String(referral.transaction.amount) : "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      const payload = {
        patientName: patientName.trim(),
        patientAge: Number(patientAge),
        patientGender,
        patientPhone: patientPhone.trim() || null,
        fileNumber: fileNumber.trim() || null,
        visitType: visitType || null,
        panel: panel || null,
        idNumber: idNumber.trim() || null,
        forceType: forceType.trim() || null,
        wardType: wardType.trim() || null,
        admissionDate: admissionDate || null,
        dischargedDate: dischargedDate || null,
        ...(referral.transaction ? { creditAmount: creditAmount.trim() !== "" ? Number(creditAmount) : null } : {}),
      };
      const { data } = await api.patch(`/referrals/${referral.id}`, payload);
      onSaved?.(data);
    } catch (err) {
      setError(err?.response?.data?.error || "Failed to save changes.");
      setSubmitting(false);
    }
  }

  return (
    <Modal title="Edit referral" onClose={onClose} width={440}>
      <form onSubmit={handleSubmit}>
        <label>Referred by</label>
        <input
          value={`${referral.doctor?.name || ""}${referral.doctor?.clinicName ? ` (${referral.doctor.clinicName})` : ""}`}
          disabled
        />
        <p style={{ fontSize: 11.5, color: "var(--ink-soft)", marginTop: -6, marginBottom: 8 }}>
          Not editable here — the referring leader is fixed once a referral exists.
        </p>

        <label>Patient name</label>
        <input value={patientName} onChange={(e) => setPatientName(e.target.value)} required />

        <label>Patient age</label>
        <input type="number" min="0" max="130" value={patientAge} onChange={(e) => setPatientAge(e.target.value)} required />

        <label>Patient gender</label>
        <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
          {["MALE", "FEMALE", "OTHER"].map((g) => (
            <button
              key={g}
              type="button"
              className={patientGender === g ? "" : "secondary"}
              style={{ width: "auto", flex: 1, padding: "8px 0" }}
              onClick={() => setPatientGender(g)}
            >
              {g.charAt(0) + g.slice(1).toLowerCase()}
            </button>
          ))}
        </div>

        <label>Patient phone (optional)</label>
        <input value={patientPhone} onChange={(e) => setPatientPhone(e.target.value)} placeholder="e.g. 98765 43210" />

        <label>File number (optional)</label>
        <input value={fileNumber} onChange={(e) => setFileNumber(e.target.value)} placeholder="e.g. IPD-3001" />

        <label>Visit type</label>
        <select value={visitType} onChange={(e) => setVisitType(e.target.value)}>
          <option value="">— Not set —</option>
          <option value="IPD">IPD</option>
          <option value="OPD">OPD</option>
        </select>

        <label>Panel (optional)</label>
        <select value={panel} onChange={(e) => setPanel(e.target.value)}>
          <option value="">— None —</option>
          {PANEL_OPTIONS.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>

        <label>ID number (optional)</label>
        <input value={idNumber} onChange={(e) => setIdNumber(e.target.value)} placeholder="Aadhaar, Ayushman, CGHS/ECHS/CAPF card number, etc." />

        <label>Force / category (optional)</label>
        <input value={forceType} onChange={(e) => setForceType(e.target.value)} placeholder="e.g. Cash Patient, Ayushman Bharat, BSF, Pensioner" />

        <label>Ward type (optional)</label>
        <input value={wardType} onChange={(e) => setWardType(e.target.value)} placeholder="e.g. General Ward, Semi-Private Ward, ICU, NICU" />

        <label>Admission date (optional)</label>
        <input type="datetime-local" value={admissionDate} onChange={(e) => setAdmissionDate(e.target.value)} />

        <label>Discharged date (optional)</label>
        <input type="datetime-local" value={dischargedDate} onChange={(e) => setDischargedDate(e.target.value)} />

        <label>Credit amount{referral.transaction ? "" : " (not credited yet)"}</label>
        <input
          type="number" min="0" step="0.01"
          value={creditAmount}
          onChange={(e) => setCreditAmount(e.target.value)}
          disabled={!referral.transaction}
          placeholder={referral.transaction ? "" : "This referral hasn't been credited yet"}
        />

        {error && <p className="error">{error}</p>}

        <button type="submit" disabled={submitting} style={{ marginTop: 8 }}>
          <Save size={16} />
          {submitting ? "Saving…" : "Save changes"}
        </button>
      </form>
    </Modal>
  );
}
