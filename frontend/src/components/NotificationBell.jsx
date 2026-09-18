import { useEffect, useRef, useState } from "react";
import { Bell } from "lucide-react";
import api from "../api/client";

// Roughly how long ago, in words — good enough for a notification list without pulling in a
// date library just for this.
function timeAgo(dateStr) {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

const TYPE_DOT_COLOR = {
  CARD_REVIEW_NEW: "#f59e0b",     // amber — matches the Card Activity tab
  PENDING_NEW: "#f59e0b",
  REFERRAL_CREDITED: "#16a34a",   // green — matches Credited
  REFERRAL_REJECTED: "#dc2626",   // red — matches Rejected
};

// Shared across ReceptionDashboard, AdminDashboard, and StaffPortal. Polls for new referral
// events (new card to verify, new pending lead, credited, rejected) and lets the user mark
// them read, individually or all at once. Read state is per-user and persists in the DB, so
// it's consistent across tabs/devices for the same logged-in staff member.
export default function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const containerRef = useRef(null);

  async function load() {
    try {
      const { data } = await api.get("/notifications");
      setNotifications(data.notifications);
      setUnreadCount(data.unreadCount);
    } catch {
      // non-critical — bell just stays at its last-known state
    }
  }

  useEffect(() => {
    load();
    const interval = setInterval(load, 20000);
    return () => clearInterval(interval);
  }, []);

  // Close the dropdown on an outside click.
  useEffect(() => {
    function handleClick(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  async function markRead(id) {
    setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)));
    setUnreadCount((c) => Math.max(0, c - 1));
    try {
      await api.post(`/notifications/${id}/read`);
    } catch {
      load(); // out of sync with the server — just refetch to correct it
    }
  }

  async function markAllRead() {
    if (unreadCount === 0) return;
    setLoading(true);
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
    setUnreadCount(0);
    try {
      await api.post("/notifications/read-all");
    } catch {
      load();
    } finally {
      setLoading(false);
    }
  }

  return (
    <div ref={containerRef} style={{ position: "relative" }}>
      <button
        className="secondary"
        style={{ width: "auto", padding: "8px 10px", position: "relative" }}
        onClick={() => setOpen((o) => !o)}
        title="Notifications"
      >
        <Bell size={18} />
        {unreadCount > 0 && (
          <span
            style={{
              position: "absolute", top: -4, right: -4, background: "var(--red-600, #dc2626)", color: "#fff",
              fontSize: 11, fontWeight: 700, borderRadius: 999, padding: "1px 6px", minWidth: 18, textAlign: "center",
              lineHeight: "16px",
            }}
          >
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div
          className="card"
          style={{
            position: "absolute", right: 0, top: "calc(100% + 8px)", width: 340, maxHeight: 420,
            overflowY: "auto", padding: 0, zIndex: 50,
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 14px", borderBottom: "1px solid #eef0f5", position: "sticky", top: 0, background: "#fff" }}>
            <strong style={{ fontSize: 14 }}>Notifications</strong>
            <button
              className="secondary"
              style={{ width: "auto", padding: "4px 10px", fontSize: 12 }}
              onClick={markAllRead}
              disabled={loading || unreadCount === 0}
            >
              Mark all read
            </button>
          </div>

          {notifications.length === 0 && (
            <div style={{ padding: "24px 14px", textAlign: "center", color: "var(--ink-soft)", fontSize: 13 }}>
              No notifications yet
            </div>
          )}

          {notifications.map((n) => (
            <div
              key={n.id}
              onClick={() => !n.read && markRead(n.id)}
              style={{
                display: "flex", gap: 10, padding: "10px 14px", borderBottom: "1px solid #f4f5f9",
                background: n.read ? "transparent" : "#f7fafc", cursor: n.read ? "default" : "pointer",
              }}
            >
              <span
                style={{
                  marginTop: 5, width: 8, height: 8, borderRadius: "50%", flexShrink: 0,
                  background: n.read ? "#d0d5dd" : (TYPE_DOT_COLOR[n.type] || "#667085"),
                }}
              />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, color: "#1d2433", fontWeight: n.read ? 400 : 600 }}>{n.message}</div>
                <div style={{ fontSize: 11.5, color: "var(--ink-soft)", marginTop: 2 }}>{timeAgo(n.createdAt)}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
