import { MessageSquare, Reply } from "lucide-react";

// The note a marketing person sent along with a lead (e.g. "cash patient, prescription
// attached"), shown under the patient's name in the referral lists so reception/admin/staff
// see it in Card Activity, Pending, and every other tab without having to ask.
//
// With `onReply`, a small button sits underneath that opens the conversation on this lead
// (see ReferralThreadModal) — "Reply" while there's only the note, "Conversation (3)" once
// there are messages. `canStart` lets staff open a conversation on a lead that has no note
// (it came through a marketing person, so there's someone to talk to).
export default function LeadNote({ text, messageCount = 0, onReply, canStart = false }) {
  const showButton = onReply && (text || messageCount > 0 || canStart);
  if (!text && !showButton) return null;
  return (
    <>
      {text && (
        <div
          style={{
            display: "flex", alignItems: "flex-start", gap: 5, marginTop: 4, padding: "4px 8px",
            maxWidth: 320, borderRadius: 6, background: "var(--amber-50)", color: "var(--amber-700)",
            fontSize: 12, fontWeight: 500, lineHeight: 1.35, whiteSpace: "pre-line", wordBreak: "break-word",
          }}
        >
          <MessageSquare size={12} style={{ flexShrink: 0, marginTop: 2 }} />
          <span>{text}</span>
        </div>
      )}
      {showButton && (
        <button type="button" className="thread-link" onClick={onReply}>
          <Reply size={12} />
          {messageCount > 0 ? `Conversation (${messageCount})` : text ? "Reply" : "Message marketing"}
        </button>
      )}
    </>
  );
}
