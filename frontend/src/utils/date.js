// Consistent DD/MM/YY date formatting across the whole app, instead of relying on
// locale-dependent toLocaleDateString() calls that vary by browser/OS settings.
export function formatDate(date) {
  if (!date) return "—";
  const d = new Date(date);
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yy = String(d.getFullYear()).slice(-2);
  return `${dd}/${mm}/${yy}`;
}

// "3:45 pm" — just the time of day, for showing under a date. Empty for a missing date.
export function formatTime(date) {
  if (!date) return "";
  return new Date(date).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", hour12: true }).toLowerCase();
}

export function formatDateTime(date) {
  if (!date) return "—";
  const d = new Date(date);
  const time = d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
  return `${formatDate(d)}, ${time}`;
}

// For chart axis labels where a short "DD/MM" without year reads better.
export function formatShortDate(date) {
  if (!date) return "—";
  const d = new Date(date);
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${dd}/${mm}`;
}
