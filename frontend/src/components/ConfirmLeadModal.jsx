import { useEffect, useState } from "react";
import { CheckCircle2 } from "lucide-react";
import Modal from "./Modal";
import api from "../api/client";

// Confirms a lead's arrival: reception records the visit's IPD/OPD file number, whether this
// was an IPD or OPD visit, and the patient's card/ID number (required — this is what powers
// the already-admitted-elsewhere check on the backend; without it that check has nothing to
// compare against). The credited amount is fixed by the admin per visit type — it is shown
// here for transparency but can't be edited from this screen.
export default function ConfirmLeadModal({ patientName, doctorName, initialIdNumber, onClose, onConfirm }) {
  const [amounts, setAmounts] = useState(null);
  const [loadingAmounts, setLoadingAmounts] = useState(true);
  const [fileNumber, setFileNumber] = useState("");
  const [visitType, setVisitType] = useState("OPD");
  const [idNumber, setIdNumber] = useState(initialIdNumber || "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const { data } = await api.get("/hospitals/settings");
        setAmounts(data);
      } catch {
        setError("Could not load IPD/OPD amounts. Ask your admin to set them under hospital settings.");
      } finally {
        setLoadingAmounts(false);
      }
    })();
  }, []);

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    if (!fileNumber.trim()) {
      setError(`Please enter the ${visitType} file number.`);
      return;
    }
    if (!idNumber.trim()) {
      setError("Please enter the patient's card/ID number.");
      return;
    }
    setSubmitting(true);
    try {
      await onConfirm({ fileNumber: fileNumber.trim(), visitType, idNumber: idNumber.trim() });
    } catch (err) {
      setError(err?.response?.data?.error || "Failed to confirm this lead.");
      setSubmitting(false);
    }
  }

  const selectedAmount = amounts ? Number(visitType === "IPD" ? amounts.ipdAmount : amounts.opdAmount) : null;

  return (
    <Modal title="Confirm lead" onClose={onClose} width={420}>
      <form onSubmit={handleSubmit}>
        <p style={{ fontSize: 14, color: "var(--ink-soft)", marginTop: -4 }}>
          {patientName}{doctorName ? <> — referred by <strong>{doctorName}</strong></> : null}
        </p>

        <label>Visit type</label>
        <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
          {["OPD", "IPD"].map((type) => (
            <button
              key={type}
              type="button"
              className={visitType === type ? "" : "secondary"}
              style={{ width: "auto", flex: 1, padding: "8px 0" }}
              onClick={() => setVisitType(type)}
            >
              {type}
            </button>
          ))}
        </div>

        <label>{visitType} file number</label>
        <input value={fileNumber} onChange={(e) => setFileNumber(e.target.value)} placeholder={`e.g. ${visitType}-00123`} autoFocus required />

        <label>Card / ID number</label>
        <input value={idNumber} onChange={(e) => setIdNumber(e.target.value)} placeholder="Aadhaar, Ayushman, CGHS/ECHS/CAPF card number, etc." required />
        <p style={{ fontSize: 11.5, color: "var(--ink-soft)", marginTop: -6, marginBottom: 10 }}>
          Required — used to catch the same patient being admitted twice before they're discharged.
        </p>

        <p style={{ fontSize: 13, color: "var(--ink-soft)" }}>
          {loadingAmounts
            ? "Loading credit amount…"
            : amounts
            ? <>This will credit <strong>{selectedAmount.toFixed(2)} pts</strong> to {doctorName || "the referring doctor"} ({visitType}, fixed by admin).</>
            : null}
        </p>

        {error && <p className="error">{error}</p>}

        <button type="submit" disabled={submitting || loadingAmounts}>
          <CheckCircle2 size={16} />
          {submitting ? "Confirming…" : "Confirm lead"}
        </button>
      </form>
    </Modal>
  );
}
