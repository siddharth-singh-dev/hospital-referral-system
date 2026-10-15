import { GOVT_PANEL_TO_CARD, GOVT_CARD_TYPES } from "../utils/cardPanelRules";

// What a quick lead from the marketing portal is still missing, so reception knows what to ask the
// patient at the desk. Card details only count as missing for a government-scheme lead (a cash
// or insurer patient doesn't need a card on file).
export function missingDetails(r) {
  const missing = [];
  if (r.patientAge == null) missing.push("age");
  if (!r.patientGender) missing.push("gender");
  if (!r.panel) missing.push("panel");
  const schemeLead = Boolean(GOVT_PANEL_TO_CARD[r.panel]) || GOVT_CARD_TYPES.includes(r.idType);
  if (schemeLead && !r.idNumber && !r.attachmentPath) missing.push("card details");
  return missing;
}

// Shown under the patient's name while a lead is still waiting (Pending / Card Activity).
export default function MissingDetails({ referral }) {
  if (!["PENDING", "CARD_REVIEW"].includes(referral.status)) return null;
  const missing = missingDetails(referral);
  if (missing.length === 0) return null;
  return (
    <div style={{ marginTop: 4, fontSize: 11.5, color: "var(--ink-soft)", fontStyle: "italic" }}>
      Missing: {missing.join(", ")}
    </div>
  );
}
