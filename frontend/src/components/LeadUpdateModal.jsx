import { useState } from "react";
import axios from "axios";
import Modal from "./Modal";
import ExtraAttachmentPicker from "./ExtraAttachmentPicker";
import { STAGE_META } from "../utils/leadStages";

const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:4000/api";

// Opened from a row in the marketing portal's "My leads". Lets the marketing person add to a lead
// they've already sent — a note, a card photo, a prescription or other document — while it's still
// waiting (Pending / Card Activity). Reception is notified. Files only ever fill an empty slot; a
// lead that already has a card photo / document simply doesn't offer that option again.
export default function LeadUpdateModal({ lead, token, onClose, onUpdated }) {
  const [note, setNote] = useState("");
  const [cardPhoto, setCardPhoto] = useState(null);
  const [documentFile, setDocumentFile] = useState(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [sentMessage, setSentMessage] = useState("");

  const meta = STAGE_META[lead.stage] || { bg: "#eef0f4", color: "var(--ink-soft)" };
  const nothingToSend = !note.trim() && !cardPhoto && !documentFile;
  const filesOnLead = [lead.hasCardPhoto && "Card photo attached", lead.hasDocument && "Document attached"].filter(Boolean);

  async function send() {
    setError("");
    setSentMessage("");
    setSending(true);
    let message = "";
    try {
      const formData = new FormData();
      if (note.trim()) formData.append("note", note.trim());
      if (cardPhoto) formData.append("cardPhoto", cardPhoto);
      if (documentFile) formData.append("document", documentFile);
      const { data } = await axios.post(`${API_BASE}/referrals/${lead.id}/marketing-update`, formData, {
        headers: { Authorization: `Bearer ${token}` },
      });
      message = data.message;
    } catch (err) {
      setError(err.response?.data?.error || "Could not send the update. Please try again.");
    } finally {
      setSending(false);
    }
    // Only after the send has succeeded — so a problem refreshing the list can never show a false "failed".
    if (message) {
      setSentMessage(message);
      setNote("");
      setCardPhoto(null);
      setDocumentFile(null);
      onUpdated();
    }
  }

  return (
    <Modal title={lead.patientName} onClose={() => { if (!sending) onClose(); }} width={460}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
        <span className="badge" style={{ background: meta.bg, color: meta.color }}>{lead.label}</span>
        <span style={{ color: "var(--ink-soft)", fontSize: 13 }}>via {lead.leaderName}</span>
      </div>

      {lead.leadNote && (
        <>
          <label>Notes already sent</label>
          <div style={{ whiteSpace: "pre-line", margin: "6px 0 10px", padding: "8px 10px", borderRadius: 8, background: "var(--amber-50)", color: "var(--amber-700)", fontSize: 13, lineHeight: 1.4 }}>
            {lead.leadNote}
          </div>
        </>
      )}
      <p style={{ fontSize: 12.5, color: "var(--ink-soft)", margin: "0 0 14px" }}>
        {filesOnLead.length > 0 ? filesOnLead.join(" · ") : "No files attached yet."}
      </p>

      {!lead.canUpdate ? (
        <p style={{ fontSize: 14, color: "var(--ink-soft)" }}>
          This lead is {lead.label.toLowerCase()}, so it can't be updated any more. If something has changed, tell reception directly.
        </p>
      ) : (
        <>
          <label>Add a note for reception</label>
          <textarea
            className="note-input"
            rows={3}
            maxLength={300}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="e.g. Patient arriving by 3 pm — card number MQCM76WFZ"
          />
          <div style={{ fontSize: 11.5, color: "var(--ink-soft)", textAlign: "right", marginBottom: 12 }}>{note.length}/300</div>

          {!lead.hasCardPhoto && (
            <ExtraAttachmentPicker
              label="Card photo (optional)"
              buttonText="Add card photo"
              hint="A photo or PDF of the patient's card, up to 8 MB."
              file={cardPhoto}
              onChange={setCardPhoto}
            />
          )}
          {!lead.hasDocument && (
            <ExtraAttachmentPicker
              label="Prescription or other document (optional)"
              buttonText="Add prescription / document"
              hint="A photo or PDF, up to 8 MB."
              file={documentFile}
              onChange={setDocumentFile}
            />
          )}
          {lead.hasCardPhoto && lead.hasDocument && (
            <p style={{ fontSize: 12.5, color: "var(--ink-soft)", margin: "0 0 12px" }}>
              This lead already has a card photo and a document. To add anything more, tell reception directly.
            </p>
          )}

          {error && <p className="error">{error}</p>}
          {sentMessage && <p style={{ color: "var(--teal-700)", fontSize: 13.5, margin: "0 0 12px" }}>{sentMessage}</p>}

          <div style={{ display: "flex", gap: 10 }}>
            <button type="button" disabled={sending || nothingToSend} onClick={send}>
              {sending ? "Sending…" : "Send update"}
            </button>
            <button type="button" className="secondary" disabled={sending} onClick={onClose}>Close</button>
          </div>
        </>
      )}
    </Modal>
  );
}
