import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import api from "../api/client";
import CardScanUpload from "../components/CardScanUpload";
import { PANEL_OPTIONS } from "../utils/panels";

export default function ReferralForm() {
  const { doctorCode } = useParams();
  const [name, setName] = useState("");
  const [age, setAge] = useState("");
  const [gender, setGender] = useState("");
  const [phone, setPhone] = useState("");
  const [panel, setPanel] = useState("");
  const [idNumber, setIdNumber] = useState("");
  const [forceType, setForceType] = useState("");
  const [wardType, setWardType] = useState("");
  const [locationStatus, setLocationStatus] = useState("idle"); // idle | requesting | granted | denied
  const [coords, setCoords] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [scanNote, setScanNote] = useState("");
  const [done, setDone] = useState(false);
  const [hospital, setHospital] = useState(null);

  useEffect(() => {
    api.get(`/doctors/public/${doctorCode}`)
      .then((res) => setHospital(res.data.hospital))
      .catch(() => {}); // branding is a nice-to-have; form still works if this fails
  }, [doctorCode]);

  useEffect(() => {
    // Ask automatically on load. If the browser already remembers this device's
    // choice for this site, it resolves instantly with no prompt at all — the
    // native permission dialog only appears the first time (or after it's reset).
    requestLocation();
  }, []);

  function requestLocation() {
    setLocationStatus("requesting");
    if (!navigator.geolocation) {
      setLocationStatus("denied");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setCoords({
          lat: pos.coords.latitude,
          lon: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
        });
        setLocationStatus("granted");
      },
      () => setLocationStatus("denied"),
      { enableHighAccuracy: true, timeout: 10000 }
    );
  }

  const CARD_LABELS = { AADHAAR: "Aadhaar", AYUSHMAN: "Ayushman", CGHS: "CGHS", ECHS: "ECHS", CAPF: "CAPF" };

  function handleScanExtracted(result) {
    if (result.patientName) setName(result.patientName);
    if (result.patientAge) setAge(String(result.patientAge));
    if (result.patientGender) setGender(result.patientGender);
    if (result.panel) setPanel(result.panel);
    setIdNumber(result.idNumberMasked || "");
    setForceType(result.forceType || "");
    setWardType(result.wardType || "");
    const cardLabel = CARD_LABELS[result.cardType] || result.cardType;
    const missing = [!result.patientName && "name", !result.patientAge && "age", !result.patientGender && "gender"].filter(Boolean);
    const panelNote = result.panel ? ` Panel set to ${result.panel}.` : "";
    setScanNote(
      missing.length === 0
        ? `Read from the ${cardLabel} card — please check it's correct before submitting.${panelNote}`
        : `Read from the ${cardLabel} card, but couldn't find ${missing.join("/")} — please fill that in below.${panelNote}`
    );
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      await api.post("/referrals", {
        doctorCode,
        patientName: name,
        patientAge: Number(age),
        patientGender: gender,
        patientPhone: phone || undefined,
        panel: panel || undefined,
        idNumber: idNumber.trim() || undefined,
        forceType: forceType.trim() || undefined,
        wardType: wardType.trim() || undefined,
        scanLatitude: coords?.lat,
        scanLongitude: coords?.lon,
        scanAccuracyM: coords?.accuracy,
      });
      setDone(true);
    } catch (err) {
      setError(err.response?.data?.error?.formErrors?.join(", ") || err.response?.data?.error || "Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (done) {
    return (
      <div className="container" style={{ paddingTop: 60 }}>
        <div className="card">
          <div style={{ textAlign: "center", marginBottom: 8 }}>
            <div style={{
              width: 56, height: 56, borderRadius: "50%", background: "var(--green-100)",
              display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 12px",
              fontSize: 28, color: "var(--green-700)",
            }}>✓</div>
          </div>
          <h2 style={{ textAlign: "center" }}>Lead submitted</h2>
          <p style={{ textAlign: "center", color: "var(--ink-soft)" }}>
            Thank you. Please have the patient bring this to the hospital reception, or simply mention their name when they arrive.
          </p>
          <a href={`/doctor/${doctorCode}`}>
            <button className="secondary" style={{ marginTop: 8 }}>View my lead dashboard</button>
          </a>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="topbar">
        <div className="topbar-brand">
          <img src="/logo.png" alt="Vedansh Medicare" />
          <div>
            <strong>Submit a Lead</strong>
            <span className="brand-sub">{hospital?.name}{hospital?.branchName ? ` · ${hospital.branchName}` : ""}</span>
          </div>
        </div>
        <a href={`/doctor/${doctorCode}`}>
          <button className="secondary" style={{ width: "auto", padding: "8px 16px" }}>My dashboard</button>
        </a>
      </div>
      <div className="container" style={{ paddingTop: 24 }}>
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Submit a lead</h2>
          <p style={{ color: "var(--ink-soft)", fontSize: 14 }}>
            Fill in the patient's basic details. Location access helps us verify the lead.
          </p>

          {locationStatus === "idle" && (
            <button type="button" className="secondary" onClick={requestLocation} style={{ marginBottom: 16 }}>
              📍 Share location to continue
            </button>
          )}
          {locationStatus === "requesting" && <p style={{ color: "var(--ink-soft)" }}>Requesting location…</p>}
          {locationStatus === "granted" && <p className="success">Location captured ✓</p>}
          {locationStatus === "denied" && (
            <div className="error">
              <p style={{ margin: "0 0 8px" }}>Location access was denied. You can still submit, but please enable location for faster verification.</p>
              <button type="button" className="secondary" onClick={requestLocation} style={{ width: "auto", padding: "6px 14px" }}>Try again</button>
            </div>
          )}

          <form onSubmit={handleSubmit}>
            <CardScanUpload doctorCode={doctorCode} onExtracted={handleScanExtracted} />
            {scanNote && <p style={{ fontSize: 12.5, color: "var(--teal-700)", marginTop: -10, marginBottom: 12 }}>{scanNote}</p>}

            <label>Patient name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} required />

            <label>Patient age</label>
            <input type="number" min="0" max="130" value={age} onChange={(e) => setAge(e.target.value)} required />

            <label>Patient gender</label>
            <div className="radio-group">
              {["MALE", "FEMALE", "OTHER"].map((g) => (
                <label key={g} className="radio-option">
                  <input type="radio" name="gender" value={g} checked={gender === g} onChange={() => setGender(g)} required />
                  {g.charAt(0) + g.slice(1).toLowerCase()}
                </label>
              ))}
            </div>

            <label>Patient phone (optional)</label>
            <input value={phone} onChange={(e) => setPhone(e.target.value)} />

            <label>Panel (optional)</label>
            <select value={panel} onChange={(e) => setPanel(e.target.value)}>
              <option value="">— None —</option>
              {PANEL_OPTIONS.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>

            <label>ID number (optional)</label>
            <input value={idNumber} onChange={(e) => setIdNumber(e.target.value)} placeholder="Aadhaar, Ayushman, CGHS/ECHS/CAPF card number, etc." />

            <label>Force / category (optional)</label>
            <input value={forceType} onChange={(e) => setForceType(e.target.value)} placeholder="e.g. Cash Patient, Ayushman Bharat, BSF, Pensioner" />

            <label>Ward type (optional)</label>
            <input value={wardType} onChange={(e) => setWardType(e.target.value)} placeholder="e.g. General Ward, Semi-Private Ward, ICU, NICU" />

            {error && <p className="error">{error}</p>}

            <button type="submit" disabled={submitting || locationStatus === "requesting"}>
              {submitting ? "Submitting…" : "Submit lead"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
