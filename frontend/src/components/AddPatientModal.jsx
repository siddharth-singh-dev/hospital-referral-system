import { useEffect, useRef, useState } from "react";
import { UserPlus } from "lucide-react";
import Modal from "./Modal";
import CardScanUpload from "./CardScanUpload";
import api from "../api/client";
import { PANEL_OPTIONS } from "../utils/panels";

// A text input + suggestion dropdown for picking the referring leader. Typing filters the
// existing list; if nothing matches exactly, an "Add ... as a new leader" option appears at
// the bottom so reception isn't blocked just because someone isn't in the system yet.
function LeaderCombobox({ leaders, loading, value, onSelectExisting, onSelectNew }) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);

  useEffect(() => {
    function handleClickOutside(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const trimmed = query.trim();
  const filtered = trimmed
    ? leaders.filter((l) => l.name.toLowerCase().includes(trimmed.toLowerCase()))
    : leaders;
  const exactMatch = leaders.some((l) => l.name.toLowerCase() === trimmed.toLowerCase());

  function pickExisting(leader) {
    onSelectExisting(leader);
    setQuery(leader.name);
    setOpen(false);
  }

  function pickNew() {
    onSelectNew(trimmed);
    setOpen(false);
  }

  return (
    <div className="combobox-wrap" ref={wrapRef}>
      <input
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
          // typing invalidates whatever was previously selected
          if (value.mode) onSelectExisting(null);
        }}
        onFocus={() => setOpen(true)}
        placeholder={loading ? "Loading leaders…" : "Type a name to search or add new…"}
        disabled={loading}
        autoComplete="off"
      />
      {open && !loading && (
        <ul className="combobox-list">
          {filtered.map((l) => (
            <li key={l.id} onClick={() => pickExisting(l)}>
              {l.name}{l.clinicName ? ` (${l.clinicName})` : ""}
            </li>
          ))}
          {filtered.length === 0 && !trimmed && (
            <li style={{ color: "var(--ink-soft)", cursor: "default" }}>No leaders yet — start typing to add one</li>
          )}
          {trimmed && !exactMatch && (
            <li className="new-option" onClick={pickNew}>
              + Add "{trimmed}" as a new leader
            </li>
          )}
        </ul>
      )}
    </div>
  );
}

// Lets reception add a patient directly — e.g. the patient mentions a leader referred them
// but never scanned the QR themselves. Reception picks the referring leader from a searchable
// list, or types a name that isn't in the system yet to quick-add them as a new leader.
export default function AddPatientModal({ onClose, onAdded }) {
  const [leaders, setLeaders] = useState([]);
  const [loadingLeaders, setLoadingLeaders] = useState(true);
  const [referrer, setReferrer] = useState({ mode: null, doctorId: null, newLeaderName: null }); // mode: "existing" | "new"
  const [patientName, setPatientName] = useState("");
  const [patientAge, setPatientAge] = useState("");
  const [patientGender, setPatientGender] = useState("MALE");
  const [patientPhone, setPatientPhone] = useState("");
  const [patientPanel, setPatientPanel] = useState("");
  const [idType, setIdType] = useState("");
  const [idNumber, setIdNumber] = useState("");
  const [forceType, setForceType] = useState("");
  const [wardType, setWardType] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [scanNote, setScanNote] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const { data } = await api.get("/doctors/lite");
        setLeaders(data);
      } catch {
        setError("Could not load the list of leaders. Try again in a moment.");
      } finally {
        setLoadingLeaders(false);
      }
    })();
  }, []);

  const CARD_LABELS = { AADHAAR: "Aadhaar", AYUSHMAN: "Ayushman", CGHS: "CGHS", ECHS: "ECHS", CAPF: "CAPF" };
  const CARD_TYPE_OPTIONS = ["AADHAAR", "AYUSHMAN", "CGHS", "ECHS", "CAPF"];

  function handleScanExtracted(result) {
    if (result.patientName) setPatientName(result.patientName);
    if (result.patientAge) setPatientAge(String(result.patientAge));
    if (result.patientGender) setPatientGender(result.patientGender);
    if (result.panel) setPatientPanel(result.panel);
    setIdType(result.cardType || "");
    setIdNumber(result.idNumberMasked || "");
    setForceType(result.forceType || "");
    setWardType(result.wardType || "");
    const cardLabel = CARD_LABELS[result.cardType] || result.cardType;
    const missing = [!result.patientName && "name", !result.patientAge && "age", !result.patientGender && "gender"].filter(Boolean);
    setScanNote(
      missing.length === 0
        ? `Read from ${cardLabel} card — please double-check before submitting.`
        : `Read from ${cardLabel} card, but couldn't find ${missing.join("/")} — please fill that in.`
    );
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    if (!referrer.mode) {
      setError("Select who referred this patient, or type a new name.");
      return;
    }
    setSubmitting(true);
    try {
      const payload = {
        patientName: patientName.trim(),
        patientAge: Number(patientAge),
        patientGender,
        patientPhone: patientPhone.trim() || undefined,
        panel: patientPanel || undefined,
        idType: idType || undefined,
        idNumber: idNumber.trim() || undefined,
        forceType: forceType.trim() || undefined,
        wardType: wardType.trim() || undefined,
        ...(referrer.mode === "existing" ? { doctorId: referrer.doctorId } : { newLeaderName: referrer.newLeaderName }),
      };
      const { data } = await api.post("/referrals/manual", payload);
      onAdded?.(data);
    } catch (err) {
      setError(err?.response?.data?.error || "Failed to add this patient.");
      setSubmitting(false);
    }
  }

  return (
    <Modal title="Add patient" onClose={onClose} width={440}>
      <form onSubmit={handleSubmit}>
        <CardScanUpload onExtracted={handleScanExtracted} />
        {scanNote && <p style={{ fontSize: 12.5, color: "var(--teal-700)", marginTop: -10, marginBottom: 12 }}>{scanNote}</p>}

        <label>Referred by</label>
        <LeaderCombobox
          leaders={leaders}
          loading={loadingLeaders}
          value={referrer}
          onSelectExisting={(leader) => setReferrer(leader ? { mode: "existing", doctorId: leader.id, newLeaderName: null } : { mode: null, doctorId: null, newLeaderName: null })}
          onSelectNew={(name) => setReferrer({ mode: "new", doctorId: null, newLeaderName: name })}
        />
        {referrer.mode === "new" && (
          <p style={{ fontSize: 12, color: "var(--teal-700)", marginTop: -10 }}>
            "{referrer.newLeaderName}" will be added as a new leader (no phone yet — you can fill that in later from the Leaders tab).
          </p>
        )}

        <label>Patient name</label>
        <input value={patientName} onChange={(e) => setPatientName(e.target.value)} required />

        <label>Patient age</label>
        <input type="number" min="0" max="130" value={patientAge} onChange={(e) => setPatientAge(e.target.value)} required />

        <label>Patient gender</label>
        <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
          {["MALE", "FEMALE", "OTHER"].map((g) => (
            <button
              key={g}
              type="button"
              className={patientGender === g ? "" : "secondary"}
              style={{ width: "auto", flex: 1, padding: "8px 0" }}
              onClick={() => setPatientGender(g)}
            >
              {g.charAt(0) + g.slice(1).toLowerCase()}
            </button>
          ))}
        </div>

        <label>Patient phone (optional)</label>
        <input value={patientPhone} onChange={(e) => setPatientPhone(e.target.value)} placeholder="e.g. 98765 43210" />

        <label>Panel (optional)</label>
        <select value={patientPanel} onChange={(e) => setPatientPanel(e.target.value)}>
          <option value="">— None —</option>
          {PANEL_OPTIONS.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>

        <label>ID / card type (optional)</label>
        <select value={idType} onChange={(e) => setIdType(e.target.value)}>
          <option value="">— None —</option>
          {CARD_TYPE_OPTIONS.map((t) => <option key={t} value={t}>{CARD_LABELS[t]}</option>)}
        </select>
        <p style={{ fontSize: 11.5, color: "var(--ink-soft)", marginTop: -6, marginBottom: 8 }}>
          Set automatically after a card scan — pick it here instead if you're entering details by hand.
        </p>

        {idType === "AADHAAR" && (
          <>
            <label>Aadhaar number</label>
            <input value={idNumber} onChange={(e) => setIdNumber(e.target.value)} placeholder="XXXX XXXX 1234" />
          </>
        )}
        {idType === "AYUSHMAN" && (
          <>
            <label>Ayushman number</label>
            <input value={idNumber} onChange={(e) => setIdNumber(e.target.value)} />
          </>
        )}
        {(idType === "CGHS" || idType === "ECHS" || idType === "CAPF") && (
          <>
            <label>Force / category</label>
            <input value={forceType} onChange={(e) => setForceType(e.target.value)} placeholder="e.g. BSF, ARMY, Pensioner" />
            <label>Ward type</label>
            <input value={wardType} onChange={(e) => setWardType(e.target.value)} placeholder="e.g. Semi-Private Ward" />
            <label>Card number</label>
            <input value={idNumber} onChange={(e) => setIdNumber(e.target.value)} />
          </>
        )}

        {error && <p className="error">{error}</p>}

        <button type="submit" disabled={submitting || loadingLeaders} style={{ marginTop: 8 }}>
          <UserPlus size={16} />
          {submitting ? "Adding…" : "Add patient"}
        </button>
      </form>
    </Modal>
  );
}
