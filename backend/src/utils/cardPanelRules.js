// How a marketing lead's card type and panel may be combined, and which leads go through reception's
// card check. Mirrored in frontend/src/utils/cardPanelRules.js (which also drives the form's
// dropdown locking) — keep the two in sync.
//
// A lead needs only a leader and a patient name; the card type, panel, card number and photo are
// all optional. But whatever IS given has to agree:
//
//   Card        Panel it goes with
//   AYUSHMAN    AYUSHMAN BHARAT
//   CGHS        CGHS
//   ECHS        ECHS
//   CAPF        CAPF or AYUSHMAN CAPF
//   AADHAAR     any panel
//   OTHER       any panel except the five above
//   (no card)   any panel — including a scheme panel on its own, e.g. a name + "CGHS"
//
// Card Activity (reception verifies the card before the lead moves to Pending): a lead with an
// Ayushman card or an Ayushman panel (AYUSHMAN BHARAT / AYUSHMAN CAPF) AND something to verify — a
// card number or a photo. Without either there's nothing to check yet, so it waits in Pending.
// Everything else goes straight to Pending.

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
// Either may be missing: `cardType` "" / null means no card was given, `panel` null / "" none.
export function checkCardPanelPair(cardType, panel) {
  if (!cardType || cardType === "AADHAAR") return null; // nothing to cross-check / Aadhaar goes with any panel
  if (cardType === "OTHER") {
    if (panel && GOVT_PANEL_TO_CARD[panel]) {
      return `A ${panel} patient needs their ${CARD_LABEL[GOVT_PANEL_TO_CARD[panel]]} card — pick that card type, or choose a different panel`;
    }
    return null;
  }
  // a scheme card: if a panel was given it has to be one that goes with it
  if (panel && GOVT_PANEL_TO_CARD[panel] !== cardType) {
    return `A ${CARD_LABEL[cardType]} card goes with the ${PANELS_FOR_CARD[cardType].join(" or ")} panel`;
  }
  return null;
}

// `hasCardDetails`: a card number or photo was supplied (there's something for reception to check).
export function needsCardReview(cardType, panel, hasCardDetails = true) {
  return hasCardDetails && (cardType === "AYUSHMAN" || AYUSHMAN_PANELS.includes(panel));
}
