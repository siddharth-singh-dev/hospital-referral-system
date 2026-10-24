import { useEffect, useRef, useState } from "react";
import { Send, Lock } from "lucide-react";
import axios from "axios";
import Modal from "./Modal";
import api from "../api/client";

const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:4000/api";

const MAX_LENGTH = 500;

function formatWhen(iso) {
  return new Date(iso).toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata", day: "2-digit", month: "short", hour: "numeric", minute: "2-digit", hour12: true,
  });
}

// The conversation on one lead: the marketing person's original note at the top, then the
// replies between them and reception/admin/staff. `viewer` decides which side is "mine" and what
// the footer says when replying isn't possible:
//   "STAFF"     — admin / reception / staff       "MARKETING" — the marketing person
//   "HEAD"      — a team head (always read-only)
// The server is what actually decides who may read or reply (canReply comes back from it).
//
// `token` is only passed from the marketing person's portal, which has its own login separate
// from the staff one; everyone else uses the shared api client (the logged-in staff token).
export default function ReferralThreadModal({ referral, viewer = "STAFF", token, onClose, onChanged }) {
  const http = token
    ? {
        get: (url) => axios.get(`${API_BASE}${url}`, { headers: { Authorization: `Bearer ${token}` } }),
        post: (url, body) => axios.post(`${API_BASE}${url}`, body, { headers: { Authorization: `Bearer ${token}` } }),
      }
    : api;
  const [data, setData] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const endRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    http
      .get(`/referrals/${referral.id}/messages`)
      .then((res) => { if (!cancelled) setData(res.data); })
      .catch((err) => { if (!cancelled) setLoadError(err.response?.data?.error || "Couldn't load this conversation"); });
    return () => { cancelled = true; };
  }, [referral.id]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [data?.messages?.length]);

  async function send() {
    const body = text.trim();
    if (!body || sending) return;
    setSending(true);
    setError("");
    try {
      const { data: res } = await http.post(`/referrals/${referral.id}/messages`, { body });
      setData((d) => ({ ...d, messages: [...(d?.messages || []), res.message] }));
      setText("");
      onChanged?.();
    } catch (err) {
      setError(err.response?.data?.error || "Couldn't send the message");
    } finally {
      setSending(false);
    }
  }

  const isMine = (m) => (viewer === "MARKETING" ? m.senderType === "MARKETING" : viewer === "STAFF" ? m.senderType === "STAFF" : false);

  let closedReason = "";
  if (data && !data.canReply) {
    closedReason =
      viewer === "MARKETING"
        ? `This lead is already ${String(data.status || "").replace("_", " ").toLowerCase()}, so replies are closed. Tell reception directly.`
        : viewer === "HEAD"
        ? "You can follow this conversation but not reply to it."
        : "You have view-only access, so you can't reply here.";
  }

  return (
    <Modal title={`Notes — ${referral.patientName}`} onClose={onClose} width={480}>
      {loadError && <div className="error">{loadError}</div>}
      {!data && !loadError && <p style={{ color: "var(--ink-soft)", fontSize: 13.5 }}>Loading…</p>}

      {data && (
        <>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, maxHeight: "46vh", overflowY: "auto", paddingRight: 4, marginBottom: 14 }}>
            {data.leadNote && (
              <div style={{ background: "var(--amber-50)", color: "var(--amber-700)", borderRadius: 8, padding: "8px 10px", fontSize: 12.5, lineHeight: 1.4, whiteSpace: "pre-line", wordBreak: "break-word" }}>
                <div style={{ fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 3, opacity: 0.8 }}>Note sent with the lead</div>
                {data.leadNote}
              </div>
            )}

            {data.messages.length === 0 && (
              <p style={{ color: "var(--ink-soft)", fontSize: 13, textAlign: "center", margin: "10px 0" }}>
                {data.canReply ? "No replies yet — start the conversation below." : "No replies yet."}
              </p>
            )}

            {data.messages.map((m) => {
              const mine = isMine(m);
              return (
                <div key={m.id} style={{ alignSelf: mine ? "flex-end" : "flex-start", maxWidth: "86%" }}>
                  <div style={{ fontSize: 11, color: "var(--ink-soft)", marginBottom: 2, textAlign: mine ? "right" : "left" }}>
                    {m.senderName} · {m.senderType === "MARKETING" ? "Marketing" : "Hospital"} · {formatWhen(m.createdAt)}
                  </div>
                  <div
                    style={{
                      padding: "7px 11px", borderRadius: 10, fontSize: 13.5, lineHeight: 1.4, whiteSpace: "pre-line", wordBreak: "break-word",
                      background: mine ? "var(--teal-100)" : "var(--navy-50)", color: "var(--navy-700)",
                    }}
                  >
                    {m.body}
                  </div>
                </div>
              );
            })}
            <div ref={endRef} />
          </div>

          {data.canReply ? (
            <>
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value.slice(0, MAX_LENGTH))}
                onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) send(); }}
                className="note-input"
                rows={3}
                placeholder="Write a reply…"
              />
              <div style={{ fontSize: 11.5, color: "var(--ink-soft)", textAlign: "right", marginBottom: 10 }}>{text.length}/{MAX_LENGTH} · Ctrl+Enter to send</div>
              {error && <div className="error">{error}</div>}
              <button onClick={send} disabled={sending || !text.trim()}>
                <Send size={15} />
                {sending ? "Sending…" : "Send reply"}
              </button>
            </>
          ) : (
            <div style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 13, color: "var(--ink-soft)" }}>
              <Lock size={14} style={{ flexShrink: 0 }} />
              {closedReason}
            </div>
          )}
        </>
      )}
    </Modal>
  );
}
