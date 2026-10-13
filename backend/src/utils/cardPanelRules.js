// How a marketing lead's card type and panel may be combined, which combinations need reception
// to verify the card, and which need a card photo. Mirrored in
// frontend/src/utils/cardPanelRules.js (which also drives the form's dropdown locking) — keep
// the two in sync.
//
//   Card        Panel it goes with                            Photo
//   AYUSHMAN    AYUSHMAN BHARAT                               required*
//   CGHS        CGHS                                          required*
//   ECHS        ECHS                                          required*
//   CAPF        CAPF or AYUSHMAN CAPF                         required*
//   AADHAAR     any panel (but one must be chosen)            optional, unless the panel is one of the five above
//   OTHER       any panel except the five above, or none      optional
//   * or the person declares "No photo available" and types the card number
//
// Card Activity (reception verifies the card before the lead moves to Pending): any lead with an
// Ayushman card, or an Ayushman panel (AYUSHMAN BHARAT / AYUSHMAN CAPF). Everything else goes
// straight to Pending.

export const GOVT_PANEL_TO_CARD = {
  "AYUSHMAN BHARAT": "AYUSHMAN",
  "AYUSHMAN CAPF": "CAPF", // a CAPF card carrying an Ayushman ID — the card scan records it as CAPF too
  CAPF: "CAPF",
  CGHS: "CGHS",
  ECHS: "ECHS",
};
export const GOVT_CARD_TYPES = ["AYUSHMAN", "CGHS", "ECHS", "CAPF"];
export const AYUSHMAN_PANELS = ["AYUSHMAN BHARAT", "AYUSHMAN CAPF"];

const CARD_LABEL = { AYUSHMAN: "Ayushman Bharat", CGHS: "CGHS", ECHS: "ECHS", CAPF: "CAPF" };
const PANELS_FOR_CARD = { AYUSHMAN: ["AYUSHMAN BHARAT"], CGHS: ["CGHS"], ECHS: ["ECHS"], CAPF: ["CAPF", "AYUSHMAN CAPF"] };

// Returns an error message if this card type + panel can't go together, otherwise null.
// `panel` is the canonical panel string (or null/"" when none was given).
export function checkCardPanelPair(cardType, panel) {
  if (cardType === "OTHER") {
    if (panel && GOVT_PANEL_TO_CARD[panel]) {
      return `A ${panel} patient needs their ${CARD_LABEL[GOVT_PANEL_TO_CARD[panel]]} card — pick that card type, or choose a different panel`;
    }
    return null; // no panel is fine for "Other"
  }
  if (!panel) return "Select the patient's panel";
  if (cardType === "AADHAAR") return null; // Aadhaar goes with any panel
  if (GOVT_PANEL_TO_CARD[panel] !== cardType) {
    return `A ${CARD_LABEL[cardType]} card goes with the ${PANELS_FOR_CARD[cardType].join(" or ")} panel`;
  }
  return null;
}

export function needsCardReview(cardType, panel) {
  return cardType === "AYUSHMAN" || AYUSHMAN_PANELS.includes(panel);
}

// A photo is required (or an explicit "No photo available" with the card number typed in) for
// any government-scheme card or panel.
export function photoRequired(cardType, panel) {
  return GOVT_CARD_TYPES.includes(cardType) || Boolean(GOVT_PANEL_TO_CARD[panel]);
}
