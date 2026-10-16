// The server may run in UTC (most hosting does) while the hospital operates in IST
// (UTC+5:30). Bucketing "today" or a 14-day trend using server-local time can silently
// misclassify referrals made late at night IST into the wrong calendar day. These
// helpers always compute calendar days as they'd appear in India, independent of
// whatever timezone the Node process itself is running in.
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

// "YYYY-MM-DD" as the date would read on a wall clock in India for the given instant.
export function istDateString(date) {
  const shifted = new Date(new Date(date).getTime() + IST_OFFSET_MS);
  return shifted.toISOString().slice(0, 10);
}

// The UTC instant corresponding to IST midnight, `daysAgo` days before today (IST).
export function startOfIstDay(daysAgo = 0) {
  const now = new Date();
  const shiftedNow = new Date(now.getTime() + IST_OFFSET_MS);
  const y = shiftedNow.getUTCFullYear();
  const m = shiftedNow.getUTCMonth();
  const d = shiftedNow.getUTCDate();
  const istMidnightUtcMs = Date.UTC(y, m, d - daysAgo, 0, 0, 0) - IST_OFFSET_MS;
  return new Date(istMidnightUtcMs);
}

// The UTC instant corresponding to IST midnight on the Monday of the week `weeksAgo` weeks
// before the current one (0 = this week's Monday, even if that's only a few days ago).
export function startOfIstWeek(weeksAgo = 0) {
  const now = new Date();
  const shiftedNow = new Date(now.getTime() + IST_OFFSET_MS);
  const dow = shiftedNow.getUTCDay(); // 0=Sun..6=Sat
  const daysSinceMonday = (dow + 6) % 7; // Mon=0
  return startOfIstDay(daysSinceMonday + weeksAgo * 7);
}

// The UTC instant corresponding to IST midnight on the 1st of the month `monthsAgo` months
// before the current one (0 = this month, even if that's only a few days in).
export function startOfIstMonth(monthsAgo = 0) {
  const now = new Date();
  const shiftedNow = new Date(now.getTime() + IST_OFFSET_MS);
  const y = shiftedNow.getUTCFullYear();
  const m = shiftedNow.getUTCMonth() - monthsAgo;
  const istMidnightUtcMs = Date.UTC(y, m, 1, 0, 0, 0) - IST_OFFSET_MS;
  return new Date(istMidnightUtcMs);
}

// The UTC instant range [start, end) covering one IST calendar day, given a
// "YYYY-MM-DD" string as typed into a date picker.
export function istDayBounds(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const startUtcMs = Date.UTC(y, m - 1, d, 0, 0, 0) - IST_OFFSET_MS;
  return { start: new Date(startUtcMs), end: new Date(startUtcMs + 24 * 60 * 60 * 1000) };
}

// "16 Oct, 11:20 am" — a compact date + time in India time, used to stamp notes appended to a lead.
export function istStamp(date = new Date()) {
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true,
  }).format(date);
}
