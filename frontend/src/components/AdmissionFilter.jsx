const OPTIONS = [
  { key: "", label: "All" },
  { key: "admitted", label: "Admitted" },
  { key: "discharged", label: "Discharged" },
];

// The All / Admitted / Discharged switch shown under the "Admitted" tab, to narrow it to patients
// still in hospital or already discharged. `value` is "" | "admitted" | "discharged" — exactly the
// `dischargeStatus` the referrals API understands, so the list, the Excel/PDF exports and "mark
// all as redeemed" all follow whatever is selected here.
export default function AdmissionFilter({ value, onChange }) {
  return (
    <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
      {OPTIONS.map((o) => (
        <button
          key={o.key || "all"}
          type="button"
          className={value === o.key ? "" : "secondary"}
          style={{ width: "auto", padding: "6px 14px", fontSize: 13 }}
          onClick={() => onChange(o.key)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
