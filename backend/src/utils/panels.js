// Mirrors frontend/src/utils/panels.js — the same list backing the Panel dropdown in the
// Add Patient / Edit Referral / Reception / Leader forms. Kept as a separate copy since the
// backend and frontend are independent projects; if a panel is added to one list, add it to
// the other too so bulk-import normalization (below) and the dropdown stay in sync.
export const PANEL_OPTIONS = [
  "AYUSHMAN BHARAT",
  "HDFC ERGO GENERAL INSURANCE",
  "Universal Sompo General Insurance",
  "TATA AIG",
  "Go Digit",
  "ICICI LOMBARD GENERAL INSURANCE COMPANY LTD",
  "Care Health Insurance",
  "SBI GENERAL INSURANCE",
  "Reliance General Insurance Company",
  "Manipal Cigna",
  "THE NEW INDIA INSURANCE COMPANY",
  "Bajaj Allianz General Insurance",
  "NATIONAL INSURANCE",
  "UNITED INDIA INSURANCE",
  "THE ORIENTAL INSURANCE",
  "NIVA BUPA HEALTH INSURANCE",
  "Modern Civil Construction ( LLP)",
  "Raksha TPA",
  "Cash with (Package Medicine)",
  "NIVA BUPA",
  "PARAMOUNT TPA",
  "MEDI ASSIST",
  "Varun Beverages Ltd. Unit-2",
  "krishna buildestates pvt limited",
  "VIDAL HEALTH",
  "MD INDIA HEALTH INSURANCE TPA",
  "VIPUL MEDCORP/VIDAL HEALTH TPA",
  "PARK MEDICLAIM TPA",
  "FHPL TPA",
  "HEALTH INDIA INSURANCE TPA",
  "SAFEWAY INSURANCE TPA",
  "ERICSON INSURANCE TPA",
  "MEDVANTAGE INSURANCE TPA PVT. LTD. (UNITED HEALTHCARE PAREKH TPA)",
  "EAST WEST ASSIST INSURANCE",
  "MEDSAVE HEALTH INSURANCE TPA",
  "GOOD HEALTH INSURANCE TPA",
  "KENKO HEALTH INSURANCE",
  "GENINS INDIA INSURANCE TPA LTD",
  "Manipal Signa Health Insurance",
  "CAPF",
  "CGHS",
  "ESIC",
  "ECHS",
  "Cash",
  "Care Health Insurance.",
  "G.k Winding wires .Ltd- Geekay",
  "AYUSHMAN CAPF",
  "Delhi Police",
  "Aditya Birla",
  "Radnik Auto Export",
  "DIPTY LAL JUDGE MAL PVT. LTD.",
  "Food corporation of India",
];

const PANEL_LOOKUP = new Map(PANEL_OPTIONS.map((p) => [p.trim().toLowerCase(), p]));

// Case/whitespace-insensitive match against the dropdown's known panel spellings — e.g. a
// bulk-import row that says "ayushman bharat" or "Ayushman Bharat" gets snapped to the
// dropdown's actual "AYUSHMAN BHARAT" entry so it displays correctly and stays selectable
// there later. A panel that isn't in the list yet (a genuinely new one) is kept as typed,
// rather than rejected — the list is a convenience, not an enforced enum.
function normalizePanel(text) {
  const trimmed = (text || "").trim();
  if (!trimmed) return null;
  return PANEL_LOOKUP.get(trimmed.toLowerCase()) || trimmed;
}

export { normalizePanel };
