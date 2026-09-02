import prisma from "./prismaClient.js";

// Every action type written to the log, grouped by the entity it applies to. Kept as a flat
// list of constants (rather than free-form strings scattered through route files) so the
// Activity Log UI's filter dropdown and any future reporting can rely on a fixed vocabulary.
export const ACTIONS = {
  REFERRAL_SUBMITTED: "referral.submitted",       // patient submitted via public QR/link
  REFERRAL_ADDED_MANUALLY: "referral.added_manually",
  REFERRAL_BULK_IMPORTED: "referral.bulk_imported",
  REFERRAL_BULK_IMPORT_REVERTED: "referral.bulk_import_reverted",
  REFERRAL_PANEL_UPDATED: "referral.panel_updated",
  REFERRAL_DETAILS_UPDATED: "referral.details_updated", // admin edited the row inline (name/age/panel/ID card fields/etc.)
  REFERRAL_ARRIVED: "referral.arrived",
  REFERRAL_CONVERTED_TO_IPD: "referral.converted_to_ipd",
  REFERRAL_DISCHARGED: "referral.discharged",
  REFERRAL_CREDITED: "referral.credited",         // covers arrive/convert/discharge paths that also credit
  REFERRAL_REJECTED: "referral.rejected",
  REFERRAL_REVERTED: "referral.reverted",          // credited/rejected referral reverted back to pending
  REFERRAL_DELETED: "referral.deleted",
  CREDIT_REDEEMED: "credit.redeemed",
  CREDIT_REDEEMED_ALL: "credit.redeemed_all",      // one doctor's whole pending balance paid out at once
  DOCTOR_CREATED: "doctor.created",
  DOCTOR_BULK_IMPORTED: "doctor.bulk_imported",
  DOCTOR_UPDATED: "doctor.updated",
  MARKETING_PERSON_CREATED: "marketing_person.created",
  MARKETING_PERSON_UPDATED: "marketing_person.updated",
  STAFF_CREATED: "staff.created",
  STAFF_PASSWORD_RESET: "staff.password_reset",
  STAFF_DELETED: "staff.deleted",
  ROLE_CREATED: "role.created",
  ROLE_UPDATED: "role.updated",
  ROLE_DELETED: "role.deleted",
  HOSPITAL_SETTINGS_UPDATED: "hospital.settings_updated",
};

/**
 * Writes one row to the audit trail. Never throws — a logging failure should never break the
 * request it's describing, so errors are swallowed after being printed to the server console.
 *
 * @param {object} params
 * @param {object} params.actor - req.user (needs hospitalId, id, name, role)
 * @param {string} params.action - one of ACTIONS
 * @param {string} params.entityType - e.g. "Referral", "Doctor"
 * @param {string} [params.entityId]
 * @param {string} [params.entityLabel] - human-readable label, e.g. patient or doctor name
 * @param {object} [params.changes] - { field: { from, to } } for updates
 * @param {object} [params.metadata] - any extra context worth keeping
 */
export async function logActivity({ actor, action, entityType, entityId, entityLabel, changes, metadata }) {
  try {
    if (!actor?.hospitalId) return; // super-admin actions aren't scoped to one hospital; nothing to attach the log to
    await prisma.activityLog.create({
      data: {
        hospitalId: actor.hospitalId,
        actorUserId: actor.id || null,
        actorName: actor.name || "Unknown",
        actorRole: actor.role || null,
        action,
        entityType,
        entityId: entityId || null,
        entityLabel: entityLabel || null,
        changes: changes || undefined,
        metadata: metadata || undefined,
      },
    });
  } catch (err) {
    console.error("Failed to write activity log:", err);
  }
}

// Builds a { field: { from, to } } diff, skipping fields that didn't actually change.
// `before` and `after` are plain objects with the same keys; values are compared with String()
// so e.g. a Decimal and a number with the same value don't register as a change.
export function diffFields(before, after, fields) {
  const changes = {};
  for (const field of fields) {
    const from = before?.[field] ?? null;
    const to = after?.[field] ?? null;
    if (String(from ?? "") !== String(to ?? "")) {
      changes[field] = { from, to };
    }
  }
  return Object.keys(changes).length > 0 ? changes : null;
}
