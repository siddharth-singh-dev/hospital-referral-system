// Shared by the marketing person's own portal and the team head's portal.
// How each lead "stage" (computed by GET /marketing-persons/public/me/leads) is drawn, and
// which filter chip it belongs to.
export const STAGE_META = {
  CARD_REVIEW:   { bg: "var(--blue-50, #eff6ff)", color: "var(--blue-700, #1d4ed8)", group: "REVIEW" },
  CARD_ACTIVE:   { bg: "var(--green-100)", color: "var(--green-700)", group: "WAITING" },
  PENDING:       { bg: "var(--amber-50)", color: "var(--amber-700)", group: "WAITING" },
  ADMITTED:      { bg: "var(--green-100)", color: "var(--green-700)", group: "ADMITTED" },
  OPD:           { bg: "var(--green-100)", color: "var(--green-700)", group: "ADMITTED" },
  DISCHARGED:    { bg: "#eef0f4", color: "var(--ink-soft)", group: "ADMITTED" },
  CARD_INACTIVE: { bg: "var(--red-50)", color: "var(--red-700)", group: "REJECTED" },
  REJECTED:      { bg: "var(--red-50)", color: "var(--red-700)", group: "REJECTED" },
};
export const LEAD_FILTERS = [
  { key: "ALL", label: "All" },
  { key: "REVIEW", label: "In review" },
  { key: "WAITING", label: "Awaiting arrival" },
  { key: "ADMITTED", label: "Admitted" },
  { key: "REJECTED", label: "Rejected" },
];
