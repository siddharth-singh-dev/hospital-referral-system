// Central list of permission keys a hospital admin can grant to a custom role
// (e.g. "Accountant"). Keep this list and PERMISSION_LABELS as the single source
// of truth — both the role-creation validation and the frontend checkbox UI
// should stay in sync with it.
export const PERMISSION_KEYS = ["VIEW_REFERRALS", "EXPORT_REPORTS", "MANAGE_REFERRALS", "REDEEM_CREDITS", "VIEW_MY_MARKETING_TEAM"];

// A staff account whose role grants this is a "team head": they can see ONLY the marketing
// people an admin has assigned to them (MarketingPerson.headId), with those people's leaders
// and leads. Always scoped server-side by the logged-in account's id.
export const TEAM_HEAD_PERMISSION = "VIEW_MY_MARKETING_TEAM";

export const PERMISSION_LABELS = {
  VIEW_REFERRALS: "View all referrals & credit history (read-only)",
  EXPORT_REPORTS: "Export reports (PDF / Excel)",
  MANAGE_REFERRALS: "Confirm or reject referral arrivals",
  REDEEM_CREDITS: "Redeem (mark as paid out) doctor credit payouts",
  VIEW_MY_MARKETING_TEAM: "View their own marketing team only — the people assigned to them, with those people's leaders and leads (read-only)",
};
