import { useState } from "react";
import { Upload, Download, CheckCircle2, AlertTriangle } from "lucide-react";
import Modal from "./Modal";
import api from "../api/client";

// Lets an admin backfill referrals that already happened before this system was in use.
// Only Name and File No. are required per row; everything else is optional. Rows are
// imported straight as CREDITED, since a file number implies the patient already went
// through in real life — this isn't for new pending leads, just historical records.
export default function BulkImportReferralsModal({ onClose, onImported }) {
  const [file, setFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState(null); // { createdCount, skippedCount, skipped, newLeadersCreated }
  const [error, setError] = useState("");

  async function downloadTemplate() {
    try {
      const res = await api.get("/referrals/bulk-import/template", { responseType: "blob" });
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const link = document.createElement("a");
      link.href = url;
      link.download = "referred-patients-bulk-import-template.xlsx";
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch {
      setError("Could not download the template. Try again in a moment.");
    }
  }

  async function handleUpload(e) {
    e.preventDefault();
    if (!file) {
      setError("Choose an Excel file first.");
      return;
    }
    setError("");
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const { data } = await api.post("/referrals/bulk-import", formData, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      setResult(data);
      if (data.createdCount > 0) onImported?.();
    } catch (err) {
      setError(err?.response?.data?.error || "Failed to import this file.");
    } finally {
      setUploading(false);
    }
  }

  return (
    <Modal title="Bulk import referred patients" onClose={onClose} width={540}>
      {!result ? (
        <form onSubmit={handleUpload}>
          <p style={{ fontSize: 14, color: "var(--ink-soft)", marginTop: -4 }}>
            For patients who were already referred and treated before this system was in use.
            Only <strong>Name</strong> and <strong>File No.</strong> are required — Age, Gender, Phone,
            Referred By, Marketing Person, Visit Type, Panel, Credit Amount, Submitted Date, and Discharged Date
            are all optional. Rows are imported as <strong>Credited</strong>.
          </p>
          <p style={{ fontSize: 13, color: "var(--ink-soft)", marginTop: -6 }}>
            File numbers must be in the format <strong>IPD-13531/26-27</strong> or <strong>OPD-13531/26-27</strong>, and each
            number can be used only once — rows with a different format, or a number that is already in use, are skipped
            and listed after the import.
          </p>

          <button type="button" className="secondary" style={{ width: "auto", padding: "8px 14px", marginBottom: 16 }} onClick={downloadTemplate}>
            <Download size={15} />Download template
          </button>

          <label>Excel file</label>
          <input
            type="file"
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            onChange={(e) => setFile(e.target.files?.[0] || null)}
            required
          />

          <p style={{ fontSize: 12, color: "var(--ink-soft)" }}>
            If "Referred By" is left blank, the patient is filed under a shared "Self" leader.
            A name that isn't in your Leaders list yet gets created automatically. "Marketing Person" works
            the same way, and is linked to that leader only if the leader doesn't already have one set.
          </p>

          {error && <p className="error">{error}</p>}

          <button type="submit" disabled={uploading} style={{ marginTop: 4 }}>
            <Upload size={16} />
            {uploading ? "Importing…" : "Import patients"}
          </button>
        </form>
      ) : (
        <div>
          <p style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--green-700)", fontWeight: 600 }}>
            <CheckCircle2 size={18} />{result.createdCount} patient{result.createdCount === 1 ? "" : "s"} imported
          </p>
          {result.newLeadersCreated > 0 && (
            <p style={{ fontSize: 13, color: "var(--ink-soft)", marginTop: -4 }}>
              {result.newLeadersCreated} new leader{result.newLeadersCreated === 1 ? "" : "s"} were created from the "Referred By" column.
            </p>
          )}
          {result.newMarketingPersonsCreated > 0 && (
            <p style={{ fontSize: 13, color: "var(--ink-soft)", marginTop: -4 }}>
              {result.newMarketingPersonsCreated} new marketing person{result.newMarketingPersonsCreated === 1 ? "" : "s"} were created from the "Marketing Person" column.
            </p>
          )}

          {result.skippedCount > 0 && (
            <div style={{ marginTop: 12 }}>
              <p style={{ display: "flex", alignItems: "center", gap: 8, color: "#b45309", fontWeight: 600 }}>
                <AlertTriangle size={18} />{result.skippedCount} row{result.skippedCount === 1 ? "" : "s"} skipped
              </p>
              <div style={{ maxHeight: 220, overflowY: "auto", border: "1px solid var(--border)", borderRadius: 8, marginTop: 8 }}>
                <table style={{ margin: 0 }}>
                  <thead>
                    <tr><th>Row</th><th>Reason</th></tr>
                  </thead>
                  <tbody>
                    {result.skipped.map((s) => (
                      <tr key={s.row}><td>{s.row}</td><td>{s.reason}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p style={{ fontSize: 12, color: "var(--ink-soft)", marginTop: 8 }}>
                Fix these rows in your sheet and re-upload just those — already-imported patients won't be
                duplicated as long as you remove the successful rows first.
              </p>
            </div>
          )}

          <button style={{ marginTop: 16 }} onClick={onClose}>Done</button>
        </div>
      )}
    </Modal>
  );
}
