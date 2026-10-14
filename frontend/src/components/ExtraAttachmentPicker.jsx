import { useRef, useState } from "react";
import { Paperclip, X } from "lucide-react";

const MAX_BYTES = 8 * 1024 * 1024; // the server's limit
const TARGET_BYTES = 1.5 * 1024 * 1024; // photos bigger than this get shrunk before uploading
const MAX_DIMENSION = 1800;
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp", "application/pdf"];

const toBlob = (canvas, quality) => new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));

// Phone photos are often 4–10 MB. Redraw big ones smaller as a JPEG (honouring the camera's
// rotation) so they upload quickly on mobile data. Small files, PDFs, and anything the browser
// can't redraw pass through untouched.
async function shrinkImage(file) {
  if (!file.type.startsWith("image/")) return file;
  if (ALLOWED_TYPES.includes(file.type) && file.size <= TARGET_BYTES) return file;
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    const scale = Math.min(1, MAX_DIMENSION / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close?.();
    let quality = 0.85;
    let blob = await toBlob(canvas, quality);
    while (blob && blob.size > TARGET_BYTES && quality > 0.5) {
      quality -= 0.1;
      blob = await toBlob(canvas, quality);
    }
    if (blob && (blob.size < file.size || !ALLOWED_TYPES.includes(file.type))) {
      return new File([blob], `${file.name.replace(/\.[^.]+$/, "") || "document"}.jpg`, { type: "image/jpeg" });
    }
  } catch {
    // fall through and use the original
  }
  return file;
}

const formatSize = (bytes) => (bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);

// An optional extra document to send along with a lead — typically a prescription, in addition
// to the card photo. On a phone the file chooser offers the camera, the photo gallery, and files.
export default function ExtraAttachmentPicker({ file, onChange }) {
  const inputRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function handlePick(e) {
    const picked = e.target.files?.[0];
    e.target.value = ""; // so the same file can be chosen again after removing it
    if (!picked) return;
    setError("");
    setBusy(true);
    try {
      const ready = await shrinkImage(picked);
      if (!ALLOWED_TYPES.includes(ready.type)) setError("Please choose a photo (JPG or PNG) or a PDF.");
      else if (ready.size > MAX_BYTES) setError("That file is too large — 8 MB is the maximum.");
      else onChange(ready);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ marginBottom: 12 }}>
      <label>Prescription or other document (optional)</label>
      <input ref={inputRef} type="file" accept="image/*,application/pdf" onChange={handlePick} style={{ display: "none" }} />
      {file ? (
        <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "6px 0 4px", padding: "8px 10px", border: "1.5px solid var(--border)", borderRadius: 10, background: "var(--teal-50)", fontSize: 13.5 }}>
          <Paperclip size={14} style={{ flexShrink: 0 }} />
          <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{file.name}</span>
          <span style={{ color: "var(--ink-soft)", fontSize: 12, flexShrink: 0 }}>{formatSize(file.size)}</span>
          <button type="button" className="secondary" title="Remove" style={{ width: "auto", padding: "3px 7px" }} onClick={() => { setError(""); onChange(null); }}>
            <X size={12} />
          </button>
        </div>
      ) : (
        <button type="button" className="secondary" disabled={busy} style={{ marginTop: 6 }} onClick={() => inputRef.current?.click()}>
          <Paperclip size={15} /> {busy ? "Preparing…" : "Attach a file or photo"}
        </button>
      )}
      {error ? (
        <p className="error" style={{ margin: "6px 0 0" }}>{error}</p>
      ) : (
        <p style={{ fontSize: 11.5, color: "var(--ink-soft)", margin: "6px 0 0" }}>
          For example a prescription, to go along with the card. A photo or PDF, up to 8 MB.
        </p>
      )}
    </div>
  );
}
