import { useState } from "react";
import Modal from "./Modal";
import api from "../api/client";
import { formatDateTime } from "../utils/date";
import { pickDefaultSurvivor, describeMerge } from "../utils/mergePreview";

const pts = (n) => `${Number(n).toFixed(2)} pts`;

// Folds two or more marketing people who are really one person (typically the same name imported with
// different spellings) into a single record. Every leader — and so every lead, credit and insight —
// moves to the person being kept. The admin chooses who to keep and what to call them, and sees exactly
// what will happen before confirming.
export default function MergeMarketingPersonsModal({ people, onClose, onMerged }) {
  const [keepId, setKeepId] = useState(() => pickDefaultSurvivor(people));
  const [name, setName] = useState(() => people.find((p) => p.id === pickDefaultSurvivor(people)).name);
  const [nameEdited, setNameEdited] = useState(false); // once they type their own name, stop following the radio buttons
  const [merging, setMerging] = useState(false);
  const [error, setError] = useState("");

  const finalName = name.trim();
  const plan = describeMerge(people, keepId, finalName || name);

  function chooseKeep(id) {
    setKeepId(id);
    if (!nameEdited) setName(people.find((p) => p.id === id).name);
  }

  async function merge() {
    setError("");
    setMerging(true);
    let result = null;
    try {
      const { data } = await api.post("/marketing-persons/merge", {
        targetId: keepId,
        sourceIds: plan.others.map((p) => p.id),
        name: finalName,
      });
      result = data;
    } catch (err) {
      setError(err.response?.data?.error || "Could not merge. Nothing was changed.");
    } finally {
      setMerging(false);
    }
    // Only after the merge has succeeded — so a problem refreshing the list can never look like a failed merge.
    if (result) onMerged(result);
  }

  return (
    <Modal title="Merge marketing people" onClose={() => { if (!merging) onClose(); }} width={640}>
      <p style={{ fontSize: 13.5, color: "var(--ink-soft)", marginTop: 0 }}>
        Choose the record to keep. All the leaders of the others — and so all their leads, credits and insights — move to it,
        and the other records are removed.
      </p>

      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 14 }}>
        {people.map((p) => (
          <label
            key={p.id}
            style={{
              display: "flex", gap: 10, alignItems: "flex-start", padding: "10px 12px", cursor: "pointer", fontWeight: 400,
              border: `1.5px solid ${keepId === p.id ? "var(--teal-500)" : "var(--border)"}`, borderRadius: 10,
              background: keepId === p.id ? "var(--teal-50)" : "#fff",
            }}
          >
            <input type="radio" name="keep" checked={keepId === p.id} onChange={() => chooseKeep(p.id)} style={{ width: "auto", margin: "4px 0 0" }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <strong style={{ color: "var(--ink)", fontSize: 14.5 }}>{p.name}</strong>
                {keepId === p.id && <span className="badge CREDITED">Keep</span>}
                <span className={`badge ${p.active ? "CREDITED" : "REJECTED"}`}>{p.active ? "Active" : "Inactive"}</span>
              </div>
              <div style={{ fontSize: 12.5, color: "var(--ink-soft)", marginTop: 3 }}>
                {p.leaderCount} leader{p.leaderCount === 1 ? "" : "s"} · {p.totalReferrals} lead{p.totalReferrals === 1 ? "" : "s"} · {pts(p.totalCredited)} credited
                {p.totalPending > 0 ? ` · ${pts(p.totalPending)} unpaid` : ""}
              </div>
              <div style={{ fontSize: 12, color: "var(--ink-soft)", marginTop: 2 }}>
                {[p.phone, p.hasPassword ? "has a portal login" : null, p.headName ? `team head: ${p.headName}` : null, p.lastReferralAt ? `last lead ${formatDateTime(p.lastReferralAt)}` : "no leads yet"]
                  .filter(Boolean).join(" · ")}
              </div>
            </div>
          </label>
        ))}
      </div>

      <label>Name after merging</label>
      <input value={name} onChange={(e) => { setName(e.target.value); setNameEdited(true); }} maxLength={100} />

      <div style={{ background: "var(--teal-50)", borderRadius: 10, padding: "12px 14px", fontSize: 13.5, lineHeight: 1.55, margin: "4px 0 14px" }}>
        <strong>What will happen</strong>
        <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
          <li>
            {plan.leadersMoving} leader{plan.leadersMoving === 1 ? "" : "s"} and {plan.leadsMoving} lead{plan.leadsMoving === 1 ? "" : "s"} move
            to <strong>{finalName || plan.keep.name}</strong>, who ends up with {plan.leadersAfter} leader{plan.leadersAfter === 1 ? "" : "s"},{" "}
            {plan.leadsAfter} lead{plan.leadsAfter === 1 ? "" : "s"}, {pts(plan.creditedAfter)} credited
            {plan.pendingAfter > 0 ? ` and ${pts(plan.pendingAfter)} unpaid` : ""}.
          </li>
          <li>
            {plan.others.length === 1 ? "The other record is" : `The other ${plan.others.length} records are`} removed
            {plan.aliasesAfter.length > 0 && <>. Their names (<em>{plan.aliasesAfter.join(", ")}</em>) are remembered, so a bulk import that still uses them lands on {finalName || plan.keep.name} instead of creating a duplicate</>}.
          </li>
          {plan.fills.length > 0 && <li>Missing details are filled in: {plan.fills.join("; ")}.</li>}
          {plan.activeAfter !== plan.keep.active && <li>The merged person will be active, because at least one of them was.</li>}
        </ul>
        {plan.loginsEnding.length > 0 && (
          <p style={{ color: "#b45309", margin: "8px 0 0" }}>
            {plan.loginsEnding.join(", ")} {plan.loginsEnding.length === 1 ? "has a portal login that will stop" : "have portal logins that will stop"} working
            — {plan.keep.name}'s link keeps working.
          </p>
        )}
        {plan.droppedHeads.length > 0 && (
          <p style={{ color: "#b45309", margin: "8px 0 0" }}>
            A person can have only one team head, so {plan.droppedHeads.join(", ")} won't carry over.
          </p>
        )}
      </div>

      {error && <p className="error">{error}</p>}
      <div style={{ display: "flex", gap: 10 }}>
        <button type="button" disabled={merging || !finalName} onClick={merge}>
          {merging ? "Merging…" : `Merge ${people.length} into “${finalName || "…"}”`}
        </button>
        <button type="button" className="secondary" disabled={merging} onClick={onClose}>Cancel</button>
      </div>
    </Modal>
  );
}
