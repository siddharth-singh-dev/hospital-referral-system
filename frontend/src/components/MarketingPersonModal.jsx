import { useEffect, useState } from "react";
import { Save, UserPlus } from "lucide-react";
import Modal from "./Modal";
import api from "../api/client";

// Add or edit a hospital marketing-team member. If `person` is passed, this edits that
// person (PATCH); otherwise it creates a new one (POST). Creating sets up their portal
// login immediately (password required); editing can optionally reset the password.
export default function MarketingPersonModal({ person, onClose, onSaved }) {
  const isEdit = Boolean(person);
  const [form, setForm] = useState({
    name: person?.name || "",
    phone: person?.phone || "",
    email: person?.email || "",
    password: "",
    headId: person?.headId || "",
  });
  const [heads, setHeads] = useState([]); // staff accounts that can act as a team head
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    api.get("/marketing-persons/heads").then(({ data }) => setHeads(data)).catch(() => {});
  }, []);

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    if (!isEdit && form.password.trim().length < 4) {
      setError("Set a password (at least 4 characters) for their portal login.");
      return;
    }
    setSaving(true);
    try {
      const payload = { name: form.name, phone: form.phone, email: form.email, headId: form.headId || null };
      if (form.password.trim()) payload.password = form.password.trim();

      let result;
      if (isEdit) {
        result = await api.patch(`/marketing-persons/${person.id}`, payload);
      } else {
        result = await api.post("/marketing-persons", payload);
      }
      onSaved?.(result.data);
    } catch (err) {
      setError(err?.response?.data?.error || "Failed to save.");
      setSaving(false);
    }
  }

  return (
    <Modal title={isEdit ? "Edit marketing person" : "Add marketing person"} onClose={onClose} width={420}>
      <form onSubmit={handleSubmit}>
        <label>Name</label>
        <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required autoFocus />

        <label>Phone (optional)</label>
        <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />

        <label>Email (optional)</label>
        <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />

        <label>Team head (optional)</label>
        <select value={form.headId} onChange={(e) => setForm({ ...form, headId: e.target.value })}>
          <option value="">— No team head —</option>
          {heads.map((h) => (
            <option key={h.id} value={h.id}>{h.name} · {h.roleName}</option>
          ))}
        </select>
        <p style={{ fontSize: 12, color: "var(--ink-soft)", marginTop: -10 }}>
          {heads.length === 0
            ? "Nobody can be a team head yet. Create a role with “View their own marketing team”, then add a staff account with that role."
            : "A team head can see only the people assigned to them, with their leaders and leads."}
        </p>

        <label>{isEdit ? "Reset portal password (optional)" : "Portal password"}</label>
        <input
          type="text"
          value={form.password}
          onChange={(e) => setForm({ ...form, password: e.target.value })}
          placeholder={isEdit ? "Leave blank to keep the current password" : "e.g. a simple PIN or word"}
        />
        <p style={{ fontSize: 12, color: "var(--ink-soft)", marginTop: -10 }}>
          {isEdit
            ? "Only fill this in if you want to change their password."
            : "They'll use this, along with their personal QR link, to view their own stats — nothing else."}
        </p>

        {error && <p className="error">{error}</p>}

        <button type="submit" disabled={saving} style={{ marginTop: 8 }}>
          {isEdit ? <Save size={16} /> : <UserPlus size={16} />}
          {saving ? "Saving…" : isEdit ? "Save changes" : "Add marketing person"}
        </button>
      </form>
    </Modal>
  );
}
