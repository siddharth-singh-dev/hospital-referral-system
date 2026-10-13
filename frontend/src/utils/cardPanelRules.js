import { PANEL_OPTIONS } from "./panels";

// Mirror of backend/src/utils/cardPanelRules.js (which is what actually enforces these rules on
// submit) plus the helpers the lead form uses to tie the Panel and card-type dropdowns together.
// Keep the two files in sync.
//
//   Card        Panel it goes with                    Photo
//   AYUSHMAN    AYUSHMAN BHARAT                       required*
//   CGHS        CGHS                                  required*
//   ECHS        ECHS                                  required*
//   CAPF        CAPF or AYUSHMAN CAPF                 required*
//   AADHAAR     any panel (one must be chosen)        optional, unless the panel is one of the five above
//   OTHER       any panel except the five above, or none      optional
//   * or "No photo available" with the card number typed in
//
// Card Activity (reception verifies the card first): an Ayushman card, or an Ayushman panel.

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

// An error message if this card type + panel can't go together, otherwise null.
export function pairError(cardType, panel) {
  if (cardType === "OTHER") {
    if (panel && GOVT_PANEL_TO_CARD[panel]) {
      return `A ${panel} patient needs their ${CARD_LABEL[GOVT_PANEL_TO_CARD[panel]]} card — pick that card type, or choose a different panel`;
    }
    return null;
  }
  if (!panel) return "Select the patient's panel";
  if (cardType === "AADHAAR") return null;
  if (GOVT_PANEL_TO_CARD[panel] !== cardType) {
    return `A ${CARD_LABEL[cardType]} card goes with the ${PANELS_FOR_CARD[cardType].join(" or ")} panel`;
  }
  return null;
}

export const needsCardReviewFor = (cardType, panel) => cardType === "AYUSHMAN" || AYUSHMAN_PANELS.includes(panel);
export const photoRequiredFor = (cardType, panel) => GOVT_CARD_TYPES.includes(cardType) || Boolean(GOVT_PANEL_TO_CARD[panel]);

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
