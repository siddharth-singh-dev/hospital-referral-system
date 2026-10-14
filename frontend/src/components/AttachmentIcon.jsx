import { useState } from "react";
import { Paperclip, FileText } from "lucide-react";
import api from "../api/client";

// Shown next to a patient's name in a referral list when a supporting image (ID/insurance
// card, prescription, etc.) was attached at submission time — currently only possible when a
// marketing employee submits a lead through their own portal. Fetches the file through the
// authenticated attachment endpoint and opens it in a new tab; a plain <a href> can't carry
// the bearer token these files are gated behind, so this can't just be a link.
// kind="extra" opens the optional second document (e.g. a prescription) instead of the card photo.
export default function AttachmentIcon({ referralId, kind = "card" }) {
  const [loading, setLoading] = useState(false);
  const extra = kind === "extra";

  async function handleClick(e) {
    e.stopPropagation();
    if (loading) return;
    setLoading(true);
    try {
      const res = await api.get(`/referrals/${referralId}/attachment${extra ? "/extra" : ""}`, { responseType: "blob" });
      const url = URL.createObjectURL(res.data);
      window.open(url, "_blank", "noopener");
    } catch {
      alert("Could not load this attachment.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      title={extra ? "View attached document (e.g. prescription)" : "View attached image"}
      disabled={loading}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: 20,
        height: 20,
        padding: 0,
        marginLeft: 6,
        border: "1px solid var(--border)",
        borderRadius: 5,
        background: "var(--teal-50)",
        color: "var(--teal-700)",
        cursor: loading ? "default" : "pointer",
        verticalAlign: "middle",
      }}
    >
      {extra ? <FileText size={11} /> : <Paperclip size={11} />}
    </button>
  );
}
