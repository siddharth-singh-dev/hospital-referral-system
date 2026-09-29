// The underlying status value stored on a referral and used everywhere in code (CSS classes,
// status comparisons, API filters, notification types) stays "CREDITED" — changing that would
// mean a migration and touching every comparison across the app for zero real benefit. This
// file exists purely so the WORD shown to people can be "Admitted" instead, in one place,
// rather than duplicating the CREDITED -> "Admitted" swap at every render site.
export function statusLabel(status) {
  return status === "CREDITED" ? "ADMITTED" : status;
}

// Same idea, but for places that show a human/title-cased word rather than the raw uppercase
// enum (e.g. a tab label already reading "Pending", "Rejected").
export function statusLabelTitleCase(status) {
  return status === "CREDITED" ? "Admitted" : status;
}
