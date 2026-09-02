import { useEffect, useState } from "react";
import { Save } from "lucide-react";
import Modal from "./Modal";
import api from "../api/client";
import { PANEL_OPTIONS } from "../utils/panels";

const CARD_LABELS = { AADHAAR: "Aadhaar", AYUSHMAN: "Ayushman", CGHS: "CGHS", ECHS: "ECHS", CAPF: "CAPF" };
const CARD_TYPE_OPTIONS = ["AADHAAR", "AYUSHMAN", "CGHS", "ECHS", "CAPF"];

// Full-row edit for a referral, opened from the pencil icon in the "All Referrals" table.
// Covers the same fields the manual "Add patient" form captures, plus reassigning the
// referring leader and fixing the visit type — this is the admin's fix-up path for a bad OCR
// read, a mistyped bulk-import row, or anything else that needs correcting after the fact.
export default function EditReferralModal({ referral, onClose, onSaved }) {
  const [leaders, setLeaders] = useState([]);
  const [loadingLeaders, setLoadingLeaders] = useState(true);
  const [doctorId, setDoctorId] = useState(referral.doctorId || referral.doctor?.id || "");
  const [patientName, setPatientName] = useState(referral.patientName || "");
  const [patientAge, setPatientAge] = useState(referral.patientAge != null ? String(referral.patientAge) : "");
  const [patientGender, setPatientGender] = useState(referral.patientGender || "MALE");
  const [patientPhone, setPatientPhone] = useState(referral.patientPhone || "");
  const [fileNumber, setFileNumber] = useState(referral.fileNumber || "");
  const [visitType, setVisitType] = useState(referral.visitType || "");
  const [panel, setPanel] = useState(referral.panel || "");
  const [idType, setIdType] = useState(referral.idType || "");
  const [idNumber, setIdNumber] = useState(referral.idNumber || "");
  const [forceType, setForceType] = useState(referral.forceType || "");
  const [wardType, setWardType] = useState(referral.wardType || "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const { data } = await api.get("/doctors/lite");
        setLeaders(data);
      } catch {
        setError("Could not load the list of leaders. Try again in a moment.");
      } finally {
        setLoadingLeaders(false);
      }
    })();
  }, []);

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      const payload = {
        doctorId: doctorId || undefined,
        patientName: patientName.trim(),
        patientAge: Number(patientAge),
        patientGender,
        patientPhone: patientPhone.trim() || null,
        fileNumber: fileNumber.trim() || null,
        visitType: visitType || null,
        panel: panel || null,
        idType: idType || null,
        idNumber: idNumber.trim() || null,
        forceType: forceType.trim() || null,
        wardType: wardType.trim() || null,
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
        <select value={doctorId} onChange={(e) => setDoctorId(e.target.value)} disabled={loadingLeaders} required>
          {loadingLeaders && <option value="">Loading leaders…</option>}
          {!loadingLeaders && !leaders.some((l) => l.id === doctorId) && (
            <option value={doctorId}>{referral.doctor?.name}{referral.doctor?.clinicName ? ` (${referral.doctor.clinicName})` : ""}</option>
          )}
          {leaders.map((l) => (
            <option key={l.id} value={l.id}>{l.name}{l.clinicName ? ` (${l.clinicName})` : ""}</option>
          ))}
        </select>

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

        <label>ID / card type (optional)</label>
        <select value={idType} onChange={(e) => setIdType(e.target.value)}>
          <option value="">— None —</option>
          {CARD_TYPE_OPTIONS.map((t) => <option key={t} value={t}>{CARD_LABELS[t]}</option>)}
        </select>

        {idType === "AADHAAR" && (
          <>
            <label>Aadhaar number</label>
            <input value={idNumber} onChange={(e) => setIdNumber(e.target.value)} placeholder="XXXX XXXX 1234" />
          </>
        )}
        {idType === "AYUSHMAN" && (
          <>
            <label>Ayushman number</label>
            <input value={idNumber} onChange={(e) => setIdNumber(e.target.value)} />
          </>
        )}
        {(idType === "CGHS" || idType === "ECHS" || idType === "CAPF") && (
          <>
            <label>Force / category</label>
            <input value={forceType} onChange={(e) => setForceType(e.target.value)} placeholder="e.g. BSF, ARMY, Pensioner" />
            <label>Ward type</label>
            <input value={wardType} onChange={(e) => setWardType(e.target.value)} placeholder="e.g. Semi-Private Ward" />
            <label>Card number</label>
            <input value={idNumber} onChange={(e) => setIdNumber(e.target.value)} />
          </>
        )}

        {error && <p className="error">{error}</p>}

        <button type="submit" disabled={submitting || loadingLeaders} style={{ marginTop: 8 }}>
          <Save size={16} />
          {submitting ? "Saving…" : "Save changes"}
        </button>
      </form>
    </Modal>
  );
}
