import { PANEL_OPTIONS } from "./panels";

// Mirror of backend/src/utils/cardPanelRules.js (which is what actually enforces these rules on
// submit) plus the helpers the lead form uses to tie the Panel and card-type dropdowns together.
// Keep the two files in sync.
//
// A lead needs only a leader and a patient name; card type, panel, card number and photo are all
// optional. Whatever IS given has to agree:
//
//   Card        Panel it goes with
//   AYUSHMAN    AYUSHMAN BHARAT
//   CGHS        CGHS
//   ECHS        ECHS
//   CAPF        CAPF or AYUSHMAN CAPF
//   AADHAAR     any panel
//   OTHER       any panel except the five above
//   (no card)   any panel
//
// Card Activity (reception verifies the card first): an Ayushman card or an Ayushman panel, AND a
// card number or photo to verify. Otherwise the lead goes straight to Pending.

export const GOVT_PANEL_TO_CARD = {
  "AYUSHMAN BHARAT": "AYUSHMAN",
  "AYUSHMAN CAPF": "CAPF",
  CAPF: "CAPF",
  CGHS: "CGHS",
  ECHS: "ECHS",
};
export const GOVT_CARD_TYPES = ["AYUSHMAN", "CGHS", "ECHS", "CAPF"];
export const AYUSHMAN_PANELS = ["AYUSHMAN BHARAT", "AYUSHMAN CAPF"];

const CARD_LABEL = { AYUSHMAN: "Ayushman Bharat", CGHS: "CGHS", ECHS: "ECHS", CAPF: "CAPF" };
const PANELS_FOR_CARD = { AYUSHMAN: ["AYUSHMAN BHARAT"], CGHS: ["CGHS"], ECHS: ["ECHS"], CAPF: ["CAPF", "AYUSHMAN CAPF"] };

// An error message if this card type + panel can't go together, otherwise null. Either may be empty.
export function pairError(cardType, panel) {
  if (!cardType || cardType === "AADHAAR") return null;
  if (cardType === "OTHER") {
    if (panel && GOVT_PANEL_TO_CARD[panel]) {
      return `A ${panel} patient needs their ${CARD_LABEL[GOVT_PANEL_TO_CARD[panel]]} card — pick that card type, or choose a different panel`;
    }
    return null;
  }
  if (panel && GOVT_PANEL_TO_CARD[panel] !== cardType) {
    return `A ${CARD_LABEL[cardType]} card goes with the ${PANELS_FOR_CARD[cardType].join(" or ")} panel`;
  }
  return null;
}

export const needsCardReviewFor = (cardType, panel, hasCardDetails = true) =>
  hasCardDetails && (cardType === "AYUSHMAN" || AYUSHMAN_PANELS.includes(panel));

// --- dropdown helpers -------------------------------------------------------------------------

// The panels that can go with a chosen card type.
export function panelOptionsForCard(cardType) {
  if (PANELS_FOR_CARD[cardType]) return PANELS_FOR_CARD[cardType];
  if (cardType === "OTHER") return PANEL_OPTIONS.filter((p) => !GOVT_PANEL_TO_CARD[p]);
  return PANEL_OPTIONS; // Aadhaar, or no card chosen yet
}

// The card types that can go with a chosen panel. `allCards` is the full list of card values.
export function cardOptionsForPanel(panel, allCards) {
  if (!panel) return allCards;
  if (GOVT_PANEL_TO_CARD[panel]) return [GOVT_PANEL_TO_CARD[panel]];
  return allCards.filter((c) => c === "AADHAAR" || c === "OTHER");
}
