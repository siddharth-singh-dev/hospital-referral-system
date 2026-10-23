import { useEffect, useState } from "react";
import { ArrowUpCircle } from "lucide-react";
import Modal from "./Modal";
import api from "../api/client";
import FileNumberInput from "./FileNumberInput";
import { buildFileNumber, financialYearLabel } from "../utils/fileNumber";

// Used when an OPD lead later gets admitted. Reception enters the new IPD file number;
// the doctor's credit is bumped from the OPD amount up to the (admin-fixed) IPD amount.
export default function ConvertToIpdModal({ patientName, doctorName, currentAmount, onClose, onConvert }) {
  const [ipdAmount, setIpdAmount] = useState(null);
  const [loadingAmount, setLoadingAmount] = useState(true);
  const [fileNumber, setFileNumber] = useState(""); // just the digits — prefix and financial year are fixed
  const fy = financialYearLabel();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const { data } = await api.get("/hospitals/settings");
        setIpdAmount(Number(data.ipdAmount));
      } catch {
        setError("Could not load the IPD amount. Ask your admin to set it under hospital settings.");
      } finally {
        setLoadingAmount(false);
      }
    })();
  }, []);

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    if (!fileNumber.trim()) {
      setError("Please enter the new IPD file number.");
      return;
    }
    setSubmitting(true);
    try {
      await onConvert({ fileNumber: buildFileNumber("IPD", fileNumber, fy) });
    } catch (err) {
      setError(err?.response?.data?.error || "Failed to convert this lead to IPD.");
      setSubmitting(false);
    }
  }

  return (
    <Modal title="Convert to IPD" onClose={onClose} width={420}>
      <form onSubmit={handleSubmit}>
        <p style={{ fontSize: 14, color: "var(--ink-soft)", marginTop: -4 }}>
          {patientName}{doctorName ? <> — referred by <strong>{doctorName}</strong></> : null}
        </p>

        <label>New IPD file number</label>
        <FileNumberInput visitType="IPD" value={fileNumber} onChange={setFileNumber} fy={fy} autoFocus required />

        <p style={{ fontSize: 13, color: "var(--ink-soft)" }}>
          {loadingAmount
            ? "Loading credit amount…"
            : ipdAmount != null
            ? (
              <>
                This patient was admitted. {doctorName || "The referring doctor"}'s credit will move from{" "}
                <strong>{Number(currentAmount ?? 0).toFixed(2)} pts (OPD)</strong> to{" "}
                <strong>{ipdAmount.toFixed(2)} pts (IPD)</strong>.
              </>
            )
            : null}
        </p>

        {error && <p className="error">{error}</p>}

        <button type="submit" disabled={submitting || loadingAmount}>
          <ArrowUpCircle size={16} />
          {submitting ? "Converting…" : "Convert to IPD"}
        </button>
      </form>
    </Modal>
  );
}
