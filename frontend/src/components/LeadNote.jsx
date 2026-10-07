import { MessageSquare } from "lucide-react";

// The note a marketing person sent along with a lead (e.g. "cash patient, prescription
// attached"), shown under the patient's name in the referral lists so reception/admin/staff
// see it in Card Activity, Pending, and every other tab without having to ask.
export default function LeadNote({ text }) {
  if (!text) return null;
  return (
    <div
      style={{
        display: "flex", alignItems: "flex-start", gap: 5, marginTop: 4, padding: "4px 8px",
        maxWidth: 320, borderRadius: 6, background: "var(--amber-50)", color: "var(--amber-700)",
        fontSize: 12, fontWeight: 500, lineHeight: 1.35, whiteSpace: "normal", wordBreak: "break-word",
      }}
    >
      <MessageSquare size={12} style={{ flexShrink: 0, marginTop: 2 }} />
      <span>{text}</span>
    </div>
  );
}
